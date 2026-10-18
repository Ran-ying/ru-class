import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the middle of the two main panes is separated by one thin border only',()=>{
 const css=readFileSync('apps/web/style.css','utf8');
 assert.match(css,/main>\.transcription\{border-left:1px solid #[0-9a-f]{6}\}/i);
 assert.match(css,/@media\(max-width:760px\)\{\s*main>\.transcription\{border-left:0;border-top:1px/);
});
test('live RU zone has one subtle full-width hairline separating it from bilingual history',()=>{
 const html=readFileSync('apps/web/index.html','utf8');
 const css=readFileSync('apps/web/style.css','utf8');
 const history=html.indexOf('<section class="history">');
 const live=html.indexOf('<section class="live">');
 assert.ok(history>=0&&live>history,'RU live pane follows classroom history');
 assert.ok(css.includes('.transcription .live{border-top:1px solid #d9e2d9;background:transparent}'));
 assert.ok(!css.includes('.transcription .live{border-top:0'));
});
test('rename form is scoped to the selected course and maintains recording UUIDs',()=>{
 const html=readFileSync('apps/web/index.html','utf8');
 const js=readFileSync('apps/web/app.js','utf8');
 const store=readFileSync('apps/web/local-store.js','utf8');
 for(const element of ['classroom-rename','classroom-rename-title','classroom-rename-form',
   'classroom-rename-submit','classroom-rename-cancel','classroom-rename-feedback']){
   assert.match(html,new RegExp('id="'+element+'"'));
 }
 assert.match(js,/await renameClassroom\(source\.key,\$\('classroom-rename-title'\)\.value\)/);
 assert.match(js,/await refreshClassrooms\(renamed\.key\)/);
 assert.match(store,/db\.transaction\(\['classrooms','lessons'\],'readwrite'\)/);
 assert.match(store,/classroomId:result\.id/);
 assert.doesNotMatch(store,/db\.transaction\(\['classrooms','audio'/);
});
test('classroom history spans successive recordings and reserves untranslated Chinese without fake translations',()=>{
 const html=readFileSync('apps/web/index.html','utf8');
 const app=readFileSync('apps/web/app.js','utf8');
 assert.match(html,/id="session-history"/);
 assert.match(app,/const sessions=await listClassroomRecordings\(key\)/);
 assert.match(app,/for\(const \[index,session\] of sessions\.entries\(\)\)/);
 assert.match(app,/const sentences=document\.createElement\('div'\)/);
 assert.match(app,/sentences\.className='session-sentences'/);
 assert.match(app,/pair\.className='history-sentence-row'/);
 assert.match(app,/pair\.append\(ru,zh\)/);
 assert.match(app,/history-remaining/);
 assert.match(app,/pendingTranscriptAfterCommits\(session,rows\)/);
 assert.match(app,/index\+1/);
});
