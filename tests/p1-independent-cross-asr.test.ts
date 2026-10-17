import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('P1 private independent ASR workflow: synthetic stdlib tests; never invoke real ASR', t=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests',
    '-p','test_private_cross_asr.py','-v'],{encoding:'utf8'});
  if((run.error as NodeJS.ErrnoException | undefined)?.code==='ENOENT'){t.skip('python3 unavailable; macOS local P1 runner uses Python');return;}
  assert.equal(run.status,0,
    'Private ASR Python fixture tests failed (all fixtures are synthetic): '+(run.stderr||run.stdout));
  assert.match(run.stderr||run.stdout,/Ran 5 tests/);
  assert.doesNotMatch((run.stderr||'')+(run.stdout||''),/Тайный русский|Совершенно другой текст/,
    'ASR recognized text is never printed by the test runner');
});
