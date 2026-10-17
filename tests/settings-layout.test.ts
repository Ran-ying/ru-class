import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('settings keeps model cards and a close control, with local recording data moved to course manager',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  const header=html.match(/<div class="settings-heading">([\s\S]*?)<\/div>\s*<div class="settings-body">/)?.[1];
  assert.ok(header,'Settings heading should end before the scrollable body');
  assert.ok(header.indexOf('id="settings-title"')<header.indexOf('class="close-button"'));
  assert.doesNotMatch(html,/id="panel-access"|id="tab-access"|id="tab-models"/);
  assert.match(html,/id="classroom-dialog"/);
  assert.match(html,/id="local-lessons"/);
  assert.match(html,/id="classroom-list"/);
  assert.match(css,/#settings\[open\]\s*\{display:flex;flex-direction:column/);
  assert.match(css,/#settings \.settings-body\{[^}]*overflow-y:auto/);
  for(const kind of ['speech','image','text']){
    assert.match(html,new RegExp('id="'+kind+'-model-select"'));
    assert.match(html,new RegExp('id="'+kind+'-list"'));
    assert.match(html,new RegExp('id="'+kind+'-model-manual-wrap"'));
  }
});


test('model selector and refresh use matching SVG dimensions and Token is directly editable',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  assert.match(css,/\.model-icon\{[^}]*width:20px;height:20px/);
  assert.match(css,/\.model-refresh-icon\{[^}]*width:20px;height:20px/);
  assert.match(css,/\.model-select-control select\{[^}]*appearance:none/);
  assert.match(css,/\.model-chevron-icon\{[^}]*right:13px/);
  assert.match(css,/\.model-card \[hidden\]\{display:none!important/);
  for(const kind of ['speech','image','text']){
    assert.match(html,new RegExp('id="'+kind+'-discovery"'));
    assert.match(html,new RegExp('id="'+kind+'-refresh"'));
    const card=html.match(new RegExp('<form class="model-card" id="model-'+kind+'">([\\s\\S]*?)<\\/form>'))?.[1];
    assert.ok(card,'Expected a model card for '+kind);
    const urlAt=card.indexOf('id="'+kind+'-url"');
    const tokenAt=card.indexOf('id="'+kind+'-key"');
    const discoveryAt=card.indexOf('id="'+kind+'-list"');
    const modelAt=card.indexOf('id="'+kind+'-model-stage" hidden');
    const actionsAt=card.indexOf('id="'+kind+'-actions" hidden');
    assert.ok(urlAt>=0&&urlAt<tokenAt&&tokenAt<discoveryAt&&discoveryAt<modelAt&&modelAt<actionsAt,
      'Expected URL → always-visible Token → fetch → hidden model choices → actions for '+kind);
    assert.match(card,new RegExp('id="'+kind+'-key-wrap"(?=>)'));
    assert.doesNotMatch(card,new RegExp('id="'+kind+'-token-stage"'));
    assert.doesNotMatch(html,new RegExp('id="'+kind+'-token-open"'));
    assert.match(html,new RegExp('class="model-icon model-chevron-icon"'));
    assert.match(html,new RegExp('class="model-icon model-refresh-icon"'));
  }
});


test('wide desktop settings align all three compact model cards in a row and wrap on narrower screens',()=>{
  const css=readFileSync('apps/web/style.css','utf8');
  const html=readFileSync('apps/web/index.html','utf8');
  const js=readFileSync('apps/web/app.js','utf8');
  assert.match(css,/#settings\{width:min\(1020px,calc\(100% - 32px\)\);padding:0\}/);
  assert.match(css,/#model-cards\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:12px;align-items:start;max-width:900px;margin-inline:auto\}/);
  assert.match(css,/@media\(max-width:960px\)\{[\s\S]*?#model-cards\{max-width:650px;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?#model-cards\{max-width:380px;grid-template-columns:minmax\(0,1fr\)/);
  for(const kind of ['speech','image','text']){
    assert.match(html,new RegExp('<form class="model-card" id="model-'+kind+'">'));
  }
  assert.doesNotMatch(js,/不会发送给 RU-Class 服务器/);
  assert.match(js,/已保存到此浏览器。/);
});

test('RU caption area stays mounted and blank until actual Russian text arrives',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  const js=readFileSync('apps/web/app.js','utf8');
  assert.match(html,/<div class="ru"><span class="label">RU<\/span><p id="ru" lang="ru" aria-live="polite"><span id="ru-stable" class="ru-stable"><\/span><span id="ru-draft" class="ru-draft"><\/span><\/p><\/div>/);
  assert.doesNotMatch(html,/id="connection-state"|id="status"|id="worker"/);
  assert.match(css,/\.live\{flex:0 0 clamp\(190px,36dvh,370px\);max-height:60%\}/);
  assert.match(css,/\.live \.ru\{flex:1;min-height:0;display:flex;flex-direction:column\}/);
  assert.match(css,/\.live \.ru #ru\{[\s\S]*?flex:1;min-height:0;max-height:none;/);
  assert.match(js,/function renderCaption\(\)/);
  assert.match(js,/\$\('ru-stable'\)\.textContent=stable/);
  assert.match(js,/\$\('ru-draft'\)\.textContent=/);
  assert.match(js,/renderCaption\(\);/);
  assert.doesNotMatch(js,/\$\('ru'\)\.hidden\s*=|panel\.hidden\s*=/);
  for(const placeholder of ['尚未连接','等待语音识别 API','录音中 · 俄语识别',
    '等待俄语语音…','开始录音后，俄语字幕将在这里更新。']){
    assert.ok(!html.includes(placeholder)&&!js.includes(placeholder),
      'RU should have no state-dependent placeholder: '+placeholder);
  }
});
