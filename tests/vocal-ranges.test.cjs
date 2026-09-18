const {test}=require('node:test');
const assert=require('node:assert/strict');
const ranges=require('../ui/vocal-ranges.js');
test('merge overlapping ranges without altering source arrays',()=>{
  const input=[[5,8],[1,4],[3,6],[10,11]];
  assert.deepEqual(ranges.normalize(input,12),[[1,8],[10,11]]);
  assert.deepEqual(input[0],[5,8]);
});
test('automatic, empty manual, and half-open boundaries differ',()=>{
  assert.equal(ranges.includes(null,10),true);
  assert.equal(ranges.includes([],10),false);
  assert.equal(ranges.includes([[1,2]],1),true);
  assert.equal(ranges.includes([[1,2]],2),false);
});
test('reject corrupt or out-of-file intervals',()=>{
  for(const value of [null,[[0,NaN]],[[0,Infinity]],[[-1,2]],[[1,1]],[[0,11]],[[0,'2']]])assert.throws(()=>ranges.normalize(value,10));
});
