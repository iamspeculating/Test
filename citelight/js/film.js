/* Citelight — brand film engine.
 *
 * Every frame is a pure function of time t (seconds). Nothing is simulated
 * forward, so the film scrubs, loops, and renders frame-by-frame to video
 * with identical results. A yellow point of light, the citation, carries the
 * story from scene to scene: highlight → mark → radar core → chart head →
 * logo.
 */
(() => {
  'use strict';

  // ─────────────────────────────────────────────── math

  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const mod = (a, n) => ((a % n) + n) % n;
  const E = {
    lin: k => k,
    inQuad: k => k * k,
    inCubic: k => k * k * k,
    outCubic: k => 1 - Math.pow(1 - k, 3),
    outQuart: k => 1 - Math.pow(1 - k, 4),
    outExpo: k => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
    inOutCubic: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
    inOutExpo: k => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2),
    outBack: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  };
  // fade in over [a,b], hold, fade out over [c,d]
  const win = (t, a, b, c, d) => (t < b ? E.outCubic(seg(t, a, b)) : 1 - E.inCubic(seg(t, c, d)));

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (a, b = 0) => {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // ─────────────────────────────────────────────── film constants

  const DUR = 45;
  const CHAPTERS = [
    { label: 'Question', t: 0 },
    { label: 'Shift', t: 7.1 },
    { label: 'Mark', t: 14.2 },
    { label: 'Radar', t: 19.2 },
    { label: 'Proof', t: 30.3 },
    { label: 'Brand', t: 38.3 },
  ];
  const POSTER = 27.35;

  const QUERY = 'Who’s the best accounting firm for startups?';
  const ANSWER = 'For seed-stage startups, look for a firm that pairs tax expertise with fractional CFO support. **Ledgerline** is widely recommended for R&D credits and investor-ready books[1]. **Northfield & Co.** offers flat monthly pricing[2], while **Brightbook** stands out for multi-state payroll[3].';
  const T = { type0: 0.95, send: 2.9, stream0: 3.55, dissolve: 6.72 };

  const ENGINES = ['AI Overviews', 'Copilot', 'Claude', 'Gemini', 'Perplexity', 'ChatGPT']; // inner → outer ring

  // The radar is also a step sequencer: one rotation = 2 bars at 120 BPM,
  // 32 sixteenth-note slots. A cited prompt sits on a slot; the sweep plays it.
  const SWEEP_T0 = 22, SWEEP_PERIOD = 4, OMEGA = TAU / SWEEP_PERIOD, THETA0 = -Math.PI / 2;
  const PATTERN_A = [[0, 5], [3, 3], [6, 1], [8, 4], [10, 2], [12, 3], [14, 1], [16, 2], [19, 4], [22, 1], [24, 3], [26, 0], [28, 4], [30, 2]];
  const PATTERN_B = [[2, 0], [5, 2], [11, 0], [18, 1], [21, 3], [27, 1]]; // newly won in the second rotation
  const COUNT0 = 1249;

  const FEED = [
    ['Perplexity', 'best accounting firm for startups', 1],
    ['ChatGPT', 'R&D tax credit help for SaaS', 1],
    ['Gemini', 'fractional CFO vs. bookkeeper', 2],
    ['AI Overviews', 'getting books ready for a Series A', 1],
    ['Claude', 'flat-fee startup accountant', 1],
    ['Copilot', 'multi-state payroll for remote teams', 3],
    ['ChatGPT', 'Delaware franchise tax filing help', 1],
    ['Perplexity', 'bookkeeping for seed-stage founders', 2],
    ['Gemini', 'startup accountant in Austin, TX', 1],
    ['Claude', '409A valuation and tax prep firm', 1],
    ['AI Overviews', 'who handles QSBS for founders', 1],
  ];
  const ROW_T = FEED.map((_, i) => 22.55 + i * 0.72);
  const ROW_H = 86;

  const SERIES = {
    you: [4, 4.6, 5.3, 7.1, 9.4, 12.2, 15.1, 18.4, 21.7, 25.0, 28.3, 31.0],
    ledger: [21, 21.2, 20.6, 20.1, 19.7, 19.1, 18.7, 18.1, 17.4, 17.0, 16.5, 16.0],
    north: [14, 14.3, 13.8, 13.6, 13.1, 12.8, 12.5, 12.1, 11.7, 11.3, 11.0, 10.6],
  };
  const LINE_T0 = 31.25, LINE_T1 = 33.9;

  const GEO = {
    landscape: {
      W: 1920, H: 1080,
      mark: { x: 960, y: 372, h: 176 },
      radar0: { x: 960, y: 540 },
      radar: { x: 720, y: 672, rMin: 118, rMax: 500 },
      chart: { x0: 150, x1: 1150, base: 876, top: 380 },
      feedRows: 5, ui: 1,
      meta: '6 AI engines · 2,400 prompts · refreshed hourly',
    },
    portrait: {
      W: 1080, H: 1920,
      mark: { x: 540, y: 790, h: 196 },
      radar0: { x: 540, y: 960 },
      radar: { x: 540, y: 1092, rMin: 92, rMax: 430 },
      chart: { x0: 140, x1: 950, base: 1250, top: 742 },
      feedRows: 4, ui: 1.45,
      meta: '6 AI engines · 2,400 prompts\nrefreshed hourly',
    },
  };

  const RGB = { sig: '255,228,94', ice: '156,188,255', paper: '238,241,251', cobalt: '42,63,208', abyss: '4,6,26' };

  // ─────────────────────────────────────────────── DOM

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const params = new URLSearchParams(location.search);
  const RENDER = params.has('render');
  if (RENDER) document.body.classList.add('render');

  const app = $('#app'), screenEl = $('#screen'), frame = $('#frame'), stage = $('#stage');
  const bg = $('#bg'), fx = $('#fx');
  const bgx = bg.getContext('2d'), fxx = fx.getContext('2d');
  const audio = $('#score');

  // style writes are cached so unchanged values never touch the DOM
  function css(el, k, v) { const c = el.__s || (el.__s = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } }
  const r2 = v => Math.round(v * 100) / 100;
  function tr(el, x, y, s = 1, extra = '') { css(el, 'transform', `translate3d(${r2(x)}px,${r2(y)}px,0) scale(${s === 1 ? 1 : s.toFixed(4)})${extra}`); }
  function op(el, a) { css(el, 'opacity', a >= 0.999 ? '1' : a <= 0.001 ? '0' : a.toFixed(3)); }
  function vis(el, on) { if (el.__on !== on) { el.__on = on; el.classList.toggle('is-on', on); } }
  function txt(el, s) { if (el.__t !== s) { el.__t = s; el.textContent = s; } }

  function split(el) {
    const text = el.textContent;
    el.textContent = '';
    const chars = [];
    text.split(/(\s+)/).forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) { el.append(' '); return; }
      const w = make('span', 'w');
      for (const ch of part) { const c = make('span', 'c', ch); w.append(c); chars.push(c); }
      el.append(w);
    });
    return chars;
  }
  $$('[data-split]', stage).forEach(el => { el.__chars = split(el); });
  const charsOf = (root) => $$('.c', root);

  const D = {
    sQuery: $('#sQuery'), sShift: $('#sShift'), sMark: $('#sMark'), sRadar: $('#sRadar'), sProof: $('#sProof'), sBrand: $('#sBrand'),
    sqCam: $('#sqCam'), sqPill: $('#sqPill'), sqTyped: $('#sqTyped'), sqCaret: $('#sqCaret'), sqSend: $('#sqSend'),
    sqLabel: $('#sqLabel'), sqShimmer: $('#sqShimmer'), sqProse: $('#sqProse'), srcs: $$('#sqSources .src'),
    ssLinks: $('#ssLinks'), ssBlock: $('#ssBlock'), ssSk: $$('#ssBlock .sk'), ssChips: $$('#ssBlock .chip'), ssHlBg: $('#ssHlBg'),
    mkMark: $('#mkMark'), mkBr: $$('#mkMark .br'), mkMeta: $('#mkMeta'),
    srPanel: $('#srPanel'), srNum: $('#srNum'), srRows: $('#srRows'),
    spKpis: $$('#spKpis .kpi'), spNums: $$('#spKpis .kpi__n'), spNote: $('#spNote'),
    sbLock: $('#sbLock'), sbMark: $('#sbMark'), sbBr: $$('#sbMark .br'), sbHlBg: $('#sbHlBg'), sbCta: $('#sbCta'),
    curtain: $('#curtain'), grain: $('#grain'),
  };

  const K = {
    ss: [0, 1, 2].map(i => {
      const p = $('#ssP' + i);
      return { small: charsOf($('.ss-small', p)), big: charsOf($('.ss-big', p)) };
    }),
    mk1: charsOf($('.mk-l1')), mk2: charsOf($('.mk-l2')),
    sr: $$('.sr-h').map(charsOf),
    spA: charsOf($('.sp-a')), spB: charsOf($('.sp-b')),
    sbWord: charsOf($('#sbWord')),
  };
  K.ssWho = K.ss[2].big.slice(0, -6);
  K.ssCited = K.ss[2].big.slice(-6);
  K.sbTagA = charsOf($('#sbTag > [data-split]'));
  K.sbTagB = charsOf($('#sbHl'));

  // answer prose: words, bold names, citation chips
  const ITEMS = (() => {
    const p = D.sqProse, items = [];
    const add = (s, cls) => { const e = make('span', 'w' + (cls ? ' ' + cls : ''), s); p.append(e); items.push({ el: e, kind: 'w' }); };
    const re = /\*\*(.+?)\*\*|\[(\d)\]|(\s+)|([^\s*[]+)/g;
    let m;
    while ((m = re.exec(ANSWER))) {
      if (m[1]) m[1].split(' ').forEach((wd, i, a) => { add(wd, 'b'); if (i < a.length - 1) p.append(' '); });
      else if (m[2]) { const e = make('span', 'cite', m[2]); p.append(e); items.push({ el: e, kind: 'cite' }); }
      else if (m[3]) p.append(' ');
      else add(m[4]);
    }
    let tt = T.stream0;
    items.forEach(it => { if (it.kind === 'w') { it.t = tt; tt += 0.045; } else it.t = tt - 0.012; });
    return items;
  })();

  const TYPE_T = (() => {
    const rng = mulberry32(11), out = [];
    let tt = T.type0;
    for (let i = 0; i < QUERY.length; i++) {
      out.push(tt);
      tt += 0.027 + rng() * 0.022 + (QUERY[i] === ' ' ? 0.018 : 0);
    }
    return out;
  })();

  // ten blue links
  const LINKS = (() => {
    const rng = mulberry32(42), rows = [];
    for (let i = 0; i < 10; i++) {
      const r = make('div', 'lk');
      r.append(make('i'), make('b'), make('s'));
      r.children[1].style.width = (50 + rng() * 44) + '%';
      r.children[2].style.width = (26 + rng() * 30) + '%';
      D.ssLinks.insertBefore(r, D.ssBlock);
      rows.push(r);
    }
    return rows;
  })();

  // live citation feed
  const ROWS = FEED.map(([eng, q, pos], i) => {
    const r = make('div', 'row');
    const e = make('div', 'row__eng', eng); e.append(make('em', null, ['now', '1s ago', '2s ago'][i % 3]));
    const b = make('div', 'row__pos' + (pos === 1 ? ' is-one' : ''), `[${pos}]`);
    r.append(e, b, make('div', 'row__q', q));
    D.srRows.append(r);
    return r;
  });

  // ─────────────────────────────────────────────── radar data

  const DOTS = [];
  const HITS = [];
  (() => {
    const rng = mulberry32(7);
    const taken = [];
    const slotA = s => THETA0 + (TAU * s) / 32;
    PATTERN_A.forEach(([s, ring]) => { DOTS.push({ ring, a: slotA(s), cite: 1, slot: s }); taken.push([ring, slotA(s)]); });
    PATTERN_B.forEach(([s, ring]) => { DOTS.push({ ring, a: slotA(s), cite: 2, slot: s }); taken.push([ring, slotA(s)]); });
    const counts = [7, 9, 11, 13, 15, 17];
    counts.forEach((n, ring) => {
      for (let i = 0; i < n; i++) {
        let a, ok, guard = 0;
        do {
          a = rng() * TAU; ok = true;
          for (const [r2_, b] of taken) if (r2_ === ring && Math.abs(mod(a - b + Math.PI, TAU) - Math.PI) < 0.16) ok = false;
        } while (!ok && ++guard < 40);
        taken.push([ring, a]);
        DOTS.push({ ring, a, cite: 0 });
      }
    });
    DOTS.forEach((d, i) => {
      d.seed = hash(i, 3);
      d.h = 0.65 + hash(i, 5) * 0.55;
      d.hits = [];
      if (d.cite) {
        const rots = d.cite === 1 ? [0, 1] : [1];
        rots.forEach(n => d.hits.push(SWEEP_T0 + d.slot * 0.125 + n * SWEEP_PERIOD));
        if (d.cite === 1 && d.slot === 0) d.hits.push(SWEEP_T0 + 2 * SWEEP_PERIOD);
        d.hits.forEach(t => HITS.push({ t, ring: d.ring, dot: d }));
      }
    });
    HITS.sort((a, b) => a.t - b.t);
  })();
  const hitsBefore = t => { let n = 0; for (const h of HITS) if (h.t <= t) n++; else break; return n; };
  const lastHitBefore = t => { let l = -1e9; for (const h of HITS) if (h.t <= t) l = h.t; else break; return l; };

  // ─────────────────────────────────────────────── layout state

  let fmt = 'landscape', G = GEO.landscape, scale = 1, Q = 1;
  const M = {}; // measurements in stage pixels

  function offsetIn(el, root) {
    let x = 0, y = 0, e = el;
    while (e && e !== root) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function catmull(pts, steps) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const u = s / steps, u2 = u * u, u3 = u2 * u;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
        });
      }
    }
    out.push({ ...pts[pts.length - 1] });
    return out;
  }
  const chartY = v => G.chart.base - (v / 40) * (G.chart.base - G.chart.top);
  const chartX = i => lerp(G.chart.x0, G.chart.x1, i / 11);
  function curveAt(c, u) {
    const f = clamp(u) * (c.length - 1), i = Math.floor(f), k = f - i;
    const a = c[i], b = c[Math.min(c.length - 1, i + 1)];
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
  }
  const invInOutSine = u => Math.acos(1 - 2 * u) / Math.PI;

  function measure() {
    // reset everything that changes layout, then read offsets (transform-free)
    $$('.c, .w', stage).forEach(e => { e.style.cssText = ''; e.__s = {}; });

    const mk = G.mark, mw = (mk.h * 160) / 140;
    Object.assign(D.mkMark.style, { left: mk.x - mw / 2 + 'px', top: mk.y - mk.h / 2 + 'px', width: mw + 'px', height: mk.h + 'px' });
    M.dotMark = (mk.h / 140) * 17;

    M.hl = offsetIn(D.ssHlBg, stage);
    M.swipes = [[$('#ssHl'), D.ssHlBg, K.ssCited], [$('#sbHl'), D.sbHlBg, K.sbTagB]].map(([hl, bgEl, chars]) => ({
      bg: offsetIn(bgEl, hl), chars: chars.map(c => offsetIn(c, hl)),
    }));

    const cam = offsetIn(D.sqCam, stage);
    const origin = getComputedStyle(D.sqCam).transformOrigin.split(' ').map(parseFloat);
    M.cam = { x: cam.x, y: cam.y, ox: origin[0], oy: origin[1] };
    const pill = offsetIn(D.sqPill, D.sqCam);
    M.pillDrop = G.H / 2 - (pill.y + pill.h / 2);

    const prose = offsetIn(D.sqProse, D.sqCam);
    const rng = mulberry32(5);
    M.parts = [];
    ITEMS.forEach(it => {
      const r = offsetIn(it.el, D.sqCam);
      const nx = (r.x - prose.x) / prose.w, ny = (r.y - prose.y) / Math.max(1, prose.h);
      it.out = T.dissolve + nx * 0.42 + ny * 0.14;
      const n = it.kind === 'cite' ? 5 : Math.max(3, Math.min(16, Math.round(r.w / 11)));
      for (let i = 0; i < n; i++) {
        M.parts.push({
          x: r.x + rng() * r.w, y: r.y + r.h * (0.25 + rng() * 0.55), t: it.out + rng() * 0.12,
          vx: 40 + rng() * 170, vy: -(30 + rng() * 130), ph: rng() * TAU, life: 0.8 + rng() * 0.7,
          s: 2 + rng() * 5, c: it.kind === 'cite' || rng() < 0.18 ? RGB.ice : RGB.paper,
        });
      }
    });

    const blk = offsetIn(D.ssBlock, D.ssLinks);
    M.linkCenter = blk.y + blk.h / 2 - LINKS[0].offsetHeight / 2;
    M.linkGap = (D.ssLinks.offsetHeight - LINKS[0].offsetHeight) / 9;

    D.sbLock.style.justifyContent = ''; D.sbLock.style.paddingLeft = '';
    const sbm = offsetIn(D.sbMark, stage);
    if (fmt === 'landscape') {
      D.sbLock.style.justifyContent = 'flex-start';
      D.sbLock.style.paddingLeft = sbm.x - offsetIn(D.sbLock, stage).x + 'px';
    }
    M.markRest = { x: sbm.x + sbm.w / 2, y: sbm.y + sbm.h / 2 };
    M.dotBrand = (sbm.h / 140) * 17;
    M.markStart = fmt === 'portrait' ? { x: G.W / 2, y: M.markRest.y + 150 } : { x: G.W / 2, y: M.markRest.y };

    const steps = 22;
    M.curves = {};
    for (const k in SERIES) M.curves[k] = catmull(SERIES[k].map((v, i) => ({ x: chartX(i), y: chartY(v) })), steps);
    const you = M.curves.you, led = M.curves.ledger;
    let ic = you.findIndex((p, i) => p.y <= led[i].y);
    M.cross = { i: ic, p: you[ic], u: ic / (you.length - 1) };
    M.cross.t = LINE_T0 + (LINE_T1 - LINE_T0) * invInOutSine(M.cross.u);

    D.mkMeta.__t = null;
  }

  // ─────────────────────────────────────────────── sprites

  function glowSprite(rgb, size = 256, stops = [[0, 1], [0.1, 0.62], [0.28, 0.2], [0.55, 0.05], [1, 0]]) {
    const cv = make('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(${rgb},${a})`));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return cv;
  }
  function pillarSprite(rgb) {
    const w = 64, h = 512, cv = make('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), img = g.createImageData(w, h), [r, gg, b] = rgb.split(',').map(Number);
    for (let y = 0; y < h; y++) {
      const vy = Math.pow(y / (h - 1), 1.8);
      for (let x = 0; x < w; x++) {
        const dx = (x - w / 2 + 0.5) / (w * 0.5);
        const gx = Math.exp(-dx * dx * 9) * 0.7 + Math.exp(-dx * dx * 120) * 0.6;
        const i = (y * w + x) * 4;
        img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = Math.min(255, 255 * gx * vy);
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  const SPR = {
    sig: glowSprite(RGB.sig), ice: glowSprite(RGB.ice), paper: glowSprite(RGB.paper),
    soft: glowSprite(RGB.cobalt, 256, [[0, 1], [0.45, 0.4], [1, 0]]),
    gold: glowSprite(RGB.sig, 256, [[0, 1], [0.4, 0.35], [1, 0]]),
    pillar: pillarSprite(RGB.sig),
  };
  function sprite(c, s, x, y, size, a = 1) {
    if (a <= 0.003 || size <= 0.5) return;
    c.globalAlpha = Math.min(1, a);
    c.drawImage(s, x - size / 2, y - size / 2, size, size);
    c.globalAlpha = 1;
  }

  const rayCv = make('canvas'); rayCv.width = rayCv.height = 512;
  const rx = rayCv.getContext('2d');
  function rays(c, x, y, R, rot, alpha, rgb = RGB.sig, n = 22) {
    if (alpha <= 0.003) return;
    rx.globalCompositeOperation = 'source-over';
    rx.clearRect(0, 0, 512, 512);
    const g = rx.createConicGradient(rot, 256, 256);
    for (let i = 0; i < n; i++) {
      const a = i / n, w = (0.25 + hash(i, 9) * 0.5) / n, s = 0.35 + hash(i, 4) * 0.65;
      g.addColorStop(a, `rgba(${rgb},0)`);
      g.addColorStop(a + w * 0.5, `rgba(${rgb},${s})`);
      g.addColorStop(a + w, `rgba(${rgb},0)`);
    }
    g.addColorStop(1, `rgba(${rgb},0)`);
    rx.fillStyle = g; rx.fillRect(0, 0, 512, 512);
    rx.globalCompositeOperation = 'destination-in';
    const m = rx.createRadialGradient(256, 256, 0, 256, 256, 256);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.2, 'rgba(0,0,0,.55)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    rx.fillStyle = m; rx.fillRect(0, 0, 512, 512);
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, alpha);
    c.drawImage(rayCv, x - R, y - R, 2 * R, 2 * R);
    c.restore();
  }

  const grainURL = (() => {
    const s = 192, cv = make('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d'), img = g.createImageData(s, s), rng = mulberry32(99);
    for (let i = 0; i < s * s; i++) { const v = (rng() * 255) | 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  })();
  D.grain.style.backgroundImage = `url(${grainURL})`;

  const DUST = (() => { const rng = mulberry32(3); return Array.from({ length: 170 }, () => ({ x: rng(), y: rng(), z: 0.3 + rng() * 0.7, ph: rng() * TAU, f: 0.6 + rng() * 1.6 })); })();
  const SPARKS = (() => { const rng = mulberry32(21); return Array.from({ length: 64 }, () => ({ a: rng() * TAU, v: 260 + rng() * 620, s: 2 + rng() * 6, l: 0.7 + rng() * 0.9 })); })();

  // ─────────────────────────────────────────────── kinetic type

  function kinetic(chars, t, tIn, tOut, o = {}) {
    const st = o.stagger ?? 0.02, dur = o.dur ?? 0.72, wf = o.wFrom ?? 62, wt = o.wTo ?? 100;
    const ost = o.outStagger ?? 0.008, odur = o.outDur ?? 0.42;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i], t0 = tIn + i * st;
      let y = (1 - E.outExpo(seg(t, t0, t0 + dur))) * 115;
      if (tOut != null && t >= tOut) y -= E.inCubic(seg(t, tOut + i * ost, tOut + i * ost + odur)) * 115;
      css(c, 'transform', y === 0 ? 'none' : `translate3d(0,${y.toFixed(2)}%,0)`);
      if (wf !== wt) css(c, 'fontStretch', lerp(wf, wt, E.outQuart(seg(t, t0, t0 + dur * 1.25))).toFixed(1) + '%');
    }
  }

  // ─────────────────────────────────────────────── scene: question

  function updQuery(t) {
    const on = t < 7.95; vis(D.sQuery, on); if (!on) return;
    tr(D.sqCam, 0, 0, 1 + 0.05 * E.inOutSine(seg(t, 0, 7.6)));

    const pin = E.outExpo(seg(t, 0.25, 1.05));
    const lift = E.inOutCubic(seg(t, 3.0, 3.75));
    const pout = E.inCubic(seg(t, 6.85, 7.4));
    tr(D.sqPill, 0, (1 - lift) * M.pillDrop + (1 - pin) * 26 - pout * 18, (0.95 + 0.05 * pin) * (1 - 0.02 * pout));
    op(D.sqPill, pin * (1 - pout));
    css(D.sqPill, 'filter', pout > 0.02 ? `blur(${(pout * 10).toFixed(1)}px)` : 'none');

    let n = 0; while (n < TYPE_T.length && TYPE_T[n] <= t) n++;
    txt(D.sqTyped, QUERY.slice(0, n));
    const typing = t >= T.type0 - 0.1 && t < TYPE_T[TYPE_T.length - 1] + 0.12;
    op(D.sqCaret, t >= T.send ? 0 : (typing || Math.floor(t * 2.4) % 2 === 0 ? 1 : 0) * pin);
    const press = Math.sin(Math.PI * seg(t, T.send, T.send + 0.26));
    tr(D.sqSend, 0, 0, 1 - 0.14 * press);
    css(D.sqSend, 'boxShadow', `0 0 ${r2(40 * press)}px rgba(238,241,251,${(0.6 * press).toFixed(3)})`);

    const lab = E.outCubic(seg(t, 3.35, 3.8));
    op(D.sqLabel, lab * (1 - pout));
    tr(D.sqLabel, 0, (1 - lab) * 12);
    const sh = seg(t, 3.4, 4.9);
    tr(D.sqShimmer, -150 + 450 * ((sh * 2) % 1), 0);
    op(D.sqShimmer, sh > 0 && sh < 1 ? 1 : 0);

    for (const it of ITEMS) {
      let a, y, b, s = 1;
      if (it.kind === 'cite') {
        s = 0.3 + 0.7 * E.outBack(seg(t, it.t, it.t + 0.42));
        a = clamp(seg(t, it.t, it.t + 0.18)); y = 0; b = 0;
      } else {
        const k = E.outCubic(seg(t, it.t, it.t + 0.34));
        a = k; y = (1 - k) * 14; b = (1 - k) * 8;
      }
      const d = seg(t, it.out, it.out + 0.24);
      if (d > 0) { a *= 1 - d; b += d * 7; y -= d * 8; }
      op(it.el, a);
      tr(it.el, 0, y, s);
      css(it.el, 'filter', b > 0.05 ? `blur(${b.toFixed(1)}px)` : 'none');
    }

    D.srcs.forEach((el, i) => {
      const k = E.outExpo(seg(t, 5.25 + i * 0.14, 6.05 + i * 0.14));
      const o = E.inCubic(seg(t, 6.9 + i * 0.07, 7.45 + i * 0.07));
      op(el, k * (1 - o));
      tr(el, 0, (1 - k) * 28 - o * 12);
      css(el, 'filter', o > 0.02 ? `blur(${(o * 9).toFixed(1)}px)` : 'none');
    });
  }

  // ─────────────────────────────────────────────── scene: shift

  // glyphs left of the swipe edge read dark on yellow, the rest stay light
  function inkSwipe(chars, geo, k) {
    const edge = geo.bg.x + k * geo.bg.w;
    chars.forEach((c, i) => {
      const g = geo.chars[i], p = clamp((edge - g.x) / Math.max(1, g.w)) * 100;
      if (p <= 0) { css(c, 'backgroundImage', 'none'); css(c, 'color', ''); return; }
      if (p >= 100) { css(c, 'backgroundImage', 'none'); css(c, 'color', '#04061a'); return; }
      css(c, 'color', 'transparent');
      css(c, 'backgroundImage', `linear-gradient(90deg,#04061a ${p.toFixed(2)}%,#eef1fb ${p.toFixed(2)}%)`);
    });
  }

  function updShift(t) {
    const on = t >= 6.95 && t < 14.35; vis(D.sShift, on); if (!on) return;
    const S = K.ss;
    kinetic(S[0].small, t, 7.22, 9.42, { stagger: 0.012, dur: 0.6, wFrom: 100 });
    kinetic(S[0].big, t, 7.36, 9.46, { stagger: 0.026, dur: 0.78 });
    kinetic(S[1].small, t, 9.78, 11.6, { stagger: 0.012, dur: 0.6, wFrom: 100 });
    kinetic(S[1].big, t, 9.9, 11.64, { stagger: 0.026, dur: 0.78 });
    kinetic(S[2].small, t, 11.84, 13.92, { stagger: 0.012, dur: 0.6, wFrom: 100 });
    kinetic(K.ssWho, t, 11.98, 13.96, { stagger: 0.026, dur: 0.78 });
    kinetic(K.ssCited, t, 12.2, null, { stagger: 0.026, dur: 0.78 });

    const sw = E.inOutCubic(seg(t, 12.75, 13.2));
    css(D.ssHlBg, 'transform', `scaleX(${sw.toFixed(4)})`);
    op(D.ssHlBg, t < 14.2 ? 1 : 0);
    const fade = 1 - seg(t, 13.98, 14.18);
    inkSwipe(K.ssCited, M.swipes[0], sw);
    K.ssCited.forEach(c => op(c, fade));

    LINKS.forEach((r, i) => {
      const k = E.outExpo(seg(t, 7.2 + i * 0.075, 7.95 + i * 0.075));
      const dl = Math.abs(i - 4.5) * 0.04;
      const col = E.inOutCubic(seg(t, 9.25 + dl, 9.95 + dl));
      op(r, k * (1 - col));
      tr(r, (1 - k) * 80, lerp(i * M.linkGap, M.linkCenter, col), 1, ` scaleY(${(1 - 0.75 * col).toFixed(3)})`);
    });

    const bk = E.outExpo(seg(t, 9.82, 10.55)), bo = E.inCubic(seg(t, 13.4, 14.0));
    op(D.ssBlock, clamp(bk * 2.2) * (1 - bo));
    css(D.ssBlock, 'transform', `scale(${(1 - 0.05 * bo).toFixed(4)},${((0.04 + 0.96 * bk) * (1 - 0.05 * bo)).toFixed(4)})`);
    D.ssSk.forEach((e, i) => {
      const k = E.outExpo(seg(t, 10.1 + i * 0.09, 10.8 + i * 0.09));
      css(e, 'transform', `scaleX(${k.toFixed(4)})`); css(e, 'transformOrigin', '0 50%'); op(e, k);
    });
    D.ssChips.forEach((e, i) => {
      const k = E.outBack(seg(t, 10.35 + i * 0.09, 10.8 + i * 0.09));
      tr(e, 0, 0, Math.max(0, k)); op(e, clamp(k * 2));
      if (i === 0) e.classList.toggle('is-hot', t >= 12.95);
    });
  }

  // ─────────────────────────────────────────────── scene: mark

  function decode(str, t, t0, per = 0.021) {
    const glyphs = '01/\\|-+*#%<>=_[]';
    let out = '', k = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === ' ' || ch === '\n') { out += ch; continue; }
      const r = t0 + k * per; k++;
      if (t >= r) out += ch;
      else if (t >= r - 0.32) out += glyphs[(hash(i, Math.floor(t * 36)) * glyphs.length) | 0];
      else out += ' ';
    }
    return out;
  }

  function updMark(t) {
    const on = t >= 14.85 && t < 19.6; vis(D.sMark, on); if (!on) return;
    const kin = E.outExpo(seg(t, 14.95, 15.5));
    const snap = t > 15.5 ? -6 * Math.exp(-(t - 15.5) * 7) * Math.cos((t - 15.5) * 26) : 0;
    const kout = E.inCubic(seg(t, 18.85, 19.5));
    const off = (1 - kin) * 200 + snap + kout * 300;
    css(D.mkBr[0], 'transform', `translate(${r2(-off)}px,0)`);
    css(D.mkBr[1], 'transform', `translate(${r2(off)}px,0)`);
    op(D.mkMark, clamp(kin * 1.8) * (1 - kout));
    tr(D.mkMark, 0, 0, 1 + kout * 0.6);

    kinetic(K.mk1, t, 15.75, 18.7, { stagger: 0.014, dur: 0.7, wFrom: 82, outStagger: 0.004 });
    kinetic(K.mk2, t, 16.0, 18.74, { stagger: 0.02, dur: 0.78, wFrom: 62, outStagger: 0.004 });

    txt(D.mkMeta, decode(G.meta, t, 16.9));
    op(D.mkMeta, 1 - seg(t, 18.65, 18.95));
  }

  // ─────────────────────────────────────────────── scene: radar (DOM)

  function updRadar(t) {
    const on = t >= 20.55 && t < 30.6; vis(D.sRadar, on); if (!on) return;
    K.sr.forEach((chars, i) => kinetic(chars, t, 20.7 + i * 0.16, 29.95 + i * 0.04, { stagger: 0.016, dur: 0.72, wFrom: i === 2 ? 62 : 90 }));

    const k = E.outExpo(seg(t, 21.9, 22.8)), o = E.inCubic(seg(t, 30.0, 30.45));
    op(D.srPanel, k * (1 - o));
    tr(D.srPanel, (1 - k) * 46 + o * 20, 0);

    txt(D.srNum, (COUNT0 + hitsBefore(t)).toLocaleString('en-US'));
    const fl = Math.exp(-(t - lastHitBefore(t)) * 11);
    css(D.srNum, 'color', `rgb(${Math.round(lerp(238, 255, fl))},${Math.round(lerp(241, 228, fl))},${Math.round(lerp(251, 94, fl))})`);

    const max = G.feedRows;
    ROWS.forEach((r, i) => {
      const ti = ROW_T[i];
      if (t < ti) { op(r, 0); return; }
      let y = 0;
      for (let j = i + 1; j < ROW_T.length; j++) if (ROW_T[j] <= t) y += ROW_H * E.outExpo(seg(t, ROW_T[j], ROW_T[j] + 0.42));
      const a = E.outCubic(seg(t, ti + 0.14, ti + 0.6));
      op(r, a * (1 - seg(y, (max - 1) * ROW_H, max * ROW_H)));
      tr(r, (1 - a) * 18, y - (1 - a) * 22);
    });
  }

  // ─────────────────────────────────────────────── scene: proof (DOM)

  function updProof(t) {
    const on = t >= 30.6 && t < 38.6; vis(D.sProof, on); if (!on) return;
    kinetic(K.spA, t, 30.75, 37.92, { stagger: 0.011, dur: 0.7, wFrom: 100, outStagger: 0.004 });
    kinetic(K.spB, t, 34.25, 37.96, { stagger: 0.03, dur: 0.8, wFrom: 62, outStagger: 0.006 });

    const out = E.inCubic(seg(t, 37.85, 38.35));
    D.spKpis.forEach((el, i) => {
      const t0 = 33.25 + i * 0.36, k = E.outExpo(seg(t, t0, t0 + 0.8)), c = E.outCubic(seg(t, t0, t0 + 1.0));
      op(el, k * (1 - out));
      tr(el, 0, (1 - k) * 30 - out * 14);
      const n = D.spNums[i];
      txt(n, i === 0 ? lerp(1, 5.1, c).toFixed(1) + '×' : i === 1 ? lerp(6, 1.8, c).toFixed(1) : Math.round(lerp(0, 38, c)) + '/50');
    });
    op(D.spNote, E.outCubic(seg(t, 34.5, 35.1)) * (1 - out));
  }

  // ─────────────────────────────────────────────── scene: brand (DOM)

  function markCenterAt(t) {
    const k = E.inOutExpo(seg(t, 39.65, 40.6));
    return { x: lerp(M.markStart.x, M.markRest.x, k), y: lerp(M.markStart.y, M.markRest.y, k) };
  }
  const SLAM = 39.5;

  function updBrand(t) {
    const on = t >= 38.95; vis(D.sBrand, on); if (!on) return;
    const mc = markCenterAt(t);
    tr(D.sbLock, mc.x - M.markRest.x, mc.y - M.markRest.y);
    const ks = E.inQuad(seg(t, SLAM - 0.22, SLAM));
    const wob = t > SLAM ? -7 * Math.exp(-(t - SLAM) * 8) * Math.cos((t - SLAM) * 30) : 0;
    const off = (1 - ks) * 230 + wob;
    css(D.sbBr[0], 'transform', `translate(${r2(-off)}px,0)`);
    css(D.sbBr[1], 'transform', `translate(${r2(off)}px,0)`);
    op(D.sbMark, seg(t, SLAM - 0.22, SLAM - 0.14));

    kinetic(K.sbWord, t, 39.74, null, { stagger: 0.034, dur: 0.85, wFrom: 62, wTo: 108 });
    kinetic(K.sbTagA, t, 40.75, null, { stagger: 0.02, dur: 0.8, wFrom: 100 });
    kinetic(K.sbTagB, t, 40.92, null, { stagger: 0.022, dur: 0.8, wFrom: 100 });
    const sw = E.inOutCubic(seg(t, 41.45, 41.9));
    css(D.sbHlBg, 'transform', `scaleX(${sw.toFixed(4)})`);
    inkSwipe(K.sbTagB, M.swipes[1], sw);

    const kc = E.outExpo(seg(t, 41.95, 42.75));
    op(D.sbCta, kc); tr(D.sbCta, 0, (1 - kc) * 18);
  }

  // ─────────────────────────────────────────────── canvas: atmosphere

  const BG_KEYS = [[0, 0.5], [6, 0.7], [8, 0.55], [14, 0.62], [16, 0.75], [20, 0.95], [29, 1], [31, 0.72], [38, 0.7], [39.6, 1.05], [45, 0.95]];
  const bgLevel = t => {
    for (let i = 1; i < BG_KEYS.length; i++) if (t <= BG_KEYS[i][0]) {
      const [a, va] = BG_KEYS[i - 1], [b, vb] = BG_KEYS[i];
      return lerp(va, vb, E.inOutSine(seg(t, a, b)));
    }
    return BG_KEYS[BG_KEYS.length - 1][1];
  };

  function drawAtmosphere(c, t) {
    const { W, H } = G, I = bgLevel(t), big = Math.max(W, H);
    c.fillStyle = '#04061a'; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    sprite(c, SPR.soft, W * 0.5, H * 1.08, big * 1.7, 0.36 * I);
    sprite(c, SPR.soft, W * (0.18 + 0.05 * Math.sin(t * 0.11)), H * (0.24 + 0.04 * Math.cos(t * 0.09)), big * 0.9, 0.14 * I);
    sprite(c, SPR.soft, W * (0.86 + 0.04 * Math.cos(t * 0.08)), H * (0.7 + 0.05 * Math.sin(t * 0.07)), big * 0.85, 0.12 * I);
    // the brand's warmth arrives at the end
    const warm = seg(t, 39.3, 41) * (1 - seg(t, 44.4, 45));
    if (warm > 0) sprite(c, SPR.gold, W / 2, G.H * 0.48, big * 1.1, 0.07 * warm);
    // dust
    for (let i = 0; i < DUST.length; i++) {
      const d = DUST[i];
      const x = mod(d.x * W + Math.sin(t * 0.3 * d.f + d.ph) * 14 + t * 6 * d.z, W);
      const y = mod(d.y * H - t * (8 + 16 * d.z), H);
      const tw = 0.5 + 0.5 * Math.sin(t * d.f * 1.7 + d.ph);
      sprite(c, SPR.paper, x, y, 3 + 7 * d.z, (0.05 + 0.2 * tw) * d.z * (0.6 + 0.4 * I));
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ─────────────────────────────────────────────── canvas: radar

  function radarFrame(t) {
    const g = G, km = E.inOutCubic(seg(t, 20.4, 21.95));
    let cx = lerp(g.radar0.x, g.radar.x, km), cy = lerp(g.radar0.y, g.radar.y, km);
    let tilt = 64 * DEG * km, s = 1;
    const kf = E.inOutCubic(seg(t, 30.2, 31.0));
    if (kf > 0) {
      const ch = g.chart;
      tilt = lerp(64 * DEG, 90 * DEG, kf);
      cx = lerp(cx, (ch.x0 + ch.x1) / 2, kf);
      cy = lerp(cy, ch.base, kf);
      s = lerp(1, (ch.x1 - ch.x0) / (2 * g.radar.rMax), kf);
    }
    return { cx, cy, tilt, s, yaw: 0.045 * (t - 19.3) - 0.35 };
  }
  const ringR = k => lerp(G.radar.rMin, G.radar.rMax, k / 5);
  const sweepAngle = t => THETA0 + OMEGA * (t - SWEEP_T0);

  function drawRadar(c, t) {
    if (t < 19.25 || t > 31.3) return;
    const { cx, cy, tilt, s, yaw } = radarFrame(t);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const rMax = G.radar.rMax;
    const P = (r, a) => [cx + s * r * Math.cos(a + yaw), cy + s * r * Math.sin(a + yaw) * ct];
    const out = 1 - E.inOutCubic(seg(t, 30.2, 30.85));
    const ringFade = 1 - seg(t, 30.9, 31.2);
    const swA = win(t, 21.45, 22.0, 29.95, 30.4);

    // disc glow
    if (ct > 0.02) {
      c.save(); c.translate(cx, cy); c.scale(1, ct);
      const gr = c.createRadialGradient(0, 0, 0, 0, 0, rMax * s * 1.05);
      const a = 0.22 * E.outCubic(seg(t, 19.4, 20.6)) * out;
      gr.addColorStop(0, `rgba(42,63,208,${a})`); gr.addColorStop(0.7, `rgba(42,63,208,${a * 0.35})`); gr.addColorStop(1, 'rgba(42,63,208,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(0, 0, rMax * s * 1.05, 0, TAU); c.fill();
      c.restore();
    }

    // rings
    c.lineWidth = 1.3;
    for (let k = 0; k < 6; k++) {
      const e = E.outExpo(seg(t, 19.3 + k * 0.075, 20.6 + k * 0.075));
      if (e <= 0) continue;
      const r = ringR(k) * (0.18 + 0.82 * e) * s;
      const a = (k === 5 ? 0.42 : 0.2 + k * 0.02) * clamp(e * 1.4) * ringFade;
      c.strokeStyle = `rgba(156,188,255,${a})`;
      c.beginPath(); c.ellipse(cx, cy, r, Math.max(0.01, r * ct), 0, 0, TAU); c.stroke();
    }

    // outer tick ring
    const tk = E.outCubic(seg(t, 20.2, 21.0)) * out;
    if (tk > 0) {
      c.lineWidth = 1;
      for (const front of [false, true]) {
        c.strokeStyle = `rgba(156,188,255,${(front ? 0.4 : 0.16) * tk})`;
        c.beginPath();
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * TAU;
          if ((Math.sin(a + yaw) > 0) !== front) continue;
          const [x1, y1] = P(rMax + 10, a), [x2, y2] = P(rMax + (i % 6 === 0 ? 30 : 18), a);
          c.moveTo(x1, y1); c.lineTo(x2, y2);
        }
        c.stroke();
      }
    }

    // sweep
    if (swA > 0 && out > 0) {
      const th = sweepAngle(t) + yaw, tail = 1.25;
      c.save(); c.translate(cx, cy); c.scale(s, s * Math.max(0.01, ct));
      const g = c.createConicGradient(th - tail, 0, 0);
      g.addColorStop(0, 'rgba(156,188,255,0)');
      g.addColorStop(tail / TAU, `rgba(156,188,255,${0.26 * swA * out})`);
      g.addColorStop(tail / TAU + 0.001, 'rgba(156,188,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, rMax + 8, th - tail, th); c.closePath(); c.fill();
      c.restore();
      const [ex, ey] = P(rMax + 8, sweepAngle(t));
      const lg = c.createLinearGradient(cx, cy, ex, ey);
      lg.addColorStop(0, `rgba(238,241,251,${0.1 * swA * out})`); lg.addColorStop(1, `rgba(238,241,251,${0.75 * swA * out})`);
      c.strokeStyle = lg; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(ex, ey); c.stroke();
    }

    // dots, ripples, pillars
    const th = sweepAngle(t);
    const pillars = [];
    c.globalCompositeOperation = 'lighter';
    for (const d of DOTS) {
      const e = E.outBack(seg(t, 20.85 + d.seed * 0.9, 21.3 + d.seed * 0.9));
      if (e <= 0) continue;
      const r = ringR(d.ring);
      const [x, y] = P(r, d.a);
      const depth = Math.sin(d.a + yaw) * st; // +1 = nearest the viewer
      let last = -1e9;
      for (const h of d.hits) if (h <= t) last = h;
      const age = t - last, lit = last > 0;
      const swAge = mod(th - d.a, TAU) / OMEGA;
      const flash = swA * Math.exp(-swAge * 3.5) * (t > 21.5 ? 1 : 0);
      const flare = lit ? Math.exp(-age * 2.4) : 0;
      const sz = (1 + 0.22 * depth) * Math.max(0, e);
      const a = (0.62 + 0.3 * depth) * out;
      if (lit) {
        sprite(c, SPR.sig, x, y, (16 + 70 * flare) * sz, (0.45 + 0.55 * flare) * a);
        sprite(c, SPR.paper, x, y, (6 + 10 * flare) * sz, (0.5 + 0.5 * flare) * a);
      } else {
        sprite(c, SPR.ice, x, y, (11 + 22 * flash) * sz, (0.35 + 0.5 * flash) * a);
      }
      if (lit && age < 1.1 && ct > 0.03) {
        const rr = (6 + 62 * E.outCubic(age / 1.1)) * s;
        c.strokeStyle = `rgba(255,228,94,${0.75 * Math.pow(1 - age / 1.1, 2) * out})`;
        c.lineWidth = 1.4;
        c.beginPath(); c.ellipse(x, y, rr, rr * ct, 0, 0, TAU); c.stroke();
      }
      if (lit && age < 1.9 && st > 0.2) pillars.push({ x, y, age, h: d.h, depth });
    }
    c.globalCompositeOperation = 'source-over';
    // solid cores on top of their glow
    for (const d of DOTS) {
      const e = E.outBack(seg(t, 20.85 + d.seed * 0.9, 21.3 + d.seed * 0.9));
      if (e <= 0) continue;
      const [x, y] = P(ringR(d.ring), d.a);
      let lit = false; for (const h of d.hits) if (h <= t) lit = true;
      const depth = Math.sin(d.a + yaw) * st;
      c.globalAlpha = (0.7 + 0.3 * depth) * out;
      c.fillStyle = lit ? '#ffe45e' : '#9cbcff';
      c.beginPath(); c.arc(x, y, (lit ? 3.6 : 2.6) * (1 + 0.25 * depth) * Math.max(0, e), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;

    c.globalCompositeOperation = 'lighter';
    for (const p of pillars) {
      const rise = E.outExpo(clamp(p.age / 0.28)), fade = Math.exp(-p.age * 2.1);
      const h = (150 + 170 * p.h) * st * s * rise * (1 + 0.15 * p.depth);
      const w = 30 * (1 + 0.2 * p.depth);
      c.globalAlpha = Math.min(1, fade * 1.1 * out);
      c.drawImage(SPR.pillar, p.x - w / 2, p.y - h, w, h);
      // citation thread back to the core
      if (p.age < 0.75) {
        c.globalAlpha = 1;
        c.strokeStyle = `rgba(255,228,94,${0.32 * (1 - p.age / 0.75) * out})`;
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(cx, cy); c.stroke();
      }
    }
    c.globalAlpha = 1;

    // the core's beacon
    let energy = 0;
    for (const h of HITS) if (h.t <= t && t - h.t < 1.5) energy += Math.exp(-(t - h.t) * 4);
    const beacon = E.outCubic(seg(t, 21.4, 22.4)) * out;
    if (beacon > 0) {
      const h = (300 + 60 * Math.min(2, energy)) * st;
      c.globalAlpha = Math.min(1, (0.35 + 0.25 * Math.min(2, energy)) * beacon);
      c.drawImage(SPR.pillar, cx - 26, cy - h, 52, h);
      c.globalAlpha = 1;
    }
    c.globalCompositeOperation = 'source-over';

    // engine labels at the front of each ring
    const la = win(t, 21.3, 21.9, 30.05, 30.4);
    if (la > 0) {
      const u = G.ui;
      c.font = `500 ${12 * u}px "Martian Mono", ui-monospace, monospace`;
      c.letterSpacing = 1.6 * u + 'px';
      c.textBaseline = 'middle';
      for (let k = 0; k < 6; k++) {
        const label = ENGINES[k].toUpperCase();
        const x = cx + 16, y = cy + s * ringR(k) * ct;
        const w = c.measureText(label).width + 18 * u;
        c.globalAlpha = la;
        c.fillStyle = 'rgba(4,6,26,.78)';
        c.beginPath(); c.roundRect(x, y - 11 * u, w, 22 * u, 11 * u); c.fill();
        c.strokeStyle = 'rgba(156,188,255,.22)'; c.lineWidth = 1; c.stroke();
        c.fillStyle = '#c4d3ff';
        c.fillText(label, x + 9 * u, y + 1);
      }
      c.globalAlpha = 1;
      c.letterSpacing = '0px';
    }
  }

  // ─────────────────────────────────────────────── canvas: chart

  function strokeCurve(c, pts, u) {
    const f = clamp(u) * (pts.length - 1), n = Math.floor(f);
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= n; i++) c.lineTo(pts[i].x, pts[i].y);
    const e = curveAt(pts, u); c.lineTo(e.x, e.y);
    return e;
  }

  function drawChart(c, t) {
    if (t < 30.7 || t > 38.7) return;
    const ch = G.chart, fade = 1 - E.inCubic(seg(t, 37.9, 38.45));
    const mono = '"Martian Mono", ui-monospace, monospace', u = G.ui, f13 = `500 ${13 * u}px ${mono}`;
    c.lineWidth = 1;

    // baseline the radar collapses into
    const kb = seg(t, 30.85, 31.15);
    c.strokeStyle = `rgba(156,188,255,${0.45 * kb * fade})`;
    c.beginPath(); c.moveTo(ch.x0, ch.base + 0.5); c.lineTo(ch.x1, ch.base + 0.5); c.stroke();

    // grid
    c.font = f13; c.textBaseline = 'middle';
    [10, 20, 30, 40].forEach((v, i) => {
      const k = E.outExpo(seg(t, 30.95 + i * 0.08, 31.7 + i * 0.08));
      if (k <= 0) return;
      const y = Math.round(chartY(v)) + 0.5;
      c.strokeStyle = `rgba(156,188,255,${0.13 * fade})`;
      c.setLineDash([2, 6]);
      c.beginPath(); c.moveTo(ch.x0, y); c.lineTo(lerp(ch.x0, ch.x1, k), y); c.stroke();
      c.setLineDash([]);
      c.fillStyle = `rgba(138,147,189,${k * fade})`; c.textAlign = 'right';
      c.fillText(v + '%', ch.x0 - 16 * u, y);
    });
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let i = 0; i < 12; i++) {
      const k = seg(t, 31.0 + i * 0.03, 31.4 + i * 0.03);
      c.fillStyle = `rgba(138,147,189,${0.85 * k * fade})`;
      c.fillText('W' + (i + 1), chartX(i), ch.base + 22 * u);
    }
    const ka = E.outCubic(seg(t, 31.0, 31.6));
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.font = f13; c.letterSpacing = 2 * u + 'px';
    c.fillStyle = `rgba(238,241,251,${0.9 * ka * fade})`;
    c.fillText('AI SHARE OF VOICE', ch.x0, ch.top - 40 * u);
    c.fillStyle = `rgba(138,147,189,${0.9 * ka * fade})`;
    c.fillText('WEEKLY · ALL ENGINES', ch.x0 + c.measureText('AI SHARE OF VOICE').width + 40 * u, ch.top - 40 * u);
    c.letterSpacing = '0px';

    // competitors
    const uc = E.inOutSine(seg(t, LINE_T0, LINE_T1 - 0.2));
    [['ledger', 'Ledgerline'], ['north', 'Northfield & Co.']].forEach(([key, name]) => {
      if (uc <= 0) return;
      c.strokeStyle = `rgba(156,188,255,${0.5 * fade})`; c.lineWidth = 2;
      const e = strokeCurve(c, M.curves[key], uc); c.stroke();
      const kl = seg(t, LINE_T1 - 0.3, LINE_T1 + 0.2);
      c.font = f13; c.textAlign = 'right';
      c.fillStyle = `rgba(156,188,255,${0.8 * kl * fade})`;
      c.fillText(name, e.x, e.y - 14 * u);
    });

    // you
    const up = E.inOutSine(seg(t, LINE_T0, LINE_T1));
    if (up > 0) {
      const pts = M.curves.you;
      c.save();
      const e = strokeCurve(c, pts, up);
      c.lineTo(e.x, ch.base); c.lineTo(pts[0].x, ch.base); c.closePath();
      const ag = c.createLinearGradient(0, ch.top, 0, ch.base);
      ag.addColorStop(0, `rgba(255,228,94,${0.3 * fade})`); ag.addColorStop(1, 'rgba(255,228,94,0)');
      c.fillStyle = ag; c.fill();
      c.restore();
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.globalCompositeOperation = 'lighter';
      [[16, 0.06], [7, 0.16]].forEach(([w, a]) => { c.strokeStyle = `rgba(255,228,94,${a * fade})`; c.lineWidth = w; strokeCurve(c, pts, up); c.stroke(); });
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = `rgba(255,228,94,${fade})`; c.lineWidth = 3;
      strokeCurve(c, pts, up); c.stroke();
      c.lineCap = 'butt';

      // running value at the head
      const idx = clamp(up) * 11, i0 = Math.floor(idx), val = lerp(SERIES.you[i0], SERIES.you[Math.min(11, i0 + 1)], idx - i0);
      const pop = E.outBack(seg(t, LINE_T1 - 0.05, LINE_T1 + 0.5));
      const size = (30 + 34 * pop) * (0.6 + 0.4 * u);
      c.font = `800 ${size.toFixed(1)}px "Archivo", sans-serif`;
      c.textAlign = 'right'; c.textBaseline = 'alphabetic';
      c.fillStyle = `rgba(255,228,94,${clamp(up * 6) * fade})`;
      c.fillText(Math.round(val) + '%', e.x - 18, e.y - 22);
      if (pop > 0) {
        c.font = f13;
        c.fillStyle = `rgba(238,241,251,${0.85 * clamp(pop) * fade})`;
        c.fillText('YOUR BRAND', e.x - 20, e.y - 22 - size - 4 * u);
      }

      // overtaking moment
      const kc = seg(t, M.cross.t, M.cross.t + 0.9);
      if (kc > 0) {
        const p = M.cross.p, ring = E.outCubic(kc);
        c.strokeStyle = `rgba(238,241,251,${0.8 * (1 - kc) * fade})`; c.lineWidth = 1.5;
        c.beginPath(); c.arc(p.x, p.y, 6 + 40 * ring, 0, TAU); c.stroke();
        const la = E.outCubic(seg(t, M.cross.t, M.cross.t + 0.4)) * fade;
        const ly = p.y - 78 * u;
        c.strokeStyle = `rgba(238,241,251,${0.4 * la})`; c.lineWidth = 1;
        c.beginPath(); c.moveTo(p.x, p.y - 12); c.lineTo(p.x, ly + 10); c.stroke();
        c.fillStyle = `rgba(238,241,251,${la})`;
        c.beginPath(); c.arc(p.x, p.y, 4, 0, TAU); c.fill();
        c.font = f13; c.textAlign = 'center'; c.letterSpacing = u + 'px';
        c.fillText('PASSED LEDGERLINE · WEEK 8', p.x, ly);
        c.letterSpacing = '0px';
      }
    }
    c.textAlign = 'left';
  }

  // ─────────────────────────────────────────────── canvas: the light

  function lightAt(t) {
    const g = G;
    if (t < 14.19) return null;
    if (t < 15.15) {
      const k = E.inOutExpo(seg(t, 14.2, 15.1)), R = M.hl, r = M.dotMark;
      const w = lerp(R.w, 2 * r, k), h = lerp(R.h, 2 * r, k);
      return { x: lerp(R.x + R.w / 2, g.mark.x, k), y: lerp(R.y + R.h / 2, g.mark.y, k), w, h, rad: lerp(R.h * 0.07, r, k), glow: k };
    }
    let x, y, r, glow = 1;
    if (t < 30.5) {
      const R = radarFrame(t), k = E.inOutCubic(seg(t, 18.9, 19.75));
      x = lerp(g.mark.x, R.cx, k); y = lerp(g.mark.y, R.cy, k); r = lerp(M.dotMark, 15, k);
    } else if (t < LINE_T0) {
      const R = radarFrame(t), k = E.inOutCubic(seg(t, 30.5, LINE_T0)), p0 = M.curves.you[0];
      x = lerp(R.cx, p0.x, k); y = lerp(R.cy, p0.y, k); r = lerp(15, 9, k);
    } else if (t < 38.3) {
      const p = curveAt(M.curves.you, E.inOutSine(seg(t, LINE_T0, LINE_T1)));
      x = p.x; y = p.y; r = 9;
    } else if (t < 39.1) {
      const k = E.inOutCubic(seg(t, 38.3, 39.1)), a = curveAt(M.curves.you, 1), b = M.markStart;
      const cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - 260;
      x = (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * cx + k * k * b.x;
      y = (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * cy + k * k * b.y;
      r = lerp(9, M.dotBrand, k); glow = 1 + 0.6 * Math.sin(Math.PI * k);
    } else {
      const p = markCenterAt(t); x = p.x; y = p.y; r = M.dotBrand;
    }
    return { x, y, w: 2 * r, h: 2 * r, rad: r, glow };
  }

  function drawLight(c, t) {
    const L = lightAt(t); if (!L) return;
    const r = Math.min(L.w, L.h) / 2;
    const ignite = t > 15.5 ? Math.exp(-(t - 15.5) * 2.2) : 0;
    const slam = t > SLAM ? Math.exp(-(t - SLAM) * 1.8) : 0;
    const breathe = 1 + 0.06 * Math.sin(t * 2.6);
    const bloom = L.glow * (1 + 2.2 * ignite + 2.6 * slam) * breathe;

    c.globalCompositeOperation = 'lighter';
    const moving = (t > 18.9 && t < 19.8) || (t > 30.5 && t < LINE_T0) || (t > 38.3 && t < 39.15);
    if (moving) {
      for (let i = 1; i <= 14; i++) {
        const P = lightAt(t - i * 0.011);
        if (P) sprite(c, SPR.sig, P.x, P.y, r * (4.2 - i * 0.18), 0.5 * Math.pow(1 - i / 15, 1.6));
      }
    }
    if (t >= 15.3 && t < 19.4) rays(c, L.x, L.y, 520 + 200 * ignite, t * 0.12, (0.2 + 0.5 * ignite) * (1 - seg(t, 18.8, 19.4)) * seg(t, 15.3, 15.55));
    if (t >= SLAM - 0.05) rays(c, L.x, L.y, 760 + 220 * slam, -t * 0.08, (0.15 + 0.36 * slam) * seg(t, SLAM - 0.05, SLAM + 0.1));
    sprite(c, SPR.sig, L.x, L.y, r * 22 * bloom, 0.42 * Math.min(1.6, bloom));
    sprite(c, SPR.sig, L.x, L.y, r * 6, 0.85 * L.glow);
    c.globalCompositeOperation = 'source-over';

    c.fillStyle = '#ffe45e';
    c.beginPath(); c.roundRect(L.x - L.w / 2, L.y - L.h / 2, L.w, L.h, Math.min(L.rad, L.w / 2, L.h / 2)); c.fill();
    c.globalCompositeOperation = 'lighter';
    sprite(c, SPR.paper, L.x, L.y, r * 2.4, 0.55 * L.glow);
    c.globalCompositeOperation = 'source-over';

    // shockwaves
    [[15.5, 380], [SLAM, 900]].forEach(([t0, R]) => {
      const a = t - t0;
      if (a < 0 || a > 1.4) return;
      const k = E.outCubic(a / 1.4);
      c.strokeStyle = `rgba(255,228,94,${0.55 * Math.pow(1 - a / 1.4, 2)})`;
      c.lineWidth = 2 * (1 - k) + 0.5;
      c.beginPath(); c.arc(L.x, L.y, 20 + R * k, 0, TAU); c.stroke();
    });
  }

  // ─────────────────────────────────────────────── canvas: foreground particles

  function drawFX(c, t) {
    // the answer dissolves into light
    if (t > T.dissolve - 0.1 && t < T.dissolve + 2.4) {
      const camS = 1 + 0.05 * E.inOutSine(seg(t, 0, 7.6)), cm = M.cam;
      c.globalCompositeOperation = 'lighter';
      for (const p of M.parts) {
        const a = t - p.t;
        if (a < 0 || a > p.life) continue;
        const lx = p.x + p.vx * a + Math.sin(a * 3 + p.ph) * 12, ly = p.y + p.vy * a - 40 * a * a;
        const x = cm.x + cm.ox + (lx - cm.ox) * camS, y = cm.y + cm.oy + (ly - cm.oy) * camS;
        const k = 1 - a / p.life;
        sprite(c, p.c === RGB.ice ? SPR.ice : SPR.paper, x, y, p.s * (0.6 + 0.6 * k) * 2.2, k * k * 0.9);
      }
      c.globalCompositeOperation = 'source-over';
    }
    // sparks when the logo locks
    const a = t - SLAM;
    if (a > 0 && a < 1.8) {
      const L = lightAt(t);
      c.globalCompositeOperation = 'lighter';
      for (const s of SPARKS) {
        if (a > s.l) continue;
        const d = (s.v * (1 - Math.exp(-a * 3))) / 3;
        const k = 1 - a / s.l;
        sprite(c, SPR.sig, L.x + Math.cos(s.a) * d, L.y + Math.sin(s.a) * d, s.s * 2.4, k * k);
      }
      c.globalCompositeOperation = 'source-over';
    }
  }

  // ─────────────────────────────────────────────── frame

  let lastT = -1;
  function render(t) {
    t = clamp(t, 0, DUR);
    lastT = t;
    updQuery(t); updShift(t); updMark(t); updRadar(t); updProof(t); updBrand(t);

    bgx.setTransform(Q, 0, 0, Q, 0, 0);
    drawAtmosphere(bgx, t);
    drawRadar(bgx, t);
    drawChart(bgx, t);
    drawLight(bgx, t);

    fxx.setTransform(1, 0, 0, 1, 0, 0);
    fxx.clearRect(0, 0, fx.width, fx.height);
    fxx.setTransform(Q, 0, 0, Q, 0, 0);
    drawFX(fxx, t);

    const f = Math.floor(t * 24);
    css(D.grain, 'transform', `translate3d(${Math.round(hash(f, 1) * 128 - 64)}px,${Math.round(hash(f, 2) * 128 - 64)}px,0)`);
    op(D.curtain, Math.max(1 - seg(t, 0, 0.55), E.inCubic(seg(t, 44.3, 45))));
  }

  // ─────────────────────────────────────────────── sizing

  function fit() {
    let s = 1;
    if (!RENDER) {
      const r = screenEl.getBoundingClientRect();
      s = Math.max(0.05, Math.min(r.width / G.W, r.height / G.H));
    }
    scale = s;
    frame.style.width = Math.floor(G.W * s) + 'px';
    frame.style.height = Math.floor(G.H * s) + 'px';
    stage.style.transform = s === 1 ? 'none' : `scale(${s})`;
    const q = RENDER ? 1 : clamp(s * (window.devicePixelRatio || 1), 0.5, 1);
    const w = Math.round(G.W * q), h = Math.round(G.H * q);
    if (bg.width !== w || bg.height !== h) { bg.width = fx.width = w; bg.height = fx.height = h; }
    Q = w / G.W;
  }

  function setFormat(f) {
    fmt = f; G = GEO[f];
    stage.dataset.format = f;
    $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.format === f)));
    fit();
    measure();
    render(state.t);
  }

  // ─────────────────────────────────────────────── player

  const state = { t: 0, playing: !RENDER, sound: false, prev: 0, audioOK: true };
  const ui = {
    play: $('#playBtn'), sound: $('#soundBtn'), soundLbl: $('#soundLbl'), fs: $('#fsBtn'),
    scrub: $('#scrub'), now: $('#tNow'), chapters: $('#chapters'), big: $('#bigPlay'),
  };
  const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  CHAPTERS.forEach(ch => {
    const b = make('button', null, ch.label);
    b.type = 'button';
    b.style.left = (ch.t / DUR) * 100 + '%';
    b.setAttribute('aria-label', `Jump to ${ch.label}`);
    b.addEventListener('click', () => seek(ch.t + 0.001));
    ui.chapters.append(b);
    ch.el = b;
  });

  function syncUI() {
    ui.now.textContent = fmtTime(state.t);
    ui.scrub.value = String(Math.round(state.t * 1000));
    ui.scrub.style.setProperty('--p', (state.t / DUR) * 100 + '%');
    ui.scrub.setAttribute('aria-valuetext', fmtTime(state.t));
    let cur = 0; CHAPTERS.forEach((c, i) => { if (state.t >= c.t) cur = i; });
    CHAPTERS.forEach((c, i) => c.el.classList.toggle('is-on', i === cur));
  }

  function seek(t) {
    state.t = clamp(t, 0, DUR - 0.001);
    if (state.sound) { try { audio.currentTime = state.t; } catch (e) { /* not seekable yet */ } }
    render(state.t); syncUI();
  }

  function setPlaying(p) {
    state.playing = p;
    app.classList.toggle('is-paused', !p);
    ui.play.setAttribute('aria-label', p ? 'Pause' : 'Play');
    ui.big.hidden = p;
    if (state.sound) { if (p) { audio.currentTime = state.t; audio.play().catch(() => {}); } else audio.pause(); }
  }

  function setSound(on) {
    if (on && !state.audioOK) return;
    state.sound = on;
    ui.sound.setAttribute('aria-pressed', String(on));
    ui.soundLbl.textContent = on ? 'Sound on' : 'Sound off';
    audio.muted = !on;
    if (on) {
      try { audio.currentTime = state.t; } catch (e) { /* ignore */ }
      if (state.playing) audio.play().catch(() => { state.sound = false; ui.sound.setAttribute('aria-pressed', 'false'); ui.soundLbl.textContent = 'Sound off'; });
    } else audio.pause();
  }

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - state.prev) / 1000 || 0);
    state.prev = now;
    if (!state.playing) return;
    let t = state.t + dt;
    if (state.sound && !audio.paused && !audio.seeking) {
      const at = audio.currentTime;
      if (Math.abs(at - t) > 0.07) t = at;
    }
    if (t >= DUR) {
      t = 0;
      if (state.sound) { audio.currentTime = 0; audio.play().catch(() => {}); }
    }
    state.t = t;
    render(t); syncUI();
  }

  function wireUI() {
    ui.play.addEventListener('click', () => setPlaying(!state.playing));
    ui.big.addEventListener('click', () => { if (state.t >= DUR - 0.05 || state.t === POSTER) seek(0); setPlaying(true); });
    ui.sound.addEventListener('click', () => setSound(!state.sound));
    ui.fs.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (app.requestFullscreen) app.requestFullscreen().catch(() => {});
    });
    ui.scrub.addEventListener('input', () => seek(Number(ui.scrub.value) / 1000));
    $$('.seg button').forEach(b => b.addEventListener('click', () => setFormat(b.dataset.format)));
    const sources = $$('source', audio);
    sources[sources.length - 1].addEventListener('error', () => { state.audioOK = false; ui.sound.disabled = true; ui.soundLbl.textContent = 'No sound'; });
    document.addEventListener('keydown', e => {
      if (e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') { e.preventDefault(); setPlaying(!state.playing); }
      else if (k === 'm') setSound(!state.sound);
      else if (k === 'f') ui.fs.click();
      else if (e.target === ui.scrub) return;
      else if (k === 'arrowright') seek(state.t + (e.shiftKey ? 1 / 30 : 2));
      else if (k === 'arrowleft') seek(state.t - (e.shiftKey ? 1 / 30 : 2));
      else if (k === 'home' || k === '0') seek(0);
      else if (/^[1-6]$/.test(k)) seek(CHAPTERS[Number(k) - 1].t + 0.001);
    });
    const ro = new ResizeObserver(() => { fit(); render(state.t); });
    ro.observe(screenEl);
  }

  // ─────────────────────────────────────────────── boot

  async function fontsReady() {
    const faces = ['400 40px Archivo', '800 40px Archivo', '300 40px Archivo', '400 40px Newsreader', '600 40px Newsreader', 'italic 300 40px Newsreader', '500 20px "Martian Mono"'];
    try {
      await Promise.race([
        Promise.all(faces.map(f => document.fonts.load(f, 'Aa1%·’'))).then(() => document.fonts.ready),
        new Promise(r => setTimeout(r, 6000)),
      ]);
    } catch (e) { /* fall back to system faces */ }
  }

  async function boot() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const f = params.get('format') || (!RENDER && innerHeight > innerWidth * 1.15 ? 'portrait' : 'landscape');
    fmt = f in GEO ? f : 'landscape'; G = GEO[fmt];
    stage.dataset.format = fmt;
    $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.format === fmt)));
    fit();
    await fontsReady();
    measure();

    window.__seek = t => render(t);
    window.__events = events;
    window.__geo = () => ({ W: G.W, H: G.H, format: fmt, duration: DUR });

    if (RENDER) { render(Number(params.get('t') || 0)); window.__ready = true; return; }

    wireUI();
    if (reduce) { state.t = POSTER; setPlaying(false); }
    else setPlaying(true);
    render(state.t); syncUI();
    requestAnimationFrame(now => { state.prev = now; tick(now); });
  }

  // timing data for the score, so sound lands exactly on picture
  function events() {
    const g = G;
    return {
      duration: DUR, bpm: 120,
      typing: TYPE_T,
      send: T.send,
      words: ITEMS.filter(i => i.kind === 'w').map(i => i.t),
      chips: ITEMS.filter(i => i.kind === 'cite').map(i => i.t),
      sources: [0, 1, 2].map(i => 5.25 + i * 0.14),
      dissolve: T.dissolve,
      links: LINKS.map((_, i) => 7.2 + i * 0.075),
      big: [7.36, 9.9, 11.98],
      collapse: 9.25, block: 9.82,
      swipes: [12.75, 41.45],
      morph: 14.2, ignite: 15.5, decode: [16.9, 16.9 + 40 * 0.021],
      copy: [15.75, 16.0],
      bracketsOut: 18.85, rings: 19.3, tilt: 20.4, headline: 20.7,
      hits: HITS.map(h => {
        const R = radarFrame(h.t), x = R.cx + R.s * ringR(h.ring) * Math.cos(h.dot.a + R.yaw);
        return { t: h.t, ring: h.ring, pan: clamp((x / g.W) * 2 - 1, -1, 1) };
      }),
      rows: ROW_T,
      flatten: 30.2, line: [LINE_T0, LINE_T1], cross: M.cross.t,
      kpis: [0, 1, 2].map(i => 33.25 + i * 0.36), grow: 34.25,
      fly: 38.3, slam: SLAM, word: 39.74, tag: 40.75, cta: 41.95, fadeOut: 44.3,
    };
  }

  boot();
})();
