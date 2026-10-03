'use strict';
// Keep only compact min/max peaks; decoded PCM is released after loading.
const waveformCache=new Map();
let waveEditor=null,waveRequest=0,waveAbort=null;
const waveClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
async function openWaveform(track){
  const request=++waveRequest;
  waveAbort?.abort();waveAbort=new AbortController();const signal=waveAbort.signal;
  waveEditor={track,range:[...range(track)],peaks:null,drag:null};
  $('range-track-name').textContent=track.name;$('wave-error').textContent='';
  $('waveform-status').textContent='WAVの波形を読み込み中…';
  if(!$('range-dialog').open)$('range-dialog').showModal();
  drawWaveform();
  let context;
  try{
    const url=track.media?.mix;if(!url)throw new Error('音源の試聴キャッシュがありません。再解析してください。');
    let peaks=waveformCache.get(url);
    if(!peaks){
      const response=await fetch(url,{signal});if(!response.ok)throw new Error('音源を読み込めませんでした。');
      const bytes=await response.arrayBuffer();if(request!==waveRequest)return;
      context=new AudioContext();const buffer=await context.decodeAudioData(bytes);
      if(request!==waveRequest)return;
      const count=Math.min(6000,buffer.length);peaks={min:new Float32Array(count),max:new Float32Array(count)};
      for(let channel=0;channel<buffer.numberOfChannels;channel++){
        const data=buffer.getChannelData(channel);
        for(let bin=0;bin<count;bin++)for(let i=Math.floor(bin*data.length/count),end=Math.floor((bin+1)*data.length/count);i<end;i++){
          peaks.min[bin]=Math.min(peaks.min[bin],data[i]);peaks.max[bin]=Math.max(peaks.max[bin],data[i]);
        }
      }
      if(waveformCache.size>=4)waveformCache.delete(waveformCache.keys().next().value);
      waveformCache.set(url,peaks);
    }
    if(request!==waveRequest)return;
    waveEditor.peaks=peaks;$('waveform-status').textContent='元ステレオ音源の波形 · 最短0.4秒';drawWaveform();
  }catch(error){if(request===waveRequest)$('waveform-status').textContent='波形の読み込みに失敗しました：'+error.message;}
  finally{if(context)await context.close();}
}
function drawWaveform(syncFields=true){
  if(!waveEditor||!$('range-dialog').open)return;
  const {track,range:pair,peaks}=waveEditor,{ctx,w,h}=surface('range-wave'),left=20,pw=w-40,mid=(h-30)/2;
  const x=t=>left+t/track.duration*pw;
  ctx.strokeStyle='#34505c';ctx.beginPath();ctx.moveTo(left,mid);ctx.lineTo(w-20,mid);ctx.stroke();
  if(peaks){ctx.strokeStyle='#6bcac2';ctx.beginPath();
    for(let pixel=0;pixel<pw;pixel++){
      const a=Math.floor(pixel*peaks.min.length/pw),b=Math.min(peaks.min.length,Math.max(a+1,Math.floor((pixel+1)*peaks.min.length/pw)));
      let lo=0,hi=0;for(let i=a;i<b;i++){lo=Math.min(lo,peaks.min[i]);hi=Math.max(hi,peaks.max[i]);}
      ctx.moveTo(left+pixel,mid-hi*(mid-16));ctx.lineTo(left+pixel,mid-lo*(mid-16));
    }ctx.stroke();
  }
  ctx.fillStyle='#f1ba7333';ctx.fillRect(x(pair[0]),8,x(pair[1])-x(pair[0]),h-38);
  ctx.fillStyle='#f1ba73';for(const t of pair){ctx.fillRect(x(t)-2,8,4,h-38);ctx.fillRect(x(t)-5,mid-15,10,30);}
  ctx.fillStyle='#8996a5';for(let i=0;i<=4;i++){ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillText(duration(track.duration*i/4),left+pw*i/4,h-8);}
  if(syncFields){$('wave-start').value=pair[0].toFixed(2);$('wave-end').value=pair[1].toFixed(2);}
  $('wave-start').max=track.duration;$('wave-end').max=track.duration;
  $('wave-duration').textContent=`選択 ${duration(pair[0])}–${duration(pair[1])} · ${(pair[1]-pair[0]).toFixed(2)} 秒`;
}
function waveTime(e){const rect=$('range-wave').getBoundingClientRect();return waveClamp((e.clientX-rect.left-20)/(rect.width-40)*waveEditor.track.duration,0,waveEditor.track.duration);}
$('range-wave').onpointerdown=e=>{
  if(!waveEditor?.peaks||e.button!==0)return;
  const t=waveTime(e),[a,b]=waveEditor.range,tolerance=10/($('range-wave').clientWidth-40)*waveEditor.track.duration;
  const mode=Math.abs(t-a)<=tolerance?'start':Math.abs(t-b)<=tolerance?'end':t>a&&t<b&&(a>0||b<waveEditor.track.duration)?'move':'new';
  waveEditor.drag={mode,time:t,original:[a,b]};$('range-wave').setPointerCapture(e.pointerId);
};
$('range-wave').onpointermove=e=>{
  if(!waveEditor?.drag)return;
  const {mode,time,original:[a,b]}=waveEditor.drag,t=waveTime(e),total=waveEditor.track.duration,min=Math.min(.4,total);
  if(mode==='start')waveEditor.range=[Math.min(t,b-min),b];
  else if(mode==='end')waveEditor.range=[a,Math.max(t,a+min)];
  else if(mode==='move'){const shift=waveClamp(t-time,-a,total-b);waveEditor.range=[a+shift,b+shift];}
  else{let start=Math.min(time,t),end=Math.max(time,t);if(end-start<min){start=Math.min(start,total-min);end=start+min;}waveEditor.range=[start,end];}
  $('wave-error').textContent='';drawWaveform();
};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('range-wave').addEventListener(event,()=>{if(waveEditor)waveEditor.drag=null;});
function readWaveFields(){
  const value=(id,index)=>$(id).value===waveEditor.range[index].toFixed(2)?waveEditor.range[index]:Number($(id).value);
  const a=value('wave-start',0),b=value('wave-end',1),total=waveEditor.track.duration;
  if(!$('wave-start').value.trim()||!$('wave-end').value.trim()||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>total+.001||b-a<Math.min(.4,total)-.001){$('wave-error').textContent='音源の長さ以内で、0.4秒以上の区間を選択してください。';return false;}
  waveEditor.range=[a,Math.min(b,total)];$('wave-error').textContent='';return true;
}
for(const id of ['wave-start','wave-end'])$(id).oninput=()=>{if(readWaveFields())drawWaveform(false);};
$('wave-all').onclick=()=>{waveEditor.range=[0,waveEditor.track.duration];$('wave-error').textContent='';drawWaveform();};
$('wave-apply').onclick=()=>{if(!readWaveFields())return;state.ranges[waveEditor.track.id]=[...waveEditor.range];state.event=null;$('range-dialog').close();notice();render();};
$('wave-cancel').onclick=()=>$('range-dialog').close();
$('range-dialog').addEventListener('close',()=>{waveRequest++;waveAbort?.abort();waveEditor=null;});
$('range-waveform').onclick=()=>{if(state.target)openWaveform(state.target);};
new ResizeObserver(()=>drawWaveform(false)).observe($('range-wave'));
