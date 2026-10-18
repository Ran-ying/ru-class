import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('v0.4 refreshes one persistent history row per recording after LLM commit, never duplicates it',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  const start=app.indexOf('function showBilingualSentenceRows(');
  const end=app.indexOf('function startSentenceWorker(',start);
  const action=app.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(action,/renderSelectedClassroom\(\{historyOnly:true\}\)/);
  assert.match(action,/renderCaption\(\);/,
    'acknowledged source fragments must immediately leave the lower RU area');
  assert.doesNotMatch(action,/holder\.append\(|createElement\('article'\)/);
  assert.match(app,/article\.dataset\.recordingId=session\.id/);
  assert.match(app,/pair\.className='history-sentence-row'/);
  assert.match(app,/pair\.append\(ru,zh\)/);
  assert.match(app,/pendingTranscriptAfterCommits\(last,translations\.at\(-1\)\|\|\[\]\)/);
  assert.match(app,/renderCaption\(\);/);
});

test('background history refresh during microphone use retains live RU stable and draft text',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  const start=app.indexOf('async function renderSelectedClassroom(');
  const end=app.indexOf('async function refreshClassrooms(',start);
  const render=app.slice(start,end);
  assert.match(render,/\{historyOnly=false\}=\{\}/);
  const guards=render.match(/if\(revision!==classroomRevision\|\|key!==activeClassroom\?\.key\|\|\(!historyOnly&&\(starting\|\|running\)\)\)return/g)||[];
  assert.equal(guards.length,2,
    'both asynchronous IndexedDB reads must accept history-only refreshes during live recording');
  assert.ok(render.includes('if(historyOnly)return; //'));
  assert.ok(render.indexOf('if(historyOnly)return')<render.indexOf('if(last && sourceJournal?.recordingId==='),'history-only load must exit before modifying current RU');
});

test('v0.4 text model is correctly described as active history processing, not future placeholder',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  const html=readFileSync('apps/web/index.html','utf8');
  assert.match(html,/逐句生成正式俄语校正与中文翻译/);
  assert.match(html,/id="translation-status"/);
  assert.doesNotMatch(html,/中文翻译将在后续版本提供/);
  const css=readFileSync('apps/web/style.css','utf8');
  assert.match(css,/\.history-sentence-row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css,/\.history-sentence-row p\[lang="zh-CN"\]\{[^}]*border-left:1px solid/);
  assert.doesNotMatch(css,/\.history-sentence-row\{[^}]*background:#edf2eb/);
  assert.doesNotMatch(app,/label\.textContent='录音 '\+/);
});
