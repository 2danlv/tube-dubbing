/**
 * VttParser - Parses WEBVTT text (or native TextTrack cues) into the same
 * subtitle shape used by YouTubeParser: { start, end, dur, text } (seconds).
 */
class VttParser {
  static parse(vttText) {
    if (!vttText) return [];
    const text = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    if (lines[0] && lines[0].trim().toUpperCase().startsWith('WEBVTT')) {
      i = 1;
      // Skip header metadata block until the first blank line
      while (i < lines.length && lines[i].trim() !== '') i++;
    }

    const timeRegex = /(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})/;

    while (i < lines.length) {
      let line = lines[i].trim();
      if (!line) { i++; continue; }

      if (!timeRegex.test(line)) {
        // Likely a cue identifier line, skip to the next one
        i++;
        continue;
      }

      const match = line.match(timeRegex);
      const start = this._toSeconds(match[1], match[2], match[3], match[4]);
      const end = this._toSeconds(match[5], match[6], match[7], match[8]);
      i++;

      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }

      const cleanText = this._cleanCueText(textLines.join(' '));
      if (cleanText && end > start) {
        result.push({ start, end, dur: end - start, text: cleanText });
      }
    }

    return result;
  }

  /**
   * Convert a native TextTrackCueList (from video.textTracks[i].cues) into
   * the same subtitle shape, so it can feed the same normalizer/segmenter pipeline.
   */
  static fromCues(cues) {
    const result = [];
    if (!cues) return result;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const cleanText = this._cleanCueText(cue.text || '');
      if (cleanText && cue.endTime > cue.startTime) {
        result.push({ start: cue.startTime, end: cue.endTime, dur: cue.endTime - cue.startTime, text: cleanText });
      }
    }
    return result;
  }

  static _toSeconds(hours, minutes, seconds, millis) {
    const h = hours ? parseInt(hours, 10) : 0;
    return h * 3600 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10) + parseInt(millis, 10) / 1000;
  }

  static _cleanCueText(raw) {
    if (!raw) return '';
    // Strip VTT markup tags (<b>, <i>, <c>, <00:00:01.000>, <v Speaker>, ...)
    let t = raw.replace(/\n/g, ' ').replace(/<[^>]*>/g, '');
    t = t.replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    return t.replace(/\s+/g, ' ').trim();
  }
}
