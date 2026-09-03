// Bộ chặn network cho các trang web ngoài YouTube: phát hiện các response .vtt
// tải qua fetch/XHR (dành cho các player tự fetch phụ đề bằng JS thay vì dùng thẻ <track>).
// Được chèn thủ công (on-demand) qua chrome.scripting.executeScript khi người dùng bấm
// "Kích hoạt" trong popup, nên có thể bỏ lỡ các request đã chạy trước đó.
(function () {
  if (window.__genericVttInterceptorInstalled) return;
  window.__genericVttInterceptorInstalled = true;

  function looksLikeVtt(url, text) {
    if (url && /\.vtt(\?|#|$)/i.test(url)) return true;
    if (text && text.trim().slice(0, 6).toUpperCase() === 'WEBVTT') return true;
    return false;
  }

  function dispatch(url, text) {
    window.postMessage({
      action: 'GENERIC_VTT_INTERCEPTED',
      namespace: 'generic_vtt_interceptor',
      url: url,
      text: text
    }, '*');
  }

  const OriginalXHR = window.XMLHttpRequest;
  function InterceptedXHR() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;
    let requestUrl = '';

    xhr.open = function (method, url) {
      requestUrl = url;
      return originalOpen.apply(this, arguments);
    };

    xhr.addEventListener('load', function () {
      try {
        const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
        if (looksLikeVtt(requestUrl, text)) dispatch(requestUrl, text);
      } catch (e) {
        // Bỏ qua response không đọc được (vd binary, blob)
      }
    });

    return xhr;
  }
  window.XMLHttpRequest = InterceptedXHR;

  const originalFetch = window.fetch;
  window.fetch = async function () {
    const response = await originalFetch.apply(this, arguments);

    try {
      let url = '';
      const arg = arguments[0];
      if (typeof arg === 'string') url = arg;
      else if (arg instanceof URL) url = arg.href;
      else if (arg && arg.url) url = arg.url;

      const clone = response.clone();
      clone.text().then(text => {
        if (looksLikeVtt(url, text)) dispatch(url, text);
      }).catch(() => {});
    } catch (e) {
      // Bỏ qua lỗi đọc response clone
    }

    return response;
  };

  window.postMessage({ action: 'GENERIC_VTT_INTERCEPTOR_READY' }, '*');
})();
