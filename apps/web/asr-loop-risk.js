/**
 * Conservative, language-agnostic token-loop risk signal for 16-kHz
 * rolling ASR windows. Pure browser-compatible JavaScript.
 *
 * This is not a speech detector or word-accuracy measure. Real rapid,
 * repetitive speech may satisfy all four thresholds.
 */
export const LOOP_RISK_CRITERIA=Object.freeze({
  minTokens:40,
  minTokensPerSecond:8,
  maxUniqueRatio:0.25,
  minRepeatedTrigram:8
});
const RATE=16000;
export function inspectHypothesis(text,start,end){
  if(typeof text!=='string'||text.length>20000)throw Error('INVALID_HYPOTHESIS');
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)
    throw Error('INVALID_AUDIO_RANGE');
  const words=text.normalize('NFKC').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu)??[];
  const tokenCount=words.length;
  const durationSeconds=(end-start)/RATE;
  const wordRate=tokenCount/durationSeconds;
  const uniqueCount=new Set(words).size;
  const repeated=new Map();
  let maxRepeatedTrigram=0;
  for(let i=2;i<words.length;i++){
    const gram=words[i-2]+'\0'+words[i-1]+'\0'+words[i];
    const count=(repeated.get(gram)??0)+1;
    repeated.set(gram,count);
    maxRepeatedTrigram=Math.max(maxRepeatedTrigram,count);
  }
  const uniqueRatio=tokenCount?uniqueCount/tokenCount:1;
  const lexicalLoopRisk=tokenCount>=LOOP_RISK_CRITERIA.minTokens
    &&wordRate>=LOOP_RISK_CRITERIA.minTokensPerSecond
    &&uniqueRatio<=LOOP_RISK_CRITERIA.maxUniqueRatio
    &&maxRepeatedTrigram>=LOOP_RISK_CRITERIA.minRepeatedTrigram;
  return {tokenCount,uniqueCount,wordRate:+wordRate.toFixed(3),
    uniqueRatio:+uniqueRatio.toFixed(4),maxRepeatedTrigram,lexicalLoopRisk};
}
