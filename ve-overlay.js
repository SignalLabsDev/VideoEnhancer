(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  
  // Prevent re-initialization
  if (VN.overlayInitialized) return;
  VN.overlayInitialized = true;
  
  // Helper to always get current state
  const getState = () => VN.state;
  
  const overlayApi = {};

  // DOM references
  let overlayContainer = null;
  let toggleButton = null;
  let settingsButton = null;

  // State
  let lastVideoRect = null;
  let youtubePlayerElement = null;
  let youtubeControlsObserver = null;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let repositionRAF = null;
  let hoverRAF = null;
  let pollInterval = null;
  let spaHooksInstalled = false;
  let initialized = false;
  let fullscreenWasActive = false;
  let fullscreenWasUsingYoutubeControls = false;
  let overlayIdleHidden = false;
  let overlayIdleTimer = null;

  const FULLSCREEN_IDLE_TIMEOUT_MS = 3000;

  // Styles
  const ACTIVE_STYLE = { bg: 'rgba(15, 23, 42, 0.9)', color: '#9146ff' };
  const DISABLED_STYLE = { bg: 'rgba(15, 23, 42, 0.9)', color: 'rgba(145, 70, 255, 0.4)' };

  // Helper: Check if overlay should be shown
  const shouldShowOverlay = () => {
    return Boolean(getState()?.overlayEnabled);
  };

  const getFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreenElement || document.msFullscreenElement || null;

  const isFullscreen = () => Boolean(getFullscreenElement());

  const clearOverlayIdleTimer = () => {
    if (overlayIdleTimer) clearTimeout(overlayIdleTimer);
    overlayIdleTimer = null;
  };

  const scheduleOverlayIdleHide = () => {
    if (!isFullscreen() || youtubePlayerElement) {
      clearOverlayIdleTimer();
      overlayIdleHidden = false;
      return;
    }
    clearOverlayIdleTimer();
    overlayIdleHidden = false;
    overlayIdleTimer = setTimeout(() => {
      overlayIdleTimer = null;
      overlayIdleHidden = true;
      updateHoverState();
    }, FULLSCREEN_IDLE_TIMEOUT_MS);
    if (overlayContainer && lastVideoRect) updateHoverState();
  };

  const watchYoutubePlayer = (videoOrPlayer) => {
    const player = videoOrPlayer?.matches?.('.html5-video-player')
      ? videoOrPlayer
      : videoOrPlayer?.closest?.('.html5-video-player') || null;
    if (player === youtubePlayerElement) return;

    if (youtubeControlsObserver) {
      youtubeControlsObserver.disconnect();
      youtubeControlsObserver = null;
    }

    youtubePlayerElement = player;
    if (!player || typeof MutationObserver !== 'function') return;

    youtubeControlsObserver = new MutationObserver(() => updateHoverState());
    youtubeControlsObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
  };

  const handleFullscreenMode = () => {
    const fullscreen = isFullscreen();
    const fullscreenChanged = fullscreen !== fullscreenWasActive;
    fullscreenWasActive = fullscreen;

    if (!fullscreen) {
      fullscreenWasUsingYoutubeControls = false;
      clearOverlayIdleTimer();
      overlayIdleHidden = false;
      return;
    }

    if (youtubePlayerElement) {
      fullscreenWasUsingYoutubeControls = true;
      clearOverlayIdleTimer();
      overlayIdleHidden = false;
      return;
    }

    const switchedAwayFromYoutube = fullscreenWasUsingYoutubeControls;
    fullscreenWasUsingYoutubeControls = false;
    if (fullscreenChanged || switchedAwayFromYoutube) scheduleOverlayIdleHide();
  };

  // Helper: Apply button styling
  const applyButtonStyle = (btn, style) => {
    if (!btn) return;
    btn.style.setProperty('background-image', 'none', 'important');
    btn.style.setProperty('background-color', style.bg, 'important');
    btn.style.setProperty('color', style.color, 'important');
    btn.style.setProperty('border-color', 'transparent', 'important');
  };

  // Hide the overlay completely
  const hideOverlay = () => {
    clearOverlayIdleTimer();
    overlayIdleHidden = false;
    fullscreenWasActive = false;
    fullscreenWasUsingYoutubeControls = false;
    if (youtubeControlsObserver) {
      youtubeControlsObserver.disconnect();
      youtubeControlsObserver = null;
    }
    youtubePlayerElement = null;
    if (!overlayContainer) return;
    overlayContainer.style.visibility = 'hidden';
    setOverlayInteractive(false);
  };

  // Show the overlay (just visibility, opacity controlled by hover)
  const showOverlay = () => {
    if (!overlayContainer) return;
    overlayContainer.style.visibility = 'visible';
  };

  // Get minimum video size thresholds
  function getMinTargetSize() {
    const c = VN?.consts;
    return {
      w: typeof c?.MIN_TARGET_WIDTH === 'number' ? c.MIN_TARGET_WIDTH : 320,
      h: typeof c?.MIN_TARGET_HEIGHT === 'number' ? c.MIN_TARGET_HEIGHT : 180
    };
  }

  // Check if rect is visible in viewport
  function rectIntersectsViewport(rect) {
    if (!rect) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.right <= 0 || rect.bottom <= 0) return false;
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
    return true;
  }

  // Get the largest visible video element
  function getPrimaryVideo() {
    const min = getMinTargetSize();
    const minArea = min.w * min.h;
    let best = null;
    let bestArea = 0;
    let bestIsPlaying = false;

    const candidates = VN.collectVideos().map((video) => {
      const player = video.closest('.html5-video-player');
      return { video, player, target: player || video };
    });
    const knownPlayers = new Set(candidates.map((candidate) => candidate.player).filter(Boolean));
    document.querySelectorAll('.html5-video-player').forEach((player) => {
      if (knownPlayers.has(player)) return;
      candidates.push({ video: player.querySelector('video'), player, target: player });
    });

    candidates.forEach(({ video, player, target }) => {
      const rect = target.getBoundingClientRect();
      if (!rectIntersectsViewport(rect)) return;
      if ((rect.width * rect.height) < minArea) return;
      
      const cs = window.getComputedStyle(target);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      
      const area = rect.width * rect.height;
      const isPlaying = !!(video && video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2);

      // Prioritize playing videos, then by area
      if (!best || (isPlaying && !bestIsPlaying) || (isPlaying === bestIsPlaying && area > bestArea)) {
        best = { video, player, rect };
        bestArea = area;
        bestIsPlaying = isPlaying;
      }
    });

    return best;
  }

  // Opacity alone leaves buttons keyboard-focusable while they are invisible.
  // Keep the container out of the tab order and accessibility tree when hidden.
  const setOverlayInteractive = (visible) => {
    if (!overlayContainer) return;
    overlayContainer.style.opacity = visible ? '1' : '0';
    overlayContainer.style.pointerEvents = visible ? 'auto' : 'none';
    overlayContainer.setAttribute('aria-hidden', String(!visible));
    try { overlayContainer.inert = !visible; } catch (_) {}
    [toggleButton, settingsButton].forEach((button) => {
      if (button) button.tabIndex = visible ? 0 : -1;
    });
  };

  // Update hover state (show/hide based on mouse position over video)
  const updateHoverState = () => {
    if (!overlayContainer || !shouldShowOverlay() || !lastVideoRect) {
      hideOverlay();
      return;
    }

    const r = lastVideoRect;
    const inside = lastMouseX >= r.left && lastMouseX <= r.right && 
                   lastMouseY >= r.top && lastMouseY <= r.bottom;

    const youtubeControlsVisible = !youtubePlayerElement ||
      !youtubePlayerElement.isConnected ||
      !youtubePlayerElement.classList.contains('ytp-autohide');
    const visible = inside && youtubeControlsVisible &&
      !(isFullscreen() && !youtubePlayerElement && overlayIdleHidden);
    setOverlayInteractive(visible);
  };

  // Position the overlay relative to the primary video
  const positionOverlay = () => {
    // If disabled or no container, hide and bail
    if (!overlayContainer || !shouldShowOverlay()) {
      lastVideoRect = null;
      hideOverlay();
      return;
    }

    const best = getPrimaryVideo();
    if (!best) {
      lastVideoRect = null;
      watchYoutubePlayer(null);
      handleFullscreenMode();
      hideOverlay();
      return;
    }

    watchYoutubePlayer(best.player || best.video);
    handleFullscreenMode();
    lastVideoRect = best.rect;
    const margin = 8;
    overlayContainer.style.top = `${Math.max(margin, best.rect.top + margin)}px`;
    overlayContainer.style.right = `${Math.max(margin, window.innerWidth - best.rect.right + margin)}px`;
    showOverlay();
    updateHoverState();
  };

  // Request position update on next animation frame
  const requestPosition = () => {
    if (repositionRAF) return;
    repositionRAF = requestAnimationFrame(() => {
      repositionRAF = null;
      positionOverlay();
    });
  };

  // Update button visual states based on enabled state
  const updateButtonStyles = () => {
    if (!toggleButton || !settingsButton) return;

    // Settings button always active
    applyButtonStyle(settingsButton, ACTIVE_STYLE);

    // Toggle button reflects filter enabled state
    const isEnabled = Boolean(getState()?.enabled);
    applyButtonStyle(toggleButton, isEnabled ? ACTIVE_STYLE : DISABLED_STYLE);
    toggleButton.setAttribute('aria-pressed', String(isEnabled));
  };

  // Create the overlay DOM elements
  const createOverlay = () => {
    if (overlayContainer) return;

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'video-enhancer-inline-toggle';
    overlayContainer.setAttribute('role', 'group');
    overlayContainer.setAttribute('aria-label', 'Video Enhancer quick controls');
    overlayContainer.style.cssText = `
      position: fixed !important;
      z-index: 2147483646 !important;
      top: -9999px;
      right: -9999px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms ease;
    `;

    const btnStyle = `
      width: 38px;
      height: 38px;
      padding: 0;
      box-sizing: border-box;
      border: 1px solid transparent;
      border-radius: 11px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 20px;
      font-weight: 700;
      cursor: pointer;
    `;

    const createIconSpan = (char, options = {}) => {
      const span = document.createElement('span');
      span.textContent = char;
      span.style.display = 'inline-block';
      span.style.transform = 'translate(0.5px, -2px)';
      if (options.bold) {
        span.style.fontSize = '22px';
        span.style.fontWeight = '800';
      } else if (options.large) {
        span.style.fontSize = '24px';
      }
      return span;
    };

    // Toggle button - enables/disables the filter
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.style.cssText = btnStyle;
    toggleButton.setAttribute('aria-label', 'Toggle video enhancement');
    toggleButton.setAttribute('aria-pressed', 'false');
    toggleButton.title = 'Toggle video enhancement';
    toggleButton.appendChild(createIconSpan('⏻', { bold: true }));
    toggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      scheduleOverlayIdleHide();
      
      const state = getState();
      if (!state) return;
      
      // Toggle the enabled state
      const newEnabled = !state.enabled;
      state.enabled = newEnabled;
      
      // Update visuals immediately
      updateButtonStyles();
      
      // Sync with panel and persist
      VN.panel?.syncUI?.();
      VN.schedulePersist?.('overlay-toggle');
      
      // Apply or remove filter immediately
      if (newEnabled) {
        VN.scheduleRefresh?.('overlay-toggle');
      } else {
        VN.updateAllVideos?.(null);
      }
    });

    // Settings button - opens the panel
    settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.style.cssText = btnStyle;
    settingsButton.setAttribute('aria-label', 'Open Video Enhancer settings');
    settingsButton.title = 'Open Video Enhancer settings';
    settingsButton.appendChild(createIconSpan('⚙', { large: true }));
    settingsButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      scheduleOverlayIdleHide();
      
      // If in iframe, message parent; otherwise toggle directly
      try {
        if (window.top !== window) {
          window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, '*');
          return;
        }
      } catch (_) {}
      
      VN.panel?.toggle?.();
    });

    overlayContainer.append(toggleButton, settingsButton);
    setOverlayInteractive(false);
    (document.body || document.documentElement).appendChild(overlayContainer);
  };

  // Ensure overlay exists and is properly positioned
  const ensureOverlay = () => {
    if (!shouldShowOverlay()) {
      hideOverlay();
      return;
    }

    // Check if overlay was removed from DOM
    if (overlayContainer && !overlayContainer.isConnected) {
      overlayContainer = null;
      toggleButton = null;
      settingsButton = null;
    }

    if (!overlayContainer) {
      createOverlay();
    }

    // Fullscreen handling: Move overlay into fullscreen element if needed
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    const targetParent = fsElement || document.body || document.documentElement;
    
    if (overlayContainer && overlayContainer.parentElement !== targetParent) {
      try {
        targetParent.appendChild(overlayContainer);
      } catch (_) {
        if (targetParent !== document.body) {
          (document.body || document.documentElement).appendChild(overlayContainer);
        }
      }
    }

    updateButtonStyles();
    positionOverlay();
  };

  // Mouse move handler
  const onMouseMove = (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (isFullscreen() && !youtubePlayerElement) scheduleOverlayIdleHide();
    
    if (hoverRAF) return;
    hoverRAF = requestAnimationFrame(() => {
      hoverRAF = null;
      updateHoverState();
    });
  };

  const onKeyDown = () => {
    if (isFullscreen() && !youtubePlayerElement) scheduleOverlayIdleHide();
  };

  // URL change handler for SPAs
  const onUrlChange = () => {
    lastVideoRect = null;
    
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    if (!shouldShowOverlay()) {
      hideOverlay();
      return;
    }

    ensureOverlay();
    
    // Poll for delayed video rendering
    let attempts = 0;
    pollInterval = setInterval(() => {
      attempts++;
      if (attempts >= 10 || getPrimaryVideo()) {
        clearInterval(pollInterval);
        pollInterval = null;
        ensureOverlay();
      }
    }, 500);
  };

  // Install SPA navigation hooks
  const installSpaHooks = () => {
    if (spaHooksInstalled) return;
    spaHooksInstalled = true;

    const wrap = (fn) => function() {
      const result = fn.apply(this, arguments);
      onUrlChange();
      return result;
    };

    if (typeof history.pushState === 'function') {
      history.pushState = wrap(history.pushState);
    }
    if (typeof history.replaceState === 'function') {
      history.replaceState = wrap(history.replaceState);
    }

    const events = ['popstate', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start'];
    events.forEach((evt) => window.addEventListener(evt, onUrlChange));
  };

  // Attach global event listeners
  const attachListeners = () => {
    window.addEventListener('scroll', requestPosition, true);
    window.addEventListener('resize', requestPosition);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('ended', requestPosition, true);
    
    // Fullscreen changes need the full ensure path: it reparents the overlay into
    // the fullscreen element before positioning it. requestPosition alone would
    // leave the overlay outside the top layer until the 2s watchdog runs.
    const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    fsEvents.forEach(evt => document.addEventListener(evt, ensureOverlay, true));
  };

  // Initialize the overlay system
  overlayApi.init = () => {
    if (initialized) return;
    initialized = true;

    installSpaHooks();
    attachListeners();

    // Initial setup based on current state
    if (shouldShowOverlay()) {
      ensureOverlay();
    }

    // Watchdog for missed SPA events and DOM changes
    setInterval(() => {
      if (shouldShowOverlay()) {
        const primary = getPrimaryVideo();
        if (primary) {
          ensureOverlay();
        } else if (overlayContainer && overlayContainer.style.visibility !== 'hidden') {
          hideOverlay();
        }
      }
    }, 2000);
  };

  // Public API
  overlayApi.ensure = ensureOverlay;
  overlayApi.updateState = updateButtonStyles;
  overlayApi.requestPosition = requestPosition;
  overlayApi.getPrimaryVideo = getPrimaryVideo;
  
  // Called when overlayEnabled setting changes
  overlayApi.refresh = () => {
    try {
      if (shouldShowOverlay()) {
        ensureOverlay();
      } else {
        hideOverlay();
      }
    } catch (e) {
      console.debug('[VideoEnhancer] Overlay refresh error:', e);
    }
  };

  VN.overlay = overlayApi;
})();
