const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {Engine}=require('../desktop/engine.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mixatlas-runtime-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'engine-config.json'),'{}');
 fs.writeFileSync(path.join(root,'requirements-runtime.txt'),'numpy==2.5.3\n');
 return root;
}
function mockRunner(root,calls,options={}){
 return async(executable,args)=>{
  calls.push({executable,args});
  if(args.includes('--version')){if(options.noUv)throw new Error('missing uv');return 'uv 0.11';}
  if(args.includes('-c') && args.some(a=>a.includes('json.dumps')))return JSON.stringify({python:path.join(root,'base-python.exe')});
  if(args.includes('venv')){
   const python=path.join(args.at(-1),'Scripts','python.exe');fs.mkdirSync(path.dirname(python),{recursive:true});fs.writeFileSync(python,'test');
  }
  if(options.failPackages && args.includes('https://pypi.org/simple'))throw new Error('network interrupted');
  if(options.failValidation && args.some(a=>a.includes('from demucs.pretrained')))throw new Error('missing demucs');
  return 'ready';
 };
}
test('uv installs into a private venv using separate upstream indexes',async t=>{
 const root=fixture(t),calls=[];const engine=new Engine(root,path.join(root,'cache'),mockRunner(root,calls));
 assert.equal(engine.status().ready,false);
 await engine.install(()=>{},{variant:'cu128',manager:'uv'});
 assert.equal(engine.status().ready,true);
 const installs=calls.filter(c=>c.args.includes('install'));
 assert.equal(installs.length,2);
 assert.ok(installs[0].args.includes('https://download.pytorch.org/whl/cu128'));
 assert.ok(installs[0].args.includes('torch==2.8.0+cu128'));
 assert.ok(installs[1].args.includes('https://pypi.org/simple'));
 assert.ok(installs.every(c=>c.args.includes(engine.python) && c.args.includes('--no-deps')));
 assert.ok(engine.python.startsWith(path.join(root,'cache')+path.sep));
 assert.equal(new Engine(root,path.join(root,'cache')).python,engine.python);
});
test('pip fallback uses only the new venv and a failed setup can retry',async t=>{
 const root=fixture(t),calls=[],options={noUv:true,failPackages:true};
 const engine=new Engine(root,path.join(root,'cache'),mockRunner(root,calls,options));
 await assert.rejects(engine.install(()=>{}),/network interrupted/);
 assert.equal(engine.status().ready,false);
 options.failPackages=false;
 await engine.install(()=>{});
 assert.equal(engine.status().ready,true);
 assert.ok(calls.filter(c=>c.args.includes('install')).every(c=>c.executable===engine.python));
 assert.equal(calls.filter(c=>c.args.includes('venv')).length,1);
});
test('invalid existing environment never replaces the working selection',async t=>{
 const root=fixture(t),calls=[],options={};const engine=new Engine(root,path.join(root,'cache'),mockRunner(root,calls,options));
 const old=path.join(root,'old-python.exe'),bad=path.join(root,'bad-python.exe');fs.writeFileSync(old,'');fs.writeFileSync(bad,'');
 await engine.usePython(old);options.failValidation=true;
 await assert.rejects(engine.usePython(bad),/missing demucs/);
 assert.equal(engine.python,old);
});
test('unavailable tools and invalid options leave setup unconfigured',async t=>{
 const root=fixture(t);let calls=0;
 const engine=new Engine(root,path.join(root,'cache'),async()=>{calls++;throw new Error('ENOENT');});
 await assert.rejects(engine.install(()=>{},{variant:'invalid'}),/不正/);assert.equal(calls,0);
 await assert.rejects(engine.install(()=>{}),/Python 3.13/);assert.equal(engine.status().ready,false);
});
