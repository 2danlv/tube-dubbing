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
        console.error("[XT-Background] Lỗi khi gọi MSTranslatorAndroidApp TTS API:", err);
        cachedTtsToken = null; // Bỏ cache token lỗi, ép lấy token mới ở lần thử tiếp theo
        throw err;
    }
}

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
