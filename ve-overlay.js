(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const overlayApi = {};
  const defaultConfig = {
    isEnabled: () => false,
    onToggle: () => {}
  };

  let config = { ...defaultConfig };
  let overlayButton = null;
  let lastVideoRect = null;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let repositionRAF = null;
  let hoverRAF = null;
  let spaHooksInstalled = false;

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
    } catch (_) {}
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
    if (!overlayButton) return;
    const rect = lastVideoRect;
    if (!rect) {
      overlayButton.style.opacity = '0';
      overlayButton.style.pointerEvents = 'none';
      return;
    }
    const inside = lastMouseX >= rect.left && lastMouseX <= rect.right && lastMouseY >= rect.top && lastMouseY <= rect.bottom;
    overlayButton.style.opacity = inside ? '1' : '0';
    overlayButton.style.pointerEvents = inside ? 'auto' : 'none';
  };

  const positionOverlayToggle = () => {
    if (!overlayButton) return;
    if (!isAllowedPage()) {
      overlayButton.style.visibility = 'hidden';
      lastVideoRect = null;
      updateOverlayHoverState();
      return;
    }
    const best = getPrimaryVideo();
    if (!best) {
      overlayButton.style.visibility = 'hidden';
      lastVideoRect = null;
      updateOverlayHoverState();
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
    if (!overlayButton) return;
    const enabled = Boolean(config.isEnabled());
    overlayButton.textContent = enabled ? 'Enhanced' : 'Enhance';
    if (enabled) {
      overlayButton.style.setProperty('background-image', 'linear-gradient(135deg, #5c6df4, #845ae0)', 'important');
      overlayButton.style.setProperty('box-shadow', '0 8px 18px rgba(92, 109, 244, 0.35)', 'important');
      overlayButton.style.setProperty('color', '#ffffff', 'important');
      overlayButton.style.setProperty('border-color', 'transparent', 'important');
    } else {
      overlayButton.style.setProperty('background-image', 'none', 'important');
      overlayButton.style.setProperty('background-color', 'rgba(255, 255, 255, 0.1)', 'important');
      overlayButton.style.setProperty('box-shadow', 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)', 'important');
      overlayButton.style.setProperty('color', 'rgba(208, 211, 220, 0.9)', 'important');
      overlayButton.style.setProperty('border-color', 'transparent', 'important');
    }
  };

  const ensureOverlayToggle = () => {
    if (!isAllowedPage()) {
      if (overlayButton) {
        overlayButton.style.visibility = 'hidden';
        overlayButton.style.opacity = '0';
        overlayButton.style.pointerEvents = 'none';
      }
      return null;
    }
    if (!overlayButton) {
      overlayButton = document.createElement('button');
      overlayButton.id = 'video-enhancer-inline-toggle';
      overlayButton.type = 'button';
      overlayButton.textContent = 'Enhance';
      overlayButton.style.cssText = `
        position: fixed !important;
        z-index: 2147483646 !important;
        top: -9999px;
        right: -9999px;
        min-width: 96px;
        height: 38px;
        padding: 0 16px;
        border-radius: 11px;
        border: 1px solid transparent;
        background-image: linear-gradient(135deg, #5c6df4, #845ae0);
        color: #ffffff;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        line-height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        visibility: hidden;
        opacity: 0;
        transition: opacity 120ms ease, box-shadow 120ms ease;
        box-shadow: 0 8px 18px rgba(92, 109, 244, 0.35);
      `;
      overlayButton.addEventListener('click', () => {
        try {
          config.onToggle();
        } finally {
          updateInlineToggleState();
        }
      });
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
    ensureOverlayToggle();
    requestPosition();
  };

  overlayApi.ensure = ensureOverlayToggle;
  overlayApi.updateState = updateInlineToggleState;
  overlayApi.requestPosition = requestPosition;

  VN.overlay = overlayApi;
})();
