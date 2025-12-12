(() => {
  if (window.videoEnhancerInitialized) return;
  window.videoEnhancerInitialized = true;

  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const { state } = VN;

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
    if (document.hidden) {
      if (state.enabled) {
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
    
    // Initialize Overlay
    if (VN.overlay?.init) {
      VN.overlay.init({
        isEnabled: () => state.enabled,
        onToggle: () => {
          const willEnable = !state.enabled;
          try {
            if (window.top !== window) {
              window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_STATE_PATCH', patch: { enabled: willEnable } }, '*');
              return;
            }
          } catch (_) {}
          state.enabled = willEnable;
          VN.panel?.syncUI?.();
          VN.schedulePersist('inline-toggle');
          VN.scheduleRefresh('inline-toggle');
          VN.panel?.broadcastState?.();
        }
      });
      VN.overlay.setSuppressed?.(!state.overlayEnabled);
    }

    // Initialize Panel
    VN.panel?.ensure();
    VN.panel?.syncUI();

    initMutationObserver();
    VN.refreshEffect();
  };

  // Listen for messages from popup/background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'VIDEO_ENHANCER_TOGGLE_PANEL') {
        VN.panel?.setVisible(!state.panelVisible);
      }
    });
  }

  const runInit = () => {
    init().catch((error) => {
      console.error('[VideoEnhancer] Init error', error);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit, { once: true });
  } else {
    runInit();
  }
})();
