const {test,expect,_electron}=require('@playwright/test');
const path=require('node:path');const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
test('Windows folder executable loads engine and analyzes without npm',async()=>{
  test.skip(!process.env.MQV_PACKAGED_TEST,'Opt-in built Windows distribution test');
  const root=path.resolve(__dirname,'../..');
  const build=JSON.parse(fs.readFileSync(path.join(root,'.cache/last-windows-build.json'),'utf8'));
  const appRoot=path.join(build.directory,'resources/app');
  expect(fs.existsSync(path.join(appRoot,'.venv'))).toBe(false);
  expect(fs.existsSync(path.join(appRoot,'.data'))).toBe(false);
  const python=path.join(root,'.venv/Scripts/python.exe');
  execFileSync(python,[path.join(appRoot,'scripts/make_demo.py')],{windowsHide:true});
  const app=await _electron.launch({executablePath:build.executable,args:[],env:{...process.env,MQV_PYTHON:python,MQV_TEST_PROFILE:'1'}});
  try{
    const page=await app.firstWindow();
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await page.locator('#demo').click();
    await expect(page.locator('#dashboard')).toBeVisible({timeout:90000});
    await expect(page.locator('#progress-panel')).toBeHidden();
    await page.getByRole('button',{name:'ドラム',exact:true}).click();
    await expect(page.locator('#rhythm-panel')).toBeVisible();
    await page.screenshot({path:'test-results/packaged-windows.png'});
  }finally{await app.close();}
});
