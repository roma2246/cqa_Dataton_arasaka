// Витрина CQA Arasaka: анимации на GSAP + ScrollTrigger, плавный скролл Lenis, разбивка текста SplitType.
// Без JS или при «уменьшить движение» всё содержимое видно сразу, данные всё равно подгружаются.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = !!window.gsap && !reduce;
  const fine = matchMedia("(pointer: fine)").matches;

  // ---------- Живые данные (работают и без анимаций) ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => (v == null ? "—" : `${Math.round(v * 10) / 10}%`);
  const tone = (v) => (v >= 80 ? "" : v >= 50 ? "mid" : "low");
  const LANG = { RU: "Русский", KZ: "Қазақша", EN: "English" };
  const row = (label, v) => `<div class="row"><span>${esc(label)}</span><span class="tr"><i class="${tone(v)}" data-w="${v}"></i></span><span class="v">${pct(v)}</span></div>`;
  let liveReady = null;
  const liveData = fetch("/api/public/stats").then((r) => r.json()).then((s) => {
    if (!s.evaluated) { $("#live-sub").textContent = "Оценок пока нет."; return; }
    $("#live-sub").textContent = `${s.evaluated} диалогов оценено моделью ${s.model}. Только агрегаты — тексты переписок не публикуются.`;
    $("#m-eval").dataset.count = s.evaluated; $("#m-eval").textContent = s.evaluated;
    const crit = s.criteria.filter((c) => c.score_pct != null).sort((a, b) => a.score_pct - b.score_pct);
    $("#crit-rows").innerHTML = crit.map((c) => row(c.title, c.score_pct)).join("");
    $("#lang-rows").innerHTML = Object.entries(s.by_language).map(([k, v]) => row(`${LANG[k] || k} · ${v.n}`, v.avg)).join("");
    $("#m-avg").dataset.val = s.avg_total; $("#m-crit").textContent = s.critical_count;
    if (!hasGsap) { $("#m-avg").textContent = pct(s.avg_total); $$(".row .tr i").forEach((i) => (i.style.width = i.dataset.w + "%")); }
    liveReady && liveReady();
  }).catch(() => { $("#live-sub").textContent = "Не удалось загрузить живые данные."; });

  // Тексты команды и терминала без анимаций
  if (!hasGsap) {
    $$(".op .role").forEach((r) => (r.textContent = r.dataset.role));
    $$(".term .l").forEach((l) => (l.innerHTML = colorize(l.dataset.l)));
    return;
  }

  // ---------- Плавный скролл ----------
  gsap.registerPlugin(ScrollTrigger);
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    const target = id === "#" ? 0 : $(id);
    if (target === null) return;
    e.preventDefault();
    lenis ? lenis.scrollTo(target, { offset: -70, duration: 1.4 }) : (target === 0 ? scrollTo(0, 0) : target.scrollIntoView());
  });

  // Шапка: подложка при прокрутке, прячется при движении вниз
  const top = $("#top");
  let lastY = 0;
  ScrollTrigger.create({ start: 0, end: "max", onUpdate: (self) => {
    const y = self.scroll();
    top.classList.toggle("scrolled", y > 20);
    top.classList.toggle("hide", y > 500 && y > lastY);
    lastY = y;
  } });

  ScrollTrigger.create({ trigger: "#team", start: "top 72px", end: "bottom top", toggleClass: { targets: top, className: "dark" } });

  // ---------- Разбивка заголовков на слова (вложенные <em>/<span> сохраняются) ----------
  function splitWords(el) {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
            const w = document.createElement("span"); w.className = "w";
            w.style.cssText = "display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em";
            const i = document.createElement("span"); i.className = "wi"; i.style.display = "inline-block"; i.textContent = part;
            w.appendChild(i); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName.toLowerCase() !== "svg") walk(n);
      });
    };
    walk(el);
    return $$(".wi", el);
  }

  // ---------- Первый экран ----------
  const h1Words = splitWords($("#h"));
  const hlPath = $("#hl-path");
  const hlLen = hlPath.getTotalLength();
  gsap.set(hlPath, { strokeDasharray: hlLen, strokeDashoffset: hlLen });
  gsap.set(h1Words, { yPercent: 110 });
  gsap.set(".hero .reveal", { autoAlpha: 0, y: 24 });
  gsap.set("#panel", { autoAlpha: 0, y: 60, rotateX: 14, rotateY: -16 });
  const msgs = $$("#chat .msg");
  gsap.set(msgs, { autoAlpha: 0, y: 14, scale: 0.96 });
  gsap.set("#crit li", { autoAlpha: 0, x: -12 });
  gsap.set(".float", { autoAlpha: 0, scale: 0.6 });
  const ring = $("#ring"), ringV = $("#ring-v");
  gsap.set(ring, { strokeDashoffset: 314.16 }); ringV.textContent = "0";

  const typing = document.createElement("div");
  typing.className = "typing"; typing.innerHTML = "<i></i><i></i><i></i>";

  const tl = gsap.timeline({ defaults: { ease: "power3.out" }, delay: 0.15 });
  tl.to(".hero .pill", { autoAlpha: 1, y: 0, duration: 0.6 })
    .to(h1Words, { yPercent: 0, duration: 0.9, stagger: 0.045, ease: "power4.out" }, "-=0.3")
    .to(hlPath, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }, "-=0.35")
    .to(".hero .lead, .hero .cta-row, .hero .trust", { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.1 }, "-=0.7")
    .add(() => countUp($$(".trust [data-count]")), "<")
    .to("#panel", { autoAlpha: 1, y: 0, rotateX: 0, rotateY: 0, duration: 1.2, ease: "expo.out" }, 0.55);
  // переписка: клиент → «печатает…» → оператор
  msgs.forEach((m) => {
    if (m.classList.contains("o")) {
      tl.add(() => m.before(typing)).set(typing, { autoAlpha: 1 }).to({}, { duration: 0.55 }).add(() => typing.remove());
    }
    tl.to(m, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, m.classList.contains("o") ? ">" : ">-0.05");
  });
  tl.to("#crit li", { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.09 }, ">-0.1")
    .from("#crit .st", { scale: 0, duration: 0.35, stagger: 0.09, ease: "back.out(3)" }, "<")
    .to(ring, { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut" }, "<0.1")
    .to({ v: 0 }, { v: 100, duration: 1.3, ease: "power2.inOut", onUpdate() { ringV.textContent = Math.round(this.targets()[0].v); } }, "<")
    .to(".float", { autoAlpha: 1, scale: 1, duration: 0.6, stagger: 0.12, ease: "back.out(2)" }, "-=0.6")
    .add(() => {
      $$(".float").forEach((f, i) => gsap.to(f, { y: i % 2 ? 10 : -10, duration: 2.4 + i * 0.4, repeat: -1, yoyo: true, ease: "sine.inOut" }));
    });

  // Параллакс за курсором + наклон панели
  if (fine) {
    const hero = $(".hero"), panel = $("#panel");
    const depth = $$("[data-depth]", hero).map((el) => ({ el, d: +el.dataset.depth, x: gsap.quickTo(el, "x", { duration: 1, ease: "power3" }), y: gsap.quickTo(el, "y", { duration: 1, ease: "power3" }) }));
    const rx = gsap.quickTo(panel, "rotateX", { duration: 0.8, ease: "power3" }), ry = gsap.quickTo(panel, "rotateY", { duration: 0.8, ease: "power3" });
    hero.addEventListener("mousemove", (e) => {
      const r = hero.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      depth.forEach((p) => { p.x(nx * p.d); p.y(ny * p.d); });
      if (tl.progress() > 0.5) { rx(-ny * 8); ry(nx * 10); }
    });
    hero.addEventListener("mouseleave", () => { rx(0); ry(0); });
  }
  // Блобы уплывают при прокрутке
  gsap.to(".blob.b1", { yPercent: 40, scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  gsap.to(".blob.b2", { yPercent: -30, scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  gsap.to("#demo", { y: -60, scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });

  // Бегущая строка ускоряется при скролле
  const track = $(".marquee .track");
  ScrollTrigger.create({ trigger: ".marquee", start: "top bottom", end: "bottom top",
    onUpdate: (s) => { track.style.animationDuration = `${Math.max(12, 38 - Math.abs(s.getVelocity()) / 120)}s`; } });

  // ---------- Появление при прокрутке ----------
  $$("section.s h2.split, .cta-band h2.split").forEach((h) => {
    const words = splitWords(h);
    gsap.set(words, { yPercent: 110 });
    ScrollTrigger.create({ trigger: h, start: "top 85%", once: true,
      onEnter: () => gsap.to(words, { yPercent: 0, duration: 0.85, stagger: 0.035, ease: "power4.out" }) });
  });
  $$("section.s .sub").forEach((p) => {
    if (!window.SplitType) return;
    const st = new SplitType(p, { types: "words" });   // слова, а не строки: переносы не зависят от загрузки шрифта
    gsap.set(st.words, { autoAlpha: 0, y: 14, filter: "blur(4px)" });
    ScrollTrigger.create({ trigger: p, start: "top 88%", once: true,
      onEnter: () => gsap.to(st.words, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.6, stagger: 0.018, ease: "power2.out" }) });
  });
  gsap.set("section.s .reveal:not(.sub), .cta-band .cta-row", { autoAlpha: 0, y: 26 });
  ScrollTrigger.batch("section.s .reveal:not(.sub), .cta-band .cta-row", { start: "top 90%", once: true,
    onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power3.out" }) });
  gsap.set(".reveal-up", { autoAlpha: 0, y: 60, scale: 0.97 });
  ScrollTrigger.batch(".reveal-up", { start: "top 90%", once: true,
    onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, scale: 1, duration: 1, stagger: 0.12, ease: "expo.out" }) });

  // Счётчики и полосы точности
  function countUp(els) {
    els.forEach((el) => {
      const to = +el.dataset.count; const o = { v: 0 };
      gsap.to(o, { v: to, duration: 1.6, ease: "power2.out", onUpdate: () => (el.textContent = Math.round(o.v)) });
    });
  }
  ScrollTrigger.create({ trigger: ".stats", start: "top 85%", once: true, onEnter: () => {
    countUp($$(".stats [data-count]"));
    gsap.fromTo(".stat .bar i", { scaleX: 0 }, { scaleX: 1, duration: 1.6, ease: "power3.out", stagger: 0.12, delay: 0.2 });
  } });
  $$(".stats [data-count]").forEach((el) => (el.textContent = "0"));

  // Линия между шагами рисуется прокруткой
  const line = $("#steps-line");
  if (line) {
    gsap.fromTo(".steps .line", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", ease: "none",
      scrollTrigger: { trigger: ".steps", start: "top 75%", end: "bottom 60%", scrub: true } });
    gsap.from(".step .n", { rotate: -90, scale: 0.4, duration: 0.9, stagger: 0.15, ease: "back.out(2)",
      scrollTrigger: { trigger: ".steps", start: "top 80%", once: true } });
  }

  // Голоса: точки появляются по одной
  gsap.from("#votes .dots i", { scale: 0, rotate: -45, duration: 0.4, stagger: 0.06, ease: "back.out(3)",
    scrollTrigger: { trigger: "#votes", start: "top 85%", once: true } });
  gsap.from("#votes .agr", { autoAlpha: 0, x: 10, duration: 0.5, stagger: 0.15, delay: 0.6,
    scrollTrigger: { trigger: "#votes", start: "top 85%", once: true } });

  // Карточки: наклон и подсветка за курсором
  if (fine) {
    $$(".feat").forEach((card) => {
      const rx = gsap.quickTo(card, "rotateX", { duration: 0.6, ease: "power3" }), ry = gsap.quickTo(card, "rotateY", { duration: 0.6, ease: "power3" });
      gsap.set(card, { transformPerspective: 900 });
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", `${x * 100}%`); card.style.setProperty("--my", `${y * 100}%`);
        rx((0.5 - y) * 7); ry((x - 0.5) * 9);
      });
      card.addEventListener("mouseleave", () => { rx(0); ry(0); });
    });
    // Магнитные кнопки
    $$(".btn").forEach((b) => {
      const mx = gsap.quickTo(b, "x", { duration: 0.5, ease: "power3" }), my = gsap.quickTo(b, "y", { duration: 0.5, ease: "power3" });
      b.addEventListener("mousemove", (e) => { const r = b.getBoundingClientRect(); mx((e.clientX - r.left - r.width / 2) * 0.18); my((e.clientY - r.top - r.height / 2) * 0.25); });
      b.addEventListener("mouseleave", () => { mx(0); my(0); });
    });
  }

  // Живые данные: полосы растут, когда блок на экране
  let liveSeen = false;
  const animateLive = () => {
    if (!liveSeen || !$(".row .tr i")) return;
    gsap.to(".row .tr i", { width: (i, el) => el.dataset.w + "%", duration: 1.4, ease: "power3.out", stagger: 0.06 });
    const el = $("#m-avg"), to = +el.dataset.val, o = { v: 0 };
    gsap.to(o, { v: to, duration: 1.8, ease: "power2.out", onUpdate: () => (el.textContent = o.v.toFixed(1) + "%") });
    gsap.from("#m-crit", { textContent: 0, duration: 1.2, snap: { textContent: 1 } });
  };
  liveReady = animateLive;
  ScrollTrigger.create({ trigger: "#live", start: "top 70%", once: true, onEnter: () => { liveSeen = true; animateLive(); } });
  liveData.then(() => ScrollTrigger.refresh());

  // Щиты в призыве медленно плывут
  gsap.to(".shields svg", { y: (i) => (i - 1) * 30, rotate: (i) => (i - 1) * 8, ease: "none",
    scrollTrigger: { trigger: ".cta-band", start: "top bottom", end: "bottom top", scrub: true } });

  // ---------- Команда: киберпанк ----------
  const glitch = $(".glitch");
  const CH = "アイウエオカキクケコ01ABCDEF#$%&*<>/\\";
  function scramble(el, text, dur = 1.2) {
    const o = { p: 0 };
    gsap.to(o, { p: 1, duration: dur, ease: "none", onUpdate: () => {
      const n = Math.floor(o.p * text.length);
      el.textContent = text.slice(0, n) + [...text.slice(n)].map((c) => (c === " " ? " " : CH[(Math.random() * CH.length) | 0])).join("");
    }, onComplete: () => (el.textContent = text) });
  }
  ScrollTrigger.create({ trigger: "#team", start: "top 70%", once: true, onEnter: () => {
    scramble(glitch, glitch.dataset.text, 1.4);
    gsap.fromTo(".op", { autoAlpha: 0, y: 70, clipPath: "polygon(0 0, 0 0, 0 100%, 0 100%)" },
      { autoAlpha: 1, y: 0, clipPath: "polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 22px 100%, 0 calc(100% - 22px))",
        duration: 1, stagger: 0.18, ease: "expo.out", delay: 0.3,
        onComplete() { gsap.set(".op", { clearProps: "clipPath" }); } });
    // мерцание при включении
    gsap.fromTo(".op", { filter: "brightness(2.4)" }, { filter: "brightness(1)", duration: 0.12, repeat: 3, yoyo: true, stagger: 0.18, delay: 0.5,
      onComplete() { gsap.set(".op", { clearProps: "filter" }); } });
    $$(".op").forEach((op, i) => {
      scramble($("h3", op), $("h3", op).textContent, 1.1 + i * 0.15);
      const r = $(".role", op), txt = r.dataset.role, o = { n: 0 };
      gsap.to(o, { n: txt.length, duration: txt.length * 0.045, delay: 0.9 + i * 0.25, ease: "none", onUpdate: () => (r.textContent = txt.slice(0, Math.round(o.n))) });
      gsap.from($$(".meter i", op), { scaleY: 0, transformOrigin: "bottom", duration: 0.2, stagger: 0.07, delay: 1 + i * 0.2 });
    });
  } });
  $$(".op h3").forEach((h) => h.setAttribute("aria-label", h.textContent));
  $$(".op").forEach((op) => op.addEventListener("mouseenter", () => scramble($("h3", op), $("h3", op).getAttribute("aria-label"), 0.5)));

  // Терминал печатает строки
  function colorize(s) {
    return esc(s).replace(/\[ (OK|100%) \]/g, "[ <b>$1</b> ]").replace(/(READY FOR PROD_)/, "<b>$1</b>").replace(/(armed)/, "<s>$1</s>");
  }
  ScrollTrigger.create({ trigger: "#term", start: "top 85%", once: true, onEnter: () => {
    const t = gsap.timeline();
    $$("#term .l").forEach((l) => {
      const s = l.dataset.l, o = { n: 0 };
      t.to(o, { n: s.length, duration: s.length * 0.022, ease: "none", onUpdate: () => (l.textContent = s.slice(0, Math.round(o.n))),
        onComplete: () => (l.innerHTML = colorize(s)) }).to({}, { duration: 0.15 });
    });
  } });

  // Цифровой дождь — только пока блок команды на экране
  const cv = $("#rain"), ctx = cv.getContext("2d");
  let cols = [], raf = 0, running = false;
  const FS = 16;
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Array.from({ length: Math.ceil(r.width / FS) }, () => Math.random() * -60);
  }
  let last = 0;
  function draw(ts) {
    raf = requestAnimationFrame(draw);
    if (ts - last < 55) return; last = ts;
    const w = cv.width, h = cv.height;
    ctx.fillStyle = "rgba(5, 7, 10, 0.16)"; ctx.fillRect(0, 0, w, h);
    ctx.font = `${FS}px JetBrains Mono, monospace`;
    cols.forEach((y, i) => {
      const ch = CH[(Math.random() * CH.length) | 0];
      ctx.fillStyle = Math.random() < 0.04 ? "#e9fff0" : i % 7 === 0 ? "rgba(0,240,255,.8)" : "rgba(107,255,143,.75)";
      ctx.fillText(ch, i * FS, y * FS);
      cols[i] = y * FS > cv.height / (devicePixelRatio || 1) && Math.random() > 0.975 ? 0 : y + 1;
    });
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) { running = true; resize(); raf = requestAnimationFrame(draw); }
    else if (!e.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
  }).observe($("#team"));
  addEventListener("resize", () => running && resize());

  // Шрифты подгрузились — пересчитать позиции триггеров
  document.fonts && document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
