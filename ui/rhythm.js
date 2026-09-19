'use strict';
const Rhythm = {
  beats(data, duration, settings=null) {
    if(!data)return [];
    const bpm=settings?.bpm??data.bpm, offset=settings?.offset??data.offset;
    const adaptive=settings?.mode==='adaptive';
    if(!adaptive&&(bpm==null||offset==null))return [];
    if(!adaptive&&(!Number.isFinite(bpm)||bpm<30||bpm>300||!Number.isFinite(offset)||offset<0||offset>=duration))throw new Error('BPMは30–300、開始位置は曲の長さ以内で指定してください。');
    const dt=data.step;
    const prefix=a=>{const out=[0];for(const v of a)out.push(out.at(-1)+(Number.isFinite(v)?10**(v/10):0));return out;};
    const drum=prefix(data.drum_dbfs),rest=prefix(data.rest_dbfs);
    const mean=(a,start,end)=>{const lo=Math.max(0,Math.min(a.length-1,Math.round(start/dt))),hi=Math.max(lo,Math.min(a.length-1,Math.round(end/dt)));return hi>lo?(a[hi]-a[lo])/(hi-lo):0;};
    const ratio=(a,b)=>a>1e-12&&b>1e-12?10*Math.log10(a/b):null;
    const beats=[];
    const times=[];
    if(adaptive){for(const beat of data.adaptive?.beats||[])if(Number.isFinite(beat.time)&&beat.time>=0)times.push(beat.time);}
    else for(let n=0;offset+n*60/bpm<duration;n++)times.push(offset+n*60/bpm);
    for(const time of times){
      if(time+.1>Math.min(duration,(drum.length-1)*dt))continue;
      const power=mean(drum,time,time+.1);
      beats.push({time,relative_db:ratio(power,mean(rest,time,time+.1)),accent_db:ratio(power,mean(drum,Math.max(0,time-1),Math.min(duration,time+1)))});
    }
    return beats;
  }
};
if(typeof module!=='undefined')module.exports=Rhythm;
