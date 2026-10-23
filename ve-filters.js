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

  let filterNode = null;
  let convolveNode = null;
  const perRootFilters = new WeakMap();
  let lastKernelAmount = null;

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
    if (cached && cached.filterId && cached.convolveNode) return cached;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
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

  VN.ensureFilter = () => {
    if (filterNode && convolveNode) return;
    const record = ensureFilterForRoot(document);
    if (!record) return;
    filterNode = record.filterNode;
    convolveNode = record.convolveNode;
  };

  VN.updateKernel = (amount) => {
    if (!convolveNode) return;
    if (lastKernelAmount !== null && Math.abs(lastKernelAmount - amount) < 0.0001) return;
    const ks = computeKernelString(amount);
    convolveNode.setAttribute('kernelMatrix', ks);
    lastKernelAmount = amount;
  };

  const applyFilterToVideo = (video, settings) => {
    if (!(video instanceof HTMLVideoElement)) return;
    const state = getState();
    const root = typeof video.getRootNode === 'function' ? video.getRootNode() : document;
    const record = ensureFilterForRoot(root || document);
    VN.ensureFilter();

    if (!(ids.DATA_ORIGINAL_FILTER_KEY in video.dataset)) {
      video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] = video.style.filter || '';
    }
    const originalFilter = video.dataset[ids.DATA_ORIGINAL_FILTER_KEY];

    const compatibilityMode = state?.compatibilityMode ?? false;
    const allowSvg = !compatibilityMode && record?.filterId && video.dataset.videoEnhancerNoSvg !== '1';

    const buildFilterString = (includeSvg) => {
      const parts = [];
      if (originalFilter && originalFilter.trim().length > 0) parts.push(originalFilter.trim());
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
    if (video.dataset[ids.DATA_APPLIED_KEY] === 'true' && video.dataset[ids.DATA_SETTINGS_KEY] === token && video.dataset[ids.DATA_CURRENT_FILTER_KEY] === newFilter) return;

    video.style.setProperty('filter', newFilter, 'important');
    if (allowSvg && video.dataset.videoEnhancerNoSvg !== '1') {
      try {
        const applied = window.getComputedStyle(video).filter || '';
        if (!applied.includes('url(')) {
          video.dataset.videoEnhancerNoSvg = '1';
          newFilter = buildFilterString(false);
          video.style.setProperty('filter', newFilter, 'important');
        }
      } catch (_) {}
    }
    video.dataset[ids.DATA_APPLIED_KEY] = 'true';
    video.dataset[ids.DATA_SETTINGS_KEY] = token;
    video.dataset[ids.DATA_CURRENT_FILTER_KEY] = newFilter;
  };

  const removeFilterFromVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.dataset[ids.DATA_APPLIED_KEY] !== 'true') return;

    const original = video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] ?? '';
    if (!original || original.trim() === '') {
      video.style.removeProperty('filter');
    } else {
      video.style.setProperty('filter', original, '');
    }
    delete video.dataset[ids.DATA_APPLIED_KEY];
    delete video.dataset[ids.DATA_ORIGINAL_FILTER_KEY];
    delete video.dataset[ids.DATA_SETTINGS_KEY];
    delete video.dataset[ids.DATA_CURRENT_FILTER_KEY];
    delete video.dataset.videoEnhancerNoSvg;
  };

  // Fallback used only if the overlay module has not initialized yet.
  const pickFallbackPrimaryVideo = () => {
    const minArea = VN.consts.MIN_TARGET_WIDTH * VN.consts.MIN_TARGET_HEIGHT;
    const candidates = [];

    VN.collectVideos().forEach((video) => {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < minArea) return;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return;

      const style = window.getComputedStyle(video);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;

      candidates.push({
        video,
        area,
        playing: Boolean(video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2)
      });
    });

    candidates.sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
    return candidates[0]?.video || null;
  };

  // Keep the filter on the same primary video the overlay controls. Using the
  // overlay's selector also handles YouTube's player-only end screen, where the
  // correct behavior is to stop filtering because there is no video element.
  const getPrimaryVideoForFilter = () => {
    if (typeof VN.overlay?.getPrimaryVideo === 'function') {
      const best = VN.overlay.getPrimaryVideo();
      return best?.video instanceof HTMLVideoElement ? best.video : null;
    }
    return pickFallbackPrimaryVideo();
  };

  VN.updateAllVideos = (settings) => {
    const videos = VN.collectVideos();
    if (!settings) { videos.forEach(removeFilterFromVideo); return; }

    const target = getPrimaryVideoForFilter();

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
    const s = state.settings;
    VN.ensureFilter();
    // updateAllVideos -> applyFilterToVideo now handles kernel updates per-root
    VN.updateAllVideos(s);
    lastKernelAmount = s.sharpen;
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
