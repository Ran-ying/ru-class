import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {speechBounds} from '../apps/web/speech-bounds.js';
// @ts-ignore
import {sentenceTimes} from '../apps/web/sentence-worker.js';

const R=16000;
// [kind, seconds]: tone = speech-like energy, quiet = room noise.
function audio(parts:[string,number][],noise=40){
  const out:number[]=[];let seed=1;
  const rand=()=>((seed=seed*1103515245+12345&0x7fffffff)/0x7fffffff)*2-1;
  for(const [kind,sec] of parts)for(let i=0;i<sec*R;i++)
    out.push(Math.round(noise*rand()+(kind==='tone'?6000*Math.sin(i*2*Math.PI*220/R):0)));
  return Int16Array.from(out);
}
test('trims silence that a pause-spanning Whisper segment put inside the range',()=>{
  const pcm=audio([['quiet',2],['tone',2],['quiet',3]]);
  const b=speechBounds(pcm,1*R,6*R);
  assert.ok(Math.abs(b.from-2*R)<=320&&Math.abs(b.to-4*R)<=320,JSON.stringify(b));
  assert.equal(b.trimmed,true);
});
test('a neighbour island across a long pause is dropped; the sentence is never emptied',()=>{
  // own speech 1-3 s, 2 s pause, neighbour starts at 5 s
  const pcm=audio([['quiet',1],['tone',2],['quiet',2],['tone',1]]);
  const b=speechBounds(pcm,0.5*R,5.5*R,{nextStart:4.8*R});
  assert.ok(Math.abs(b.to-3*R)<=320,JSON.stringify(b));
  const only=speechBounds(pcm,4.9*R,5.5*R,{prevEnd:6*R});
  assert.ok(only.to>only.from,'the last island is kept even inside a neighbour estimate');
});
test('noisy rooms adapt the threshold; flat audio is left untouched',()=>{
  const noisy=audio([['quiet',1],['tone',1],['quiet',1]],1500);
  const b=speechBounds(noisy,0,3*R);
  assert.ok(Math.abs(b.from-R)<=640&&Math.abs(b.to-2*R)<=640,JSON.stringify(b));
  const flat=audio([['quiet',3]],1500);
  assert.deepEqual(speechBounds(flat,R,2*R),{from:R,to:2*R,trimmed:false});
});
test('sentence ranges: one unit per sentence maps directly, otherwise by word share',()=>{
  const u=(text:string,times:([number,number]|null)[])=>({text,wordTimes:times});
  assert.deepEqual(sentenceTimes([u('Да.',[[10,20]]),u('Нет.',[[30,40]])],[{ru:'Да.'},{ru:'Нет.'}]),[[10,20],[30,40]]);
  const two=sentenceTimes([u('один два три четыре',[[0,1],[1,2],[2,3],[3,4]])],[{ru:'Один два.'},{ru:'Три четыре.'}]);
  assert.deepEqual(two,[[0,2],[2,4]]);
  assert.deepEqual(sentenceTimes([{text:'без времени'}],[{ru:'Без времени.'}]),[null]);
});
test('a word the estimate cut mid-speech is finished (bounded), not truncated',()=>{
  // speech 1.0-3.0 s with a 0.2 s inner gap at 2.4 s; estimate ends early at 2.3 s
  const pcm=audio([['quiet',1],['tone',1.4],['quiet',0.2],['tone',0.4],['quiet',2]]);
  const b=speechBounds(pcm,1*R,2.3*R);
  assert.ok(Math.abs(b.to-3*R)<=320,JSON.stringify(b));
});
test('a neighbour estimate that is seconds early does not truncate this sentence',()=>{
  // own speech 1-3 s (inner 0.25 s gap at 2.5 s), next sentence 4-5 s; next estimate wrongly says 2.6 s
  const pcm=audio([['quiet',1],['tone',1.5],['quiet',0.25],['tone',0.25],['quiet',1],['tone',1],['quiet',1]]);
  const b=speechBounds(pcm,1*R,2.6*R,{nextStart:2.6*R});
  assert.ok(Math.abs(b.to-3*R)<=320,'own tail kept: '+JSON.stringify(b));
  assert.ok(b.to<4*R,'next sentence not pulled in');
});
test('previous sentence speech before an early estimate, across a real pause, is dropped',()=>{
  // previous sentence until 2 s, 1 s pause, own speech 3-5 s; estimate starts at 1.5 s
  const pcm=audio([['tone',2],['quiet',1],['tone',2],['quiet',1]]);
  const b=speechBounds(pcm,1.5*R,5*R,{prevEnd:1.8*R});
  assert.ok(Math.abs(b.from-3*R)<=320,JSON.stringify(b));
});
test('a short stray sound isolated by a long pause at the edge is not played',()=>{
  const pcm=audio([['quiet',1],['tone',0.1],['quiet',1.5],['tone',2],['quiet',1]]);
  const b=speechBounds(pcm,1*R,4.6*R);
  assert.ok(Math.abs(b.from-2.6*R)<=320,JSON.stringify(b));
});
test('sentence boundaries follow the first word even when the model drops words',()=>{
  const u={text:'В системе один и тот же ключ используется. Главная проблема в ключе.',
    wordTimes:[...Array(12).keys()].map(i=>[i*10,i*10+9])};
  // The model dropped "один и тот же": pure word shares would cut too early.
  const [a,b]=sentenceTimes([u],[{ru:'В системе ключ используется.'},{ru:'Главная проблема в ключе.'}]);
  assert.deepEqual([a,b],[[0,79],[80,119]]);
});
