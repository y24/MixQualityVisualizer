const {resetSession}=require('./session-helpers.cjs');
const {test,expect,_electron}=require('@playwright/test');
const path=require('node:path');
test('overview compares five domains, handles missing values and opens details',async()=>{
  resetSession();
  const app=await _electron.launch({args:[path.resolve(__dirname,'../..')],env:{...process.env,MQV_TEST_PROFILE:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await page.evaluate(async()=>{
      sessionReady=false;
      const request=await api.demo();request.mode='mix';request.stems={};
      const r=await api.analyze(request);
      const series={...r.series};
      for(const [, ,metrics] of overviewGroups)for(const [key] of metrics)series[key]=r.times.map((_,i)=>i<r.times.length/2?20:40);
      series.correlation=r.times.map(()=>0.72);
      series.vocals_db=r.times.map(()=>-4.9);series.drums_db=r.times.map(()=>-6.6);
      addResult({...r,id:'overview-target',name:'My Mix',series},'target');
      const refSeries=Object.fromEntries(Object.entries(series).map(([key,values])=>[key,values.map(v=>key==='correlation'?0.85:v-4)]));
      addResult({...r,id:'overview-ref',name:'Reference A',series:refSeries},'reference');
    });
    await expect(page.locator('.overview-group')).toHaveCount(5);
    await expect(page.locator('.overview-metric')).toHaveCount(10);
    await expect(page.locator('.timeline-panel')).toBeHidden();
    await expect(page.locator('#detail-panels')).toBeHidden();
    await expect(page.locator('[data-metric=low_pct] .difference')).toContainText('+4.0 pt');
    await expect(page.locator('[data-metric=correlation] .difference')).toContainText('-0.13');
    await expect(page.locator('.comparison-bar')).toHaveCount(10);
    const geometry=await page.evaluate(()=>{
      const low=document.querySelector('[data-metric=low_pct] .bar-target-fill');
      const ref=document.querySelector('[data-metric=low_pct] .bar-reference');
      const correlation=document.querySelector('[data-metric=correlation] .bar-reference');
      const starts=[...document.querySelectorAll('.metric-plot')].map(e=>e.getBoundingClientRect().x);
      return {lowX:Number(low.getAttribute('x')),lowWidth:Number(low.getAttribute('width')),refX:Number(ref.getAttribute('x1')),correlationX:Number(correlation.getAttribute('x1')),aligned:starts.every(x=>Math.abs(x-starts[0])<1)};
    });
    expect(geometry.lowX).toBe(2);expect(geometry.lowWidth).toBeCloseTo(118.8);expect(geometry.refX).toBeCloseTo(104.96);expect(geometry.correlationX).toBeCloseTo(368.3);expect(geometry.aligned).toBe(true);
    await page.screenshot({path:'test-results/overview-comparison.png',fullPage:true});
    await page.evaluate(()=>{
      window.savedVocal=state.target.series.vocals_db;
      state.target.series.vocals_db=state.target.times.map(()=>12);renderDashboard();
    });
    expect(Number(await page.locator('[data-metric=vocals_db] .bar-target-fill').getAttribute('width'))).toBeCloseTo(396);
    await expect(page.locator('[data-metric=drums_db] .metric-scale')).toHaveText('-24 → 12 dB');
    await page.evaluate(()=>{state.target.series.vocals_db=window.savedVocal;renderDashboard();});
    await page.locator('#range-end').fill('5');await page.locator('#range-apply').click();
    await expect(page.locator('[data-metric=low_pct] .target-value')).toHaveText('20.0 %');
    await page.locator('[data-category=spatial] button').click();
    await expect(page.locator('#overview-summary')).toBeHidden();
    await expect(page.locator('.timeline-panel')).toBeVisible();
    await expect(page.locator('#cards .card-reference')).toHaveCount(4);
    await expect(page.locator('#notes')).toBeHidden();
    await page.locator('[data-tab=overview]').click();
    await page.evaluate(()=>{state.references=[];state.target.series.vocals_db=[];renderDashboard();});
    await expect(page.locator('[data-metric=low_pct] .difference')).toHaveText('REF未設定');
    await expect(page.locator('.bar-reference')).toHaveCount(0);
    await expect(page.locator('.bar-target-fill')).toHaveCount(9);
    await expect(page.locator('[data-metric=vocals_db] .bar-target-fill')).toHaveCount(0);
    await expect(page.locator('[data-metric=vocals_db] .difference')).toHaveText('対象の測定値なし');
    await page.setViewportSize({width:1000,height:800});
    await page.screenshot({path:'test-results/overview-compact.png',fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await app.close();}
});
