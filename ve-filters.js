(function(){
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const { ids, state, consts } = VN;

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
    conv.setAttribute('kernelMatrix', computeKernelString(state.settings.sharpen));
    conv.setAttribute('edgeMode', 'duplicate');

    filter.appendChild(conv);
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

    const record = { filterId, filterNode: svg, convolveNode: conv };
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
    const root = typeof video.getRootNode === 'function' ? video.getRootNode() : document;
    const record = ensureFilterForRoot(root || document);
    VN.ensureFilter();

    if (!(ids.DATA_ORIGINAL_FILTER_KEY in video.dataset)) {
      video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] = video.style.filter || '';
    }
    const originalFilter = video.dataset[ids.DATA_ORIGINAL_FILTER_KEY];

    const allowSvg = !state.compatibilityMode && record?.filterId && video.dataset.videoEnhancerNoSvg !== '1';

    const buildFilterString = (includeSvg) => {
      const parts = [];
      if (originalFilter && originalFilter.trim().length > 0) parts.push(originalFilter.trim());
      if (includeSvg) parts.push(`url(#${record.filterId})`);
      if (settings.brightness !== 1) parts.push(`brightness(${Number(settings.brightness.toFixed(2))})`);
      if (settings.contrast !== 1) parts.push(`contrast(${Number(settings.contrast.toFixed(2))})`);
      if (settings.saturation !== 1) parts.push(`saturate(${Number(settings.saturation.toFixed(2))})`);
      if (settings.gamma !== 1) {
        const gammaAdjust = Math.pow(settings.gamma, 0.5);
        parts.push(`brightness(${Number(gammaAdjust.toFixed(2))})`);
      }
      return parts.join(' ').trim();
    };

    let newFilter = buildFilterString(Boolean(allowSvg));

    if (allowSvg && record?.convolveNode && lastKernelAmount !== settings.sharpen) {
      try { record.convolveNode.setAttribute('kernelMatrix', computeKernelString(settings.sharpen)); } catch (_) {}
    }

    const token = `${settings.sharpen.toFixed(4)}|${settings.contrast.toFixed(4)}|${settings.saturation.toFixed(4)}|${settings.brightness.toFixed(4)}|${settings.gamma.toFixed(4)}|${state.compatibilityMode}`;
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

  const collectVideos = () => {
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

  VN.updateAllVideos = (settings) => {
    const videos = collectVideos();
    if (!settings) { videos.forEach(removeFilterFromVideo); return; }

    const minArea = consts.MIN_TARGET_WIDTH * consts.MIN_TARGET_HEIGHT;
    const eligible = videos.filter((v)=>{
      const r = v.getBoundingClientRect();
      return (r.width * r.height) >= minArea;
    });
    const target = eligible.length ? new Set(eligible) : new Set([videos.sort((a,b)=>{const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect(); return (rb.width*rb.height)-(ra.width*ra.height);})[0]].filter(Boolean));
    videos.forEach((v)=>{ if (target.size===0 || target.has(v)) applyFilterToVideo(v, settings); else if (v.dataset[ids.DATA_APPLIED_KEY]==='true') removeFilterFromVideo(v); });
  };

  VN.refreshEffect = () => {
    if (!state.enabled) { VN.updateAllVideos(null); return; }
    const s = state.settings; VN.ensureFilter(); VN.updateKernel(s.sharpen); VN.updateAllVideos(s);
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
