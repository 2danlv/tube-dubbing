/**
 * SmartSegmenter - Rewritten to match PunctuationSubtitleService from the original extension.
 * 
 * Key algorithm: "Drain" (subtraction) time distribution based on character weight,
 * NOT proportional word-based distribution.
 */

class PunctuationUtils {
  static isPunctuation(ch) {
    return /[\.\!\?\u3002\uFF01\uFF1F]/.test(ch);
  }

  static isWeakPunctuation(ch) {
    return /[,;:\uFF0C\uFF1B\uFF1A]/.test(ch);
  }

  static endsWithPunctuation(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
    const last = t.charAt(t.length - 1);
    return PunctuationUtils.isPunctuation(last) || last === '"' || last === '\u201D' || last === "'" || last === '\u2019';
  }

  static containsOnlyPunctuationAndSpaces(text) {
    if (!text) return true;
    return /^[\s\p{P}]*$/u.test(text);
  }
}

class SmartSegmenter {
  constructor(locale = 'en') {
    this.locale = locale;
    this.GAP_THRESHOLD = 0.15;
    try {
      this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    } catch (e) {
      console.warn("Intl.Segmenter not supported for locale", locale);
      this.segmenter = null;
    }
  }

  // ============================================================
  // MAIN ENTRY POINT
  // ============================================================
  segmentSubtitles(subtitles) {
    const filtered = subtitles.filter(s => s.text && !PunctuationUtils.containsOnlyPunctuationAndSpaces(s.text));
    if (filtered.length === 0) return [];

    // Kiểm tra lượng dấu câu để phát hiện phụ đề tự sinh
    let totalPunctuation = 0;
    let totalLength = 0;
    filtered.forEach(s => {
      totalLength += s.text.length;
      const matches = s.text.match(/[.!?\u3002\uFF01\uFF1F]/g);
      if (matches) {
        totalPunctuation += matches.length;
      }
    });

    // Nếu mật độ dấu câu quá ít (dưới 1 dấu / 300 ký tự), bỏ qua gộp câu theo dấu câu
    if (totalPunctuation < (totalLength / 300)) {
      console.log("[SmartSegmenter] Phát hiện phụ đề không có dấu câu. Bỏ qua phân tách câu và trả về phụ đề gốc.");
      return this._resolveTimeOverlaps(filtered);
    }

    // Phase 1: Process subtitles with sentence segmentation
    const state = {
      subtitles: [],
      pendingText: null, // { text, time }
      skipIndices: new Set(),
      lastSubtitleEnd: 0
    };

    for (let i = 0; i < filtered.length; i++) {
      if (state.skipIndices.has(i)) continue;

      let sub = filtered[i];

      // Merge pending text from previous iteration
      if (state.pendingText) {
        const pending = state.pendingText;
        state.pendingText = null;
        sub = this._mergePendingToSubtitle(sub, pending, state.lastSubtitleEnd);
      }

      this._processCurrentSubtitle(sub, state, filtered, i);
    }

    if (state.pendingText) {
      const pending = state.pendingText;
      const newStart = state.lastSubtitleEnd;
      this._pushSubtitle(state, {
        ...filtered[filtered.length - 1],
        start: newStart,
        end: newStart + pending.time,
        dur: pending.time,
        text: pending.text
      });
    }

    // Phase 2: Merge by word boundary
    const merged = this._mergeSubtitlesByWordBoundary(state.subtitles);

    // Phase 3: Normalize leading punctuation
    const normalized = this._normalizeLeadingSentencePunctuation(merged);

    // Phase 4: Cleanup punctuation-only subtitles
    const cleaned = this._cleanupPunctuationOnly(normalized);

    // Phase 5: Resolve time overlaps
    return this._resolveTimeOverlaps(cleaned);
  }

  // ============================================================
  // CORE PROCESSING (matches original extension logic)
  // ============================================================

  _processCurrentSubtitle(sub, state, allSubs, currentIdx) {
    // Segment the subtitle text first
    const segments = this._segmentText(sub.text);

    if (segments.length === 0) return;

    if (segments.length > 1) {
      // Multiple sentences - split using drain algorithm
      this._splitAtFirstSentence(sub, state, segments);
      return;
    }

    // Only one sentence - if there's a significant gap after this subtitle, just push it
    if (this._hasSignificantGap(sub, allSubs, currentIdx + 1)) {
      this._pushSubtitle(state, sub);
      return;
    }

    // Try to merge forward with next subtitle(s)
    this._tryMergeForward(sub, state, allSubs, currentIdx + 1);
  }

  _hasSignificantGap(sub, allSubs, nextIdx) {
    if (nextIdx >= allSubs.length) return true;
    return allSubs[nextIdx].start - sub.end >= this.GAP_THRESHOLD;
  }

  // ============================================================
  // DRAIN ALGORITHM (matches original extension exactly)
  // ============================================================

  _splitAtFirstSentence(sub, state, segments) {
    if (segments.length === 0) {
      this._pushSubtitle(state, sub);
      return;
    }

    const lastSegment = segments[segments.length - 1];
    // Only drain complete sentences (ones ending with punctuation)
    const drainCount = !PunctuationUtils.endsWithPunctuation(lastSegment) 
      ? segments.length - 1 
      : segments.length;

    const originalText = sub.text;
    let sourcePos = 0;
    let remainingDur = sub.dur;
    let currentStart = sub.start;
    let totalWeight = this._calculateTextWeight(originalText);

    for (let m = 0; m < drainCount; m++) {
      const sentenceText = segments[m];
      if (!sentenceText) continue;

      const trimmed = sentenceText.trim();
      if (!trimmed) continue;

      // Skip whitespace in source
      sourcePos = this._skipWhitespace(originalText, sourcePos);

      // Match sentence in source to get consumed length
      const matchResult = this._matchSentencePrefixLength(originalText, sourcePos, trimmed);
      if (matchResult === undefined) {
        // Can't match - push remaining as pending
        const remaining = originalText.substring(sourcePos).trim();
        if (remaining) {
          state.pendingText = { text: remaining, time: Math.max(0, remainingDur) };
        }
        return;
      }

      const sentenceWeight = this._calculateTextWeight(trimmed);

      // Calculate rest time by subtraction (the DRAIN algorithm)
      const restTime = totalWeight > 0 
        ? remainingDur - (sentenceWeight / totalWeight) * remainingDur 
        : 0;
      const clampedRestTime = Math.min(Math.max(restTime, 0), remainingDur);
      const sentenceDur = Math.max(0, remainingDur - clampedRestTime);

      this._pushSubtitle(state, {
        ...sub,
        text: trimmed,
        start: currentStart,
        dur: sentenceDur,
        end: currentStart + sentenceDur
      });

      currentStart = currentStart + sentenceDur;
      remainingDur = clampedRestTime;
      sourcePos += matchResult;
      totalWeight = Math.max(0, totalWeight - sentenceWeight);
    }

    // Any remaining text goes to pending
    const remaining = originalText.substring(sourcePos).trim();
    if (remaining) {
      state.pendingText = { text: remaining, time: Math.max(0, remainingDur) };
    }
  }

  _tryMergeForward(sub, state, allSubs, startIdx) {
    let combinedText = sub.text;
    let combinedDur = sub.dur;
    let combinedEnd = sub.end;
    const skipped = [];
    let handled = false;

    for (let h = startIdx; h < allSubs.length; h++) {
      // Don't cross a significant gap (except first)
      if (h > startIdx && this._hasSignificantGap(allSubs[h - 1], allSubs, h)) break;

      const nextSub = allSubs[h];
      const merged = combinedText + " " + nextSub.text;
      const mergedSegments = this._segmentText(merged);

      if (mergedSegments.length > 1) {
        const firstSentence = mergedSegments[0].trim();
        const currentTrimmed = combinedText.trim();

        if (merged.startsWith(firstSentence + " ") && firstSentence.length < currentTrimmed.length) {
          // The first sentence is a subset of current text - split within current
          const leftover = combinedText.substring(firstSentence.length).trim();
          const restTime = this._calculateRestTimeBySubtraction(combinedText, firstSentence, combinedDur);
          const sentenceDur = combinedDur - restTime;

          this._pushSubtitle(state, {
            ...sub,
            text: firstSentence,
            start: sub.start,
            dur: sentenceDur,
            end: sub.start + sentenceDur
          });

          if (leftover) {
            state.pendingText = { text: leftover, time: restTime };
          }
          handled = true;
          break;
        }

        if (firstSentence.length > currentTrimmed.length + 1) {
          // First sentence extends into next subtitle
          const partFromNext = firstSentence.substring(combinedText.length).trim();
          const partTime = this._calculateTextProportionalTime(nextSub.text, partFromNext, nextSub.dur);
          const totalDur = combinedDur + partTime;

          this._pushSubtitle(state, {
            ...sub,
            text: firstSentence,
            start: sub.start,
            dur: totalDur,
            end: sub.start + totalDur
          });

          const remainingNext = nextSub.text.substring(partFromNext.length).trim();
          if (remainingNext) {
            state.pendingText = { text: remainingNext, time: nextSub.dur - partTime };
          }
          skipped.push(h);
        } else {
          // First sentence matches current text exactly - just push it
          this._pushSubtitle(state, {
            ...sub,
            text: combinedText,
            dur: combinedDur,
            end: combinedEnd
          });
        }
        handled = true;
        break;
      } else {
        // Still one sentence - keep merging
        combinedText = merged;
        combinedDur += nextSub.dur;
        combinedEnd = nextSub.end;
        skipped.push(h);
      }
    }

    if (!handled) {
      this._pushSubtitle(state, {
        ...sub,
        text: combinedText,
        dur: combinedDur,
        end: combinedEnd
      });
    }

    skipped.forEach(idx => state.skipIndices.add(idx));
  }

  // ============================================================
  // CHARACTER-BASED WEIGHT (matches original extension)
  // ============================================================

  _calculateTextWeight(text) {
    let weight = 0;
    for (let i = 0; i < text.length; i++) {
      if (this._isCountableWeightChar(text.charCodeAt(i))) {
        weight++;
      }
    }
    return weight;
  }

  _isCountableWeightChar(charCode) {
    // ASCII alphanumeric
    if ((charCode >= 48 && charCode <= 57) ||  // 0-9
        (charCode >= 65 && charCode <= 90) ||  // A-Z
        (charCode >= 97 && charCode <= 122)) { // a-z
      return true;
    }
    // Whitespace or control
    if (charCode <= 32) return false;
    // Check if it's punctuation
    const ch = String.fromCharCode(charCode);
    if (PunctuationUtils.isPunctuation(ch) || PunctuationUtils.isWeakPunctuation(ch)) return false;
    if (ch.trim().length === 0) return false;
    return true;
  }

  _calculateRestTimeBySubtraction(fullText, sentenceText, duration) {
    const totalWeight = this._calculateTextWeight(fullText);
    const sentenceWeight = this._calculateTextWeight(sentenceText);
    if (totalWeight === 0) return 0;
    return duration - (sentenceWeight / totalWeight) * duration;
  }

  _calculateTextProportionalTime(fullText, partText, duration) {
    const totalWeight = this._calculateTextWeight(fullText);
    const partWeight = this._calculateTextWeight(partText);
    if (totalWeight === 0) return 0;
    return (partWeight / totalWeight) * duration;
  }

  // ============================================================
  // TEXT MATCHING UTILITIES
  // ============================================================

  _skipWhitespace(text, pos) {
    while (pos < text.length && this._isWhitespace(text.charCodeAt(pos))) {
      pos++;
    }
    return pos;
  }

  _isWhitespace(charCode) {
    return charCode === 9 || charCode === 10 || charCode === 11 || 
           charCode === 12 || charCode === 13 || charCode === 32 || 
           charCode === 160 || charCode === 5760 ||
           (charCode >= 8192 && charCode <= 8202) ||
           charCode === 8232 || charCode === 8233 || 
           charCode === 8239 || charCode === 8287 || 
           charCode === 12288 || charCode === 65279;
  }

  _matchSentencePrefixLength(source, startPos, sentence) {
    let sPos = startPos;
    let tPos = 0;

    // First try exact match
    while (sPos < source.length && tPos < sentence.length) {
      if (source.charCodeAt(sPos) !== sentence.charCodeAt(tPos)) break;
      sPos++;
      tPos++;
    }

    if (tPos === sentence.length) return sPos - startPos;

    // Try whitespace-tolerant match
    sPos = startPos;
    tPos = 0;

    while (tPos < sentence.length) {
      if (sPos >= source.length) return undefined;

      const sChar = source.charCodeAt(sPos);
      const tChar = sentence.charCodeAt(tPos);
      const sWs = this._isWhitespace(sChar);
      const tWs = this._isWhitespace(tChar);

      if (sWs && tWs) {
        while (sPos < source.length && this._isWhitespace(source.charCodeAt(sPos))) sPos++;
        while (tPos < sentence.length && this._isWhitespace(sentence.charCodeAt(tPos))) tPos++;
        continue;
      }
      if (sWs && !tWs) { sPos++; continue; }
      if (!sWs && tWs) { tPos++; continue; }
      if (sChar !== tChar) return undefined;
      sPos++;
      tPos++;
    }

    return sPos - startPos;
  }

  // ============================================================
  // SENTENCE SEGMENTATION (Intl.Segmenter)
  // ============================================================

  _segmentText(text) {
    if (!this.segmenter) {
      return this._fallbackSegment(text);
    }

    const raw = [];
    for (const { segment } of this.segmenter.segment(text)) {
      const s = segment.trim();
      if (s.length > 0) raw.push(s);
    }

    return this._postProcessSegments(raw);
  }

  _fallbackSegment(text) {
    const parts = text.split(/([.!?\u3002\uFF01\uFF1F]+)/);
    const segments = [];
    let current = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        current = parts[i];
      } else {
        current += parts[i];
        const trimmed = current.trim();
        if (trimmed) segments.push(trimmed);
        current = '';
      }
    }
    if (current.trim()) segments.push(current.trim());
    return this._postProcessSegments(segments);
  }

  _postProcessSegments(segments) {
    const MIN_SENTENCE_LENGTH = 10;
    const result = [];
    let pending = '';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (pending && this._shouldMergeWithPrevious(pending, seg)) {
        pending += ' ' + seg;
        continue;
      }

      if (pending && seg.length >= MIN_SENTENCE_LENGTH) {
        result.push(pending);
        pending = seg;
      } else if (pending) {
        pending += ' ' + seg;
      } else {
        pending = seg;
      }
    }

    if (pending) {
      if (pending.length < MIN_SENTENCE_LENGTH && result.length > 0) {
        result[result.length - 1] += ' ' + pending;
      } else {
        result.push(pending);
      }
    }

    return result.filter(s => this._isValidSegment(s));
  }

  _shouldMergeWithPrevious(prev, next) {
    const trimmedPrev = prev.trim();
    const trimmedNext = next.trim();

    // Very short next segment without punctuation
    if (trimmedNext.length < 3 && !/[.!?]/.test(trimmedNext)) return true;

    // Check for common abbreviations
    const lastWord = this._getLastWord(trimmedPrev).replace('.', '');
    const ABBREVIATIONS = new Set(['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr', 'Ph', 'M', 'B', 'D']);
    if (ABBREVIATIONS.has(lastWord)) return true;

    // Check for decimal numbers (e.g., "2,000" split across segments)
    if (trimmedPrev.endsWith('.') && trimmedPrev.length >= 2) {
      const beforeDot = trimmedPrev.charCodeAt(trimmedPrev.length - 2);
      const afterDot = trimmedNext.charCodeAt(0);
      if (this._isDigit(beforeDot) && this._isDigit(afterDot)) return true;
    }

    return false;
  }

  _isDigit(charCode) {
    return charCode >= 48 && charCode <= 57;
  }

  _getLastWord(text) {
    if (!text) return '';
    let end = text.length - 1;
    while (end >= 0 && this._isWhitespace(text.charCodeAt(end))) end--;
    if (end < 0) return '';
    let start = end;
    while (start >= 0 && !this._isWhitespace(text.charCodeAt(start))) start--;
    return text.substring(start + 1, end + 1);
  }

  _isValidSegment(text) {
    const t = text.trim();
    if (!t) return false;
    if (PunctuationUtils.containsOnlyPunctuationAndSpaces(t)) return false;
    return true;
  }

  // ============================================================
  // POST-PROCESSING (matches original extension)
  // ============================================================

  _pushSubtitle(state, sub) {
    state.subtitles.push(sub);
    state.lastSubtitleEnd = sub.end;
  }

  _mergePendingToSubtitle(sub, pending, lastEnd) {
    let newStart = sub.start - pending.time;
    if (lastEnd > 0 && newStart < lastEnd) {
      newStart = lastEnd;
    }
    const newDur = sub.end - newStart;
    return {
      ...sub,
      text: pending.text + " " + sub.text,
      start: newStart,
      dur: newDur,
      end: sub.end
    };
  }

  _mergeSubtitlesByWordBoundary(subtitles) {
    if (subtitles.length <= 1) return subtitles;

    const result = [];
    let current = subtitles[0];

    for (let i = 0; i < subtitles.length - 1; i++) {
      const next = subtitles[i + 1];

      const lastWord = this._findLastWord(current.text).trim();
      const firstWord = this._findFirstWord(next.text).trim();

      if (lastWord && firstWord && lastWord === firstWord) {
        // Word boundary overlap - merge
        this._appendSubtitle(current, next, true);
      } else if (this._isDecimalNumberSplit(current, next) || PunctuationUtils.containsOnlyPunctuationAndSpaces(next.text)) {
        this._appendSubtitle(current, next, false);
      } else {
        result.push(current);
        current = next;
      }
    }
    result.push(current);
    return result;
  }

  _appendSubtitle(target, source, includeSpace) {
    target.text = includeSpace ? target.text + " " + source.text : target.text + source.text;
    target.end = source.end;
    target.dur = target.end - target.start;
  }

  _normalizeLeadingSentencePunctuation(subtitles) {
    if (subtitles.length <= 1) return subtitles;

    for (let i = 1; i < subtitles.length; i++) {
      const prev = subtitles[i - 1];
      const curr = subtitles[i];

      if (!prev.text || !curr.text || PunctuationUtils.endsWithPunctuation(prev.text)) continue;

      const extracted = this._extractLeadingPunctuation(curr.text);
      if (extracted) {
        prev.text = prev.text.trimEnd() + extracted.punctuation;
        curr.text = curr.text.substring(extracted.consumedLength).trimStart();
      }
    }
    return subtitles;
  }

  _extractLeadingPunctuation(text) {
    if (!text) return null;
    let consumed = 0;
    let punct = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (PunctuationUtils.isPunctuation(ch)) {
        punct += ch;
        consumed = i + 1;
      } else if (ch.trim().length === 0 && punct.length > 0) {
        consumed = i + 1;
      } else {
        break;
      }
    }
    if (punct.length === 0) return null;
    return { punctuation: punct, consumedLength: consumed };
  }

  _cleanupPunctuationOnly(subtitles) {
    if (subtitles.length === 0) return subtitles;
    if (subtitles.length === 1) {
      return PunctuationUtils.containsOnlyPunctuationAndSpaces(subtitles[0].text) ? [] : subtitles;
    }

    const result = [];
    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      if (PunctuationUtils.containsOnlyPunctuationAndSpaces(sub.text)) {
        if (i === 0 && i + 1 < subtitles.length) {
          this._appendSubtitle(sub, subtitles[i + 1], false);
          result.push(sub);
          i++;
        } else if (result.length > 0) {
          this._appendSubtitle(result[result.length - 1], sub, false);
        }
      } else {
        result.push(sub);
      }
    }
    return result;
  }

  _resolveTimeOverlaps(subtitles) {
    if (subtitles.length <= 1) return subtitles;
    const result = [];
    for (let i = 0; i < subtitles.length; i++) {
      const sub = { ...subtitles[i] };
      if (i < subtitles.length - 1) {
        const next = subtitles[i + 1];
        if (sub.end > next.start) {
          sub.end = next.start;
          sub.dur = sub.end - sub.start;
        }
      }
      result.push(sub);
    }
    return result;
  }

  _isDecimalNumberSplit(prev, next) {
    const prevText = prev.text.trim();
    const combined = prevText.substring(prevText.length - 2) + next.text.trim().charAt(0);
    const num = Number(combined);
    return !isNaN(num) && isFinite(num);
  }

  // ============================================================
  // WORD FINDING (matches original extension)
  // ============================================================

  _findLastWord(text) {
    if (!text) return '';
    let result = [];
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text.charAt(i);
      if (result.length === 0 && (PunctuationUtils.isPunctuation(ch) || PunctuationUtils.isWeakPunctuation(ch) || ch.trim().length === 0)) {
        continue; // Skip trailing punctuation/spaces
      }
      if (result.length !== 0 && (PunctuationUtils.isPunctuation(ch) || PunctuationUtils.isWeakPunctuation(ch) || ch.trim().length === 0)) {
        break;
      }
      result.push(ch);
    }
    return result.reverse().join('');
  }

  _findFirstWord(text) {
    if (!text) return '';
    let result = '';
    const trimmed = text.trim();
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed.charAt(i);
      result += ch;
      if (PunctuationUtils.isPunctuation(ch) || PunctuationUtils.isWeakPunctuation(ch) || ch.trim().length === 0) {
        return result;
      }
    }
    return result;
  }
}
