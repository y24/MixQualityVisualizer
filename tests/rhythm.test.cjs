const {test}=require('node:test');const assert=require('node:assert/strict');
const Rhythm=require('../ui/rhythm.js');
const data={step:.01,bpm:120,offset:.2,drum_dbfs:Array(400).fill(-20),rest_dbfs:Array(400).fill(-26)};
test('beat metrics preserve level ratios and reject silence',()=>{
  const beats=Rhythm.beats(data,4);assert.equal(beats.length,8);
  for(const beat of beats){assert.ok(Math.abs(beat.relative_db-6)<1e-8);assert.ok(Math.abs(beat.accent_db)<1e-8);}
  assert.equal(Rhythm.beats({...data,drum_dbfs:Array(400).fill(null)},4)[0].relative_db,null);
});
test('manual grid overrides uncertain automatic detection',()=>{
  assert.deepEqual(Rhythm.beats({...data,bpm:null,offset:null},4),[]);
  assert.equal(Rhythm.beats(data,4,{bpm:60,offset:.1}).length,4);
  for(const settings of [{bpm:0,offset:0},{bpm:Infinity,offset:0},{bpm:120,offset:-1},{bpm:120,offset:4}])assert.throws(()=>Rhythm.beats(data,4,settings));
});
