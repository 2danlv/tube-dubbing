class TextNormalizer {
  static SOUND_EFFECT_MARKERS = [
    "music", "applause", "laughter", "laugh", "laughing", "cheering",
    "cheer", "clapping", "whistling", "whistle", "sighing", "sigh",
    "crying", "coughing", "cough", "snorts", "sneezing", "sneeze",
    "yawning", "yawn", "breathing", "breath", "gasping", "gasp",
    "screaming", "scream", "shouting", "shout", "footsteps", "knocking",
    "knock", "ringing", "ring", "beeping", "beep", "buzzing", "buzz",
    "squeaking", "rustling", "clicking", "birds chirping", "dog barking",
    "thunder", "rain", "wind", "door closing", "door opening", "inaudible",
    "indistinct chatter", "background noise", "silence", "pause",
    "music playing", "music plays", "nhac", "am nhac", "음악", "musica",
    "musique", "musik", "музыка", "ดนตรี", "موسيقى", "संगीत", "vo tay"
  ];

  static EXCLUDE_PATTERNS = [
    /^(Question|Answer|Note|Tip|Warning|Example|Step|Chapter|Section|Part)$/i,
    /^\d+$/,
    /^[A-Z]$/,
    /^(https?|ftp|ftps|mailto|file)$/i
  ];

  static normalize(text) {
    let t = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
    t = this.removeSoundEffectMarkers(t);
    t = this.removeSpeakerName(t);
    return t;
  }

  static removeSoundEffectMarkers(text) {
    const regex = /\[([^\]]+)\]/g;
    return text.replace(regex, (match, content) => {
      if (this.isSoundEffectMarker(match)) return "";
      return match;
    });
  }

  static isSoundEffectMarker(marker) {
    const t = marker.trim();
    if (!t.startsWith("[") || !t.endsWith("]")) return false;
    const content = t.slice(1, -1).trim();
    if (!content || content.includes("[") || content.includes("]") || content.length > 30 || content.includes(":") || /\d/.test(content)) return false;
    
    const normalized = content.normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC").toLowerCase().trim();
    
    for (const m of this.SOUND_EFFECT_MARKERS) {
      if (normalized === m || normalized.startsWith(m + " ")) return true;
    }
    return false;
  }

  static removeSpeakerName(text) {
    const t = text.trim();
    const idx = t.indexOf(":");
    if (idx === -1 || idx === 0) return text;
    
    const name = t.substring(0, idx).trim();
    const rest = t.substring(idx + 1).trim();
    return this.isSpeakerName(name, rest) ? rest : text;
  }

  static isSpeakerName(name, restText) {
    if (name.length > 50 || !restText || restText.length < 3) return false;
    const words = name.split(/\s+/);
    if (words.length === 0 || words.length > 4 || !/^[A-Z]/.test(name)) return false;
    
    for (const pattern of this.EXCLUDE_PATTERNS) {
      if (pattern.test(name)) return false;
    }
    
    if (/^\d+$/.test(name) && /^\d+/.test(restText) || !/^[A-Z]/.test(restText)) return false;
    
    return true;
  }
}
