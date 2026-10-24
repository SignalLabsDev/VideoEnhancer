(function(){
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  
  // Prevent re-initialization
  if (VN.filtersInitialized) return;
  VN.filtersInitialized = true;
  
  const { ids } = VN;
  
  // Helper to always get current state
  const getState = () => VN.state;

  const baseKernel = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const sharpenKernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  // CSS-wide keywords, plus filter's own `none`, cannot share a list with
  // functions. `revert-layer` is one of those keywords; leaving it out makes
  // `revert-layer url(#…)` an invalid declaration.
  const FILTER_KEYWORDS = new Set(['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer']);

  const perRootFilters = new WeakMap();
  const shadowRootsWatchingFilter = new WeakSet();
  // Keep observers referenced. A MutationObserver with no external reference can
  // be collected, which would miss a later removal of the SVG.
  const filterRemovalObservers = [];

  const enhancerFilterWasRemoved = (node) => {
    if (!(node instanceof Element)) return false;
    if (node.hasAttribute('data-video-enhancer-svg')) return true;
    if (typeof node.id === 'string' && node.id.startsWith('video-enhancer-filter-')) return true;
    if (node.childElementCount === 0) return false;
    return Boolean(node.querySelector('[data-video-enhancer-svg], [id^="video-enhancer-filter-"]'));
  };

  // documentElement removals are handled in the content script. Shadow roots
  // are outside that observer, and this SVG is parented inside them.
  const watchShadowRootForFilterRemoval = (root) => {
    if (!(root instanceof ShadowRoot) || shadowRootsWatchingFilter.has(root)) return;
    shadowRootsWatchingFilter.add(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (!enhancerFilterWasRemoved(node)) continue;
          VN.scheduleRefresh?.('svg-removed');
          return;
        }
      }
    });
    try {
      observer.observe(root, { childList: true, subtree: true });
      filterRemovalObservers.push(observer);
    } catch (_) {
      shadowRootsWatchingFilter.delete(root);
    }
  };

  const computeKernelString = (amount) => baseKernel
    .map((baseValue, index) => {
      const sharpenValue = sharpenKernel[index];
      const mixed = baseValue + amount * (sharpenValue - baseValue);
      return Number.parseFloat(mixed.toFixed(4));
    })
    .join(' ');

  // A "gamma 1.1" look means brightening midtones. In SVG component-transfer
  // terms that is an exponent of 1 / gamma.
  const computeGammaExponent = (gamma) => {
    const safeGamma = Number.isFinite(gamma) && gamma > 0 ? gamma : 1;
    return Number((1 / safeGamma).toFixed(4));
  };

  const updateGammaForRecord = (record, gamma) => {
    if (!record?.gammaFuncs?.length) return;
    const exponent = String(computeGammaExponent(gamma));
    record.gammaFuncs.forEach((func) => {
      if (func.getAttribute('exponent') !== exponent) {
        func.setAttribute('exponent', exponent);
      }
    });
  };

  const ensureFilterForRoot = (root) => {
    if (!root) return null;
    const cached = perRootFilters.get(root);
    // A page can replace body (or remove the injected SVG). A cached filter that
    // is no longer connected leaves `url(#id)` dangling on the video, so start
    // over rather than reusing a dead record.
    if (cached && cached.filterId && cached.filterNode?.isConnected &&
        cached.convolveNode?.isConnected) return cached;
    if (cached) {
      perRootFilters.delete(root);
      // Drop the stale host so repeated page cleanups do not accumulate SVGs.
      cached.filterNode?.remove?.();
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('data-video-enhancer-svg', '');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.pointerEvents = 'none';

    const defsNode = document.createElementNS(svgNS, 'defs');
    const filter = document.createElementNS(svgNS, 'filter');
    const filterId = `video-enhancer-filter-${Math.random().toString(36).slice(2)}`;
    filter.setAttribute('id', filterId);
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const conv = document.createElementNS(svgNS, 'feConvolveMatrix');
    conv.setAttribute('order', '3');
    conv.setAttribute('kernelMatrix', computeKernelString(getState()?.settings?.sharpen ?? 0.3));
    conv.setAttribute('edgeMode', 'duplicate');

    const transfer = document.createElementNS(svgNS, 'feComponentTransfer');
    const gammaFuncs = ['R', 'G', 'B'].map((channel) => {
      const func = document.createElementNS(svgNS, `feFunc${channel}`);
      func.setAttribute('type', 'gamma');
      func.setAttribute('amplitude', '1');
      func.setAttribute('exponent', String(computeGammaExponent(getState()?.settings?.gamma ?? 1)));
      func.setAttribute('offset', '0');
      transfer.appendChild(func);
      return func;
    });

    filter.appendChild(conv);
    filter.appendChild(transfer);
    defsNode.appendChild(filter);
    svg.appendChild(defsNode);

    try {
      if (root instanceof ShadowRoot) {
        watchShadowRootForFilterRemoval(root);
        root.appendChild(svg);
      } else {
        (document.body || document.documentElement).appendChild(svg);
      }
    } catch (_) {
      try { (document.body || document.documentElement).appendChild(svg); } catch (_) {}
    }

    const record = { filterId, filterNode: svg, convolveNode: conv, gammaFuncs };
    perRootFilters.set(root, record);
    return record;
  };

  const applyFilterToVideo = (video, settings) => {
    if (!(video instanceof HTMLVideoElement)) return;
    const state = getState();
    const root = typeof video.getRootNode === 'function' ? video.getRootNode() : document;
    const record = ensureFilterForRoot(root || document);

    if (!(ids.DATA_ORIGINAL_FILTER_KEY in video.dataset)) {
      video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] = video.style.filter || '';
      video.dataset[ids.DATA_ORIGINAL_FILTER_PRIORITY_KEY] =
        video.style.getPropertyPriority('filter') || '';
    }
    const originalRaw = (video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] || '').trim();
    // A CSS-wide keyword is not a valid item in a filter list; it must be alone.
    // Remember it anyway: a neutral result has to put `none` (or revert-layer)
    // back, because clearing the inline value lets a stylesheet filter show.
    const originalIsKeyword = FILTER_KEYWORDS.has(originalRaw.toLowerCase());
    const originalFilter = originalIsKeyword ? '' : originalRaw;

    const compatibilityMode = state?.compatibilityMode ?? false;
    const needsSvgFilter = settings.sharpen !== 0 || settings.gamma !== 1;
    const allowSvg = !compatibilityMode && needsSvgFilter && record?.filterId && video.dataset.videoEnhancerNoSvg !== '1';

    const buildFilterString = (includeSvg) => {
      const parts = [];
      if (originalFilter) parts.push(originalFilter);
      if (includeSvg) parts.push(`url(#${record.filterId})`);
      if (settings.brightness !== 1) parts.push(`brightness(${Number(settings.brightness.toFixed(2))})`);
      if (settings.contrast !== 1) parts.push(`contrast(${Number(settings.contrast.toFixed(2))})`);
      if (settings.saturation !== 1) parts.push(`saturate(${Number(settings.saturation.toFixed(2))})`);
      // SVG mode applies gamma through feComponentTransfer inside the filter.
      // Compatibility/no-SVG mode keeps a CSS brightness approximation so the
      // control still has an effect there.
      if (!includeSvg && settings.gamma !== 1) {
        const gammaAdjust = Math.pow(settings.gamma, 0.5);
        parts.push(`brightness(${Number(gammaAdjust.toFixed(2))})`);
      }
      return parts.join(' ').trim();
    };

    // setProperty('filter', '', 'important') removes the declaration. That is
    // correct only when the element had no inline filter to begin with.
    const applyInlineFilter = (value) => {
      if (!value) {
        if (originalIsKeyword) {
          const priority = video.dataset[ids.DATA_ORIGINAL_FILTER_PRIORITY_KEY] === 'important'
            ? 'important'
            : '';
          video.style.setProperty('filter', originalRaw, priority);
          return originalRaw;
        }
        video.style.removeProperty('filter');
        return '';
      }
      video.style.setProperty('filter', value, 'important');
      return value;
    };

    let newFilter = buildFilterString(Boolean(allowSvg));

    if (allowSvg && record) {
      const ks = computeKernelString(settings.sharpen);
      // Check actual attribute to ensure Shadow DOM filters are updated
      if (record.convolveNode && record.convolveNode.getAttribute('kernelMatrix') !== ks) {
        try { record.convolveNode.setAttribute('kernelMatrix', ks); } catch (_) {}
      }
      updateGammaForRecord(record, settings.gamma);
    }

    const token = `${settings.sharpen.toFixed(4)}|${settings.contrast.toFixed(4)}|${settings.saturation.toFixed(4)}|${settings.brightness.toFixed(4)}|${settings.gamma.toFixed(4)}|${compatibilityMode}`;
    const previewFilter = newFilter || (originalIsKeyword ? originalRaw : '');
    if (video.dataset[ids.DATA_APPLIED_KEY] === 'true' && video.dataset[ids.DATA_SETTINGS_KEY] === token && video.dataset[ids.DATA_CURRENT_FILTER_KEY] === previewFilter) return;

    let appliedFilter = applyInlineFilter(newFilter);
    if (allowSvg && video.dataset.videoEnhancerNoSvg !== '1') {
      try {
        const applied = window.getComputedStyle(video).filter || '';
        if (!applied.includes('url(')) {
          video.dataset.videoEnhancerNoSvg = '1';
          newFilter = buildFilterString(false);
          appliedFilter = applyInlineFilter(newFilter);
        }
      } catch (_) {}
    }
    video.dataset[ids.DATA_APPLIED_KEY] = 'true';
    video.dataset[ids.DATA_SETTINGS_KEY] = token;
    video.dataset[ids.DATA_CURRENT_FILTER_KEY] = appliedFilter;
  };

  const removeFilterFromVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.dataset[ids.DATA_APPLIED_KEY] !== 'true') return;

    const original = video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] ?? '';
    const priority = video.dataset[ids.DATA_ORIGINAL_FILTER_PRIORITY_KEY] === 'important'
      ? 'important'
      : '';
    if (!original || original.trim() === '') {
      video.style.removeProperty('filter');
    } else {
      video.style.setProperty('filter', original, priority);
    }
    delete video.dataset[ids.DATA_APPLIED_KEY];
    delete video.dataset[ids.DATA_ORIGINAL_FILTER_KEY];
    delete video.dataset[ids.DATA_ORIGINAL_FILTER_PRIORITY_KEY];
    delete video.dataset[ids.DATA_SETTINGS_KEY];
    delete video.dataset[ids.DATA_CURRENT_FILTER_KEY];
    delete video.dataset.videoEnhancerNoSvg;
  };

  const rectIntersectsViewport = (rect) => (
    rect.width > 0 && rect.height > 0 &&
    rect.right > 0 && rect.bottom > 0 &&
    rect.left < window.innerWidth && rect.top < window.innerHeight
  );

  const isVideoEligible = (video, requireVisible) => {
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if ((rect.width * rect.height) < (VN.consts.MIN_TARGET_WIDTH * VN.consts.MIN_TARGET_HEIGHT)) return false;
    if (requireVisible && !rectIntersectsViewport(rect)) return false;

    const style = window.getComputedStyle(video);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };

  const isPlaying = (video) => Boolean(
    video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2
  );

  // Used only before the overlay module exists, or if it has no selector.
  const pickVisiblePrimaryVideo = (videos) => {
    const candidates = [];
    videos.forEach((video) => {
      if (!isVideoEligible(video, true)) return;
      const rect = video.getBoundingClientRect();
      candidates.push({
        video,
        area: rect.width * rect.height,
        playing: isPlaying(video)
      });
    });

    candidates.sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
    return candidates[0]?.video || null;
  };

  // Keep the filter on the same primary video the overlay controls. Using the
  // overlay's selector also handles YouTube's player-only end screen, where the
  // correct behavior is to stop filtering because there is no video element.
  const getPrimaryVideoForFilter = (videos) => {
    if (typeof VN.overlay?.getPrimaryVideo === 'function') {
      const best = VN.overlay.getPrimaryVideo(videos);
      if (best) return best.video instanceof HTMLVideoElement ? best.video : null;

      // The overlay only considers videos intersecting the viewport. Keep the
      // video that already has the filter rather than jumping to an unrelated
      // offscreen candidate; if nothing is applied, apply nothing.
      return videos.find((video) => (
        video.dataset[ids.DATA_APPLIED_KEY] === 'true' && isVideoEligible(video, false)
      )) || null;
    }
    return pickVisiblePrimaryVideo(videos);
  };

  VN.updateAllVideos = (settings) => {
    const videos = VN.collectVideos();
    if (!settings) { videos.forEach(removeFilterFromVideo); return; }

    const target = getPrimaryVideoForFilter(videos);
    if (target && !videos.includes(target)) videos.push(target);

    videos.forEach((video) => {
      if (video === target) {
        applyFilterToVideo(video, settings);
      } else if (video.dataset[ids.DATA_APPLIED_KEY] === 'true') {
        removeFilterFromVideo(video);
      }
    });
  };

  VN.refreshEffect = () => {
    const state = getState();
    if (!state || !state.enabled) { VN.updateAllVideos(null); return; }
    VN.updateAllVideos(state.settings);
  };

  let refreshScheduled = false;
  VN.scheduleRefresh = (reason) => {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      VN.refreshEffect();
    });
  };
})();
