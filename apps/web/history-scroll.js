// Preserve reader intent across asynchronous IndexedDB history rebuilds.
// This module is used on the actual scrolling .history element, not the
// inner #session-history list, which has no independent overflow scroll.
export function captureHistoryScroll(el,{switchingClassroom=false}={}){
  const limit=Math.max(0,el.scrollHeight-el.clientHeight);
  const top=Math.max(0,Number(el.scrollTop)||0);
  return {follow:switchingClassroom||limit-top<=6,top};
}
export function restoreHistoryScroll(el,state){
  const end=Math.max(0,el.scrollHeight-el.clientHeight);
  el.scrollTop=state.follow?end:Math.min(state.top,end);
}
