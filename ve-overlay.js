(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const overlayApi = {};
  const defaultConfig = {
    isEnabled: () => false,
    onToggle: () => { }
  };

  let config = { ...defaultConfig };
  let overlayButton = null; // container for the two-button overlay
  let toggleButton = null;  // left on/off button
  let settingsButton = null; // right settings button
  let lastVideoRect = null;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let repositionRAF = null;
  let hoverRAF = null;
  let spaHooksInstalled = false;
  let suppressed = false;

  const hideOverlayButton = () => {
    if (!overlayButton) return;
    overlayButton.style.visibility = 'hidden';
    overlayButton.style.opacity = '0';
    overlayButton.style.pointerEvents = 'none';
  };

  const isAllowedPage = () => {
    try {
      const host = (location.hostname || '').toLowerCase();
      const path = location.pathname || '/';
      if (host.includes('youtube') && path === '/watch') {
        const sp = new URLSearchParams(location.search || '');
        return sp.has('v');
      }
      if (host.includes('twitch.tv')) {
        return /^\/[^\/?#]+\/?$/.test(path) && path !== '/';
      }
      if (host.includes('kick.com')) {
        return /^\/[^\/?#]+\/?$/.test(path) && path !== '/';
      }
    } catch (_) { }
    return false;
  };

  const getPrimaryVideo = () => {
    const videos = Array.from(document.querySelectorAll('video'))
      .filter((v) => v instanceof HTMLVideoElement && v.offsetWidth > 0 && v.offsetHeight > 0);
    if (!videos.length) return null;
    let best = null;
    let bestArea = 0;
    videos.forEach((video) => {
      const rect = video.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area > bestArea) {
        best = { video, rect };
        bestArea = area;
      }
    });
    return best;
  };

  const updateOverlayHoverState = () => {
    if (!overlayButton || suppressed) {
      hideOverlayButton();
      return;
    }
    const rect = lastVideoRect;
    if (!rect) {
      hideOverlayButton();
      return;
    }
    const inside = lastMouseX >= rect.left && lastMouseX <= rect.right && lastMouseY >= rect.top && lastMouseY <= rect.bottom;
    overlayButton.style.opacity = inside ? '1' : '0';
    overlayButton.style.pointerEvents = inside ? 'auto' : 'none';
  };

  const positionOverlayToggle = () => {
    if (!overlayButton || suppressed) {
      hideOverlayButton();
      return;
    }
    if (!isAllowedPage()) {
      lastVideoRect = null;
      hideOverlayButton();
      return;
    }
    const best = getPrimaryVideo();
    if (!best) {
      lastVideoRect = null;
      hideOverlayButton();
      return;
    }
    lastVideoRect = best.rect;
    const top = Math.max(8, best.rect.top + 8);
    const right = Math.max(8, (window.innerWidth - best.rect.right) + 8);
    overlayButton.style.top = `${Math.round(top)}px`;
    overlayButton.style.right = `${Math.round(right)}px`;
    overlayButton.style.visibility = 'visible';
    updateOverlayHoverState();
  };

  const requestPosition = () => {
    if (repositionRAF) return;
    repositionRAF = requestAnimationFrame(() => {
      repositionRAF = null;
      positionOverlayToggle();
    });
  };

  const updateInlineToggleState = () => {
    if (!toggleButton || !settingsButton || suppressed) return;
    const enabled = Boolean(config.isEnabled());
    const host = (location.hostname || '').toLowerCase();
    const isKick = isAllowedPage() && host.includes('kick.com');
    const isTwitch = isAllowedPage() && host.includes('twitch.tv');
    const isYouTube = isAllowedPage() && host.includes('youtube');

    // Settings button: always look "on" using site-specific colors
    if (isKick) {
      settingsButton.style.setProperty('background-image', 'none', 'important');
      settingsButton.style.setProperty('background-color', 'rgba(83, 252, 24, 1)', 'important');
      settingsButton.style.setProperty('color', '#000000', 'important');
    } else if (isTwitch) {
      settingsButton.style.setProperty('background-image', 'none', 'important');
      settingsButton.style.setProperty('background-color', '#9146ff', 'important');
      settingsButton.style.setProperty('color', '#ffffff', 'important');
    } else if (isYouTube) {
      settingsButton.style.setProperty('background-image', 'none', 'important');
      settingsButton.style.setProperty('background-color', '#ff0000', 'important');
      settingsButton.style.setProperty('color', '#ffffff', 'important');
    } else {
      settingsButton.style.setProperty('background-image', 'linear-gradient(135deg, #3ea6ff, #2481ff)', 'important');
      settingsButton.style.setProperty('background-color', 'transparent', 'important');
      settingsButton.style.setProperty('color', '#ffffff', 'important');
    }
    settingsButton.style.setProperty('border-color', 'transparent', 'important');

    // Toggle button: reflects enabled/disabled state
    if (enabled) {
      if (isKick) {
        toggleButton.style.setProperty('background-image', 'none', 'important');
        toggleButton.style.setProperty('background-color', 'rgba(83, 252, 24, 1)', 'important');
        toggleButton.style.setProperty('color', '#000000', 'important');
      } else if (isTwitch) {
        toggleButton.style.setProperty('background-image', 'none', 'important');
        toggleButton.style.setProperty('background-color', '#9146ff', 'important'); // Twitch Purple
        toggleButton.style.setProperty('color', '#ffffff', 'important');
      } else if (isYouTube) {
        toggleButton.style.setProperty('background-image', 'none', 'important');
        toggleButton.style.setProperty('background-color', '#ff0000', 'important'); // YouTube Red
        toggleButton.style.setProperty('color', '#ffffff', 'important');
      } else {
        toggleButton.style.setProperty('background-image', 'linear-gradient(135deg, #3ea6ff, #2481ff)', 'important');
        toggleButton.style.setProperty('background-color', 'transparent', 'important');
        toggleButton.style.setProperty('color', '#ffffff', 'important');
      }
      toggleButton.style.setProperty('border-color', 'transparent', 'important');
    } else {
      toggleButton.style.setProperty('background-image', 'none', 'important');
      toggleButton.style.setProperty('background-color', 'rgba(255, 255, 255, 0.1)', 'important');
      toggleButton.style.setProperty('color', 'rgba(208, 211, 220, 0.9)', 'important');
      toggleButton.style.setProperty('border-color', 'transparent', 'important');
    }
  };

  const ensureOverlayToggle = () => {
    if (suppressed || !isAllowedPage()) {
      hideOverlayButton();
      return null;
    }
    if (!overlayButton) {
      overlayButton = document.createElement('div');
      overlayButton.id = 'video-enhancer-inline-toggle';
      overlayButton.style.cssText = `
        position: fixed !important;
        z-index: 2147483646 !important;
        top: -9999px;
        right: -9999px;
        height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        visibility: hidden;
        opacity: 0;
        transition: opacity 120ms ease;
        pointer-events: none;
        gap: 6px;
      `;

      toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.textContent = '⏻';
      toggleButton.style.cssText = `
        width: 38px;
        height: 38px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 11px;
        background-image: linear-gradient(135deg, #3ea6ff, #2481ff);
        color: #ffffff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 20px;
        font-weight: 700;
        line-height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      `;
      toggleButton.addEventListener('click', (event) => {
        event.stopPropagation();
        try {
          config.onToggle();
        } finally {
          updateInlineToggleState();
        }
      });

      settingsButton = document.createElement('button');
      settingsButton.type = 'button';
      settingsButton.textContent = '⚙';
      settingsButton.style.cssText = `
        width: 38px;
        height: 38px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 11px;
        background-color: rgba(0, 0, 0, 0.5);
        color: #ffffff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 20px;
        font-weight: 700;
        line-height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      `;
      settingsButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (VN.panel) {
          VN.panel.ensure?.();
          VN.panel.setVisible?.(true);
        }
      });

      overlayButton.appendChild(toggleButton);
      overlayButton.appendChild(settingsButton);
      (document.body || document.documentElement).appendChild(overlayButton);
    }
    updateInlineToggleState();
    positionOverlayToggle();
    return overlayButton;
  };

  const handleMouseMove = (event) => {
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    if (hoverRAF) return;
    hoverRAF = requestAnimationFrame(() => {
      hoverRAF = null;
      updateOverlayHoverState();
    });
  };

  const handleUrlChanged = () => {
    lastVideoRect = null;
    ensureOverlayToggle();
    requestPosition();

    // Poll for a few seconds to catch delayed video rendering in SPAs (like Twitch)
    let attempts = 0;
    const maxAttempts = 10;
    const interval = setInterval(() => {
      attempts++;
      const found = getPrimaryVideo();
      if (found) {
        ensureOverlayToggle();
        requestPosition();
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 500);
  };

  const installSpaHooks = () => {
    if (spaHooksInstalled) return;
    spaHooksInstalled = true;
    const notify = () => handleUrlChanged();
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    if (typeof originalPush === 'function') {
      history.pushState = function pushStateWrapper() {
        const result = originalPush.apply(this, arguments);
        notify();
        return result;
      };
    }
    if (typeof originalReplace === 'function') {
      history.replaceState = function replaceStateWrapper() {
        const result = originalReplace.apply(this, arguments);
        notify();
        return result;
      };
    }
    window.addEventListener('popstate', notify);
    window.addEventListener('yt-navigate-finish', notify);
    window.addEventListener('yt-page-data-updated', notify);
    window.addEventListener('yt-navigate-start', notify);
    document.addEventListener('yt-navigate-finish', notify, true);
    document.addEventListener('yt-page-data-updated', notify, true);
    document.addEventListener('yt-navigate-start', notify, true);
  };

  const attachGlobalListeners = () => {
    window.addEventListener('scroll', requestPosition, true);
    window.addEventListener('resize', requestPosition);
    window.addEventListener('orientationchange', requestPosition);
    document.addEventListener('fullscreenchange', requestPosition, true);
    window.addEventListener('mousemove', handleMouseMove, true);
  };

  overlayApi.init = (options = {}) => {
    config = { ...defaultConfig, ...options };
    installSpaHooks();
    attachGlobalListeners();
    if (!suppressed) {
      ensureOverlayToggle();
      requestPosition();
    }

    // Watchdog: Periodically ensure overlay is present and positioned on valid pages
    // This handles cases where SPA events fire before the DOM is ready or are missed
    setInterval(() => {
      if (!suppressed && isAllowedPage()) {
        // Force a check for the primary video
        const best = getPrimaryVideo();
        if (best) {
          // If we have a video, ensure button exists and update position
          // We don't check if it's already visible to avoid fighting with logic that hides it,
          // but ensureOverlayToggle handles creation/unhiding if valid.
          ensureOverlayToggle();
          requestPosition();
        }
      }
    }, 2000);
  };

  overlayApi.ensure = ensureOverlayToggle;
  overlayApi.updateState = updateInlineToggleState;
  overlayApi.requestPosition = requestPosition;
  overlayApi.setSuppressed = (value) => {
    const next = Boolean(value);
    if (next === suppressed) {
      return;
    }
    suppressed = next;
    if (suppressed) {
      hideOverlayButton();
    } else {
      ensureOverlayToggle();
      requestPosition();
    }
  };

  VN.overlay = overlayApi;
})();
