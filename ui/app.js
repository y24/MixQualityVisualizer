'use strict';
const $ = id => document.getElementById(id);
const api = window.mixApp;
const state = { target:null, references:[], tab:'overview', ranges:{}, busy:false, role:'target', pending:null, stems:{}, event:null, hardware:null, vocalRanges:{}, vocalModes:{}, rhythmSettings:{} };
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
function setBusy(busy) { state.busy=busy;$('progress-panel').hidden=!busy;for(const id of ['add-target','add-reference','demo','empty-import','history'])$(id).disabled=busy; }
api?.onProgress(msg=>{ $('progress').value=msg.percent;$('progress-message').textContent=msg.message; });

function addResult(result,role) {
  if(!(result.id in state.rhythmSettings)){
    try{const saved=JSON.parse(localStorage.getItem('rhythm:'+result.id));if(saved)Rhythm.beats(result.transients?.rhythm,result.duration,saved);state.rhythmSettings[result.id]=saved;}catch{state.rhythmSettings[result.id]=null;}
  }
  state.vocalModes[result.id]=localStorage.getItem('vocal-mode:'+result.id)==='manual'?'manual':'filter';
  if(!(result.id in state.vocalRanges)){
    try { const saved=JSON.parse(localStorage.getItem('vocal-ranges:'+result.id));state.vocalRanges[result.id]=saved==null?null:VocalRanges.normalize(saved,result.duration); }
    catch { state.vocalRanges[result.id]=null; }
  }
  if(role==='target') state.target=result;
  else if(!state.references.some(r=>r.id===result.id)) state.references.push(result);
  if(!state.target) {state.target=result;state.references=state.references.filter(r=>r.id!==result.id);}
  state.event=null;render();refreshPlayer();
}
async function analyze(request,role) {
  notice();setBusy(true);$('progress').value=0;$('progress-message').textContent='解析を開始しています';
  try {addResult(await api.analyze(request),role);}
  catch(e) {notice(e.message);}
  finally {setBusy(false);}
}
function openImport(role) {
  if(state.busy)return;
  state.role=role;state.pending=null;state.stems={};
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
  const request={path:state.pending.path,mode:$('import-mode').value,model:$('model').value,device:$('device').value,stems:Object.fromEntries(Object.entries(state.stems).map(([k,v])=>[k,v.path]))};
  $('import-dialog').close();analyze(request,state.role);
};
$('cancel').onclick=()=>api.cancel();
$('demo').onclick=async()=>{try{await analyze(await api.demo(),'target');}catch(e){notice(e.message);}};
$('history').onclick=async()=>{
  try {
    const history=await api.history();$('history-items').replaceChildren();
    if(!history.length)$('history-items').append(text('p','まだ保存済みの解析はありません。','subtle'));
    for(const item of history){
      const row=text('div','','history-row');row.append(text('strong',`${item.name} · ${duration(item.duration)}`));
      for(const [role,label] of [['target','解析対象として開く'],['reference','リファレンスに追加']]){
        const button=text('button',label,'secondary small');button.onclick=async()=>{try{addResult(await api.loadHistory(item.id),role);$('history-dialog').close();}catch(e){notice(e.message);}};row.append(button);
      }
      $('history-items').append(row);
    }
    $('history-dialog').showModal();
  }catch(e){notice(e.message);}
};
$('history-close').onclick=()=>$('history-dialog').close();
$('export').onclick=async()=>{
  try {
    const strip=r=>{const {media,...data}=r;return data;};
    await api.export({target:strip(state.target),references:state.references.map(strip),ranges:state.ranges,transient_band:$('transient-band').value,transient_type:$('transient-type').value,vocal_ranges:state.vocalRanges,vocal_modes:state.vocalModes,rhythm_settings:state.rhythmSettings,exported_at:new Date().toISOString()});
  }catch(e){notice(e.message);}
};
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.event=null;renderDashboard();});
$('component').onchange=renderDashboard;$('time-window').onchange=renderDashboard;$('spatial-metric').onchange=renderDashboard;
$('range-apply').onclick=()=>{
  if(!state.target)return;
  const a=Number($('range-start').value),b=Number($('range-end').value);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>state.target.duration+.01||b-a<.4){notice('0.4秒以上で、音源の長さ以内の区間を指定してください。');return;}
  state.ranges[state.target.id]=[a,b];state.event=null;notice();renderDashboard();
};
$('range-reset').onclick=()=>{if(state.target){delete state.ranges[state.target.id];renderDashboard();}};

function renderTracks() {
  $('target-list').replaceChildren();$('reference-list').replaceChildren();
  if(state.target){
    const row=text('div','','track selected');row.append(text('strong',state.target.name),text('small',`${duration(state.target.duration)} · ${state.target.mode==='mix'?'元音源のみ':state.target.mode==='stems'?'入力ステム':'自動分離'}${state.target.cached?' · キャッシュ':''}`));$('target-list').append(row);
  }else $('target-list').append(text('p','ミックスを選択してください','quiet'));
  for(const r of state.references){
    const row=text('div','','track');row.append(text('strong',r.name),text('small',`${duration(range(r)[0])} – ${duration(range(r)[1])}`));
    const actions=text('div','','track-actions');
    const swap=text('button','表示・区間指定','text-button');swap.onclick=()=>{const previous=state.target;state.target=r;state.references=state.references.filter(x=>x.id!==r.id);if(previous&&previous.id!==r.id)state.references.push(previous);state.event=null;render();refreshPlayer();};
    const remove=text('button','外す','text-button');remove.onclick=()=>{state.references=state.references.filter(x=>x.id!==r.id);render();refreshPlayer();};actions.append(swap,remove);row.append(actions);$('reference-list').append(row);
  }
  if(!state.references.length)$('reference-list').append(text('p','目標の音を並べて比較','quiet'));
}
function render() {renderTracks();renderDashboard();}
const views={
  overview:{cards:[['vocals_db','声と伴奏のバランス','dB','歌声活動区間の相対レベル'],['drums_db','ドラムの相対音量','dB','非ドラムに対するレベル'],['low_pct','低域の比率','%','20–200 Hz / 全解析帯域'],['side_pct','Sideの比率','%','左右差成分のエネルギー']],line:'vocals_db',title:'声と伴奏のバランス',description:'共通の時間窓・K特性で測定。高いほど伴奏に対してボーカルが大きい。',heat:'vocals_competition',heatTitle:'声と伴奏の帯域競合',detail:'bands'},
  vocals:{cards:[['vocals_db','声と伴奏のバランス','dB','歌声活動区間の相対レベル'],['vocals_competition','帯域競合率','%','声の有効帯域をエネルギーで重み付け'],['vocals_mid_competition','Mid内の競合','%','Midの声 対 Midの伴奏'],['vocals_side_competition','Side内の競合','%','Sideの声がない区間は対象外']],line:'vocals_db',title:'ボーカルの相対音量',description:'間奏など、エネルギーゲートで対象外になった区間は線を描きません。',heat:'vocals_competition',heatTitle:'ボーカルの帯域競合',detail:'vocals'},
  drums:{cards:[['drums_db','ドラムの相対音量','dB','非ドラムに対するレベル'],['event:attack_ms','立ち上がり時間','ms','振幅包絡の10% → 90%'],['event:attack_body_db','アタック／ボディ比','dB','0–30 ms 対 50–150 ms'],['event:decay_ms','減衰時間','ms','ピークから−20 dBまで']],line:'drums_db',title:'ドラムの相対音量',description:'持続的な音量と一打の形を分けて確認します。',heat:'drums_competition',heatTitle:'ドラムと他パートの競合',detail:'drums'},
  bass:{cards:[['bass_db','ベースの相対音量','dB','非ベースに対するレベル'],['low_pct','低域の比率','%','20–200 Hz / 全解析帯域'],['sub_pct','サブ低域の比率','%','20–60 Hz / 全解析帯域'],['bass_competition','ベースの帯域競合','%','低音の多さと楽器の大きさは別']],line:'low_pct',title:'低域が全体を占める割合',description:'元音源から算出する物理的なエネルギー比。知覚的な音量の割合ではありません。',heat:'bass_competition',heatTitle:'ベースと他パートの競合',detail:'low'},
  spatial:{cards:[['side_pct','Sideの比率','%','広がりの百分率ではありません'],['sm_db','Side / Mid','dB','正値はSide優勢'],['correlation','左右相関','','遅延0・400 ms窓'],['mono_db','モノラル合成差','dB','元のL/R平均パワーが基準']],line:'side_pct',title:'Side比率の時間変化',description:'左右への偏りでも比率は変化します。相関と左右バランスを併せて確認。',heat:'side_pct',heatTitle:'帯域ごとのSide比率',detail:'spatial'},
  density:{cards:[['density_pct','時間・周波数の占有度','%','−23 LUFS換算 / ERB帯域'],['congestion_pct','分離パート間の競合','%','最大パートから12 dB以内が2つ以上'],['vocals_competition','声と伴奏の競合','%','声の有効帯域に限定'],['drums_competition','ドラムと他の競合','%','音数や良し悪しの点数ではありません']],line:'density_pct',title:'時間・周波数の占有度',description:'楽器数ではなく、一定水準以上の音が存在する帯域の割合を測ります。',heat:'spectrum_db',heatTitle:'音が存在する帯域',detail:'density'}
};
function renderDashboard() {
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
  const r=state.target;$('empty').hidden=!!r;$('dashboard').hidden=!r;$('export').disabled=!r;
  if(!r)return;
  const v=views[state.tab];$('track-title').textContent=r.name;
  $('track-meta').textContent=`${duration(r.duration)}  /  ${(r.metadata.source_sample_rate/1000).toFixed(1)} kHz  /  ${r.metadata.source_channels===1?'MONO':'STEREO'}  /  ${number(r.loudness_lufs)} LUFS  /  ${r.model||'入力音源'}${r.device?' · '+(r.device_label||r.device.toUpperCase())+'で分離':''}${r.cached?' / 保存済み解析':r.separation_cached?' / 保存済み分離ステム':''}`;
  $('range-start').value=range(r)[0].toFixed(2);$('range-end').value=range(r)[1].toFixed(2);$('range-end').max=r.duration;
  renderVocalEditor(r);
  $('cards').replaceChildren();
  for(const [key,label,unit,note] of v.cards){
    const value=stat(r,key),reference=refStat(key),card=text('div','','card');card.append(text('div',label,'card-label'));
    const num=text('div',number(value,key==='correlation'?2:1),'card-number');num.append(text('small',unit));card.append(num);
    const delta=valid(value)&&valid(reference)?value-reference:null;
    card.append(text('div',valid(delta)?`${delta>0?'+':''}${number(delta)} ${unit==='%'?'pt':unit} / REF ${number(reference)}`:state.references.length?'比較可能なリファレンス値なし':'リファレンスを追加して比較','card-delta'),text('div',key.startsWith('event:')?`${$('transient-band').selectedOptions[0].textContent} · ${note}`:key.startsWith('vocals_')&&state.vocalRanges[r.id]!=null?'手動指定区間 · '+note:note,'card-note'));$('cards').append(card);
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
  if(state.tab==='spatial')lines.push('M/Sは中央と左右の楽器を完全に分離する処理ではありません。Midとモノラルの試聴はこのゲイン規約では同じ音です。Side比率とモノラル合成差は独立の指標ではありません。');
  if(state.tab==='drums')lines.push('打音検出は包絡変化による試作版です。全帯域のタイプはオンセット後80 msの帯域比・スペクトル平坦度・重心によるルール推定であり、楽器の確定分類ではありません。重なった音や加工音は誤分類する場合があります。選択帯域は打音カード・散布図・測定状況・リファレンス比較に適用し、ドラムの相対音量と帯域競合は全帯域のままです。帯域別はフィルター後に独立検出します。帯域名は楽器名ではなく、同じ一打が複数帯域で検出される場合があります。フィルターの遅延・リンギング、特に低域の周期が測定に含まれるため、帯域間の時間差は楽器のタイミング差を意味しません。連打で150 msの窓に次の打音が入る場合、アタック／ボディ比とクレストは対象外です。減衰を測れたイベントだけの中央値には偏りがあります。');
  if(state.tab==='density')lines.push('占有度は各曲全体を−23 LUFS相当に換算した固定閾値の試作指標です。単一の広帯域音でも高くなります。「その他」内部の楽器同士の競合は測れません。');
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
$('rhythm-auto').onclick=()=>saveRhythm(null);
$('rhythm-metric').onchange=()=>{if(state.target)renderRhythm(state.target);};
function renderRhythm(r){
  const data=r.transients?.rhythm;$('rhythm-panel').hidden=state.tab!=='drums'||!data;
  if($('rhythm-panel').hidden)return;
  const setting=state.rhythmSettings[r.id],key=$('rhythm-metric').value;
  $('rhythm-bpm').value=setting?.bpm??data.bpm??'';$('rhythm-offset').value=setting?.offset??data.offset??0;
  const candidates=data.candidates.map(c=>`${number(c.bpm)} BPM`).join(' / ');
  $('rhythm-status').textContent=`${setting?'手動指定':data.bpm?'自動推定':'自動推定は不確かです。BPMと開始位置を指定してください。'} · 周期性 ${number(data.periodicity,2)}（正解確率ではありません）${candidates?' · 候補 '+candidates:''}`;
  const beats=rhythmBeats(r),value=median(beats.map(b=>b[key]));
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
function drawTimeline(r,key){
  const s=surface('timeline'),ids=indices(r),vals=ids.map(i=>vocalValue(r,key,i,r.series[key]?.[i]));
  const refs=refsFor(r).map(t=>{const ix=indices(t);return ix.map(i=>vocalValue(t,key,i,t.series[key]?.[i]));}).filter(a=>a.some(valid));
  const combined=[...vals,...refs.flat()].filter(valid);
  if(!combined.length){blank(s,'この項目にはステム解析または有効区間が必要です');return;}
  const pct=key.endsWith('_pct')||key.endsWith('_competition');
  const min=pct?0:Math.min(-3,Math.floor(Math.min(...combined)/5)*5),max=pct?100:Math.max(3,Math.ceil(Math.max(...combined)/5)*5);
  grid(s,min,max,pct?'%':'');
  function plot(a,color,dash=[]){const{ctx,w,h}=s;ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.setLineDash(dash);ctx.beginPath();let pen=false;a.forEach((v,i)=>{if(!valid(v)){pen=false;return;}const x=48+(w-60)*i/Math.max(1,a.length-1),y=15+(h-45)*(max-v)/(max-min);if(pen)ctx.lineTo(x,y);else ctx.moveTo(x,y);pen=true;});ctx.stroke();ctx.setLineDash([]);}
  if(refs.length){const size=Math.max(vals.length,2);plot(Array.from({length:size},(_,i)=>median(refs.map(a=>a[Math.round(i/(size-1)*(a.length-1))]))),'#b29be3',[4,4]);}
  plot(vals,'#6bcac2');
  s.c.onclick=e=>{const f=Math.max(0,Math.min(1,(e.offsetX-48)/(s.w-60)));seek(range(r)[0]+f*(range(r)[1]-range(r)[0]));};
}
function drawHeatmap(r,key){
  const s=surface('heatmap'),data=r.heatmaps[key],ids=indices(r);
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
  ctx.textAlign='left';ctx.fillText(duration(range(r)[0]),left,h-4);ctx.textAlign='right';ctx.fillText(duration(range(r)[1]),w-7,h-4);
  $('heatmap-legend').textContent=key==='side_pct'?'濃青 0% → 明黄 100% Side / 灰色：無音':key==='spectrum_db'?'濃青 −75 dB → 明黄 −10 dB（帯域パワー）':'濃青 +18 dB（対象優勢）→ 明黄 −18 dB（他パート優勢）/ 灰色：対象外';
  if(key==='mono_db')$('heatmap-legend').textContent='濃青 0 dB → 明黄 −24 dB / 灰色：無音または完全キャンセル';
  if(key==='band_correlation')$('heatmap-legend').textContent='濃青 +1 → 明黄 −1 / 灰色：片側または両側の信号なし';
  s.c.onclick=e=>seek(range(r)[0]+Math.max(0,Math.min(1,(e.offsetX-left)/pw))*(range(r)[1]-range(r)[0]));
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
    root.append(text('p','分離パート内の低域エネルギー構成比。位相干渉のため、元ミックスへの厳密な寄与率ではありません。','subtle'));
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
    root.append(row('占有度の下位10%',percentile(values(r,'density_pct'),.1)+'%'),row('占有度の上位10%',percentile(values(r,'density_pct'),.9)+'%'),text('p','「厚み」と「競合」を別々に見ます。密集していること自体は問題ではありません。','subtle'));
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
  const env=surface('envelope'),e=state.event;
  if(!e){blank(env,'測定できる打音がありません');$('event-detail').textContent=transientData(r)?'この区間にはイベントがありません。':'この帯域のデータがありません。音源の周波数上限を確認してください。';return;}
  const maximum=Math.max(...e.envelope,1e-12);env.ctx.strokeStyle='#f1ba73';env.ctx.lineWidth=1.6;env.ctx.beginPath();e.envelope.forEach((v,i)=>{const x=15+i/Math.max(1,e.envelope.length-1)*(env.w-30),y=15+(env.h-40)*(1-v/maximum);if(i)env.ctx.lineTo(x,y);else env.ctx.moveTo(x,y);});env.ctx.stroke();env.ctx.fillStyle='#8996a5';env.ctx.fillText('ピーク正規化した包絡 / 約240 ms',15,env.h-5);
  $('event-detail').textContent=`${e.time.toFixed(3)} 秒 · ${$('transient-band').value==='full'?soundTypes[e.sound_type||'unknown']:'帯域内イベント'} · 立ち上がり ${number(e.attack_ms)} ms · A/B ${number(e.attack_body_db)} dB · 減衰 ${number(e.decay_ms)} ms`;
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
  if(!r)return;
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
function seek(time){if(!state.target)return;if(currentListen()?.id!==state.target.id){$('listen-track').value=state.target.id;updateSources();$('audio').onloadedmetadata=()=>{$('audio').currentTime=time;};}else $('audio').currentTime=time;}
new ResizeObserver(()=>{if(state.target)renderDashboard();}).observe(document.querySelector('main'));
if(api)api.health().then(displayHardware).catch(e=>{$('engine-status').textContent='環境のセットアップが必要です';notice(e.message);});
else{$('engine-status').textContent='Electronから起動してください';notice('npm start でデスクトップアプリを起動してください。');}
