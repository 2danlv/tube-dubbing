// --- MSTranslatorAndroidApp Edge TTS Client logic ---

// Dọn dẹp Alibaba API Key mặc định cũ khỏi storage (không còn dùng)
chrome.storage.local.get(["aliyun_asr_api_key"], (result) => {
    const oldDefaultKey = "sk-ws-H.IIYHED.JP5J.MEYCIQC_KSrmw6DFwfsZXFpE1K-00QvVr1hchjy0_bhxbDJbBAIhALDWAhDhjm9oR64hrt5C6IhN4BeXkL4kVI3j-noWO-zC";
    if (result.aliyun_asr_api_key === oldDefaultKey) {
        chrome.storage.local.remove("aliyun_asr_api_key");
    }
});

function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function hmacSha256(keyBase64, messageText) {
    const keyBytes = base64ToBytes(keyBase64);
    const messageBytes = new TextEncoder().encode(messageText);
    
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
    );
    
    const signature = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        messageBytes
    );
    
    return new Uint8Array(signature);
}

function generateUuidWithoutDashes() {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().replace(/-/g, "");
    }
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toLowerCase();
}

function getJwtExpiration(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return 0;
        const payloadDecoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(payloadDecoded);
        return (payload.exp * 1000) || 0; // exp is in seconds, convert to ms
    } catch (e) {
        console.warn("[XT-Background] Lỗi giải mã JWT:", e);
        return 0;
    }
}

let cachedTtsToken = null; // Cấu trúc: { token, region, expiresAt }

async function fetchTtsTokenFromEndpoint(locale) {
    const urlStr = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = generateUuidWithoutDashes();
    
    // Format date string dạng UTC
    const formattedDate = new Date().toUTCString().replace(/GMT/, "").replace(/UTC/, "").trim() + " GMT";
    
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    const secretKey = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";
    
    const signatureBytes = await hmacSha256(secretKey, bytesToSign);
    const signBase64 = bytesToBase64(signatureBytes);
    const signatureHeader = `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
    
    const headers = {
        "Accept-Language": locale || "vi-VN",
        "X-ClientVersion": "4.0.530a 5fe1dc6c",
        "X-UserId": uuidStr,
        "X-MT-Signature": signatureHeader,
        "Content-Type": "application/json"
    };
    
    console.log("[XT-Background] Yêu cầu token mới từ dev.microsofttranslator.com...");
    const response = await fetch(urlStr, {
        method: "POST",
        headers: headers
    });
    
    if (!response.ok) {
        throw new Error(`Không thể lấy token TTS. HTTP status: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.t) {
        throw new Error("Phản hồi lỗi từ apps/endpoint: Thiếu trường token 't'");
    }
    
    const token = data.t;
    const region = data.r || "eastus";
    
    let expiresAt = getJwtExpiration(token);
    if (!expiresAt) {
        expiresAt = Date.now() + 9 * 60 * 1000; // Mặc định hết hạn sau 9 phút
    }
    
    return { token, region, expiresAt };
}

async function getTtsToken(locale) {
    // Nếu token vẫn khả dụng trong 60 giây tới, tái sử dụng nó
    if (cachedTtsToken && cachedTtsToken.expiresAt > Date.now() + 60000) {
        console.log("[XT-Background] Tái sử dụng token đã cache.");
        return cachedTtsToken;
    }
    
    const tokenInfo = await fetchTtsTokenFromEndpoint(locale);
    cachedTtsToken = tokenInfo;
    return tokenInfo;
}

async function fetchTtsAudio(text, voice, rate = "-10%") {
    try {
        const voiceParts = voice.split("-");
        const locale = voiceParts.slice(0, 2).join("-");

        const tokenInfo = await getTtsToken(locale);

        const ttsUrl = `https://${tokenInfo.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'><voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${text}</prosody></voice></speak>`;
        
        const headers = {
            "Authorization": `Bearer ${tokenInfo.token}`,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"
        };
        
        console.log(`[XT-Background] Gửi request TTS sang ${ttsUrl} cho giọng đọc: ${voice}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        
        const response = await fetch(ttsUrl, {
            method: "POST",
            headers: headers,
            body: ssml,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Request tổng hợp giọng nói thất bại. HTTP status: ${response.status}`);
        }
        
        const audioBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(audioBuffer);
        return bytesToBase64(bytes);
    } catch (err) {
        console.warn("[XT-Background] MSTranslatorAndroidApp API lỗi, chuyển sang cơ chế WebSocket dự phòng:", err);
        return await generateEdgeTTSBackground(text, voice, rate);
    }
}

// --- WebSocket Edge TTS Fallback logic (Được chuyển vào background script để tránh CSP trên YouTube) ---

let clockOffset = 0;
let isOffsetCalibrated = false;

// Đồng bộ hóa thời gian với server YouTube để sửa lỗi lệch múi giờ/giờ hệ thống của người dùng
async function calibrateClock() {
    if (isOffsetCalibrated) return;
    try {
        console.log("[XT-Background] Đang đo độ lệch thời gian với server YouTube...");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500); // Giới hạn 2.5s
        
        const response = await fetch("https://www.youtube.com", { 
            method: "HEAD",
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const serverDateStr = response.headers.get("date");
        if (serverDateStr) {
            const serverTime = new Date(serverDateStr).getTime();
            const localTime = Date.now();
            clockOffset = serverTime - localTime;
            isOffsetCalibrated = true;
            console.log(`[XT-Background] Đã cân chỉnh đồng hồ! Độ lệch: ${clockOffset}ms (Giờ server: ${new Date(serverTime).toISOString()})`);
        } else {
            console.warn("[XT-Background] Phản hồi từ YouTube không chứa header 'date'");
        }
    } catch (e) {
        console.warn("[XT-Background] Không thể đồng bộ giờ với server YouTube, sử dụng giờ máy tính:", e);
    }
}

function getTimestampString() {
    const d = new Date(Date.now() + clockOffset);
    const utcDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const utcMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    const day = utcDays[d.getUTCDay()];
    const month = utcMonths[d.getUTCMonth()];
    const date = d.getUTCDate().toString().padStart(2, '0');
    const year = d.getUTCFullYear();
    const hours = d.getUTCHours().toString().padStart(2, '0');
    const minutes = d.getUTCMinutes().toString().padStart(2, '0');
    const seconds = d.getUTCSeconds().toString().padStart(2, '0');
    
    return `${day} ${month} ${date} ${year} ${hours}:${minutes}:${seconds} GMT+0000 (Coordinated Universal Time)`;
}

function generateConnectionId() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase();
}

async function generateSecMsGecToken() {
    const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
    const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
    
    await calibrateClock();
    
    const adjustedNow = Date.now() + clockOffset;
    const nowSecs = BigInt(Math.floor(adjustedNow / 1000));
    const ticks = (nowSecs + WINDOWS_FILE_TIME_EPOCH) * 10000000n;
    
    const roundedTicks = ticks - (ticks % 3000000000n);
    const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(strToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function generateEdgeTTSBackground(text, voice = "vi-VN-HoaiMyNeural", rate = "-10%") {
    const connectionId = generateConnectionId();
    const token = await generateSecMsGecToken();
    const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=${connectionId}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-143.0.3650.75`;

    console.log(`[XT-Background] Đang kết nối WebSocket đến: ${wsUrl}`);

    const voiceParts = voice.split("-");
    const locale = voiceParts.slice(0, 2).join("-") || "vi-VN";

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";

        let audioChunks = [];
        let isOpened = false;

        ws.onopen = () => {
            isOpened = true;
            const timestamp = getTimestampString();
            
            const configMsg = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
            ws.send(configMsg);

            const ssmlMsg = `X-RequestId:${connectionId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'><voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${text}</prosody></voice></speak>`;
            ws.send(ssmlMsg);
        };

        ws.onmessage = (event) => {
            if (typeof event.data === "string") {
                if (event.data.includes("Path:turn.end")) {
                    ws.close();
                    if (audioChunks.length > 0) {
                        const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
                        const joinedBuffer = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of audioChunks) {
                            joinedBuffer.set(new Uint8Array(chunk), offset);
                            offset += chunk.byteLength;
                        }
                        
                        const base64 = bytesToBase64(joinedBuffer);
                        resolve(base64);
                    } else {
                        reject(new Error("Không thể sinh dữ liệu âm thanh Edge TTS"));
                    }
                }
            } else if (event.data instanceof ArrayBuffer) {
                const view = new DataView(event.data);
                const headerLength = view.getUint16(0, false);
                const audioChunk = event.data.slice(2 + headerLength);
                if (audioChunk.byteLength > 0) {
                    audioChunks.push(audioChunk);
                }
            }
        };

        ws.onerror = (err) => {
            console.error("[XT-Background] Lỗi WebSocket Edge TTS:", err);
        };

        ws.onclose = (event) => {
            console.log(`[XT-Background] WebSocket đã đóng. Code: ${event.code}, Reason: ${event.reason}`);
            if (audioChunks.length === 0) {
                reject(new Error(`WebSocket đóng bất thường. Code: ${event.code}, Lý do: ${event.reason || "Handshake thất bại"}`));
            }
        };

        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
                reject(new Error("Edge TTS WebSocket Timeout"));
            }
        }, 10000);
    });
}

// Client-side ASR helpers have been moved to the secure backend

async function translateDirectWithGeminiKey(chunk, apiKey, model = "gemini-3.5-flash-lite", targetLang = "Tiếng Việt") {
    let cleanModel = (model || "").trim();
    if (!cleanModel) cleanModel = "gemini-3.5-flash-lite";

    const promptText = `Translate the following subtitle JSON array into ${targetLang}. 
Keep translations concise and natural for audio voiceover dubbing.
Output ONLY a valid JSON array of objects, where each object has "id" (number) and "text" (string). Do NOT wrap in markdown code blocks or add extra text.

Input JSON:
${JSON.stringify(chunk.map(item => ({ id: item.id, text: item.text })))}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
    
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: promptText }]
            }],
            generationConfig: {
                temperature: 0.2
            }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        let errMessage = `Gemini API HTTP ${response.status}`;
        try {
            const errJson = JSON.parse(errText);
            if (errJson && errJson.error && errJson.error.message) {
                errMessage = errJson.error.message;
            }
        } catch(e) {}
        throw new Error(errMessage);
    }

    const resJson = await response.json();
    let rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    
    const parsedArray = JSON.parse(rawText);
    return parsedArray;
}

// Đăng ký nhận tin nhắn từ content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GENERATE_EDGE_TTS") {
        let { text, voice, rate } = message;
        // Correct legacy/invalid voice value from older versions
        if (voice === "vi-VN-NamNeural") {
            voice = "vi-VN-NamMinhNeural";
        }
        fetchTtsAudio(text, voice, rate || "-10%")
            .then(audioBase64 => {
                sendResponse({ status: "success", audioBase64: audioBase64 });
            })
            .catch(error => {
                console.error("[XT-Background] Lỗi khi tổng hợp giọng nói:", error);
                sendResponse({ status: "error", message: error.message });
            });
        return true; // Giữ kênh tin nhắn mở để xử lý bất đồng bộ
    } else if (message.action === "TRANSLATE_TEXT") {
        const { chunk, apiKey, model, targetLang } = message;

        (async () => {
            const cleanKey = (apiKey || "").trim();
            if (!cleanKey) {
                sendResponse({ status: "error", message: "Chưa cấu hình Gemini API Key. Vui lòng nhập API Key trong phần Cài đặt." });
                return;
            }

            try {
                console.log("[XT-Background] Đang dịch qua Gemini API...");
                const data = await translateDirectWithGeminiKey(chunk, cleanKey, model, targetLang);
                sendResponse({ status: "success", data });
            } catch (err) {
                console.error("[XT-Background] Lỗi khi dịch qua Gemini API:", err);
                sendResponse({ status: "error", message: err.message || String(err) });
            }
        })();
        return true; // Giữ kênh tin nhắn mở để xử lý bất đồng bộ
    }
});
