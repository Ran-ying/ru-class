import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
// @ts-ignore Browser/CLI JavaScript intentionally has no TypeScript declaration.
import {auditAmbiguousReplacements} from '../scripts/audit-private-replacements.mjs';

function row(text:string,i:number,final=false){
  return {text,window_start_sample:i*16000,window_end_sample:(i+8)*16000,final};
}
test('audit attributes replacement event to exact source and replacement windows without emitting text',()=>{
  const input={windows:[
    row('alpha beta gamma',0),
    row('delta echo foxtrot',1),
    row('golf hotel india',2,true)
  ]};
  const result=auditAmbiguousReplacements(input);
  assert.equal(result.format,'ru-class-numeric-unanchored-audit-v1');
  assert.equal(result.inputWindows,3);
  assert.equal(result.ambiguousCandidateReplacements,1);
  assert.equal(result.ambiguousCandidateTokens,3);
  assert.equal(result.finalWordCount,6);
  assert.deepEqual(result.events.map((x:any)=>({
    source:x.candidateSourceWindowIndex, replacing:x.replacingWindowIndex,
    tokens:x.candidateTokens, start:x.candidateSourceStartSample,end:x.replacingWindowEndSample
  })),[{source:1,replacing:2,tokens:3,start:16000,end:160000}]);
  assert.equal(result.events[0].finalLexicalMultisetMatches,0);
  assert.equal(result.events[0].longestContiguousFinalMatch,0);
  assert.doesNotMatch(JSON.stringify(result),/alpha|delta|foxtrot|golf/);
});
test('no replacement is invented when an overlapping window has an anchor',()=>{
  const rows=[
    row('Сегодня мы говорим о защите',0),
    row('мы говорим о защите информации',1,true)
  ];
  const report=auditAmbiguousReplacements({windows:rows});
  assert.equal(report.ambiguousCandidateReplacements,0);
  assert.equal(report.ambiguousCandidateTokens,0);
  assert.deepEqual(report.events,[]);
});
test('invalid coordinates and missing hypotheses are rejected',()=>{
  assert.throws(()=>auditAmbiguousReplacements({windows:[]}),/INVALID_WINDOWS/);
  assert.throws(()=>auditAmbiguousReplacements({windows:[
    row('a',0),{text:'b',window_start_sample:16000,window_end_sample:1000}
  ]}),/INVALID_WINDOW_1/);
  assert.throws(()=>auditAmbiguousReplacements({windows:[
    row('a',0),{window_start_sample:16000,window_end_sample:144000}
  ]}),/INVALID_WINDOW_1/);
});
test('CLI prints only numbers and has no raw-window secret, path or text leakage',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-private-diagnostics-'));
  try{
    const file=join(dir,'lesson-private.json');
    await writeFile(file,JSON.stringify({windows:[
      row('alpha beta gamma',0),
      row('PRIVATE_TEXT_TOKEN_LIKE_PASSWORD echo foxtrot',1),
      row('golf hotel india',2,true)
    ]}));
    const cli=resolve('scripts/audit-private-replacements.mjs');
    const output=execFileSync(process.execPath,[cli,file],{encoding:'utf8'});
    const data=JSON.parse(output);
    assert.equal(data.ambiguousCandidateReplacements,1);
    assert.doesNotMatch(output,/PRIVATE_TEXT_TOKEN_LIKE_PASSWORD|lesson-private|alpha|delta|golf/);
  }finally{await rm(dir,{recursive:true,force:true});}
});