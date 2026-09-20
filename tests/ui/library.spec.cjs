const {resetSession}=require('./session-helpers.cjs');
const { test, expect, _electron } = require('@playwright/test');
const path = require('node:path');
test('library survives restart and supports preview, search and both destinations', async () => {
  resetSession();
  let app;
  const launch = () => _electron.launch({args:[path.resolve(__dirname,'../..')],env:{...process.env,MQV_TEST_PROFILE:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  try {
    app=await launch();let page=await app.firstWindow();
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await page.locator('#demo').click();await expect(page.locator('#dashboard')).toBeVisible({timeout:90000});
    const id=await page.evaluate(()=>state.target.id);
    await app.close();app=await launch();page=await app.firstWindow();
    await page.locator('#history').click();
    const items=await page.evaluate(()=>window.mixApp.history());
    const item=items.find(x=>x.analysis_id===id);
    expect(item).toBeTruthy();expect(item.summary.low_pct.median).toEqual(expect.any(Number));
    await page.locator('#library-search').fill('no-such-track-12345');
    await expect(page.locator('#history-items')).toContainText('一致する音源がありません');
    await page.locator('#library-search').fill('');
    const row=page.locator(`[data-library-id="${item.id}"]`);
    await expect(row).toContainText(item.name);
    await page.locator('#library-audio').evaluate(a=>a.volume=0);
    await row.getByRole('button',{name:/再生/}).click();
    await expect.poll(()=>page.locator('#library-audio').evaluate(a=>!a.paused&&a.currentTime>0)).toBe(true);
    await page.screenshot({path:'test-results/library.png'});
    await row.getByRole('button',{name:'ワークスペースに追加'}).click();
    await expect(page.locator('#dashboard')).toBeVisible();
    expect(await page.locator('#library-audio').evaluate(a=>a.paused)).toBe(true);
    await page.locator('#history').click();
    await row.getByRole('button',{name:'リファレンスに追加'}).click();
    await expect(page.locator('#reference-list .track')).toHaveCount(1);
    await page.locator('#history').click();await row.getByRole('button',{name:'ワークスペースに追加'}).click();
    await expect(page.locator('#target-list .track')).toHaveCount(1);
    await page.evaluate(async()=>{const request=await window.mixApp.demo();request.mode='mix';request.stems={};await analyze(request,'target');});
    await expect(page.locator('#target-list .track')).toHaveCount(2);
    expect(await page.evaluate(()=>state.target.id)).not.toBe(id);
    await page.locator('#target-list .track button').first().click();
    expect(await page.evaluate(()=>state.target.id)).toBe(id);
    await page.locator('#history').click();
    const currentItems=await page.evaluate(()=>window.mixApp.history());
    for(const key of ['duration','vocals_db','drums_db','low_pct','side_pct']){
      for(const direction of [1,-1]){
        await page.locator(`[data-sort="${key}"]`).click();
        const ordered=await page.locator('#history-items tr[data-library-id]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.libraryId)));
        const values=ordered.map(id=>{const item=currentItems.find(x=>x.id===id);return key==='duration'?item.duration:item.summary[key]?.median;});
        const valid=values.filter(v=>typeof v==='number');
        expect(valid).toEqual([...valid].sort((a,b)=>direction*(a-b)));
        expect(values.slice(0,valid.length)).toEqual(valid);
      }
    }
    await row.getByRole('checkbox').check();
    await page.locator('#library-search').fill('no-such-track-12345');
    await expect(page.locator('#library-selected')).toHaveText('1 曲選択中');
    await page.locator('#library-search').fill(item.source);
    await page.locator('#library-select-all').check();
    const removed=await page.locator('#history-items tr[data-library-id]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.libraryId)));
    expect(removed.length).toBeGreaterThanOrEqual(2);
    await page.screenshot({path:'test-results/library-compact.png'});
    await page.locator('#library-delete').click();
    await expect(page.locator('#history-items tr[data-library-id]')).toHaveCount(0);
    await expect(page.locator('#library-delete')).toBeDisabled();
    await page.locator('#history-close').click();
    await expect(page.locator('#target-list .track')).toHaveCount(2);
    await app.close();app=await launch();page=await app.firstWindow();
    const remaining=await page.evaluate(()=>window.mixApp.history());
    expect(remaining.some(x=>removed.includes(x.id))).toBe(false);
  } finally {await app?.close();}
});

test('empty-state entry points, workspace removal and direct legacy reanalysis', async () => {
  const root=path.resolve(__dirname,'../..');
  resetSession();
  const app=await _electron.launch({args:[root],env:{...process.env,MQV_TEST_PROFILE:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  try {
    const page=await app.firstWindow();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await page.screenshot({path:'test-results/empty-library.png'});
    await page.locator('#empty-library').click();await expect(page.locator('#history-dialog')).toBeVisible();
    await page.locator('#history-close').click();
    await page.locator('#empty-import').click();await expect(page.locator('#import-dialog')).toBeVisible();
    await page.locator('#import-close').click();
    const result=await page.evaluate(async()=>{const request=await window.mixApp.demo();request.mode='mix';request.stems={};const result=await window.mixApp.analyze(request);addResult(result,'target');return result;});
    await page.locator('#demo').click();await expect(page.locator('#progress-panel')).toBeHidden({timeout:90000});
    await expect(page.locator('#target-list .track')).toHaveCount(2);
    // Removing the selected track selects the remaining track.
    await page.locator('#target-list .track.selected .workspace-remove').click();
    expect(await page.evaluate(()=>state.target.id)).toBe(result.id);
    await page.locator('#target-list .workspace-remove').click();
    await expect(page.locator('#empty')).toBeVisible();await expect(page.locator('#track-title')).toHaveText('ミックス解析');
    expect(await page.locator('#audio').evaluate(a=>a.paused&&!a.hasAttribute('src'))).toBe(true);
    expect((await page.evaluate(()=>window.mixApp.history())).some(x=>x.analysis_id===result.id)).toBe(true);
    // Seed a synthetic old-version result; user audio is never modified.
    const legacy=Number(require('node:child_process').execFileSync(process.execPath,['-e',`
      const fs=require('node:fs');const {root,result}=JSON.parse(fs.readFileSync(0,'utf8'));
      const {Library}=require(root+'/desktop/library.cjs');
      const library=new Library(root+'/.cache/ui-test-profile/library.sqlite');
      try {library.save({...result,id:'e'.repeat(24),version:'legacy-test'});process.stdout.write(String(library.list('unused').find(x=>x.analysis_id==='e'.repeat(24)).id));}
      finally{library.close();}
    `],{input:JSON.stringify({root,result}),encoding:'utf8',windowsHide:true}));
    await page.locator('#empty-library').click();
    const row=page.locator(`[data-library-id="${legacy}"]`);
    await row.getByRole('button',{name:'再解析',exact:true}).click();
    await expect(page.locator('#choose-mix')).toHaveText('mix.wav');
    await expect(page.locator('#import-mode')).toHaveValue('mix');
    await page.locator('#import-close').click();
    expect((await page.evaluate(()=>window.mixApp.history())).some(x=>x.id===legacy)).toBe(true);
    await page.locator('#empty-library').click();await row.getByRole('button',{name:'再解析',exact:true}).click();
    await page.locator('#import-submit').click();
    await expect(page.locator('#history-dialog')).toBeVisible({timeout:90000});
    const items=await page.evaluate(()=>window.mixApp.history());
    expect(items.some(x=>x.analysis_id==='e'.repeat(24))).toBe(false);
    expect(items.some(x=>x.analysis_id===result.id&&x.compatible)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await app.close();}
});
