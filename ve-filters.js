(function(){
  const VN = window.VideoEnhancer || (window.VideoEnhancer = {});
  const { ids, state, consts } = VN;

  const baseKernel = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const sharpenKernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  let filterNode = null;
  let convolveNode = null;
  let lastKernelAmount = null;

  const computeKernelString = (amount) => baseKernel
    .map((baseValue, index) => {
      const sharpenValue = sharpenKernel[index];
      const mixed = baseValue + amount * (sharpenValue - baseValue);
      return Number.parseFloat(mixed.toFixed(4));
    })
    .join(' ');

  VN.ensureFilter = () => {
    if (filterNode && convolveNode) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    filterNode = document.createElementNS(svgNS, 'svg');
    filterNode.setAttribute('aria-hidden', 'true');
    filterNode.setAttribute('focusable', 'false');
    filterNode.style.position = 'absolute';
    filterNode.style.width = '0';
    filterNode.style.height = '0';
    filterNode.style.pointerEvents = 'none';

    const defsNode = document.createElementNS(svgNS, 'defs');
    const filter = document.createElementNS(svgNS, 'filter');
    filter.setAttribute('id', ids.FILTER_ID);
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    convolveNode = document.createElementNS(svgNS, 'feConvolveMatrix');
    convolveNode.setAttribute('order', '3');
    convolveNode.setAttribute('kernelMatrix', computeKernelString(state.settings.sharpen));
    convolveNode.setAttribute('edgeMode', 'duplicate');

    filter.appendChild(convolveNode);
    defsNode.appendChild(filter);
    filterNode.appendChild(defsNode);

    (document.body || document.documentElement).appendChild(filterNode);
  };

  VN.updateKernel = (amount) => {
    if (!convolveNode) return;
    if (lastKernelAmount !== null && Math.abs(lastKernelAmount - amount) < 0.0001) return;
    convolveNode.setAttribute('kernelMatrix', computeKernelString(amount));
    lastKernelAmount = amount;
  };

  const applyFilterToVideo = (video, settings) => {
    if (!(video instanceof HTMLVideoElement)) return;
    VN.ensureFilter();

    if (!(ids.DATA_ORIGINAL_FILTER_KEY in video.dataset)) {
      video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] = video.style.filter || '';
    }
    const originalFilter = video.dataset[ids.DATA_ORIGINAL_FILTER_KEY];

    const filterParts = [];
    if (originalFilter && originalFilter.trim().length > 0) filterParts.push(originalFilter.trim());
    if (settings.brightness !== 1) filterParts.push(`brightness(${Number(settings.brightness.toFixed(2))})`);
    if (settings.contrast !== 1) filterParts.push(`contrast(${Number(settings.contrast.toFixed(2))})`);
    if (settings.saturation !== 1) filterParts.push(`saturate(${Number(settings.saturation.toFixed(2))})`);
    if (settings.gamma !== 1) {
      const gammaAdjust = Math.pow(settings.gamma, 0.5);
      filterParts.push(`brightness(${Number(gammaAdjust.toFixed(2))})`);
    }
    if (!state.compatibilityMode) filterParts.push(`url(#${ids.FILTER_ID})`);

    const newFilter = filterParts.join(' ').trim();
    const token = `${settings.sharpen.toFixed(4)}|${settings.contrast.toFixed(4)}|${settings.saturation.toFixed(4)}|${settings.brightness.toFixed(4)}|${settings.gamma.toFixed(4)}|${state.compatibilityMode}`;
    if (video.dataset[ids.DATA_APPLIED_KEY] === 'true' && video.dataset[ids.DATA_SETTINGS_KEY] === token && video.dataset[ids.DATA_CURRENT_FILTER_KEY] === newFilter) return;

    video.style.filter = newFilter;
    video.dataset[ids.DATA_APPLIED_KEY] = 'true';
    video.dataset[ids.DATA_SETTINGS_KEY] = token;
    video.dataset[ids.DATA_CURRENT_FILTER_KEY] = newFilter;
  };

  const removeFilterFromVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.dataset[ids.DATA_APPLIED_KEY] !== 'true') return;

    const original = video.dataset[ids.DATA_ORIGINAL_FILTER_KEY] ?? '';
    video.style.filter = original;
    if (!original || original.trim() === '') video.style.removeProperty('filter');
    delete video.dataset[ids.DATA_APPLIED_KEY];
    delete video.dataset[ids.DATA_ORIGINAL_FILTER_KEY];
    delete video.dataset[ids.DATA_SETTINGS_KEY];
    delete video.dataset[ids.DATA_CURRENT_FILTER_KEY];
  };

  const collectVideos = () => Array.from(document.querySelectorAll('video')).filter((n) => n instanceof HTMLVideoElement);

  VN.updateAllVideos = (settings) => {
    const videos = collectVideos();
    if (!settings) { videos.forEach(removeFilterFromVideo); return; }

    const eligible = videos.filter((v)=>{ const r=v.getBoundingClientRect(); return r.width>=consts.MIN_TARGET_WIDTH && r.height>=consts.MIN_TARGET_HEIGHT; });
    const target = eligible.length ? new Set(eligible) : new Set([videos.sort((a,b)=>{const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect(); return (rb.width*rb.height)-(ra.width*ra.height);})[0]].filter(Boolean));
    videos.forEach((v)=>{ if (target.size===0 || target.has(v)) applyFilterToVideo(v, settings); else if (v.dataset[ids.DATA_APPLIED_KEY]==='true') removeFilterFromVideo(v); });
  };

  VN.refreshEffect = () => {
    if (!state.enabled) { VN.updateAllVideos(null); return; }
    const s = state.settings; VN.ensureFilter(); VN.updateKernel(s.sharpen); VN.updateAllVideos(s);
  };
})();
