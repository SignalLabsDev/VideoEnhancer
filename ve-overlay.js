(() => {
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const overlayApi = {};

  let config = { isEnabled: () => false, onToggle: () => {} };
  let overlayButton = null;
  let toggleButton = null;
  let settingsButton = null;
  let lastVideoRect = null;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let repositionRAF = null;
  let hoverRAF = null;
  let spaHooksInstalled = false;
  let suppressed = false;

  // Site-specific styling
  const ACTIVE_STYLE = { bg: 'rgba(15, 23, 42, 0.9)', color: '#9146ff' };

  const DISABLED_STYLE = { bg: 'rgba(15, 23, 42, 0.9)', color: 'rgba(145, 70, 255, 0.4)' };

  const applyButtonStyle = (btn, style) => {
    btn.style.setProperty('background-image', 'none', 'important');
    btn.style.setProperty('background-color', style.bg, 'important');
    btn.style.setProperty('color', style.color, 'important');
    btn.style.setProperty('border-color', 'transparent', 'important');
  };

  const hideOverlay = () => {
    if (!overlayButton) return;
    overlayButton.style.visibility = 'hidden';
    overlayButton.style.opacity = '0';
    overlayButton.style.pointerEvents = 'none';
  };

  const getMinTargetSize = () => {
    const c = VN?.consts;
    return {
      w: typeof c?.MIN_TARGET_WIDTH === 'number' ? c.MIN_TARGET_WIDTH : 320,
      h: typeof c?.MIN_TARGET_HEIGHT === 'number' ? c.MIN_TARGET_HEIGHT : 180
    };
  };

  const collectVideosDeep = () => {
    const found = [];
    const stack = [document.documentElement];
    const seen = new Set();

    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);

      if (node instanceof HTMLVideoElement) {
        found.push(node);
        continue;
      }

      if (node instanceof Element) {
        const sr = node.shadowRoot;
        if (sr && sr.mode === 'open') {
          stack.push(sr);
        }
      }

      if (node instanceof DocumentFragment || node instanceof Element || node instanceof Document) {
        const children = node.childNodes;
        if (children && children.length) {
          for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
        }
      }
    }

    return found;
  };

  const getPrimaryVideo = () => {
    const min = getMinTargetSize();
    const minArea = min.w * min.h;
    let best = null, bestArea = 0;
    collectVideosDeep().forEach((v) => {
      const rect = v.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      if ((rect.width * rect.height) < minArea) return;
      const cs = window.getComputedStyle(v);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      const area = rect.width * rect.height;
      if (area > bestArea) { best = { video: v, rect }; bestArea = area; }
    });
    return best;
  };

  const updateHoverState = () => {
    if (!overlayButton || suppressed || !lastVideoRect) { hideOverlay(); return; }
    const r = lastVideoRect;
    const inside = lastMouseX >= r.left && lastMouseX <= r.right && lastMouseY >= r.top && lastMouseY <= r.bottom;
    overlayButton.style.opacity = inside ? '1' : '0';
    overlayButton.style.pointerEvents = inside ? 'auto' : 'none';
  };

  const positionOverlay = () => {
    if (!overlayButton || suppressed) { lastVideoRect = null; hideOverlay(); return; }
    const best = getPrimaryVideo();
    if (!best) { lastVideoRect = null; hideOverlay(); return; }
    lastVideoRect = best.rect;
    const margin = 8;
    overlayButton.style.top = `${Math.max(margin, best.rect.top + margin)}px`;
    overlayButton.style.right = `${Math.max(margin, window.innerWidth - best.rect.right + margin)}px`;
    overlayButton.style.visibility = 'visible';
    updateHoverState();
  };

  const requestPosition = () => {
    if (repositionRAF) return;
    repositionRAF = requestAnimationFrame(() => { repositionRAF = null; positionOverlay(); });
  };

  const updateButtonStyles = () => {
    if (!toggleButton || !settingsButton || suppressed) return;

    // Settings button always uses active style
    applyButtonStyle(settingsButton, ACTIVE_STYLE);

    // Toggle button reflects enabled state
    applyButtonStyle(toggleButton, config.isEnabled() ? ACTIVE_STYLE : DISABLED_STYLE);
  };

  const createOverlay = () => {
    overlayButton = document.createElement('div');
    overlayButton.id = 'video-enhancer-inline-toggle';
    overlayButton.style.cssText = `
      position: fixed !important; z-index: 2147483646 !important;
      top: -9999px; right: -9999px; height: 38px;
      display: inline-flex; align-items: center; gap: 6px;
      visibility: hidden; opacity: 0; pointer-events: none;
      transition: opacity 120ms ease;
    `;

    const btnStyle = `
      width: 38px; height: 38px; padding: 0;
      box-sizing: border-box;
      border: 1px solid transparent; border-radius: 11px;
      display: inline-flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 20px; font-weight: 700;
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

    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.style.cssText = btnStyle;
    toggleButton.appendChild(createIconSpan('⏻', { bold: true }));
    toggleButton.onclick = (e) => { e.stopPropagation(); config.onToggle(); updateButtonStyles(); };

    settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.style.cssText = btnStyle;
    settingsButton.appendChild(createIconSpan('⚙', { large: true }));
    settingsButton.onclick = (e) => {
      e.stopPropagation();
      try {
        if (window.top !== window) {
          window.top.postMessage({ __videoEnhancer: true, type: 'VIDEO_ENHANCER_TOGGLE_PANEL' }, '*');
          return;
        }
      } catch (_) {}
      VN.panel?.toggle?.();
    };

    overlayButton.append(toggleButton, settingsButton);
    (document.body || document.documentElement).appendChild(overlayButton);
  };

  const ensureOverlay = () => {
    if (suppressed) { hideOverlay(); return null; }
    if (!overlayButton) createOverlay();
    updateButtonStyles();
    positionOverlay();
    return overlayButton;
  };

  const onMouseMove = (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (hoverRAF) return;
    hoverRAF = requestAnimationFrame(() => { hoverRAF = null; updateHoverState(); });
  };

  const onUrlChange = () => {
    lastVideoRect = null;
    ensureOverlay();
    // Poll briefly for delayed video rendering in SPAs
    let attempts = 0;
    const poll = setInterval(() => {
      if (++attempts >= 10 || getPrimaryVideo()) { clearInterval(poll); ensureOverlay(); }
    }, 500);
  };

  const installSpaHooks = () => {
    if (spaHooksInstalled) return;
    spaHooksInstalled = true;

    const wrap = (fn) => function() { const r = fn.apply(this, arguments); onUrlChange(); return r; };
    if (typeof history.pushState === 'function') history.pushState = wrap(history.pushState);
    if (typeof history.replaceState === 'function') history.replaceState = wrap(history.replaceState);

    const events = ['popstate', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start'];
    events.forEach((evt) => window.addEventListener(evt, onUrlChange));
  };

  const attachListeners = () => {
    window.addEventListener('scroll', requestPosition, true);
    window.addEventListener('resize', requestPosition);
    window.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('fullscreenchange', requestPosition, true);
  };

  overlayApi.init = (options = {}) => {
    config = { ...config, ...options };
    installSpaHooks();
    attachListeners();
    if (!suppressed) ensureOverlay();

    // Watchdog for missed SPA events
    setInterval(() => { if (!suppressed && getPrimaryVideo()) ensureOverlay(); }, 2000);
  };

  overlayApi.ensure = ensureOverlay;
  overlayApi.updateState = updateButtonStyles;
  overlayApi.requestPosition = requestPosition;
  overlayApi.setSuppressed = (value) => {
    const next = Boolean(value);
    if (next === suppressed) return;
    suppressed = next;
    suppressed ? hideOverlay() : ensureOverlay();
  };

  VN.overlay = overlayApi;
})();
