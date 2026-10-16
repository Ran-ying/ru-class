/**
 * Best-effort LocalAgreement-style text accumulator for overlapping Whisper
 * windows.  The audio is intentionally bounded, but stable text is NOT.
 *
 * Whisper's v0.1 API returns window text (no word timestamps), so alignment
 * cannot prove that every repeated spoken word was recognised exactly once.
 * Stable text is immutable; a small right-hand draft is rewritten on updates.
 * No DeepSeek sentence consumption occurs in this version.
 */
type Word = {display: string; key: string};
export type TranscriptUpdate = {stable_delta: string; partial_text: string; revision: number};

function words(text: string): Word[] {
  return text.trim().split(/\s+/u).filter(Boolean).map(display => ({
    display,
    key: display.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  }));
}
function equal(a: Word, b: Word): boolean { return !!a.key && a.key === b.key; }
function joined(tokens: Word[]): string { return tokens.map(w => w.display).join(' '); }

type Match = {old: number; next: number; length: number};
/** Prefer a long, contiguous lexical anchor near the end of the old text. */
function overlap(oldWords: Word[], newWords: Word[], minLength = 2): Match | undefined {
  const offset = Math.max(0, oldWords.length - 96);
  const old = oldWords.slice(offset);
  const prev = new Uint16Array(newWords.length + 1);
  let best: Match | undefined;
  let bestScore = -Infinity;
  for (let i = 1; i <= old.length; i++) {
    const curr = new Uint16Array(newWords.length + 1);
    for (let j = 1; j <= newWords.length; j++) {
      if (!equal(old[i - 1], newWords[j - 1])) continue;
      const length = curr[j] = prev[j - 1] + 1;
      if (length < minLength) continue;
      const oldEnd = offset + i;
      const score = length * 100 - (oldWords.length - oldEnd) * 3 - (newWords.length - j);
      if (score > bestScore) {
        bestScore = score;
        best = {old: oldEnd - length, next: j - length, length};
      }
    }
    prev.set(curr);
  }
  return best;
}
function commonPrefix(a: Word[], b: Word[]): number {
  let i = 0;
  while (i < a.length && i < b.length && equal(a[i], b[i])) i++;
  return i;
}

export class TranscriptBuffer {
  private stable: Word[] = [];
  private pending: Word[] = [];
  private unanchored: Word[] | undefined;
  private emptyWindows = 0;
  private revision = 0;
  private lastWindowStart = -1;
  private lastWindowEnd = -1;

  /** Apply the next ordered hypothesis for this session's audio time range. */
  update(text: string, windowStart: number, windowEnd: number, final = false): TranscriptUpdate {
    if (!Number.isSafeInteger(windowStart) || !Number.isSafeInteger(windowEnd) || windowStart < 0 || windowEnd <= windowStart || windowEnd < this.lastWindowEnd) {
      throw new Error('TRANSCRIPT_WINDOW_ORDER');
    }
    this.lastWindowStart = windowStart;
    this.lastWindowEnd = windowEnd;
    const next = words(text);
    if (!next.length) {
      this.emptyWindows++;
      // A single silent window may be a transient ASR miss.  Two successive
      // empty windows (or an explicit stop) retire the old draft only once.
      if (this.emptyWindows >= 2 || final) return this.flush();
      return this.state();
    }
    this.emptyWindows = 0;
    const old = [...this.stable, ...this.pending];
    if (!old.length) {
      this.pending = next;
      this.unanchored = undefined;
    } else {
      const anchor = overlap(old, next);
      if (anchor) {
        this.unanchored = undefined;
        // The matched part is already represented on the left, while newer
        // hypotheses may rewrite the right edge of the previous window.
        let candidate = [...old.slice(0, anchor.old), ...next.slice(anchor.next)];
        if (!this.stable.length && anchor.old === 0 && anchor.next > 0) {
          // Early recognitions can add words before the first anchor.
          candidate = next;
        }
        if (commonPrefix(this.stable, candidate) === this.stable.length) {
          const agreed = commonPrefix(old, candidate);
          const advanceTo = Math.max(this.stable.length, Math.min(agreed, candidate.length - 3));
          if (advanceTo > this.stable.length) this.stable.push(...old.slice(this.stable.length, advanceTo));
          this.pending = candidate.slice(this.stable.length);
        } else {
          // Never silently rewrite words already confirmed.
          this.pending = old.slice(this.stable.length);
        }
      } else if (next.length === old.length && commonPrefix(next, old) === next.length) {
        // One-word/very short identical windows are not new utterances.
        this.unanchored = undefined;
      } else if (!this.pending.length && overlap(this.stable.slice(-12), next, 1)) {
        // Await another hypothesis; repeated one-word anchors are ambiguous.
        this.unanchored = next;
      } else if (this.unanchored && overlap(this.unanchored, next)) {
        // Two consecutive hypotheses of a new phrase agree; preserve the old
        // speech before moving on, even if it has left the 8-second window.
        this.stable.push(...this.pending);
        this.pending = [...this.unanchored.slice(0, overlap(this.unanchored, next)!.old), ...next.slice(overlap(this.unanchored, next)!.next)];
        this.unanchored = undefined;
      } else {
        // Do not discard old speech just because recognition was rewritten.
        // Keep one tentative unmatched segment until a second anchor arrives.
        this.unanchored = next;
      }
    }
    if (final) return this.flush();
    return this.state();
  }
  flush(): TranscriptUpdate {
    this.stable.push(...this.pending);
    this.pending = [];
    if (this.unanchored) {
      const last = this.stable.slice(-12);
      const m = overlap(last, this.unanchored);
      this.stable.push(...(m ? this.unanchored.slice(m.next + m.length) : this.unanchored));
      this.unanchored = undefined;
    }
    this.emptyWindows = 0;
    return this.state();
  }
  /** Send only the newly confirmed delta; the browser holds the full text. */
  private sentStable = 0;
  private state(forcePartial?: string): TranscriptUpdate {
    const stable_delta = joined(this.stable.slice(this.sentStable));
    this.sentStable = this.stable.length;
    const pending = forcePartial !== undefined ? [] : [...this.pending, ...(this.unanchored || [])];
    return {stable_delta, partial_text: joined(pending), revision: ++this.revision};
  }
}
