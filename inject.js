(function() {
  const namespace = "yt_transcript_interceptor";
  let interceptedCache = {};

  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log(...args);
  }
  function error(...args) {
    if (DEBUG) console.error(...args);
  }

  // Periodically sync the player's active video ID to document.body attribute
  setInterval(() => {
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player && typeof player.getVideoData === 'function') {
        const videoData = player.getVideoData();
        if (videoData && videoData.video_id) {
          if (document.body.getAttribute('data-yt-active-video-id') !== videoData.video_id) {
            document.body.setAttribute('data-yt-active-video-id', videoData.video_id);
            log('[inject.js] Synced player video_id to document.body:', videoData.video_id);
          }
        }
      }
    } catch (err) {
      // Ignore sync errors
    }
  }, 200);

  // Override XMLHttpRequest
  const originalXHR = window.XMLHttpRequest;
  function interceptXHR() {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    let requestUrl = '';

    xhr.open = function(method, url) {
      requestUrl = url;
      return originalOpen.apply(this, arguments);
    };

    xhr.send = function() {
      this.addEventListener('load', function() {
        let responseContent = '';
        try {
          if (this.responseType === 'json') {
            responseContent = JSON.stringify(this.response);
          } else if (this.responseType === '' || this.responseType === 'text') {
            responseContent = this.responseText;
          } else if (this.response) {
            responseContent = typeof this.response === 'object' ? JSON.stringify(this.response) : this.response;
          }
        } catch (err) {
          error('[inject.js] Error reading XHR response:', err);
        }
        checkAndDispatchTranscript(requestUrl, responseContent, 'xhr');
      });
      return originalSend.apply(this, arguments);
    };

    return xhr;
  }
  window.XMLHttpRequest = interceptXHR;

  // Override Fetch
  const originalFetch = window.fetch;
  window.fetch = async function() {
    const response = await originalFetch.apply(this, arguments);
    
    let url = '';
    if (arguments[0]) {
      if (typeof arguments[0] === 'string') {
        url = arguments[0];
      } else if (arguments[0] instanceof URL) {
        url = arguments[0].href;
      } else if (arguments[0].url) {
        url = arguments[0].url;
      } else if (typeof arguments[0].toString === 'function') {
        url = arguments[0].toString();
      }
    }

    if (url) {
      // We clone the response to read it without consuming the original stream
      const clone = response.clone();
      clone.text().then(text => {
        checkAndDispatchTranscript(url, text, 'fetch');
      }).catch(err => {
        // Ignore errors when reading clone
      });
    }

    return response;
  };

  function checkAndDispatchTranscript(url, responseText, type) {
    try {
      if (!url || typeof url !== 'string') return;
      
      const parsedUrl = new URL(url, window.location.origin);
      
      // Check if it's the timedtext API
      if (parsedUrl.pathname.endsWith('/api/timedtext')) {
        // Bỏ qua nếu là phụ đề của quảng cáo (kiểm tra các tham số quảng cáo hoặc đường dẫn pagead)
        const isAd = Array.from(parsedUrl.searchParams.keys()).some(key => {
          const k = key.toLowerCase();
          return k.startsWith('ad') || k === 'clicktrack';
        }) || parsedUrl.pathname.includes('/pagead/');

        if (isAd) {
          log('[inject.js] Bỏ qua phụ đề của quảng cáo:', url);
          return;
        }
        const videoId = parsedUrl.searchParams.get('v');
        if (!videoId) return;

        // Try parsing the response text as JSON first
        let data = null;
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          // Response is not JSON (likely XML/VTT)
        }
        
        if (data && data.events) {
          // Lưu vào cache và dispatch
          interceptedCache[videoId] = { data: data, url: url };
          dispatchInterceptedEvent(videoId, data, url);
        } else {
          // If the player requested XML or another format, we force-fetch the JSON3 version
          const json3Url = new URL(url, window.location.origin);
          json3Url.searchParams.set('fmt', 'json3');
          
          log('[inject.js] Non-JSON3 timedtext detected. Fetching JSON3 fallback...');
          
          // Use originalFetch to bypass our own interception and avoid infinite loops
          originalFetch(json3Url.toString())
            .then(res => res.json())
            .then(jsonData => {
              if (jsonData && jsonData.events) {
                interceptedCache[videoId] = { data: jsonData, url: json3Url.toString() };
                dispatchInterceptedEvent(videoId, jsonData, json3Url.toString());
              }
            })
            .catch(err => {
              error('[inject.js] Failed to fetch JSON3 fallback subtitles:', err);
            });
        }
      }
    } catch (e) {
      error('[inject.js] Error in transcript interceptor:', e);
    }
  }

  function dispatchInterceptedEvent(videoId, data, url) {
    const eventDetail = {
      action: 'YT_TRANSCRIPT_INTERCEPTED',
      namespace: namespace,
      videoId: videoId,
      data: data,
      url: url
    };
    window.postMessage(eventDetail, "*");
    log('[inject.js] Intercepted and dispatched postMessage for video:', videoId);
  }

  async function fetchAndDispatchTrack(videoId, baseUrl) {
    try {
      if (!baseUrl) return false;
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.set('fmt', 'json3');
      const json3Url = urlObj.toString();
      
      log('[inject.js] Fetching transcript from player track url:', json3Url);
      const res = await originalFetch(json3Url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);
      const data = await res.json();
      
      if (data && data.events) {
        interceptedCache[videoId] = { data: data, url: json3Url };
        dispatchInterceptedEvent(videoId, data, json3Url);
        log('[inject.js] Successfully fetched and dispatched transcript for:', videoId);
        return true;
      }
    } catch (err) {
      error('[inject.js] Failed to fetch player track transcript:', err);
    }
    return false;
  }

  function tryExtractFromPlayer(videoId, retryCount = 0) {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (player && typeof player.getCaptionTracks === 'function') {
      const tracks = player.getCaptionTracks() || [];
      if (tracks.length > 0) {
        const bestTrack = tracks.find(t => t.languageCode === 'vi') || 
                          tracks.find(t => t.languageCode === 'en') || 
                          tracks[0];
        if (bestTrack && bestTrack.baseUrl) {
          fetchAndDispatchTrack(videoId, bestTrack.baseUrl);
          return;
        }
      }
    }
    
    if (retryCount < 5) {
      log('[inject.js] Player tracks not ready yet, retrying in 1s... Attempt:', retryCount + 1);
      setTimeout(() => {
        tryExtractFromPlayer(videoId, retryCount + 1);
      }, 1000);
    } else {
      log('[inject.js] Failed to extract transcript from player after retries.');
    }
  }

  function getActiveVideoIdFromUrl() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('v');
    } catch (e) {
      return null;
    }
  }

  // Lắng nghe các yêu cầu từ isolated world (content.js)
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    
    if (event.data && event.data.action === 'REQUEST_INTERCEPTED_CACHE') {
      const videoId = event.data.videoId;
      log('[inject.js] Nhận yêu cầu lấy cache phụ đề, videoId:', videoId);
      const cached = interceptedCache[videoId];
      if (cached) {
        log('[inject.js] Cache hit! Trả về phụ đề cho videoId:', videoId);
        dispatchInterceptedEvent(videoId, cached.data, cached.url);
      } else {
        log('[inject.js] Cache miss cho videoId:', videoId, '. Trích xuất từ player...');
        tryExtractFromPlayer(videoId);
      }
    } else if (event.data && event.data.action === 'FORCE_ENABLE_SUBTITLES') {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player) {
        try {
          if (typeof player.loadModule === 'function') {
            player.loadModule("captions");
          }
          
          let trackSet = false;
          if (typeof player.getCaptionTracks === 'function') {
            const tracks = player.getCaptionTracks() || [];
            if (tracks.length > 0) {
              const bestTrack = tracks.find(t => t.languageCode === 'vi') || 
                                tracks.find(t => t.languageCode === 'en') || 
                                tracks[0];
              if (bestTrack) {
                const videoId = document.body.getAttribute('data-yt-active-video-id') || getActiveVideoIdFromUrl();
                if (videoId && !interceptedCache[videoId]) {
                  fetchAndDispatchTrack(videoId, bestTrack.baseUrl);
                }

                if (typeof player.setOption === 'function') {
                  player.setOption("captions", "track", {});
                  player.setOption("captions", "track", { languageCode: bestTrack.languageCode });
                  trackSet = true;
                  log('[inject.js] Subtitles track set via setOption():', bestTrack.languageCode);
                }
              }
            }
          }
          
          if (trackSet) {
            if (typeof player.toggleSubtitlesOn === 'function') {
              player.toggleSubtitlesOn();
              log('[inject.js] Subtitles enabled via toggleSubtitlesOn()');
            } else if (typeof player.toggleSubtitles === 'function') {
              const ccBtn = document.querySelector('.ytp-subtitles-button');
              const isPressed = ccBtn && ccBtn.getAttribute('aria-pressed') === 'true';
              if (!isPressed) {
                player.toggleSubtitles();
                log('[inject.js] Subtitles toggled on');
              }
            }
          } else {
            const ccBtn = document.querySelector('.ytp-subtitles-button');
            const isPressed = ccBtn && ccBtn.getAttribute('aria-pressed') === 'true';
            
            if (!isPressed) {
              if (typeof player.toggleSubtitlesOn === 'function') {
                player.toggleSubtitlesOn();
                log('[inject.js] Subtitles enabled via toggleSubtitlesOn() fallback');
              } else if (typeof player.toggleSubtitles === 'function') {
                player.toggleSubtitles();
                log('[inject.js] Subtitles toggled via toggleSubtitles() fallback');
              }
            } else {
              log('[inject.js] Subtitles already enabled, reload track to force fetch');
              if (typeof player.setOption === 'function') {
                const currentTrack = player.getOption("captions", "track") || {};
                if (currentTrack.languageCode) {
                  player.setOption("captions", "track", {});
                  player.setOption("captions", "track", { languageCode: currentTrack.languageCode });
                } else {
                  if (typeof player.toggleSubtitles === 'function') {
                    player.toggleSubtitles();
                    setTimeout(() => {
                      if (typeof player.toggleSubtitles === 'function') player.toggleSubtitles();
                    }, 100);
                  }
                }
              }
            }
          }
        } catch (err) {
          error('[inject.js] Error in FORCE_ENABLE_SUBTITLES:', err);
        }
      }
    } else if (event.data && event.data.action === 'FORCE_DISABLE_SUBTITLES') {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player) {
        try {
          const ccBtn = document.querySelector('.ytp-subtitles-button');
          const isPressed = ccBtn && ccBtn.getAttribute('aria-pressed') === 'true';
          if (isPressed) {
            if (typeof player.toggleSubtitles === 'function') {
              player.toggleSubtitles();
              log('[inject.js] Subtitles disabled via toggleSubtitles()');
            } else if (typeof player.setOption === 'function') {
              player.setOption("captions", "track", {});
              log('[inject.js] Subtitles disabled via setOption()');
            }
          }
        } catch (err) {
          error('[inject.js] Error in FORCE_DISABLE_SUBTITLES:', err);
        }
      }
    }
  });

  log('[inject.js] Transcript interceptor initialized.');
})();
