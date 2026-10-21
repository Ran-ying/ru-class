import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {TranscriptBuffer} from '../apps/web/transcript.js';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {captionProjectionText} from '../apps/web/asr-hallucination.js';

const R=16000;
function replay(windows:any[]){
  const b=new TranscriptBuffer();const out:string[]=[];
  for(const w of windows){
    const u=b.update(captionProjectionText(w.text),w.window_start_sample,w.window_end_sample,w.final);
    if(u.stable_delta)out.push(u.stable_delta);
  }
  return out.join(' ');
}
test('a stable Russian dash still equals itself, so later windows keep anchoring',()=>{
  const b=new TranscriptBuffer();const out:string[]=[];
  for(const [text,s,e] of [['Первая тема - это шифрование.',0,8],['Первая тема - это шифрование.',1,9],
    ['тема - это шифрование. Вопрос к студентам',2,10],['это шифрование. Вопрос к студентам, какие',3,11],
    ['Вопрос к студентам, какие алгоритмы',4,12],['к студентам, какие алгоритмы вы знаете?',5,13]] as const){
    const u=b.update(text,s*R,e*R);if(u.stable_delta)out.push(u.stable_delta);
  }
  const u=b.flush();if(u.stable_delta)out.push(u.stable_delta);
  assert.equal(out.join(' '),'Первая тема - это шифрование. Вопрос к студентам, какие алгоритмы вы знаете?');
});
test('dash variants are one token; letters still compare by word only',()=>{
  const b=new TranscriptBuffer();
  b.update('это – тест один два',0,8*R);
  const u=b.update('это - тест один два три',1*R,9*R);
  assert.equal(b.unanchored,undefined,'en dash and hyphen must anchor together');
  assert.ok(!(u.stable_delta+' '+u.partial_text).includes('тест один два это'));
});
test('real M4 synthetic lesson windows: no duplicated sentences with or without VAD',()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/v05-synthetic-dash-windows.json','utf8'));
  for(const key of ['novad','vad']){
    const text=replay(fixture.windows[key]);
    for(const phrase of ['Вопрос к студентам','какие алгоритмы вы уже','следующая тема криптография']){
      const hits=text.toLocaleLowerCase('ru-RU').split(phrase.toLocaleLowerCase('ru-RU')).length-1;
      assert.equal(hits,1,key+': "'+phrase+'" appears '+hits+' times in: '+text);
    }
    assert.doesNotMatch(text,/Редактор субтитров|Корректор/);
  }
});
test('a one-window edge sliver before silence is not committed, but repeated short speech is',()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/v05-synthetic-dash-windows.json','utf8'));
  for(const key of ['novad','vad'])assert.doesNotMatch(replay(fixture.windows[key]),/Чум/,key);
  const b=new TranscriptBuffer();const out:string[]=[];
  // Overlapping windows: "Всё." is unanchored (no 2-token link to the stable
  // sentence) and then decoded again unchanged by the next windows.
  for(const [text,s,e,final] of [['Это важная тема.',0,8,false],['Это важная тема.',1,9,false],
    ['Всё.',2,10,false],['Всё.',3,11,false],['Всё.',4,12,false],['',5,13,false],['',6,14,true]] as const){
    const u=b.update(text,s*R,e*R,final);if(u.stable_delta)out.push(u.stable_delta);
  }
  assert.match(out.join(' '),/Всё\.$/,'a short utterance seen in several windows must survive silence');
  assert.equal(b.silencedFragmentCount,0);
});
test('a fragment seen once and followed by two empty windows is dropped and counted',()=>{
  const b=new TranscriptBuffer();const out:string[]=[];
  for(const [text,s,e] of [['Это важная тема.',0,8],['Это важная тема.',1,9],['Чум.',3,11],['',4,12],['',5,13]] as const){
    const u=b.update(text,s*R,e*R);if(u.stable_delta)out.push(u.stable_delta);
  }
  assert.equal(out.join(' '),'Это важная тема.');
  assert.equal(b.silencedFragmentCount,1);assert.equal(b.silencedFragmentTokens,1);
});
