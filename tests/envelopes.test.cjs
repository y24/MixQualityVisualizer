const {test}=require('node:test');
const assert=require('node:assert/strict');
const Envelopes=require('../ui/envelopes.js');
test('onset alignment and peak normalization preserve shape across gains',()=>{
  const a={envelope:[0,2,1,null],envelope_origin_ms:-3,envelope_step_ms:3};
  const b={...a,envelope:[0,8,4,null]};
  const curves=Envelopes.curves([a,b,null]);
  assert.deepEqual(curves[0],curves[1]);
  assert.deepEqual(curves[0].map(p=>p.time),[-3,0,3,6]);
  assert.deepEqual(curves[0].map(p=>p.value),[0,1,.5,null]);
  assert.deepEqual(curves[2],[]);
  assert.deepEqual(Envelopes.curves([a,b],'absolute').map(c=>c[1].value),[2,8]);
});
