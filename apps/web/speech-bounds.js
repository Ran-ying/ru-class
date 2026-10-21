// v0.6 playback refinement. Whisper segment times can span a pause (under VAD a
// segment's start/end are mapped back around removed silence), so a sentence's
// estimated range may begin or end seconds inside silence. Using the recorded
// audio itself, trim leading/trailing quiet frames of [from, to), and finish a
// word the estimate cut mid-speech (at most 0.8 s).
export const FRAME_SAMPLES=320; // 20 ms at 16 kHz
const MIN_SPEECH_FRAMES=3;      // 60 ms of energy before a frame counts as speech

function percentile(sorted,p){
  return sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]:0;
}
const MERGE_GAP_FRAMES=15;      // pauses under 0.3 s stay inside one speech island
const STRAY_FRAMES=12;          // an edge island under 0.25 s ...
const STRAY_GAP_FRAMES=40;      // ... cut off by >=0.8 s of quiet is a stray tail
const EXTEND_FRAMES=40;         // finish speech cut by the estimate: up to 0.8 s
const SENTENCE_GAP_FRAMES=25;   // a pause >=0.5 s can separate two sentences
/**
 * @param {Int16Array} pcm  16 kHz mono context audio, sample 0 = contextStart
 * @param {number} from     range start, samples relative to the context
 * @param {number} to       range end (exclusive), relative to the context
 * @param {{prevEnd?:number,nextStart?:number}} neighbours  adjacent sentences'
 *   estimated end/start (same relative samples). A leading speech island that
 *   ends before prevEnd, or a trailing one that starts after nextStart, is the
 *   neighbour's speech leaking across a pause; it is dropped if another remains.
 * @returns {{from:number,to:number,trimmed:boolean}}
 */
export function speechBounds(pcm,from,to,{prevEnd=-Infinity,nextStart=Infinity}={}){
  const frames=Math.floor(pcm.length/FRAME_SAMPLES);
  if(frames<MIN_SPEECH_FRAMES||!(to>from))return {from,to,trimmed:false};
  const energy=new Float64Array(frames);
  for(let f=0;f<frames;f++){
    let sum=0;
    for(let i=f*FRAME_SAMPLES;i<(f+1)*FRAME_SAMPLES;i++)sum+=pcm[i]*pcm[i];
    energy[f]=Math.sqrt(sum/FRAME_SAMPLES);
  }
  // The noise floor and speech level come from the whole context, so the
  // threshold adapts to a quiet room, a noisy classroom or a distant mic.
  const sorted=[...energy].sort((a,b)=>a-b);
  const floor=percentile(sorted,0.2),peak=percentile(sorted,0.95);
  if(peak<=floor*1.5)return {from,to,trimmed:false}; // no clear speech/silence contrast
  const threshold=floor+0.08*(peak-floor);
  // Search 0.8 s beyond the estimate, then keep only speech islands that
  // overlap the estimate itself. A word the estimate cut mid-speech merges into
  // its island and is finished; speech after a real pause is a separate island
  // and stays out. Neighbour estimates are NOT used as a hard limit here: they
  // can be seconds off when a Whisper segment spans a pause.
  const fromFrame=Math.floor(from/FRAME_SAMPLES),toFrame=Math.ceil(to/FRAME_SAMPLES);
  const first=Math.max(0,fromFrame-EXTEND_FRAMES);
  const last=Math.min(frames-1,toFrame-1+EXTEND_FRAMES);
  // Speech islands: runs of >=60 ms energy, bridging pauses under 0.3 s.
  const found=[];
  for(let f=first;f<=last;){
    let run=0;
    while(f+run<=last&&energy[f+run]>=threshold)run++;
    if(run>=MIN_SPEECH_FRAMES){
      const prev=found.at(-1);
      if(prev&&f-prev[1]<MERGE_GAP_FRAMES)prev[1]=f+run;
      else found.push([f,f+run]);
    }
    f+=Math.max(1,run);
  }
  const islands=found.filter(([a,b])=>b>fromFrame&&a<toFrame);
  if(!islands.length)return {from,to,trimmed:false}; // never silence a sentence entirely
  const at=frame=>frame*FRAME_SAMPLES;
  const stray=(island,gap)=>island[1]-island[0]<STRAY_FRAMES&&gap>=STRAY_GAP_FRAMES;
  // An edge island is the neighbour's speech when it lies within the
  // neighbour's estimate, or when a sentence-length pause separates it and it
  // began before BOTH this estimate and the neighbour's estimated end (or,
  // mirrored, ended after both). Estimates alone can be seconds off.
  const previous=([a,b],gap)=>at(b)<=prevEnd||(gap>=SENTENCE_GAP_FRAMES&&a<fromFrame&&at(a)<prevEnd);
  const following=([a,b],gap)=>at(a)>=nextStart||(gap>=SENTENCE_GAP_FRAMES&&b>toFrame&&at(b)>nextStart);
  while(islands.length>1){
    const gap=islands[1][0]-islands[0][1];
    if(!previous(islands[0],gap)&&!stray(islands[0],gap))break;
    islands.shift();
  }
  while(islands.length>1){
    const gap=islands.at(-1)[0]-islands.at(-2)[1];
    if(!following(islands.at(-1),gap)&&!stray(islands.at(-1),gap))break;
    islands.pop();
  }
  const bounded={from:at(islands[0][0]),to:at(islands.at(-1)[1])};
  return {...bounded,trimmed:bounded.from!==from||bounded.to!==to};
}
