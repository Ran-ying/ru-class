import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {captionProjectionText,isCreditSegment} from '../apps/web/asr-hallucination.js';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {BrowserAsrSession} from '../apps/web/direct-asr.js';

// Exact text returned by the owner's whisper.cpp small endpoint for 8 s of silence.
const SILENCE='Редактор субтитров Н.Закомолдина\n Корректор А.Егорова';

test('whole Whisper subtitle-credit segments are not caption speech',()=>{
  assert.equal(captionProjectionText(SILENCE).trim(),'');
  assert.equal(captionProjectionText('Субтитры сделал DimaTorzok').trim(),'');
  assert.equal(captionProjectionText('Продолжение следует...').trim(),'');
  assert.equal(captionProjectionText(' [звук систии]\n').trim(),'');
  assert.equal(captionProjectionText('(музыка)').trim(),'');
  assert.equal(captionProjectionText('♪ ♪').trim(),'');
  assert.equal(captionProjectionText('Пример (см. выше) важен.'),'Пример (см. выше) важен.');
  assert.equal(captionProjectionText('Мы изучаем методы защиты.\n Редактор субтитров А.Синецкая'),
    'Мы изучаем методы защиты.');
});
test('ordinary classroom speech is passed through byte-for-byte',()=>{
  for(const text of ['  Оригинальная распознанная фраза.  ','Включите, пожалуйста, субтитры.',
    'Корректор текста проверил работу студентов.','Продолжение следует в следующий четверг.','',
    'Сегодня редактор субтитров не нужен.']){
    assert.equal(captionProjectionText(text),text);
  }
  assert.equal(isCreditSegment('Корректор А.Егорова'),true);
  assert.equal(isCreditSegment('Корректор проверяет'),false);
});
test('raw evidence keeps the hallucination while the caption projection sees silence',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(JSON.stringify({text:SILENCE}),{status:200})) as any;
  try{
    const raws:any[]=[],updates:any[]=[];
    const session=new BrowserAsrSession(
      {baseUrl:'https://private-asr.example/v1',model:'small',apiKey:'own-key'},
      (u:any)=>updates.push(u),(e:any)=>{throw e;},async(raw:any)=>{raws.push(raw);});
    session.ring.push(new Float32Array(8*16000));
    await session.run();
    session.cancel();
    assert.equal(raws[0].text,SILENCE,'exact provider text stays in the evidence journal');
    assert.equal(updates[0].raw_hypothesis_text,SILENCE);
    assert.equal(updates[0].stable_delta,'');
    assert.equal(updates[0].partial_text,'','no hallucinated caption draft');
  }finally{globalThis.fetch=originalFetch;}
});
