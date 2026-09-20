const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
function resetSession(){
  execFileSync(process.execPath,['-e',`const {Library}=require('./desktop/library.cjs');const library=new Library('./.cache/ui-test-profile/library.sqlite');try{library.saveSession({selected:null,tab:'overview',workspaces:[]});}finally{library.close();}`],{cwd:root,windowsHide:true});
}
module.exports={resetSession};
