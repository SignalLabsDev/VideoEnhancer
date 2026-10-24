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
      const matchesHost = (domain) => host === domain || host.endsWith(`.${domain}`);
      if (matchesHost('youtube.com') || matchesHost('youtube-nocookie.com') || host === 'youtu.be') return 'youtube';
      if (matchesHost('twitch.tv')) return 'twitch';
      if (matchesHost('kick.com')) return 'kick';
    } catch (_) {}
    return 'default';
  })();

  // Track initialization state
  let initPromise = null;
  let isInitialized = false;
  let lastToggleTime = 0;
  let mutationRefreshTimer = null;

  // A mutation storm (chat, player UI) should not trigger one full DOM scan per
  // frame. Coalesce mutation-driven refreshes; direct events (play, scroll,
  // fullscreen) still refresh immediately.
  const MUTATION_REFRESH_DELAY_MS = 150;
  const scheduleMutationRefresh = (reason) => {
    if (mutationRefreshTimer) return;
    mutationRefreshTimer = window.setTimeout(() => {
      mutationRefreshTimer = null;
      if (!isInitialized) return;
      VN.scheduleRefresh(reason);
    }, MUTATION_REFRESH_DELAY_MS);
  };

  // Mutation Observer logic
  const processNode = (node) => {
    if (node instanceof HTMLVideoElement) {
      scheduleMutationRefresh('mutation:video');
      VN.overlay?.requestPosition?.();
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    const containsVideo = node.childElementCount > 0 && node.querySelector('video');
    if (containsVideo) {
      scheduleMutationRefresh('mutation:container');
      VN.overlay?.requestPosition?.();
      return;
    }

    if (SITE_VARIANT !== 'youtube') return;

    const ytActionsAppeared = (
      node.id === 'top-level-buttons-computed' ||
      node.id === 'actions' ||
      node.id === 'actions-inner' ||
      node.matches?.('ytd-watch-metadata, ytd-menu-renderer') ||
      (node.childElementCount > 0 &&
        node.querySelector?.('#top-level-buttons-computed, #actions, #actions-inner, ytd-segmented-like-dislike-button-renderer'))
    );
    if (ytActionsAppeared) VN.overlay?.requestPosition?.();
  };

  const initMutationObserver = () => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof HTMLVideoElement) {
            scheduleMutationRefresh('mutation:attributes');
            VN.overlay?.requestPosition?.();
            return;
          }

          if (SITE_VARIANT === 'youtube') {
            const target = mutation.target;
            if (target instanceof HTMLElement && (
              target.matches?.('ytd-watch-metadata, ytd-menu-renderer') ||
              target.closest?.('ytd-watch-metadata, ytd-menu-renderer')
            )) {
              VN.overlay?.requestPosition?.();
            }
          }
          return;
        }

        mutation.addedNodes.forEach((node) => {
          processNode(node);
        });

        // Removing the injected SVG does not add a node. Without this, a static
        // playing page keeps a dangling url(#…) until something else refreshes.
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const removedFilter = node.hasAttribute('data-video-enhancer-svg') ||
            (typeof node.id === 'string' && node.id.startsWith('video-enhancer-filter-')) ||
            (node.childElementCount > 0 &&
              node.querySelector('[data-video-enhancer-svg], [id^="video-enhancer-filter-"]'));
          if (removedFilter) scheduleMutationRefresh('mutation:filter-removed');
        });
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

  // Re-evaluate the primary video promptly when playback state changes, so the
  // filter stays on the video the overlay is controlling.
  ['play', 'pause', 'ended'].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      if (!isInitialized) return;
      VN.scheduleRefresh(`video-${eventName}`);
    }, true);
  });

  // Scrolling can reveal a different primary video. Debounce the filter
  // refresh so a scan runs after scrolling settles rather than every frame.
  let viewportRefreshTimer = null;
  const handleViewportChange = () => {
    if (!isInitialized) return;
    if (viewportRefreshTimer) clearTimeout(viewportRefreshTimer);
    viewportRefreshTimer = window.setTimeout(() => {
      viewportRefreshTimer = null;
      VN.scheduleRefresh('viewport-change');
    }, 200);
  };
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);

  const init = async () => {
    await VN.loadPersistedState();

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

  // Listen for messages from popup/background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== 'VIDEO_ENHANCER_TOGGLE_PANEL') return;

      // Acknowledge delivery synchronously. Without this, the callback-form
      // sender sees "The message port closed..." and background.js treats a
      // successful toggle as a missing receiver, re-injecting every frame.
      if (typeof sendResponse === 'function') sendResponse({ ok: true });

      // Only the top frame should toggle the panel; otherwise each iframe can
      // toggle in quick succession causing an open/close "flash".
      let isTopFrame = true;
      try { isTopFrame = window.top === window; } catch (_) { isTopFrame = true; }

      if (!isTopFrame) {
        VN.requestPanelToggleFromFrame?.();
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
