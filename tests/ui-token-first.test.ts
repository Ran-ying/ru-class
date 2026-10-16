import test from 'node:test';
import assert from 'node:assert/strict';

const elements=new Map<string,any>();
function el(id:string){
  if(!elements.has(id))elements.set(id,{
    id,value:'',textContent:'',hidden:false,disabled:false,
    replaceChildren(...children:any[]){this.options=children;this.value=children[0]?.value||'';},
    setAttribute(name:string,value:string){this[name]=value;},
    showModal(){this.open=true;},
    close(){this.open=false;},
    append(){},
  });
  return elements.get(id)!;
}
(globalThis as any).document={
  getElementById:el,
  createElement:(tag:string)=>({tag,value:'',textContent:''})
};
(globalThis as any).window={addEventListener:()=>{},isSecureContext:true};
// Initialization is allowed to fail when the browser database is unavailable;
// these tests exercise only the unsaved model-discovery flow.
(globalThis as any).indexedDB={open:()=>{throw Error('NO_IDB_TEST_FIXTURE');}};
const requests:any[]=[];
let mode:'models'|'unauthorized'|'manual'='models';
(globalThis as any).fetch=async(url:string,options:any)=>{
  assert.match(url,/^https:\/\/[^/]+\/v1\/models$/);
  assert.equal(options.credentials,'omit');
  requests.push({url,authorization:options.headers.Authorization});
  if(mode==='unauthorized')return new Response('',{status:401});
  if(mode==='manual')return new Response('',{status:404});
  return new Response(JSON.stringify({data:[{id:'small'},{id:'tiny'}]}),{status:200});
};
// @ts-ignore Tested browser module intentionally has no TypeScript declarations.
await import('../apps/web/app.js');

async function clickList(kind:string){
  el(kind+'-list').onclick();
  for(let i=0;i<30;i++){
    await new Promise(r=>setImmediate(r));
    if(el(kind+'-discovery').hidden||el(kind+'-model-count').textContent.includes('401/403'))break;
  }
}
test('all provider cards reveal Token immediately and pass it to model discovery',async()=>{
  el('settings-open').onclick();
  for(const kind of ['speech','image','text']){
    assert.equal(el(kind+'-discovery').hidden,false);
    assert.equal(el(kind+'-model-stage').hidden,true);
    assert.equal(el(kind+'-key-wrap').hidden,false);
    const url='https://'+kind+'.example/v1';
    const key=kind+'-secret';
    el(kind+'-url').value=url;el(kind+'-url').oninput();
    el(kind+'-key').value=key;el(kind+'-key').oninput();
    assert.equal(el(kind+'-key').value,key);
    assert.equal(el(kind+'-discovery').hidden,false);
    await clickList(kind);
    assert.equal(el(kind+'-model-stage').hidden,false);
    assert.equal(el(kind+'-model-choice').hidden,false);
    assert.equal(el(kind+'-discovery').hidden,true);
    assert.equal(el(kind+'-key-wrap').hidden,false);
    assert.equal(requests.at(-1).authorization,'Bearer '+key);
    assert.equal(requests.at(-1).url,url+'/models');
    el(kind+'-model-select').value='small';el(kind+'-model-select').onchange();
    assert.equal(el(kind+'-actions').hidden,false);
    el(kind+'-key').value=key+'-changed';el(kind+'-key').oninput();
    assert.equal(el(kind+'-model-stage').hidden,true,'A changed key invalidates the old model choices');
    assert.equal(el(kind+'-discovery').hidden,false);
    assert.equal(el(kind+'-key').value,key+'-changed','Changing Token must never clear its current draft');
  }
});
test('401 preserves the Token input and fetch button for retry; no extra Token step',async()=>{
  mode='unauthorized';
  const kind='speech';
  el(kind+'-url').value='https://restricted.example/v1';el(kind+'-url').oninput();
  el(kind+'-key').value='wrong-key';el(kind+'-key').oninput();
  await clickList(kind);
  assert.equal(el(kind+'-key-wrap').hidden,false);
  assert.equal(el(kind+'-discovery').hidden,false);
  assert.equal(el(kind+'-model-stage').hidden,true);
  assert.match(el(kind+'-model-count').textContent,/401\/403/);
  mode='models';
  el(kind+'-key').value='correct-key';el(kind+'-key').oninput();
  await clickList(kind);
  assert.equal(el(kind+'-discovery').hidden,true);
  assert.equal(el(kind+'-model-stage').hidden,false);
  assert.equal(requests.at(-1).authorization,'Bearer correct-key');
});
test('API without /models supports manual input while keeping Token above the result',async()=>{
  const kind='image';
  mode='manual';
  el(kind+'-url').value='https://manual.example/v1';el(kind+'-url').oninput();
  el(kind+'-key').value='my-token';el(kind+'-key').oninput();
  await clickList(kind);
  assert.equal(el(kind+'-model-manual-wrap').hidden,false);
  assert.equal(el(kind+'-model-choice').hidden,true);
  assert.equal(el(kind+'-key-wrap').hidden,false);
  el(kind+'-model').value='custom-model';el(kind+'-model').oninput();
  assert.equal(el(kind+'-actions').hidden,false);
});
