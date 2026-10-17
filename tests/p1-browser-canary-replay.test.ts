import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-ignore: offline-only JS CLI uses real browser modules.
import {compareSessionCanary} from '../scripts/replay-session-loop-canary.mjs';

const S=16000;
const message='Сегодня обсуждаем банковские платежи и информацию';
const final='Теперь обсудим электронный кошелёк и защиту информации';
const abnormal=Array.from({length:164},(_,i)=>
  ['Я','не','могу','этого','сейчас','понять','вовсе'][i%7]).join(' ');

test('browser canary equals baseline on all clean rolling windows and final text',()=>{
  const rows=[
    {text:message,start:0,end:8*S},
    {text:'обсуждаем банковские платежи и информацию подробно',start:S,end:9*S},
    {text:'банковские платежи и информацию подробно сегодня',start:2*S,end:10*S,final:true}
  ];
  const r=compareSessionCanary(rows);
  assert.deepEqual(r.flaggedIndices,[]);
  assert.deepEqual(r.visibleDifferentIndices,[]);
  assert.deepEqual(r.stableDifferentIndices,[]);
  assert.equal(r.counts.finalStringsEqual,true);
  assert.deepEqual(r.mechanicalContracts,{
    firstStopViolations:0,sameRangeReplayViolations:0,doubleFlushStableGrowth:false
  });
});

test('C2-like sequence flags its original extreme loop window without hiding next window',()=>{
  const rows=[
    {text:message,start:0,end:8*S},
    {text:abnormal,start:S,end:9*S},
    {text:final,start:2*S,end:10*S,final:true}
  ];
  const r=compareSessionCanary(rows);
  assert.deepEqual(r.flaggedIndices,[1]);
  assert.equal(r.flaggedMetrics[0].tokenCount,164);
  assert.ok(r.visibleDifferentIndices.includes(1));
  assert.equal(r.mechanicalContracts.firstStopViolations,0);
  assert.equal(r.mechanicalContracts.sameRangeReplayViolations,0);
  assert.equal(r.mechanicalContracts.doubleFlushStableGrowth,false);
  assert.equal(r.productionDefaultChanged,false);
  assert.equal(r.humanWordTruthVerified,false);
  assert.doesNotMatch(JSON.stringify(r),/банковские|кошелёк|понять/);
});

test('disjoint real repeated utterances do not cause false lexical loops',()=>{
  const phrase='Я могу узнать когда вы платили';
  const r=compareSessionCanary([
    {text:phrase,start:0,end:2*S},
    {text:phrase,start:12*S,end:14*S,final:true}
  ]);
  assert.equal(r.counts.finalStringsEqual,true);
  assert.equal(r.counts.finalBaselineWords,12);
  assert.deepEqual(r.flaggedIndices,[]);
});

test('private JSON CLI prints only numeric data and refuses silently reordered source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ru-class-browser-canary-'));
  try{
    const file=join(dir,'private-windows.json');
    writeFileSync(file,JSON.stringify([
      {text:message,window_start_sample:0,window_end_sample:8*S},
      {text:abnormal,window_start_sample:S,window_end_sample:9*S},
      {text:final,window_start_sample:2*S,window_end_sample:10*S,final:true}
    ]));
    const run=spawnSync(process.execPath,['scripts/replay-session-loop-canary.mjs',file],
      {cwd:process.cwd(),encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.equal(JSON.parse(run.stdout).counts.quarantinedWindows,1);
    assert.doesNotMatch(run.stdout+run.stderr,
      /банковские|кошелёк|понять|private-windows|ru-class-browser-canary/);
    writeFileSync(file,JSON.stringify([
      {text:message,window_start_sample:0,window_end_sample:8*S},
      {text:final,window_start_sample:0,window_end_sample:2*S}
    ]));
    const invalid=spawnSync(process.execPath,['scripts/replay-session-loop-canary.mjs',file],
      {cwd:process.cwd(),encoding:'utf8'});
    assert.equal(invalid.status,1);
    assert.doesNotMatch(invalid.stderr,/private-windows|банковские/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
