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

  // A native <video> fullscreen element paints only itself. Controls left outside
  // that tree are not shown, but they stay keyboard-focusable if a later
  // reposition shows them again.
  const isNativeVideoFullscreen = () => getFullscreenElement() instanceof HTMLVideoElement;

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
      if (hasOverlayKeyboardFocus()) {
        // Don't hide (and inert) controls a keyboard user is interacting with.
        scheduleOverlayIdleHide();
        return;
      }
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

  // Hide the overlay completely. A transient "no video in view" frame must not
  // forget that fullscreen idle mode (or a YouTube player) was already active,
  // otherwise the next position pass treats it as a new fullscreen entry and
  // shows the controls again without input.
  const hideOverlay = () => {
    const resetFullscreenState = !isFullscreen() || !shouldShowOverlay();

    if (resetFullscreenState) {
      clearOverlayIdleTimer();
      overlayIdleHidden = false;
      fullscreenWasActive = false;
      fullscreenWasUsingYoutubeControls = false;
      if (youtubeControlsObserver) {
        youtubeControlsObserver.disconnect();
        youtubeControlsObserver = null;
      }
      youtubePlayerElement = null;
    }

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

  // Get the largest visible video element. Callers that already scanned the
  // document can pass the video list to avoid a duplicate DOM walk.
  function getPrimaryVideo(videos = VN.collectVideos()) {
    const min = getMinTargetSize();
    const minArea = min.w * min.h;
    let best = null;
    let bestArea = 0;
    let bestIsPlaying = false;

    const candidates = videos.map((video) => {
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
    if (!visible) {
      const activeElement = typeof VN.activeElement === 'function' ? VN.activeElement() : document.activeElement;
      if (activeElement instanceof HTMLElement && overlayContainer.contains(activeElement)) {
        // Never leave focus on an element that is about to become inert.
        activeElement.blur();
      }
    }
    overlayContainer.style.opacity = visible ? '1' : '0';
    overlayContainer.style.pointerEvents = visible ? 'auto' : 'none';
    overlayContainer.setAttribute('aria-hidden', String(!visible));
    try { overlayContainer.inert = !visible; } catch (_) {}
    [toggleButton, settingsButton].forEach((button) => {
      if (button) button.tabIndex = visible ? 0 : -1;
    });
  };

  // Mouse clicks focus buttons too; only keyboard-visible focus should keep the
  // hover controls pinned open after the pointer leaves.
  const hasOverlayKeyboardFocus = () => {
    const activeElement = typeof VN.activeElement === 'function' ? VN.activeElement() : document.activeElement;
    if (!overlayContainer || !(activeElement instanceof HTMLElement) ||
        !overlayContainer.contains(activeElement)) return false;
    try {
      return activeElement.matches(':focus-visible');
    } catch (_) {
      return false;
    }
  };

  // Update hover state (show/hide based on mouse position over video)
  const updateHoverState = () => {
    if (!overlayContainer || !shouldShowOverlay() || !lastVideoRect || isNativeVideoFullscreen()) {
      hideOverlay();
      return;
    }

    const r = lastVideoRect;
    const inside = lastMouseX >= r.left && lastMouseX <= r.right && 
                   lastMouseY >= r.top && lastMouseY <= r.bottom;

    const youtubeControlsVisible = !youtubePlayerElement ||
      !youtubePlayerElement.isConnected ||
      !youtubePlayerElement.classList.contains('ytp-autohide');
    // Hovering these buttons blocks the player underneath. YouTube then
    // autohides, and hiding with it made the buttons vanish under the pointer.
    let pointerOverControls = false;
    try { pointerOverControls = overlayContainer.matches(':hover'); } catch (_) {}
    // Keep the controls up while they contain keyboard focus, even if the
    // pointer is elsewhere; a mouse-click focus should not pin them open.
    const hasFocus = hasOverlayKeyboardFocus();
    const visible = hasFocus || pointerOverControls || (inside && youtubeControlsVisible &&
      !(isFullscreen() && !youtubePlayerElement && overlayIdleHidden));
    setOverlayInteractive(visible);
  };

  // Position the overlay relative to the primary video
  const positionOverlay = (primary = null) => {
    // Scroll, resize, and video mutations call this directly. The native-video
    // fullscreen guard in ensureOverlay is not enough on its own.
    if (!overlayContainer || !shouldShowOverlay() || isNativeVideoFullscreen()) {
      lastVideoRect = null;
      hideOverlay();
      return;
    }

    const best = primary || getPrimaryVideo();
    if (!best) {
      lastVideoRect = null;
      // Keep watching the last player through transient no-video frames; the
      // next successful position replaces it. Clearing it here would mistake
      // the gap for leaving YouTube and arm the non-YouTube idle timer.
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
      VN.schedulePersist?.('enabled-toggle');
      
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
      
      // If in an iframe, ask the extension service worker to relay the toggle
      // to the top frame; otherwise toggle directly.
      try {
        if (window.top !== window) {
          VN.requestPanelToggleFromFrame?.();
          return;
        }
      } catch (_) {}
      
      VN.panel?.toggle?.();
    });

    overlayContainer.append(toggleButton, settingsButton);
    setOverlayInteractive(false);
    const root = typeof VN.mountUi === 'function' ? VN.mountUi(document.body || document.documentElement) : null;
    (root || document.body || document.documentElement).appendChild(overlayContainer);
  };

  // Ensure overlay exists and is properly positioned
  const ensureOverlay = (primary = null) => {
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

    // Native video fullscreen only renders the video element itself; fallback
    // children appended to a <video> are never displayed. Keep the overlay out
    // of it rather than hiding the controls inside unrendered content.
    // positionOverlay repeats this guard because scroll and resize skip this path.
    const fsElement = getFullscreenElement();
    if (isNativeVideoFullscreen()) {
      lastVideoRect = null;
      hideOverlay();
      return;
    }

    // Fullscreen only paints the fullscreen element. Move the shared UI host
    // into it; the overlay itself stays in the shadow root, away from page CSS.
    const pageParent = fsElement || document.body || document.documentElement;
    if (typeof VN.mountUi === 'function') {
      VN.mountUi(pageParent);
    } else if (overlayContainer && overlayContainer.parentElement !== pageParent) {
      try {
        pageParent.appendChild(overlayContainer);
      } catch (_) {
        if (pageParent !== document.body) {
          (document.body || document.documentElement).appendChild(overlayContainer);
        }
      }
    }

    updateButtonStyles();
    positionOverlay(primary);
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
      const primary = getPrimaryVideo();
      if (attempts >= 10 || primary) {
        clearInterval(pollInterval);
        pollInterval = null;
        ensureOverlay(primary);
      }
    }, 500);
  };

  // Install SPA navigation hooks. Reassigning history.pushState here cannot
  // intercept the page's own calls (content scripts run in an isolated world),
  // so listen for real navigation events instead.
  const installSpaHooks = () => {
    if (spaHooksInstalled) return;
    spaHooksInstalled = true;

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
    // Re-run the filter selection too; the fullscreen video is often newly primary.
    const onFullscreenChange = () => {
      ensureOverlay();
      VN.scheduleRefresh?.('fullscreen-change');
    };
    const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    fsEvents.forEach(evt => document.addEventListener(evt, onFullscreenChange, true));
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
          ensureOverlay(primary);
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
