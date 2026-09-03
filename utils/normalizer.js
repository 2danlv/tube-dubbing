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

  // Cac tu dem/bieu cam khong mang nghia, thuong xuat hien trong phu de tu sinh (auto-generated)
  static FILLER_WORDS = [
    // Tieng Anh
    "um", "umm", "ummm", "uh", "uhh", "uhm", "erm", "er", "hmm", "hmmm", "mm", "mmm", "mhm", "huh",
    "aa", "ah", "aha",
    // Tieng Viet
    "\u1EEBm", "\u1EEBmm", "\u1EDDm", "\u1EEB", "\u1EDD", "\u01A1", "\u01A1 hay", "h\u1EEDm", "\u1EA7y", "\u00E0 \u01A1i"
  ];

  static normalize(text) {
    let t = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
    t = this.removeSoundEffectMarkers(t);
    t = this.removeFillerWords(t);
    t = this.removeSpeakerName(t);
    return t;
  }

  // Loai bo cac tu dem bieu cam dung rieng (mm, uhm, um...), chi khop tron tu de tranh
  // cat nham vao tu khac (vd khong dung toi tu dem ben trong 1 tu ghep dai hon).
  static removeFillerWords(text) {
    if (!text) return text;
    const boundary = "[\\s,.!?;:\"'()\\[\\]\u2026]";
    const escaped = this.FILLER_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(^|${boundary})(${escaped.join("|")})(?=${boundary}|$)`, "giu");

    let result = text.replace(pattern, "$1");
    // Don lai khoang trang/dau cau thua sinh ra sau khi bo tu dem
    result = result
      .replace(/\s{2,}/g, " ")
      .replace(/,\s*,/g, ",")
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/[,.!?;:]{2,}/g, (m) => m.charAt(m.length - 1)) // gop dau cau doi (vd ",!" -> "!") con sot lai
      .replace(/^[,\s]+/, "")
      .trim();

    return result;
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

  // Heuristic đơn giản: kiểm tra tỉ lệ từ có dấu thanh/nguyên âm đặc trưng tiếng Việt
  // (ă, â, ê, ô, ơ, ư, đ, và các tổ hợp dấu thanh). Dùng để bỏ qua bước dịch AI khi
  // phụ đề gốc đã là tiếng Việt và ngôn ngữ đích cũng là Tiếng Việt.
  static looksVietnamese(text) {
    if (!text) return false;
    const vietnameseCharPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu;
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;

    let vietnameseWordCount = 0;
    for (const w of words) {
      if (vietnameseCharPattern.test(w)) vietnameseWordCount++;
    }

    return (vietnameseWordCount / words.length) >= 0.08;
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
