import {TranscriptBuffer} from './transcript.js';
import {inspectHypothesis} from './asr-loop-risk.js';

/**
 * P1 controlled candidate: strictly per-NEW-SESSION lexical-loop quarantine.
 *
 * Active only if explicitly constructed. Never hot-swap a running
 * TranscriptBuffer, which has already emitted immutable stable_delta.
 * A suspect result is kept out of the *candidate* reducer only; the
 * source ASR journal must record it independently before projection.
 *
 * No raw word text is exposed by metrics. No text is auto-restored.
 */
export class LoopQuarantineTranscript {
  constructor(){
    this.buffer=new TranscriptBuffer();
    this.lastInputStart=-1;
    this.lastInputEnd=-1;
    this.quarantinedWindows=[];
    this.observedWindows=0;
  }
  get unanchoredReplacementCount(){return this.buffer.unanchoredReplacementCount;}
  get unanchoredReplacementTokens(){return this.buffer.unanchoredReplacementTokens;}
  update(text,start,end,final=false){
    // Validate against ALL observed windows, even those quarantined.
    if(typeof text!=='string'||text.length>20000)
      throw Error('INVALID_HYPOTHESIS');
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
       start<0||end<=start||end<this.lastInputEnd)
      throw Error('TRANSCRIPT_WINDOW_ORDER');
    if(start===this.lastInputStart&&end===this.lastInputEnd){
      return final?this.flush():this.buffer.state();
    }
    const inspected=inspectHypothesis(text,start,end);
    this.lastInputStart=start;
    this.lastInputEnd=end;
    const index=this.observedWindows++;
    if(inspected.lexicalLoopRisk){
      this.quarantinedWindows.push({
        index,windowStartSample:start,windowEndSample:end,
        tokenCount:inspected.tokenCount,
        uniqueCount:inspected.uniqueCount,
        maxRepeatedTrigram:inspected.maxRepeatedTrigram
      });
      return final?this.flush():this.buffer.state();
    }
    return this.buffer.update(text,start,end,final);
  }
  state(){return this.buffer.state();}
  flush(){return this.buffer.flush();}
  // Privacy-safe snapshot for local-only tests and diagnostic replay.
  diagnostics(){
    return {observedWindows:this.observedWindows,
      quarantinedWindows:this.quarantinedWindows.map(row=>({...row}))};
  }
}
