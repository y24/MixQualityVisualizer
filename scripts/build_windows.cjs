// Distribute the application only. Python and analysis packages are user-installed.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'analysis-version.json'),'utf8')).version;
const base=path.join(root,'dist');
const out=path.join(base,`MixAtlas-${version}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
if(!out.startsWith(base+path.sep)||fs.existsSync(out))throw new Error('Output directory must be new and inside dist');
if(process.argv.includes('--bundled'))throw new Error('Python bundling is no longer supported. Use the external Python/uv setup.');
const electron=path.join(root,'node_modules','electron','dist');
if(!fs.existsSync(path.join(electron,'electron.exe')))throw new Error('Run npm ci on Windows first.');
fs.mkdirSync(out,{recursive:true});
for(const file of fs.readdirSync(electron)){
  fs.cpSync(path.join(electron,file),path.join(out,file==='electron.exe'?'MixAtlas.exe':file),{
    recursive:true,filter:source=>path.basename(source)!=='default_app.asar'
  });
}
const app=path.join(out,'resources','app');fs.mkdirSync(app,{recursive:true});
for(const directory of ['backend','desktop','ui'])fs.cpSync(path.join(root,directory),path.join(app,directory),{recursive:true,filter:p=>!['__pycache__','install_engine.py'].includes(path.basename(p))});
for(const file of ['analysis-version.json','requirements-runtime.txt'])fs.copyFileSync(path.join(root,file),path.join(app,file));
fs.mkdirSync(path.join(app,'scripts'));fs.copyFileSync(path.join(root,'scripts','make_demo.py'),path.join(app,'scripts','make_demo.py'));
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'mix-atlas',version:'0.1.0',main:'desktop/main.cjs',private:true},null,2));
fs.writeFileSync(path.join(app,'engine-config.json'),JSON.stringify({mode:'external-python',python:'3.13',torch:'2.8.0'}));
// Build-time Python is used only for synthetic fixtures and archive creation.
const python=path.join(root,'.venv','Scripts','python.exe');
execFileSync(python,[path.join(app,'scripts','make_demo.py')],{stdio:'inherit',windowsHide:true});
fs.copyFileSync(path.join(root,'packaging','README.txt'),path.join(out,'README.txt'));
fs.writeFileSync(path.join(out,'build-info.json'),JSON.stringify({analysisVersion:version,electronVersion:fs.readFileSync(path.join(electron,'version'),'utf8').trim(),pythonBundled:false,runtimeMode:'external-python',analysisPackagesBundled:false,containsUserAudio:false},null,2));
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
const applicationArchive=out+'.zip';
execFileSync(python,[path.join(root,'scripts','archive_distribution.py'),out,applicationArchive],{stdio:'inherit',windowsHide:true});
fs.writeFileSync(path.join(root,'.cache','last-windows-build.json'),JSON.stringify({directory:out,executable:path.join(out,'MixAtlas.exe'),applicationArchive}));
console.log(out);
