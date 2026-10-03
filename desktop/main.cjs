const { app, BrowserWindow, ipcMain, dialog, protocol, net, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Engine } = require('./engine.cjs');
const { Library } = require('./library.cjs');

const ROOT = path.resolve(__dirname, '..');
const engine = new Engine(ROOT, process.env.MQV_TEST_PROFILE==='1' ? path.join(ROOT,'.cache','engines') : path.join(app.getPath('appData'), 'MixAtlas', 'engines'));
const ANALYSIS_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT,'analysis-version.json'),'utf8')).version;
const PROFILE = process.env.MQV_TEST_PROFILE==='1' ? path.join(ROOT,'.cache','ui-test-profile') : path.join(ROOT,'.data');
app.setPath('userData', path.join(PROFILE, 'desktop'));
app.setPath('sessionData', path.join(PROFILE, 'session'));
protocol.registerSchemesAsPrivileged([{ scheme: 'mqv', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
const allowed = new Set();
const media = new Map();
let win, activeJob, library;
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if(win){if(win.isMinimized())win.restore();win.focus();} });

function worker(request, notify) {
  if(engine.status().busy) throw new Error('解析環境のセットアップが完了するまでお待ちください。');
  if (!engine.status().ready) throw new Error('先に解析エンジンの初回セットアップを完了してください。');
  const child = spawn(engine.python, ['-I', '-u', '-X', 'faulthandler', '-c', 'import sys,runpy; sys.path.insert(0,sys.argv[1]); runpy.run_module("backend.worker",run_name="__main__")', ROOT], {
    cwd: ROOT, windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', TORCH_HOME: path.join(ROOT, '.data', 'models') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '', stderr = '', result, failure;
  const promise = new Promise((resolve, reject) => {
    child.on('error', e => reject(new Error(`解析エンジンを起動できません。「解析環境」からPython環境を設定し直してください。${e.message}`)));
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
      else reject(new Error(failure || (child.killed ? '解析をキャンセルしました。' : `解析に失敗しました（終了コード: ${code}）。${stderr.slice(-1800)}`)));
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
    if (!fs.existsSync(resolved)) throw new Error('試聴キャッシュが見つかりません。元の音源を再解析してください。');
    const token = randomUUID(); media.set(token, resolved);
    result.media[key] = `mqv://audio/${token}`;
  }
  delete result.media_paths;
  return result;
}

app.whenReady().then(() => {
  library = new Library(path.join(PROFILE, 'library.sqlite'));
  library.importCaches(path.join(ROOT, '.data', 'analyses'));
  protocol.handle('mqv', async request => {
    const url = new URL(request.url);
    const filename = url.hostname === 'audio' && media.get(url.pathname.slice(1));
    if (!filename) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(filename).toString(), { headers: request.headers });
    const headers = new Headers(response.headers);
    // The packaged UI has a file: (null) origin; only registered audio tokens are served.
    headers.set('Access-Control-Allow-Origin', 'null');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
  // Renderer has no network access. Package managers and Python fetch dependencies/models.
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
  ipcMain.handle('engine-status', e => { trusted(e); return engine.status(); });
  ipcMain.handle('engine-install', (e, options) => {
    trusted(e);
    if(activeJob) throw new Error('解析の完了後に設定してください。');
    return engine.install(message => { if(!win.isDestroyed()) win.webContents.send('engine-progress', message); }, options);
  });
  ipcMain.handle('engine-select', async e => {
    trusted(e);
    if(activeJob) throw new Error('解析の完了後に設定してください。');
    const selected=await dialog.showOpenDialog(win,{title:'準備済みの環境の python.exe を選択',properties:['openFile'],filters:[{name:'Python',extensions:['exe']}]});
    if(selected.canceled || !selected.filePaths.length) return null;
    return engine.usePython(selected.filePaths[0]);
  });
  ipcMain.handle('choose-audio', async (e, multiple=false) => {
    trusted(e);
    const selected = await dialog.showOpenDialog(win, { title: '音源を選択', properties: ['openFile', ...(multiple ? ['multiSelections'] : [])], filters: [{ name: 'Audio', extensions: ['wav','flac','mp3'] }] });
    return selected.filePaths.map(filename => { allowed.add(filename); return { path: filename, name: path.basename(filename) }; });
  });
  ipcMain.handle('analyze', async (e, request) => {
    trusted(e);
    if (activeJob) throw new Error('解析中です。完了を待つかキャンセルしてください。');
    if (!request || !allowed.has(request.path) || Object.values(request.stems || {}).some(p => !allowed.has(p))) throw new Error('選択済みの音源を指定してください。');
    const previous = request.libraryId == null ? null : library.load(request.libraryId);
    const job = worker(request, msg => { if (!win.isDestroyed()) win.webContents.send('progress', msg); });
    activeJob = job;
    try {
      const result = await job.promise;
      result.analysis_request = {mode:request.mode,model:request.model,device:request.device,stems:request.stems || {}};
      library.save(result);
      if(previous && (previous.id!==result.id || path.resolve(previous.source)!==path.resolve(result.source))) library.remove([request.libraryId]);
      return exposeResult(result);
    }
    finally { if (activeJob === job) activeJob = null; }
  });
  ipcMain.handle('cancel', e => { trusted(e); activeJob?.child.kill(); });
  ipcMain.handle('health', async e => { trusted(e); return worker({ action: 'health' }).promise; });
  ipcMain.handle('history', async e => {
    trusted(e);
    return library.list(ANALYSIS_VERSION);
  });
  ipcMain.handle('load-history', async (e, id) => {
    trusted(e);
    const r = library.load(id);
    return exposeResult({...r,cached:true});
  });
  ipcMain.handle('remove-history', (e, ids) => { trusted(e); return library.remove(ids); });
  ipcMain.handle('save-session', (e, snapshot) => { trusted(e); library.saveSession(snapshot); });
  ipcMain.handle('load-session', e => {
    trusted(e);
    const saved=library.loadSession(), results=[], warnings=[];
    for(const result of saved.results) {
      try { results.push(exposeResult({...result,cached:true})); }
      catch(error) { warnings.push(`${result.name}: ${error.message}`); }
    }
    return {snapshot:saved.snapshot,results,warnings};
  });
  ipcMain.handle('prepare-history-analysis', (e, id) => {
    trusted(e);
    const prepared = library.prepareAnalysis(id);
    for(const file of [prepared.source,...Object.values(prepared.stems)]) if(file) allowed.add(file.path);
    return prepared;
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
app.on('will-quit', () => library?.close());
