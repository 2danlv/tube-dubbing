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
    await initApplication();
});

// Khởi chạy ứng dụng
async function initApplication() {
    // 1. Tải cấu hình cài đặt từ Storage
    await loadSettings();

    // 2. Tìm tab active
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    activeTabId = tab.id;

    activeVideoTitle = tab.title ? tab.title.replace(" - YouTube", "").replace(/[\\/:*?"<>|]/g, "_") : "youtube-transcript";
    if (tab.url) {
        try {
            const urlObj = new URL(tab.url);
            activeVideoId = urlObj.searchParams.get("v");
        } catch (e) {
            console.error("Không thể phân tích URL:", e);
        }
    }

    // 3. Khởi tạo các sự kiện giao diện
    initUIEvents();

    // 4. Gửi yêu cầu lấy phụ đề đã cào từ content.js
    fetchTranscriptFromContent();
}

// Tải cấu hình cài đặt
async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang", "gemini_tts_voice", "gemini_tts_rate"], (result) => {
            const apiKey = result.gemini_api_key || "";
            document.getElementById("api-key").value = apiKey;
            document.getElementById("api-model").value = result.gemini_model || DEFAULT_MODEL;

            const targetLang = result.gemini_target_lang || "Tiếng Việt";
            const ttsVoice = result.gemini_tts_voice || "vi-VN-HoaiMyNeural";
            const ttsRate = result.gemini_tts_rate || "-10%";

            document.getElementById("api-target-lang").value = targetLang;
            document.getElementById("api-tts-rate").value = ttsRate;

            // Cập nhật động danh sách giọng lồng tiếng theo cấu hình đã lưu
            updateVoiceDropdown(targetLang, ttsVoice);

            // Cập nhật cảnh báo API Key
            updateApiKeyWarning(apiKey);

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
        const rateVal = document.getElementById("api-tts-rate").value || "-10%";

        if (!keyVal) {
            showToast("Vui lòng nhập Gemini API Key!", "❌");
            return;
        }

        chrome.storage.local.set({
            gemini_api_key: keyVal,
            gemini_model: modelVal,
            gemini_target_lang: langVal,
            gemini_tts_voice: voiceVal,
            gemini_tts_rate: rateVal
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

    const apiKeyInput = document.getElementById("api-key");
    if (apiKeyInput) {
        apiKeyInput.addEventListener("input", (e) => {
            updateApiKeyWarning(e.target.value.trim());
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
    chrome.storage.local.get(["gemini_api_key", "gemini_model", "gemini_target_lang"], async (result) => {
        const apiKey = result.gemini_api_key ? result.gemini_api_key.trim() : DEFAULT_API_KEY;
        const model = result.gemini_model ? result.gemini_model.trim() : DEFAULT_MODEL;
        const targetLang = result.gemini_target_lang || "Tiếng Việt";

        if (!apiKey) {
            showToast("Vui lòng cấu hình Gemini API Key!", "❌");
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

// Cảnh báo khi chưa cấu hình API Key
function updateApiKeyWarning(apiKey) {
    const warningEl = document.getElementById("api-key-warning");
    const apiKeyInput = document.getElementById("api-key");
    if (!warningEl || !apiKeyInput) return;

    apiKeyInput.placeholder = "Nhập Gemini API Key của bạn";
    if (!apiKey) {
        warningEl.style.display = "block";
        warningEl.innerHTML = "⚠️ Vui lòng nhập Gemini API Key cá nhân để sử dụng dịch vụ.";
        apiKeyInput.style.borderColor = "var(--warning)";
    } else {
        warningEl.style.display = "none";
        apiKeyInput.style.borderColor = "";
    }
}