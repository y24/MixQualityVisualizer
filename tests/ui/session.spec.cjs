const {test,expect,_electron}=require('@playwright/test');
const {resetSession}=require('./session-helpers.cjs');
const path=require('node:path');
test('restores workspaces, per-workspace references, ranges and tab after relaunch',async()=>{
  resetSession();let app;
  const launch=()=>_electron.launch({args:[path.resolve(__dirname,'../..')],env:{...process.env,MQV_TEST_PROFILE:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  try{
    app=await launch();let page=await app.firstWindow();
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    const ids=await page.evaluate(async()=>{
      const request=await api.demo();const a=await api.analyze(request);
      const b=await api.analyze({...request,mode:'mix',stems:{}});
      addResult(a,'target');addResult(b,'reference');state.ranges[b.id]=[2,10];render();
      addResult(b,'target');addResult(a,'reference');state.ranges[a.id]=[4,12];state.tab='references';render();
      await sessionSave;
      return {a:a.id,b:b.id};
    });
    await expect(page.locator('#target-list small')).toHaveCount(0);
    const height=await page.locator('#target-list .track').first().evaluate(el=>el.getBoundingClientRect().height);
    expect(height).toBeLessThan(45);
    // Library deletion must not discard a still-open workspace on relaunch.
    await page.evaluate(async id=>{const row=(await api.history()).find(x=>x.analysis_id===id);await api.removeHistory([row.id]);},ids.a);
    await app.close();app=await launch();page=await app.firstWindow();
    await page.waitForFunction(()=>typeof sessionReady!=='undefined'&&sessionReady);
    await expect(page.locator('#target-list .track')).toHaveCount(2);
    expect(await page.evaluate(()=>state.target.id)).toBe(ids.b);
    await expect(page.locator('#workspace-references')).toBeVisible();
    expect(await page.evaluate(()=>state.references.map(r=>r.id))).toEqual([ids.a]);
    expect(await page.evaluate(id=>state.ranges[id],ids.a)).toEqual([4,12]);
    await page.locator('#target-list .track>button:first-child').first().click();
    expect(await page.evaluate(()=>state.references.map(r=>r.id))).toEqual([ids.b]);
    expect(await page.evaluate(id=>state.ranges[id],ids.b)).toEqual([2,10]);
    await page.screenshot({path:'test-results/restored-workspaces.png'});
    await page.locator('#history').click();
    const all=await page.evaluate(()=>libraryItems.length);
    await page.locator('#library-compatible-only').check();
    const compatible=await page.evaluate(()=>libraryItems.filter(x=>x.compatible).length);
    await expect(page.locator('#history-items tr[data-library-id]')).toHaveCount(compatible);
    expect(compatible).toBeLessThanOrEqual(all);
    await page.locator('#history-close').click();await app.close();app=await launch();page=await app.firstWindow();
    await page.waitForFunction(()=>typeof sessionReady!=='undefined'&&sessionReady);await page.locator('#history').click();
    await expect(page.locator('#library-compatible-only')).toBeChecked();
    await expect(page.locator('#history-items')).not.toContainText('旧版・再解析が必要');
    await page.locator('#library-compatible-only').uncheck();await page.locator('#history-close').click();
    await page.locator('#target-list .workspace-remove').first().click();
    await page.locator('#target-list .workspace-remove').first().click();
    await page.evaluate(()=>sessionSave);await app.close();app=await launch();page=await app.firstWindow();
    await page.waitForFunction(()=>typeof sessionReady!=='undefined'&&sessionReady);await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#target-list .track')).toHaveCount(0);
  }finally{await app?.close();}
});

