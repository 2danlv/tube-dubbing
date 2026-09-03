// Content script cho các trang web KHÔNG PHẢI YouTube, có phụ đề dạng VTT.
// Được chèn thủ công (on-demand) qua chrome.scripting.executeScript khi người dùng
// bấm "Kích hoạt trên trang này" trong popup (dùng quyền activeTab, không cần
// host_permissions mở rộng ra mọi trang web).
(function () {
  if (window.__genericSubtitleContentInstalled) return;
  window.__genericSubtitleContentInstalled = true;

  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('[Generic-VTT]', ...args); }
  function warn(...args) { if (DEBUG) console.warn('[Generic-VTT]', ...args); }

  const DEFAULT_API_KEY = "";
  const DEFAULT_MODEL = "gemini-3.5-flash-lite";
  const BLOCK_DURATION = 60;
  const MIN_DUCK_VOLUME = 0.005;
  const DUCK_VOLUME_RATIO = 0.05;

  function getDuckedVolume(vol) {
    return Math.max(vol * DUCK_VOLUME_RATIO, MIN_DUCK_VOLUME);
  }

  const segmenter = new SmartSegmenter(navigator.language || 'en');

  window.latestTranscriptData = [];
  let translatedBlocks = {};
  let translatingBlocks = {};
  let audioPreloadedBlocks = {};
  let preloadingAudioBlocks = {};
  let translationEnabled = false;
  let timeUpdateListenerAdded = false;
  let dubbingEnabled = true;
  let subtitlesEnabled = false;

  let activeTTSAudio = null;
  let originalVolume = null;
  let lastPlayedSegmentId = null;
  let currentPlayingSegment = null;
  let isSettingVolumeSelf = false;

  let targetVideo = null;
  let positionSyncRAF = null;
  let sourceLangHint = null; // Mã ngôn ngữ track (srclang), nếu có
  let sourceAlreadyMatchesTarget = false; // Track nguồn đã đúng ngôn ngữ đích -> bỏ qua bước dịch Gemini

  // Khớp với tên hiển thị ở popup (VOICE_MAP trong popup.js) sang mã ngôn ngữ ISO để so khớp với track.language/srclang
  const LANG_NAME_TO_CODE = {
    "Tiếng Việt": "vi",
    "Tiếng Anh": "en",
    "Tiếng Nhật": "ja",
    "Tiếng Trung": "zh",
    "Tiếng Hàn": "ko",
    "Tiếng Pháp": "fr",
    "Tiếng Đức": "de",
    "Tiếng Tây Ban Nha": "es",
    "Tiếng Nga": "ru",
    "Tiếng Ý": "it",
    "Tiếng Séc": "cs",
    "Tiếng Bồ Đào Nha (Brazil)": "pt",
    "Tiếng Ba Lan": "pl"
  };

  function getTargetLangCode() {
    return new Promise(resolve => {
      chrome.storage.local.get(["gemini_target_lang"], (result) => {
        const name = result.gemini_target_lang || "Tiếng Việt";
        resolve(LANG_NAME_TO_CODE[name] || 'vi');
      });
    });
  }

  // === NHẬN DIỆN VIDEO & PHỤ ĐỀ VTT ===

  function pickBestVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    videos.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
    return videos[0];
  }

  // Nhiều site không set srclang chuẩn trên <track> mà chỉ ghi ngôn ngữ trong label hiển thị
  // (vd label="Tiếng Việt") hoặc trong tên file (vd "phimabc_vi-VN.vtt"). Bảng này giúp suy luận
  // mã ngôn ngữ ISO từ các tín hiệu đó khi srclang thiếu/không chuẩn.
  const LANG_LABEL_HINTS = {
    vi: ['tieng viet', 'vietnamese', 'viet nam'],
    en: ['tieng anh', 'english'],
    ja: ['tieng nhat', 'japanese'],
    zh: ['tieng trung', 'chinese', 'mandarin'],
    ko: ['tieng han', 'korean'],
    fr: ['tieng phap', 'french'],
    de: ['tieng duc', 'german'],
    es: ['tieng tay ban nha', 'spanish'],
    ru: ['tieng nga', 'russian'],
    it: ['tieng y', 'italian'],
    pt: ['tieng bo dao nha', 'portuguese'],
    pl: ['tieng ba lan', 'polish'],
    cs: ['tieng sec', 'czech']
  };

  // Bỏ dấu tiếng Việt + hạ chữ thường để so khớp text không phân biệt dấu/hoa-thường
  function normalizeForMatch(text) {
    return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // Suy luận mã ngôn ngữ ISO (vd "vi") của một track từ nhiều tín hiệu theo thứ tự ưu tiên:
  // 1. srclang/track.language (vd "vi-VN" -> "vi")
  // 2. label hiển thị (vd "Tiếng Việt", "Vietnamese")
  // 3. tên file trong URL src (vd "vi-VN.vtt", "sub_en.vtt")
  function inferTrackLangCode(languageAttr, label, srcUrl) {
    if (languageAttr) {
      const code = languageAttr.toLowerCase().split(/[-_]/)[0];
      // Chỉ chấp nhận nếu trông giống mã ISO 639 hợp lệ (2-3 chữ cái). Một số site ghi nhầm
      // srclang bằng tên ngôn ngữ đầy đủ (vd srclang="Vietnamese") thay vì mã chuẩn "vi" --
      // trường hợp đó bỏ qua để rơi xuống nhận diện qua label/tên file bên dưới.
      if (/^[a-z]{2,3}$/.test(code)) return code;
    }

    const normalizedLabel = normalizeForMatch(label);
    if (normalizedLabel) {
      for (const [code, hints] of Object.entries(LANG_LABEL_HINTS)) {
        if (hints.some(h => normalizedLabel.includes(h))) return code;
      }
    }

    if (srcUrl) {
      try {
        const filename = decodeURIComponent(srcUrl.split('/').pop().split('?')[0]).toLowerCase();
        for (const code of Object.keys(LANG_LABEL_HINTS)) {
          const re = new RegExp('(^|[._-])' + code + '([._-]|$)', 'i');
          if (re.test(filename)) return code;
        }
      } catch (e) {
        // Bỏ qua URL không hợp lệ
      }
    }

    return null;
  }

  // Ưu tiên track khớp đúng ngôn ngữ đích trong danh sách ứng viên đã suy luận mã ngôn ngữ,
  // nếu không có thì rơi về thứ tự mặc định: tiếng Việt -> tiếng Anh -> ứng viên đầu tiên
  function pickBestTrackCandidate(candidates, targetLangCode) {
    return (targetLangCode && candidates.find(c => c.code === targetLangCode)) ||
      candidates.find(c => c.code === 'vi') ||
      candidates.find(c => c.code === 'en') ||
      candidates[0];
  }

  // Duyệt qua các thẻ <track> (có srclang + label + src đầy đủ để suy luận ngôn ngữ), rồi lấy
  // TextTrack tương ứng qua thuộc tính .track để đọc cues.
  function findSubtitleTextTrack(video, targetLangCode) {
    if (!video) return null;
    const trackEls = Array.from(video.querySelectorAll('track')).filter(t => t.kind === 'subtitles' || t.kind === 'captions' || !t.kind);
    if (trackEls.length === 0) return null;

    const candidates = trackEls
      .map(el => ({ el, track: el.track, code: inferTrackLangCode(el.srclang, el.label, el.src) }))
      .filter(c => c.track);
    if (candidates.length === 0) return null;

    const best = pickBestTrackCandidate(candidates, targetLangCode);
    return best ? { track: best.track, code: best.code } : null;
  }

  function waitForTrackCues(track, timeoutMs = 4000) {
    return new Promise(resolve => {
      if (!track) return resolve(null);
      track.mode = 'hidden';

      let timer;
      const finish = (cues) => {
        clearTimeout(timer);
        track.removeEventListener('load', onLoad);
        resolve(cues);
      };

      const onLoad = () => {
        if (track.cues && track.cues.length > 0) finish(track.cues);
      };
      track.addEventListener('load', onLoad);

      // Một số trình duyệt/track đã có sẵn cues ngay lập tức (đã load trước đó)
      if (track.cues && track.cues.length > 0) {
        finish(track.cues);
        return;
      }

      timer = setTimeout(() => {
        track.removeEventListener('load', onLoad);
        resolve(track.cues && track.cues.length > 0 ? track.cues : null);
      }, timeoutMs);
    });
  }

  async function tryExtractFromTextTracks(video, targetLangCode) {
    const best = findSubtitleTextTrack(video, targetLangCode);
    if (!best) return null;
    const cues = await waitForTrackCues(best.track);
    if (!cues || cues.length === 0) return null;
    sourceLangHint = best.code || best.track.language || null;
    sourceAlreadyMatchesTarget = !!(sourceLangHint && targetLangCode && sourceLangHint === targetLangCode);
    return VttParser.fromCues(cues);
  }

  // Dự phòng: một số site cross-origin không expose cues qua TextTrack API dù có <track>.
  // Thử tự fetch trực tiếp file .vtt (chỉ hoạt động nếu server cho phép CORS).
  async function tryFetchTrackSrc(video, targetLangCode) {
    if (!video) return null;
    const trackEls = Array.from(video.querySelectorAll('track'));
    if (trackEls.length === 0) return null;

    const subtitleTrackEls = trackEls.filter(t => t.kind === 'subtitles' || t.kind === 'captions');
    const pool = subtitleTrackEls.length > 0 ? subtitleTrackEls : trackEls;

    const candidates = pool.map(el => ({ el, code: inferTrackLangCode(el.srclang, el.label, el.src) }));
    const best = pickBestTrackCandidate(candidates, targetLangCode);
    const candidate = best ? best.el : null;
    if (!candidate || !candidate.src) return null;
    try {
      const res = await fetch(candidate.src, { credentials: 'include' });
      if (!res.ok) return null;
      const text = await res.text();
      sourceLangHint = best.code || candidate.srclang || sourceLangHint;
      sourceAlreadyMatchesTarget = !!(sourceLangHint && targetLangCode && sourceLangHint === targetLangCode);
      return VttParser.parse(text);
    } catch (e) {
      warn('Không thể fetch trực tiếp track src (có thể do CORS):', e);
      return null;
    }
  }

  function setupNetworkVttListener() {
    window.addEventListener('message', function (event) {
      if (event.source !== window) return;
      const detail = event.data;
      if (!detail || detail.action !== 'GENERIC_VTT_INTERCEPTED' || detail.namespace !== 'generic_vtt_interceptor') return;
      if (window.latestTranscriptData && window.latestTranscriptData.length > 0) return; // đã có phụ đề rồi

      log('Bắt được file VTT qua network:', detail.url);
      const rawSubtitles = VttParser.parse(detail.text);
      if (rawSubtitles.length > 0) {
        applySubtitles(rawSubtitles);
      }
    });
  }

  async function applySubtitles(rawSubtitles) {
    rawSubtitles.forEach(sub => {
      sub.text = TextNormalizer.normalize(sub.text);
    });

    // Nếu chưa xác định được qua mã ngôn ngữ của track (vd: phụ đề bắt được qua network,
    // không rõ ngôn ngữ), thử heuristic nội dung -- hiện chỉ nhận diện được tiếng Việt.
    // Không ghi đè nếu đã xác định match=true từ trước (qua tryExtractFromTextTracks/tryFetchTrackSrc).
    if (!sourceAlreadyMatchesTarget) {
      const targetLangCode = await getTargetLangCode();
      if (targetLangCode === 'vi') {
        const sampleText = rawSubtitles.slice(0, 30).map(s => s.text).join(' ');
        if (TextNormalizer.looksVietnamese(sampleText)) sourceAlreadyMatchesTarget = true;
      }
    }

    const processedSubtitles = segmenter.segmentSubtitles(rawSubtitles);
    const result = processedSubtitles.map((sub, idx) => ({
      id: idx,
      start: sub.start,
      end: sub.end,
      dur: sub.dur,
      time: new Date(sub.start * 1000).toISOString().substr(11, 8),
      text: sub.text,
      textTranslated: "",
      audioUrl: ""
    }));

    if (result.length === 0) return;

    window.latestTranscriptData = result;
    log('Đã lấy được', result.length, 'câu phụ đề.');
    initializeVideoOverlay();
  }

  async function detectAndLoadSubtitles(retryCount = 0) {
    const video = pickBestVideo();
    log('detectAndLoadSubtitles attempt', retryCount, '- video found:', !!video, video);
    if (!video) {
      if (retryCount < 10) {
        setTimeout(() => detectAndLoadSubtitles(retryCount + 1), 1000);
      }
      return;
    }
    targetVideo = video;
    log('video.textTracks:', video.textTracks, 'length:', video.textTracks ? video.textTracks.length : 'n/a');
    for (let i = 0; video.textTracks && i < video.textTracks.length; i++) {
      log('  track', i, 'kind=', video.textTracks[i].kind, 'mode=', video.textTracks[i].mode, 'cues=', video.textTracks[i].cues);
    }

    const targetLangCode = await getTargetLangCode();
    log('target lang code:', targetLangCode);

    let subs = await tryExtractFromTextTracks(video, targetLangCode);
    log('tryExtractFromTextTracks result:', subs);
    if (!subs || subs.length === 0) {
      subs = await tryFetchTrackSrc(video, targetLangCode);
      log('tryFetchTrackSrc result:', subs);
    }

    if (subs && subs.length > 0) {
      applySubtitles(subs);
      return;
    }

    // Chưa tìm thấy track nào có dữ liệu, thử lại (site có thể gắn <track> muộn)
    if (retryCount < 10) {
      setTimeout(() => detectAndLoadSubtitles(retryCount + 1), 1500);
    } else {
      log('Không tìm thấy phụ đề VTT nào sau nhiều lần thử. Đang chờ network interceptor bắt được file .vtt (nếu có)...');
    }
  }

  // === ID & CACHE ===

  function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'g' + Math.abs(hash).toString(36);
  }

  function getActiveVideoId() {
    return simpleHash(location.origin + location.pathname);
  }

  function refreshTranslatedBlocks() {
    translatedBlocks = {};
    if (!window.latestTranscriptData || window.latestTranscriptData.length === 0) return;

    const maxTime = window.latestTranscriptData[window.latestTranscriptData.length - 1].start;
    const totalBlocks = Math.ceil((maxTime + 1) / BLOCK_DURATION);

    for (let blockIdx = 0; blockIdx < totalBlocks; blockIdx++) {
      const startTime = blockIdx * BLOCK_DURATION;
      const endTime = (blockIdx + 1) * BLOCK_DURATION;
      const chunk = window.latestTranscriptData.filter(item => item.start >= startTime && item.start < endTime);
      if (chunk.length === 0) {
        translatedBlocks[blockIdx] = true;
      } else {
        const allTranslated = chunk.every(item => item.textTranslated && item.textTranslated.trim() !== "");
        if (allTranslated) translatedBlocks[blockIdx] = true;
      }
    }
  }

  function saveCurrentTranscriptToCache() {
    const videoId = getActiveVideoId();
    if (!videoId || window.latestTranscriptData.length === 0) return;
    const dataToSave = window.latestTranscriptData.map(item => ({
      id: item.id,
      textTranslated: item.textTranslated || ""
    }));
    chrome.storage.local.set({ [`yt_trans_${videoId}`]: dataToSave });
  }

  // === OVERLAY UI (định vị theo bounding rect của video vì trang generic không có player container cố định) ===

  function injectStyles() {
    if (document.getElementById('generic-translate-styles')) return;
    const style = document.createElement('style');
    style.id = 'generic-translate-styles';
    style.textContent = `
        #generic-translate-video-btn {
            position: fixed;
            z-index: 2147483000;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%);
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 20px;
            font-family: 'Roboto', 'Inter', sans-serif;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.85;
            transition: opacity 0.2s ease;
        }
        #generic-translate-video-btn:hover { opacity: 1; }
        #generic-translate-video-btn.translating {
            background: linear-gradient(135deg, #f59e0b, #db2777);
            animation: generic-pulse-btn 1.5s infinite;
            cursor: wait;
        }
        #generic-translate-video-btn.round-btn {
            width: 40px; height: 40px; border-radius: 50%; padding: 0; font-size: 12px; aspect-ratio: 1 / 1;
        }
        #generic-translate-subtitle-overlay {
            position: fixed;
            z-index: 2147482999;
            background-color: rgba(0, 0, 0, 0.72);
            color: #ffffff;
            padding: 8px 18px;
            border-radius: 6px;
            font-family: 'Roboto', 'Inter', sans-serif;
            font-size: 22px;
            font-weight: 500;
            text-align: center;
            line-height: 1.45;
            pointer-events: none;
            display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.9);
        }
        @keyframes generic-pulse-btn { 0% { opacity: 0.7; } 50% { opacity: 1; } 100% { opacity: 0.7; } }
        @keyframes generic-spin { 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  function syncOverlayPosition() {
    const video = targetVideo;
    const btn = document.getElementById('generic-translate-video-btn');
    const overlay = document.getElementById('generic-translate-subtitle-overlay');
    if (!video || (!btn && !overlay)) return;

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    if (btn) {
      btn.style.top = `${rect.top + 12}px`;
      btn.style.left = `${rect.right - btn.offsetWidth - 12}px`;
    }
    if (overlay) {
      overlay.style.maxWidth = `${rect.width * 0.85}px`;
      overlay.style.left = `${rect.left + rect.width / 2}px`;
      overlay.style.top = `${rect.top + rect.height * 0.82}px`;
      overlay.style.transform = 'translateX(-50%)';
    }
  }

  function startPositionSync() {
    if (positionSyncRAF) return;
    const loop = () => {
      syncOverlayPosition();
      positionSyncRAF = requestAnimationFrame(loop);
    };
    positionSyncRAF = requestAnimationFrame(loop);
    window.addEventListener('scroll', syncOverlayPosition, true);
    window.addEventListener('resize', syncOverlayPosition);
  }

  function initializeVideoOverlay() {
    injectStyles();
    if (!targetVideo) targetVideo = pickBestVideo();
    if (!targetVideo) return;

    let transBtn = document.getElementById('generic-translate-video-btn');
    if (!transBtn) {
      transBtn = document.createElement('button');
      transBtn.id = 'generic-translate-video-btn';
      document.body.appendChild(transBtn);
      transBtn.addEventListener('click', handleVideoTranslateClick);
    }

    let subOverlay = document.getElementById('generic-translate-subtitle-overlay');
    if (!subOverlay) {
      subOverlay = document.createElement('div');
      subOverlay.id = 'generic-translate-subtitle-overlay';
      document.body.appendChild(subOverlay);
    }

    startPositionSync();
    syncVideoVolume();

    const videoId = getActiveVideoId();
    chrome.storage.local.get([`yt_trans_${videoId}`, "gemini_target_lang"], (result) => {
      const cachedData = result[`yt_trans_${videoId}`];
      const targetLang = result.gemini_target_lang || "Tiếng Việt";

      if (cachedData && window.latestTranscriptData && window.latestTranscriptData.length > 0) {
        let hasTranslations = false;
        window.latestTranscriptData.forEach((item, index) => {
          if (cachedData[index]) {
            item.textTranslated = cachedData[index].textTranslated || "";
            if (item.textTranslated) hasTranslations = true;
          }
        });

        if (hasTranslations) {
          refreshTranslatedBlocks();
          translationEnabled = true;
          setupVideoTimeUpdateListener();
        }
      }
      updateVideoButtonState(transBtn, targetLang);
    });
  }

  function updateVideoButtonState(transBtn, targetLang) {
    if (!transBtn) return;
    if (!translationEnabled) {
      transBtn.innerHTML = `<span>Dịch & Lồng tiếng AI (${targetLang})</span>`;
      transBtn.style.background = '';
      transBtn.style.opacity = '0.85';
      transBtn.classList.remove('round-btn');
      transBtn.title = "Dịch & Lồng tiếng AI";
    } else {
      transBtn.classList.add('round-btn');
      if (dubbingEnabled) {
        transBtn.innerHTML = `Bật`;
        transBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        transBtn.style.opacity = '1';
        transBtn.title = `Lồng tiếng (${targetLang}): Đang Bật (Click để Tắt)`;
      } else {
        transBtn.innerHTML = `Tắt`;
        transBtn.style.background = 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)';
        transBtn.style.opacity = '0.85';
        transBtn.title = `Lồng tiếng (${targetLang}): Đang Tắt (Click để Bật)`;
      }
    }
  }

  // === ÂM LƯỢNG ===

  function syncVideoVolume() {
    const video = targetVideo;
    if (!video) return;
    if (dubbingEnabled) {
      if (originalVolume === null) originalVolume = video.volume;
      isSettingVolumeSelf = true;
      video.volume = getDuckedVolume(originalVolume);
      video.muted = false;
      isSettingVolumeSelf = false;
    } else if (originalVolume !== null) {
      isSettingVolumeSelf = true;
      video.volume = originalVolume;
      isSettingVolumeSelf = false;
      originalVolume = null;
    }
  }

  // === LUỒNG DỊCH & LỒNG TIẾNG (giống content.js, tổng quát hoá) ===

  async function handleVideoTranslateClick() {
    const video = targetVideo;
    const transBtn = document.getElementById('generic-translate-video-btn');
    const subOverlay = document.getElementById('generic-translate-subtitle-overlay');

    if (translationEnabled) {
      dubbingEnabled = !dubbingEnabled;
      if (!dubbingEnabled) {
        if (activeTTSAudio) { activeTTSAudio.pause(); activeTTSAudio = null; }
        lastPlayedSegmentId = null;
        currentPlayingSegment = null;
      }
      syncVideoVolume();
      chrome.storage.local.get(["gemini_target_lang"], (result) => {
        updateVideoButtonState(transBtn, result.gemini_target_lang || "Tiếng Việt");
      });
      return;
    }

    if (window.latestTranscriptData.length === 0) return;
    if (video) video.pause();

    transBtn.classList.add('translating');
    transBtn.innerHTML = `<span>Đang lồng tiếng...</span>`;

    chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang"], async (result) => {
      const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
      const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
      const targetLang = result.gemini_target_lang || "Tiếng Việt";

      if (subOverlay && subtitlesEnabled) {
        subOverlay.innerText = getDubbingStatusMessage(0, targetLang);
        subOverlay.style.display = 'block';
      }

      if (!apiKey) {
        transBtn.classList.remove('translating');
        updateVideoButtonState(transBtn, targetLang);
        if (subOverlay) {
          subOverlay.innerText = "⚠️ Chưa cấu hình Gemini API Key! Vui lòng nhấp vào icon Tube ở góc trên trình duyệt để nhập API Key trong phần Cài đặt.";
          subOverlay.style.display = 'block';
          setTimeout(() => {
            if (subOverlay.innerText.includes("Chưa cấu hình Gemini API Key")) subOverlay.style.display = 'none';
          }, 8000);
        }
        return;
      }

      try {
        await translateBlock(0, apiKey, model, targetLang);

        transBtn.classList.remove('translating');
        translationEnabled = true;
        dubbingEnabled = true;
        syncVideoVolume();
        updateVideoButtonState(transBtn, targetLang);

        if (video) video.play().catch(() => {});
        setupVideoTimeUpdateListener();
      } catch (error) {
        console.error("[Generic-VTT] Dịch & lồng tiếng khối đầu tiên thất bại:", error);
        transBtn.classList.remove('translating');
        transBtn.innerHTML = '❌ Lỗi lồng tiếng. Nhấp để thử lại';
        if (subOverlay) subOverlay.innerText = error.message || "Có lỗi xảy ra khi gọi Gemini API hoặc sinh Edge TTS. Vui lòng thử lại.";
      }
    });
  }

  async function limitConcurrency(tasks, limit) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
      const p = Promise.resolve().then(() => task());
      results.push(p);
      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean, clean);
      if (executing.size >= limit) await Promise.race(executing);
    }
    return Promise.all(results);
  }

  // Lọc phụ đề của một khối và xác định khối đó có cần gọi Gemini để dịch hay không
  // (dùng chung cho translateBlock lẫn phần hiển thị thông báo trạng thái trên overlay).
  function getBlockChunkAndTranslationNeed(blockIdx, targetLang) {
    const startTime = blockIdx * BLOCK_DURATION;
    const endTime = (blockIdx + 1) * BLOCK_DURATION;
    const chunk = window.latestTranscriptData.filter(item => item.start >= startTime && item.start < endTime);

    const currentTargetCode = LANG_NAME_TO_CODE[targetLang] || null;
    const sourceMatchesCurrentTarget = chunk.length > 0 && (
      (currentTargetCode && sourceLangHint && sourceLangHint.toLowerCase().startsWith(currentTargetCode)) ||
      (currentTargetCode === 'vi' && TextNormalizer.looksVietnamese(chunk.map(c => c.text).join(' ')))
    );

    return { chunk, sourceMatchesCurrentTarget };
  }

  // Thông báo hiển thị trên overlay: phân biệt "dịch + lồng tiếng" (có gọi Gemini)
  // với "lồng tiếng" thuần (phụ đề gốc đã đúng ngôn ngữ đích, hoặc chỉ đang sinh lại audio).
  function getDubbingStatusMessage(blockIdx, targetLang) {
    const { sourceMatchesCurrentTarget } = getBlockChunkAndTranslationNeed(blockIdx, targetLang);
    return sourceMatchesCurrentTarget
      ? "Đang lồng tiếng, bạn đợi chút nhé ..."
      : "Đang dịch và lồng tiếng, bạn đợi chút nhé ...";
  }

  async function translateBlock(blockIdx, apiKey, model, targetLang) {
    if (translatedBlocks[blockIdx]) return;
    translatingBlocks[blockIdx] = true;

    const startTime = blockIdx * BLOCK_DURATION;
    const endTime = (blockIdx + 1) * BLOCK_DURATION;
    const { chunk, sourceMatchesCurrentTarget } = getBlockChunkAndTranslationNeed(blockIdx, targetLang);

    if (chunk.length === 0) {
      translatedBlocks[blockIdx] = true;
      delete translatingBlocks[blockIdx];
      return;
    }

    let retryCount = 0;
    const MAX_RETRIES = 3;
    let success = false;
    let lastError = null;

    while (retryCount < MAX_RETRIES && !success) {
      try {
        if (sourceMatchesCurrentTarget) {
          // Phụ đề gốc đã đúng ngôn ngữ đích -> bỏ qua Gemini, đọc thẳng nguyên văn
          log(`Block ${blockIdx}: Phụ đề gốc đã khớp ngôn ngữ đích (${targetLang}), bỏ qua bước dịch AI.`);
          chunk.forEach(item => {
            const mainItem = window.latestTranscriptData.find(m => m.id === item.id);
            if (mainItem) mainItem.textTranslated = mainItem.text;
          });
        } else {
          const translatedResult = await callGeminiAPI(chunk, apiKey, model, targetLang);
          translatedResult.forEach(translatedItem => {
            const matchedOrig = chunk.find(c => c.id == translatedItem.id);
            if (matchedOrig) {
              const mainItem = window.latestTranscriptData.find(item => item.id === matchedOrig.id);
              if (mainItem) mainItem.textTranslated = translatedItem.text;
            }
          });
        }

        const resultStorage = await new Promise(res => chrome.storage.local.get(["gemini_tts_voice", "gemini_tts_rate"], res));
        const ttsVoice = resultStorage.gemini_tts_voice || "vi-VN-NamMinhNeural";
        const ttsRate = resultStorage.gemini_tts_rate || "-10%";

        const ttsTasks = chunk.map(item => async () => {
          const mainItem = window.latestTranscriptData.find(m => m.id === item.id);
          if (mainItem && mainItem.textTranslated && !mainItem.audioObject) {
            try {
              const audioUrl = await generateTTS(mainItem.textTranslated, ttsVoice, ttsRate);
              mainItem.audioUrl = audioUrl;
              mainItem.audioObject = new Audio(audioUrl);
              mainItem.audioObject.preload = "auto";
            } catch (ttsErr) {
              warn(`Sinh TTS thất bại cho câu "${mainItem.textTranslated}":`, ttsErr);
            }
          }
        });

        await limitConcurrency(ttsTasks, 3);

        success = true;
        translatedBlocks[blockIdx] = true;
        audioPreloadedBlocks[blockIdx] = true;
        saveCurrentTranscriptToCache();
      } catch (err) {
        lastError = err;
        retryCount++;
        if (retryCount < MAX_RETRIES) await new Promise(res => setTimeout(res, 4000));
      }
    }

    delete translatingBlocks[blockIdx];
    if (!success) {
      const reason = lastError && lastError.message ? lastError.message : "Không rõ nguyên nhân";
      throw new Error(`Không thể dịch/lồng tiếng Block ${blockIdx} sau ${MAX_RETRIES} lần thử. Lỗi gốc: ${reason}`);
    }
  }

  async function callGeminiAPI(chunk, apiKey, model, targetLang) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "TRANSLATE_TEXT", chunk, apiKey, model, targetLang }, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response && response.status === "error") reject(new Error(response.message));
        else if (response && response.status === "success") resolve(response.data);
        else reject(new Error("Unknown response from background script"));
      });
    });
  }

  async function generateTTS(text, voice = "vi-VN-NamMinhNeural", rate = "-10%") {
    const res = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "GENERATE_EDGE_TTS", text, voice, rate }, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });

    if (res && res.status === "success" && res.audioBase64) {
      const binaryString = atob(res.audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      const blob = new Blob([bytes], { type: "audio/mp3" });
      return URL.createObjectURL(blob);
    }
    throw new Error(res ? res.message : "Phản hồi rỗng từ Background");
  }

  function setupVideoTimeUpdateListener() {
    const video = targetVideo;
    if (!video || timeUpdateListenerAdded) return;
    video.addEventListener('timeupdate', handleVideoTimeUpdate);
    video.addEventListener('pause', handleVideoPause);
    video.addEventListener('play', handleVideoPlay);
    video.addEventListener('seeking', handleVideoSeeking);
    video.addEventListener('ratechange', handleVideoRateChange);
    video.addEventListener('waiting', handleVideoWaiting);
    video.addEventListener('volumechange', handleVideoVolumeChange);
    timeUpdateListenerAdded = true;
  }

  function handleVideoPause() {
    const video = targetVideo;
    if (video && (video.wasPausedByTranslation || video.wasPausedByTTSLoading)) return;
    if (activeTTSAudio && !activeTTSAudio.paused) activeTTSAudio.pause();
  }

  function handleVideoPlay() {
    const video = targetVideo;
    if (video && (video.wasPausedByTranslation || video.wasPausedByTTSLoading)) {
      video.pause();
      return;
    }
    if (activeTTSAudio && activeTTSAudio.paused) activeTTSAudio.play().catch(() => {});
  }

  function handleVideoSeeking() {
    const video = targetVideo;
    if (!video) return;
    video.wasPausedByTranslation = false;
    video.wasPausedByTTSLoading = false;

    if (activeTTSAudio && currentPlayingSegment) {
      const baseRate = currentPlayingSegment.basePlaybackRate || 1.0;
      const offset = (video.currentTime - currentPlayingSegment.start) * baseRate;
      if (offset >= 0 && offset < activeTTSAudio.duration) {
        activeTTSAudio.currentTime = offset;
        if (!video.paused && activeTTSAudio.paused) activeTTSAudio.play().catch(() => {});
      } else {
        activeTTSAudio.pause();
        activeTTSAudio = null;
        currentPlayingSegment = null;
      }
    } else {
      lastPlayedSegmentId = null;
    }
  }

  function handleVideoRateChange() {
    const video = targetVideo;
    if (video && activeTTSAudio && currentPlayingSegment) {
      const baseRate = currentPlayingSegment.basePlaybackRate || 1.0;
      activeTTSAudio.playbackRate = baseRate * video.playbackRate;
    }
  }

  function handleVideoWaiting() {
    if (activeTTSAudio && !activeTTSAudio.paused) activeTTSAudio.pause();
  }

  function handleVideoVolumeChange() {
    if (!dubbingEnabled || isSettingVolumeSelf) return;
    const video = targetVideo;
    if (!video) return;

    if (video.muted) {
      isSettingVolumeSelf = true;
      video.muted = false;
      isSettingVolumeSelf = false;
    }

    // Nếu volume hiện tại khác với mức duck mong muốn -> người dùng vừa tự kéo thanh volume
    // của player, giá trị mới đó chính là mức âm lượng gốc họ muốn đặt.
    if (Math.abs(video.volume - getDuckedVolume(originalVolume)) > 0.01) {
      originalVolume = video.volume;
      isSettingVolumeSelf = true;
      video.volume = getDuckedVolume(originalVolume);
      isSettingVolumeSelf = false;
    }
  }

  function handleVideoTimeUpdate() {
    if (!translationEnabled) return;
    const video = targetVideo;
    if (!video) return;

    const currentSec = video.currentTime;
    const currentBlockIdx = Math.floor(currentSec / BLOCK_DURATION);

    if (!translatedBlocks[currentBlockIdx]) {
      if (!video.wasPausedByTranslation) {
        video.pause();
        video.wasPausedByTranslation = true;
        const subOverlay = document.getElementById('generic-translate-subtitle-overlay');
        if (subOverlay) {
          subOverlay.innerText = "Đang dịch đoạn này bằng Gemini AI, vui lòng chờ trong giây lát...";
          subOverlay.style.display = 'block';
        }
      }

      if (!translatingBlocks[currentBlockIdx]) {
        chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang"], async (result) => {
          const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
          const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
          const targetLang = result.gemini_target_lang || "Tiếng Việt";
          try {
            await translateBlock(currentBlockIdx, apiKey, model, targetLang);
            if (video.wasPausedByTranslation) {
              video.wasPausedByTranslation = false;
              video.play().catch(() => {});
            }
          } catch (err) {
            const subOverlay = document.getElementById('generic-translate-subtitle-overlay');
            if (subOverlay) {
              subOverlay.innerText = err.message || "Có lỗi xảy ra khi gọi Gemini API hoặc sinh Edge TTS. Vui lòng thử lại.";
              setTimeout(() => { subOverlay.style.display = 'none'; }, 5000);
            }
            if (video.wasPausedByTranslation) {
              video.wasPausedByTranslation = false;
              video.play().catch(() => {});
            }
          }
        });
      }
      return;
    }

    if (dubbingEnabled && !audioPreloadedBlocks[currentBlockIdx]) {
      if (!video.wasPausedByTTSLoading) {
        video.pause();
        video.wasPausedByTTSLoading = true;
        const subOverlay = document.getElementById('generic-translate-subtitle-overlay');
        if (subOverlay) {
          subOverlay.innerText = "Đang lồng tiếng, bạn đợi chút nhé ...";
          subOverlay.style.display = 'block';
        }
      }
      if (!preloadingAudioBlocks[currentBlockIdx]) preloadAudioForBlock(currentBlockIdx);
      return;
    }

    renderActiveSubtitleAndPlayVoice(currentSec);

    const targetBlockIdx = Math.floor((currentSec + 59) / BLOCK_DURATION);
    if (targetBlockIdx > 0 && !translatedBlocks[targetBlockIdx] && !translatingBlocks[targetBlockIdx]) {
      chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang"], async (result) => {
        const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
        const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
        const targetLang = result.gemini_target_lang || "Tiếng Việt";
        try {
          await translateBlock(targetBlockIdx, apiKey, model, targetLang);
        } catch (err) {
          console.error(`[Generic-VTT] Dịch & lồng tiếng ngầm Block ${targetBlockIdx} bị lỗi:`, err);
        }
      });
    }

    if (dubbingEnabled && targetBlockIdx > 0 && translatedBlocks[targetBlockIdx] && !audioPreloadedBlocks[targetBlockIdx] && !preloadingAudioBlocks[targetBlockIdx]) {
      preloadAudioForBlock(targetBlockIdx);
    }
  }

  function renderActiveSubtitleAndPlayVoice(currentTime) {
    const subOverlay = document.getElementById('generic-translate-subtitle-overlay');
    if (!subOverlay) return;

    let activeSeg = null;
    const data = window.latestTranscriptData || [];
    for (let i = 0; i < data.length; i++) {
      const seg = data[i];
      const nextSeg = data[i + 1];
      const end = nextSeg ? nextSeg.start : (seg.start + 3.5);
      if (currentTime >= seg.start && currentTime < end) { activeSeg = seg; break; }
    }

    if (activeSeg && activeSeg.textTranslated) {
      if (subtitlesEnabled) {
        subOverlay.innerText = activeSeg.textTranslated;
        subOverlay.style.display = 'block';
      } else {
        subOverlay.style.display = 'none';
      }

      if (dubbingEnabled && lastPlayedSegmentId !== activeSeg.id) {
        lastPlayedSegmentId = activeSeg.id;
        if (activeSeg.audioObject) {
          playVoiceOverObject(activeSeg.audioObject, activeSeg);
        } else if (activeSeg.audioUrl) {
          activeSeg.audioObject = new Audio(activeSeg.audioUrl);
          activeSeg.audioObject.preload = "auto";
          playVoiceOverObject(activeSeg.audioObject, activeSeg);
        } else {
          generateAndPlayTTSOnTheFly(activeSeg);
        }
      }
    } else {
      subOverlay.style.display = 'none';
    }
  }

  async function preloadAudioForBlock(blockIdx) {
    if (audioPreloadedBlocks[blockIdx]) return;
    preloadingAudioBlocks[blockIdx] = true;

    const startTime = blockIdx * BLOCK_DURATION;
    const endTime = (blockIdx + 1) * BLOCK_DURATION;
    const chunk = window.latestTranscriptData.filter(item => item.start >= startTime && item.start < endTime);

    if (chunk.length === 0) {
      audioPreloadedBlocks[blockIdx] = true;
      delete preloadingAudioBlocks[blockIdx];
      resumeVideoAfterPreload();
      return;
    }

    try {
      const resultStorage = await new Promise(res => chrome.storage.local.get(["gemini_tts_voice", "gemini_tts_rate"], res));
      const ttsVoice = resultStorage.gemini_tts_voice || "vi-VN-NamMinhNeural";
      const ttsRate = resultStorage.gemini_tts_rate || "-10%";

      const ttsTasks = chunk.map(item => async () => {
        const mainItem = window.latestTranscriptData.find(m => m.id === item.id);
        if (mainItem && mainItem.textTranslated && !mainItem.audioObject) {
          try {
            const audioUrl = await generateTTS(mainItem.textTranslated, ttsVoice, ttsRate);
            mainItem.audioUrl = audioUrl;
            mainItem.audioObject = new Audio(audioUrl);
            mainItem.audioObject.preload = "auto";
          } catch (ttsErr) {
            warn(`Tải trước TTS thất bại cho câu "${mainItem.textTranslated}":`, ttsErr);
          }
        }
      });

      await limitConcurrency(ttsTasks, 3);
      audioPreloadedBlocks[blockIdx] = true;
    } catch (err) {
      warn(`Tải trước âm thanh cho Block ${blockIdx} thất bại:`, err);
    }

    delete preloadingAudioBlocks[blockIdx];
    resumeVideoAfterPreload();
  }

  function resumeVideoAfterPreload() {
    const video = targetVideo;
    if (video && video.wasPausedByTTSLoading) {
      video.wasPausedByTTSLoading = false;
      video.play().catch(() => {});
    }
    const subOverlay = document.getElementById('generic-translate-subtitle-overlay');
    if (subOverlay && subOverlay.innerText.includes("đợi chút nhé")) subOverlay.style.display = 'none';
  }

  async function generateAndPlayTTSOnTheFly(segment) {
    const video = targetVideo;
    const subOverlay = document.getElementById('generic-translate-subtitle-overlay');
    const wasPlaying = video && !video.paused;
    if (video && wasPlaying) { video.pause(); video.wasPausedByTTSLoading = true; }

    if (subOverlay) {
      subOverlay.innerText = "Đang lồng tiếng, bạn đợi chút nhé ...";
      subOverlay.style.display = 'block';
    }

    try {
      const resultStorage = await new Promise(res => chrome.storage.local.get(["gemini_tts_voice", "gemini_tts_rate"], res));
      const ttsVoice = resultStorage.gemini_tts_voice || "vi-VN-NamMinhNeural";
      const ttsRate = resultStorage.gemini_tts_rate || "-10%";

      const audioUrl = await generateTTS(segment.textTranslated, ttsVoice, ttsRate);
      segment.audioUrl = audioUrl;
      segment.audioObject = new Audio(audioUrl);
      segment.audioObject.preload = "auto";

      if (subOverlay) subOverlay.innerText = segment.textTranslated;

      if (video && video.wasPausedByTTSLoading) {
        video.wasPausedByTTSLoading = false;
        await video.play().catch(() => {});
      }

      playVoiceOverObject(segment.audioObject, segment);
    } catch (err) {
      warn('Sinh TTS động on-the-fly thất bại:', err);
      if (video && video.wasPausedByTTSLoading) {
        video.wasPausedByTTSLoading = false;
        video.play().catch(() => {});
      }
      if (subOverlay) subOverlay.style.display = 'none';
    }
  }

  function playVoiceOverObject(audio, segment) {
    const video = targetVideo;
    if (activeTTSAudio) { activeTTSAudio.pause(); activeTTSAudio.currentTime = 0; }
    activeTTSAudio = audio;
    currentPlayingSegment = segment;

    const startPlay = () => {
      let baseRate = 1.0;
      if (video) {
        const nextSeg = window.latestTranscriptData.find(item => item.id === segment.id + 1);
        const segmentEnd = nextSeg ? nextSeg.start : (segment.start + 3.5);
        const segmentDuration = segmentEnd - segment.start;

        if (segmentDuration > 0 && audio.duration > 0) {
          const ratio = audio.duration / segmentDuration;
          if (ratio > 1.05) baseRate = Math.min(1.6, ratio);
        }
        segment.basePlaybackRate = baseRate;
        audio.playbackRate = baseRate * video.playbackRate;

        const diff = video.currentTime - segment.start;
        const offset = diff * baseRate;
        if (diff > 0.8 && offset < audio.duration) {
          audio.currentTime = offset;
        } else {
          audio.currentTime = 0;
        }
      } else {
        segment.basePlaybackRate = 1.0;
        audio.playbackRate = 1.0;
        audio.currentTime = 0;
      }

      audio.play().catch(err => console.error('[Generic-VTT] Lỗi phát âm thanh lồng tiếng:', err));
    };

    if (audio.readyState >= 1) startPlay();
    else audio.addEventListener('loadedmetadata', startPlay, { once: true });

    audio.onended = () => {
      if (activeTTSAudio === audio) { activeTTSAudio = null; currentPlayingSegment = null; }
    };
  }

  // === MESSAGING VỚI POPUP (cùng giao thức với content.js của YouTube) ===

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "REQUEST_TRANSCRIPT_FROM_CONTENT") {
      sendResponse({ status: "success", data: window.latestTranscriptData || [] });
    } else if (message.action === "RESCAN_SUBTITLES") {
      // Cho phép popup yêu cầu quét lại mà không cần chèn lại các file script
      // (chèn lại sẽ gây lỗi "class đã được khai báo" vì cùng chạy chung global scope với lần trước).
      // Luôn quét lại (kể cả khi đã có dữ liệu) để áp dụng đúng ngôn ngữ đích mới nếu người dùng vừa đổi
      // trong Cài đặt -- trừ khi đang lồng tiếng dở dang để tránh làm gián đoạn.
      if (!translationEnabled) {
        window.latestTranscriptData = [];
        sourceAlreadyMatchesTarget = false;
        detectAndLoadSubtitles(0);
      }
      sendResponse({ status: "success" });
    } else if (message.action === "JUMP_TO_TIME") {
      const video = targetVideo;
      if (video) {
        video.currentTime = message.seconds;
        if (video.paused) video.play().catch(() => {});
        sendResponse({ status: "success" });
      } else {
        sendResponse({ status: "error", message: "Không tìm thấy video." });
      }
    } else if (message.action === "GET_DUBBING_STATE") {
      sendResponse({ status: "success", dubbingEnabled: dubbingEnabled });
    } else if (message.action === "TOGGLE_DUBBING") {
      dubbingEnabled = message.enabled;
      if (!dubbingEnabled) {
        if (activeTTSAudio) { activeTTSAudio.pause(); activeTTSAudio = null; }
        lastPlayedSegmentId = null;
      }
      syncVideoVolume();
      sendResponse({ status: "success", dubbingEnabled: dubbingEnabled });
    } else if (message.action === "GET_SUBTITLES_STATE") {
      sendResponse({ status: "success", subtitlesEnabled: subtitlesEnabled });
    } else if (message.action === "TOGGLE_SUBTITLES") {
      subtitlesEnabled = message.enabled;
      if (!subtitlesEnabled) {
        const overlay = document.getElementById('generic-translate-subtitle-overlay');
        if (overlay) overlay.style.display = 'none';
      }
      sendResponse({ status: "success", subtitlesEnabled: subtitlesEnabled });
    } else if (message.action === "UPDATE_TRANSLATIONS") {
      const translations = message.data || [];
      if (translations.length > 0 && window.latestTranscriptData) {
        translations.forEach(item => {
          const mainItem = window.latestTranscriptData.find(m => m.id === item.id);
          if (mainItem) {
            const newText = item.textTranslated || "";
            if (mainItem.textTranslated !== newText) {
              mainItem.textTranslated = newText;
              if (mainItem.audioUrl && mainItem.audioUrl.startsWith("blob:")) {
                try { URL.revokeObjectURL(mainItem.audioUrl); } catch (e) {}
                mainItem.audioUrl = "";
              }
              if (mainItem.audioObject) {
                try { mainItem.audioObject.pause(); mainItem.audioObject.src = ""; mainItem.audioObject.load(); } catch (e) {}
                mainItem.audioObject = null;
              }
              const blockIdx = Math.floor(mainItem.start / BLOCK_DURATION);
              audioPreloadedBlocks[blockIdx] = false;
            }
          }
        });

        refreshTranslatedBlocks();
        translationEnabled = true;
        setupVideoTimeUpdateListener();

        if (targetVideo) renderActiveSubtitleAndPlayVoice(targetVideo.currentTime);

        const transBtn = document.getElementById('generic-translate-video-btn');
        if (transBtn) {
          chrome.storage.local.get(["gemini_target_lang"], (result) => {
            updateVideoButtonState(transBtn, result.gemini_target_lang || "Tiếng Việt");
          });
        }
      }
      sendResponse({ status: "success" });
    } else if (message.action === "RESET_TRANSLATION") {
      const videoId = getActiveVideoId();
      if (videoId) chrome.storage.local.remove(`yt_trans_${videoId}`);

      if (activeTTSAudio) { activeTTSAudio.pause(); activeTTSAudio = null; }
      if (targetVideo) targetVideo.wasPausedByTranslation = false;
      lastPlayedSegmentId = null;
      currentPlayingSegment = null;

      translatedBlocks = {};
      translatingBlocks = {};
      audioPreloadedBlocks = {};
      preloadingAudioBlocks = {};
      translationEnabled = false;
      dubbingEnabled = false;
      syncVideoVolume();

      if (window.latestTranscriptData) {
        window.latestTranscriptData.forEach(item => { item.textTranslated = ""; item.audioUrl = ""; });
      }

      const overlay = document.getElementById('generic-translate-subtitle-overlay');
      if (overlay) { overlay.innerText = ""; overlay.style.display = 'none'; }

      const btn = document.getElementById('generic-translate-video-btn');
      if (btn) { updateVideoButtonState(btn, "Tiếng Việt"); btn.classList.remove('translating'); }
      sendResponse({ status: "success" });
    }
    return true;
  });

  // === KHỞI ĐỘNG ===
  setupNetworkVttListener();
  detectAndLoadSubtitles();

  log('Generic VTT content script initialized.');
})();
