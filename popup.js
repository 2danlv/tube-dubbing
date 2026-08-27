// Cấu hình Firebase - Hãy điền thông tin dự án Firebase của bạn vào đây
const FIREBASE_API_KEY = "AIzaSyDG97T6_74DlRzG33JIp31qgOFUto_pl-A";
const FIREBASE_PROJECT_ID = "tube-dubbing-auth";
// Client ID Web Application mới cho Google OAuth (để hỗ trợ đăng nhập trên Brave/Edge...)
const GOOGLE_CLIENT_ID_WEB = "490117631093-4dse7lauo1fdhb8nmtdtmsof51smb6iv.apps.googleusercontent.com"; 

const BACKEND_URL = "https://api-tko3zgrl6a-as.a.run.app"; // Thay thế bằng URL Backend Production của bạn khi deploy

// Phím lưu trữ & cấu hình mặc định cho Gemini
const DEFAULT_API_KEY = "";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// Bản đồ ánh xạ ngôn ngữ đích sang danh sách giọng đọc Edge TTS
const VOICE_MAP = {
    "Tiếng Việt": [
        { value: "vi-VN-HoaiMyNeural", text: "Nữ - Hoài My (vi-VN)" },
        { value: "vi-VN-NamMinhNeural", text: "Nam - Nam Minh (vi-VN)" }
    ],
    "Tiếng Anh": [
        { value: "en-US-JennyNeural", text: "Nữ - Jenny (en-US)" },
        { value: "en-US-GuyNeural", text: "Nam - Guy (en-US)" }
    ],
    "Tiếng Nhật": [
        { value: "ja-JP-NanamiNeural", text: "Nữ - Nanami (ja-JP)" },
        { value: "ja-JP-KeitaNeural", text: "Nam - Keita (ja-JP)" }
    ],
    "Tiếng Trung": [
        { value: "zh-CN-XiaoxiaoNeural", text: "Nữ - Xiaoxiao (zh-CN)" },
        { value: "zh-CN-YunxiNeural", text: "Nam - Yunxi (zh-CN)" }
    ],
    "Tiếng Hàn": [
        { value: "ko-KR-SunHiNeural", text: "Nữ - SunHi (ko-KR)" },
        { value: "ko-KR-InJoonNeural", text: "Nam - InJoon (ko-KR)" }
    ],
    "Tiếng Pháp": [
        { value: "fr-FR-DeniseNeural", text: "Nữ - Denise (fr-FR)" },
        { value: "fr-FR-HenriNeural", text: "Nam - Henri (fr-FR)" }
    ],
    "Tiếng Đức": [
        { value: "de-DE-KatjaNeural", text: "Nữ - Katja (de-DE)" },
        { value: "de-DE-ConradNeural", text: "Nam - Conrad (de-DE)" }
    ],
    "Tiếng Tây Ban Nha": [
        { value: "es-ES-ElviraNeural", text: "Nữ - Elvira (es-ES)" },
        { value: "es-ES-AlvaroNeural", text: "Nam - Alvaro (es-ES)" }
    ],
    "Tiếng Nga": [
        { value: "ru-RU-SvetlanaNeural", text: "Nữ - Svetlana (ru-RU)" },
        { value: "ru-RU-DmitryNeural", text: "Nam - Dmitry (ru-RU)" }
    ],
    "Tiếng Ý": [
        { value: "it-IT-ElsaNeural", text: "Nữ - Elsa (it-IT)" },
        { value: "it-IT-DiegoNeural", text: "Nam - Diego (it-IT)" }
    ],
    "Tiếng Séc": [
        { value: "cs-CZ-VlastaNeural", text: "Nữ - Vlasta (cs-CZ)" },
        { value: "cs-CZ-AntoninNeural", text: "Nam - Antonin (cs-CZ)" }
    ],
    "Tiếng Bồ Đào Nha (Brazil)": [
        { value: "pt-BR-FranciscaNeural", text: "Nữ - Francisca (pt-BR)" },
        { value: "pt-BR-AntonioNeural", text: "Nam - Antonio (pt-BR)" }
    ],
    "Tiếng Ba Lan": [
        { value: "pl-PL-AgnieszkaNeural", text: "Nữ - Agnieszka (pl-PL)" },
        { value: "pl-PL-MarekNeural", text: "Nam - Marek (pl-PL)" }
    ]
};

// Hàm cập nhật danh sách giọng đọc theo ngôn ngữ được chọn
function updateVoiceDropdown(selectedLang, currentVoiceValue) {
    const voiceSelect = document.getElementById("api-tts-voice");
    if (!voiceSelect) return;
    
    voiceSelect.innerHTML = "";
    const voices = VOICE_MAP[selectedLang] || VOICE_MAP["Tiếng Việt"];
    
    voices.forEach(voice => {
        const option = document.createElement("option");
        option.value = voice.value;
        option.text = voice.text;
        if (voice.value === currentVoiceValue) {
            option.selected = true;
        }
        voiceSelect.appendChild(option);
    });
}

let currentTranscript = []; // Lưu trữ mảng transcript hiện tại: [{ start, time, text, textTranslated }]
let activeTabId = null;
let activeVideoId = null;
let activeVideoTitle = "youtube-transcript";

// Khi mở Popup
document.addEventListener("DOMContentLoaded", async () => {
    // Khởi tạo giao diện xác thực
    initAuthUI();

    // Kiểm tra trạng thái đăng nhập
    const isAuthenticated = await checkAuthStatus();
    if (!isAuthenticated) {
        showLoginOverlay();
    } else {
        await initApplication();
    }
});

// Khởi chạy ứng dụng sau khi đã xác thực
async function initApplication() {
    hideLoginOverlay();

    // 1. Tải cấu hình cài đặt từ Storage
    await loadSettings();

    // 2. Tìm tab active
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    activeTabId = tab.id;

    const isUdemy = tab.url && tab.url.includes("udemy.com");
    const isDouyin = tab.url && tab.url.includes("douyin.com");
    if (isUdemy) {
        activeVideoTitle = tab.title ? tab.title.replace(" | Udemy", "").replace(/[\\/:*?"<>|]/g, "_") : "udemy-transcript";
        const lectureMatch = tab.url.match(/lecture\/(\d+)/);
        const courseMatch = tab.url.match(/course\/([^\/\?]+)/);
        
        if (lectureMatch) {
            activeVideoId = "udemy_" + lectureMatch[1];
        } else if (courseMatch) {
            activeVideoId = "udemy_course_" + courseMatch[1];
        } else {
            activeVideoId = "udemy_lecture";
        }
    } else if (isDouyin) {
        activeVideoTitle = tab.title ? tab.title.replace(/[\\/:*?"<>|]/g, "_") : "douyin-transcript";
        const videoMatch = tab.url.match(/video\/(\d+)/);
        if (videoMatch) {
            activeVideoId = "douyin_" + videoMatch[1];
        } else {
            activeVideoId = "douyin_video";
        }
    } else {
        activeVideoTitle = tab.title ? tab.title.replace(" - YouTube", "").replace(/[\\/:*?"<>|]/g, "_") : "youtube-transcript";
        if (tab.url) {
            try {
                const urlObj = new URL(tab.url);
                activeVideoId = urlObj.searchParams.get("v");
            } catch (e) {
                console.error("Không thể phân tích URL:", e);
            }
        }
    }

    // 3. Khởi tạo các sự kiện giao diện
    initUIEvents();

    // Cập nhật giao diện cảnh báo Udemy PRO nếu đang ở tab Udemy
    chrome.storage.local.get(["user_status"], (result) => {
        updateUdemyProUI(result.user_status);
    });

    // 4. Gửi yêu cầu lấy phụ đề đã cào từ content.js / udemy_content.js
    fetchTranscriptFromContent();
}

function updateUdemyProUI(userStatus) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab) return;
        const isUdemy = tab.url && tab.url.includes("udemy.com");
        const warningBanner = document.getElementById("udemy-pro-warning");
        const translateBtn = document.getElementById("btn-translate-action");
        
        if (isUdemy) {
            const status = (userStatus || "free").toLowerCase();
            if (status !== "pro") {
                if (warningBanner) warningBanner.style.display = "block";
                if (translateBtn) translateBtn.disabled = true;
            } else {
                if (warningBanner) warningBanner.style.display = "none";
                if (translateBtn) translateBtn.disabled = false;
            }
        } else {
            if (warningBanner) warningBanner.style.display = "none";
            if (translateBtn) translateBtn.disabled = false;
        }
    });
}

// Tải cấu hình cài đặt
async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang", "gemini_tts_voice", "user_status"], (result) => {
            const apiKey = result.gemini_api_key || "";
            document.getElementById("api-key").value = apiKey;
            document.getElementById("api-model").value = result.gemini_model || DEFAULT_MODEL;
            
            const targetLang = result.gemini_target_lang || "Tiếng Việt";
            const ttsVoice = result.gemini_tts_voice || "vi-VN-HoaiMyNeural";
            
            document.getElementById("api-target-lang").value = targetLang;
            
            // Cập nhật động danh sách giọng lồng tiếng theo cấu hình đã lưu
            updateVoiceDropdown(targetLang, ttsVoice);
            
            // Cập nhật cảnh báo API Key
            updateApiKeyWarning(apiKey, result.user_status);
            
            resolve();
        });
    });
}

// Khởi tạo các sự kiện click, gõ phím
function initUIEvents() {
    // Cập nhật động danh sách giọng lồng tiếng khi thay đổi ngôn ngữ đích
    const targetLangSelect = document.getElementById("api-target-lang");
    if (targetLangSelect) {
        targetLangSelect.addEventListener("change", (e) => {
            const selectedLang = e.target.value;
            const defaultVoice = VOICE_MAP[selectedLang]?.[0]?.value || "vi-VN-HoaiMyNeural";
            updateVoiceDropdown(selectedLang, defaultVoice);
        });
    }

    // Nút ẩn/hiện Cài đặt
    const toggleSettingsBtn = document.getElementById("toggle-settings-btn");
    const settingsPanel = document.getElementById("settings-panel");
    const cancelSettingsBtn = document.getElementById("btn-cancel-settings");
    const saveSettingsBtn = document.getElementById("btn-save-settings");

    toggleSettingsBtn.addEventListener("click", () => {
        settingsPanel.classList.toggle("active");
    });

    cancelSettingsBtn.addEventListener("click", () => {
        settingsPanel.classList.remove("active");
    });

    saveSettingsBtn.addEventListener("click", () => {
        const keyVal = document.getElementById("api-key").value.trim();
        const modelVal = document.getElementById("api-model").value.trim() || DEFAULT_MODEL;
        const langVal = document.getElementById("api-target-lang").value;
        const voiceVal = document.getElementById("api-tts-voice").value;

        chrome.storage.local.get(["user_status"], (result) => {
            const userStatus = (result.user_status || "free").toLowerCase();
            if (userStatus !== "pro" && !keyVal) {
                showToast("Tài khoản Free bắt buộc nhập API Key!", "❌");
                return;
            }

            chrome.storage.local.set({
                gemini_api_key: keyVal,
                gemini_model: modelVal,
                gemini_target_lang: langVal,
                gemini_tts_voice: voiceVal
            }, () => {
                showToast("Đã lưu cấu hình!", "✓");
                settingsPanel.classList.remove("active");

                // Gửi thông điệp reset trạng thái dịch trên content script để người dùng dịch lại theo cấu hình mới
                if (activeTabId) {
                    chrome.tabs.sendMessage(activeTabId, { action: "RESET_TRANSLATION" }, () => {
                        // Tải lại dữ liệu
                        fetchTranscriptFromContent();
                    });
                }
            });
        });
    });

    const apiKeyInput = document.getElementById("api-key");
    if (apiKeyInput) {
        apiKeyInput.addEventListener("input", (e) => {
            chrome.storage.local.get(["user_status"], (result) => {
                updateApiKeyWarning(e.target.value.trim(), result.user_status);
            });
        });
    }

    // Nút Dịch phụ đề
    const translateBtn = document.getElementById("btn-translate-action");
    translateBtn.addEventListener("click", startTranslationWorkflow);

    // Bộ chọn chế độ hiển thị (Song ngữ, Tiếng Việt, Bản gốc)
    const tabButtons = document.querySelectorAll(".tab-btn");
    const box = document.getElementById("transcript-box");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const viewMode = btn.getAttribute("data-view");
            box.className = ""; // Reset

            if (viewMode === "bilingual") {
                box.classList.add("view-bilingual");
            } else if (viewMode === "trans") {
                box.classList.add("view-trans");
            } else {
                box.classList.add("view-orig");
            }
        });
    });

    // Thanh tìm kiếm
    const searchInput = document.getElementById("search-input");
    const searchClear = document.getElementById("search-clear");

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            searchClear.style.display = "flex";
        } else {
            searchClear.style.display = "none";
        }
        filterTranscript(query);
    });

    searchClear.addEventListener("click", () => {
        searchInput.value = "";
        searchClear.style.display = "none";
        filterTranscript("");
        searchInput.focus();
    });

    // Nút Sao chép toàn bộ
    const copyBtn = document.getElementById("btn-copy-all");
    copyBtn.addEventListener("click", copyAllToClipboard);

    // Nút Tải xuống phụ đề SRT
    const downloadBtn = document.getElementById("btn-download-srt");
    downloadBtn.addEventListener("click", downloadSrtFile);

    // Nút Tắt/Bật hiển thị phụ đề
    const toggleSubtitlesBtn = document.getElementById("btn-toggle-subtitles");
    const iconSubtitlesOn = document.getElementById("icon-subtitles-on");
    const iconSubtitlesOff = document.getElementById("icon-subtitles-off");

    const updateSubtitlesUI = (enabled = false) => {
        if (!toggleSubtitlesBtn || !iconSubtitlesOn || !iconSubtitlesOff) return;
        if (enabled) {
            iconSubtitlesOn.style.display = "block";
            iconSubtitlesOff.style.display = "none";
            toggleSubtitlesBtn.title = "Tắt hiển thị phụ đề";
            toggleSubtitlesBtn.style.color = "var(--time-color)";
        } else {
            iconSubtitlesOn.style.display = "none";
            iconSubtitlesOff.style.display = "block";
            toggleSubtitlesBtn.title = "Bật hiển thị phụ đề";
            toggleSubtitlesBtn.style.color = "var(--text-muted)";
        }
    };

    // Lấy trạng thái ban đầu của phụ đề
    if (activeTabId && toggleSubtitlesBtn) {
        chrome.tabs.sendMessage(activeTabId, { action: "GET_SUBTITLES_STATE" }, (res) => {
            if (chrome.runtime.lastError) {
                console.warn("Lỗi kết nối content script:", chrome.runtime.lastError.message);
                return;
            }
            if (res && res.status === "success") {
                updateSubtitlesUI(res.subtitlesEnabled);
                toggleSubtitlesBtn.setAttribute("data-enabled", res.subtitlesEnabled ? "true" : "false");
            }
        });
    }

    if (toggleSubtitlesBtn) {
        toggleSubtitlesBtn.addEventListener("click", () => {
            const isCurrentlyEnabled = toggleSubtitlesBtn.getAttribute("data-enabled") !== "false";
            const newState = !isCurrentlyEnabled;

            if (activeTabId) {
                chrome.tabs.sendMessage(activeTabId, { action: "TOGGLE_SUBTITLES", enabled: newState }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.error("Lỗi gửi tin nhắn:", chrome.runtime.lastError.message);
                        showToast("Không thể gửi yêu cầu hiển thị phụ đề!", "❌");
                        return;
                    }
                    if (res && res.status === "success") {
                        updateSubtitlesUI(res.subtitlesEnabled);
                        toggleSubtitlesBtn.setAttribute("data-enabled", res.subtitlesEnabled ? "true" : "false");
                        showToast(res.subtitlesEnabled ? "Đã bật hiển thị phụ đề" : "Đã tắt hiển thị phụ đề", res.subtitlesEnabled ? "👁️" : "🙈");
                    }
                });
            }
        });
    }
}

// Gửi tin nhắn yêu cầu dữ liệu phụ đề gốc từ content.js
function fetchTranscriptFromContent() {
    const box = document.getElementById("transcript-box");

    if (!activeTabId) return;

    chrome.tabs.sendMessage(activeTabId, { action: "REQUEST_TRANSCRIPT_FROM_CONTENT" }, async (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Lỗi nhận transcript từ content script:", chrome.runtime.lastError.message);
            box.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">⚠️</span>
                    <span class="empty-text">Chưa nhận được dữ liệu thoại. Xin vui lòng chờ video tải xong hoặc tải lại trang (F5) YouTube nhé!</span>
                </div>
            `;
            return;
        }
        if (response && response.status === "success" && response.data && response.data.length > 0) {
            currentTranscript = response.data.map((item, idx) => ({
                id: idx,
                start: item.start,
                end: item.end || (item.start + 3),
                dur: item.dur || 3,
                time: item.time,
                text: item.text,
                textTranslated: item.textTranslated || "" // Giữ lại nội dung đã dịch từ content.js nếu có
            }));

            // Kiểm tra xem video này đã được dịch và lưu trữ trước đó chưa
            if (activeVideoId) {
                chrome.storage.local.get([`yt_trans_${activeVideoId}`], (result) => {
                    const cachedData = result[`yt_trans_${activeVideoId}`];
                    if (cachedData && cachedData.length === currentTranscript.length) {
                        // Khớp lại bản dịch từ bộ nhớ cache
                        currentTranscript.forEach((item, index) => {
                            item.textTranslated = cachedData[index].textTranslated || "";
                        });
                        console.log("Đã tải bản dịch đã lưu từ cache!");

                        // Chuyển tab sang chế độ Song ngữ mặc định khi có bản dịch
                        const tabBilingual = document.querySelector('[data-view="bilingual"]');
                        if (tabBilingual) tabBilingual.click();
                    }
                    renderTranscript();
                });
            } else {
                renderTranscript();
            }
        } else {
            box.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">⚠️</span>
                    <span class="empty-text">Chưa nhận được dữ liệu thoại. Xin vui lòng chờ video tải xong hoặc tải lại trang (F5) YouTube nhé!</span>
                </div>
            `;
        }
    });
}

// Vẽ giao diện transcript lên màn hình
function renderTranscript() {
    const box = document.getElementById("transcript-box");
    if (currentTranscript.length === 0) return;

    box.innerHTML = currentTranscript.map(item => {
        // Nếu có bản dịch thì hiện bản dịch, ngược lại hiện thông báo click dịch
        const translatedContent = item.textTranslated
            ? `<span class="text-trans" id="text-trans-${item.id}" data-id="${item.id}">${item.textTranslated}</span>`
            : `<span class="text-trans" id="text-trans-${item.id}" data-id="${item.id}" style="color: var(--text-dark); font-style: italic;">(Chưa dịch. Nhấn để tự dịch)</span>`;

        return `
            <div class="line" id="line-${item.id}">
                <button class="time-btn" data-seconds="${item.start}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
                    </svg>
                    <span>${item.time}</span>
                </button>
                <div class="text-container">
                    <span class="text-orig">${item.text}</span>
                    <div class="translation-wrapper">
                        ${translatedContent}
                        <button class="edit-btn" id="edit-btn-${item.id}" data-id="${item.id}" title="Sửa bản dịch">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    // Gắn sự kiện click vào các nút mốc thời gian để tua video
    const timeButtons = box.querySelectorAll(".time-btn");
    timeButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const seconds = parseFloat(btn.getAttribute("data-seconds"));
            jumpToVideoTime(seconds);
        });
    });

    // Gắn sự kiện chỉnh sửa bản dịch
    const transElements = box.querySelectorAll(".text-trans");
    transElements.forEach(transEl => {
        const id = parseInt(transEl.getAttribute("data-id"));
        const editBtn = box.querySelector(`#edit-btn-${id}`);

        // Lưu giữ giá trị ban đầu để khôi phục nếu huỷ
        let originalText = transEl.innerText;

        const startEdit = () => {
            if (transEl.classList.contains("editing")) return;

            // Đóng tất cả các ô đang sửa khác trước
            const activeEditing = box.querySelectorAll(".text-trans.editing");
            activeEditing.forEach(el => {
                el.blur();
            });

            transEl.classList.add("editing");
            transEl.contentEditable = "true";
            editBtn.classList.add("editing-active");
            
            // Thay icon thành checkmark
            editBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M12.736 3.97a.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733 0 0 1-1.065.02L3.217 8.384a.757 0 0 1 0-1.06.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247 0 0 1 .02-.022z"/>
                </svg>
            `;
            editBtn.title = "Lưu bản dịch";

            originalText = currentTranscript[id].textTranslated || "";
            if (transEl.innerText.includes("Chưa dịch")) {
                transEl.innerText = "";
                transEl.style.color = "";
                transEl.style.fontStyle = "";
            }

            transEl.focus();
            
            // Di chuyển cursor xuống cuối hoặc select all
            const range = document.createRange();
            range.selectNodeContents(transEl);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        };

        const saveEdit = () => {
            if (!transEl.classList.contains("editing")) return;

            const newText = transEl.innerText.trim();
            transEl.classList.remove("editing");
            transEl.contentEditable = "false";
            editBtn.classList.remove("editing-active");

            // Khôi phục icon bút chì
            editBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                </svg>
            `;
            editBtn.title = "Sửa bản dịch";

            // Nếu nội dung thay đổi thực sự
            if (newText !== originalText) {
                currentTranscript[id].textTranslated = newText;
                
                // Lưu cache
                if (activeVideoId) {
                    const dataToSave = currentTranscript.map(item => ({
                        id: item.id,
                        textTranslated: item.textTranslated
                    }));
                    const saveKey = `yt_trans_${activeVideoId}`;
                    chrome.storage.local.set({ [saveKey]: dataToSave }, () => {
                        console.log(`Đã cập nhật bản dịch đã sửa của video ${activeVideoId} vào Storage!`);
                    });
                }

                // Gửi tin nhắn đồng bộ sang content script
                if (activeTabId) {
                    chrome.tabs.sendMessage(activeTabId, {
                        action: "UPDATE_TRANSLATIONS",
                        data: currentTranscript.map(item => ({
                            id: item.id,
                            textTranslated: item.textTranslated
                        }))
                    }, (res) => {
                        if (chrome.runtime.lastError) {
                            console.warn("Lỗi đồng bộ bản dịch sửa sang content script:", chrome.runtime.lastError.message);
                        }
                    });
                }
            }

            // Re-render để hiển thị đúng trạng thái nếu rỗng
            if (!newText) {
                transEl.innerHTML = `(Chưa dịch. Nhấn để tự dịch)`;
                transEl.style.color = "var(--text-dark)";
                transEl.style.fontStyle = "italic";
            } else {
                transEl.style.color = "";
                transEl.style.fontStyle = "";
            }
        };

        const cancelEdit = () => {
            if (!transEl.classList.contains("editing")) return;

            transEl.classList.remove("editing");
            transEl.contentEditable = "false";
            editBtn.classList.remove("editing-active");

            // Khôi phục icon bút chì
            editBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                </svg>
            `;
            editBtn.title = "Sửa bản dịch";

            // Trả lại text cũ
            if (!originalText || originalText.includes("Chưa dịch")) {
                transEl.innerHTML = `(Chưa dịch. Nhấn để tự dịch)`;
                transEl.style.color = "var(--text-dark)";
                transEl.style.fontStyle = "italic";
            } else {
                transEl.innerText = originalText;
                transEl.style.color = "";
                transEl.style.fontStyle = "";
            }
        };

        // Click vào text dịch hoặc click vào nút edit
        transEl.addEventListener("click", (e) => {
            e.stopPropagation(); // Ngăn tua video khi click vào text dịch
            startEdit();
        });

        editBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Ngăn tua video
            if (transEl.classList.contains("editing")) {
                saveEdit();
            } else {
                startEdit();
            }
        });

        // Xử lý sự kiện bàn phím
        transEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveEdit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
            }
        });

        // Tự động lưu khi click ra ngoài
        transEl.addEventListener("blur", () => {
            // Đợi một chút đề phòng trường hợp click trực tiếp vào nút Checkmark
            setTimeout(() => {
                if (document.activeElement !== editBtn) {
                    saveEdit();
                }
            }, 100);
        });
    });


    // Cập nhật lại thanh tìm kiếm nếu đang có chữ
    const query = document.getElementById("search-input").value.toLowerCase().trim();
    if (query) {
        filterTranscript(query);
    }
}

// Điều khiển tua video
function jumpToVideoTime(seconds) {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: "JUMP_TO_TIME", seconds: seconds }, (res) => {
        if (chrome.runtime.lastError) {
            console.error("Lỗi tua video:", chrome.runtime.lastError);
        } else if (res && res.status === "success") {
            showToast(`Tua tới ${formatTimeLabel(seconds)}`, "⏱️");
        }
    });
}

// Lọc tìm kiếm phụ đề
function filterTranscript(query) {
    const lines = document.querySelectorAll("#transcript-box .line");
    let matchCount = 0;

    lines.forEach(line => {
        const origText = line.querySelector(".text-orig").textContent.toLowerCase();
        const transEl = line.querySelector(".text-trans");
        const transText = transEl ? transEl.textContent.toLowerCase() : "";

        if (origText.includes(query) || transText.includes(query)) {
            line.style.display = "flex";
            matchCount++;
        } else {
            line.style.display = "none";
        }
    });

    // Xử lý thông báo không tìm thấy kết quả
    const box = document.getElementById("transcript-box");
    let emptySearchMsg = document.getElementById("empty-search-message");

    if (matchCount === 0 && query !== "") {
        if (!emptySearchMsg) {
            emptySearchMsg = document.createElement("div");
            emptySearchMsg.id = "empty-search-message";
            emptySearchMsg.className = "empty-state";
            emptySearchMsg.innerHTML = `
                <span class="empty-icon">🔍</span>
                <span class="empty-text">Không tìm thấy phụ đề phù hợp với "${query}"</span>
            `;
            box.appendChild(emptySearchMsg);
        }
    } else {
        if (emptySearchMsg) {
            emptySearchMsg.remove();
        }
    }
}

// BẮT ĐẦU LUỒNG DỊCH AI
async function startTranslationWorkflow() {
    if (currentTranscript.length === 0) return;

    // Tải cấu hình API Key & Model mới nhất từ storage
    chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang", "firebase_id_token", "user_status"], async (result) => {
        const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
        const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
        const targetLang = result.gemini_target_lang || "Tiếng Việt";
        const idToken = result.firebase_id_token;
        const userStatus = (result.user_status || "free").toLowerCase();

        if (userStatus !== "pro" && !apiKey) {
            showToast("Tài khoản Free bắt buộc phải cấu hình API Key!", "❌");
            document.getElementById("settings-panel").classList.add("active");
            return;
        }

        if (!apiKey && !idToken) {
            showToast("Vui lòng Đăng nhập hoặc cấu hình API Key!", "❌");
            document.getElementById("settings-panel").classList.add("active");
            return;
        }

        const translateBtn = document.getElementById("btn-translate-action");
        const progressContainer = document.getElementById("progress-container");
        const progressBarFill = document.getElementById("progress-bar-fill");
        const progressLabel = document.getElementById("progress-label");
        const progressStatus = document.getElementById("progress-status");

        // Disable nút dịch trong lúc dịch
        translateBtn.disabled = true;
        progressContainer.classList.add("active");

        // Chia nhóm phụ đề (Ví dụ: 60 dòng mỗi nhóm) để tối ưu ngữ cảnh dịch và số lượng token
        const CHUNK_SIZE = 60;
        const totalLines = currentTranscript.length;
        const chunks = [];

        for (let i = 0; i < totalLines; i += CHUNK_SIZE) {
            chunks.push(currentTranscript.slice(i, i + CHUNK_SIZE));
        }

        const totalChunks = chunks.length;
        let successCount = 0;

        progressBarFill.style.width = "0%";
        progressStatus.innerText = "0%";

        // Thực hiện dịch tuần tự từng cụm để tránh lỗi Rate Limit (Free API key giới hạn 15 RPM)
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunk = chunks[chunkIdx];
            const startLineNum = chunk[0].id + 1;
            const endLineNum = chunk[chunk.length - 1].id + 1;

            progressLabel.innerText = `Đang dịch dòng ${startLineNum} - ${endLineNum} (${chunkIdx + 1}/${totalChunks})...`;

            let retryCount = 0;
            const MAX_RETRIES = 3;
            let chunkSuccess = false;

            while (retryCount < MAX_RETRIES && !chunkSuccess) {
                try {
                    const translatedTexts = await translateChunkWithGemini(chunk, apiKey, model, targetLang);

                    // Cập nhật kết quả dịch vào mảng chính
                    translatedTexts.forEach(translatedItem => {
                        const originalItem = currentTranscript.find(item => item.id === translatedItem.id);
                        if (originalItem) {
                            originalItem.textTranslated = translatedItem.text;
                        }
                    });

                    chunkSuccess = true;
                    successCount++;
                } catch (err) {
                    console.error(`Lỗi khi dịch cụm ${chunkIdx + 1}, lần thử ${retryCount + 1}:`, err);
                    retryCount++;
                    if (retryCount < MAX_RETRIES) {
                        // Gặp lỗi (Rate limit, lỗi kết nối), đợi 5 giây trước khi thử lại
                        progressLabel.innerText = `Lỗi xảy ra. Đang thử lại cụm ${chunkIdx + 1} sau 5s...`;
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }

            if (!chunkSuccess) {
                progressLabel.innerText = "Dịch thất bại một số cụm do lỗi kết nối/hạn mức API.";
                showToast("Dịch phụ đề bị lỗi một phần!", "⚠️");
                break;
            }

            // Cập nhật tiến trình UI
            const percent = Math.round(((chunkIdx + 1) / totalChunks) * 100);
            progressBarFill.style.width = `${percent}%`;
            progressStatus.innerText = `${percent}%`;

            // Render lại giao diện ngay khi có dữ liệu từng cụm để tạo cảm giác mượt mà
            renderTranscript();

            // Nếu còn cụm tiếp theo, hãy trì hoãn 2 giây để tránh vượt quá 15 RPM của key free
            if (chunkIdx < totalChunks - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Hoàn tất luồng dịch
        translateBtn.disabled = false;
        progressContainer.classList.remove("active");

        if (successCount === totalChunks) {
            showToast("Đã dịch xong bằng Gemini AI!", "🎉");

            // Lưu bản dịch vào cache local storage để không tốn quota API lần sau
            if (activeVideoId) {
                const dataToSave = currentTranscript.map(item => ({
                    id: item.id,
                    textTranslated: item.textTranslated
                }));
                const saveKey = `yt_trans_${activeVideoId}`;
                chrome.storage.local.set({ [saveKey]: dataToSave }, () => {
                    console.log(`Đã lưu bản dịch video ${activeVideoId} vào Storage!`);
                });
            }

            // Gửi bản dịch sang content script để cập nhật giao diện ngay lập tức
            if (activeTabId) {
                chrome.tabs.sendMessage(activeTabId, {
                    action: "UPDATE_TRANSLATIONS",
                    data: currentTranscript.map(item => ({
                        id: item.id,
                        textTranslated: item.textTranslated
                    }))
                }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Lỗi đồng bộ bản dịch sang content script:", chrome.runtime.lastError.message);
                    }
                });
            }

            // Chuyển sang tab song ngữ mặc định để trải nghiệm
            const tabBilingual = document.querySelector('[data-view="bilingual"]');
            if (tabBilingual) tabBilingual.click();
        }
    });
}

async function translateChunkWithGemini(chunk, apiKey, model, targetLang) {
    const storage = await new Promise(res => chrome.storage.local.get(["firebase_id_token"], res));
    const idToken = storage.firebase_id_token || "";

    const response = await fetch(`${BACKEND_URL}/api/translate`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ chunk, apiKey, model, targetLang, idToken })
    });

    if (!response.ok) {
        let errMsg = `HTTP Error ${response.status}`;
        try {
            const errData = await response.json();
            if (errData && errData.error) errMsg = errData.error;
        } catch (e) {}
        throw new Error(errMsg);
    }

    return await response.json();
}

// Sao chép phụ đề vào Clipboard dựa theo chế độ hiển thị hiện tại
function copyAllToClipboard() {
    if (currentTranscript.length === 0) return;

    const activeTab = document.querySelector(".tab-btn.active");
    const viewMode = activeTab ? activeTab.getAttribute("data-view") : "bilingual";

    let textToCopy = "";

    currentTranscript.forEach(item => {
        const timeLabel = `[${item.time}]`;
        if (viewMode === "bilingual") {
            const vnText = item.textTranslated || "(Chưa dịch)";
            textToCopy += `${timeLabel} ${item.text}\n      └ ${vnText}\n`;
        } else if (viewMode === "trans") {
            textToCopy += `${timeLabel} ${item.textTranslated || item.text}\n`;
        } else {
            textToCopy += `${timeLabel} ${item.text}\n`;
        }
    });

    navigator.clipboard.writeText(textToCopy).then(() => {
        showToast("Đã sao chép toàn bộ!", "✓");
    }).catch(err => {
        console.error("Không thể sao chép:", err);
        showToast("Lỗi sao chép!", "❌");
    });
}

// Tải xuống file SRT phù hợp với chế độ hiển thị
function downloadSrtFile() {
    if (currentTranscript.length === 0) return;

    const activeTab = document.querySelector(".tab-btn.active");
    const viewMode = activeTab ? activeTab.getAttribute("data-view") : "bilingual";

    let srtText = "";

    for (let i = 0; i < currentTranscript.length; i++) {
        const item = currentTranscript[i];
        const nextItem = currentTranscript[i + 1];

        const srtIndex = i + 1;
        const startTimeSrt = formatSecondsToSrtTime(item.start);

        // Sử dụng thời gian kết thúc chuẩn đã được tính toán từ backend
        let endTimeSec = item.end;
        if (!endTimeSec) {
            endTimeSec = item.start + 3;
            if (nextItem) {
                const gap = nextItem.start - item.start;
                if (gap > 0 && gap <= 4) {
                    endTimeSec = nextItem.start;
                } else if (gap > 4) {
                    endTimeSec = item.start + 3.5;
                }
            }
        }

        const endTimeSrt = formatSecondsToSrtTime(endTimeSec);

        // Nội dung chữ tương ứng với viewMode
        let contentLine = "";
        if (viewMode === "bilingual") {
            const vnText = item.textTranslated ? item.textTranslated : "";
            contentLine = vnText ? `${vnText}\n(${item.text})` : item.text;
        } else if (viewMode === "trans") {
            contentLine = item.textTranslated ? item.textTranslated : item.text;
        } else {
            contentLine = item.text;
        }

        srtText += `${srtIndex}\n${startTimeSrt} --> ${endTimeSrt}\n${contentLine}\n\n`;
    }

    // Tạo file blob để tải xuống
    const blob = new Blob([srtText], { type: "text/srt;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeVideoTitle}.srt`;
    a.click();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);

    showToast("Đã tải xuống file .srt!", "💾");
}

// Format giây thành chuẩn SRT: HH:MM:SS,mmm
function formatSecondsToSrtTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds % 1) * 1000);

    const pad = (num, size) => ('000' + num).slice(-size);
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`;
}

// Format giây thành nhãn hiển thị dễ đọc (ví dụ: 125 -> 02:05)
function formatTimeLabel(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const pad = (num) => ('0' + num).slice(-2);
    return `${pad(minutes)}:${pad(seconds)}`;
}

// Hiển thị thông báo Toast mini sinh động
function showToast(message, icon = "✓") {
    const toast = document.getElementById("toast");
    const toastIcon = document.getElementById("toast-icon");
    const toastMessage = document.getElementById("toast-message");

    toastIcon.innerText = icon;
    toastMessage.innerText = message;

    toast.classList.add("active");

    // Tự đóng sau 2.5 giây
    setTimeout(() => {
        toast.classList.remove("active");
    }, 2500);
}

// --- LOGIC XÁC THỰC VÀ ĐỒNG BỘ HÓA FIREBASE (REST API) ---

function initAuthUI() {
    const googleLoginBtn = document.getElementById("btn-google-login");
    const logoutBtn = document.getElementById("btn-logout");

    if (googleLoginBtn) {
        googleLoginBtn.addEventListener("click", () => handleLogin(true));
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }
}

function showLoginOverlay() {
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.add("active");
}

function hideLoginOverlay() {
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.remove("active");
}

// Cập nhật giao diện thông tin người dùng
function updateProfileUI(user) {
    const nameEl = document.getElementById("user-name");
    const avatarEl = document.getElementById("user-avatar");
    const badgeEl = document.getElementById("user-status-badge");

    if (nameEl) nameEl.innerText = user.displayName || user.email || "Thành viên";
    if (avatarEl && user.photoUrl) avatarEl.src = user.photoUrl;
    if (badgeEl) {
        badgeEl.innerText = (user.status || "free").toUpperCase();
        if (user.status === "pro") {
            badgeEl.className = "user-status-badge pro";
        } else {
            badgeEl.className = "user-status-badge";
        }
    }

    // Cập nhật cảnh báo API Key
    const apiKey = document.getElementById("api-key").value.trim();
    updateApiKeyWarning(apiKey, user.status);
}

// Cảnh báo khi tài khoản Free chưa cấu hình API Key
function updateApiKeyWarning(apiKey, status) {
    const warningEl = document.getElementById("api-key-warning");
    const apiKeyInput = document.getElementById("api-key");
    if (!warningEl || !apiKeyInput) return;

    const userStatus = (status || "free").toLowerCase();

    if (userStatus !== "pro") {
        apiKeyInput.placeholder = "Bắt buộc nhập API Key cá nhân cho gói Free";
        if (!apiKey) {
            warningEl.style.display = "block";
            warningEl.innerHTML = "⚠️ Gói Free bắt buộc phải tự điền API Key cá nhân để sử dụng dịch vụ.";
            apiKeyInput.style.borderColor = "var(--warning)";
        } else {
            warningEl.style.display = "none";
            apiKeyInput.style.borderColor = "";
        }
    } else {
        apiKeyInput.placeholder = "Nhập API Key tự chọn (để trống sẽ dùng mặc định)";
        warningEl.style.display = "none";
        apiKeyInput.style.borderColor = "";
    }
}

// Kiểm tra trạng thái đăng nhập thực tế của người dùng từ Storage
async function checkAuthStatus() {
    return new Promise((resolve) => {
        chrome.storage.local.get([
            "user_uid",
            "user_email",
            "user_display_name",
            "user_photo_url",
            "user_status",
            "firebase_id_token",
            "firebase_token_expires_at"
        ], (result) => {
            const token = result.firebase_id_token;
            const expiresAt = result.firebase_token_expires_at;
            
            // Nếu token còn hiệu lực (và còn nhiều hơn 5 phút)
            if (token && expiresAt && (expiresAt - Date.now() > 5 * 60 * 1000)) {
                const user = {
                    uid: result.user_uid,
                    email: result.user_email,
                    displayName: result.user_display_name,
                    photoUrl: result.user_photo_url,
                    status: result.user_status
                };
                updateProfileUI(user);
                
                // Tự động đồng bộ trạng thái mới nhất từ Firestore (để cập nhật gói Free/Pro từ Admin)
                syncUserStatusFromFirestore(result.user_uid, token);
                
                resolve(true);
            } else if (token) {
                // Token đã hết hạn hoặc sắp hết hạn, thử gửi message nhờ background script làm mới
                console.log("[XT-Popup] Token đã hết hạn hoặc sắp hết hạn. Đang gọi background làm mới...");
                chrome.runtime.sendMessage({ action: "GET_OR_REFRESH_TOKEN" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("[XT-Popup] Lỗi giao tiếp với background script:", chrome.runtime.lastError.message);
                        resolve(false);
                        return;
                    }
                    
                    if (response && response.status === "success" && response.idToken) {
                        // Sau khi background làm mới thành công, lấy lại dữ liệu mới nhất từ storage để cập nhật UI
                        chrome.storage.local.get([
                            "user_uid",
                            "user_email",
                            "user_display_name",
                            "user_photo_url",
                            "user_status"
                        ], (updatedResult) => {
                            const user = {
                                uid: updatedResult.user_uid,
                                email: updatedResult.user_email,
                                displayName: updatedResult.user_display_name,
                                photoUrl: updatedResult.user_photo_url,
                                status: updatedResult.user_status
                            };
                            updateProfileUI(user);
                            
                            // Đồng bộ trạng thái từ Firestore bằng token mới
                            syncUserStatusFromFirestore(updatedResult.user_uid, response.idToken);
                            resolve(true);
                        });
                    } else {
                        console.log("[XT-Popup] Background không thể làm mới token.");
                        resolve(false);
                    }
                });
            } else {
                resolve(false);
            }
        });
    });
}

// Đồng bộ trạng thái của user từ Firestore REST API
async function syncUserStatusFromFirestore(uid, idToken) {
    if (FIREBASE_PROJECT_ID === "YOUR_FIREBASE_PROJECT_ID" || FIREBASE_API_KEY === "YOUR_FIREBASE_API_KEY") {
        console.warn("Chưa cấu hình Firebase Project ID / API Key. Bỏ qua đồng bộ.");
        return;
    }

    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
        const response = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${idToken}`
            }
        });

        if (response.status === 200) {
            const data = await response.json();
            const fields = data.fields;
            const status = fields.status && fields.status.stringValue ? fields.status.stringValue : "free";

            chrome.storage.local.set({ user_status: status }, () => {
                const badgeEl = document.getElementById("user-status-badge");
                if (badgeEl) {
                    badgeEl.innerText = status.toUpperCase();
                    if (status === "pro") {
                        badgeEl.className = "user-status-badge pro";
                    } else {
                        badgeEl.className = "user-status-badge";
                    }
                }
                updateUdemyProUI(status);
            });
        }
    } catch (e) {
        console.error("Lỗi đồng bộ Firestore REST API:", e);
    }
}

// Xử lý logic Đăng nhập / Refresh
async function handleLogin(interactive = true) {
    return new Promise((resolve) => {
        // Chế độ đăng nhập OAuth thực tế qua Google/Firebase
        const ENABLE_QUICK_LOGIN = false;
        if (ENABLE_QUICK_LOGIN || FIREBASE_PROJECT_ID === "YOUR_FIREBASE_PROJECT_ID" || FIREBASE_API_KEY === "YOUR_FIREBASE_API_KEY") {
            console.log("[XT-Auth] Kích hoạt Đăng nhập 1-Click thành công!");
            const mockUser = {
                uid: "user_ledanvnn",
                email: "ledanvnn@gmail.com",
                displayName: "Lê Dần (PRO Admin)",
                photoUrl: "icon/64x64.png",
                status: "pro"
            };
            chrome.storage.local.set({
                user_uid: mockUser.uid,
                user_email: mockUser.email,
                user_display_name: mockUser.displayName,
                user_photo_url: mockUser.photoUrl,
                user_status: mockUser.status,
                firebase_id_token: "mock_id_token",
                firebase_refresh_token: "mock_refresh_token",
                firebase_token_expires_at: Date.now() + 365 * 24 * 3600 * 1000
            }, () => {
                updateProfileUI(mockUser);
                showToast("Đăng nhập tài khoản PRO thành công!", "🎉");
                if (interactive) {
                    initApplication().then(() => resolve(true));
                } else {
                    resolve(true);
                }
            });
            return;
        }

        if (GOOGLE_CLIENT_ID_WEB === "YOUR_GOOGLE_CLIENT_ID_WEB") {
            console.warn("Chưa cấu hình GOOGLE_CLIENT_ID_WEB trong popup.js!");
            showToast("Vui lòng cấu hình Web Client ID!", "⚠️");
            resolve(false);
            return;
        }

        // Thử lấy token qua Chrome Native Identity getAuthToken trước
        chrome.identity.getAuthToken({ interactive: interactive }, async (nativeToken) => {
            let googleToken = nativeToken;

            if (chrome.runtime.lastError || !googleToken) {
                console.log("[XT-Auth] getAuthToken không thành công, chuyển sang launchWebAuthFlow...", chrome.runtime.lastError?.message);
                
                const redirectUri = chrome.identity.getRedirectURL();
                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
                                `?client_id=${GOOGLE_CLIENT_ID_WEB}` +
                                `&response_type=token` +
                                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                                `&scope=${encodeURIComponent("https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile")}`;

                googleToken = await new Promise((resWebFlow) => {
                    chrome.identity.launchWebAuthFlow({
                        url: authUrl,
                        interactive: interactive
                    }, (redirectUrl) => {
                        if (chrome.runtime.lastError || !redirectUrl) {
                            console.warn("Lỗi Google Auth (launchWebAuthFlow):", chrome.runtime.lastError?.message);
                            resWebFlow(null);
                            return;
                        }

                        try {
                            const url = new URL(redirectUrl);
                            const params = new URLSearchParams(url.hash.substring(1));
                            resWebFlow(params.get("access_token"));
                        } catch (e) {
                            console.error("Lỗi phân tích redirect URL:", e);
                            resWebFlow(null);
                        }
                    });
                });
            }

            if (!googleToken) {
                resolve(false);
                return;
            }

            try {
                // 1. Đổi Google Token lấy Firebase ID Token
                const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`;
                const authResponse = await fetch(authUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        postBody: `access_token=${googleToken}&providerId=google.com`,
                        requestUri: "http://localhost",
                        returnIdpCredential: true,
                        returnSecureToken: true
                    })
                });

                if (!authResponse.ok) {
                    throw new Error(`Đăng nhập Firebase REST API thất bại: ${authResponse.status}`);
                }

                const authData = await authResponse.json();
                const idToken = authData.idToken;
                const uid = authData.localId;
                const email = authData.email;
                const displayName = authData.displayName || email.split("@")[0];
                const photoUrl = authData.photoUrl || "icon/64x64.png";
                const expiresAt = Date.now() + parseInt(authData.expiresIn) * 1000;

                // 2. Kiểm tra/Tạo/Cập nhật document của user trong Firestore
                const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
                const getDocResponse = await fetch(docUrl, {
                    headers: {
                        "Authorization": `Bearer ${idToken}`
                    }
                });

                let userStatus = "free";
                const nowIso = new Date().toISOString();

                if (getDocResponse.status === 404) {
                    // Người dùng mới: Tạo mới tài liệu Firestore
                    const createData = {
                        fields: {
                            email: { stringValue: email },
                            displayName: { stringValue: displayName },
                            photoUrl: { stringValue: photoUrl },
                            status: { stringValue: "free" },
                            role: { stringValue: "user" },
                            createdAt: { timestampValue: nowIso },
                            lastLogin: { timestampValue: nowIso }
                        }
                    };

                    await fetch(docUrl, {
                        method: "PATCH",
                        headers: {
                            "Authorization": `Bearer ${idToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(createData)
                    });

                    userStatus = "free";
                } else if (getDocResponse.status === 200) {
                    // Người dùng cũ: Đọc trạng thái hiện tại và cập nhật thời gian đăng nhập
                    const docData = await getDocResponse.json();
                    const fields = docData.fields;
                    userStatus = fields.status && fields.status.stringValue ? fields.status.stringValue : "free";

                    // Nếu tài khoản bị chặn bởi Admin
                    if (userStatus === "blocked") {
                        showToast("Tài khoản của bạn đã bị khóa bởi Admin!", "❌");
                        fetch(`https://oauth2.googleapis.com/revoke?token=${googleToken}`, { method: "POST" })
                            .catch(e => console.warn("Lỗi thu hồi token của tài khoản bị khóa:", e));
                        resolve(false);
                        return;
                    }

                    const updateData = {
                        fields: {
                            email: { stringValue: email },
                            displayName: { stringValue: displayName },
                            photoUrl: { stringValue: photoUrl },
                            lastLogin: { timestampValue: nowIso }
                        }
                    };

                    await fetch(`${docUrl}?updateMask.fieldPaths=email&updateMask.fieldPaths=displayName&updateMask.fieldPaths=photoUrl&updateMask.fieldPaths=lastLogin`, {
                        method: "PATCH",
                        headers: {
                            "Authorization": `Bearer ${idToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(updateData)
                    });
                } else {
                    throw new Error(`Firestore REST API GET trả về status: ${getDocResponse.status}`);
                }

                // 3. Lưu thông tin người dùng vào storage
                const loggedInUser = {
                    uid,
                    email,
                    displayName,
                    photoUrl,
                    status: userStatus
                };

                chrome.storage.local.set({
                    user_uid: uid,
                    user_email: email,
                    user_display_name: displayName,
                    user_photo_url: photoUrl,
                    user_status: userStatus,
                    firebase_id_token: idToken,
                    firebase_refresh_token: authData.refreshToken,
                    firebase_token_expires_at: expiresAt,
                    google_access_token: googleToken
                }, () => {
                    updateProfileUI(loggedInUser);
                    if (interactive) {
                        initApplication().then(() => resolve(true));
                    } else {
                        resolve(true);
                    }
                });

            } catch (err) {
                console.error("Lỗi xảy ra trong Auth Firebase REST API:", err);
                showToast("Lỗi kết nối xác thực!", "❌");
                resolve(false);
            }
        });
    });
}

// Xử lý Đăng xuất
function handleLogout() {
    chrome.storage.local.get(["firebase_id_token", "google_access_token"], (result) => {
        const token = result.firebase_id_token;
        const googleToken = result.google_access_token;

        if (googleToken) {
            fetch(`https://oauth2.googleapis.com/revoke?token=${googleToken}`, { method: "POST" })
                .then(() => console.log("Đã thu hồi Google Auth Token thành công"))
                .catch(err => console.warn("Lỗi thu hồi Google Auth Token:", err));
        }

        chrome.storage.local.remove([
            "user_uid",
            "user_email",
            "user_display_name",
            "user_photo_url",
            "user_status",
            "firebase_id_token",
            "firebase_refresh_token",
            "firebase_token_expires_at",
            "google_access_token"
        ], () => {
            showToast("Đã đăng xuất tài khoản!", "👋");
            showLoginOverlay();

            setTimeout(() => {
                window.location.reload();
            }, 800);
        });
    });
}