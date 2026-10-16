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

  /**
   * A repeated result for the very same sample range is a transport/replay
   * duplicate, NOT evidence that the speaker repeated the words. A different
   * hypothesis for that identical range is also not a second utterance.
   * We cannot retract an already emitted stable_delta, so do not append it.
   */
  sameWindow(start, end) {
    return start === this.lastWindowStart && end === this.lastWindowEnd;
  }

  /** Apply the next ordered hypothesis for this session's audio time range. */
  update(text, windowStart, windowEnd, final = false) {
    if (!Number.isSafeInteger(windowStart) || !Number.isSafeInteger(windowEnd) || windowStart < 0 || windowEnd <= windowStart || windowEnd < this.lastWindowEnd) {
      throw new Error('TRANSCRIPT_WINDOW_ORDER');
    }
    // A replay of the SAME audio range must never grow the transcript, even
    // if another ASR decoding of those samples uses different spelling.
    // The caller may still request a final flush without introducing speech.
    if (this.sameWindow(windowStart, windowEnd)) {
      return final ? this.flush() : this.state();
    }
    // A lexical match from 30 seconds ago is not evidence that the *current*
    // overlapping audio contains that same phrase. Gate old-text matching on
    // the immediately preceding raw Whisper window and actual audio overlap.
    const consecutive = this.lastWindowEnd < 0 || windowStart < this.lastWindowEnd;
    const next = words(text);
    const unchanged = consecutive && !!next.length && next.length === this.lastHypothesis.length &&
      commonPrefix(this.lastHypothesis, next) === next.length;
    const recentOverlap = consecutive ? overlap(this.lastHypothesis, next) : undefined;
    this.lastWindowStart = windowStart;
    this.lastWindowEnd = windowEnd;
    if (next.length) this.lastHypothesis = next;
    // An identical hypothesis from a moving, overlapping 8-second window
    // does not establish an additional spoken occurrence. Nonoverlapping
    // windows are NOT deduplicated: a teacher may truly repeat a phrase.
    // A fresh, nonempty window interrupts a silence streak even when its
    // words are identical to the preceding nonempty hypothesis. Otherwise
    // [speech, silence, unchanged speech, silence] erroneously flushes.
    if (next.length) this.emptyWindows = 0;
    if (unchanged) return final ? this.flush() : this.state();
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
    // Disjoint sample intervals represent independent speech. Similar words
    // spoken again after a nonoverlapping interval are NOT duplicates.
    if (!consecutive && old.length) {
      this.stable.push(...this.pending);
      this.pending = next;
      this.unanchored = undefined;
      return final ? this.flush() : this.state();
    }
    if (!old.length) {
      this.pending = next;
      this.unanchored = undefined;
    } else {
      // Even after an ambiguous intermediate hypothesis, try to re-anchor
      // the latest result to the immediately preceding visible draft before
      // confirming another utterance. This prevents an alternate rendering
      // of the SAME overlapping audio from becoming a new stable sentence.
      const possible = recentOverlap ? overlap(old, next) : undefined;
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
      } else if (consecutive && next.length === old.length && commonPrefix(next, old) === next.length) {
        // One-word/very short identical windows are not new utterances.
        this.unanchored = undefined;
      } else if (this.unanchored && overlap(this.unanchored, next)) {
        // The next window confirms that the tentative words persist, but
        // NOT necessarily that they were an independent second utterance.
        // The previous UI may already be showing a *replacement* of pending
        // with unanchored. Never hard-commit the superseded pending version.
        const fresh = overlap(this.unanchored, next);
        const visibleDraft = this.effectiveDraft();
        const concatenated = [...this.pending, ...this.unanchored];
        const replacedDraft = visibleDraft.length !== concatenated.length ||
          commonPrefix(visibleDraft, concatenated) !== visibleDraft.length;
        if (replacedDraft) {
          // The transcript that was visible is the only eligible draft:
          // preserve its prefix and append just the new confirmed tail.
          this.pending = [...visibleDraft, ...next.slice(fresh.next + fresh.length)];
        } else {
          // There is no sufficient lexical evidence that the two segments
          // refer to the same words. Keep the earlier stable prefix intact,
          // and retain only the confirmed tail of the new hypothesis.
          const duplicate = consecutive ? overlap(old, this.unanchored) : undefined;
          const tailMatch = duplicate && duplicate.old + duplicate.length >= old.length - 2;
          if (tailMatch && commonPrefix(this.stable,
            [...old.slice(0, duplicate.old), ...this.unanchored.slice(duplicate.next)]
          ) === this.stable.length) {
            const amended = [...old.slice(0, duplicate.old), ...this.unanchored.slice(duplicate.next)];
            this.pending = [...amended.slice(this.stable.length), ...next.slice(fresh.next + fresh.length)];
          } else {
            this.stable.push(...this.pending);
            this.pending = [...this.unanchored.slice(0, fresh.old), ...next.slice(fresh.next)];
          }
        }
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
  /**
   * Resolve the visible draft once, identically for rendering and stop.
   * An unanchored hypothesis is an alternative interpretation of audio
   * already represented by pending, not automatically another sentence.
   * This deliberately does not mutate stable/pending during UI rendering.
   */
  effectiveDraft() {
    const draft = [...this.pending];
    if (!this.unanchored) return draft;
    const match = overlap(draft, this.unanchored);
    if (match && match.old + match.length >= draft.length - 2) {
      return [...draft.slice(0, match.old), ...this.unanchored.slice(match.next)];
    }
    if (!draft.length) {
      // If there is no pending text, a tentative hypothesis may overlap the
      // already committed stable tail. Display and flush must both remove
      // that same old prefix instead of treating it as fresh speech.
      const tail = overlap(this.stable.slice(-12), this.unanchored);
      return tail ? this.unanchored.slice(tail.next + tail.length) : [...this.unanchored];
    }
    return [...draft, ...this.unanchored];
  }
  flush() {
    // Commit exactly the draft the user was seeing before stop. In
    // particular, never resurrect words replaced by the unanchored draft.
    this.stable.push(...this.effectiveDraft());
    this.pending = [];
    this.unanchored = undefined;
    this.emptyWindows = 0;
    return this.state();
  }
  /** Send only the newly confirmed delta; the browser holds the full text. */
  sentStable = 0;
  state(forcePartial) {
    const stable_delta = joined(this.stable.slice(this.sentStable));
    this.sentStable = this.stable.length;
    const pending = forcePartial === undefined ? this.effectiveDraft() : [];
    return {stable_delta, partial_text: joined(pending), revision: ++this.revision};
  }
}
