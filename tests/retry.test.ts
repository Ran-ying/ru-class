import test from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '../apps/server/src/session.js';
import {event,type AudioHeader} from '../apps/server/src/protocol.js';

test('temporary 429 retries succeed without aborting the classroom recording',async()=>{
  let calls=0,errors=0;
  const results:string[]=[];
  const session=new Session({infer:async()=>{
    calls++;
    if(calls<=2)throw new Error('ASR_HTTP_429');
    return 'Русский текст.';
  }},r=>results.push(r.text),()=>errors++);
  for(let seq=0;seq<10;seq++){
    const payload={seq,start_sample:seq*3200,sample_count:3200,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:seq*9600,source_end_sample:(seq+1)*9600};
    session.push({...event('audio.frame','retry-session-123456'),type:'audio.frame',payload} as AudioHeader,Buffer.alloc(6400));
  }
  await session.stop();
  assert.equal(calls,3);assert.deepEqual(results,['Русский текст.']);assert.equal(errors,0);
});
