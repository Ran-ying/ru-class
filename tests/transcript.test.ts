import test from 'node:test';
import assert from 'node:assert/strict';
import {TranscriptBuffer} from '../apps/server/src/transcript.js';
import {Session} from '../apps/server/src/session.js';
import {event,type AudioHeader} from '../apps/server/src/protocol.js';

const RATE=16000;
function collect(outputs:{stable_delta:string;partial_text:string}[]):string {
  let stable='';
  for(const r of outputs){
    if(r.stable_delta)stable=[stable,r.stable_delta].filter(Boolean).join(' ');
  }
  return [stable,outputs.at(-1)?.partial_text||''].filter(Boolean).join(' ');
}
function push(t:TranscriptBuffer,text:string,step:number,final=false){
  return t.update(text,Math.max(0,step-8)*RATE,(step+1)*RATE,final);
}

test('rolling 8-second windows keep opening words and never append a full overlapping hypothesis',()=>{
  const t=new TranscriptBuffer();const outputs=[
    push(t,'Сегодня мы будем обсуждать методы защиты',7),
    push(t,'мы будем обсуждать методы защиты информации',8),
    push(t,'будем обсуждать методы защиты информации сегодня',9),
    push(t,'обсуждать методы защиты информации сегодня подробно',10),
    push(t,'методы защиты информации сегодня подробно',11)
  ];
  const stable=outputs.map(r=>r.stable_delta).filter(Boolean).join(' ');
  assert.ok(stable.startsWith('Сегодня мы будем обсуждать'));
  const shown=collect(outputs);
  assert.equal(shown,'Сегодня мы будем обсуждать методы защиты информации сегодня подробно');
  assert.equal(shown.split(' ').filter(w=>w==='Сегодня').length,1);
  const final=t.flush();
  assert.equal(final.partial_text,'');
  assert.equal([stable,final.stable_delta].filter(Boolean).join(' '),shown);
});

test('duplicate unchanged recognition does not grow accumulated text and repeated spoken words survive',()=>{
  const t=new TranscriptBuffer();const reports=[
    push(t,'да да да мы здесь',2),
    push(t,'да да да мы здесь',3),
    push(t,'да да да мы здесь',4),
    push(t,'да да да мы здесь сейчас',5)
  ];
  assert.equal(collect(reports),'да да да мы здесь сейчас');
  const last=t.flush();
  assert.equal([reports.map(x=>x.stable_delta).filter(Boolean).join(' '),last.stable_delta].filter(Boolean).join(' '),'да да да мы здесь сейчас');
});

test('temporary silence does not clear previously recognized text; two quiet windows finalize',()=>{
  const t=new TranscriptBuffer();
  const a=push(t,'Сегодня мы говорим о защите',5);
  const b=push(t,'мы говорим о защите информации',6);
  const c=push(t,'',7);
  assert.equal(collect([a,b,c]),'Сегодня мы говорим о защите информации');
  const d=push(t,'',8);
  assert.equal(d.partial_text,'');
  assert.equal(collect([a,b,c,d]),'Сегодня мы говорим о защите информации');
});

test('later unrelated phrase is not silently substituted for earlier unconsumed speech',()=>{
  const t=new TranscriptBuffer();
  const outputs=[
    push(t,'Первое длинное предложение',3),
    push(t,'длинное предложение закончено',4),
    push(t,'Это совсем другая тема',5),
    push(t,'совсем другая тема сегодня',6)
  ];
  assert.equal(collect(outputs),'Первое длинное предложение закончено Это совсем другая тема сегодня');
});

test('stop flushes even without new audio after the last inference; no repeated stable delta',async()=>{
  const emitted:any[]=[];
  const session=new Session({infer:async()=> 'Сегодня мы изучаем защиту информации'},r=>emitted.push(r),()=>assert.fail('unexpected inference failure'));
  for(let seq=0;seq<10;seq++){
    const payload={seq,start_sample:seq*3200,sample_count:3200,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:seq*9600,source_end_sample:(seq+1)*9600};
    session.push({...event('audio.frame','buffer-session-123456'),type:'audio.frame',payload} as AudioHeader,Buffer.alloc(6400));
  }
  await new Promise(r=>setImmediate(r));
  await session.stop();
  assert.equal(emitted.filter(x=>x.final).length,1);
  assert.equal(emitted.filter(x=>x.stable_delta).map(x=>x.stable_delta).join(' '),'Сегодня мы изучаем защиту информации');
  assert.equal(emitted.at(-1).partial_text,'');
  assert.ok(emitted.at(-1).revision>emitted[0].revision);
});

test('a later utterance repeating old technical terms is not dropped or mistaken for old history',()=>{
  const t=new TranscriptBuffer();const rows=[];
  rows.push(t.update('Мы подробно рассмотрим методы защиты информации',0,32000));
  rows.push(t.update('подробно рассмотрим методы защиты информации',16000,48000));
  rows.push(t.update('',32000,64000));
  rows.push(t.update('',48000,80000));
  // No overlap with earlier audio; a new sentence repeats three technical words.
  rows.push(t.update('Теперь повторим методы защиты информации ещё раз',320000,448000));
  rows.push(t.update('повторим методы защиты информации ещё раз',336000,464000));
  rows.push(t.flush());
  const accumulated=rows.map(x=>x.stable_delta).filter(Boolean).join(' ');
  assert.equal(accumulated,'Мы подробно рассмотрим методы защиты информации Теперь повторим методы защиты информации ещё раз');
});

test('adjacent hypothesis can correct uncertain word endings without rewriting stable prefix',()=>{
  const t=new TranscriptBuffer();const rows=[
    t.update('Сегодня мы рассмотрим способы защита информации',0,64000),
    t.update('мы рассмотрим способы защиты информации',16000,80000),
    t.update('рассмотрим способы защиты информации в школе',32000,96000),
    t.flush()
  ];
  assert.equal(rows.map(x=>x.stable_delta).filter(Boolean).join(' '),'Сегодня мы рассмотрим способы защиты информации в школе');
});
