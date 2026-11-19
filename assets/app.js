/* =========================================================
   红翠斗芳菲 · 宋元明漆器虚拟展厅
   ========================================================= */
(() => {
  'use strict';

  const DATA = window.MUSEUM_DATA;
  if (!DATA || !Array.isArray(DATA.rooms)) {
    document.body.innerHTML = '<p style="color:#e8dcc4;font-family:serif;padding:40px">展品数据加载失败。</p>';
    return;
  }

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const pad2 = n => String(n).padStart(2, '0');
  const isMobileLayout = () => window.innerWidth <= 720;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const FLAT = [];
  DATA.rooms.forEach((room, ri) => {
    room.exhibits.forEach((ex, ei) => {
      FLAT.push({ room, ri, ex, ei, global: FLAT.length + 1 });
    });
  });

  const TAG_KIND_LABEL = { style: '工艺', subject: '题材', script: '器型', type: '门类', material: '材质' };
  const TAG_WIKI_FROM_DATA = {};
  DATA.rooms.forEach(room => (room.knowledge || []).forEach(k => {
    if (!TAG_WIKI_FROM_DATA[k.term]) TAG_WIKI_FROM_DATA[k.term] = k.text;
  }));
  function tagWikiText(name) {
    if (TAG_WIKI_FROM_DATA[name]) return TAG_WIKI_FROM_DATA[name];
    if (DATA.tagWiki && DATA.tagWiki[name]) return DATA.tagWiki[name];
    return `“${name}”是本展用于概括该作品特征的标签。`;
  }

  const STORAGE_KEY = 'hongcui-museum-visited-v1';
  const state = {
    started: false,
    roomIndex: 0,
    panX: 0,
    targetPan: 0,
    panRaf: 0,
    dragging: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartPan: 0,
    dragLastX: 0,
    dragLastT: 0,
    dragVelocity: 0,
    visited: new Set(),
    detail: null,
    detailFromCatalog: false,
    overlay: null,
    catalogFilter: 'all',
    catalogQuery: '',
    catalogScroll: 0,
    artworks: [],
    wallMax: 0,
    pointerX: null,
    depthRaf: 0,
    viewer: {
      natW: 1, natH: 1, fit: 1, scale: 1, x: 0, y: 0,
      mode: 'all', dragging: false, startX: 0, startY: 0, origX: 0, origY: 0,
      fullscreen: false, pointers: new Map(), pinch: null
    }
  };

  const preloaded = new Set();
  let toastTimer = 0;
  let loadingDone = false;
  let mobileHintShown = false;
  let mobileViewerHintShown = false;

  /* ---------- 古琴背景音乐（程序化生成，无外部音频文件） ---------- */
  const MUSIC_KEY = 'hongcui-music-on';
  const music = {
    on: false,
    ctx: null,
    master: null,
    bus: null,
    dry: null,
    convolver: null,
    timer: 0,
    scoreStart: 0,
    cursor: 0,
    started: false
  };

  function loadMusicPref() {
    try {
      const stored = localStorage.getItem(MUSIC_KEY);
      music.on = stored === null ? true : stored === '1';
    } catch (e) {
      music.on = true;
    }
    updateMusicButtons();
  }
  function saveMusicPref() {
    try { localStorage.setItem(MUSIC_KEY, music.on ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  function updateMusicButtons() {
    $$('.music-btn').forEach(btn => {
      btn.classList.toggle('playing', music.on);
      btn.setAttribute('aria-pressed', music.on ? 'true' : 'false');
      btn.title = music.on ? '关闭背景音乐 · 古琴《高山流水》' : '开启背景音乐 · 古琴《高山流水》';
    });
  }
  function makeImpulse(ctx, duration, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buffer;
  }
  function ensureMusic() {
    if (music.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.3;
    bus.connect(compressor);
    compressor.connect(master);
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 4.0, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.48;
    convolver.connect(wet);
    wet.connect(bus);
    const dry = ctx.createGain();
    dry.gain.value = 0.66;
    dry.connect(bus);
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 260;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 1;
    droneFilter.connect(droneGain);
    droneGain.connect(dry);
    droneGain.connect(convolver);
    [87.31, 130.81].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i ? 0.006 : 0.012;
      osc.connect(g);
      g.connect(droneFilter);
      osc.start();
    });
    music.ctx = ctx;
    music.master = master;
    music.bus = bus;
    music.dry = dry;
    music.convolver = convolver;
    return true;
  }
  /* 古琴曲《高山流水》主题（F 宫五声，程序化演奏）
     取《流水》以徵音 C 起句、F 宫五声音阶与“滚拂”水势的意趣，
     以散音、按音、泛音与吟猱等古琴技法合成，无外部音频文件。 */
  const GQ = {
    C2: 65.41, F2: 87.31, G2: 98.0,
    C3: 130.81, D3: 146.83, F3: 174.61, G3: 196.0, A3: 220.0,
    C4: 261.63, D4: 293.66, F4: 349.23, G4: 392.0, A4: 440.0,
    C5: 523.25, D5: 587.33, F5: 698.46, G5: 783.99, A5: 880.0
  };
  const SCORE_LOOP = 46;
  const GUQIN_SCORE = [];
  function gq(t, f, d, v, opt = {}) {
    GUQIN_SCORE.push({ t, f: GQ[f] || f, d, v, ...opt });
  }
  function gqRun(start, names, step, vol) {
    names.forEach((name, i) => gq(start + i * step, name, 0.5, vol, { roll: true }));
  }
  // 引子：散音起句，泛音点缀
  gq(0.0, 'C3', 6.0, 0.17, { open: true });
  gq(0.7, 'C2', 5.0, 0.08, { open: true });
  gq(1.8, 'C5', 2.2, 0.045, { harmonic: true });
  gq(2.9, 'G4', 2.6, 0.09, { slideDown: true });
  gq(4.2, 'A3', 2.4, 0.09);
  gq(5.2, 'G3', 3.0, 0.08);
  gq(6.4, 'C4', 3.4, 0.11, { slideUp: true });
  gq(7.6, 'D4', 2.0, 0.07);
  // 高山：舒缓的主题
  gq(8.6, 'F4', 2.4, 0.13, { accent: true });
  gq(8.62, 'F3', 3.6, 0.05);
  gq(9.6, 'G4', 1.8, 0.09);
  gq(10.6, 'A4', 2.8, 0.11);
  gq(11.9, 'C5', 2.2, 0.085);
  gq(11.92, 'C4', 3.0, 0.04);
  gq(12.9, 'A4', 2.2, 0.08);
  gq(13.9, 'G4', 2.6, 0.09);
  gq(14.9, 'F4', 3.4, 0.12);
  gq(14.92, 'F3', 4.0, 0.05);
  gq(16.3, 'C4', 3.0, 0.09);
  gq(17.3, 'D4', 2.2, 0.085);
  gq(18.3, 'F4', 2.6, 0.10);
  gq(19.3, 'G4', 3.2, 0.08);
  // 流水：滚拂与按音交替，摹水势回环
  gq(20.5, 'C3', 2.4, 0.08, { accent: true });
  gqRun(20.5, ['C3', 'G3', 'C4', 'D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'C5', 'A4', 'G4', 'F4', 'D4', 'C4', 'G3'], 0.105, 0.045);
  gq(21.4, 'F4', 1.8, 0.05);
  gq(22.3, 'C5', 2.2, 0.065);
  gq(23.2, 'A4', 1.8, 0.055);
  gq(24.0, 'F3', 2.0, 0.07);
  gqRun(24.0, ['F5', 'D5', 'C5', 'A4', 'G4', 'F4', 'D4', 'C4', 'A3', 'G3', 'F3', 'D3', 'C3'], 0.115, 0.048);
  gq(25.6, 'D4', 1.6, 0.05);
  gq(26.8, 'F4', 2.6, 0.07);
  gqRun(26.8, ['C4', 'F4', 'A4', 'C5', 'F5', 'C5', 'A4', 'F4'], 0.145, 0.05);
  gq(28.6, 'D5', 2.0, 0.06);
  gq(29.6, 'D4', 2.0, 0.06);
  gqRun(29.6, ['D5', 'C5', 'A4', 'G4', 'F4', 'D4', 'C4', 'A3', 'G3', 'C3'], 0.125, 0.045);
  gq(31.2, 'C5', 2.2, 0.05, { harmonic: true });
  gq(32.2, 'A4', 2.4, 0.045, { harmonic: true });
  gq(33.2, 'G4', 2.0, 0.055);
  // 尾声：泛音与散音渐远
  gq(34.0, 'F4', 3.0, 0.09);
  gq(35.2, 'G4', 2.4, 0.07);
  gq(36.2, 'A4', 2.2, 0.06);
  gq(37.2, 'C5', 3.0, 0.05, { harmonic: true });
  gq(38.4, 'C4', 3.0, 0.07);
  gq(39.6, 'F3', 3.4, 0.06);
  gq(40.8, 'C3', 5.0, 0.13, { open: true });
  gq(41.0, 'C5', 1.8, 0.035, { harmonic: true });

  function guqin(freq, time, dur, vol, opt = {}) {
    const ctx = music.ctx;
    if (!ctx) return;
    const harmonic = !!opt.harmonic;
    const decay = harmonic ? 3.0 : opt.roll ? 1.5 : Math.max(2.6, dur + 2.2);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, time);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0003, vol), time + 0.008);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.55), time + 0.22);
    out.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.6;
    tone.frequency.setValueAtTime(harmonic ? 4200 : 2400, time);
    tone.frequency.exponentialRampToValueAtTime(harmonic ? 1600 : 650, time + Math.min(decay, 2.4));
    out.connect(tone);
    tone.connect(music.dry);
    tone.connect(music.convolver);
    const partials = harmonic
      ? [[1, 0.82, 'sine'], [2, 0.14, 'sine']]
      : [[1, 0.78, 'triangle'], [2, 0.13, 'sine'], [3, 0.045, 'sine']];
    partials.forEach(([ratio, amp, type], idx) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const base = freq * ratio;
      osc.frequency.setValueAtTime(base, time);
      if (!harmonic && idx === 0) {
        if (opt.slideUp) {
          osc.frequency.setValueAtTime(base * 0.94, time);
          osc.frequency.exponentialRampToValueAtTime(base, time + 0.22);
        } else if (opt.slideDown) {
          osc.frequency.setValueAtTime(base * 1.045, time);
          osc.frequency.exponentialRampToValueAtTime(base, time + 0.24);
        }
      }
      let lfo = null;
      if (!harmonic && idx === 0 && dur > 1.4) {
        lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 4.4 + Math.random() * 1.2;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = freq * 0.0035;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
      }
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g);
      g.connect(out);
      osc.start(time);
      osc.stop(time + decay + 0.15);
      if (lfo) {
        lfo.start(time + 0.35);
        lfo.stop(time + decay);
      }
    });
    // 指甲触弦的细微噪声
    const nlen = Math.max(1, Math.floor(ctx.sampleRate * 0.045));
    const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
    const noise = ctx.createBufferSource();
    noise.buffer = nbuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = harmonic ? 3200 : 1700;
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(Math.max(0.0002, vol * 0.16), time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(music.dry);
    noise.start(time);
    noise.stop(time + 0.06);
  }
  function scheduleMusic() {
    if (!music.on || !music.started || !music.ctx) return;
    const ctx = music.ctx;
    if (ctx.state !== 'running') {
      music.timer = setTimeout(scheduleMusic, 500);
      return;
    }
    if (ctx.currentTime - music.scoreStart > SCORE_LOOP * 3) {
      music.scoreStart = ctx.currentTime + 0.4;
      music.cursor = 0;
    }
    const horizon = ctx.currentTime + 2.4;
    let guard = 0;
    while (guard++ < 500) {
      if (music.cursor >= GUQIN_SCORE.length) {
        music.scoreStart += SCORE_LOOP;
        music.cursor = 0;
      }
      const ev = GUQIN_SCORE[music.cursor];
      const at = music.scoreStart + ev.t;
      if (at > horizon) break;
      if (at >= ctx.currentTime - 0.08) guqin(ev.f, at, ev.d, ev.v, ev);
      music.cursor += 1;
    }
    music.timer = setTimeout(scheduleMusic, 350);
  }
  function startMusic() {
    if (!music.on) return;
    if (!ensureMusic()) {
      music.on = false;
      saveMusicPref();
      updateMusicButtons();
      toast('当前浏览器不支持背景音乐');
      return;
    }
    const ctx = music.ctx;
    ctx.resume().then(() => {
      music.started = true;
      const now = ctx.currentTime;
      music.master.gain.cancelScheduledValues(now);
      music.master.gain.setValueAtTime(Math.max(0.0001, music.master.gain.value), now);
      music.master.gain.exponentialRampToValueAtTime(0.78, now + 1.8);
      music.scoreStart = now + 0.6;
      music.cursor = 0;
      clearTimeout(music.timer);
      scheduleMusic();
    }).catch(() => { /* ignore */ });
  }
  function stopMusic() {
    clearTimeout(music.timer);
    music.timer = 0;
    music.started = false;
    if (!music.ctx) return;
    const ctx = music.ctx;
    const now = ctx.currentTime;
    music.master.gain.cancelScheduledValues(now);
    music.master.gain.setValueAtTime(Math.max(0.0001, music.master.gain.value), now);
    music.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    setTimeout(() => { if (!music.on && music.ctx) music.ctx.suspend(); }, 900);
  }
  function toggleMusic() {
    music.on = !music.on;
    saveMusicPref();
    updateMusicButtons();
    if (music.on) startMusic(); else stopMusic();
    toast(music.on ? '古琴《高山流水》已开启' : '背景音乐已关闭');
  }

  /* ---------- 本地进度 ---------- */
  function loadVisited() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      const valid = new Set(FLAT.map(f => f.ex.id));
      if (Array.isArray(arr)) arr.forEach(id => { if (valid.has(id)) state.visited.add(id); });
    } catch (e) { /* ignore */ }
  }
  function saveVisited() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(state.visited))); } catch (e) { /* ignore */ }
  }
  function markVisited(id) {
    if (!id || state.visited.has(id)) return;
    state.visited.add(id);
    saveVisited();
    updateProgress();
    updateRoute();
    $$('.artwork').forEach(el => { if (el.dataset.id === id) el.classList.add('visited'); });
    $$('.cat-card').forEach(el => { if (el.dataset.id === id) el.classList.add('visited'); });
  }

  /* ---------- 尺寸 ---------- */
  // 本项目没有需要横置的长卷或册页
  const HORIZONTAL_ALBUMS = new Set();
  const isHorizontalWork = ex => ex.isScroll || HORIZONTAL_ALBUMS.has(ex.id);
  function frameSize(ex) {
    const img = ex.hero || { w: 1000, h: 1000 };
    const w = img.w || 1000;
    const h = img.h || 1000;
    const r = w / h;
    const desktop = !isMobileLayout();
    let fw, fh, scrollH = false;
    if (isHorizontalWork(ex) && r < 1) {
      fw = desktop ? 620 : 520;
      fh = desktop ? 230 : 200;
      scrollH = true;
    } else if (r >= 3) { fw = 540; fh = 200; }
    else if (r >= 1.6) { fw = 440; fh = 270; }
    else if (r >= 1.15) { fw = 380; fh = 300; }
    else if (r >= 0.85) { fw = 330; fh = 340; }
    else if (r >= 0.6) { fw = 300; fh = 400; }
    else if (r >= 0.35) { fw = 280; fh = 430; }
    else { fw = 210; fh = 500; }
    const vhScale = clamp((window.innerHeight - 150) / 660, 0.6, 1);
    fw = Math.round(fw * vhScale);
    fh = Math.round(fh * vhScale);
    if (isMobileLayout()) { fw = Math.round(fw * 0.66); fh = Math.round(fh * 0.66); }
    return { w: fw, h: fh, r, scrollH };
  }
  function objectPosition(img) {
    const r = (img.w || 1) / (img.h || 1);
    if (r <= 0.35) return 'center 16%';
    if (r <= 0.6) return 'center 30%';
    return 'center 42%';
  }

  /* ---------- 入口 ---------- */
  function initIntro() {
    const picks = [
      { id: 'e052', pos: 'center 42%' },
      { id: 'e064', pos: 'center 50%' },
      { id: 'e086', pos: 'center 45%' }
    ];
    const imgs = $$('.float-frame img');
    picks.forEach((pick, i) => {
      const item = FLAT.find(f => f.ex.id === pick.id);
      if (item && imgs[i]) {
        imgs[i].referrerPolicy = 'no-referrer';
        imgs[i].style.objectPosition = pick.pos;
        imgs[i].src = item.ex.hero.src;
      }
    });
    const bg = FLAT.find(f => f.ex.id === 'e050') || FLAT[0];
    if (bg) $('#introBgImg').src = bg.ex.hero.src;
  }

  function renderRoutes() {
    const route = $('#roomRoute');
    const guide = $('#guideRoute');
    DATA.rooms.forEach((room, i) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'route-node';
      node.dataset.index = String(i);
      node.innerHTML = `<div class="rn-top"><span>${pad2(i + 1)}</span><i></i></div><span class="rn-title">${esc(room.title)}</span>`;
      node.addEventListener('click', () => enterRoom(i, true, 'start'));
      route.appendChild(node);

      const g = document.createElement('div');
      g.innerHTML = `<b>${pad2(i + 1)}</b><br>${esc(room.title)}`;
      guide.appendChild(g);
    });
  }

  function updateProgress() {
    const total = DATA.meta.total || 1;
    const n = state.visited.size;
    $('#progressText').textContent = `${n} / ${total}`;
    $('#progressBar').style.width = `${(n / total) * 100}%`;
  }

  function updateRoute() {
    $$('.route-node').forEach((node, i) => {
      const room = DATA.rooms[i];
      node.classList.toggle('active', i === state.roomIndex);
      node.classList.toggle('visited', room.exhibits.some(ex => state.visited.has(ex.id)));
    });
    if (isMobileLayout()) {
      const active = $('.route-node.active', $('#roomRoute'));
      if (active) {
        requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest', inline: 'center' }));
      }
    }
  }

  function updateTop() {
    const room = DATA.rooms[state.roomIndex];
    $('#roomChapter').textContent = `${room.chapter} · ${pad2(state.roomIndex + 1)} / ${DATA.meta.roomCount}`;
    $('#roomTitle').innerHTML = `<span>${esc(room.title)}</span><span class="room-sub-label"> · ${esc(room.subtitle)}</span>`;
    updateProgress();
    updateRoute();
  }

  /* ---------- 展厅 ---------- */
  function buildRoomTitlePanel(room, index) {
    const el = document.createElement('div');
    el.className = 'room-title-panel';
    const terms = room.knowledge.length
      ? `<div class="rt-terms">${room.knowledge.map(k => `<span>${esc(k.term)}</span>`).join('')}</div>`
      : '';
    el.innerHTML = `
      <p class="rt-chapter">${esc(room.chapter)}</p>
      <h2 class="rt-title">${esc(room.title)}</h2>
      <p class="rt-sub">${esc(room.subtitle)}</p>
      <p class="rt-intro">${esc(room.intro[0] || '')}</p>
      ${terms}
      <p class="rt-count">${room.exhibits.length} 件展品 · 按时代顺序陈列</p>`;
    return el;
  }

  function badgeFor(ex, size) {
    if (/经函/.test(ex.name)) return '经函';
    if (/抄本|髹饰录/.test(ex.name)) return '抄本';
    if (/挂屏/.test(ex.name)) return '挂屏';
    if (/屏/.test(ex.name)) return '屏风';
    if (/奁/.test(ex.name)) return '漆奁';
    if (/枕/.test(ex.name)) return '漆枕';
    if (/钵/.test(ex.name)) return '漆钵';
    if (/团扇/.test(ex.name)) return '团扇';
    if (/盏托|盏/.test(ex.name)) return '茶具';
    if (/镜盒/.test(ex.name)) return '镜盒';
    if (/书桌|小柜/.test(ex.name)) return '家具';
    if (/残片/.test(ex.name)) return '残片';
    if (/箱/.test(ex.name)) return '箱';
    if (/盒/.test(ex.name)) return '盒';
    if (/盘/.test(ex.name)) return '盘';
    return '';
  }

  function buildArtwork(ex, index, roomIndex) {
    const size = frameSize(ex);
    const badge = badgeFor(ex, size);
    const el = document.createElement('article');
    el.className = 'artwork' + (state.visited.has(ex.id) ? ' visited' : '');
    el.dataset.id = ex.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${ex.name}，${ex.artist}`);
    el.style.setProperty('--fw', `${size.w}px`);
    el.style.setProperty('--fh', `${size.h}px`);
    el.style.setProperty('--mw', `${size.w - 44}px`);
    el.style.setProperty('--mh', `${size.h - 44}px`);
    el.style.setProperty('--scroll-pos', `${ex.scrollPos || 30}%`);
    const imgStyle = size.scrollH ? 'object-position:center 30%' : `object-position:${objectPosition(ex.hero)}`;

    el.innerHTML = `
      <div class="artwork-inner">
        <div class="spot"></div>
        <div class="frame${size.scrollH ? ' scroll-h' : ''}">
          ${badge ? `<span class="badge">${esc(badge)}</span>` : ''}
          <div class="mat">
            <img loading="eager" referrerpolicy="no-referrer" src="${esc(ex.hero.src)}" alt="${esc(ex.name)}" style="${imgStyle}">
          </div>
        </div>
        <div class="label">
          <span class="no">${pad2(index + 1)}</span>
          <span class="txt">
            <span class="name">${esc(ex.name)}<i class="visit-dot"></i></span>
            <span class="meta">${esc(ex.dynasty)}${ex.version ? ' · ' + esc(ex.version) : ''} · ${esc(ex.artist)}</span>
          </span>
        </div>
      </div>`;

    let opening = false;
    const open = () => {
      if (state.dragMoved || opening) return;
      opening = true;
      el.classList.add('tap-pop');
      setTimeout(() => {
        opening = false;
        if (!state.dragMoved) openDetail(roomIndex, index);
      }, 260);
      setTimeout(() => el.classList.remove('tap-pop'), 540);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return el;
  }

  function buildDoor(roomIndex) {
    const isLast = roomIndex >= DATA.rooms.length - 1;
    const el = document.createElement('div');
    if (!isLast) {
      const next = DATA.rooms[roomIndex + 1];
      el.className = 'door-panel';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.innerHTML = `
        <span class="door-kicker">NEXT GALLERY</span>
        <span class="door-title">${esc(next.title)}</span>
        <span class="door-sub">${esc(next.subtitle)}</span>
        <span class="door-arrow">→</span>
        <span class="door-sub">点击进入下一展厅</span>`;
      const go = () => enterRoom(roomIndex + 1, true, 'start');
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    } else {
      el.className = 'end-panel';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.innerHTML = `
        <span class="door-kicker">END OF EXHIBITION</span>
        <span class="door-title">展览终点</span>
        <span class="door-sub">宋元明漆器 · 千层髹漆</span>
        <span class="door-arrow">红</span>
        <span class="door-sub">点击回看展品目录</span>`;
      const go = () => openCatalog();
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    }
    return el;
  }

  function renderWall(index) {
    if (state.panRaf) { cancelAnimationFrame(state.panRaf); state.panRaf = 0; }
    const room = DATA.rooms[index];
    const wall = $('#wall');
    wall.style.transform = 'translate3d(0,0,0)';
    wall.innerHTML = '';
    wall.appendChild(buildRoomTitlePanel(room, index));
    room.exhibits.forEach((ex, ei) => wall.appendChild(buildArtwork(ex, ei, index)));
    wall.appendChild(buildDoor(index));
    const tail = document.createElement('div');
    tail.className = 'wall-tail';
    wall.appendChild(tail);
    requestAnimationFrame(() => {
      measureWall();
      applyPanInstant(0);
    });
  }

  function measureWall() {
    const wall = $('#wall');
    const vp = $('#wallViewport');
    state.artworks = $$('.artwork', wall).map(el => ({
      el,
      inner: el.firstElementChild,
      left: el.offsetLeft,
      width: el.offsetWidth
    }));
    const last = wall.lastElementChild;
    const contentRight = last ? last.offsetLeft + last.offsetWidth : wall.scrollWidth;
    state.wallMax = Math.max(0, contentRight - vp.clientWidth);
    updateNav();
  }

  function applyPanInstant(x) {
    state.panX = clamp(x, 0, state.wallMax);
    state.targetPan = state.panX;
    $('#wall').style.transform = `translate3d(${-state.panX}px,0,0)`;
    const fill = state.wallMax ? (state.panX / state.wallMax) * 100 : 0;
    $('#panFill').style.width = `${fill}%`;
    updateDepth();
    updateNav();
  }

  function setPanTarget(x) {
    state.targetPan = clamp(x, 0, state.wallMax);
    if (!state.panRaf) state.panRaf = requestAnimationFrame(panLoop);
  }

  function panLoop() {
    const diff = state.targetPan - state.panX;
    if (Math.abs(diff) < 0.6) {
      state.panX = state.targetPan;
      applyPanInstant(state.panX);
      state.panRaf = 0;
      return;
    }
    state.panX += diff * 0.2;
    $('#wall').style.transform = `translate3d(${-state.panX}px,0,0)`;
    const fill = state.wallMax ? (state.panX / state.wallMax) * 100 : 0;
    $('#panFill').style.width = `${fill}%`;
    updateDepth();
    updateNav();
    state.panRaf = requestAnimationFrame(panLoop);
  }

  function updateDepth() {
    if (window.innerWidth < 900) return;
    const vw = window.innerWidth;
    const half = vw / 2;
    const px = state.dragging ? null : state.pointerX;
    const range = 280;
    state.artworks.forEach(a => {
      const center = a.left - state.panX + a.width / 2;
      const d = (center - half) / half;
      const ry = clamp(-d * 4.5, -4.5, 4.5);
      const tz = -Math.min(Math.abs(d) * 55, 55);
      let scale = 1;
      let lift = 0;
      if (px != null) {
        const dist = Math.abs(center - px);
        if (dist < range) {
          const k = 1 - dist / range;
          scale = 1 + 0.1 * k * k;
          lift = -14 * k * k;
        }
      }
      a.inner.style.transform =
        `translate3d(0,${lift.toFixed(2)}px,${tz}px) rotateY(${ry}deg) scale(${scale.toFixed(3)})`;
    });
  }

  function updateNav() {
    const atStart = state.panX <= 1;
    const atEnd = state.panX >= state.wallMax - 1;
    $('#prevBtn').disabled = atStart && state.roomIndex === 0;
    $('#nextBtn').disabled = atEnd && state.roomIndex === DATA.rooms.length - 1;
  }

  function step(dir) {
    const vw = $('#wallViewport').clientWidth;
    if (dir > 0 && state.panX >= state.wallMax - 2) {
      if (state.roomIndex < DATA.rooms.length - 1) enterRoom(state.roomIndex + 1, true, 'start');
      return;
    }
    if (dir < 0 && state.panX <= 2) {
      if (state.roomIndex > 0) enterRoom(state.roomIndex - 1, true, 'end');
      return;
    }
    setPanTarget(state.targetPan + dir * vw * 0.7);
  }

  function enterRoom(index, showThreshold = true, position = 'start') {
    if (index < 0 || index >= DATA.rooms.length) return;
    if (state.panRaf) { cancelAnimationFrame(state.panRaf); state.panRaf = 0; }
    state.roomIndex = index;
    renderWall(index);
    updateTop();
    updateRoute();
    preloadRoom(index);
    preloadRoom(index + 1);
    if (showThreshold) {
      showThresholdPanel(index);
    } else {
      $('#threshold').hidden = true;
      if (state.overlay === 'threshold') state.overlay = null;
    }
    if (position === 'end') {
      requestAnimationFrame(() => {
        measureWall();
        applyPanInstant(state.wallMax);
      });
    }
  }

  function preloadRoom(index) {
    if (index < 0 || index >= DATA.rooms.length || preloaded.has(index)) return;
    preloaded.add(index);
    DATA.rooms[index].exhibits.forEach(ex => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.src = ex.hero.src;
    });
  }

  /* ---------- 门槛 ---------- */
  function knowledgeHtml(room) {
    if (!room.knowledge || !room.knowledge.length) return '';
    return `<div class="threshold-knowledge">
      <p class="tk-title">本厅关键词</p>
      ${room.knowledge.map(k => `<details><summary>${esc(k.term)}</summary><p>${esc(k.text)}</p></details>`).join('')}
    </div>`;
  }

  function showThresholdPanel(index) {
    const room = DATA.rooms[index];
    state.overlay = 'threshold';
    $('#threshold').hidden = false;
    $('#thresholdBgImg').src = room.exhibits[0].hero.src;
    $('#thresholdKicker').textContent = `${room.chapter} · ${pad2(index + 1)} / ${DATA.meta.roomCount}`;
    $('#thresholdTitle').textContent = room.title;
    $('#thresholdSub').textContent = room.subtitle;
    $('#thresholdIntro').innerHTML = room.intro.map(p => `<p>${esc(p)}</p>`).join('') + knowledgeHtml(room);
    $('#thresholdPanel').scrollTop = 0;
    $('#threshold').scrollTop = 0;
  }

  function skipThreshold() {
    $('#threshold').hidden = true;
    if (state.overlay === 'threshold') state.overlay = null;
    if (window.innerWidth < 720 && !mobileHintShown) {
      mobileHintShown = true;
      setTimeout(() => toast('左右拖动浏览展墙 · 点击展品查看详情'), 450);
    }
  }

  /* ---------- 详情 ---------- */
  function openDetail(ri, ei, imgIndex = 0, fromCatalog = false) {
    const room = DATA.rooms[ri];
    const ex = room.exhibits[ei];
    if (!ex) return;
    hideToast();
    closeTagWiki();
    state.detail = { ri, ei, imgIndex };
    state.detailFromCatalog = fromCatalog;
    state.overlay = 'detail';
    $('#detail').hidden = false;
    $('#detailCloseBtn').innerHTML = fromCatalog ? '← <span>返回目录</span>' : '← <span>返回展厅</span>';
    renderDetail();
    markVisited(ex.id);
  }

  function renderDetail() {
    if (!state.detail) return;
    const { ri, ei, imgIndex } = state.detail;
    const room = DATA.rooms[ri];
    const ex = room.exhibits[ei];
    const flatIndex = FLAT.findIndex(f => f.ri === ri && f.ei === ei);
    const item = FLAT[flatIndex];

    $('#detailKicker').textContent = `${room.chapter} · ${room.title}`;
    $('#detailName').textContent = ex.name;
    $('#detailArtist').textContent = `${ex.artist}${ex.version ? ' · ' + ex.version : ''}`;
    $('#detailMeta').textContent = [ex.dynasty, ex.material].filter(Boolean).join(' · ') || '展品';
    $('#detailCounter').textContent = `第 ${item.global} 件 / 共 ${DATA.meta.total} 件`;
    $('#detailBody').innerHTML = ex.intro.length
      ? ex.intro.map(p => `<p class="${/^释文/.test(p) ? 'transcription' : ''}">${esc(p)}</p>`).join('')
      : '<p>本件展品暂无简介。可点击下方“延伸阅读”查看原文图录。</p>';
    const foot = $('#detailFoot');
    if (ex.detailLink) {
      foot.hidden = false;
      foot.innerHTML = `<a class="detail-link" href="${esc(ex.detailLink)}" target="_blank" rel="noopener"><span>延伸阅读 · 原文图录</span><span>↗</span></a>`;
    } else {
      foot.hidden = true;
      foot.innerHTML = '';
    }

    $('#detailPrevBtn').disabled = flatIndex <= 0;
    $('#detailNextBtn').disabled = flatIndex >= FLAT.length - 1;
    $('#detailPanel').scrollTop = 0;

    renderTags(ex);
    renderGraph(ex, ri);
    renderViewer(ex, imgIndex);
  }

  /* ---------- 特征标签 ---------- */
  function renderTags(ex) {
    const wrap = $('#detailTags');
    const tags = ex.tags || [];
    if (!tags.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
      <div class="dt-head"><span>特征标签</span><small>点击标签查看百科</small></div>
      <div class="tag-list">${tags.map(t => `<button type="button" class="tag-chip ${esc(t.kind)}" data-tag="${esc(t.name)}" data-kind="${esc(t.kind)}" title="点击查看「${esc(t.name)}」百科">${esc(t.name)}</button>`).join('')}</div>`;
  }

  function openTagWiki(name, kind) {
    if (!name) return;
    const currentId = state.detail ? DATA.rooms[state.detail.ri].exhibits[state.detail.ei].id : '';
    const allRelated = FLAT.filter(f => f.ex.id !== currentId && (f.ex.tags || []).some(t => t.name === name));
    const related = allRelated.slice(0, 8);
    $('#twTitle').textContent = name;
    $('#twKind').textContent = TAG_KIND_LABEL[kind] || '';
    $('#twBody').innerHTML = `<p>${esc(tagWikiText(name))}</p>`;
    $('#twWorks').innerHTML = related.length
      ? related.map(f => `<button type="button" class="tw-work" data-id="${esc(f.ex.id)}">${esc(f.ex.name)}<small>${esc(f.room.title)} · ${esc(f.ex.artist)}</small></button>`).join('')
      : '<p class="tw-empty">暂无其他相关展品。</p>';
    if (allRelated.length > related.length) {
      $('#twWorks').insertAdjacentHTML('beforeend', `<p class="tw-empty">共 ${allRelated.length} 件相关展品，展示前 ${related.length} 件。</p>`);
    }
    $$('.tw-work', $('#twWorks')).forEach(btn => {
      btn.addEventListener('click', () => {
        const item = FLAT.find(f => f.ex.id === btn.dataset.id);
        closeTagWiki();
        if (item) openDetail(item.ri, item.ei, 0, state.detailFromCatalog);
      });
    });
    $('#tagWiki').hidden = false;
    $('#twCloseBtn').focus();
  }

  function closeTagWiki() {
    $('#tagWiki').hidden = true;
  }

  /* ---------- 关系动力图 ---------- */
  function normalizeArtist(a) {
    return String(a || '').replace(/（传）|\(传\)/g, '').trim();
  }

  function getRelated(ex, ri) {
    const styles = new Set((ex.tags || []).filter(t => t.kind === 'style').map(t => t.name));
    const subjects = new Set((ex.tags || []).filter(t => t.kind === 'subject').map(t => t.name));
    const collection = normalizeArtist(ex.artist);
    return FLAT.filter(f => f.ex.id !== ex.id).map(f => {
      let score = 0;
      const kinds = [];
      const reasons = [];
      if (collection && collection !== '佚名' && normalizeArtist(f.ex.artist) === collection) {
        score += 3;
        kinds.push('artist');
        reasons.push('同馆收藏');
      }
      const sharedStyle = (f.ex.tags || []).filter(t => t.kind === 'style' && styles.has(t.name)).map(t => t.name);
      if (sharedStyle.length) {
        score += sharedStyle.length * 5;
        kinds.push('style');
        reasons.push(...sharedStyle);
      }
      const sharedSubject = (f.ex.tags || []).filter(t => t.kind === 'subject' && subjects.has(t.name)).map(t => t.name);
      if (sharedSubject.length) {
        score += sharedSubject.length * 2;
        kinds.push('subject');
        reasons.push(...sharedSubject);
      }
      if (f.ri === ri) score += 0.8;
      if (f.ex.dynasty === ex.dynasty) score += 0.3;
      const kind = kinds.includes('artist') ? 'artist' : kinds.includes('style') ? 'style' : kinds.includes('subject') ? 'subject' : 'room';
      return { item: f, score, kind, reasons };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 7);
  }

  const SHORT_NAMES = [
    [/剔犀卷草纹菱花形盘/, '卷草盘'], [/心形卷云纹圆盘/, '心云盘'], [/剔犀心形卷云纹盒/, '心云盒'],
    [/如意云纹圆盘/, '如意盘'], [/如意云纹长方盘/, '如意盘'], [/如意云纹方形委角盒/, '委角盒'],
    [/如意云纹八角盒/, '八角盒'], [/如意云纹长方盒/, '如意盒'], [/如意云纹盒/, '如意盒'],
    [/如意云纹执镜盒/, '镜盒'], [/云龙纹大圆盒/, '云龙大盒'], [/云龙纹圆盒/, '云龙盒'],
    [/云龙纹圆盘/, '云龙盘'], [/花卉纹长方盘/, '花卉盘'], [/楼阁人物图圆盘/, '楼阁盘'],
    [/菊花纹圆盘/, '菊花盘'], [/花鸟纹葵瓣形盘/, '花鸟盘'], [/花鸟纹圆盘/, '花鸟盘'],
    [/花鸟纹圆盒/, '花鸟盒'], [/花鸟纹大圆盒/, '花鸟大盒'], [/山水人物楼阁图圆盒/, '山水盒'],
    [/山水人物图长方盘/, '山水盘'], [/凤凰牡丹纹长方盒/, '凤牡盒'], [/仕女游园图长方盘/, '游园盘'],
    [/莲实纹圆盘/, '莲实盘'], [/楼阁人物图海棠盘/, '海棠盘'], [/双螭纹椭圆盘/, '双螭盘'],
    [/西王母.*圆盒/, '群仙盒'], [/葡萄纹圆盘/, '葡萄盘'], [/莲茨纹圆盘/, '莲茨盘'],
    [/凤鹤纹圆盒/, '凤鹤盒'], [/楼阁山水人物图长方盒/, '楼阁盒'], [/龙凤纹长方盒/, '龙凤盒'],
    [/莲池水禽图葵瓣形盘/, '莲池盘'], [/楼阁人物图屏/, '楼阁屏'], [/兰亭曲水流觞图长方盒/, '兰亭盒'],
    [/万寿桃纹小箱/, '寿桃箱'], [/萱草纹圆盘/, '萱草盘'], [/剔黄龙纹圆盒/, '龙纹盒'],
    [/剔黄龙纹长方盒/, '龙纹盒'], [/剔彩龙纹圆盘/, '龙盘'], [/剔彩花鸟纹圆盘/, '花鸟盘'],
    [/剔彩人物图六瓣形盘/, '人物盘'], [/婴戏图圆盒/, '婴戏盒'], [/剔彩龙纹圆盒/, '龙盒'],
    [/戗金凤凰纹经函/, '凤函'], [/戗金孔雀纹经函/, '孔雀函'], [/戗金牡丹纹经函/, '牡丹函'],
    [/缠枝牡丹纹经函/, '缠枝函'], [/戗金花鸟纹长方盒/, '花鸟盒'], [/戗金填漆牡丹纹大圆盒/, '牡丹盒'],
    [/双龙捧寿纹银锭形盘/, '捧寿盘'], [/戗金彩漆龙纹盏托/, '盏托'], [/婴戏图方胜形盒/, '方胜盒'],
    [/戗金彩漆龙纹长方盘/, '龙纹盘'], [/戗金彩漆龙纹圆盘/, '龙盘'], [/戗金彩漆龙纹盒/, '龙盒'],
    [/填彩漆松竹梅图圆盒/, '三友盒'], [/海水龙纹菱花形盘/, '海龙盘'], [/广寒宫图圆盒/, '广寒盒'],
    [/锦鸡花蝶图圆盒/, '锦鸡盒'], [/山水人物图圆盒/, '山水盒'], [/楼阁人物图十边形盒/, '楼阁盒'],
    [/狮子牡丹纹葵瓣形盒/, '狮牡盒'], [/楼阁人物图盒/, '楼阁盒'], [/松石图长方盘/, '松石盘'],
    [/楼阁人物图挂屏/, '挂屏'], [/楼阁人物图小柜/, '小柜'], [/楼阁花鸟纹砚盒、书桌/, '书桌'],
    [/柳枝禽鸟图大圆盒/, '柳禽盒'], [/花鸟纹方形委角盒/, '花鸟盒'], [/山水人物图葵瓣形盘/, '山水盘'],
    [/红漆螺钿龙纹圆盘/, '龙盘'], [/楼阁人物图长方盒/, '楼阁盒'], [/黑漆螺钿经箱/, '经箱'],
    [/红漆荷叶形枕/, '荷枕'], [/绿漆荷花形钵/, '荷钵'], [/针刻凤纹葵瓣形盘/, '凤盘'],
    [/心形卷云纹柄团扇/, '团扇'], [/黑漆长方盘.*盏托/, '茶盏'], [/瓜棱式三层漆奁/, '漆奁'],
    [/蔗段式漆盒/, '蔗段盒'], [/印板刻.*残片/, '印板片'], [/剔黑花卉纹残片/, '花卉片'],
    [/黑漆莲瓣形奁/, '莲瓣奁'], [/缠枝团菊纹长方盒/, '团菊片'], [/东篱采菊图圆盒/, '采菊盒'],
    [/蒹葭堂本/, '蒹葭本'], [/德川本/, '德川本'], [/黑漆菱花形盒/, '菱花盒'],
    [/黑漆十二瓣形椭圆盒/, '十二瓣盒'], [/红漆葵瓣形盘/, '葵瓣盘'], [/黑漆葵瓣形盘/, '葵瓣盘'],
    [/红漆菱花形渣斗/, '渣斗'], [/红漆菱花形盘/, '菱花盘'], [/黑漆菱花形盘/, '菱花盘']
  ];
  function shortName(name) {
    for (const [re, label] of SHORT_NAMES) if (re.test(name)) return label;
    let s = String(name || '').replace(/[（(].*?[）)]/g, '');
    s = s.replace(/^(剔红|剔黑|剔犀|剔彩|剔黄|戗金彩漆|戗金填漆|戗金|填漆|黑漆螺钿描金|黑漆螺钿|红漆螺钿|黑漆|红漆|绿漆|朱漆|素髹)+/, '');
    s = s.replace(/(图|纹|形|式)+$/, '');
    s = s.replace(/[、，,\s].*$/, '');
    return s.slice(0, 4) || String(name || '').slice(0, 3);
  }

  function renderGraph(ex, ri) {
    const wrap = $('#detailGraph');
    const related = getRelated(ex, ri);
    if (!related.length) {
      wrap.innerHTML = '<div class="dg-head"><span>展品关系 · 动力图</span></div><p class="dg-empty">暂无足够关联的展品。</p>';
      return;
    }
    const cx = 180, cy = 148, radius = 102;
    const positions = related.map((r, i) => {
      const a = -Math.PI / 2 + i * (2 * Math.PI / related.length);
      return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    });
    const edges = related.map((r, i) => `<line class="rel-edge ${r.kind}" x1="${cx}" y1="${cy}" x2="${positions[i].x.toFixed(1)}" y2="${positions[i].y.toFixed(1)}"/>`).join('');
    const nodes = related.map((r, i) => {
      const p = positions[i];
      const reason = r.reasons.length ? r.reasons.join('、') : '同厅展品';
      return `<g class="rel-node ${r.kind}" data-id="${esc(r.item.ex.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle r="21"></circle>
        <text y="4">${esc(shortName(r.item.ex.name))}</text>
        <title>${esc(r.item.ex.name)} · ${esc(reason)}</title>
      </g>`;
    }).join('');
    wrap.innerHTML = `
      <div class="dg-head"><span>展品关系 · 动力图</span><small>点击节点切换</small></div>
      <svg class="rel-graph" viewBox="0 0 360 300" role="img" aria-label="展品关系图">
        ${edges}${nodes}
        <g class="rel-center" transform="translate(${cx},${cy})">
          <circle r="30"></circle>
          <text y="4">${esc(shortName(ex.name))}</text>
          <title>${esc(ex.name)}</title>
        </g>
      </svg>
      <div class="dg-legend">
        <span><i class="artist"></i>同馆收藏</span>
        <span><i class="style"></i>同一工艺</span>
        <span><i class="subject"></i>同一题材</span>
        <span><i class="room"></i>同厅 / 同期</span>
      </div>`;
    $$('.rel-node', wrap).forEach(g => {
      g.addEventListener('click', () => {
        const item = FLAT.find(f => f.ex.id === g.dataset.id);
        if (item) openDetail(item.ri, item.ei, 0, state.detailFromCatalog);
      });
    });
  }

  function initialViewerMode() {
    const v = state.viewer;
    const r = v.visualW / v.visualH;
    if (r <= 1 / 3) return 'width';
    if (r >= 3) return 'height';
    return 'all';
  }

  function setViewerFullscreen(on, quiet = false) {
    const v = state.viewer;
    const should = !!on && isMobileLayout();
    if (should === v.fullscreen) return;
    v.fullscreen = should;
    $('#detail').classList.toggle('viewer-max', should);
    $('#viewerFullBtn').setAttribute('aria-pressed', should ? 'true' : 'false');
    if (!state.detail) return;
    const ex = DATA.rooms[state.detail.ri].exhibits[state.detail.ei];
    const im = ex.images[state.detail.imgIndex] || ex.hero;
    const tallScroll = isHorizontalWork(ex) && state.detail.imgIndex === 0 && im.h > im.w;
    v.rotated = tallScroll && (!should || HORIZONTAL_ALBUMS.has(ex.id));
    v.natW = im.w || 1000;
    v.natH = im.h || 1000;
    v.visualW = v.rotated ? v.natH : v.natW;
    v.visualH = v.rotated ? v.natW : v.natH;
    requestAnimationFrame(() => fitViewer(initialViewerMode()));
    if (!quiet) toast(should ? '全屏查看 · 拖动浏览，双指缩放' : '已退出全屏');
  }

  function renderViewer(ex, imgIndex) {
    const im = ex.images[imgIndex] || ex.hero;
    const v = state.viewer;
    const tallScroll = isHorizontalWork(ex) && imgIndex === 0 && (im.h > im.w);
    v.rotated = tallScroll && (!v.fullscreen || HORIZONTAL_ALBUMS.has(ex.id));
    v.natW = im.w || 1000;
    v.natH = im.h || 1000;
    v.visualW = v.rotated ? v.natH : v.natW;
    v.visualH = v.rotated ? v.natW : v.natH;
    const img = $('#viewerImg');
    img.onerror = null;
    img.referrerPolicy = 'no-referrer';
    img.src = im.full;
    img.alt = `${ex.name} · 图${imgIndex + 1}`;
    img.onerror = () => {
      if (img.dataset.fallback !== '1') {
        img.dataset.fallback = '1';
        img.src = im.src;
      }
    };
    img.dataset.fallback = '';
    fitViewer(initialViewerMode());
    renderThumbs(ex, imgIndex);
    if (tallScroll && !v.fullscreen && isMobileLayout() && !mobileViewerHintShown) {
      mobileViewerHintShown = true;
      setTimeout(() => toast('左右拖动查看长卷 · 点“全屏”可纵向浏览'), 500);
    }
  }

  function renderThumbs(ex, active) {
    const wrap = $('#viewerThumbs');
    wrap.innerHTML = '';
    if (ex.images.length <= 1) return;
    const buttons = ex.images.map((im, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vthumb' + (i === active ? ' active' : '');
      b.innerHTML = `<img referrerpolicy="no-referrer" src="${esc(im.src)}" alt="">`;
      b.addEventListener('click', () => {
        if (!state.detail) return;
        state.detail.imgIndex = i;
        const ex2 = DATA.rooms[state.detail.ri].exhibits[state.detail.ei];
        renderViewer(ex2, i);
      });
      wrap.appendChild(b);
      return b;
    });
    const current = buttons[active];
    if (current) {
      requestAnimationFrame(() => {
        current.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    }
  }

  function fitViewer(mode) {
    const v = state.viewer;
    const stage = $('#viewerStage');
    const sw = stage.clientWidth || 800;
    const sh = stage.clientHeight || 500;
    const vw = v.visualW;
    const vh = v.visualH;
    let s;
    if (mode === 'width') s = (sw * (state.viewer.fullscreen ? 0.88 : 0.62)) / vw;
    else if (mode === 'height') s = (sh * 0.82) / vh;
    else s = Math.min((sw - 60) / vw, (sh - 74) / vh);
    s = Math.max(s, 0.0001);
    v.fit = s;
    v.scale = 1;
    v.mode = mode;
    if (mode === 'width') {
      v.x = 0;
      v.y = Math.max(0, (vh * s - sh) / 2);
      $('#viewerHint').textContent = '上下拖动查看长卷 · 按钮缩放';
    } else if (mode === 'height') {
      const maxX = Math.max(0, (vw * s - sw) / 2);
      v.x = v.rotated ? -maxX : maxX;
      v.y = 0;
      $('#viewerHint').textContent = v.rotated ? '滚轮横向滚动 · Ctrl+滚轮缩放 · 拖动查看' : '左右拖动查看长卷 · 滚轮滚动';
    } else {
      v.x = 0;
      v.y = 0;
      $('#viewerHint').textContent = '滚轮缩放 · 拖动查看细节 · 双击放大';
    }
    clampViewer();
    applyViewer();
  }

  function applyViewer() {
    const v = state.viewer;
    const img = $('#viewerImg');
    const art = $('#viewerArt');
    const vw = v.visualW * v.fit * v.scale;
    const vh = v.visualH * v.fit * v.scale;
    art.style.width = `${vw}px`;
    art.style.height = `${vh}px`;
    img.style.width = `${v.natW * v.fit * v.scale}px`;
    img.style.height = `${v.natH * v.fit * v.scale}px`;
    img.style.transform = `translate(-50%, -50%) rotate(${v.rotated ? 90 : 0}deg)`;
    art.style.transform = `translate(${v.x}px, ${v.y}px)`;
    updateScrollbar(vw, vh);
  }

  function updateScrollbar(vw, vh) {
    const bar = $('#viewerScrollbar');
    const thumb = bar.firstElementChild;
    const stage = $('#viewerStage');
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (vw > sw + 4) {
      bar.className = 'viewer-scrollbar horizontal show';
      const tw = clamp((sw / vw) * 100, 8, 100);
      const maxX = (vw - sw) / 2 + 20;
      const ratio = maxX > 0 ? clamp((maxX - state.viewer.x) / (2 * maxX), 0, 1) : 0;
      thumb.style.width = `${tw}%`;
      thumb.style.height = '100%';
      thumb.style.left = `${ratio * (100 - tw)}%`;
      thumb.style.top = '0';
    } else if (vh > sh + 4) {
      bar.className = 'viewer-scrollbar vertical show';
      const th = clamp((sh / vh) * 100, 8, 100);
      const maxY = (vh - sh) / 2 + 20;
      const ratio = maxY > 0 ? clamp((maxY - state.viewer.y) / (2 * maxY), 0, 1) : 0;
      thumb.style.height = `${th}%`;
      thumb.style.width = '100%';
      thumb.style.top = `${ratio * (100 - th)}%`;
      thumb.style.left = '0';
    } else {
      bar.className = 'viewer-scrollbar';
    }
  }

  function clampViewer() {
    const v = state.viewer;
    const stage = $('#viewerStage');
    const vw = v.visualW * v.fit * v.scale;
    const vh = v.visualH * v.fit * v.scale;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const maxX = vw > sw ? (vw - sw) / 2 + 20 : 0;
    const maxY = vh > sh ? (vh - sh) / 2 + 20 : 0;
    v.x = clamp(v.x, -maxX, maxX);
    v.y = clamp(v.y, -maxY, maxY);
  }

  function zoomViewer(factor) {
    const v = state.viewer;
    const next = clamp(v.scale * factor, 1, 12);
    if (Math.abs(next - v.scale) < 0.001) return;
    v.scale = next;
    clampViewer();
    applyViewer();
  }

  // 微信图床不返回 CORS 头，直接以 crossOrigin 加载会被浏览器拦截。
  // 保存时改走支持 CORS 的图片代理，仍按原图分辨率取图，再由 Canvas 烘焙水印。
  function proxiedImageUrl(url) {
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&n=-1&output=jpg&q=100';
  }

  function loadDownloadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => reject(new Error('timeout')), 45000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('load')); };
      img.src = url;
    });
  }

  function drawWatermarkedCanvas(img, rotate, scale) {
    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const cw = Math.max(1, Math.round((rotate ? srcH : srcW) * scale));
    const ch = Math.max(1, Math.round((rotate ? srcW : srcH) * scale));
    if (cw > 16384 || ch > 16384 || cw * ch > 100e6) {
      return Promise.reject(new Error('too-large'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('ctx'));
    ctx.fillStyle = '#0d0b09';
    ctx.fillRect(0, 0, cw, ch);
    if (rotate) {
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -srcW * scale / 2, -srcH * scale / 2, srcW * scale, srcH * scale);
      ctx.restore();
    } else {
      ctx.drawImage(img, 0, 0, cw, ch);
    }
    const fs = Math.max(14, Math.min(120, Math.round(Math.min(cw * 0.018, ch * 0.07))));
    const text = '獭的游乐场';
    const x = cw - fs * 0.7;
    const y = ch - fs * 0.5;
    ctx.font = `${fs}px "Songti SC","STSong","SimSun",serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = fs * 0.55;
    ctx.shadowOffsetY = fs * 0.06;
    ctx.lineWidth = Math.max(1, fs * 0.07);
    ctx.strokeStyle = 'rgba(40,30,22,0.48)';
    ctx.strokeText(text, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = 'rgba(255,248,235,0.42)';
    ctx.fillText(text, x, y);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve({ blob, cw, ch });
        else reject(new Error('blob'));
      }, 'image/jpeg', 0.92);
    });
  }

  async function downloadWatermarked() {
    if (!state.detail) return;
    const ex = DATA.rooms[state.detail.ri].exhibits[state.detail.ei];
    const im = ex.images[state.detail.imgIndex] || ex.hero;
    const rotate = state.viewer.rotated;
    const fileName = `獭的游乐场_${String(ex.name).replace(/[\\/:*?"<>|]/g, '_')}.jpg`;
    toast('正在准备大图…');
    let img;
    let lowRes = false;
    try {
      img = await loadDownloadImage(proxiedImageUrl(im.full));
    } catch (e) {
      try {
        img = await loadDownloadImage(proxiedImageUrl(im.src));
        lowRes = true;
      } catch (err) {
        toast('原图暂时无法取回，请稍后重试');
        return;
      }
    }
    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const maxPixels = touch ? 16e6 : 100e6;
    const baseScale = Math.min(
      1,
      16384 / Math.max(srcW, srcH),
      Math.sqrt(maxPixels / (srcW * srcH))
    );
    const scales = [];
    [1, 0.72, 0.5, 0.32].forEach(k => {
      const s = baseScale * k;
      if (s > 0.01 && !scales.some(x => Math.abs(x - s) < 1e-6)) scales.push(s);
    });
    for (const scale of scales) {
      try {
        const { blob } = await drawWatermarkedCanvas(img, rotate, scale);
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast(lowRes
          ? '原图暂不可用，已保存预览图'
          : (scale < baseScale - 0.01 ? '已保存高清图（受设备限制略缩）' : '已保存带水印大图'));
        return;
      } catch (e) { /* try a smaller canvas */ }
    }
    toast('图片过大，保存失败，请换用电脑浏览器重试');
  }

  function stepDetail(dir) {
    if (!state.detail) return;
    const idx = FLAT.findIndex(f => f.ri === state.detail.ri && f.ei === state.detail.ei);
    const next = FLAT[idx + dir];
    if (!next) return;
    if (next.ri !== state.detail.ri) enterRoom(next.ri, false);
    state.detail = { ri: next.ri, ei: next.ei, imgIndex: 0 };
    renderDetail();
    markVisited(next.ex.id);
  }

  function closeDetail() {
    setViewerFullscreen(false, true);
    state.viewer.pointers.clear();
    state.viewer.pinch = null;
    state.viewer.dragging = false;
    closeTagWiki();
    $('#detail').hidden = true;
    state.detail = null;
    if (state.overlay === 'detail') state.overlay = null;
    const fromCatalog = state.detailFromCatalog;
    state.detailFromCatalog = false;
    if (fromCatalog) openCatalog();
  }

  /* ---------- 目录 ---------- */
  function renderCatalogFilters() {
    const wrap = $('#catalogFilters');
    wrap.innerHTML = '';
    const items = [{ key: 'all', label: `全部 ${DATA.meta.total}` }].concat(
      DATA.rooms.map((r, i) => ({ key: String(i), label: `${pad2(i + 1)} ${r.title} · ${r.exhibits.length}` }))
    );
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-chip' + (state.catalogFilter === it.key ? ' active' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => {
        state.catalogFilter = it.key;
        renderCatalogFilters();
        renderCatalog();
      });
      wrap.appendChild(b);
    });
  }

  function renderCatalog() {
    const grid = $('#catalogGrid');
    const q = state.catalogQuery.trim().toLowerCase();
    const items = FLAT.filter(item => {
      if (state.catalogFilter !== 'all' && String(item.ri) !== state.catalogFilter) return false;
      if (!q) return true;
      const hay = `${item.ex.name} ${item.ex.artist} ${item.ex.dynasty} ${item.ex.version} ${item.room.title}`.toLowerCase();
      return hay.includes(q);
    });
    if (!items.length) {
      grid.innerHTML = '<div class="catalog-empty">没有找到匹配的展品，试试其他关键词。</div>';
      return;
    }
    grid.innerHTML = items.map(item => {
      const ex = item.ex;
      const rot = isHorizontalWork(ex) && ex.hero.h > ex.hero.w ? ' rot' : '';
      return `<article class="cat-card${state.visited.has(ex.id) ? ' visited' : ''}" data-id="${esc(ex.id)}" tabindex="0" role="button" aria-label="${esc(ex.name)}">
        <div class="cat-img">
          <img class="${rot.trim()}" loading="lazy" referrerpolicy="no-referrer" src="${esc(ex.hero.src)}" alt=""${rot ? ` style="object-position:center ${ex.scrollPos || 30}%"` : ''}>
          <span class="cat-no">${pad2(item.global)}</span>
        </div>
        <p class="cat-name">${esc(ex.name)}</p>
        <div class="cat-meta">${esc(ex.dynasty)}${ex.version ? ' · ' + esc(ex.version) : ''} · ${esc(ex.artist)}</div>
        <div class="cat-room">${esc(item.room.title)}</div>
      </article>`;
    }).join('');
  }

  function openCatalog() {
    hideToast();
    state.catalogScroll = $('#catalog').scrollTop;
    state.overlay = 'catalog';
    $('#catalog').hidden = false;
    renderCatalogFilters();
    renderCatalog();
    $('#catalog').scrollTop = state.catalogScroll;
  }

  function closeCatalog() {
    state.catalogScroll = $('#catalog').scrollTop;
    $('#catalog').hidden = true;
    if (state.overlay === 'catalog') state.overlay = null;
  }

  /* ---------- 指南 ---------- */
  function openGuide() {
    hideToast();
    state.overlay = 'guide';
    $('#guide').hidden = false;
  }
  function closeGuide() {
    $('#guide').hidden = true;
    if (state.overlay === 'guide') state.overlay = null;
  }

  /* ---------- 首页 / 进入 ---------- */
  function startGallery() {
    state.started = true;
    $('#intro').hidden = true;
    $('#gallery').hidden = false;
    $('#loadingMask').classList.add('hide');
  }

  function backHome() {
    closeDetail();
    closeCatalog();
    closeGuide();
    $('#gallery').hidden = true;
    $('#intro').hidden = false;
    state.started = false;
    state.roomIndex = 0;
    state.overlay = null;
  }

  /* ---------- 通用 ---------- */
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('#toast').classList.remove('show');
  }

  function anyOverlay() {
    return !$('#threshold').hidden || !$('#detail').hidden || !$('#catalog').hidden || !$('#guide').hidden || !$('#tagWiki').hidden;
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    // 入口
    $('#enterBtn').addEventListener('click', () => { startGallery(); enterRoom(0, true, 'start'); });
    $('#introCatalogBtn').addEventListener('click', openCatalog);
    $('#introGuideBtn').addEventListener('click', openGuide);
    $('#introMusicBtn').addEventListener('click', toggleMusic);
    $('#galleryMusicBtn').addEventListener('click', toggleMusic);

    // 展厅顶栏
    $('#backHomeBtn').addEventListener('click', backHome);
    $('#openCatalogBtn').addEventListener('click', openCatalog);
    $('#openGuideBtn').addEventListener('click', openGuide);

    // 门槛
    $('#thresholdEnterBtn').addEventListener('click', skipThreshold);
    $('#threshold').addEventListener('click', e => { if (e.target === $('#threshold')) skipThreshold(); });

    // 展厅移动
    $('#prevBtn').addEventListener('click', () => step(-1));
    $('#nextBtn').addEventListener('click', () => step(1));
    $('#wallViewport').addEventListener('wheel', e => {
      if (anyOverlay()) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setPanTarget(state.targetPan + delta * 1.05);
      $('#panHint').classList.add('hide');
    }, { passive: false });

    // 拖拽
    const vp = $('#wallViewport');
    vp.addEventListener('pointerdown', e => {
      if (e.button !== 0 || anyOverlay()) return;
      state.dragging = true;
      state.dragMoved = false;
      state.dragStartX = e.clientX;
      state.dragStartPan = state.panX;
      state.dragLastX = e.clientX;
      state.dragLastT = performance.now();
      state.dragVelocity = 0;
      if (state.panRaf) { cancelAnimationFrame(state.panRaf); state.panRaf = 0; }
      vp.classList.add('dragging');
    });
    vp.addEventListener('pointermove', e => {
      if (!state.dragging) return;
      const dx = e.clientX - state.dragStartX;
      if (Math.abs(dx) > 6) {
        state.dragMoved = true;
        $('#panHint').classList.add('hide');
      }
      const now = performance.now();
      const dt = Math.max(1, now - state.dragLastT);
      state.dragVelocity = (e.clientX - state.dragLastX) / dt;
      state.dragLastX = e.clientX;
      state.dragLastT = now;
      applyPanInstant(state.dragStartPan - dx);
    });
    const scheduleDock = () => {
      if (state.depthRaf) return;
      state.depthRaf = requestAnimationFrame(() => {
        state.depthRaf = 0;
        updateDepth();
      });
    };
    vp.addEventListener('pointermove', e => {
      if (state.dragging || e.pointerType === 'touch') return;
      state.pointerX = e.clientX;
      scheduleDock();
    });
    vp.addEventListener('pointerleave', () => {
      state.pointerX = null;
      scheduleDock();
    });
    const endDrag = () => {
      if (!state.dragging) return;
      state.dragging = false;
      vp.classList.remove('dragging');
      if (state.dragMoved) {
        const momentum = clamp(-state.dragVelocity * 160, -520, 520);
        if (Math.abs(momentum) > 40) setPanTarget(state.panX + momentum);
      }
    };
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
    vp.addEventListener('pointerleave', endDrag);
    vp.addEventListener('click', e => {
      if (state.dragMoved) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // 详情
    $('#detailCloseBtn').addEventListener('click', closeDetail);
    $('#detailPrevBtn').addEventListener('click', () => stepDetail(-1));
    $('#detailNextBtn').addEventListener('click', () => stepDetail(1));
    $('#detailTags').addEventListener('click', e => {
      const chip = e.target.closest('.tag-chip');
      if (chip) openTagWiki(chip.dataset.tag, chip.dataset.kind);
    });
    $('#twCloseBtn').addEventListener('click', closeTagWiki);
    $('#tagWiki').addEventListener('click', e => { if (e.target === $('#tagWiki')) closeTagWiki(); });
    $('#zoomInBtn').addEventListener('click', () => zoomViewer(1.25));
    $('#zoomOutBtn').addEventListener('click', () => zoomViewer(0.8));
    $('#zoomResetBtn').addEventListener('click', () => fitViewer('all'));
    $('#viewerOpenBtn').addEventListener('click', downloadWatermarked);
    $('#viewerFullBtn').addEventListener('click', () => setViewerFullscreen(!state.viewer.fullscreen));
    $('#viewerExitBtn').addEventListener('click', () => setViewerFullscreen(false));

    const stage = $('#viewerStage');
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const v = state.viewer;
      if (e.ctrlKey || e.metaKey) {
        zoomViewer(e.deltaY < 0 ? 1.18 : 0.85);
        return;
      }
      if (v.rotated || v.visualW > v.visualH * 3) {
        const dir = v.rotated ? 1 : -1;
        v.x += dir * (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 1.2;
        clampViewer();
        applyViewer();
      } else if (v.visualH > v.visualW * 1.6) {
        v.y -= e.deltaY * 1.2;
        clampViewer();
        applyViewer();
      } else {
        zoomViewer(e.deltaY < 0 ? 1.18 : 0.85);
      }
    }, { passive: false });
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const v = state.viewer;
      v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (v.pointers.size === 2) {
        const pts = [...v.pointers.values()];
        v.pinch = {
          dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
          scale: v.scale
        };
        v.dragging = false;
        stage.classList.remove('dragging');
        return;
      }
      v.dragging = true;
      v.startX = e.clientX;
      v.startY = e.clientY;
      v.origX = v.x;
      v.origY = v.y;
      stage.classList.add('dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    stage.addEventListener('pointermove', e => {
      const v = state.viewer;
      if (v.pointers.has(e.pointerId)) {
        v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (v.pinch && v.pointers.size >= 2) {
        const pts = [...v.pointers.values()];
        const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        v.scale = clamp(v.pinch.scale * (dist / v.pinch.dist), 1, 12);
        clampViewer();
        applyViewer();
        return;
      }
      if (!v.dragging) return;
      v.x = v.origX + (e.clientX - v.startX);
      v.y = v.origY + (e.clientY - v.startY);
      clampViewer();
      applyViewer();
    });
    const endViewerPointer = e => {
      const v = state.viewer;
      v.pointers.delete(e.pointerId);
      if (v.pointers.size < 2) v.pinch = null;
      if (v.pointers.size === 1) {
        const p = [...v.pointers.values()][0];
        v.startX = p.x;
        v.startY = p.y;
        v.origX = v.x;
        v.origY = v.y;
        v.dragging = true;
      } else if (v.pointers.size === 0) {
        v.dragging = false;
        stage.classList.remove('dragging');
      }
    };
    stage.addEventListener('pointerup', endViewerPointer);
    stage.addEventListener('pointercancel', endViewerPointer);
    stage.addEventListener('pointerleave', endViewerPointer);
    stage.addEventListener('dblclick', () => {
      if (state.viewer.scale > 1.2) {
        fitViewer(initialViewerMode());
      } else {
        zoomViewer(3);
        clampViewer();
        applyViewer();
      }
    });

    // 目录
    $('#catalogCloseBtn').addEventListener('click', closeCatalog);
    $('#catalogSearch').addEventListener('input', e => {
      state.catalogQuery = e.target.value;
      renderCatalog();
      $('#catalog').scrollTop = 0;
    });
    $('#catalogGrid').addEventListener('click', e => {
      const card = e.target.closest('.cat-card');
      if (!card || card.dataset.opening === '1') return;
      const item = FLAT.find(f => f.ex.id === card.dataset.id);
      if (!item) return;
      card.dataset.opening = '1';
      card.classList.add('tap-pop');
      setTimeout(() => {
        delete card.dataset.opening;
        closeCatalog();
        startGallery();
        enterRoom(item.ri, false, 'start');
        openDetail(item.ri, item.ei, 0, true);
      }, 240);
      setTimeout(() => card.classList.remove('tap-pop'), 520);
    });
    $('#catalogGrid').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.cat-card');
      if (!card) return;
      e.preventDefault();
      const item = FLAT.find(f => f.ex.id === card.dataset.id);
      if (!item) return;
      closeCatalog();
      startGallery();
      enterRoom(item.ri, false, 'start');
      openDetail(item.ri, item.ei, 0, true);
    });

    // 指南
    $('#guideCloseBtn').addEventListener('click', closeGuide);

    // 键盘
    window.addEventListener('keydown', e => {
      if (!$('#tagWiki').hidden) {
        if (e.key === 'Escape') closeTagWiki();
        return;
      }
      if (e.key === 'Escape') {
        if (state.overlay === 'detail') {
          if (state.viewer.fullscreen) { setViewerFullscreen(false); return; }
          closeDetail();
          return;
        }
        if (state.overlay === 'catalog') { closeCatalog(); return; }
        if (state.overlay === 'guide') { closeGuide(); return; }
        if (state.overlay === 'threshold') { skipThreshold(); return; }
        return;
      }
      if (state.overlay === 'detail') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); stepDetail(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); stepDetail(1); }
        return;
      }
      if (anyOverlay()) return;
      if (!state.started || $('#gallery').hidden) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'Home') { e.preventDefault(); setPanTarget(0); }
      if (e.key === 'End') { e.preventDefault(); setPanTarget(state.wallMax); }
    });

    // 窗口尺寸
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.started && !$('#gallery').hidden) {
          const ratio = state.wallMax ? state.panX / state.wallMax : 0;
          renderWall(state.roomIndex);
          requestAnimationFrame(() => {
            measureWall();
            applyPanInstant(ratio * state.wallMax);
          });
        }
        if (state.overlay === 'detail' && state.detail) {
          const ex = DATA.rooms[state.detail.ri].exhibits[state.detail.ei];
          renderViewer(ex, state.detail.imgIndex);
        }
      }, 220);
    });
  }

  /* ---------- 启动 ---------- */
  function hideLoading() {
    if (loadingDone) return;
    loadingDone = true;
    $('#loadingMask').classList.add('hide');
  }

  function boot() {
    loadVisited();
    loadMusicPref();
    initIntro();
    renderRoutes();
    updateProgress();
    updateRoute();
    bindEvents();
    document.addEventListener('pointerdown', e => {
      if (music.on && !music.started && !e.target.closest('.music-btn')) startMusic();
    }, { once: true, capture: true });

    const first = DATA.rooms[0].exhibits.map(ex => ex.hero.src);
    let loaded = 0;
    if (!first.length) hideLoading();
    first.forEach(src => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const done = () => { loaded += 1; if (loaded >= first.length) hideLoading(); };
      img.onload = done;
      img.onerror = done;
      img.src = src;
    });
    setTimeout(hideLoading, 3200);
  }

  boot();
})();
