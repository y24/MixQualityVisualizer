'use strict';
const Envelopes={
  curves(events,mode='normalized'){
    return events.map(event=>{
      if(!event)return [];
      const peak=Math.max(1e-12,...event.envelope.filter(Number.isFinite));
      return event.envelope.map((value,i)=>({time:event.envelope_origin_ms+i*event.envelope_step_ms,
        value:Number.isFinite(value)?value/(mode==='normalized'?peak:1):null}));
    });
  }
};
if(typeof module!=='undefined')module.exports=Envelopes;
