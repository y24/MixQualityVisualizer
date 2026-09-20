const {resetSession}=require('./session-helpers.cjs');
const {test,expect,_electron}=require('@playwright/test');
const path=require('node:path');
test('each workspace owns its references and comparison ranges in the main panel',async()=>{
  resetSession();
  const app=await _electron.launch({args:[path.resolve(__dirname,'../..')],env:{...process.env,MQV_TEST_PROFILE:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  try{
    const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await expect(page.locator('#engine-status')).toContainText('Python',{timeout:30000});
    await page.evaluate(async()=>{
      sessionReady=false; // These synthetic UI-only IDs are not database entries.
      const request=await window.mixApp.demo();request.mode='mix';request.stems={};
      const r=await window.mixApp.analyze(request);
      window.workspaceFixtures={a:{...r,id:'workspace-a',name:'Mix A'},b:{...r,id:'workspace-b',name:'Mix B'},ref:{...r,id:'ref-shared',name:'Reference One'},ref2:{...r,id:'ref-second',name:'Reference Two'}};
      addResult(workspaceFixtures.a,'target');addResult(workspaceFixtures.ref,'reference');addResult(workspaceFixtures.ref2,'reference');
    });
    await expect(page.locator('#workspace-references')).toBeHidden();
    await expect(page.locator('#reference-prompt')).toBeHidden();
    await page.locator('[data-tab=references]').click();
    await expect(page.locator('#dashboard')).toBeHidden();
    await expect(page.locator('#workspace-references')).toBeVisible();
    await expect(page.locator('.sidebar #reference-list')).toHaveCount(0);
    await expect(page.locator('main #reference-list .track')).toHaveCount(2);
    await expect(page.locator('#reference-context')).toContainText('Mix A');
    const ref=page.locator('[data-reference-id="ref-shared"]');
    await ref.locator('input').first().fill('2');await ref.locator('input').last().fill('10');
    await ref.getByRole('button',{name:'区間を適用'}).click();
    await page.evaluate(()=>addResult(workspaceFixtures.b,'target'));
    await expect(page.locator('#reference-list .track')).toHaveCount(0);
    await page.locator('[data-tab=overview]').click();
    await expect(page.locator('#reference-prompt')).toBeVisible();
    await page.locator('#open-references').click();
    await expect(page.locator('#workspace-references')).toBeVisible();
    await page.evaluate(()=>addResult(workspaceFixtures.ref,'reference'));
    await ref.locator('input').first().fill('4');await ref.locator('input').last().fill('12');
    await ref.getByRole('button',{name:'区間を適用'}).click();
    await page.locator('#target-list').getByRole('button',{name:'Mix A',exact:true}).click();
    await expect(page.locator('#reference-list .track')).toHaveCount(2);
    await expect(ref.locator('input').first()).toHaveValue('2.00');
    await expect(ref.locator('input').last()).toHaveValue('10.00');
    await page.screenshot({path:'test-results/workspace-references.png'});
    await page.locator('[data-tab=overview]').click();
    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('#workspace-references')).toBeHidden();
    await expect(page.locator('#reference-prompt')).toBeHidden();
    await page.locator('[data-tab=references]').click();
    await ref.getByRole('button',{name:'外す',exact:true}).click();
    await expect(page.locator('#track-title')).toHaveText('Mix A');
    await page.locator('#target-list').getByRole('button',{name:'Mix B',exact:true}).click();
    await expect(page.locator('#reference-list .track')).toHaveCount(1);
    await expect(ref.locator('input').first()).toHaveValue('4.00');
    // Completion of a reference import stays attached to its initiating workspace.
    await page.evaluate(()=>addResult(workspaceFixtures.ref,'reference','workspace-a'));
    await expect(page.locator('#reference-context')).toContainText('Mix B');
    await page.locator('#reference-library').click();
    await expect(page.locator('#library-destination')).toContainText('Mix B');
    await expect(page.locator('#history-items').getByRole('button',{name:'ワークスペースに追加',exact:true})).toHaveCount(0);
    await page.locator('#history-close').click();
    await page.locator('#target-list .track.selected .workspace-remove').click();
    await expect(page.locator('#track-title')).toHaveText('Mix A');
    await expect(page.locator('#reference-list .track')).toHaveCount(2);
    await page.locator('#target-list .workspace-remove').click();
    await expect(page.locator('#workspace-references')).toBeHidden();
    await expect(page.locator('#empty')).toBeVisible();
    expect(errors).toEqual([]);
  }finally{await app.close();}
});
