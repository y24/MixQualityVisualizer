const {test,expect,_electron}=require('@playwright/test');
const path=require('node:path');const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
test('application-only executable uses a validated external Python for CPU and GPU analysis',async()=>{
  test.setTimeout(360000);
  test.skip(!process.env.MQV_PACKAGED_TEST,'Opt-in built Windows distribution test');
  const root=path.resolve(__dirname,'../..');
  const build=JSON.parse(fs.readFileSync(path.join(root,'.cache/last-windows-build.json'),'utf8'));
  const appRoot=path.join(build.directory,'resources/app');
  expect(fs.existsSync(path.join(appRoot,'.venv'))).toBe(false);
  expect(fs.existsSync(path.join(appRoot,'.data'))).toBe(false);
  expect(fs.existsSync(path.join(build.directory,'resources/python'))).toBe(false);
  expect(fs.existsSync(path.join(build.directory,'resources/bootstrap'))).toBe(false);
  expect(fs.existsSync(path.join(appRoot,'engine-download.json'))).toBe(false);
  const python=path.join(root,'.venv/Scripts/python.exe');
  const env={...process.env,PATH:path.join(process.env.SystemRoot,'System32'),MQV_TEST_PROFILE:'1'};
  delete env.MQV_PYTHON;delete env.PYTHONHOME;delete env.PYTHONPATH;delete env.VIRTUAL_ENV;
  // Only test fixtures: release builds do not include these cached model weights.
  fs.cpSync(path.join(root,'.data/models'),path.join(appRoot,'.data/models'),{recursive:true});
  const app=await _electron.launch({executablePath:build.executable,args:[],env});
  try{
    const page=await app.firstWindow();
    await expect(page.locator('#engine-setup')).toBeVisible();
    await expect(page.locator('#demo')).toBeDisabled();
    const basePython=execFileSync(python,['-c','import sys; print(sys._base_executable)'],{encoding:'utf8',windowsHide:true}).trim();
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},basePython);
    await page.locator('#engine-select').click();
    await expect(page.locator('#engine-setup-message')).toContainText('失敗',{timeout:30000});
    await expect(page.locator('#demo')).toBeDisabled();
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},python);
    await page.locator('#engine-select').click();
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await expect(page.locator('#engine-setup')).toBeHidden();
    await page.reload();
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await page.locator('#demo').click();
    await expect(page.locator('#dashboard')).toBeVisible({timeout:90000});
    await expect(page.locator('#progress-panel')).toBeHidden();
    await page.getByRole('button',{name:'ドラム',exact:true}).click();
    await expect(page.locator('#rhythm-panel')).toBeVisible();
    await page.locator('#structure-panel summary').click();
    await expect(page.locator('#structure-status')).toContainText('変化点');
    await expect(page.locator('#structure-apply')).toBeEnabled();
    const fixture=path.join(root,'.data/smoke/separation-smoke.wav');
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},fixture);
    for(const device of ['cpu','cuda:0']){
      await page.locator('#add-target').click();
      await page.locator('#choose-mix').click();await page.locator('#import-mode').selectOption('separate');
      const hasDevice=await page.locator(`#device option[value="${device}"]`).count();
      if(!hasDevice){await page.locator('#import-close').click();continue;}
      await page.locator('#device').selectOption(device);
      const label=(await page.locator('#device option:checked').innerText()).replace(/^GPU：\s*/,'').replace(/\s*\(.*$/,'');
      await page.locator('#model').selectOption('htdemucs');
      await page.locator('#import-submit').click();
      await expect(page.locator('#progress-panel')).toBeHidden({timeout:90000});
      await expect(page.locator('#notice')).toBeHidden();
      await expect(page.locator('#track-title')).toHaveText('separation-smoke');
      await expect(page.locator('#track-meta')).toContainText(`${label}で分離`);
    }
    await page.screenshot({path:'test-results/packaged-windows.png'});
  }finally{await app.close();}
});
