#!/usr/bin/env node
/**
 * Run locally on PRIVATE Safari-exported ASR JSON. Never upload classroom data
 * to CI/GitHub; report only numerical consistency. No audio or network used.
 *
 * node scripts/audit-stable-source.mjs /private/path/asr-windows.json
 */
import {readFileSync} from 'node:fs';
import {auditStableSourceExport} from '../apps/web/stable-source-audit.js';

if(process.argv.length!==3){
  process.stderr.write('Usage: node scripts/audit-stable-source.mjs <private-asr-windows.json>\n');
  process.exitCode=2;
}else{
  try{
    const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const result=auditStableSourceExport(input);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.status==='source_unit_mismatch')process.exitCode=1;
  }catch(e){
    // Avoid leaking a private filename or classroom text through error.message.
    const code=e instanceof Error&&/^([A-Z_]+)$/.test(e.message)?e.message:'PRIVATE_REPLAY_FAILED';
    process.stderr.write('Stable source audit failed: '+code+'\n');
    process.exitCode=1;
  }
}
