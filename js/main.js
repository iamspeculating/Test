/* ═══════════════════════════════════════════════════════════════
   LUMENFORM — interaction engine
   vanilla JS: lerped smooth-scroll, WebGL hero, scroll-driven motion
   ═══════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ────────────────────────── text splitting ─────────────────── */

  $$("[data-split]").forEach((el) => {
    const text = el.textContent;
    el.textContent = "";
    el.setAttribute("aria-label", text);
    [...text].forEach((ch, i) => {
      const span = document.createElement("span");
      span.className = "ch";
      span.style.setProperty("--ci", i);
      span.textContent = ch === " " ? " " : ch;
      span.setAttribute("aria-hidden", "true");
      el.appendChild(span);
    });
  });

  const manifesto = $("#manifestoText");
  let manifestoWords = [];
  if (manifesto) {
    const words = manifesto.textContent.trim().split(/\s+/);
    manifesto.textContent = "";
    words.forEach((w, i) => {
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = w;
      manifesto.appendChild(span);
      if (i < words.length - 1) manifesto.appendChild(document.createTextNode(" "));
    });
    manifestoWords = $$(".w", manifesto);
  }

  /* ────────────────────────── smooth scroll ───────────────────
     Lenis-style: the wheel is intercepted and the *native* scroll
     position is lerped toward the target, so sticky/fixed/anchors
     all keep working. Touch, keyboard and scrollbar stay native. */

  const useSmooth = finePointer && !reduceMotion;

  let cur = scrollY;      // lerped scroll position every system reads from
  let target = scrollY;   // where the wheel wants to be
  let lastSet = -1;       // last position we wrote, to detect external scrolls

  const maxScroll = () => document.documentElement.scrollHeight - innerHeight;

  if (useSmooth) {
    addEventListener("wheel", (e) => {
      if (e.ctrlKey) return; // let pinch-zoom through
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
      target = clamp(target + e.deltaY * unit, 0, maxScroll());
    }, { passive: false });

    /* adopt scrollbar drags / keyboard jumps */
    addEventListener("scroll", () => {
      if (Math.abs(scrollY - lastSet) > 2) { target = cur = scrollY; }
    }, { passive: true });
  }

  function measurePage() { measureSections(); }

  /* cached element geometry (recomputed on resize/load) */
  let reveals = [], parallaxEls = [], parallaxImgs = [], manifestoBox = null, heroBox = null;

  function topOf(el) {
    return el.getBoundingClientRect().top + scrollY;
  }

  function measureSections() {
    reveals = $$("[data-reveal]").map((el) => ({
      el, top: topOf(el), done: el.classList.contains("in-view"),
    }));
    parallaxEls = $$("[data-parallax]").map((el) => ({
      el, top: topOf(el), h: el.offsetHeight, speed: parseFloat(el.dataset.parallax),
      img: el.querySelector("img"),
    }));
    parallaxImgs = $$("[data-parallax-img]").map((img) => {
      const box = img.closest(".card__media");
      return { img, top: topOf(box), h: box.offsetHeight };
    });
    if (manifesto) manifestoBox = { top: topOf(manifesto), h: manifesto.offsetHeight };
    const hero = $("#hero");
    if (hero) heroBox = { h: hero.offsetHeight };
    splits = $$("[data-split]").map((el) => ({
      el, top: topOf(el), done: el.classList.contains("in-view"),
    }));
    counters = $$("[data-count]").map((el) => ({
      el, top: topOf(el), done: el.dataset.done === "1",
    }));
  }
  let splits = [], counters = [];

  /* ────────────────────────── per-frame systems ──────────────── */

  const header = $("#siteHead");
  let lastCur = 0;

  function runCounters(c) {
    const target = +c.el.dataset.count;
    const suffix = c.el.dataset.suffix || "";
    const t0 = performance.now();
    const dur = 1400;
    (function tick(now) {
      const p = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      c.el.textContent = Math.round(target * e) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(performance.now());
  }

  function frame() {
    const vh = innerHeight;

    if (useSmooth) {
      cur = lerp(cur, target, 0.085);
      if (Math.abs(cur - target) < 0.4) cur = target;
      lastSet = Math.round(cur);
      scrollTo(0, cur);
    } else {
      cur = scrollY;
    }

    /* header show/hide */
    if (cur > 80 && cur > lastCur + 2) header.classList.add("is-hidden");
    else if (cur < lastCur - 2 || cur <= 80) header.classList.remove("is-hidden");
    header.classList.toggle("is-solid", cur > 40);
    lastCur = cur;

    /* reveals */
    const trigger = cur + vh * 0.88;
    for (const r of reveals) {
      if (!r.done && r.top < trigger) {
        r.done = true;
        const d = r.el.dataset.revealDelay;
        if (d) r.el.style.setProperty("--rd", d + "ms");
        r.el.classList.add("in-view");
      }
    }
    for (const s of splits) {
      if (!s.done && s.top < trigger) { s.done = true; s.el.classList.add("in-view"); }
    }
    for (const c of counters) {
      if (!c.done && c.top < trigger) { c.done = true; c.el.dataset.done = "1"; runCounters(c); }
    }

    if (!reduceMotion) {
      /* generic parallax blocks */
      for (const p of parallaxEls) {
        const center = p.top + p.h / 2 - cur - vh / 2;
        const y = -center * p.speed;
        (p.img || p.el).style.transform = `translate3d(0,${y.toFixed(1)}px,0) scale(1.12)`;
      }
      /* overscanned card images */
      for (const p of parallaxImgs) {
        const prog = clamp((cur + vh - p.top) / (vh + p.h), 0, 1);
        p.img.style.setProperty("--py", (-23 * prog).toFixed(2) + "%");
      }
      /* manifesto word lighting */
      if (manifestoBox && manifestoWords.length) {
        const prog = clamp(
          (cur + vh * 0.85 - manifestoBox.top) / (manifestoBox.h + vh * 0.35), 0, 1);
        const lit = Math.floor(prog * manifestoWords.length * 1.15);
        manifestoWords.forEach((w, i) => w.classList.toggle("lit", i < lit));
      }
    }

    requestAnimationFrame(frame);
  }

  /* ────────────────────────── anchors ────────────────────────── */

  function scrollToTarget(sel) {
    const dest = sel === "#top" ? document.body : $(sel);
    if (!dest) return;
    const y = clamp(sel === "#top" ? 0 : topOf(dest) - 70, 0, maxScroll());
    if (useSmooth) {
      target = y; // the lerp engine glides there
    } else {
      scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  $$("[data-scroll-to]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const href = el.dataset.href || el.getAttribute("href");
      if (!href || !href.startsWith("#")) return;
      e.preventDefault();
      closeMenu();
      scrollToTarget(href);
    });
  });

  /* ────────────────────────── mobile nav ─────────────────────── */

  const burger = $("#burger");
  const mnav = $("#mobileNav");

  function closeMenu() {
    mnav.classList.remove("is-open");
    mnav.setAttribute("aria-hidden", "true");
    burger.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }
  burger.addEventListener("click", () => {
    const open = mnav.classList.toggle("is-open");
    mnav.setAttribute("aria-hidden", String(!open));
    burger.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  });

  /* ────────────────────────── cursor ─────────────────────────── */

  if (finePointer) {
    const cursor = $("#cursor");
    const label = $("#cursorLabel");
    let mx = innerWidth / 2, my = innerHeight / 2, cx = mx, cy = my;

    addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });

    (function cursorLoop() {
      cx = lerp(cx, mx, 0.22);
      cy = lerp(cy, my, 0.22);
      cursor.style.transform = `translate3d(${cx}px,${cy}px,0)`;
      requestAnimationFrame(cursorLoop);
    })();

    const hoverables = "a, button, [data-cursor]";
    addEventListener("mouseover", (e) => {
      const t = e.target.closest(hoverables);
      if (!t) return;
      cursor.classList.add("is-hover");
      const text = t.dataset.cursor;
      if (text) { label.textContent = text; cursor.classList.add("has-label"); }
    });
    addEventListener("mouseout", (e) => {
      if (e.target.closest(hoverables)) {
        cursor.classList.remove("is-hover", "has-label");
      }
    });

    /* magnetic elements */
    $$("[data-magnetic]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.22}px)`;
      });
      el.addEventListener("mouseleave", () => {
        el.style.transition = "transform .5s cubic-bezier(.22,1,.36,1)";
        el.style.transform = "";
        setTimeout(() => (el.style.transition = ""), 500);
      });
    });

    /* capability hover previews */
    const preview = $("#capsPreview");
    const previewImg = $("img", preview);
    let pvx = 0, pvy = 0, pvtx = 0, pvty = 0, pvs = 0.9;
    addEventListener("mousemove", (e) => { pvtx = e.clientX + 28; pvty = e.clientY - 90; }, { passive: true });
    (function pvLoop() {
      pvx = lerp(pvx, pvtx, 0.12);
      pvy = lerp(pvy, pvty, 0.12);
      pvs = lerp(pvs, preview.classList.contains("is-on") ? 1 : 0.9, 0.12);
      preview.style.transform = `translate3d(${pvx}px,${pvy}px,0) scale(${pvs.toFixed(3)})`;
      requestAnimationFrame(pvLoop);
    })();
    $$(".caprow").forEach((row) => {
      row.addEventListener("mouseenter", () => {
        previewImg.src = row.dataset.preview;
        preview.classList.add("is-on");
      });
      row.addEventListener("mouseleave", () => preview.classList.remove("is-on"));
    });
  }

  /* ────────────────────────── WebGL hero ─────────────────────── */

  function initGL() {
    const canvas = $("#glcanvas");
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) { canvas.style.background = "radial-gradient(80% 90% at 50% 110%, #3a1c0c, #0a0a0c 70%)"; return; }

    const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
    const fs = `
      precision highp float;
      uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.,0.)), u.x),
                   mix(hash(i + vec2(0.,1.)), hash(i + vec2(1.,1.)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main(){
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
        uv += u_mouse * 0.06;
        float t = u_time * 0.045;

        vec2 q = vec2(fbm(uv * 1.4 + t), fbm(uv * 1.4 + vec2(5.2, 1.3) - t * 0.7));
        vec2 r = vec2(fbm(uv * 1.4 + 2.4 * q + vec2(1.7, 9.2) + t * 0.5),
                      fbm(uv * 1.4 + 2.4 * q + vec2(8.3, 2.8) - t * 0.3));
        float f = fbm(uv * 1.4 + 2.2 * r);

        vec3 col = vec3(0.039, 0.039, 0.047);
        col = mix(col, vec3(0.13, 0.07, 0.06), smoothstep(0.2, 0.8, f));
        col = mix(col, vec3(0.55, 0.26, 0.11), smoothstep(0.45, 0.95, f * length(q) * 1.6));
        col = mix(col, vec3(1.0, 0.74, 0.42), smoothstep(0.62, 1.0, f * length(r) * 1.5));

        float glow = pow(1.0 - clamp(gl_FragCoord.y / u_res.y, 0.0, 1.0), 2.4);
        col += vec3(0.40, 0.17, 0.06) * glow * 0.5;

        float vig = 1.0 - 0.45 * pow(length(uv * vec2(0.85, 1.1)), 1.8);
        gl_FragColor = vec4(col * vig, 1.0);
      }`;

    function shader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");

    let mx = 0, my = 0, smx = 0, smy = 0;
    addEventListener("mousemove", (e) => {
      mx = (e.clientX / innerWidth) * 2 - 1;
      my = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }
    resize();
    addEventListener("resize", resize);

    const t0 = performance.now();
    function draw(now) {
      /* skip work once the hero has fully scrolled past */
      if (!heroBox || cur < heroBox.h + 100) {
        smx = lerp(smx, mx, 0.04);
        smy = lerp(smy, my, 0.04);
        gl.uniform1f(uTime, (now - t0) / 1000);
        gl.uniform2f(uMouse, smx, smy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!reduceMotion) requestAnimationFrame(draw);
    }
    draw(performance.now());
  }

  /* ────────────────────────── preloader ──────────────────────── */

  const loader = $("#loader");
  const loaderCount = $("#loaderCount");
  const loaderBar = $("#loaderBar");

  const assets = $$("img").map((img) => img.currentSrc || img.src).filter(Boolean);
  let loaded = 0, fakeP = 0;

  function setProgress(p) {
    loaderCount.textContent = String(Math.round(p * 100)).padStart(2, "0");
    loaderBar.style.width = p * 100 + "%";
  }

  const minTime = new Promise((res) => setTimeout(res, reduceMotion ? 0 : 1400));
  const loads = assets.map((src) => new Promise((res) => {
    const im = new Image();
    im.onload = im.onerror = () => { loaded++; res(); };
    im.src = src;
  }));

  /* count up smoothly toward the real ratio */
  const ticker = setInterval(() => {
    const real = assets.length ? loaded / assets.length : 1;
    fakeP = Math.min(fakeP + 0.025, real * 0.7 + 0.3 * Math.min(fakeP + 0.025, 1));
    setProgress(Math.min(fakeP, 0.99));
  }, 40);

  Promise.all([...loads, minTime]).then(() => {
    clearInterval(ticker);
    setProgress(1);
    setTimeout(() => {
      loader.classList.add("is-done");
      document.body.removeAttribute("data-loading");
      measurePage();
      /* fire the hero entrance */
      $$(".hero [data-split], .hero [data-reveal]").forEach((el) => {
        const d = el.dataset.revealDelay;
        if (d) el.style.setProperty("--rd", d + "ms");
        el.classList.add("in-view");
      });
      reveals.forEach((r) => { if (r.el.closest(".hero")) r.done = true; });
      splits.forEach((s) => { if (s.el.closest(".hero")) s.done = true; });
      setTimeout(() => loader.remove(), 1400);
    }, 250);
  });

  /* ────────────────────────── boot ───────────────────────────── */

  addEventListener("resize", () => {
    /* keep document-space caches honest */
    measurePage();
  });
  addEventListener("load", measurePage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measurePage);

  measurePage();
  initGL();
  requestAnimationFrame(frame);
})();
