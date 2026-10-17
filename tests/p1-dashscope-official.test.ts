import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('official Beijing DashScope ASR cross-check uses synthetic/mock credentials only',t=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests',
    '-p','test_private_dashscope_asr.py','-v'],{encoding:'utf8'});
  if((run.error as NodeJS.ErrnoException | undefined)?.code==='ENOENT'){
    t.skip('python3 unavailable; official-ASR tests require Python stdlib');
    return;
  }
  assert.equal(run.status,0,'Official ASR mock-contract suite failed: '+(run.stderr||run.stdout));
  assert.match(run.stderr||run.stdout,/Ran 6 tests/);
  assert.doesNotMatch((run.stderr||'')+(run.stdout||''),/Приватная оригинальная|Независимая гипотеза|private-token/,
    'Never emit the synthetic key or private transcript');
});
