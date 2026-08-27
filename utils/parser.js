/**
 * YouTubeParser - Matches the original extension's JSON3 parsing logic exactly.
 * 
 * Key difference from previous implementation:
 * The original extension creates ONE subtitle per SEGMENT (seg) inside each event,
 * using tOffsetMs for precise word-level timing. It then joins segments based on
 * punctuation boundaries, NOT by concatenating all segs into one string.
 */

class PunctuationHelper {
  static isPunctuation(ch) {
    return /[\.\!\?\u3002\uFF01\uFF1F]/.test(ch);
  }

  static endsWithPunctuation(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
    const last = t.charAt(t.length - 1);
    return this.isPunctuation(last) || last === '"' || last === '\u201D' || last === "'" || last === '\u2019';
  }

  static containsOnlyPunctuationAndSpaces(text) {
    if (!text) return true;
    return /^[\s\p{P}]*$/u.test(text);
  }

  static isEmpty(text) {
    return !text || text.trim().length === 0;
  }

  static isSoundEffectMarker(text) {
    const t = text.trim();
    if (!t.startsWith('[') || !t.endsWith(']')) return false;
    const inner = t.slice(1, -1).trim().toLowerCase();
    if (!inner || inner.includes('[') || inner.includes(']') || inner.length > 30 || inner.includes(':') || /\d/.test(inner)) return false;
    const markers = ['music', 'applause', 'laughter', 'laugh', 'laughing', 'cheering', 'clapping', 'silence', 'pause'];
    return markers.includes(inner);
  }
}

class YouTubeParser {
  /**
   * Parse JSON3 data exactly like the original extension.
   * Creates subtitles at the segment level (using tOffsetMs) and merges by punctuation.
   */
  static parse(json3Data) {
    if (!json3Data || !json3Data.events) return [];

    const events = json3Data.events;
    const result = [];

    // Đếm lượng dấu câu để phát hiện phụ đề tự động (không dấu câu)
    let totalPunct = 0;
    let totalChars = 0;
    for (const event of events) {
      if (event.segs) {
        for (const seg of event.segs) {
          if (seg.utf8) {
            totalChars += seg.utf8.length;
            const matches = seg.utf8.match(/[.!?\u3002\uFF01\uFF1F]/g);
            if (matches) {
              totalPunct += matches.length;
            }
          }
        }
      }
    }

    const isUnpunctuated = totalPunct < (totalChars / 300);

    if (isUnpunctuated) {
      console.log("[YouTubeParser] Phát hiện phụ đề không có dấu câu (tự sinh). Bỏ qua gộp câu theo dấu.");
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event.segs || !event.dDurationMs) continue;

        // Gộp tất cả các segment trong event này thành 1 câu duy nhất
        let text = "";
        for (const seg of event.segs) {
          if (seg.utf8) text += seg.utf8;
        }
        text = this._normalizeText(text);
        if (PunctuationHelper.isEmpty(text)) continue;
        if (PunctuationHelper.isSoundEffectMarker(text)) continue;

        const start = event.tStartMs / 1000;
        const end = (event.tStartMs + event.dDurationMs) / 1000;
        result.push({
          start: start,
          end: end,
          dur: end - start,
          text: text,
          processPunctuation: false
        });
      }
      return result;
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event.segs || !event.dDurationMs) continue;

      // Skip events that are sound effects or empty
      if (event.segs.length === 1) {
        const firstSeg = event.segs[0].utf8;
        if (!firstSeg || firstSeg.trim() === '\n') continue;
        if (PunctuationHelper.isSoundEffectMarker(firstSeg)) continue;
        if (PunctuationHelper.isEmpty(firstSeg.trim())) continue;
      }

      const nextEvent = events[i + 1];
      const converted = this._convertEventToSubtitles(event, nextEvent);

      if (converted.length === 0) continue;

      if (result.length === 0) {
        result.push(...converted);
      } else {
        const lastSub = result[result.length - 1];
        // If last subtitle doesn't end with punctuation, merge with first of new batch
        if (!PunctuationHelper.endsWithPunctuation(lastSub.text) && !this._hasSignificantGap(lastSub.end, converted[0].start)) {
          this._appendSubtitle(lastSub, converted[0], true);
          if (converted.length > 1) {
            result.push(...converted.slice(1));
          }
        } else {
          result.push(...converted);
        }
      }
    }

    return result;
  }

  /**
   * Convert a single event into multiple subtitles based on segment boundaries
   * and punctuation. This matches the original extension's convertSubtitles method.
   */
  static _convertEventToSubtitles(event, nextEvent) {
    const segs = event.segs;
    const result = [];
    let current = null;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg.utf8 || seg.utf8 === '\n') continue;

      const sub = this._createSubtitle(event, seg, i, nextEvent);

      if (current === null) {
        current = sub;
      } else {
        // Append this segment to current subtitle
        this._appendSubtitle(current, sub, false);
      }

      // If current text ends with punctuation, flush it
      if (current && PunctuationHelper.endsWithPunctuation(current.text)) {
        current.text = this._normalizeText(current.text);
        result.push(current);
        current = null;
      }
    }

    // Don't forget remaining text
    if (current !== null) {
      current.text = this._normalizeText(current.text);
      result.push(current);
    }

    return result;
  }

  /**
   * Create a subtitle from a single segment within an event.
   * Uses tOffsetMs for precise timing (matches original extension's createSubtitle).
   */
  static _createSubtitle(event, seg, segIndex, nextEvent) {
    let start = event.tStartMs;
    if (seg.tOffsetMs !== undefined) {
      start += seg.tOffsetMs;
    }
    start = start / 1000;

    let end = this._calculateSegmentEndTime(event, segIndex + 1, nextEvent) / 1000;

    return {
      start: start,
      end: end,
      dur: end - start,
      text: seg.utf8,
      processPunctuation: true
    };
  }

  /**
   * Calculate end time for a segment. Matches original extension's calculateSegmentEndTime.
   */
  static _calculateSegmentEndTime(event, nextSegIndex, nextEvent) {
    const segs = event.segs;
    const eventEnd = event.tStartMs + event.dDurationMs;

    // If there's a next segment in this event, use its offset
    const nextSeg = segs[nextSegIndex];
    if (nextSeg !== undefined && nextSeg.tOffsetMs !== undefined) {
      return event.tStartMs + nextSeg.tOffsetMs;
    }

    // Otherwise, use event end or next event start
    if (nextEvent !== undefined) {
      const nextStart = nextEvent.tStartMs;
      // If event end <= next event start, use event end (no overlap)
      if (eventEnd <= nextStart) {
        return eventEnd;
      }
      // Otherwise use next event start to avoid overlap
      return nextStart;
    }

    return eventEnd;
  }

  static _appendSubtitle(target, source, includeSpace) {
    target.text = includeSpace ? target.text + " " + source.text : target.text + source.text;
    target.end = source.end;
    target.dur = target.end - target.start;
  }

  static _hasSignificantGap(end, start) {
    return start - end >= 0.15;
  }

  static _normalizeText(text) {
    if (!text) return text;
    // Remove non-printable characters (matches original extension's regex)
    let t = text.replace(/[^\p{L}\p{M}\p{N}\p{P}\p{Zs}]/gu, '');
    // Remove filler words like "uh"
    t = t.replace(/(\s+|^)uh,?/gi, '$1');
    return t.trim();
  }
}
