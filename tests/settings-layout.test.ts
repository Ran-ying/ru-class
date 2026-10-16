import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('settings title, pill tabs and close are siblings in a non-scrolling header',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  const header=html.match(/<div class="settings-heading">([\s\S]*?)<\/div>\s*<div class="settings-body">/)?.[1];
  assert.ok(header,'Settings heading should end before the scrollable body');
  assert.ok(header.indexOf('id="settings-title"')<header.indexOf('class="settings-tabs"'));
  assert.ok(header.indexOf('class="settings-tabs"')<header.indexOf('class="close-button"'));
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
