/**
 * Best-effort LocalAgreement-style text accumulator for overlapping Whisper
 * windows.  The audio is intentionally bounded, but stable text is NOT.
 *
 * Whisper's v0.1 API returns window text (no word timestamps), so alignment
 * cannot prove that every repeated spoken word was recognised exactly once.
 * Stable text is immutable; a small right-hand draft is rewritten on updates.
 * No DeepSeek sentence consumption occurs in this version.
 */

function words(text) {
  return text.trim().split(/\s+/u).filter(Boolean).map(display => ({
    display,
    key: display.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  }));
}
function equal(a, b) { return !!a.key && a.key === b.key; }
function joined(tokens) { return tokens.map(w => w.display).join(' '); }

/** Prefer a long, contiguous lexical anchor near the end of the old text. */
function overlap(oldWords, newWords, minLength = 2) {
  const offset = Math.max(0, oldWords.length - 96);
  const old = oldWords.slice(offset);
  const prev = new Uint16Array(newWords.length + 1);
  let best;
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
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && equal(a[i], b[i])) i++;
  return i;
}

export class TranscriptBuffer {
  stable = [];
  pending = [];
  unanchored;
  emptyWindows = 0;
  revision = 0;
  lastWindowStart = -1;
  lastWindowEnd = -1;
  lastHypothesis = [];

  /** Apply the next ordered hypothesis for this session's audio time range. */
  update(text, windowStart, windowEnd, final = false) {
    if (!Number.isSafeInteger(windowStart) || !Number.isSafeInteger(windowEnd) || windowStart < 0 || windowEnd <= windowStart || windowEnd < this.lastWindowEnd) {
      throw new Error('TRANSCRIPT_WINDOW_ORDER');
    }
    // A lexical match from 30 seconds ago is not evidence that the *current*
    // overlapping audio contains that same phrase. Gate old-text matching on
    // the immediately preceding raw Whisper window and actual audio overlap.
    const consecutive = this.lastWindowEnd < 0 || windowStart < this.lastWindowEnd;
    const next = words(text);
    const recentOverlap = consecutive ? overlap(this.lastHypothesis, next) : undefined;
    this.lastWindowStart = windowStart;
    this.lastWindowEnd = windowEnd;
    if (next.length) this.lastHypothesis = next;
    if (!next.length) {
      this.emptyWindows++;
      // A single silent window may be a transient ASR miss.  Two successive
      // empty windows (or an explicit stop) retire the old draft only once.
      if (this.emptyWindows >= 2 || final) {
        this.lastHypothesis = [];
        return this.flush();
      }
      return this.state();
    }
    this.emptyWindows = 0;
    const old = [...this.stable, ...this.pending];
    if (!old.length) {
      this.pending = next;
      this.unanchored = undefined;
    } else {
      const possible = recentOverlap && !this.unanchored ? overlap(old, next) : undefined;
      let candidate = possible ? [...old.slice(0, possible.old), ...next.slice(possible.next)] : [];
      if (possible && !this.stable.length && possible.old === 0 && possible.next > 0) {
        // Whisper can prepend words to the *first* hypothesis.
        candidate = next;
      }
      const anchor = possible && commonPrefix(this.stable, candidate) === this.stable.length ? possible : undefined;
      if (anchor) {
        this.unanchored = undefined;
        const agreed = commonPrefix(old, candidate);
        const advanceTo = Math.max(this.stable.length, Math.min(agreed, candidate.length - 3));
        if (advanceTo > this.stable.length) this.stable.push(...old.slice(this.stable.length, advanceTo));
        this.pending = candidate.slice(this.stable.length);
      } else if (next.length === old.length && commonPrefix(next, old) === next.length) {
        // One-word/very short identical windows are not new utterances.
        this.unanchored = undefined;
      } else if (this.unanchored && overlap(this.unanchored, next)) {
        // The previous unanchored hypothesis is an independent new utterance.
        // Prefer confirming it over matching common terminology in old history.
        const fresh = overlap(this.unanchored, next)!;
        this.stable.push(...this.pending);
        this.pending = [...this.unanchored.slice(0, fresh.old), ...next.slice(fresh.next)];
        this.unanchored = undefined;
      } else if (!this.pending.length && overlap(this.stable.slice(-12), next, 1)) {
        // A historical word alone is not a trustworthy current-window anchor.
        this.unanchored = next;
      } else {
        // Do not discard old speech just because recognition was rewritten.
        // Keep one tentative unmatched segment until a second anchor arrives.
        this.unanchored = next;
      }
    }
    if (final) return this.flush();
    return this.state();
  }
  flush() {
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
  sentStable = 0;
  state(forcePartial) {
    const stable_delta = joined(this.stable.slice(this.sentStable));
    this.sentStable = this.stable.length;
    const pending = forcePartial !== undefined ? [] : [...this.pending, ...(this.unanchored || [])];
    return {stable_delta, partial_text: joined(pending), revision: ++this.revision};
  }
}
