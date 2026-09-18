'use strict';
// Shared by the renderer and Node regression tests.
const VocalRanges = {
  normalize(ranges, duration) {
    if (!Array.isArray(ranges)) throw new Error('区間の形式が不正です。');
    const sorted=ranges.map(pair=>{
      if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isFinite)||pair[0]<0||pair[1]>duration||pair[1]<=pair[0])throw new Error('開始・終了を音源の長さ以内で指定してください。');
      return [...pair];
    }).sort((a,b)=>a[0]-b[0]);
    const merged=[];
    for(const pair of sorted){const last=merged.at(-1);if(last&&pair[0]<=last[1])last[1]=Math.max(last[1],pair[1]);else merged.push(pair);}
    return merged;
  },
  includes(ranges, time) { return ranges==null || ranges.some(([a,b])=>time>=a&&time<b); }
};
if(typeof module!=='undefined')module.exports=VocalRanges;
