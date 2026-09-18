const { app, BrowserWindow, ipcMain, dialog, protocol, net, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ANALYSIS_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT,'analysis-version.json'),'utf8')).version;
const PROFILE = process.env.MQV_TEST_PROFILE==='1' ? path.join(ROOT,'.cache','ui-test-profile') : path.join(ROOT,'.data');
app.setPath('userData', path.join(PROFILE, 'desktop'));
app.setPath('sessionData', path.join(PROFILE, 'session'));
protocol.registerSchemesAsPrivileged([{ scheme: 'mqv', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const allowed = new Set();
const media = new Map();
let win, activeJob;
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if(win){if(win.isMinimized())win.restore();win.focus();} });

function worker(request, notify) {
  const python = process.env.MQV_PYTHON || path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  const child = spawn(python, ['-u', '-m', 'backend.worker'], {
    cwd: ROOT, windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', TORCH_HOME: path.join(ROOT, '.data', 'models') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '', stderr = '', result, failure;
  const promise = new Promise((resolve, reject) => {
    child.on('error', e => reject(new Error(`Pythonを起動できません。配布版はSetup.cmd、ソース版はsetup.ps1を実行してください。${e.message}`)));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-12000); });
    child.stdout.on('data', text => {
      buffer += text;
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'result') result = msg.result;
          else if (msg.type === 'error') failure = msg.message;
          else if (msg.type === 'progress') notify?.(msg);
        } catch { /* third-party stdout diagnostics are not IPC */ }
      }
    });
    child.on('close', code => {
      if (result && code === 0) resolve(result);
      else reject(new Error(failure || (child.killed ? '解析をキャンセルしました。' : `解析に失敗しました。${stderr.slice(-1800)}`)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request)+'\n');
  });
  return { child, promise };
}

function exposeResult(result) {
  if(result.version!==ANALYSIS_VERSION) throw new Error('旧バージョンの解析です。音源を再解析してください。');
  result.media = {};
  for (const [key, filename] of Object.entries(result.media_paths || {})) {
    const resolved = path.resolve(filename);
    const root = path.join(ROOT, '.data', 'analyses') + path.sep;
    if (!resolved.startsWith(root)) throw new Error('不正なキャッシュパスです。');
    const token = randomUUID(); media.set(token, resolved);
    result.media[key] = `mqv://audio/${token}`;
  }
  delete result.media_paths;
  return result;
}

app.whenReady().then(() => {
  protocol.handle('mqv', request => {
    const url = new URL(request.url);
    const filename = url.hostname === 'audio' && media.get(url.pathname.slice(1));
    if (!filename) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filename).toString(), { headers: request.headers });
  });
  // Renderer has no network access and no Node. Python only downloads model weights.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: /^https?:/i.test(details.url) });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  win = new BrowserWindow({ width: 1480, height: 980, minWidth: 1060, minHeight: 720,
    backgroundColor: '#101419', title: 'Mix Atlas — ミックス解析',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  const trusted = e => { if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame) throw new Error('Forbidden'); };
  ipcMain.handle('choose-audio', async (e, multiple=false) => {
    trusted(e);
    const selected = await dialog.showOpenDialog(win, { title: '音源を選択', properties: ['openFile', ...(multiple ? ['multiSelections'] : [])], filters: [{ name: 'Audio', extensions: ['wav','flac','mp3'] }] });
    return selected.filePaths.map(filename => { allowed.add(filename); return { path: filename, name: path.basename(filename) }; });
  });
  ipcMain.handle('analyze', async (e, request) => {
    trusted(e);
    if (activeJob) throw new Error('解析中です。完了を待つかキャンセルしてください。');
    if (!request || !allowed.has(request.path) || Object.values(request.stems || {}).some(p => !allowed.has(p))) throw new Error('選択済みの音源を指定してください。');
    const job = worker(request, msg => { if (!win.isDestroyed()) win.webContents.send('progress', msg); });
    activeJob = job;
    try { return exposeResult(await job.promise); }
    finally { if (activeJob === job) activeJob = null; }
  });
  ipcMain.handle('cancel', e => { trusted(e); activeJob?.child.kill(); });
  ipcMain.handle('health', async e => { trusted(e); return worker({ action: 'health' }).promise; });
  ipcMain.handle('history', async e => {
    trusted(e);
    const directory = path.join(ROOT, '.data', 'analyses');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).flatMap(id => {
      try { const r = JSON.parse(fs.readFileSync(path.join(directory,id,'result.json'),'utf8')); return r.version===ANALYSIS_VERSION ? [{id:r.id,name:r.name,duration:r.duration,mode:r.mode}] : []; }
      catch { return []; }
    });
  });
  ipcMain.handle('load-history', async (e, id) => {
    trusted(e);
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid id');
    const r = JSON.parse(fs.readFileSync(path.join(ROOT,'.data','analyses',id,'result.json'),'utf8'));
    return exposeResult({...r,cached:true});
  });
  ipcMain.handle('export', async (e, payload) => {
    trusted(e);
    const chosen = await dialog.showSaveDialog(win, { defaultPath: 'mix-analysis.json', filters: [{name:'JSON',extensions:['json']}] });
    if (!chosen.canceled) fs.writeFileSync(chosen.filePath, JSON.stringify(payload,null,2), 'utf8');
    return !chosen.canceled;
  });
  // Synthetic fixtures are made by the project's demo generator, never downloaded audio.
  ipcMain.handle('demo', async e => {
    trusted(e);
    const folder = path.join(ROOT, 'demo-audio');
    if (!fs.existsSync(path.join(folder,'mix.wav'))) throw new Error('先に npm run demo を実行してください。');
    const request = { path: path.join(folder,'mix.wav'), mode:'stems', stems:{} };
    for (const part of ['vocals','drums','bass','other']) request.stems[part]=path.join(folder,`${part}.wav`);
    [request.path,...Object.values(request.stems)].forEach(p=>allowed.add(p));
    return request;
  });
  win.loadFile(path.join(ROOT, 'ui', 'index.html'));
});
app.on('window-all-closed', () => { activeJob?.child.kill(); app.quit(); });
