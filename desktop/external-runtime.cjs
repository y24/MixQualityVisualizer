const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');

function run(executable, args, progress = () => {}) {
  return new Promise((resolve, reject) => {
    const env = {...process.env, PYTHONUTF8:'1', PYTHONNOUSERSITE:'1', PIP_DISABLE_PIP_VERSION_CHECK:'1'};
    delete env.PYTHONHOME; delete env.PYTHONPATH; delete env.VIRTUAL_ENV;
    const child = spawn(executable, args, {windowsHide:true, env, stdio:['ignore','pipe','pipe']});
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output=(output+chunk).slice(-12000); progress({message:String(chunk).trim()}); });
    child.stderr.on('data', chunk => { errors=(errors+chunk).slice(-12000); progress({message:String(chunk).trim()}); });
    child.on('error', reject);
    child.on('close', code => code===0 ? resolve(output.trim()) : reject(new Error(`${path.basename(executable)} の実行に失敗しました。\n${errors.slice(-2500) || output.slice(-2500)}`)));
  });
}

const PROBE = 'import sys,struct,json; assert sys.version_info[:2]==(3,13) and struct.calcsize("P")==8, "Python 3.13 (64-bit) が必要です"; print(json.dumps({"python":sys.executable}))';
const VALIDATE = `import sys,struct,importlib.metadata as m
from pathlib import Path
assert sys.version_info[:2]==(3,13) and struct.calcsize('P')==8, 'Python 3.13 (64-bit) が必要です'
for line in Path(sys.argv[1]).read_text(encoding='utf8').splitlines():
 if not line.strip() or line.startswith('#'): continue
 name,version=line.strip().split('==')
 assert m.version(name)==version, name+' のバージョンが異なります（必要: '+version+'）'
for name in ('torch','torchaudio'):
 assert m.version(name).split('+')[0]=='2.8.0', name+' 2.8.0 が必要です'
import torch,torchaudio,numpy,scipy,soundfile,pyloudnorm
from demucs.pretrained import get_model
from demucs.apply import apply_model
assert torch.ones(2).sum().item()==2
print('ready')`;

class Engine {
  constructor(root, cache, runner = run) {
    this.root = root; this.cache = cache; this.run = runner;
    this.packaged = fs.existsSync(path.join(root,'engine-config.json'));
    this.requirements = path.join(root,'requirements-runtime.txt');
    this.key = createHash('sha256').update(fs.readFileSync(this.requirements)).update('python313-torch280-v1').digest('hex').slice(0,16);
    this.settings = path.join(cache,`selection-${this.key}.json`);
  }
  get python() {
    try { return JSON.parse(fs.readFileSync(this.settings,'utf8')).python; } catch { /* No saved selection. */ }
    if(!this.packaged) {
      const developer = process.env.MQV_PYTHON || path.join(this.root,'.venv','Scripts','python.exe');
      if(fs.existsSync(developer)) return developer;
    }
    return '';
  }
  status() {
    const python=this.python;
    return {ready:typeof python==='string' && !!python && fs.existsSync(python), python, busy:!!this.pending};
  }
  async validate(python) {
    if(typeof python!=='string' || !path.isAbsolute(python) || !fs.existsSync(python)) throw new Error('存在する python.exe を選択してください。');
    await this.run(python,['-I','-c',VALIDATE,this.requirements]);
  }
  async save(python) {
    await fs.promises.mkdir(this.cache,{recursive:true});
    const temporary=this.settings+'.tmp';
    await fs.promises.writeFile(temporary,JSON.stringify({python}));
    await fs.promises.rename(temporary,this.settings);
    return {...this.status(),busy:false};
  }
  usePython(python) {
    if(this.pending) return Promise.reject(new Error('セットアップが完了するまでお待ちください。'));
    this.pending=(async()=>{await this.validate(python);return this.save(python);})().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async toolchain(preference='auto') {
    if(preference==='auto' || preference==='uv') {
      try { await this.run('uv',['--version']); return {kind:'uv',executable:'uv'}; }
      catch { if(preference==='uv') throw new Error('uvが見つかりません。uvをインストールしてアプリを再起動してください。'); }
    }
    for(const [executable,prefix] of [['py',['-3.13']],['python',[]]]) {
      try {
        const output=await this.run(executable,[...prefix,'-I','-c',PROBE]);
        return {kind:'pip',executable:JSON.parse(output).python};
      }catch { /* Try the next installed interpreter. */ }
    }
    throw new Error('Python 3.13 (64-bit) または uv をインストールしてアプリを再起動してください。準備済み環境の python.exe を指定することもできます。');
  }
  install(progress, options={}) {
    const {variant='cpu',manager='auto'}=options || {};
    if(!['cpu','cu128'].includes(variant) || !['auto','python','uv'].includes(manager)) return Promise.reject(new Error('不正なセットアップ設定です。'));
    if(!this.pending) this.pending=this.perform(progress,variant,manager).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async perform(progress,variant,manager) {
    progress({message:'Python / uv を確認中…'});
    const tool=await this.toolchain(manager);
    await fs.promises.mkdir(this.cache,{recursive:true});
    const environment=path.join(this.cache,`venv-${this.key}-${variant}`);
    const python=path.join(environment,'Scripts','python.exe');
    // Create directly at its final path: moving a venv can break its scripts.
    if(!fs.existsSync(python)) {
      progress({message:tool.kind==='uv'?'uvで専用環境を作成中（必要ならPythonも取得）…':'Pythonで専用環境を作成中…'});
      if(tool.kind==='uv') await this.run('uv',['--no-config','venv','--python','3.13',environment],progress);
      else await this.run(tool.executable,['-I','-m','venv',environment],progress);
    }
    // uv venvs need not contain pip. Switching setup tools must still work.
    if(tool.kind==='pip') await this.run(python,['-I','-m','ensurepip','--upgrade'],progress);
    const installArgs=tool.kind==='uv'
      ? ['--no-config','pip','install','--python',python,'--no-deps']
      : ['-I','-m','pip','--isolated','install','--no-deps'];
    const executable=tool.kind==='uv'?'uv':python;
    progress({message:variant==='cpu'?'CPU版PyTorchを公式配布元から取得中…':'CUDA版PyTorchを公式配布元から取得中（数GB）…'});
    await this.run(executable,[...installArgs,'--index-url',`https://download.pytorch.org/whl/${variant}`,`torch==2.8.0+${variant}`,`torchaudio==2.8.0+${variant}`],progress);
    progress({message:'解析ライブラリをPyPIから取得中…'});
    await this.run(executable,[...installArgs,'--index-url','https://pypi.org/simple','-r',this.requirements],progress);
    if(tool.kind==='uv') await this.run('uv',['--no-config','pip','check','--python',python],progress);
    else await this.run(python,['-I','-m','pip','--isolated','check'],progress);
    progress({message:'解析ライブラリの動作を検証中…'});
    await this.validate(python);
    // Selection changes only after successful validation. Failed installs can retry.
    return this.save(python);
  }
}
module.exports={Engine,run};
