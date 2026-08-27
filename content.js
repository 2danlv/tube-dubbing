const DEBUG = false; // Tắt debug để ẩn log trong console
if (!DEBUG) {
    console.log = () => { };
    console.warn = () => { };
}

console.log("[XT-Extension] Khởi động bộ chặn Network Transcript!");

// Log chuyển đổi trạng thái tab ẩn/hiện để chẩn đoán vấn đề lồng tiếng im bặt khi chuyển tab
document.addEventListener('visibilitychange', () => {
    const video = document.querySelector('video');
    console.log(`[XT-Extension] Tab visibility đổi thành "${document.visibilityState}". video.paused=${video ? video.paused : "?"}, activeTTSAudio.paused=${typeof activeTTSAudio !== "undefined" && activeTTSAudio ? activeTTSAudio.paused : "(không có)"}`);
});

// --- NEW TRANSCRIPT INTERCEPTOR LOGIC ---
// inject.js đã được chuyển cấu hình chạy trực tiếp ở MAIN world thông qua manifest.json để tránh lỗi CSP trên Brave/Edge.

let segmenter = new SmartSegmenter(navigator.language || 'en');
let clickedToEnableCC = false;

function isAdPlaying() {
    const player = document.querySelector('.html5-video-player, #movie_player');
    const adShowing = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
    const adText = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-image-overlay');
    return !!(adShowing || adText);
}

function autoEnableCC() {
    clickedToEnableCC = false;
    const ccBtn = document.querySelector('.ytp-subtitles-button');
    const isPressed = ccBtn && ccBtn.getAttribute('aria-pressed') === 'true';
    if (!isPressed) {
        clickedToEnableCC = true;
    }
    console.log("[XT-Extension] Gửi yêu cầu kích hoạt phụ đề qua player API...");
    window.postMessage({ action: 'FORCE_ENABLE_SUBTITLES' }, "*");
}

window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const detail = event.data;
    if (!detail || detail.action !== 'YT_TRANSCRIPT_INTERCEPTED' || detail.namespace !== 'yt_transcript_interceptor') return;

    console.log('[content.js] Received transcript data via postMessage for video:', detail.videoId);

    const activeVideoId = getActiveVideoId();
    if (!activeVideoId || detail.videoId !== activeVideoId) {
        console.log('[content.js] Ignored transcript for non-matching video/ad ID:', detail.videoId, 'Expected:', activeVideoId);
        return;
    }

    const rawSubtitles = YouTubeParser.parse(detail.data);
    rawSubtitles.forEach(sub => {
        sub.text = TextNormalizer.normalize(sub.text);
    });

    const processedSubtitles = segmenter.segmentSubtitles(rawSubtitles);
    console.log('[content.js] Processing complete. Total sentences:', processedSubtitles.length);

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

    if (result.length > 0) {
        window.latestTranscriptData = result;
        console.log("%c[XT-Extension] 🎉 LẤY TRANSCRIPT QUA NETWORK THÀNH CÔNG! 👇", "color: #00ff00; font-weight: bold; font-size: 14px;", result);
        initializeVideoOverlay();

        // Tự động tắt CC nếu trước đó extension đã tự bật
        if (clickedToEnableCC) {
            console.log("[XT-Extension] Tự động tắt CC sau khi đã nhận được transcript...");
            window.postMessage({ action: 'FORCE_DISABLE_SUBTITLES' }, "*");
            clickedToEnableCC = false;
        }
    }
});
// --- END NEW LOGIC ---


// Cấu hình mặc định
const DEFAULT_API_KEY = "";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const BLOCK_DURATION = 60; // Khối 1 phút (60 giây) để tối ưu tốc độ lồng tiếng

// Biến toàn cục lưu trữ dữ liệu
window.latestTranscriptData = [];
let translatedBlocks = {};  // Đánh dấu khối đã dịch: { [blockIndex]: true }
let translatingBlocks = {}; // Đánh dấu khối đang dịch: { [blockIndex]: true }
let audioPreloadedBlocks = {};  // Đánh dấu khối đã load xong audio: { [blockIndex]: true }
let preloadingAudioBlocks = {}; // Đánh dấu khối đang load audio: { [blockIndex]: true }
let translationEnabled = false; // Trạng thái kích hoạt dịch phụ đề
let timeUpdateListenerAdded = false;
let dubbingEnabled = true; // State for dubbing feature (default on)
let subtitlesEnabled = false; // State for subtitles visibility feature (default off)

// Quản lý trạng thái phát lồng tiếng
let activeTTSAudio = null;
let originalVolume = null;
let lastPlayedSegmentId = null;
let currentPlayingSegment = null;
let isSettingVolumeSelf = false;
let adWasPlaying = false;

// Âm lượng video gốc tối thiểu khi đang lồng tiếng: không để tab hoàn toàn im lặng, vì Chrome
// chặn audio.play() cho các tab nền không phát âm thanh, khiến lồng tiếng bị im bặt khi chuyển tab.
const MIN_DUCK_VOLUME = 0.005;

// Quản lý âm lượng video gốc khi lồng tiếng được bật/tắt
function syncVideoVolume() {
    if (isAdPlaying()) return;
    const video = document.querySelector('video');
    if (!video) return;

    if (dubbingEnabled) {
        if (originalVolume === null) {
            originalVolume = video.volume;
        }
        isSettingVolumeSelf = true;
        video.volume = Math.max(originalVolume * 0.15, MIN_DUCK_VOLUME);
        video.muted = false; // Không để video gốc bị mute hẳn khi đang lồng tiếng
        isSettingVolumeSelf = false;
        console.log(`[XT-Extension] Đã giảm âm lượng video xuống: ${(video.volume * 100).toFixed(0)}% (đang bật lồng tiếng).`);
    } else {
        if (originalVolume !== null) {
            isSettingVolumeSelf = true;
            video.volume = originalVolume;
            isSettingVolumeSelf = false;
            originalVolume = null;
            console.log(`[XT-Extension] Đã khôi phục âm lượng video gốc: ${(video.volume * 100).toFixed(0)}% (đã tắt lồng tiếng).`);
        }
    }
}

// Cập nhật lại trạng thái các khối đã dịch xong
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
            // Không có câu phụ đề nào trong khối này, coi như đã dịch xong
            translatedBlocks[blockIdx] = true;
        } else {
            // Một khối được coi là đã dịch xong khi toàn bộ câu thoại trong đó đều có bản dịch
            const allTranslated = chunk.every(item => item.textTranslated && item.textTranslated.trim() !== "");
            if (allTranslated) {
                translatedBlocks[blockIdx] = true;
            }
        }
    }
}



// KHỞI TẠO NÚT BẤM VÀ KHUNG PHỤ ĐỀ TRÊN VIDEO YOUTUBE
function initializeVideoOverlay() {
    // Inject CSS styles cho overlay và button
    injectStyles();

    const player = document.querySelector('.html5-video-player, #movie_player');
    if (!player) {
        console.warn("[XT-Extension] Không tìm thấy phần tử trình phát video YouTube.");
        return;
    }

    // 1. Chèn nút Dịch AI vào video nếu chưa có
    let transBtn = document.getElementById('yt-translate-video-btn');
    if (!transBtn) {
        transBtn = document.createElement('button');
        transBtn.id = 'yt-translate-video-btn';
        player.appendChild(transBtn);
        transBtn.addEventListener('click', handleVideoTranslateClick);
    }

    // 2. Chèn khung phụ đề (overlay) vào video nếu chưa có
    let subOverlay = document.getElementById('yt-translate-subtitle-overlay');
    if (!subOverlay) {
        subOverlay = document.createElement('div');
        subOverlay.id = 'yt-translate-subtitle-overlay';
        player.appendChild(subOverlay);
    }

    // Reset trạng thái lồng tiếng cũ
    if (activeTTSAudio) {
        activeTTSAudio.pause();
        activeTTSAudio = null;
    }
    originalVolume = null;
    lastPlayedSegmentId = null;
    translatedBlocks = {};
    translatingBlocks = {};
    audioPreloadedBlocks = {};
    preloadingAudioBlocks = {};
    dubbingEnabled = true; // Reset dubbing state on new video (default on)
    syncVideoVolume();
    subtitlesEnabled = false; // Reset subtitles visibility state on new video (default off)
    translationEnabled = false;
    subOverlay.style.display = 'none';

    // 3. Kiểm tra xem video này đã có bản dịch lưu sẵn trong Cache chưa
    const videoId = getActiveVideoId();
    if (videoId) {
        chrome.storage.local.get([`yt_trans_${videoId}`, "gemini_target_lang"], (result) => {
            const cachedData = result[`yt_trans_${videoId}`];
            const targetLang = result.gemini_target_lang || "Tiếng Việt";

            if (cachedData && window.latestTranscriptData && window.latestTranscriptData.length > 0) {
                // Khớp bản dịch từ cache
                let hasTranslations = false;
                window.latestTranscriptData.forEach((item, index) => {
                    if (cachedData[index]) {
                        item.textTranslated = cachedData[index].textTranslated || "";
                        if (item.textTranslated) {
                            hasTranslations = true;
                        }
                    }
                });

                if (hasTranslations) {
                    // Cập nhật lại các khối đã dịch
                    refreshTranslatedBlocks();

                    // Cập nhật giao diện nút đã dịch
                    transBtn.innerHTML = `✨ Đã lồng tiếng (${targetLang})`;
                    transBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';

                    // Kích hoạt hiển thị phụ đề luôn khi có sẵn cache
                    translationEnabled = true;
                    setupVideoTimeUpdateListener();

                    // Cập nhật giao diện nút đã dịch
                    updateVideoButtonState(transBtn, targetLang);
                } else {
                    // Cache rỗng/lỗi từ phiên trước -> cần bấm dịch lại
                    translationEnabled = false;
                    updateVideoButtonState(transBtn, targetLang);
                }
            } else {
                // Chưa có cache, reset nút về trạng thái sẵn sàng dịch
                translationEnabled = false;
                updateVideoButtonState(transBtn, targetLang);
            }
        });
    }
}

// Hàm cập nhật trạng thái nút dịch & lồng tiếng trên video
function updateVideoButtonState(transBtn, targetLang) {
    if (!transBtn) return;
    if (!translationEnabled) {
        transBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="margin-right: 4px;">
              <path d="M4.545 6.714 4.11 8H1.3l1.862-5H5.7l1.837 5H4.89l-.345-1.286H4.545zm.283-1.077c-.08-.344-.194-.863-.264-1.2a12.16 12.16 0 0 0-.256 1.2h.52z"/>
              <path d="M11.5 7.5c.017-.183.05-.333.1-.45H10v-.5h2.2c-.12-.3-.32-.6-.5-.8l-.3.3-.35-.35.4-.4c-.2-.2-.42-.38-.65-.53l-.2.2-.35-.35.3-.3c-.22-.11-.47-.2-.73-.27l-.15.4h-.5l.2-.55c-.27-.05-.55-.08-.85-.08v-.5c.33 0 .66.03.97.08L10 3h.5l.17.48c.3.09.58.2.84.34l.24-.24.35.35-.2.2c.23.18.45.38.65.6l.3-.3.35.35-.4.4c.16.2.3.4.4.6H15v.5h-2.2c-.05.15-.08.35-.1.55h.8v.5H11.5z"/>
            </svg>
            <span>Dịch & Lồng tiếng AI (${targetLang})</span>
        `;
        transBtn.style.background = '';
        transBtn.style.opacity = '0.85';
        transBtn.classList.remove('round-btn');
        transBtn.title = "Dịch & Lồng tiếng AI";
    } else {
        transBtn.dataset.targetLang = targetLang;
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

// CSS Injection cho các nút bấm & phụ đề trực tiếp
function injectStyles() {
    if (document.getElementById('yt-translate-styles')) return;

    const style = document.createElement('style');
    style.id = 'yt-translate-styles';
    style.textContent = `
        #yt-translate-video-btn {
            position: absolute;
            top: 50px;
            right: 20px;
            z-index: 2002;
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
            transition: all 0.2s ease;
        }
        #yt-translate-video-btn:hover {
            opacity: 1;
            transform: scale(1.04);
            box-shadow: 0 4px 15px rgba(124, 58, 237, 0.5);
        }
        #yt-translate-video-btn.translating {
            background: linear-gradient(135deg, #f59e0b, #db2777);
            animation: pulse-btn 1.5s infinite;
            cursor: wait;
        }
        #yt-translate-video-btn.round-btn {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            padding: 0;
            font-size: 12px;
            aspect-ratio: 1 / 1;
        }
        #yt-translate-subtitle-overlay {
            position: absolute;
            bottom: 14%;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2001;
            background-color: rgba(0, 0, 0, 0.72);
            color: #ffffff;
            padding: 8px 18px;
            border-radius: 6px;
            font-family: 'Roboto', 'Inter', sans-serif;
            font-size: 23px;
            font-weight: 500;
            text-align: center;
            max-width: 85%;
            line-height: 1.45;
            pointer-events: none;
            display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.9);
            transition: opacity 0.15s ease;
        }
        @keyframes pulse-btn {
            0% { opacity: 0.7; }
            50% { opacity: 1; }
            100% { opacity: 0.7; }
        }
        
        /* Đảm bảo cỡ chữ phụ đề phù hợp khi xem Fullscreen */
        .html5-video-player.ytp-fullscreen #yt-translate-subtitle-overlay {
            font-size: 32px;
            bottom: 12%;
            padding: 12px 24px;
        }
    `;
    document.head.appendChild(style);
}

// Xử lý sự kiện click dịch & lồng tiếng trên video
async function handleVideoTranslateClick() {
    const video = document.querySelector('video');
    const transBtn = document.getElementById('yt-translate-video-btn');

    // Kiểm tra trạng thái đăng nhập từ storage (Đã tắt tạm ở local để test)
    const auth = true;

    const subOverlay = document.getElementById('yt-translate-subtitle-overlay');

    if (!auth) {
        if (subOverlay) {
            subOverlay.innerText = "⚠️ Vui lòng click vào biểu tượng tiện ích Tube (ở góc trên trình duyệt) để đăng nhập Google trước!";
            subOverlay.style.display = 'block';

            // Tự động ẩn thông báo lỗi sau 6 giây
            setTimeout(() => {
                if (subOverlay.innerText.includes("đăng nhập Google trước")) {
                    subOverlay.style.display = 'none';
                }
            }, 6000);
        }
        return;
    }

    // Nếu đang bật dịch thì click vào sẽ Tắt/Bật lồng tiếng
    if (translationEnabled) {
        dubbingEnabled = !dubbingEnabled;
        if (!dubbingEnabled) {
            // Tắt lồng tiếng
            if (activeTTSAudio) {
                activeTTSAudio.pause();
                activeTTSAudio = null;
            }
            lastPlayedSegmentId = null;
            currentPlayingSegment = null;
        }
        syncVideoVolume();
        chrome.storage.local.get(["gemini_target_lang"], (result) => {
            const targetLang = result.gemini_target_lang || "Tiếng Việt";
            updateVideoButtonState(transBtn, targetLang);
        });
        return;
    }

    if (window.latestTranscriptData.length === 0) return;

    // 1. Tạm dừng video để đợi dịch và lồng tiếng xong cụm đầu tiên (1 phút đầu)
    if (video) video.pause();

    // 2. Chuyển trạng thái nút
    transBtn.classList.add('translating');
    transBtn.innerHTML = `
        <svg class="spinner" viewBox="0 0 50 50" style="animation: spin 1s linear infinite; width: 14px; height: 14px; margin-right: 6px;">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="80, 200" stroke-dashoffset="0"></circle>
        </svg>
        <span>Đang lồng tiếng...</span>
    `;

    // Thêm CSS quay spinner nếu chưa có
    if (!document.getElementById('yt-spinner-style')) {
        const spinStyle = document.createElement('style');
        spinStyle.id = 'yt-spinner-style';
        spinStyle.textContent = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
        document.head.appendChild(spinStyle);
    }

    if (subOverlay && subtitlesEnabled) {
        subOverlay.innerText = "Đang dịch và lồng tiếng, bạn đợi 1 chút ...";
        subOverlay.style.display = 'block';
    }

    // 3. Tải cấu hình API Key & Model
    chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang"], async (result) => {
        const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
        const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
        const targetLang = result.gemini_target_lang || "Tiếng Việt";

        if (!apiKey) {
            transBtn.classList.remove('translating');
            updateVideoButtonState(transBtn, targetLang);
            if (subOverlay) {
                subOverlay.innerText = "⚠️ Chưa cấu hình Gemini API Key! Vui lòng nhấp vào biểu tượng icon Tube ở góc trên trình duyệt để nhập API Key trong phần Cài đặt trước.";
                subOverlay.style.display = 'block';

                // Tự động ẩn thông báo sau 8 giây
                setTimeout(() => {
                    if (subOverlay.innerText.includes("Chưa cấu hình Gemini API Key")) {
                        subOverlay.style.display = 'none';
                    }
                }, 8000);
            }
            return;
        }

        try {
            // Dịch và lồng tiếng khối đầu tiên (Block 0: từ giây 0 đến 60)
            await translateBlock(0, apiKey, model, targetLang);

            // Cập nhật giao diện thành công
            transBtn.classList.remove('translating');
            transBtn.dataset.targetLang = targetLang; // Lưu lại ngôn ngữ để khôi phục khi bật/tắt

            translationEnabled = true;
            dubbingEnabled = true; // Bật lồng tiếng luôn sau khi click dịch trực tiếp trên video
            syncVideoVolume();

            updateVideoButtonState(transBtn, targetLang);

            // 4. Phát tiếp video và kích hoạt bộ lắng nghe cập nhật thời gian
            if (video) {
                video.play().catch(e => console.warn("[XT-Extension] Không thể tự phát video:", e));
            }
            setupVideoTimeUpdateListener();

        } catch (error) {
            console.error("[XT-Extension] Dịch & lồng tiếng khối đầu tiên thất bại:", error);
            transBtn.classList.remove('translating');
            transBtn.innerHTML = '❌ Lỗi lồng tiếng. Nhấp để thử lại';
            if (subOverlay) {
                subOverlay.innerText = error.message || "Có lỗi xảy ra khi gọi Gemini API hoặc sinh Edge TTS. Vui lòng thử lại.";
            }
        }
    });
}

// Hàm giới hạn số lượng Promise chạy song song để tránh bị máy chủ chặn
async function limitConcurrency(tasks, limit) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// HÀM DỊCH VÀ SINH LỒNG TIẾNG CHO MỘT KHỐI PHỤ ĐỀ (BLOCK N)
async function translateBlock(blockIdx, apiKey, model, targetLang) {
    if (translatedBlocks[blockIdx]) return; // Đã dịch rồi
    translatingBlocks[blockIdx] = true;

    // Lọc phụ đề nằm trong tầm thời gian của khối này [blockIdx * 60, (blockIdx + 1) * 60]
    const startTime = blockIdx * BLOCK_DURATION;
    const endTime = (blockIdx + 1) * BLOCK_DURATION;

    const chunk = window.latestTranscriptData.filter(item => item.start >= startTime && item.start < endTime);

    if (chunk.length === 0) {
        // Không có phụ đề nào trong mốc này
        translatedBlocks[blockIdx] = true;
        delete translatingBlocks[blockIdx];
        return;
    }

    console.log(`[XT-Extension] Bắt đầu dịch Block ${blockIdx} (Giây ${startTime} - ${endTime}). Số câu: ${chunk.length}`);

    let retryCount = 0;
    const MAX_RETRIES = 3;
    let success = false;
    let lastError = null;

    while (retryCount < MAX_RETRIES && !success) {
        try {
            // Bước 1: Dịch văn bản với Gemini API
            const translatedResult = await callGeminiAPI(chunk, apiKey, model, targetLang);

            // Khớp bản dịch vào dữ liệu chính
            translatedResult.forEach(translatedItem => {
                const matchedOrig = chunk.find(c => c.id == translatedItem.id);
                if (matchedOrig) {
                    const mainItem = window.latestTranscriptData.find(item => item.id === matchedOrig.id);
                    if (mainItem) {
                        mainItem.textTranslated = translatedItem.text;
                    }
                }
            });

            // Giữ nguyên start/end gốc từ phụ đề YouTube (không phân bổ lại theo độ dài bản dịch)
            // để lồng tiếng bắt đầu đúng lúc phụ đề gốc xuất hiện trên video. playVoiceOverObject()
            // sẽ tự tăng nhẹ tốc độ đọc nếu audio dài hơn khung thời gian câu gốc.

            // Bước 2: Tải giọng nói Edge TTS cho toàn bộ câu thoại trong khối
            const resultStorage = await new Promise(res => chrome.storage.local.get(["gemini_tts_voice", "gemini_tts_rate"], res));
            const ttsVoice = resultStorage.gemini_tts_voice || "vi-VN-NamMinhNeural";
            const ttsRate = resultStorage.gemini_tts_rate || "-10%";

            const ttsTasks = chunk.map(item => async () => {
                const mainItem = window.latestTranscriptData.find(m => m.id === item.id);
                if (mainItem && mainItem.textTranslated && !mainItem.audioObject) {
                    try {
                        const audioUrl = await generateTTS(mainItem.textTranslated, ttsVoice, ttsRate);
                        mainItem.audioUrl = audioUrl; // Gán URL nhị phân phát nhạc
                        mainItem.audioObject = new Audio(audioUrl);
                        mainItem.audioObject.preload = "auto";
                    } catch (ttsErr) {
                        console.warn(`[XT-Extension] Sinh TTS thất bại cho câu "${mainItem.textTranslated}":`, ttsErr);
                    }
                }
            });

            await limitConcurrency(ttsTasks, 3);

            success = true;
            translatedBlocks[blockIdx] = true;
            audioPreloadedBlocks[blockIdx] = true;
            console.log(`[XT-Extension] Dịch & lồng tiếng xong Block ${blockIdx} thành công!`);

            // Lưu kết quả gia tăng vào Cache văn bản
            saveCurrentTranscriptToCache();

        } catch (err) {
            lastError = err;
            console.error(`[XT-Extension] Lỗi Block ${blockIdx}, thử lại lần ${retryCount + 1}/${MAX_RETRIES}:`, err);
            retryCount++;
            if (retryCount < MAX_RETRIES) {
                await new Promise(res => setTimeout(res, 4000)); // Đợi 4s trước khi thử lại
            }
        }
    }

    delete translatingBlocks[blockIdx];
    if (!success) {
        const reason = lastError && lastError.message ? lastError.message : "Không rõ nguyên nhân";
        throw new Error(`Không thể dịch/lồng tiếng Block ${blockIdx} sau ${MAX_RETRIES} lần thử. Lỗi gốc: ${reason}`);
    }
}

// Gửi yêu cầu dịch qua Background Script để tránh lỗi Local Network Access của Chrome trên YouTube
async function callGeminiAPI(chunk, apiKey, model, targetLang) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: "TRANSLATE_TEXT",
            chunk,
            apiKey,
            model,
            targetLang
        }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.status === "error") {
                reject(new Error(response.message));
            } else if (response && response.status === "success") {
                resolve(response.data);
            } else {
                reject(new Error("Unknown response from background script"));
            }
        });
    });
}

// Hàm điều phối sinh giọng nói lồng tiếng chính (Chỉ sử dụng Edge TTS qua Background)
async function generateTTS(text, voice = "vi-VN-NamMinhNeural", rate = "-10%") {
    console.log(`[XT-Extension] Đang gọi Edge TTS từ Background cho câu: "${text}"`);
    const res = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "GENERATE_EDGE_TTS", text, voice, rate }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });

    if (res && res.status === "success" && res.audioBase64) {
        const binaryString = atob(res.audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "audio/mp3" });
        return URL.createObjectURL(blob);
    } else {
        throw new Error(res ? res.message : "Phản hồi rỗng từ Background");
    }
}

// Lưu dữ liệu phụ đề hiện tại vào Chrome Storage Cache
function saveCurrentTranscriptToCache() {
    const videoId = getActiveVideoId();
    if (!videoId || window.latestTranscriptData.length === 0) return;

    const dataToSave = window.latestTranscriptData.map(item => ({
        id: item.id,
        textTranslated: item.textTranslated || ""
    }));

    chrome.storage.local.set({ [`yt_trans_${videoId}`]: dataToSave }, () => {
        console.log(`[XT-Extension] Đã cập nhật bản dịch vào Storage Cache cho video ${videoId}`);
    });
}

// Đăng ký các sự kiện lồng tiếng và kiểm soát video
function setupVideoTimeUpdateListener() {
    const video = document.querySelector('video');
    if (!video) return;

    if (!timeUpdateListenerAdded) {
        video.addEventListener('timeupdate', handleVideoTimeUpdate);
        video.addEventListener('pause', handleVideoPause);
        video.addEventListener('play', handleVideoPlay);
        video.addEventListener('seeking', handleVideoSeeking);
        video.addEventListener('ratechange', handleVideoRateChange);
        video.addEventListener('waiting', handleVideoWaiting);
        video.addEventListener('volumechange', handleVideoVolumeChange);
        timeUpdateListenerAdded = true;
    }
}

// Đồng bộ trạng thái Pause/Play và Seeking (Phát Audio Đồng Bộ Video)
function handleVideoPause() {
    if (isAdPlaying()) return;
    const video = document.querySelector('video');
    if (video && (video.wasPausedByTranslation || video.wasPausedByTTSLoading)) {
        return;
    }
    if (activeTTSAudio && !activeTTSAudio.paused) {
        activeTTSAudio.pause();
        console.log("[XT-Extension] Đồng bộ: Video tạm dừng -> Tạm dừng âm thanh lồng tiếng.");
    }
}

function handleVideoPlay() {
    if (isAdPlaying()) return;
    const video = document.querySelector('video');
    if (video) {
        if (video.wasPausedByTranslation || video.wasPausedByTTSLoading) {
            video.pause();
            return;
        }
    }
    if (activeTTSAudio && activeTTSAudio.paused) {
        activeTTSAudio.play().catch(e => console.warn(e));
        console.log("[XT-Extension] Đồng bộ: Video phát -> Tiếp tục phát âm thanh lồng tiếng.");
    }
}

function handleVideoSeeking() {
    if (isAdPlaying()) return;
    const video = document.querySelector('video');
    if (!video) return;

    video.wasPausedByTranslation = false;
    video.wasPausedByTTSLoading = false;

    // Khi tua video, đồng bộ vị trí phát của audio hoặc tắt nếu tua ra ngoài câu thoại đang phát
    if (activeTTSAudio && currentPlayingSegment) {
        const baseRate = currentPlayingSegment.basePlaybackRate || 1.0;
        const offset = (video.currentTime - currentPlayingSegment.start) * baseRate;

        if (offset >= 0 && offset < activeTTSAudio.duration) {
            activeTTSAudio.currentTime = offset;
            console.log(`[XT-Extension] Đồng bộ Seeking: Tua audio đến ${offset.toFixed(2)}s.`);
            if (!video.paused && activeTTSAudio.paused) {
                activeTTSAudio.play().catch(e => console.warn(e));
            }
        } else {
            console.log("[XT-Extension] Đồng bộ Seeking: Tua ra ngoài phạm vi câu thoại -> Tắt audio.");
            activeTTSAudio.pause();
            activeTTSAudio = null;
            currentPlayingSegment = null;
        }
    } else {
        lastPlayedSegmentId = null;
    }
}

function handleVideoRateChange() {
    if (isAdPlaying()) return;
    const video = document.querySelector('video');
    if (video && activeTTSAudio && currentPlayingSegment) {
        const baseRate = currentPlayingSegment.basePlaybackRate || 1.0;
        activeTTSAudio.playbackRate = baseRate * video.playbackRate;
        console.log(`[XT-Extension] Đồng bộ Speed: Tốc độ phát lồng tiếng đổi thành ${activeTTSAudio.playbackRate.toFixed(2)}x.`);
    }
}

function handleVideoWaiting() {
    if (isAdPlaying()) return;
    if (activeTTSAudio && !activeTTSAudio.paused) {
        activeTTSAudio.pause();
        console.log("[XT-Extension] Đồng bộ Buffering: Video đang tải -> Tạm dừng âm thanh lồng tiếng.");
    }
}

function handleVideoVolumeChange() {
    if (isAdPlaying()) return;
    if (!dubbingEnabled) return;
    if (isSettingVolumeSelf) return;

    const video = document.querySelector('video');
    if (!video) return;

    // Không để user mute hẳn video gốc trong lúc lồng tiếng: tab im lặng hoàn toàn ở khoảng
    // ngắt giữa các câu sẽ khiến Chrome chặn audio.play() mới khi tab bị chuyển xuống nền.
    if (video.muted) {
        isSettingVolumeSelf = true;
        video.muted = false;
        isSettingVolumeSelf = false;
    }

    // Nếu volume hiện tại khác với mức 15% mong muốn
    const targetVolume = Math.max(originalVolume * 0.15, MIN_DUCK_VOLUME);
    if (Math.abs(video.volume - targetVolume) > 0.01) {
        console.log(`[XT-Extension] Phát hiện thay đổi volume ngoài: ${video.volume}. Cập nhật volume gốc.`);
        originalVolume = video.volume;

        isSettingVolumeSelf = true;
        video.volume = Math.max(originalVolume * 0.15, MIN_DUCK_VOLUME);
        isSettingVolumeSelf = false;
    }
}

// Hàm xử lý khi video chạy thay đổi thời gian
function handleVideoTimeUpdate() {
    if (isAdPlaying()) {
        adWasPlaying = true;
        if (activeTTSAudio && !activeTTSAudio.paused) {
            activeTTSAudio.pause();
        }
        return;
    }

    if (adWasPlaying) {
        adWasPlaying = false;
        console.log("[XT-Extension] Quảng cáo đã kết thúc. Đồng bộ lại âm lượng...");
        originalVolume = null;
        syncVideoVolume();
    }

    if (!translationEnabled) return;

    const video = document.querySelector('video');
    if (!video) return;

    const currentSec = video.currentTime;
    const currentBlockIdx = Math.floor(currentSec / BLOCK_DURATION);

    // Nếu khối hiện tại chưa được dịch, tạm dừng video để dịch trước
    if (!translatedBlocks[currentBlockIdx]) {
        if (!video.wasPausedByTranslation) {
            video.pause();
            video.wasPausedByTranslation = true;
            console.log(`[XT-Extension] Tạm dừng video để dịch Khối ${currentBlockIdx}...`);
            const subOverlay = document.getElementById('yt-translate-subtitle-overlay');
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

                    // Dịch xong, tiếp tục phát video
                    if (video && video.wasPausedByTranslation) {
                        video.wasPausedByTranslation = false;
                        video.play().catch(e => console.warn("[XT-Extension] Lỗi tự phát tiếp video:", e));
                    }
                } catch (err) {
                    console.error(`[XT-Extension] Lỗi khi dịch Khối ${currentBlockIdx}:`, err);
                    const subOverlay = document.getElementById('yt-translate-subtitle-overlay');
                    if (subOverlay) {
                        subOverlay.innerText = err.message || "Có lỗi xảy ra khi gọi Gemini API hoặc sinh Edge TTS. Vui lòng thử lại.";
                        setTimeout(() => {
                            if (subOverlay.innerText === (err.message || "Có lỗi xảy ra khi gọi Gemini API hoặc sinh Edge TTS. Vui lòng thử lại.")) {
                                subOverlay.style.display = 'none';
                            }
                        }, 5000);
                    }
                    if (video && video.wasPausedByTranslation) {
                        video.wasPausedByTranslation = false;
                        video.play().catch(e => console.warn(e));
                    }
                }
            });
        }
        return; // Dừng xử lý tiếp cho đến khi khối này được dịch xong
    }

    // Nếu khối hiện tại đã được dịch nhưng chưa được preload audio (ví dụ khi dùng cache)
    if (dubbingEnabled && !audioPreloadedBlocks[currentBlockIdx]) {
        if (!video.wasPausedByTTSLoading) {
            video.pause();
            video.wasPausedByTTSLoading = true;
            const subOverlay = document.getElementById('yt-translate-subtitle-overlay');
            if (subOverlay) {
                subOverlay.innerText = "Đang dịch và lồng tiếng, bạn đợi 1 chút ...";
                subOverlay.style.display = 'block';
            }
        }

        if (!preloadingAudioBlocks[currentBlockIdx]) {
            preloadAudioForBlock(currentBlockIdx);
        }
        return;
    }

    // 1. CẬP NHẬT GIAO DIỆN PHỤ ĐỀ & LỒNG TIẾNG (SUBTITLE & VOICE-OVER RENDERING)
    renderActiveSubtitleAndPlayVoice(currentSec);

    // 3. THUẬT TOÁN DỊCH LAZY GỐI ĐẦU 1 PHÚT (SLIDING WINDOW)
    const targetBlockIdx = Math.floor((currentSec + 59) / BLOCK_DURATION);

    if (targetBlockIdx > 0 && !translatedBlocks[targetBlockIdx] && !translatingBlocks[targetBlockIdx]) {
        // Nạp cấu hình và chạy dịch ngầm cho block tiếp theo
        chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang"], async (result) => {
            const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
            const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
            const targetLang = result.gemini_target_lang || "Tiếng Việt";

            try {
                // Hiển thị trạng thái nhẹ trên nút bấm
                const transBtn = document.getElementById('yt-translate-video-btn');
                if (transBtn && !transBtn.classList.contains('round-btn') && transBtn.innerHTML.includes('Đang xem')) {
                    transBtn.innerHTML = `✨ Đang xem & lồng tiếng cụm ${targetBlockIdx}...`;
                }

                await translateBlock(targetBlockIdx, apiKey, model, targetLang);

                if (transBtn) {
                    if (transBtn.classList.contains('round-btn')) {
                        updateVideoButtonState(transBtn, targetLang);
                    } else {
                        transBtn.innerHTML = `✨ Đang xem & Lồng tiếng (${targetLang})`;
                    }
                }
            } catch (err) {
                console.error(`[XT-Extension] Dịch & lồng tiếng ngầm Block ${targetBlockIdx} bị lỗi:`, err);
            }
        });
    }

    // 4. PRELOAD AUDIO LAZY CHO KHỐI TIẾP THEO (SLIDING WINDOW)
    if (dubbingEnabled && targetBlockIdx > 0 && translatedBlocks[targetBlockIdx] && !audioPreloadedBlocks[targetBlockIdx] && !preloadingAudioBlocks[targetBlockIdx]) {
        preloadAudioForBlock(targetBlockIdx);
    }
}

// Cập nhật text phụ đề lên màn hình video và lồng tiếng tương ứng
function renderActiveSubtitleAndPlayVoice(currentTime) {
    const subOverlay = document.getElementById('yt-translate-subtitle-overlay');
    if (!subOverlay) return;

    let activeSeg = null;
    const data = window.latestTranscriptData || [];

    for (let i = 0; i < data.length; i++) {
        const seg = data[i];
        const nextSeg = data[i + 1];

        // Thời gian kết thúc câu thoại được lấy bằng điểm bắt đầu câu kế tiếp hoặc cộng 3.5 giây
        const end = nextSeg ? nextSeg.start : (seg.start + 3.5);

        if (currentTime >= seg.start && currentTime < end) {
            activeSeg = seg;
            break;
        }
    }

    // Chỉ xử lý khi có bản dịch, tránh hiển thị/phát tiếng gốc chưa được dịch
    if (activeSeg && activeSeg.textTranslated) {
        // 1. Hiển thị hoặc ẩn phụ đề phụ thuộc vào trạng thái subtitlesEnabled
        if (subtitlesEnabled) {
            subOverlay.innerText = activeSeg.textTranslated;
            subOverlay.style.display = 'block';
        } else {
            subOverlay.style.display = 'none';
        }

        // 2. PHÁT GIỌNG ĐỌC AI (DUBBING/VOICE-OVER) & AUDIO DUCKING (chạy độc lập với phụ đề)
        if (dubbingEnabled && lastPlayedSegmentId !== activeSeg.id) {
            lastPlayedSegmentId = activeSeg.id;

            if (activeSeg.audioObject) {
                playVoiceOverObject(activeSeg.audioObject, activeSeg);
            } else if (activeSeg.audioUrl) {
                activeSeg.audioObject = new Audio(activeSeg.audioUrl);
                activeSeg.audioObject.preload = "auto";
                playVoiceOverObject(activeSeg.audioObject, activeSeg);
            } else {
                // Hồi phục (Fallback): Tạo âm thanh trên không (On-the-fly) khi phát cache chưa được preload âm thanh
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

    console.log(`[XT-Extension] Bắt đầu tải trước âm thanh cho Block ${blockIdx}...`);
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
                    console.warn(`[XT-Extension] Tải trước TTS thất bại cho câu "${mainItem.textTranslated}":`, ttsErr);
                }
            }
        });

        await limitConcurrency(ttsTasks, 3);
        audioPreloadedBlocks[blockIdx] = true;
        console.log(`[XT-Extension] Tải trước âm thanh cho Block ${blockIdx} thành công!`);
    } catch (err) {
        console.warn(`[XT-Extension] Tải trước âm thanh cho Block ${blockIdx} thất bại:`, err);
    }

    delete preloadingAudioBlocks[blockIdx];
    resumeVideoAfterPreload();
}

function resumeVideoAfterPreload() {
    const video = document.querySelector('video');
    if (video && video.wasPausedByTTSLoading) {
        video.wasPausedByTTSLoading = false;
        video.play().catch(e => console.warn("[XT-Extension] Không thể tự phát tiếp video:", e));
    }
    const subOverlay = document.getElementById('yt-translate-subtitle-overlay');
    if (subOverlay && subOverlay.innerText.includes("Đang dịch và lồng tiếng")) {
        subOverlay.style.display = 'none';
    }
}


// Sinh âm thanh on-the-fly và phát ngay lập tức (phục vụ tua video hoặc chạy lại từ cache)
async function generateAndPlayTTSOnTheFly(segment) {
    const targetId = segment.id;
    const video = document.querySelector('video');
    const subOverlay = document.getElementById('yt-translate-subtitle-overlay');

    // Lưu trạng thái xem video có đang phát không
    const wasPlaying = video && !video.paused;
    if (video && wasPlaying) {
        video.pause();
        video.wasPausedByTTSLoading = true;
    }

    if (subOverlay) {
        subOverlay.innerText = "Đang dịch và lồng tiếng, bạn đợi 1 chút ...";
        subOverlay.style.display = 'block';
    }

    try {
        const resultStorage = await new Promise(res => chrome.storage.local.get(["gemini_tts_voice", "gemini_tts_rate"], res));
        const ttsVoice = resultStorage.gemini_tts_voice || "vi-VN-NamMinhNeural";
        const ttsRate = resultStorage.gemini_tts_rate || "-10%";

        console.log(`[XT-Extension] Tạo nhanh TTS lồng tiếng cho câu: "${segment.textTranslated}"`);
        const audioUrl = await generateTTS(segment.textTranslated, ttsVoice, ttsRate);
        segment.audioUrl = audioUrl;
        segment.audioObject = new Audio(audioUrl);
        segment.audioObject.preload = "auto";

        if (subOverlay) {
            subOverlay.innerText = segment.textTranslated;
        }

        if (video && video.wasPausedByTTSLoading) {
            video.wasPausedByTTSLoading = false;
            await video.play().catch(e => console.warn("[XT-Extension] Không thể tự phát video:", e));
        }

        // Phát voice over
        playVoiceOverObject(segment.audioObject, segment);
    } catch (err) {
        console.warn("[XT-Extension] Sinh TTS động on-the-fly thất bại:", err);
        if (video && video.wasPausedByTTSLoading) {
            video.wasPausedByTTSLoading = false;
            video.play().catch(e => console.warn(e));
        }
        if (subOverlay) {
            subOverlay.style.display = 'none';
        }
    }
}

// Thực hiện phát tiếng lồng tiếng bằng đối tượng Audio đã nạp sẵn, hỗ trợ tăng tốc độ đọc và đồng bộ thời gian với video
function playVoiceOverObject(audio, segment) {
    const video = document.querySelector('video');

    // 1. Dừng âm thanh cũ đang phát
    if (activeTTSAudio) {
        activeTTSAudio.pause();
        activeTTSAudio.currentTime = 0;
    }
    activeTTSAudio = audio;
    currentPlayingSegment = segment;

    const startPlay = () => {
        let baseRate = 1.0;

        if (video) {
            const nextSeg = window.latestTranscriptData.find(item => item.id === segment.id + 1);
            const segmentEnd = nextSeg ? nextSeg.start : (segment.start + 3.5);
            const segmentDuration = segmentEnd - segment.start;

            // Nếu thời lượng câu thoại thực tế trong video ngắn hơn thời lượng tiếng nói lồng tiếng
            if (segmentDuration > 0 && audio.duration > 0) {
                const ratio = audio.duration / segmentDuration;
                if (ratio > 1.05) {
                    // Tăng tốc độ nói lên tối đa 1.6 lần để khớp với miệng nhân vật và khung thời gian
                    baseRate = Math.min(1.6, ratio);
                    console.log(`[XT-Extension] Tốc độ lồng tiếng cơ bản: ${baseRate.toFixed(2)}x để khớp thời lượng.`);
                }
            }
            segment.basePlaybackRate = baseRate;
            audio.playbackRate = baseRate * video.playbackRate;

            // Đồng bộ vị trí xuất phát của audio
            const diff = video.currentTime - segment.start;
            const offset = diff * baseRate;
            if (diff > 0.8 && offset < audio.duration) {
                audio.currentTime = offset;
                console.log(`[XT-Extension] Phát lồng tiếng ở giữa câu thoại: Set audio.currentTime = ${offset.toFixed(2)}s`);
            } else {
                audio.currentTime = 0;
            }
        } else {
            segment.basePlaybackRate = 1.0;
            audio.playbackRate = 1.0;
            audio.currentTime = 0;
        }

        audio.play().catch(err => {
            console.error(`[XT-Extension] Lỗi phát âm thanh lồng tiếng (document.hidden=${document.hidden}, video.paused=${video ? video.paused : "?"}, video.currentTime=${video ? video.currentTime.toFixed(2) : "?"}):`, err);
        });
    };

    if (audio.readyState >= 1) { // loadedmetadata
        startPlay();
    } else {
        audio.addEventListener('loadedmetadata', startPlay, { once: true });
    }

    audio.onended = () => {
        if (activeTTSAudio === audio) {
            activeTTSAudio = null;
            currentPlayingSegment = null;
        }
    };
}

// Phân tích video ID từ URL hiện tại
function getActiveVideoId() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v');
    } catch (e) {
        return null;
    }
}

// Lắng nghe các tin nhắn từ Popup và Service Worker gửi sang
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "LOG_FROM_BACKEND") {
        console.log(`%c[XT-${message.level}] ${message.message}`, "color: #f59e0b; font-weight: 500; background: #1e1e2e; padding: 2px 6px; border-radius: 3px;");
        return false;
    }
    if (message.action === "REQUEST_TRANSCRIPT_FROM_CONTENT") {
        sendResponse({ status: "success", data: window.latestTranscriptData || [] });
    } else if (message.action === "JUMP_TO_TIME") {
        const video = document.querySelector('video');
        if (video) {
            video.currentTime = message.seconds;
            if (video.paused) {
                video.play().catch(err => console.warn("[XT-Extension] Không thể tự phát video:", err));
            }
            sendResponse({ status: "success" });
        } else {
            sendResponse({ status: "error", message: "Không tìm thấy video." });
        }
    } else if (message.action === "GET_DUBBING_STATE") {
        sendResponse({ status: "success", dubbingEnabled: dubbingEnabled });
    } else if (message.action === "TOGGLE_DUBBING") {
        dubbingEnabled = message.enabled;
        if (!dubbingEnabled) {
            if (activeTTSAudio) {
                activeTTSAudio.pause();
                activeTTSAudio = null;
            }
            lastPlayedSegmentId = null;
        }
        syncVideoVolume();
        sendResponse({ status: "success", dubbingEnabled: dubbingEnabled });
    } else if (message.action === "GET_SUBTITLES_STATE") {
        sendResponse({ status: "success", subtitlesEnabled: subtitlesEnabled });
    } else if (message.action === "TOGGLE_SUBTITLES") {
        subtitlesEnabled = message.enabled;
        if (!subtitlesEnabled) {
            const overlay = document.getElementById('yt-translate-subtitle-overlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
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
                        
                        // Xoá file âm thanh cũ để kích hoạt tạo lại giọng nói mới
                        if (mainItem.audioUrl) {
                            if (mainItem.audioUrl.startsWith("blob:")) {
                                try {
                                    URL.revokeObjectURL(mainItem.audioUrl);
                                } catch (e) {}
                            }
                            mainItem.audioUrl = "";
                        }
                        if (mainItem.audioObject) {
                            try {
                                mainItem.audioObject.pause();
                                mainItem.audioObject.src = "";
                                mainItem.audioObject.load();
                            } catch (e) {}
                            mainItem.audioObject = null;
                        }
                        
                        // Đánh dấu khối này cần preload lại audio
                        const blockIdx = Math.floor(mainItem.start / BLOCK_DURATION);
                        audioPreloadedBlocks[blockIdx] = false;
                    }
                }
            });

            refreshTranslatedBlocks();
            translationEnabled = true;
            setupVideoTimeUpdateListener();

            const video = document.querySelector('video');
            if (video) {
                renderActiveSubtitleAndPlayVoice(video.currentTime);
            }

            const transBtn = document.getElementById('yt-translate-video-btn');
            if (transBtn) {
                chrome.storage.local.get(["gemini_target_lang"], (result) => {
                    const targetLang = result.gemini_target_lang || "Tiếng Việt";
                    updateVideoButtonState(transBtn, targetLang);
                });
            }
        }
        sendResponse({ status: "success" });
    } else if (message.action === "RESET_TRANSLATION") {
        const videoId = getActiveVideoId();
        if (videoId) {
            chrome.storage.local.remove(`yt_trans_${videoId}`, () => {
                console.log(`[XT-Extension] Đã xoá cache storage cho video ${videoId}`);
            });
        }

        if (activeTTSAudio) {
            activeTTSAudio.pause();
            activeTTSAudio = null;
        }
        const video = document.querySelector('video');
        if (video) {
            video.wasPausedByTranslation = false;
        }
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
            window.latestTranscriptData.forEach(item => {
                item.textTranslated = "";
                item.audioUrl = "";
            });
        }

        const overlay = document.getElementById('yt-translate-subtitle-overlay');
        if (overlay) {
            overlay.innerText = "";
            overlay.style.display = 'none';
        }

        const btn = document.getElementById('yt-translate-video-btn');
        if (btn) {
            updateVideoButtonState(btn, "Tiếng Việt");
            btn.classList.remove('translating');
        }
        sendResponse({ status: "success" });
    }
    return true;
});

let lastProcessedVideoId = null;

// Hàm dọn dẹp trạng thái tiện ích
function cleanupExtensionState() {
    if (activeTTSAudio) {
        activeTTSAudio.pause();
        activeTTSAudio = null;
    }
    const video = document.querySelector('video');
    if (video) {
        video.wasPausedByTranslation = false;
        if (timeUpdateListenerAdded) {
            video.removeEventListener('timeupdate', handleVideoTimeUpdate);
            video.removeEventListener('pause', handleVideoPause);
            video.removeEventListener('play', handleVideoPlay);
            video.removeEventListener('seeking', handleVideoSeeking);
            video.removeEventListener('ratechange', handleVideoRateChange);
            video.removeEventListener('waiting', handleVideoWaiting);
            video.removeEventListener('volumechange', handleVideoVolumeChange);
            timeUpdateListenerAdded = false;
        }
    }
    lastPlayedSegmentId = null;
    currentPlayingSegment = null;
    dubbingEnabled = false;
    syncVideoVolume();

    const oldOverlay = document.getElementById('yt-translate-subtitle-overlay');
    if (oldOverlay) oldOverlay.remove();

    const oldBtn = document.getElementById('yt-translate-video-btn');
    if (oldBtn) oldBtn.remove();

    translatedBlocks = {};
    translatingBlocks = {};
    audioPreloadedBlocks = {};
    preloadingAudioBlocks = {};
    translationEnabled = false;
    window.latestTranscriptData = [];
    adWasPlaying = false;
}

// Điều khiển kích hoạt cào phụ đề khi tải trang xong
function triggerExtension() {
    cleanupExtensionState();
    autoEnableCC();

    // Lấy cache từ MAIN world nếu transcript đã được intercept trước khi content.js load
    const activeVideoId = getActiveVideoId();
    if (activeVideoId) {
        console.log('[content.js] Requesting cached transcript for video:', activeVideoId);
        window.postMessage({ action: 'REQUEST_INTERCEPTED_CACHE', videoId: activeVideoId }, "*");
    }
}

// Hàm kiểm tra và kích hoạt tiện ích khi trình phát video đã thực sự tải xong video mới
function checkAndTrigger() {
    const activeVideoId = getActiveVideoId();
    if (!activeVideoId) {
        if (lastProcessedVideoId !== null) {
            console.log("[XT-Extension] Rời khỏi trang watch, tiến hành reset trạng thái...");
            lastProcessedVideoId = null;
            cleanupExtensionState();
        }
        return;
    }

    if (activeVideoId !== lastProcessedVideoId) {
        const video = document.querySelector('video');
        const ccBtn = document.querySelector('.ytp-subtitles-button');
        
        // Kiểm tra xem trình phát đã cập nhật sang video mới chưa bằng cách đọc attribute được đồng bộ từ inject.js (MAIN world)
        const playerVideoId = document.body.getAttribute('data-yt-active-video-id');
        const isPlayerReady = playerVideoId === activeVideoId;
        
        if (isPlayerReady && video && ccBtn) {
            console.log(`[XT-Extension] Trình phát đã sẵn sàng cho video mới: ${activeVideoId}. Bắt đầu khởi tạo...`);
            lastProcessedVideoId = activeVideoId;
            triggerExtension();
        }
    }
}

// Lắng nghe sự kiện tải trang
if (document.readyState === 'complete') {
    checkAndTrigger();
} else {
    window.addEventListener('load', checkAndTrigger);
}

// YouTube là SPA, bắt sự kiện điều hướng trang để kích hoạt
document.addEventListener('yt-navigate-finish', checkAndTrigger);

// Vòng lặp kiểm tra tự vá lỗi (mỗi 500ms) để đối phó với cơ chế lazy load và SPA của YouTube
setInterval(checkAndTrigger, 500);

// Đảm bảo nút được chèn lại nếu YouTube render lại video mà không kích hoạt sự kiện tải trang
setInterval(() => {
    if (window.location.href.includes('/watch?v=') && window.latestTranscriptData.length > 0) {
        const transBtn = document.getElementById('yt-translate-video-btn');
        const player = document.querySelector('.html5-video-player, #movie_player');
        if (player && !transBtn) {
            console.log("[XT-Extension] Phát hiện trình phát mất nút Dịch AI, tiến hành chèn lại...");
            initializeVideoOverlay();
        }
    }
}, 2000);