class TimingUtils {
  static calculateTextWeight(text, locale = "en") {
    if (!text) return 0;
    
    const tokens = this.getWordTokens(text, locale);
    let weight = tokens.length;
    
    // Add extra weight for long words (length > 7)
    for (const token of tokens) {
      const len = token.length;
      if (len > 7) {
        weight += (len - 7) * 0.1;
      }
    }
    
    // Extra weight for punctuation
    const strongPunctuation = (text.match(/[.!?\u3002\uFF01\uFF1F]/g) || []).length;
    weight += strongPunctuation * 0.3;
    
    const weakPunctuation = (text.match(/[,;:\uFF0C\uFF1B\uFF1A]/g) || []).length;
    weight += weakPunctuation * 0.15;

    return weight;
  }

  static getWordTokens(text, locale) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      return Array.from(segmenter.segment(text)).filter(s => s.isWordLike).map(s => s.segment);
    } catch (e) {
      // Fallback to regex tokenization
      return text.match(/[A-Za-z0-9]+(?:['\u2019-][A-Za-z0-9]+)*|[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g) ?? [];
    }
  }

  static distributeTimeProportionally(segments, start, end, gapDurationMs = 50, locale = "en") {
    if (segments.length === 0) return [];
    if (segments.length === 1) return [{ start: start, end: end, dur: end - start }];

    const weights = segments.map(s => this.calculateTextWeight(s, locale));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    const totalDuration = end - start;
    if (totalWeight === 0) {
      const avgDur = totalDuration / segments.length;
      return segments.map((s, i) => ({
        start: start + (i * avgDur),
        end: start + ((i + 1) * avgDur),
        dur: avgDur
      }));
    }

    const gapSeconds = gapDurationMs * (segments.length - 1) / 1000;
    const availableDuration = totalDuration - gapSeconds;
    
    if (availableDuration <= 0) {
        return this.distributeWithoutGaps(segments, weights, totalWeight, start, end);
    }

    const result = [];
    let currentStart = start;
    for (let i = 0; i < segments.length; i++) {
      const proportion = weights[i] / totalWeight;
      let duration = availableDuration * proportion;
      duration = Math.max(duration, 0.1);
      
      const currentEnd = (i === segments.length - 1) ? end : (currentStart + duration);
      result.push({
        start: currentStart,
        end: currentEnd,
        dur: currentEnd - currentStart
      });
      currentStart = currentEnd + (i < segments.length - 1 ? gapDurationMs / 1000 : 0);
    }
    
    return result;
  }

  static distributeWithoutGaps(segments, weights, totalWeight, start, end) {
      const totalDuration = end - start;
      const result = [];
      let currentStart = start;
      for (let i = 0; i < segments.length; i++) {
          const proportion = weights[i] / totalWeight;
          const duration = totalDuration * proportion;
          const currentEnd = (i === segments.length - 1) ? end : (currentStart + duration);
          result.push({
              start: currentStart,
              end: currentEnd,
              dur: currentEnd - currentStart
          });
          currentStart = currentEnd;
      }
      return result;
  }
}
