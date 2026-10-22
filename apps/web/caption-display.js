// Display-only smoothing of the replaceable ASR draft. It never changes what
// the TranscriptBuffer confirms or what is sent to history; it only decides
// which draft words are worth painting now.
//
// Whisper re-decodes the whole overlapping window every step, so the newest
// words (cut by the window edge) and their endings change from one window to
// the next. A word is shown once two consecutive hypotheses agree on it; at
// most `fresh` not-yet-agreed words are shown after that, so new speech still
// appears promptly. Words already on screen are not taken back unless the new
// hypotheses disagree with them.

const key=word=>String(word).toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]/gu,'');
const words=text=>String(text||'').trim().split(/\s+/u).filter(Boolean);
function commonPrefix(a,b){
  let n=0;
  while(n<a.length&&n<b.length&&key(a[n])===key(b[n]))n++;
  return n;
}

export class DraftDisplay{
  constructor({fresh=1}={}){
    this.fresh=fresh;
    this.previous=[];  // previous raw draft hypothesis
    this.shown=[];     // draft words currently painted
    this.stable='';
  }
  /**
   * @param {string} partial  the latest raw draft (TranscriptBuffer partial_text)
   * @param {string} stable   the confirmed text before it (to detect promotion)
   * @returns {string} the draft to paint
   */
  update(partial,stable=''){
    const next=words(partial);
    if(stable!==this.stable){
      // Words were confirmed: the draft now starts later. Drop what moved
      // out of the draft so the comparison is aligned again.
      const promoted=words(stable).length-words(this.stable).length;
      this.stable=stable;
      if(promoted>0){
        this.previous=this.previous.slice(promoted);
        this.shown=this.shown.slice(promoted);
      }
    }
    if(!next.length){this.previous=[];this.shown=[];return '';}
    const agreed=commonPrefix(this.previous,next);
    let count=Math.min(next.length,agreed+this.fresh);
    // Keep words that are on screen and still match the new hypothesis, even
    // if the previous hypothesis disagreed (avoids blink-out / blink-in).
    const kept=commonPrefix(this.shown,next);
    count=Math.max(count,Math.min(kept,next.length));
    this.previous=next;
    // Paint the new hypothesis' spelling for agreed words (they may gain
    // punctuation), but never more than `count` words.
    this.shown=next.slice(0,count);
    return this.shown.join(' ');
  }
  reset(){this.previous=[];this.shown=[];this.stable='';}
}
