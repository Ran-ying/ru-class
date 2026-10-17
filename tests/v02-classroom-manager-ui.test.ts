import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('dated classroom heading occupies whole left half with no dropdown, painted background or border',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  assert.match(html,/<time id="classroom-date">/);
  assert.match(html,/<h1 id="classroom-title">/);
  assert.match(html,/<button id="classroom-add"[^>]*>\+<\/button>/);
  assert.doesNotMatch(html,/id="classroom-select"/);
  assert.match(css,/\.workspace-top\{[^}]*width:100%;max-width:none;/);
  assert.match(css,/\.workspace-top\{[^}]*background:transparent;border:0/);
  assert.match(css,/#classroom-add\{[^}]*margin-left:auto/);
});
test('actual DOM id exists for classroom-select unlock and model Settings stays accessible',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const js=readFileSync('apps/web/app.js','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  assert.match(html,/<section id="transcription" class="transcription is-locked"/);
  assert.match(html,/id="transcription-lock"/);
  assert.match(js,/\$\('transcription'\)\.classList\.toggle\('is-locked',!activeClassroom\)/);
  assert.match(js,/\$\('transcription-lock'\)\.hidden=Boolean\(activeClassroom\)/);
  assert.match(js,/\$\('record'\)\.disabled=stopping\|\|starting\|\|!activeClassroom/);
  assert.match(css,/\.transcription\{position:relative;border:0;background:transparent\}/);
  assert.match(html,/id="settings-open"/);
});
test('plus opens large two-column scoped course manager and local-data settings no longer exists',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  const js=readFileSync('apps/web/app.js','utf8');
  assert.match(html,/id="classroom-dialog"/);
  assert.match(html,/id="classroom-list"/);
  assert.match(html,/id="classroom-records-title"/);
  assert.match(html,/id="local-lessons"/);
  assert.match(html,/id="local-player"/);
  assert.match(html,/id="clear-local"/);
  assert.doesNotMatch(html,/id="panel-access"|id="tab-access"|本地课堂记录/);
  assert.match(css,/#classroom-dialog\{[^}]*width:min\(1120px/);
  assert.match(css,/\.classroom-panel-body\{[^}]*grid-template-columns:/);
  assert.match(js,/const lessons=await listClassroomRecordings\(key\)/);
  assert.match(js,/if\(revision!==recordsRevision\|\|key!==activeClassroom\?\.key\)return/);
  assert.doesNotMatch(js,/\$\('tab-access'\)/);
});
