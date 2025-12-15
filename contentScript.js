(() => {
  if (window.videoEnhancerInitialized) return;
  window.videoEnhancerInitialized = true;

  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  
  // Helper to always get current state
  const getState = () => VN.state;

  // Site variant detection
  const SITE_VARIANT = (() => {
    try {
      const host = (location.hostname || '').toLowerCase();
      if (host.includes('youtube')) return 'youtube';
      if (host.includes('twitch')) return 'twitch';
      if (host.includes('kick')) return 'kick';
    } catch (_) {}
    return 'default';
  })();

  // Mutation Observer logic
  const processNode = (node) => {
    if (node instanceof HTMLVideoElement) {
      VN.scheduleRefresh('mutation:video');
      VN.overlay?.requestPosition?.();
      return;
    }

    if (node instanceof HTMLElement) {
      const containsVideo = node.tagName === 'VIDEO' || node.querySelector('video');
      const ytActionsAppeared = (
        node.id === 'top-level-buttons-computed' ||
        node.id === 'actions' ||
        node.id === 'actions-inner' ||
        node.querySelector?.('#top-level-buttons-computed, #actions, #actions-inner, ytd-segmented-like-dislike-button-renderer')
      );
      if (containsVideo) {
        VN.scheduleRefresh('mutation:container');
        VN.overlay?.requestPosition?.();
      } else if (SITE_VARIANT === 'youtube' && ytActionsAppeared) {
        VN.overlay?.requestPosition?.();
      }
    }
  };

  const initMutationObserver = () => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLVideoElement) {
          VN.scheduleRefresh('mutation:attributes');
          VN.overlay?.requestPosition?.();
          return;
        }

        mutation.addedNodes.forEach((node) => {
          processNode(node);
        });

        if (SITE_VARIANT === 'youtube') {
          const t = mutation.target;
          if (t && t instanceof HTMLElement) {
            if (t.matches?.('ytd-watch-metadata, ytd-menu-renderer') || t.querySelector?.('ytd-watch-metadata, ytd-menu-renderer')) {
              VN.overlay?.requestPosition?.();
            }
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class', 'data-player-state']
    });
  };

  let visibilitySuspended = false;
  const handleVisibilityChange = () => {
    const state = getState();
    if (document.hidden) {
      if (state?.enabled) {
        VN.updateAllVideos(null);
        visibilitySuspended = true;
      }
      return;
    }

    if (visibilitySuspended) {
      visibilitySuspended = false;
      VN.scheduleRefresh('visibility-restore');
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  const init = async () => {
    await VN.loadPersistedState();
    VN.ensureFilter();
    
    // Initialize Overlay - it reads state.overlayEnabled directly
    VN.overlay?.init?.();

    // Initialize Panel - only create if it should be visible
    const state = getState();
    if (state?.panelVisible) {
      VN.panel?.ensure();
      VN.panel?.syncUI();
    }

    initMutationObserver();
    VN.refreshEffect();
  };

  // Track initialization state
  let initPromise = null;
  let isInitialized = false;
  let lastToggleTime = 0;

  // Listen for messages from popup/background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'VIDEO_ENHANCER_TOGGLE_PANEL') {
        // Only the top frame should toggle the panel; otherwise each iframe can
        // toggle in quick succession causing an open/close "flash".
        let isTopFrame = true;
        try { isTopFrame = window.top === window; } catch (_) { isTopFrame = true; }

        if (!isTopFrame) {
          try {
            window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, '*');
          } catch (_) {}
          return;
        }

        // Debounce rapid toggles to prevent flashing
        const now = Date.now();
        if (now - lastToggleTime < 300) {
          return;
        }
        lastToggleTime = now;

        // Ensure init completes before handling panel toggle
        const handleToggle = () => {
          const state = getState();
          if (!state) return;
          
          // Toggle panel visibility
          const newVisible = !state.panelVisible;
          
          if (typeof VN.panel?.setVisible === 'function') {
            VN.panel.setVisible(newVisible);
          }
        };

        if (isInitialized) {
          handleToggle();
        } else if (initPromise) {
          // Wait for init to complete so we have the correct persisted state
          initPromise.then(handleToggle).catch(() => handleToggle());
        } else {
          // Shouldn't happen, but handle gracefully
          handleToggle();
        }
      }
    });
  }

  const runInit = () => {
    initPromise = init()
      .then(() => {
        isInitialized = true;
      })
      .catch((error) => {
        console.error('[VideoEnhancer] Init error', error);
        isInitialized = true; // Mark as done even on error to prevent hanging
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit, { once: true });
  } else {
    runInit();
  }
})();
