import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser-only JS deliberately has no TypeScript declarations
import {captureHistoryScroll,restoreHistoryScroll} from '../apps/web/history-scroll.js';

const viewport=(scrollTop:number,scrollHeight:number,clientHeight=300)=>({
  scrollTop,scrollHeight,clientHeight
});
test('when reader is at bottom, a new sentence keeps the newest sentence visible',()=>{
  const panel=viewport(700,1000);
  const state=captureHistoryScroll(panel);
  panel.scrollHeight=1240;
  restoreHistoryScroll(panel,state);
  assert.equal(panel.scrollTop,940);
});
test('when reader scrolls up, incoming sentences never disturb their position',()=>{
  const panel=viewport(400,1000);
  const state=captureHistoryScroll(panel);
  panel.scrollHeight=1280;
  restoreHistoryScroll(panel,state);
  assert.equal(panel.scrollTop,400);
});
test('near-bottom 6px tolerance follows, but further up does not',()=>{
  assert.equal(captureHistoryScroll(viewport(695,1000)).follow,true);
  assert.equal(captureHistoryScroll(viewport(690,1000)).follow,false);
});
test('switching courses starts at the latest sentence, even if prior course scrolled up',()=>{
  const panel=viewport(100,1000);
  const state=captureHistoryScroll(panel,{switchingClassroom:true});
  panel.scrollHeight=900;
  restoreHistoryScroll(panel,state);
  assert.equal(panel.scrollTop,600);
});
test('scroll position is sampled after async work, not when fetch begins',()=>{
  const panel=viewport(700,1000);
  panel.scrollTop=200; // reader scrolls during database fetch
  const state=captureHistoryScroll(panel);
  panel.scrollHeight=1250;
  restoreHistoryScroll(panel,state);
  assert.equal(panel.scrollTop,200);
});
