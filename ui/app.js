'use strict';
const $ = id => document.getElementById(id);
const api = window.mixApp;
const state = { target:null, targets:[], references:[], tab:'overview', ranges:{}, busy:false, role:'target', pending:null, stems:{}, event:null, hardware:null, vocalRanges:{}, vocalModes:{}, rhythmSettings:{} };
// Reference membership and comparison ranges belong to the selected workspace.
const workspaceSettings=new Map();
function workspaceFor(id=state.target?.id){
  if(!id)return null;
  if(!workspaceSettings.has(id))workspaceSettings.set(id,{references:[],ranges:{}});
  return workspaceSettings.get(id);
}
Object.defineProperties(state,{
  references:{get:()=>workspaceFor()?.references||[],set:value=>{const workspace=workspaceFor();if(workspace)workspace.references=value;}},
  ranges:{get:()=>workspaceFor()?.ranges||{},set:value=>{const workspace=workspaceFor();if(workspace)workspace.ranges=value;}}
});
let sessionReady=false, lastSession='', sessionSave=Promise.resolve();
function sessionSnapshot(){
  const identity=r=>({id:r.id,source:r.source});
  return {selected:state.target?.id||null,tab:state.tab,workspaces:state.targets.map(track=>({track:identity(track),references:workspaceFor(track.id).references.map(identity),ranges:workspaceFor(track.id).ranges}))};
}
function persistSession(){
  if(!sessionReady||!api)return;
  const snapshot=sessionSnapshot(),encoded=JSON.stringify(snapshot);
  if(encoded===lastSession)return;
  lastSession=encoded;
  sessionSave=sessionSave.then(()=>api.saveSession(JSON.parse(encoded))).catch(error=>{lastSession='';notice('ワークスペースを保存できませんでした：'+error.message);});
}
async function restoreSession(){
  document.body.inert=true;
  try {
    const saved=await api.loadSession();
    if(saved.snapshot){
      const find=key=>saved.results.find(r=>r.id===key.id&&r.source===key.source);
      for(const workspace of saved.snapshot.workspaces){
        const track=find(workspace.track);if(!track)continue;
        addResult(track,'target');
        for(const key of workspace.references){const reference=find(key);if(reference)addResult(reference,'reference',track.id);}
        workspaceFor(track.id).ranges=workspace.ranges||{};
      }
      state.target=state.targets.find(r=>r.id===saved.snapshot.selected)||state.targets[0]||null;
      if([...document.querySelectorAll('#tabs button')].some(b=>b.dataset.tab===saved.snapshot.tab))state.tab=saved.snapshot.tab;
      render();refreshPlayer();
    }
    if(saved.warnings.length)notice('復元できなかった音源があります。ライブラリで再解析してください。\n'+saved.warnings.join('\n'));
    lastSession=JSON.stringify(sessionSnapshot());
  }catch(error){notice('前回のワークスペースを読み込めませんでした：'+error.message);}
  finally{sessionReady=true;document.body.inert=false;}
}
const names = {vocals:'ボーカル',drums:'ドラム',bass:'ベース',other:'その他'};
const sourceNames = {mix:'元ステレオ',mid:'Midのみ',side:'Sideのみ',mono:'モノラル',...names};
const number = (v,d=1) => typeof v==='number' && Number.isFinite(v) ? v.toFixed(d) : '—';
const valid = v => typeof v==='number' && Number.isFinite(v);
const median = values => { const a=values.filter(valid).sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2 : null; };
const text = (tag, content, cls='') => { const e=document.createElement(tag);e.textContent=content;if(cls)e.className=cls;return e; };
const duration = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function notice(message='') { $('notice').textContent=message;$('notice').hidden=!message; }
function range(track) { return state.ranges[track.id] || [0,track.duration]; }
function indices(track) { const [start,end]=range(track);return track.times.map((t,i)=>t>=start&&t<end ? i:-1).filter(i=>i>=0); }
function values(track,key) { const a=track.series[key]||[];return indices(track).map(i=>vocalValue(track,key,i,a[i])); }
function vocalValue(track,key,i,value,band=null) {
  if(!key.startsWith('vocals_')||state.vocalRanges[track.id]==null)return value;
  if(!VocalRanges.includes(state.vocalRanges[track.id],track.times[i]))return null;
  if(state.vocalModes[track.id]==='manual'&&track.vocal_ungated){
    return band==null?track.vocal_ungated.series[key]?.[i]:track.vocal_ungated.heatmaps[key]?.[i]?.[band];
  }
  return value;
}
$('vocal-mode').onchange=()=>{
  if(!state.target)return;
  try {localStorage.setItem('vocal-mode:'+state.target.id,$('vocal-mode').value);state.vocalModes[state.target.id]=$('vocal-mode').value;renderDashboard();}catch(e){notice(e.message);}
};
function saveVocalRanges(ranges) {
  localStorage.setItem('vocal-ranges:'+state.target.id,JSON.stringify(ranges));
  state.vocalRanges[state.target.id]=ranges;
  renderDashboard();
}
$('vocal-add').onclick=()=>{
  if(!state.target)return;
  try {
    if(!$('vocal-start').value.trim()||!$('vocal-end').value.trim())throw new Error('開始秒と終了秒を入力してください。');
    const ranges=VocalRanges.normalize([...(state.vocalRanges[state.target.id]||[]),[Number($('vocal-start').value),Number($('vocal-end').value)]],state.target.duration);
    $('vocal-error').textContent='';saveVocalRanges(ranges);
  }catch(e){$('vocal-error').textContent=e.message;}
};
$('vocal-auto').onclick=()=>{if(state.target){$('vocal-error').textContent='';saveVocalRanges(null);}};
function renderVocalEditor(r) {
  $('vocal-editor').hidden=state.tab!=='vocals'||!r.parts.vocals;
  const ranges=state.vocalRanges[r.id];
  $('vocal-mode').value=state.vocalModes[r.id]||'filter';
  $('vocal-mode').querySelector('[value=manual]').disabled=!r.vocal_ungated;
  $('vocal-mode').title=r.vocal_ungated?'':'手動復元を使用するには再解析してください。';
  $('vocal-status').textContent=ranges==null?'自動検出を使用中':ranges.length?`手動指定 ${ranges.length} 区間（比較区間との共通部分を集計）`:'手動指定：対象区間なし';
  $('vocal-ranges').replaceChildren();
  for(const [i,pair] of (ranges||[]).entries()){
    const row=text('div','','metric-row');row.append(text('span',`${pair[0].toFixed(2)} – ${pair[1].toFixed(2)} 秒`));
    const remove=text('button','削除','text-button');remove.onclick=()=>saveVocalRanges(ranges.filter((_,j)=>i!==j));row.append(remove);$('vocal-ranges').append(row);
  }
}
function transientData(track) { const band=$('transient-band').value;return band==='full'?track.transients:track.transients?.bands?.[band]; }
$('transient-band').onchange=()=>{if($('transient-band').value!=='full')$('transient-type').value='all';state.event=null;renderDashboard();};
$('transient-type').onchange=()=>{state.event=null;renderDashboard();};
const soundTypes={low_tonal:'低域・有音程型',broad_noise:'広帯域ノイズ型',high_noise:'高域ノイズ型',unknown:'複合・不明'};
function transientEvents(track){const type=$('transient-type').value;return (transientData(track)?.events||[]).filter(e=>$('transient-band').value!=='full'||type==='all'||(e.sound_type||'unknown')===type);}
function stat(track,key) {
  if(key.startsWith('event:')) return median(transientEvents(track).filter(e=>e.time>=range(track)[0]&&e.time<range(track)[1]).map(e=>e[key.slice(6)]));
  return median(values(track,key));
}
function refsFor(track) { return state.references.filter(r=>r.max_frequency===track.max_frequency&&r.version===track.version); }
function refStat(key) { return median(refsFor(state.target).map(r=>stat(r,key))); }
function setBusy(busy) { state.busy=busy;$('progress-panel').hidden=!busy;for(const id of ['add-target','add-reference','demo','empty-import','empty-library','history','reference-library'])$(id).disabled=busy; }
api?.onProgress(msg=>{ const percent=Math.max(0,Math.min(100,Math.round(msg.percent)));$('progress').value=percent;$('progress-percent').textContent=`${percent}%`;$('progress-message').textContent=msg.message; });

function addResult(result,role,workspaceId=state.target?.id) {
  if(role==='reference'&&!state.targets.some(track=>track.id===workspaceId))throw new Error('追加先のワークスペースを選択してください。');
  if(!(result.id in state.rhythmSettings)){
    try{const saved=JSON.parse(localStorage.getItem('rhythm:'+result.id));if(saved)Rhythm.beats(result.transients?.rhythm,result.duration,saved);state.rhythmSettings[result.id]=saved;}catch{state.rhythmSettings[result.id]=null;}
  }
  state.vocalModes[result.id]=localStorage.getItem('vocal-mode:'+result.id)==='manual'?'manual':'filter';
  if(!(result.id in state.vocalRanges)){
    try { const saved=JSON.parse(localStorage.getItem('vocal-ranges:'+result.id));state.vocalRanges[result.id]=saved==null?null:VocalRanges.normalize(saved,result.duration); }
    catch { state.vocalRanges[result.id]=null; }
  }
  if(role==='target') {
    state.target=result;
    const index=state.targets.findIndex(r=>r.id===result.id);
    if(index<0)state.targets.push(result);else state.targets[index]=result;
    workspaceFor(result.id);
  } else {
    const references=workspaceFor(workspaceId).references;
    if(!references.some(r=>r.id===result.id))references.push(result);
  }
  state.event=null;render();refreshPlayer();
}
async function analyze(request,role,workspaceId=state.target?.id) {
  notice();setBusy(true);$('progress').value=0;$('progress-percent').textContent='0%';$('progress-message').textContent='解析を開始しています';
  try {const result=await api.analyze(request);if(role==='library'){await $('history').onclick();}else addResult(result,role,workspaceId);}
  catch(e) {notice(e.message);}
  finally {setBusy(false);if(role==='library'&&$('history-dialog').open)renderLibrary();}
}
function openImport(role) {
  if(state.busy)return;
  if(role==='reference'&&!state.target)return;
  state.importWorkspaceId=state.target?.id;
  state.role=role;state.pending=null;state.stems={};state.reanalysisId=null;
  $('import-title').textContent=role==='target'?'解析する音源':'リファレンスを追加';
  $('choose-mix').textContent='＋ ミックス音源を選択';$('import-error').textContent='';
  drawStemFields();updateMode();$('import-dialog').showModal();
}
function drawStemFields() {
  $('stem-fields').replaceChildren(text('p','同じ開始位置・長さ・サンプルレートの4ファイルを指定します。','subtle'));
  for(const [key,label] of Object.entries(names)) {
    const button=text('button',label,'stem-button');button.type='button';button.append(text('span',state.stems[key]?.name||'ファイルを選択 ＋'));
    button.onclick=async()=>{const files=await api.chooseAudio(false);if(files.length){state.stems[key]=files[0];drawStemFields();}};
    $('stem-fields').append(button);
  }
}
function updateMode() { $('model-field').hidden=$('import-mode').value!=='separate';$('stem-fields').hidden=$('import-mode').value!=='stems'; }
function updateDeviceHint(){
  const hardware=state.hardware;if(!hardware)return;
  const chosen=$('device').value;
  if(chosen==='cpu')$('device-hint').textContent='音源分離をCPUで実行します。GPUは使用しません。';
  else if(hardware.cuda){
    const gpu=hardware.gpus.find(g=>g.id===chosen)||hardware.gpus[0];
    $('device-hint').textContent=`${chosen==='auto'?'自動選択：':''}${gpu.name} / VRAM ${gpu.memory_gb} GB。音源分離にGPUを使い、帯域などの数値解析はCPUで行います。`;
  }else $('device-hint').textContent=`自動選択：CPU。${hardware.cuda_reason||'CUDA対応GPUを利用できません。'}`;
}
function displayHardware(hardware){
  state.hardware=hardware;
  const selected=localStorage.getItem('separation-device')||$('device').value;
  $('device').replaceChildren();
  for(const [id,label] of [['auto','自動（GPUを優先）'],['cpu','CPU'],...hardware.gpus.map(g=>[g.id,`GPU：${g.name} (${g.memory_gb} GB)`])]){const option=text('option',label);option.value=id;$('device').append(option);}
  if([...$('device').options].some(o=>o.value===selected))$('device').value=selected;
  else $('device').value='auto';
  $('engine-status').textContent=`Python ${hardware.python} · ${hardware.cuda?'CUDA '+hardware.cuda_version+' / '+hardware.gpus[0].name:'CPUのみ'} / ${hardware.model_ready?'モデル保存済み':'初回分離時にモデル取得'}`;
  updateDeviceHint();
}
$('device').onchange=()=>{localStorage.setItem('separation-device',$('device').value);updateDeviceHint();};
$('add-target').onclick=()=>openImport('target');$('empty-import').onclick=()=>openImport('target');$('add-reference').onclick=()=>openImport('reference');
$('choose-mix').onclick=async()=>{try{const files=await api.chooseAudio(false);if(files.length){state.pending=files[0];$('choose-mix').textContent=files[0].name;}}catch(e){$('import-error').textContent=e.message;}};
$('import-mode').onchange=updateMode;$('import-close').onclick=()=>$('import-dialog').close();
$('import-form').onsubmit=e=>{
  e.preventDefault();
  if(!state.pending){$('import-error').textContent='ミックス音源を選んでください。';return;}
  if($('import-mode').value==='stems'&&Object.keys(state.stems).length!==4){$('import-error').textContent='4つのステムを指定してください。';return;}
  const request={libraryId:state.reanalysisId,path:state.pending.path,mode:$('import-mode').value,model:$('model').value,device:$('device').value,stems:Object.fromEntries(Object.entries(state.stems).map(([k,v])=>[k,v.path]))};
  $('import-dialog').close();analyze(request,state.role,state.importWorkspaceId);
};
$('cancel').onclick=()=>api.cancel();
$('demo').onclick=async()=>{try{await analyze(await api.demo(),'target');}catch(e){notice(e.message);}};
let libraryRole=null, libraryWorkspaceId=null;
let libraryItems=[], libraryPlaying=null, libraryRequest=0, libraryDeleting=false;
const librarySelected=new Set();
let librarySort={key:null,direction:1};
function visibleLibraryItems() {
  const query=$('library-search').value.trim().toLocaleLowerCase();
  const items=libraryItems.filter(item=>(!$('library-compatible-only').checked||item.compatible)&&`${item.name} ${item.source}`.toLocaleLowerCase().includes(query));
  const {key,direction}=librarySort;
  if(key)items.sort((a,b)=>{
    const value=item=>key==='name'?item.name:key==='duration'?item.duration:item.summary[key]?.median;
    const av=value(a),bv=value(b),missing=v=>key==='name'?v==null:!valid(v);
    if(missing(av)||missing(bv))return Number(missing(av))-Number(missing(bv));
    return direction*(key==='name'?av.localeCompare(bv,'ja',{numeric:true}):av-bv);
  });
  return items;
}
function updateLibrarySelection() {
  const items=visibleLibraryItems(), selected=items.filter(item=>librarySelected.has(item.id)).length;
  $('library-select-all').checked=items.length>0&&selected===items.length;
  $('library-select-all').indeterminate=selected>0&&selected<items.length;
  $('library-select-all').disabled=libraryDeleting||!items.length;
  $('library-selected').textContent=librarySelected.size?`${librarySelected.size} 曲選択中`:'';
  $('library-delete').disabled=libraryDeleting||!librarySelected.size;
}
function renderLibrary() {
  const items=visibleLibraryItems();
  updateLibrarySelection();
  document.querySelectorAll('.library-sort').forEach(button=>{const active=button.dataset.sort===librarySort.key;button.parentElement.setAttribute('aria-sort',active?(librarySort.direction===1?'ascending':'descending'):'none');button.querySelector('span').textContent=active?(librarySort.direction===1?' ↑':' ↓'):' ↕';});
  $('history-items').replaceChildren();$('library-count').textContent=`${items.length} / ${libraryItems.length} 音源`;
  if(!items.length){const row=text('tr'),cell=text('td',libraryItems.length?'一致する音源がありません。':'まだ解析済みの音源はありません。');cell.colSpan=10;row.append(cell);$('history-items').append(row);}
  for(const item of items){
    const row=text('tr');row.dataset.libraryId=item.id;
    const check=text('input');check.type='checkbox';check.checked=librarySelected.has(item.id);check.disabled=libraryDeleting;
    check.setAttribute('aria-label',`${item.name} を選択`);
    check.onchange=()=>{if(check.checked)librarySelected.add(item.id);else librarySelected.delete(item.id);updateLibrarySelection();};
    const selection=text('td','','library-check');selection.append(check);row.append(selection);
    const play=text('button',libraryPlaying===item.id&&!$('library-audio').paused?'⏸':'▶','secondary small');
    play.setAttribute('aria-label',`${item.name} を再生 / 一時停止`);play.disabled=!item.compatible;
    play.onclick=async()=>{
      const request=++libraryRequest;
      try {
        $('library-error').textContent='';
        if(libraryPlaying===item.id&&!$('library-audio').paused){$('library-audio').pause();return;}
        if(libraryPlaying!==item.id){
          const result=await api.loadHistory(item.id);
          if(request!==libraryRequest||!$('history-dialog').open)return;
          $('library-audio').src=result.media.mix;libraryPlaying=item.id;
          $('library-playing').textContent=item.name;
        }
        $('audio').pause();await $('library-audio').play();
      }catch(e){$('library-error').textContent=e.message;}
    };
    const player=text('td');player.append(play);row.append(player);
    const name=text('td','','library-name');name.append(text('strong',item.name),text('small',item.source));name.title=item.source;row.append(name,text('td',duration(item.duration)));
    for(const key of ['vocals_db','drums_db','low_pct','side_pct'])row.append(text('td',number(item.summary[key]?.median)));
    row.append(text('td',`${item.mode==='mix'?'元音源のみ':item.mode==='stems'?'入力ステム':'自動分離'}${!item.compatible?' / 旧版・再解析が必要':''}${!item.sourceExists?' / 元ファイルなし':''}`));
    const actions=text('td','','library-actions');
    if(!item.compatible){
      const reanalyze=text('button','再解析','reanalyze-button small');reanalyze.disabled=state.busy;
      reanalyze.onclick=async()=>{
        try {
          const prepared=await api.prepareHistoryAnalysis(item.id);
          $('history-dialog').close();openImport('library');
          state.reanalysisId=item.id;state.pending=prepared.source;state.stems=prepared.stems;
          $('import-title').textContent='ライブラリの音源を再解析';
          $('choose-mix').textContent=prepared.source?.name||'＋ 元音源を選び直す';
          $('import-mode').value=prepared.mode;
          if(prepared.model)$('model').value=prepared.model;
          if([...$('device').options].some(option=>option.value===prepared.device))$('device').value=prepared.device;
          drawStemFields();updateMode();updateDeviceHint();
          $('import-error').textContent=!prepared.source?'元音源が見つかりません。移動先の音源を選択してください。':prepared.mode==='stems'&&Object.keys(prepared.stems).length!==4?'以前の入力ステムのパスが未保存、またはファイルが見つかりません。4ステムを選び直してください。':'';
        }catch(e){$('library-error').textContent=e.message;}
      };actions.append(reanalyze);
    }
    for(const [role,label] of (item.compatible?(libraryRole==='reference'?[['reference','リファレンスに追加']]:[['target','ワークスペースに追加'],['reference','リファレンスに追加']]):[])){
      const button=text('button',role==='target'?'＋ WS':'＋ REF','secondary small');button.setAttribute('aria-label',label);button.title=label;button.disabled=!item.compatible||(role==='reference'&&!state.targets.some(track=>track.id===libraryWorkspaceId));
      button.onclick=async()=>{try{addResult(await api.loadHistory(item.id),role,libraryWorkspaceId);$('history-dialog').close();}catch(e){$('library-error').textContent=e.message;}};actions.append(button);
    }
    row.append(actions);$('history-items').append(row);
  }
}
async function openLibrary(role=null){
  libraryRole=role;libraryWorkspaceId=state.target?.id;
  $('library-destination').textContent=state.target?`リファレンスの追加先：${state.target.name}`:'リファレンスを追加するにはワークスペースを選択してください。';
  try {libraryItems=await api.history();librarySelected.clear();$('library-search').value='';$('library-error').textContent='';renderLibrary();$('history-dialog').showModal();}
  catch(e){notice(e.message);}
};
$('history').onclick=()=>openLibrary();
$('empty-library').onclick=()=>openLibrary();
$('reference-library').onclick=()=>openLibrary('reference');
$('library-compatible-only').checked=localStorage.getItem('library-compatible-only')==='true';
$('library-compatible-only').onchange=()=>{localStorage.setItem('library-compatible-only',String($('library-compatible-only').checked));renderLibrary();};
$('library-search').oninput=renderLibrary;
$('library-select-all').onchange=()=>{for(const item of visibleLibraryItems()){if($('library-select-all').checked)librarySelected.add(item.id);else librarySelected.delete(item.id);}renderLibrary();};
document.querySelectorAll('.library-sort').forEach(button=>button.onclick=()=>{const key=button.dataset.sort;librarySort={key,direction:librarySort.key===key?-librarySort.direction:1};renderLibrary();});
$('library-delete').onclick=async()=>{
  if(libraryDeleting||!librarySelected.size)return;
  const ids=[...librarySelected];libraryDeleting=true;renderLibrary();
  try {
    await api.removeHistory(ids);
    libraryRequest++;
    if(ids.includes(libraryPlaying)){$('library-audio').pause();$('library-audio').removeAttribute('src');$('library-audio').load();libraryPlaying=null;$('library-playing').textContent='▶ で試聴';}
    libraryItems=libraryItems.filter(item=>!ids.includes(item.id));librarySelected.clear();
    $('library-error').textContent='';
  }catch(e){$('library-error').textContent=e.message;}
  finally {libraryDeleting=false;renderLibrary();}
};
for(const event of ['play','pause','ended'])$('library-audio').addEventListener(event,renderLibrary);
$('library-audio').onerror=()=>{$('library-error').textContent='音源を再生できません。試聴キャッシュを確認するか、再解析してください。';};
$('history-close').onclick=()=>$('history-dialog').close();
$('history-dialog').addEventListener('close',()=>{libraryRequest++;$('library-audio').pause();});
$('export').onclick=async()=>{
  try {
    const strip=r=>{const {media,...data}=r;return data;};
    await api.export({target:strip(state.target),references:state.references.map(strip),ranges:state.ranges,transient_band:$('transient-band').value,transient_type:$('transient-type').value,vocal_ranges:state.vocalRanges,vocal_modes:state.vocalModes,envelope_comparison:{mode:$('envelope-mode').value,reference_id:$('envelope-reference').value,reference_time:referenceEvent?.time??null,target_time:state.event?.time??null},rhythm_settings:state.rhythmSettings,exported_at:new Date().toISOString()});
  }catch(e){notice(e.message);}
};
$('open-references').onclick=()=>{state.tab='references';state.event=null;renderDashboard();};
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.event=null;renderDashboard();});
$('component').onchange=renderDashboard;$('time-window').onchange=renderDashboard;$('spatial-metric').onchange=renderDashboard;
$('range-apply').onclick=()=>{
  if(!state.target)return;
  const a=Number($('range-start').value),b=Number($('range-end').value);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>state.target.duration+.01||b-a<.4){notice('0.4秒以上で、音源の長さ以内の区間を指定してください。');return;}
  state.ranges[state.target.id]=[a,b];state.event=null;notice();renderDashboard();
};
$('range-reset').onclick=()=>{if(state.target){delete state.ranges[state.target.id];renderDashboard();}};

function structureTrack(){return [state.target,...state.references].find(r=>r?.id===$('structure-track').value);}
function structureSegment(){return structureTrack()?.structure?.segments[Number($('structure-segment').value)];}
$('structure-track').onchange=()=>renderStructure(true);
$('structure-panel').ontoggle=()=>{if($('structure-panel').open)renderStructure();};
$('structure-apply').onclick=()=>{
  const track=structureTrack(),segment=structureSegment();if(!track||!segment)return;
  state.ranges[track.id]=[segment.start,segment.end];state.event=null;render();
  notice(`${track.name} の比較区間を ${segment.start.toFixed(2)}–${segment.end.toFixed(2)} 秒に設定しました。`);
};
$('structure-listen').onclick=()=>{const segment=structureSegment();if(segment)seekTrack(structureTrack(),segment.start);};
function renderStructure(reset=false){
  const selected=$('structure-track').value, previous=$('structure-segment').value;
  const tracks=[state.target,...state.references].filter(Boolean);
  $('structure-track').replaceChildren();
  for(const r of tracks){const option=text('option',`${r===state.target?'対象':'REF'} · ${r.name}`);option.value=r.id;$('structure-track').append(option);}
  if(tracks.some(r=>r.id===selected))$('structure-track').value=selected;
  const track=structureTrack(),data=track?.structure;
  $('structure-segment').replaceChildren();
  for(const [i,segment] of (data?.segments||[]).entries()){
    const option=text('option',`${i+1} · ${duration(segment.start)}–${duration(segment.end)} (${segment.start.toFixed(1)}–${segment.end.toFixed(1)} 秒)`);option.value=i;$('structure-segment').append(option);
  }
  if(!reset&&previous!==''&&Number(previous)<(data?.segments.length||0))$('structure-segment').value=previous;
  const available=!!data?.segments.length;
  for(const id of ['structure-segment','structure-apply','structure-listen'])$(id).disabled=!available;
  $('structure-status').textContent=!data?'候補データがありません。再解析すると表示されます。':data.status==='insufficient'?'8秒未満のため判定対象外です。':`${data.boundaries.length} 件の変化点候補 · 選択中の比較区間 ${range(track)[0].toFixed(1)}–${range(track)[1].toFixed(1)} 秒${data.boundaries.length?'':' · 明確な変化点を検出しませんでした'}`;
  if(!$('structure-panel').open)return;
  const chart=surface('structure-chart'),{ctx,w,h}=chart;
  if(!data){blank(chart,'候補データなし');return;}
  ctx.strokeStyle='#76c6bb';ctx.beginPath();
  data.times.forEach((t,i)=>{const x=35+t/track.duration*(w-45),y=h-25-data.novelty[i]*(h-40);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
  ctx.fillStyle='#8996a5';ctx.fillText('1',10,15);ctx.fillText('0',10,h-25);ctx.fillText('0:00',35,h-5);ctx.textAlign='right';ctx.fillText(duration(track.duration),w-10,h-5);
  ctx.strokeStyle='#f1ba73';for(const boundary of data.boundaries){const x=35+boundary.time/track.duration*(w-45);ctx.beginPath();ctx.moveTo(x,15);ctx.lineTo(x,h-25);ctx.stroke();}
}

function renderTracks() {
  $('target-list').replaceChildren();$('reference-list').replaceChildren();
  $('workspace-count').textContent=state.targets.length;
  $('reference-context').textContent=state.target?`${state.target.name} と比較する音源 · ${state.references.length} 曲`:'';
  for(const track of state.targets){
    const row=text('div','',`track${track.id===state.target?.id?' selected':''}`);
    const select=text('button',track.name,'text-button');select.onclick=()=>{state.target=track;state.event=null;render();refreshPlayer();};
    const remove=text('button','×','workspace-remove');remove.title='ワークスペースから外す';remove.setAttribute('aria-label',`${track.name} をワークスペースから外す`);
    remove.onclick=()=>{
      state.targets=state.targets.filter(r=>r.id!==track.id);
      workspaceSettings.delete(track.id);
      if(state.target?.id===track.id)state.target=state.targets[0]||null;
      state.event=null;render();refreshPlayer();
    };
    select.title=track.name;row.append(select,remove);$('target-list').append(row);
  }
  if(!state.targets.length)$('target-list').append(text('p','ミックスを選択してください','quiet'));
  for(const r of state.references){
    const row=text('div','','track reference-track');row.dataset.referenceId=r.id;
    const info=text('div','','reference-info');info.append(text('strong',r.name),text('small',`${duration(r.duration)} · ${r.mode==='mix'?'元音源のみ':r.mode==='stems'?'入力ステム':'自動分離'}`));row.append(info);
    const controls=text('div','','reference-controls');
    const start=text('input'),end=text('input');
    for(const [input,label,value] of [[start,'開始',range(r)[0]],[end,'終了',range(r)[1]]]){
      input.type='number';input.min=0;input.max=r.duration;input.step=.1;input.value=value.toFixed(2);input.setAttribute('aria-label',`${r.name} の比較区間 ${label}秒`);
      const field=text('label',label+' ');field.append(input,text('span',' 秒'));controls.append(field);
    }
    const apply=text('button','区間を適用','secondary small');apply.onclick=()=>{
      const a=Number(start.value),b=Number(end.value);
      if(!start.value.trim()||!end.value.trim()||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>r.duration||a>=b){notice('比較区間は開始 < 終了で、曲の長さの範囲内に指定してください。');return;}
      state.ranges[r.id]=[a,b];notice();render();
    };
    const listen=text('button','▶ 試聴','text-button');listen.onclick=()=>{seekTrack(r,range(r)[0]);$('audio').play().catch(e=>notice(e.message));};
    const remove=text('button','外す','text-button');remove.onclick=()=>{state.references=state.references.filter(x=>x.id!==r.id);render();refreshPlayer();};
    const wave=text('button','波形で区間を選択','secondary small');wave.onclick=()=>openWaveform(r);
    controls.append(wave,apply,listen,remove);row.append(controls);$('reference-list').append(row);
  }
  if(!state.references.length)$('reference-list').append(text('p','比較したい音源を追加してください。リファレンスはこのワークスペースにだけ追加されます。','quiet'));

}
function render() {renderTracks();renderDashboard();}
const views={

  vocals:{cards:[['vocals_db','声と伴奏のバランス','dB','歌声活動区間の相対レベル'],['vocals_competition','帯域競合率','%','声の有効帯域をエネルギーで重み付け'],['vocals_mid_competition','Mid内の競合','%','Midの声 対 Midの伴奏'],['vocals_side_competition','Side内の競合','%','Sideの声がない区間は対象外']],line:'vocals_db',title:'ボーカルの相対音量',description:'歌声を検出した区間の相対レベルを表示します。',heat:'vocals_competition',heatTitle:'ボーカルの帯域競合',detail:'vocals'},
  drums:{cards:[['drums_db','ドラムの相対音量','dB','非ドラムに対するレベル'],['event:attack_ms','立ち上がり時間','ms','振幅包絡の10% → 90%'],['event:attack_body_db','アタック／ボディ比','dB','0–30 ms 対 50–150 ms'],['event:decay_ms','減衰時間','ms','ピークから−20 dBまで']],line:'drums_db',title:'ドラムの相対音量',description:'持続的な音量と一打の形を分けて確認します。',heat:'drums_competition',heatTitle:'ドラムと他パートの競合',detail:'drums'},
  bass:{cards:[['bass_db','ベースの相対音量','dB','非ベースに対するレベル'],['low_pct','低域の比率','%','20–200 Hz / 全解析帯域'],['sub_pct','サブ低域の比率','%','20–60 Hz / 全解析帯域'],['bass_competition','ベースの帯域競合','%','ベースの有効帯域で他パートが優勢な割合']],line:'low_pct',title:'低域が全体を占める割合',description:'元音源の全帯域に占める20–200 Hzのエネルギー比。',heat:'bass_competition',heatTitle:'ベースと他パートの競合',detail:'low'},
  spatial:{cards:[['side_pct','Sideの比率','%','左右差成分のエネルギー比'],['sm_db','Side / Mid','dB','正値はSide優勢'],['correlation','左右相関','','遅延0・400 ms窓'],['mono_db','モノラル合成差','dB','元のL/R平均パワーが基準']],line:'side_pct',title:'Side比率の時間変化',description:'左右への偏りでも比率は変化します。相関と左右バランスを併せて確認。',heat:'side_pct',heatTitle:'帯域ごとのSide比率',detail:'spatial'},
  density:{cards:[['density_pct','時間・周波数の占有度','%','−23 LUFS換算 / ERB帯域'],['congestion_pct','分離パート間の競合','%','最大パートから12 dB以内が2つ以上'],['vocals_competition','声と伴奏の競合','%','声の有効帯域に限定'],['drums_competition','ドラムと他の競合','%','ドラムの有効帯域で他パートが優勢な割合']],line:'density_pct',title:'時間・周波数の占有度',description:'一定水準以上の音が存在する帯域の割合を表示します。',heat:'spectrum_db',heatTitle:'音が存在する帯域',detail:'density'}
};
const overviewGroups=[
  ['vocals','ボーカル',[['vocals_db','相対音量','dB'],['vocals_competition','伴奏との競合','%']]],
  ['drums','ドラム',[['drums_db','相対音量','dB'],['drums_competition','他パートとの競合','%']]],
  ['bass','低域',[['low_pct','低域の比率','%'],['sub_pct','サブ低域の比率','%']]],
  ['spatial','M/S・音像',[['side_pct','Sideの比率','%'],['correlation','左右相関','']]],
  ['density','密集度・競合',[['density_pct','時間・周波数の占有度','%'],['congestion_pct','パート間の競合','%']]]
];
function comparison(key,unit){
  const value=stat(state.target,key),reference=refStat(key),digits=key==='correlation'?2:1;
  const delta=valid(value)&&valid(reference)?Number((value-reference).toFixed(digits)):null;
  return {value,reference,delta,digits,deltaUnit:unit==='%'?'pt':unit};
}
function deltaLabel(c){
  if(!valid(c.value))return '対象の測定値なし';
  if(!valid(c.reference))return state.references.length?'比較可能なREFなし':'REF未設定';
  return `${c.delta>0?'+':''}${number(c.delta,c.digits)} ${c.deltaUnit}`.trim();
}
function overviewScales(){
  // Absolute ranges shared by metrics with the same unit. Expand dB for outliers.
  const scales={dB:[-24,0],pt:[0,100],'':[-1,1]};
  for(const [, ,metrics] of overviewGroups)for(const [key,,unit] of metrics){
    if(unit!=='dB')continue;
    const c=comparison(key,unit);
    for(const value of [c.value,c.reference])if(valid(value)){
      scales.dB[0]=Math.min(scales.dB[0],Math.floor(value/6)*6);
      scales.dB[1]=Math.max(scales.dB[1],Math.ceil(value/6)*6);
    }
  }
  return scales;
}
function comparisonBar(c,scale,label,unit){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 400 24');svg.setAttribute('preserveAspectRatio','none');svg.classList.add('comparison-bar');
  svg.setAttribute('role','img');svg.setAttribute('aria-label',`${label}：対象 ${number(c.value,c.digits)} ${unit}、REF ${number(c.reference,c.digits)} ${unit}。表示範囲 ${scale[0]}〜${scale[1]} ${unit}`);
  const shape=(tag,attributes)=>{const node=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);svg.append(node);};
  const position=value=>2+Math.max(0,Math.min(1,(value-scale[0])/(scale[1]-scale[0])))*396;
  shape('rect',{x:2,y:6,width:396,height:12,rx:3,class:'bar-track'});
  if(valid(c.value))shape('rect',{x:2,y:6,width:position(c.value)-2,height:12,rx:3,class:'bar-target-fill'});
  if(valid(c.reference)){
    const x=position(c.reference);
    shape('line',{x1:x,x2:x,y1:1,y2:23,class:'bar-reference'});
  }
  return svg;
}
function renderOverview(){
  const root=$('overview-summary');root.replaceChildren();
  const heading=text('div','','overview-heading'),title=text('div');
  title.append(text('h2','ミックス全体を見渡す'));
  const manage=text('button','比較する曲を選ぶ →','secondary small');manage.onclick=()=>{state.tab='references';renderDashboard();};heading.append(title,manage);root.append(heading);
  const refs=refsFor(state.target),context=text('p',refs.length?`比較基準：${refs.map(r=>r.name).join(' / ')}${refs.length>1?'（各曲の中央値を等重みで集約）':''}`:'リファレンスを追加すると、各指標の差を表示します。','comparison-context');root.append(context);
  if(state.references.length>refs.length)root.append(text('p',`解析条件が異なる ${state.references.length-refs.length} 曲を比較から除外しています。`,'comparison-context'));
  const scales=overviewScales(),legend=text('div','','overview-legend');
  const legendRail=text('div','','overview-legend-rail');legendRail.append(text('span','対象','target-legend'),text('span','REF','ref-legend'));legend.append(text('span','指標','legend-label'),legendRail,text('span','REFとの差','legend-difference'));root.append(legend);
  for(const [tab,label,metrics] of overviewGroups){
    const group=text('section','','overview-group');group.dataset.category=tab;
    const link=text('button',label+' →','overview-link');link.onclick=()=>{state.tab=tab;renderDashboard();};group.append(link);
    const rows=text('div','','overview-metrics');
    for(const [key,label,unit] of metrics){
      const c=comparison(key,unit),row=text('div','','overview-metric');row.dataset.metric=key;
      const scale=scales[c.deltaUnit],name=text('div','','metric-identity');name.append(text('strong',label),text('span',`${scale[0]} → ${scale[1]} ${unit}`,'metric-scale'));row.append(name);
      const plot=text('div','','metric-plot');plot.append(comparisonBar(c,scale,label,unit));
      const values=text('div','','metric-values'),targetValue=text('span'),referenceValue=text('span');
      targetValue.append(text('span','対象 '),text('span',`${number(c.value,c.digits)} ${unit}`,'target-value'));
      referenceValue.append(text('span','REF '),text('span',`${number(c.reference,c.digits)} ${unit}`,'reference-value'));values.append(targetValue,referenceValue);plot.append(values);row.append(plot);
      const delta=text('div','','difference');delta.append(text('strong',deltaLabel(c),valid(c.delta)?'':'unavailable'));
      if(valid(c.delta))delta.append(text('span',c.delta>0?'REFより高い':c.delta<0?'REFより低い':'REFと同じ'));
      row.append(delta);rows.append(row);
    }
    group.append(rows);root.append(group);
  }
  root.append(text('p','選択区間の中央値を比較 · pt = パーセントポイント','overview-scale'));
}
function renderDashboard() {
  persistSession();
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
  const r=state.target,referenceTab=state.tab==='references';
  $('empty').hidden=!!r;$('dashboard').hidden=!r||referenceTab;$('export').disabled=!r;
  $('workspace-references').hidden=!r||!referenceTab;
  $('reference-prompt').hidden=!r||state.references.length>0||referenceTab;
  document.querySelector('[data-tab="references"]').disabled=!r;
  if(!r){$('track-title').textContent='ミックス解析';$('track-meta').textContent='解析する音源を選択してください';return;}
  $('track-title').textContent=r.name;
  $('track-meta').textContent=`${duration(r.duration)}  /  ${(r.metadata.source_sample_rate/1000).toFixed(1)} kHz  /  ${r.metadata.source_channels===1?'MONO':'STEREO'}  /  ${number(r.loudness_lufs)} LUFS  /  ${r.model||'入力音源'}${r.device?' · '+(r.device_label||r.device.toUpperCase())+'で分離':''}${r.cached?' / 保存済み解析':r.separation_cached?' / 保存済み分離ステム':''}`;
  if(referenceTab)return;
  const overview=state.tab==='overview';
  $('overview-summary').hidden=!overview;
  for(const element of [$('cards'),document.querySelector('.timeline-panel'),$('detail-panels'),$('measurement-notes')])element.hidden=overview;
  $('structure-panel').hidden=overview;
  const v=views[state.tab];
  $('range-start').value=range(r)[0].toFixed(2);$('range-end').value=range(r)[1].toFixed(2);$('range-end').max=r.duration;
  renderVocalEditor(r);
  renderStructure();
  $('cards').replaceChildren();
  if(overview){$('rhythm-panel').hidden=true;$('transient-panel').hidden=true;renderOverview();return;}
  for(const [key,label,unit,note] of v.cards){
    const value=stat(r,key),reference=refStat(key),card=text('div','','card');card.append(text('div',label,'card-label'));
    const num=text('div',number(value,key==='correlation'?2:1),'card-number');num.append(text('small',unit));card.append(num);
    const c=comparison(key,unit),delta=text('div',deltaLabel(c),'card-delta '+(c.delta>0?'higher':c.delta<0?'lower':'equal'));
    delta.append(text('span',`REF ${number(reference,c.digits)} ${unit}`,'card-reference'));card.append(delta,text('div',key.startsWith('event:')?`${$('transient-band').selectedOptions[0].textContent} / ${$('transient-type').value==='all'?'全タイプ':soundTypes[$('transient-type').value]} · ${note}`:key.startsWith('vocals_')&&state.vocalRanges[r.id]!=null?'手動指定区間 · '+note:note,'card-note'));$('cards').append(card);
  }
  $('timeline-title').textContent=v.title;$('timeline-description').textContent=v.description;
  $('time-window').hidden=!['vocals_db','drums_db','bass_db'].includes(v.line);
  let key=v.line;if(!$('time-window').hidden&&$('time-window').value==='short')key=key.replace('_db','_short_db');
  drawTimeline(r,key);
  const component=$('component').value;
  $('component').hidden=!v.heat.endsWith('_competition');
  $('spatial-metric').hidden=state.tab!=='spatial';
  let heat=state.tab==='spatial'?$('spatial-metric').value:v.heat;if(!$('component').hidden&&component!=='stereo')heat=heat.replace('_competition',`_${component}_competition`);
  $('heatmap-title').textContent=v.heatTitle;$('heatmap-description').textContent=heat.includes('competition')?'声・パートの存在する帯域に限定 / 伴奏優勢ほど暖色':heat==='side_pct'?'和成分に対する左右差成分の割合':'重み付けなしのスペクトルパワー';
  if(heat==='mono_db'){$('heatmap-title').textContent='帯域別のモノラル合成差';$('heatmap-description').textContent='L/R平均パワーからの変化 / 完全キャンセルは比率未定義';}
  if(heat==='band_correlation'){$('heatmap-title').textContent='帯域別の左右相関';$('heatmap-description').textContent='同一STFT窓の帯域パワー・交差パワーから算出';}
  drawHeatmap(r,heat);
  renderDetail(r,v.detail);
  renderRhythm(r);
  $('transient-panel').hidden=state.tab!=='drums'||!r.transients;
  if(!$('transient-panel').hidden)drawTransients(r);
  $('notes').replaceChildren();
  const lines=[...r.warnings];
  if(state.references.some(x=>x.max_frequency!==r.max_frequency))lines.push('周波数上限の違うリファレンスは数値比較から除外しています。');
  if(state.tab==='spatial')lines.push('Midは左右の和、Sideは左右の差を表します。Side比率は左右の偏りでも変化するため、左右相関と併せて確認してください。Midとモノラルの試聴は同じゲインです。');
  if(state.tab==='drums')lines.push('打音タイプは音の帯域と形状から推定しています。帯域・タイプの選択は打音カードと散布図、REF比較に適用します。立ち上がりや減衰は帯域フィルターの影響を含みます。連打が重なる打音は一部の測定から除外します。');
  if(state.tab==='density')lines.push('占有度は各曲全体を−23 LUFS相当に換算して測定します。パート間の競合は分離した4パート単位で集計します。');
  for(const line of lines)$('notes').append(text('p',line));
  $('method').replaceChildren(text('p',`解析バージョン ${r.version} · 共通解析レート44.1 kHz · Hann 4096点 / 50 ms間隔 / ERB 32帯域 · 比率は選択区間内のフレーム中央値。リファレンスは各曲の中央値を等重みで集約。区間端では窓が選択範囲の外を含む場合があります。`),text('p','楽器別の比率はK特性400 ms / 3秒。低域・M/Sは重み付けなし。活動判定は95パーセンタイルから−35 dB、最低−100 dBFSパワー。帯域競合は対象の有効帯域で他パートが上回る割合。聴感検証前の指標です。'));
}

function rhythmBeats(r){return Rhythm.beats(r.transients?.rhythm,r.duration,state.rhythmSettings[r.id]).filter(b=>b.time>=range(r)[0]&&b.time<range(r)[1]);}
function saveRhythm(settings){
  const r=state.target;if(!r)return;
  try{Rhythm.beats(r.transients?.rhythm,r.duration,settings);localStorage.setItem('rhythm:'+r.id,JSON.stringify(settings));state.rhythmSettings[r.id]=settings;notice();renderDashboard();}catch(e){notice(e.message);}
}
$('rhythm-apply').onclick=()=>{
  if(!$('rhythm-bpm').value||!$('rhythm-offset').value){notice('BPMと最初の拍を入力してください。');return;}
  saveRhythm({bpm:Number($('rhythm-bpm').value),offset:Number($('rhythm-offset').value)});
};
$('rhythm-mode').onchange=()=>saveRhythm($('rhythm-mode').value==='adaptive'?{mode:'adaptive'}:null);
$('rhythm-auto').onclick=()=>saveRhythm(null);
$('rhythm-metric').onchange=()=>{if(state.target)renderRhythm(state.target);};
function renderRhythm(r){
  const data=r.transients?.rhythm;$('rhythm-panel').hidden=state.tab!=='drums'||!data;
  if($('rhythm-panel').hidden)return;
  const setting=state.rhythmSettings[r.id],key=$('rhythm-metric').value;
  const adaptive=setting?.mode==='adaptive';$('rhythm-mode').value=adaptive?'adaptive':'fixed';
  for(const id of ['rhythm-bpm','rhythm-offset','rhythm-apply'])$(id).disabled=adaptive;
  $('rhythm-bpm').value=setting?.bpm??data.bpm??'';$('rhythm-offset').value=setting?.offset??data.offset??0;
  const candidates=data.candidates.map(c=>`${number(c.bpm)} BPM`).join(' / ');
  $('rhythm-status').textContent=`${adaptive?'可変テンポ・局所推定':setting?'手動指定':data.bpm?'自動推定':'自動推定は不確かです。BPMと開始位置を指定してください。'} · 自動候補の周期性 ${number(data.periodicity,2)}${candidates?' · 候補 '+candidates:''}`;
  const beats=rhythmBeats(r),value=median(beats.map(b=>b[key]));
  if(adaptive){const sections=(data.adaptive?.sections||[]).filter(s=>s.end>range(r)[0]&&s.start<range(r)[1]);const bpms=sections.map(s=>s.bpm).filter(valid);$('rhythm-status').textContent=`可変テンポ・局所推定 · 有効区間 ${bpms.length} / ${sections.length} · BPM ${bpms.length?number(Math.min(...bpms))+'–'+number(Math.max(...bpms)):'—'} · 不確かな区間は対象外`;}
  const reference=median(refsFor(r).map(t=>median(rhythmBeats(t).map(b=>b[key]))));
  $('rhythm-summary').textContent=`${beats.length} 拍候補 / 測定可能 ${beats.filter(b=>valid(b[key])).length} · 中央値 ${number(value)} dB · REF ${number(reference)} dB · 差 ${valid(value)&&valid(reference)?number(value-reference):'—'} dB`;
  const s=surface('rhythm-chart');grid(s,-24,24,'');const {ctx,w,h}=s;
  for(const beat of beats){const v=beat[key];if(!valid(v))continue;const x=48+(w-60)*(beat.time-range(r)[0])/(range(r)[1]-range(r)[0]);const y=15+(h-45)*(24-Math.max(-24,Math.min(24,v)))/48;ctx.strokeStyle='#6bcac2';ctx.beginPath();ctx.moveTo(x,15+(h-45)/2);ctx.lineTo(x,y);ctx.stroke();}
  if(!beats.length)blank(s,'拍候補がありません');
  s.c.onclick=e=>seek(range(r)[0]+Math.max(0,Math.min(1,(e.offsetX-48)/(w-60)))*(range(r)[1]-range(r)[0]));
}
function surface(id){const c=$(id),dpr=window.devicePixelRatio||1,w=Math.max(200,c.clientWidth),h=c.clientHeight;c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.font='10px "Segoe UI",sans-serif';return{c,ctx,w,h};}
function blank(s,message){s.ctx.fillStyle='#8996a5';s.ctx.textAlign='center';s.ctx.fillText(message,s.w/2,s.h/2);}
function grid(s,min,max,unit=''){const{ctx,w,h}=s;ctx.strokeStyle='#2a333d';ctx.fillStyle='#82909f';ctx.textAlign='right';for(let i=0;i<5;i++){const y=15+(h-45)*i/4;ctx.beginPath();ctx.moveTo(48,y);ctx.lineTo(w-12,y);ctx.stroke();ctx.fillText(number(max-(max-min)*i/4,unit==='%'?0:1)+unit,41,y+3);}ctx.textAlign='left';ctx.fillText('0%',48,h-6);ctx.textAlign='right';ctx.fillText('100%',w-12,h-6);}
// Viewport is independent of the comparison range and its statistics.
let chartView={signature:'',start:0,end:1};
function chartWindow(r){
  const signature=JSON.stringify([r.id,range(r)]);
  if(chartView.signature!==signature)chartView={signature,start:0,end:1};
  return chartView;
}
function chartTimes(r){const v=chartWindow(r),[a,b]=range(r);return [a+(b-a)*v.start,a+(b-a)*v.end];}
function chartNavigation(r){
  const v=chartWindow(r),[a,b]=chartTimes(r),span=v.end-v.start;
  $('chart-viewport').textContent=`${a.toFixed(2)}–${b.toFixed(2)} 秒 · ${(1/span).toFixed(1)}×`;
  $('chart-pan').disabled=span>=.999999;$('chart-pan').value=span>=1?0:v.start/(1-span);
}
$('chart-reset').onclick=()=>{chartView.start=0;chartView.end=1;renderDashboard();};
$('chart-pan').oninput=()=>{const span=chartView.end-chartView.start;chartView.start=Number($('chart-pan').value)*(1-span);chartView.end=chartView.start+span;renderDashboard();};
for(const id of ['timeline','heatmap'])$(id).addEventListener('wheel',e=>{
  const r=state.target;if(!r||!e.deltaY&&!e.deltaX)return;
  e.preventDefault();const v=chartWindow(r),span=v.end-v.start;
  const rect=$(id).getBoundingClientRect(),left=id==='timeline'?48:46,right=id==='timeline'?12:7;
  const f=Math.max(0,Math.min(1,(e.clientX-rect.left-left)/(rect.width-left-right)));
  const delta=(e.deltaY||e.deltaX)*(e.deltaMode===1?16:e.deltaMode===2?rect.height:1);
  const next=e.shiftKey?span:Math.max(Math.min(1,.4/(range(r)[1]-range(r)[0])),Math.min(1,span*Math.exp(Math.max(-1,Math.min(1,delta*.002)))));
  const start=e.shiftKey?v.start+delta*.001*span:v.start+f*(span-next);
  v.start=Math.max(0,Math.min(1-next,start));v.end=v.start+next;renderDashboard();
},{passive:false});
function drawTimeline(r,key){
  const s=surface('timeline'),view=chartWindow(r),[start,end]=chartTimes(r);
  chartNavigation(r);
  s.c.onclick=e=>seek(start+Math.max(0,Math.min(1,(e.offsetX-48)/(s.w-60)))*(end-start));
  const ids=indices(r),vals=ids.map(i=>vocalValue(r,key,i,r.series[key]?.[i]));
  const refs=refsFor(r).map(t=>({track:t,ids:indices(t)})).filter(x=>x.ids.some(i=>valid(vocalValue(x.track,key,i,x.track.series[key]?.[i]))));
  const combined=vals.concat(refs.flatMap(x=>x.ids.map(i=>vocalValue(x.track,key,i,x.track.series[key]?.[i])))).filter(valid);
  if(!combined.length){blank(s,'この項目にはステム解析または有効区間が必要です');return;}
  const pct=key.endsWith('_pct')||key.endsWith('_competition');
  let min=pct?0:-3,max=pct?100:3;
  if(!pct)for(const v of combined){min=Math.min(min,Math.floor(v/5)*5);max=Math.max(max,Math.ceil(v/5)*5);}
  grid(s,min,max,pct?'%':'');
  const {ctx,w,h}=s;ctx.clearRect(45,h-23,w-45,23);ctx.fillStyle='#82909f';
  for(let i=0;i<=4;i++){const f=i/4;ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillText((start+(end-start)*f).toFixed(2)+'s',48+(w-60)*f,h-6);}
  function plot(points,color,dash=[]){ctx.save();ctx.beginPath();ctx.rect(48,15,w-60,h-45);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.setLineDash(dash);ctx.beginPath();let pen=false;
    for(const [f,v] of points){if(!valid(v)){pen=false;continue;}const x=48+(w-60)*(f-view.start)/(view.end-view.start),y=15+(h-45)*(max-v)/(max-min);if(pen)ctx.lineTo(x,y);else ctx.moveTo(x,y);pen=true;}ctx.stroke();ctx.restore();}
  const [a,b]=range(r),fractions=ids.map(i=>(r.times[i]-a)/(b-a));
  if(refs.length){
    const cursors=refs.map(()=>0);
    plot(fractions.map(f=>[f,median(refs.map(({track,ids},j)=>{
      const [ra,rb]=range(track),time=ra+f*(rb-ra);
      while(cursors[j]+1<ids.length&&Math.abs(track.times[ids[cursors[j]+1]]-time)<Math.abs(track.times[ids[cursors[j]]]-time))cursors[j]++;
      const i=ids[cursors[j]];return vocalValue(track,key,i,track.series[key]?.[i]);
    }))]),'#b29be3',[4,4]);
  }
  plot(fractions.map((f,i)=>[f,vals[i]]),'#6bcac2');
}
function drawHeatmap(r,key){
  const [start,end]=chartTimes(r);
  const s=surface('heatmap'),data=r.heatmaps[key],ids=r.times.map((t,i)=>t>=start&&t<end?i:-1).filter(i=>i>=0);
  s.c.onclick=null;
  if(!data){blank(s,'ステム解析で帯域競合を表示できます');$('heatmap-legend').textContent='対象外';return;}
  const{ctx,w,h}=s,left=46,top=7,pw=w-left-7,ph=h-30,bands=r.band_centers.length;
  ctx.fillStyle='#20272e';ctx.fillRect(left,top,pw,ph);
  const columns=Math.min(ids.length,Math.floor(pw));
  for(let j=0;j<columns;j++){
    const a=Math.floor(j*ids.length/columns),b=Math.max(a+1,Math.floor((j+1)*ids.length/columns));
    for(let k=0;k<bands;k++){
      const val=median(ids.slice(a,b).map(i=>vocalValue(r,key,i,data[i][k],k)));if(!valid(val))continue;
      const f=key==='side_pct'?val/100:key==='spectrum_db'?(val+75)/65:key==='mono_db'?-val/24:key==='band_correlation'?(1-val)/2:(18-val)/36;
      const t=Math.max(0,Math.min(1,f));ctx.fillStyle=`rgb(${Math.round(35+207*t)},${Math.round(72+107*t)},${Math.round(94+17*t)})`;
      ctx.fillRect(left+j*pw/columns,top+(bands-1-k)*ph/bands,Math.ceil(pw/columns),Math.ceil(ph/bands));
    }
  }
  ctx.fillStyle='#8996a5';ctx.textAlign='right';for(const f of [60,200,1000,6000,16000]){const k=r.band_centers.reduce((best,v,i)=>Math.abs(v-f)<Math.abs(r.band_centers[best]-f)?i:best,0);ctx.fillText(f>=1000?`${f/1000}k`:`${f}`,left-7,top+(bands-k-.5)*ph/bands+3);}
  ctx.textAlign='left';ctx.fillText(start.toFixed(2)+'s',left,h-4);ctx.textAlign='right';ctx.fillText(end.toFixed(2)+'s',w-7,h-4);
  $('heatmap-legend').textContent=key==='side_pct'?'濃青 0% → 明黄 100% Side / 灰色：無音':key==='spectrum_db'?'濃青 −75 dB → 明黄 −10 dB（帯域パワー）':'濃青 +18 dB（対象優勢）→ 明黄 −18 dB（他パート優勢）/ 灰色：対象外';
  if(key==='mono_db')$('heatmap-legend').textContent='濃青 0 dB → 明黄 −24 dB / 灰色：無音または完全キャンセル';
  if(key==='band_correlation')$('heatmap-legend').textContent='濃青 +1 → 明黄 −1 / 灰色：片側または両側の信号なし';
  s.c.onclick=e=>seek(start+Math.max(0,Math.min(1,(e.offsetX-left)/pw))*(end-start));
}
function row(label,value){const e=text('div','','metric-row');e.append(text('span',label),text('strong',value));return e;}
function renderDetail(r,kind){
  const root=$('detail');root.replaceChildren();
  const titles={bands:'帯域バランス',vocals:'ボーカルを読む',drums:'打音の測定状況',low:'低域を作るパート',spatial:'音像の補助指標',density:'密集度を読む'};
  $('detail-title').textContent=titles[kind];$('detail-description').textContent=['bands','low','vocals'].includes(kind)?'帯域構成・活動率の補助情報は曲全体の集計':'選択区間の特徴';
  if(kind==='bands'){
    r.broad_names.forEach((name,i)=>{const line=text('div','','bar-row'),head=text('div','');head.append(text('span',name),text('span',number(r.broad_pct[i])+'%'));const bar=document.createElement('progress');bar.max=100;bar.value=r.broad_pct[i]||0;line.append(head,bar);root.append(line);});
  }else if(kind==='low'){
    const total=Object.values(r.parts).reduce((a,p)=>a+p.low_power,0);
    if(!total)root.append(text('p','ステム解析で発生源の推定を表示します。','empty-chart'));
    for(const[k,p]of Object.entries(r.parts))root.append(row(names[k],number(p.low_power/total*100)+'%'));
    root.append(text('p','分離パート間の低域エネルギー構成比。','subtle'));
    const normalized=stat(r,'low_normalized_db'),ref=refStat('low_normalized_db');
    root.append(row('−23 LUFS換算・低域パワー',number(normalized)+' dBFS'),row('リファレンスとの差',valid(normalized)&&valid(ref)?number(normalized-ref)+' dB':'—'));
  }else if(kind==='vocals'){
    root.append(row('活動区間（暫定検出）',number(r.parts.vocals?.activity_pct)+'%'),row('相対音量の下位10%',percentile(values(r,'vocals_db'),.1)+' dB'),row('相対音量の上位10%',percentile(values(r,'vocals_db'),.9)+' dB'),text('p','声が小さい時間と、帯域競合が強い時間を見比べてください。コーラスを含む全歌声が対象です。','subtle'));
  }else if(kind==='drums'){
    const ev=transientEvents(r).filter(e=>e.time>=range(r)[0]&&e.time<range(r)[1]);
    root.append(row('検出したイベント',String(ev.length)),row('アタック／ボディ測定可能',`${ev.filter(e=>valid(e.attack_body_db)).length} / ${ev.length}`),row('減衰時間を測定可能',`${ev.filter(e=>valid(e.decay_ms)).length} / ${ev.length}`),row('クレストファクター',number(median(ev.map(e=>e.crest_db)))+' dB'),row('イベント頻度',number(ev.length/(range(r)[1]-range(r)[0]))+' / 秒'));
    for(const [key,label,unit] of [['attack_ms','立ち上がり','ms'],['attack_body_db','A/B','dB'],['crest_db','クレスト','dB'],['decay_ms','減衰','ms']])root.append(row(`${label} 10–90%範囲`,`${percentile(ev.map(e=>e[key]),.1)} – ${percentile(ev.map(e=>e[key]),.9)} ${unit}`));
  }else if(kind==='spatial'){
    root.append(row('左 / 右のレベル差',number(stat(r,'lr_db'))+' dB'),row('Sideなしのフレーム',String(values(r,'side_pct').filter(v=>valid(v)&&v<.001).length)),row('完全モノキャンセルのフレーム',String(values(r,'side_pct').filter(v=>valid(v)&&v>99.999).length)),text('p','左だけの音と、左右同パワーの無相関音はどちらもSide約50%になり得ます。Side比率だけで幅を断定しません。','subtle'));
    root.append(text('p','曲全体のM/Sスペクトル · 青緑 Mid / 紫 Side','subtle'));
    const canvas=document.createElement('canvas');canvas.id='ms-spectrum';canvas.setAttribute('aria-label','曲全体のM/Sスペクトル');root.append(canvas);
    drawSpectrum(r);
  }else{
    root.append(row('占有度の下位10%',percentile(values(r,'density_pct'),.1)+'%'),row('占有度の上位10%',percentile(values(r,'density_pct'),.9)+'%'),text('p','占有度で音の厚みを、競合率でパート同士の重なりを確認できます。','subtle'));
  }
}
function drawSpectrum(r){
  const s=surface('ms-spectrum'),{ctx,w,h}=s;
  grid(s,-100,-10,'');ctx.clearRect(0,h-20,w,20);ctx.fillStyle='#8996a5';ctx.textAlign='left';ctx.fillText('20 Hz',48,h-4);ctx.textAlign='right';ctx.fillText('20 kHz / ERB帯域',w-12,h-4);
  for(const [values,color] of [[r.mid_spectrum,'#6bcac2'],[r.side_spectrum,'#b29be3']]){ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();values.forEach((v,i)=>{const x=48+(w-60)*i/(values.length-1),y=15+(h-45)*(-10-Math.max(-100,Math.min(-10,v)))/90;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();}
}
function percentile(a,p){a=a.filter(valid).sort((x,y)=>x-y);if(!a.length)return '—';const n=(a.length-1)*p,lo=Math.floor(n),hi=Math.ceil(n);return number(a[lo]+(a[hi]-a[lo])*(n-lo));}
let plottedEvents=[];
function drawTransients(r){
  $('transient-type').disabled=$('transient-band').value!=='full';
  const events=transientEvents(r).filter(e=>e.time>=range(r)[0]&&e.time<range(r)[1]);
  $('event-count').textContent=`${events.length} EVENTS`;
  const s=surface('scatter'),{ctx,w,h}=s;grid(s,-20,30,'');
  ctx.fillStyle='#8996a5';ctx.clearRect(0,h-18,w,18);ctx.textAlign='left';ctx.fillText('−30 dB',48,h-4);ctx.textAlign='right';ctx.fillText('+30 dB',w-12,h-4);
  plottedEvents=[];
  let referenceCount=0;
  for(const track of refsFor(r))for(const e of transientEvents(track).filter(e=>e.time>=range(track)[0]&&e.time<range(track)[1])){
    if(!valid(e.relative_db)||!valid(e.attack_body_db))continue;
    const x=48+(w-60)*(Math.max(-30,Math.min(30,e.relative_db))+30)/60,y=15+(h-45)*(30-Math.max(-20,Math.min(30,e.attack_body_db)))/50;
    ctx.strokeStyle='#b29be388';ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.stroke();referenceCount++;
  }
  $('event-count').textContent+=` / REF ${referenceCount}`;
  for(const e of events){if(!valid(e.relative_db)||!valid(e.attack_body_db))continue;const x=48+(w-60)*(Math.max(-30,Math.min(30,e.relative_db))+30)/60,y=15+(h-45)*(30-Math.max(-20,Math.min(30,e.attack_body_db)))/50;ctx.fillStyle=state.event===e?'#f1ba73':'#6bcac299';ctx.beginPath();ctx.arc(x,y,state.event===e?5:3,0,Math.PI*2);ctx.fill();plottedEvents.push({x,y,e});}
  if(!events.includes(state.event))state.event=events.find(e=>valid(e.attack_body_db))||events[0]||null;
  s.c.onclick=event=>{let best=null,d=Infinity;for(const p of plottedEvents){const n=Math.hypot(p.x-event.offsetX,p.y-event.offsetY);if(n<d){best=p;d=n;}}if(best&&d<25){state.event=best.e;seek(best.e.time);drawTransients(r);}};
  drawEnvelope(r);
}
let referenceEvent=null;
$('envelope-reference').onchange=()=>{referenceEvent=null;if(state.target)drawEnvelope(state.target);};
$('envelope-event').onchange=()=>{referenceEvent=null;if(state.target)drawEnvelope(state.target,true);};
$('envelope-mode').onchange=()=>{if(state.target)drawEnvelope(state.target);};
function drawEnvelope(r,chooseEvent=false){
  const selected=$('envelope-reference').value;
  $('envelope-reference').replaceChildren(text('option','比較なし'));$('envelope-reference').firstChild.value='';
  for(const track of refsFor(r)){const option=text('option',track.name);option.value=track.id;$('envelope-reference').append(option);}
  $('envelope-reference').value=refsFor(r).some(t=>t.id===selected)?selected:'';
  const reference=refsFor(r).find(t=>t.id===$('envelope-reference').value);
  const events=reference?transientEvents(reference).filter(e=>e.time>=range(reference)[0]&&e.time<range(reference)[1]):[];
  const index=chooseEvent?Number($('envelope-event').value):events.indexOf(referenceEvent);
  referenceEvent=events[index]||events[0]||null;
  $('envelope-event').replaceChildren();
  for(const [i,e] of events.entries()){const option=text('option',`${e.time.toFixed(3)} 秒 · A/B ${number(e.attack_body_db)} dB`);option.value=i;$('envelope-event').append(option);}
  if(referenceEvent)$('envelope-event').value=events.indexOf(referenceEvent);
  $('envelope-event').disabled=!events.length;$('envelope-listen-reference').disabled=!referenceEvent;
  $('envelope-listen-reference').onclick=()=>{if(referenceEvent)seekTrack(reference,referenceEvent.time);};
  const e=state.event,env=surface('envelope'),mode=$('envelope-mode').value;
  const curves=Envelopes.curves([e,referenceEvent],mode);
  if(!e&&!referenceEvent){$('envelope-description').textContent='';blank(env,'測定できる打音がありません');$('event-detail').textContent='この区間・帯域にはイベントがありません。';return;}
  const maximum=mode==='normalized'?1:Math.max(1e-12,...curves.flat().map(p=>p.value).filter(valid));
  const{ctx,w,h}=env;
  for(const [i,curve] of curves.entries()){
    ctx.strokeStyle=i?'#b29be3':'#f1ba73';ctx.lineWidth=1.6;ctx.beginPath();let pen=false;
    for(const point of curve){if(!valid(point.value)||point.time < -10||point.time>240){pen=false;continue;}const x=40+(point.time+10)/250*(w-50),y=15+(h-45)*(1-point.value/maximum);if(pen)ctx.lineTo(x,y);else ctx.moveTo(x,y);pen=true;}ctx.stroke();
  }
  ctx.fillStyle='#8996a5';ctx.fillText(number(maximum,mode==='normalized'?1:4),0,18);ctx.fillText('0',20,h-30);
  const onsetX=40+10/250*(w-50);ctx.strokeStyle='#8996a566';ctx.beginPath();ctx.moveTo(onsetX,15);ctx.lineTo(onsetX,h-30);ctx.stroke();
  ctx.fillText('0 ms（オンセット）',onsetX,h-5);ctx.textAlign='right';ctx.fillText('240 ms',w-10,h-5);
  $('envelope-description').textContent=mode==='normalized'?'各打音のピークを1にして形状を比較 · 黄：対象 / 紫：REF':'元信号のRMS振幅を共通軸で比較（曲間ゲイン補正なし）· 黄：対象 / 紫：REF';
  $('event-detail').textContent=`${e?`対象 ${e.time.toFixed(3)} 秒 · 立ち上がり ${number(e.attack_ms)} ms · A/B ${number(e.attack_body_db)} dB · 減衰 ${number(e.decay_ms)} ms`:'対象イベントなし'}${referenceEvent?` / REF ${reference.name} ${referenceEvent.time.toFixed(3)} 秒 · A/B ${number(referenceEvent.attack_body_db)} dB`:''}`;
}
function refreshPlayer(){
  const selected=$('listen-track').value,tracks=[state.target,...state.references].filter(Boolean);$('listen-track').replaceChildren();
  for(const r of tracks){const option=text('option',r.name);option.value=r.id;$('listen-track').append(option);}
  if(tracks.some(r=>r.id===selected))$('listen-track').value=selected;
  $('listen-track').disabled=!tracks.length;$('listen-source').disabled=!tracks.length;updateSources();
}
function currentListen(){return[state.target,...state.references].find(r=>r?.id===$('listen-track').value);}
function updateSources(){
  const r=currentListen(),source=$('listen-source').value;$('listen-source').replaceChildren();
  if(!r){const audio=$('audio');audio.onloadedmetadata=null;audio.pause();audio.removeAttribute('src');audio.load();$('playing-name').textContent='音源未選択';$('preview-gain').textContent='ゲイン補正なし';return;}
  for(const key of Object.keys(r.media)){const option=text('option',sourceNames[key]||key);option.value=key;$('listen-source').append(option);}
  if(r.media[source])$('listen-source').value=source;changeAudio(false);
}
function changeAudio(preserve=true){
  const r=currentListen();if(!r)return;const audio=$('audio'),position=preserve?audio.currentTime:0,playing=!audio.paused;
  audio.pause();audio.src=r.media[$('listen-source').value];
  audio.onloadedmetadata=()=>{audio.currentTime=Math.min(position,audio.duration||0);if(playing)audio.play().catch(()=>{});};
  $('playing-name').textContent=r.name;$('preview-gain').textContent=`共通試聴ゲイン ${number(r.preview_gain_db)} dB · 自動音量合わせ OFF`;
}
$('listen-track').onchange=updateSources;$('listen-source').onchange=()=>changeAudio(true);
function seekTrack(track,time){if(!track)return;if(currentListen()?.id!==track.id){$('listen-track').value=track.id;updateSources();$('audio').onloadedmetadata=()=>{$('audio').currentTime=time;};}else $('audio').currentTime=time;}
function seek(time){seekTrack(state.target,time);}
new ResizeObserver(()=>{if(state.target)renderDashboard();}).observe(document.querySelector('main'));
async function initializeEngine(){
  const controls=['add-target','add-reference','empty-import','demo'];
  const lock=disabled=>controls.forEach(id=>{$(id).disabled=disabled;});
  lock(true);
  try{
    const status=await api.engineStatus();
    if(!status.ready){
      $('engine-setup').hidden=false;
      $('engine-status').textContent='解析環境の設定が必要です';
      $('engine-setup-message').textContent='公式配布元からライブラリを取得し、アプリ専用のPython環境を作成します。';
      return;
    }
    displayHardware(await api.health());
    $('engine-setup').hidden=true;
    lock(false);
  }catch(e){$('engine-status').textContent='環境のセットアップが必要です';$('engine-setup').hidden=false;$('engine-setup-message').textContent=e.message;notice(e.message);}
}
if(api){
  api.onEngineProgress(message=>{
    if(message.message)$('engine-setup-message').textContent=message.message;
    $('engine-download-progress').removeAttribute('value');
  });
  const setupBusy=busy=>['engine-install','engine-select','engine-variant','engine-manager','engine-close'].forEach(id=>{$(id).disabled=busy;});
  $('engine-install').onclick=async()=>{
    setupBusy(true);
    try{await api.installEngine({variant:$('engine-variant').value,manager:$('engine-manager').value});await initializeEngine();}
    catch(e){$('engine-setup-message').textContent=e.message;$('engine-install').textContent='再試行';}
    finally{setupBusy(false);$('engine-download-progress').value=0;}
  };
  $('engine-select').onclick=async()=>{
    setupBusy(true);
    try{if(await api.selectEngine())await initializeEngine();}
    catch(e){$('engine-setup-message').textContent=e.message;}
    finally{setupBusy(false);}
  };
  $('engine-manage').onclick=async()=>{$('engine-setup').hidden=false;const status=await api.engineStatus();$('engine-setup-message').textContent=status.python?`使用中: ${status.python}`:'Python 3.13以上 または uv を準備してセットアップしてください。';};
  $('engine-close').onclick=()=>{$('engine-setup').hidden=true;};
  restoreSession().then(()=>initializeEngine());
}
else{$('engine-status').textContent='Electronから起動してください';notice('npm start でデスクトップアプリを起動してください。');}
