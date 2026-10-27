/* ==========================================================================
   Spell Spider — app
   Loads documents, sends them to a checker, renders pages, and runs the
   walker: the spider climbs straight down each page and stretches its legs
   out to grab (outline) every mistake on each line it passes.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const C = window.SpiderCheck;
  const X = window.SpiderExtract;
  const DEG = Math.PI / 180;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Settings ---------------- */
  const SPEEDS = [
    { px: 18, name: "Crawl" }, { px: 30, name: "Creep" }, { px: 48, name: "Amble" },
    { px: 72, name: "Stroll" }, { px: 105, name: "Walk" }, { px: 150, name: "Trot" },
    { px: 220, name: "Scurry" }, { px: 330, name: "Dash" }, { px: 520, name: "Sprint" },
    { px: 850, name: "Zoom" },
  ];
  const THEME_ORDER = ["rainbow", "peacock", "neon", "candy", "midnight"];
  const CATS = ["spelling", "grammar", "style"];
  const CAT_LABEL = { spelling: "Spelling", grammar: "Grammar", style: "Style" };

  const STORE_KEY = "spell-spider-settings-v1";
  const DEFAULTS = {
    speed: 4, pause: 0.6, size: 1.3, theme: "rainbow", color: "#7b2cbf",
    follow: true, silk: true, sound: false,
    engine: "languagetool", language: "en-US", ignore: "",
    show: { spelling: true, grammar: true, style: true },
  };

  function loadSettings() {
    const base = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return Object.assign(base, s, { show: Object.assign(base.show, s.show || {}) });
      }
    } catch (e) { /* storage blocked: use defaults */ }
    return base;
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  const settings = loadSettings();

  /* ---------------- Elements ---------------- */
  const els = {
    run: $("#btnRun"), skip: $("#btnSkip"), all: $("#btnAll"),
    speed: $("#speed"), speedOut: $("#speedOut"), status: $("#status"),
    fileInput: $("#fileInput"), docList: $("#docList"), sample: $("#btnSample"), emptySample: $("#emptySample"),
    pause: $("#pause"), pauseOut: $("#pauseOut"), size: $("#size"), sizeOut: $("#sizeOut"),
    colors: $("#colors"), themeName: $("#themeName"), follow: $("#follow"), silkToggle: $("#silkToggle"), sound: $("#sound"),
    language: $("#language"), langRow: $("#langRow"), ignore: $("#ignore"),
    recheck: $("#btnRecheck"), engineNote: $("#engineNote"),
    viewer: $("#viewer"), pages: $("#pages"), empty: $("#empty"), emptyArt: $("#emptyArt"),
    silk: $("#silk"), bubble: $("#bubble"), dropOverlay: $("#dropOverlay"), toast: $("#toast"),
    caughtCount: $("#caughtCount"), caughtList: $("#caughtList"), caughtEmpty: $("#caughtEmpty"),
    caughtScroll: $("#caughtScroll"), report: $("#btnReport"),
    n: { spelling: $("#nSpelling"), grammar: $("#nGrammar"), style: $("#nStyle") },
  };

  /* ---------------- State ---------------- */
  const docs = [];
  const errorsById = new Map();
  const counts = { spelling: 0, grammar: 0, style: 0 };
  let nextDocId = 1;
  let nextErrId = 1;
  let ignoreSet = new Set();
  let ltWaiting = false;
  let fallbackNoticeShown = false;
  let userScrollUntil = 0;

  if (!THEME_ORDER.includes(settings.theme) && settings.theme !== "custom") settings.theme = "rainbow";

  const spider = new window.Spider({ theme: settings.theme, color: settings.color, size: settings.size });
  els.pages.appendChild(spider.svg);
  spider.svg.style.display = "none";

  const emptySpider = new window.Spider({ theme: settings.theme, color: settings.color, size: 1.9 });
  els.emptyArt.appendChild(emptySpider.svg);

  // The walker: everything about where the spider is and what it's doing.
  // x/y are measured from the top-left of the current page (W.page), so the
  // spider stays put when documents above it are added or removed.
  // Each of the 8 legs can reach for a point: k = how far it's reaching (0..1),
  // tk = where k is heading, (px,py) = the point it's holding, (tx,ty) = where it's going.
  const W = {
    running: false, paused: false, mode: "idle",
    page: null, x: 0, y: -4, angle: 180, targetAngle: 180,
    phase: 0, idle: 0, busy: 0, stride: 0, moving: false,
    lines: [], lineErrs: [], lineIdx: 0, col: 0, target: null,
    legs: Array.from({ length: 8 }, () => ({ k: 0, tk: 0, px: 0, py: 0, tx: 0, ty: 0 })),
    wave: [], reachQueue: [], reachHold: -1,
    catchTimer: 0, spin: 0, layoutWidth: 0, pageH: 0, bubbleUntil: 0, bubbleText: "",
  };

  /* ==========================================================================
     Documents
     ========================================================================== */
  function createDoc(name, kind) {
    const doc = {
      id: nextDocId++, name, kind, pages: [], gen: 0,
      removed: false, failed: false, loaded: false, checking: false, groupEl: null,
    };
    const section = document.createElement("section");
    section.className = "doc";
    section.innerHTML = '<header class="doc-head"><h2 class="doc-title"></h2><p class="doc-meta"></p></header><div class="doc-pages"></div>';
    section.querySelector(".doc-title").textContent = name;
    doc.el = section;
    doc.metaEl = section.querySelector(".doc-meta");
    doc.pagesEl = section.querySelector(".doc-pages");
    els.pages.insertBefore(section, els.silk);

    const li = document.createElement("li");
    li.className = "doc-item";
    li.innerHTML = '<span class="doc-ext" aria-hidden="true"></span><span class="doc-info"><span class="doc-name"></span><span class="doc-state"></span></span><button class="icon-btn" type="button">×</button>';
    li.querySelector(".doc-ext").textContent = kind === "pdf" ? ".pdf" : kind === "docx" ? ".docx" : ".txt";
    li.querySelector(".doc-name").textContent = name;
    li.querySelector(".doc-name").title = name;
    const removeBtn = li.querySelector("button");
    removeBtn.setAttribute("aria-label", "Remove " + name);
    removeBtn.addEventListener("click", () => removeDoc(doc));
    doc.listEl = li;
    doc.stateEl = li.querySelector(".doc-state");
    els.docList.appendChild(li);

    docs.push(doc);
    els.empty.hidden = true;
    setDocState(doc, "Reading…");
    return doc;
  }

  function setDocState(doc, text, bad) {
    doc.stateEl.textContent = text;
    doc.stateEl.classList.toggle("is-bad", !!bad);
  }

  function updateDocState(doc) {
    if (doc.failed || !doc.loaded) return;
    const n = doc.pages.length;
    const ready = doc.pages.filter((p) => p.ready).length;
    const walked = doc.pages.filter((p) => p.walked).length;
    const caught = doc.pages.reduce((a, p) => a + p.errors.filter((e) => e.caught).length, 0);
    const word = caught === 1 ? "mistake" : "mistakes";
    if (walked === n) setDocState(doc, `Done, ${caught} ${word} caught`);
    else if (ready < n) setDocState(doc, `Checking… ${ready} of ${n} ${n === 1 ? "page" : "pages"} ready`);
    else if (walked > 0) setDocState(doc, `Walked ${walked} of ${n} pages, ${caught} caught`);
    else setDocState(doc, `${n} ${n === 1 ? "page" : "pages"}, ready to walk`);
    doc.metaEl.textContent = `${n} ${n === 1 ? "page" : "pages"}`;
  }

  function buildPages(doc, pagesData) {
    doc.pages = pagesData.map((pd, i) => {
      const paragraphs = pd.paragraphs;
      const starts = [];
      let pos = 0;
      for (const p of paragraphs) { starts.push(pos); pos += p.length + 2; }
      const page = {
        doc, index: i, paragraphs, starts, text: paragraphs.join("\n\n"),
        errors: [], pending: [], piecesLeft: 0,
        ready: false, walked: false, autoCatch: false,
      };
      const art = document.createElement("article");
      art.className = "page is-checking";
      art.setAttribute("aria-label", `${doc.name}, page ${i + 1}`);
      art.innerHTML = '<div class="page-body"></div><footer class="page-foot"></footer>';
      page.el = art;
      page.bodyEl = art.querySelector(".page-body");
      art.querySelector(".page-foot").textContent = `Page ${i + 1} of ${pagesData.length}`;
      doc.pagesEl.appendChild(art);
      renderPage(page);
      return page;
    });
    doc.loaded = true;
    updateDocState(doc);
  }

  /* Draw a page's text, wrapping each found mistake in an (invisible) <mark>. */
  function renderPage(page) {
    const body = page.bodyEl;
    body.textContent = "";
    if (!page.paragraphs.length) {
      const p = document.createElement("p");
      p.className = "no-text";
      p.textContent = "No text found on this page. It may be a scanned image, which the spider can't read.";
      body.appendChild(p);
      return;
    }
    const errs = page.errors.slice().sort((a, b) => a.offset - b.offset);
    let ei = 0;
    page.paragraphs.forEach((para, i) => {
      const p = document.createElement("p");
      p.className = "para";
      const start = page.starts[i];
      const end = start + para.length;
      let pos = 0;
      while (ei < errs.length && errs[ei].offset < end) {
        const e = errs[ei++];
        const s = e.offset - start;
        if (s < pos) continue;
        const len = Math.min(e.length, para.length - s);
        if (s > pos) p.appendChild(document.createTextNode(para.slice(pos, s)));
        const m = document.createElement("mark");
        m.className = "err cat-" + e.category;
        m.dataset.id = e.id;
        m.textContent = para.slice(s, s + len);
        if (e.caught) { m.classList.add("caught"); m.title = tooltipFor(e); }
        e.el = m;
        p.appendChild(m);
        pos = s + len;
      }
      if (pos < para.length) p.appendChild(document.createTextNode(para.slice(pos)));
      body.appendChild(p);
    });
  }

  async function addFiles(files) {
    const jobs = [];
    for (const file of files) {
      const kind = X.kindOf(file);
      if (!kind) {
        notice(`“${file.name}” can't be read. Use .txt, .md, .pdf or .docx files.`);
        continue;
      }
      jobs.push({ file, doc: createDoc(file.name, kind) });
    }
    refreshUI();
    for (const { file, doc } of jobs) {
      try {
        const res = await X.readFile(file, (p, n) => setDocState(doc, `Reading page ${p} of ${n}…`));
        if (doc.removed) continue;
        buildPages(doc, res.pages);
        if (!res.pages.some((p) => p.paragraphs.length)) {
          notice(`No text found in “${doc.name}”. Scanned PDFs are images, and the spider can only read text.`);
        }
        queueCheck(doc);
      } catch (err) {
        if (doc.removed) continue;
        doc.failed = true;
        setDocState(doc, "Couldn't read this file", true);
        const box = document.createElement("p");
        box.className = "doc-failed";
        box.textContent = `This file couldn't be opened${err && err.message ? ": " + err.message : "."} If it's a PDF, check that it isn't password-protected.`;
        doc.pagesEl.appendChild(box);
      }
      placeIdleSpider();
      refreshUI();
    }
  }

  function removeDoc(doc) {
    if (doc.removed) return;
    if (W.page && W.page.doc === doc) {
      releaseLegs();
      toPagesFrame();
      if (W.running && !["spin", "done", "idle"].includes(W.mode)) W.mode = "next-page";
    }
    doc.removed = true;
    for (const page of doc.pages) {
      for (const err of page.errors) {
        if (err.caught) counts[err.category]--;
        errorsById.delete(err.id);
      }
    }
    if (doc.groupEl) doc.groupEl.remove();
    doc.el.remove();
    doc.listEl.remove();
    docs.splice(docs.indexOf(doc), 1);
    const qi = checkQueue.indexOf(doc);
    if (qi >= 0) checkQueue.splice(qi, 1);
    if (!docs.length) {
      W.running = false; W.paused = false; W.mode = "idle"; W.page = null;
      els.empty.hidden = false;
    }
    placeIdleSpider();
    renderCounts();
    refreshUI();
  }

  /* ==========================================================================
     Checking
     ========================================================================== */
  const checkQueue = [];
  let checkBusy = false;

  function queueCheck(doc) {
    if (!checkQueue.includes(doc)) checkQueue.push(doc);
    pumpChecks();
  }

  async function pumpChecks() {
    if (checkBusy) return;
    checkBusy = true;
    try {
      while (checkQueue.length) {
        const doc = checkQueue.shift();
        if (!doc.removed && doc.loaded) await checkDoc(doc);
      }
    } finally {
      checkBusy = false;
    }
  }

  function splitPage(page, max, sizeOf) {
    if (sizeOf(page.text) <= max) return [{ page, start: 0, text: page.text }];
    const pieces = [];
    let cur = null;
    page.paragraphs.forEach((para, i) => {
      const start = page.starts[i];
      if (cur && sizeOf(cur.text) + 2 + sizeOf(para) > max) { pieces.push(cur); cur = null; }
      if (!cur) cur = { page, start, text: para };
      else cur.text = page.text.slice(cur.start, start + para.length);
    });
    if (cur) pieces.push(cur);
    return pieces;
  }

  async function checkDoc(doc) {
    const gen = doc.gen;
    const online = settings.engine === "languagetool";
    let engine = online ? C.LanguageTool : C.Builtin;
    const encoder = new TextEncoder();
    const sizeOf = online ? (t) => encoder.encode(t).length : (t) => t.length;
    const max = online ? C.LanguageTool.maxRequestBytes : 5000;
    doc.checking = true;

    if (!online && !C.Builtin.typo && !C.Builtin.dictionaryFailed) {
      setDocState(doc, "Loading the dictionary…");
      await C.Builtin.load();
      if (C.Builtin.dictionaryFailed) {
        notice("The spelling dictionary couldn't load, so only the grammar rules are running. Check your internet connection.");
      }
    }
    if (doc.removed || doc.gen !== gen) return;

    const pieces = [];
    for (const page of doc.pages) {
      page.pending = [];
      if (!page.text.trim()) { page.piecesLeft = 0; finalizePage(page); continue; }
      const ps = splitPage(page, max, sizeOf);
      page.piecesLeft = ps.length;
      pieces.push(...ps);
    }

    // Group pieces into requests. The first one is small so the spider can start sooner.
    const batches = [];
    let cur = null;
    let limit = online ? Math.min(max, 3000) : max;
    for (const pc of pieces) {
      if (cur && sizeOf(cur.text) + 2 + sizeOf(pc.text) > limit) { batches.push(cur); cur = null; limit = max; }
      if (!cur) cur = { text: "", parts: [] };
      if (cur.text) cur.text += "\n\n";
      cur.parts.push({ piece: pc, at: cur.text.length });
      cur.text += pc.text;
    }
    if (cur) batches.push(cur);

    updateDocState(doc);
    for (const batch of batches) {
      if (doc.removed || doc.gen !== gen) return;
      let matches;
      try {
        matches = await engine.check(batch.text, { language: settings.language });
      } catch (err) {
        if (engine === C.LanguageTool) {
          if (!fallbackNoticeShown) {
            notice(`${err.message} Using the private built-in checker instead for now.`);
            fallbackNoticeShown = true;
          }
          engine = C.Builtin;
          matches = await C.Builtin.check(batch.text);
        } else {
          matches = [];
        }
      }
      if (doc.removed || doc.gen !== gen) return;
      for (const part of batch.parts) {
        const pc = part.piece;
        const end = part.at + pc.text.length;
        for (const m of matches) {
          if (m.offset >= part.at && m.offset + m.length <= end) {
            pc.page.pending.push(Object.assign({}, m, { offset: m.offset - part.at + pc.start }));
          }
        }
        pc.page.piecesLeft--;
        if (pc.page.piecesLeft === 0) finalizePage(pc.page);
      }
      updateDocState(doc);
      if (engine === C.Builtin) await sleep(0);
    }
    doc.checking = false;
    updateDocState(doc);
    refreshUI();
  }

  function finalizePage(page) {
    const errs = [];
    for (const m of C.dedupe(page.pending)) {
      const i = paragraphIndexAt(page, m.offset);
      if (i < 0) continue;
      const paraEnd = page.starts[i] + page.paragraphs[i].length;
      const length = Math.min(m.length, paraEnd - m.offset);
      if (length <= 0) continue;
      const err = {
        id: nextErrId++, page, doc: page.doc,
        offset: m.offset, length,
        text: page.text.substr(m.offset, length),
        message: m.message, replacements: (m.replacements || []).filter(Boolean),
        category: CATS.includes(m.category) ? m.category : "grammar",
        ruleId: m.ruleId || "", caught: false, el: null, item: null,
      };
      errorsById.set(err.id, err);
      errs.push(err);
    }
    page.pending = [];
    page.errors = errs;
    renderPage(page);
    page.ready = true;
    page.el.classList.remove("is-checking");
    if (page.autoCatch) sweepPage(page, false);
    updateDocState(page.doc);
    refreshUI();
  }

  function paragraphIndexAt(page, offset) {
    for (let i = 0; i < page.paragraphs.length; i++) {
      const s = page.starts[i];
      if (offset >= s && offset < s + page.paragraphs[i].length) return i;
    }
    return -1;
  }

  function recheckAll() {
    releaseLegs();
    resetCatches();
    for (const doc of docs) {
      if (!doc.loaded) continue;
      doc.gen++;
      for (const page of doc.pages) {
        for (const e of page.errors) errorsById.delete(e.id);
        page.errors = [];
        page.pending = [];
        page.ready = false;
        page.walked = false;
        page.autoCatch = false;
        page.el.classList.add("is-checking");
        renderPage(page);
      }
      queueCheck(doc);
    }
    if (W.running) W.mode = "next-page";
    else { W.mode = "idle"; placeIdleSpider(true); }
    els.engineNote.hidden = true;
    refreshUI();
  }

  /* ==========================================================================
     Catching
     ========================================================================== */
  function isIgnored(err) {
    if (err.category !== "spelling" || !ignoreSet.size) return false;
    return ignoreSet.has(err.text.trim().toLowerCase().replace(/’/g, "'"));
  }
  function catchable(err) {
    return settings.show[err.category] && !isIgnored(err);
  }

  function tooltipFor(err) {
    let t = err.message;
    if (err.replacements.length) t += "\nSuggestion: " + err.replacements.slice(0, 3).join(", ");
    return t;
  }

  function catchError(err, animate, quiet) {
    if (err.caught) return;
    err.caught = true;
    if (err.el) {
      err.el.classList.add("caught");
      err.el.title = tooltipFor(err);
      if (animate && !reducedMotion) {
        err.el.classList.remove("lasso");
        void err.el.offsetWidth; // restart the animation
        err.el.classList.add("lasso");
      }
    }
    counts[err.category]++;
    addToList(err, animate);
    renderCounts();
    if (animate && !quiet) playCatchSound(err.category);
  }

  function uncatch(err) {
    if (!err.caught) return;
    err.caught = false;
    counts[err.category]--;
    if (err.el) {
      err.el.classList.remove("caught", "lasso", "flash");
      err.el.removeAttribute("title");
    }
    if (err.item) {
      const group = err.item.closest(".ci-group");
      err.item.remove();
      err.item = null;
      if (group && !group.querySelector(".ci")) { group.remove(); err.doc.groupEl = null; }
    }
    renderCounts();
  }

  function resetCatches() {
    for (const err of errorsById.values()) {
      err.caught = false;
      err.item = null;
      if (err.el) { err.el.classList.remove("caught", "lasso", "flash"); err.el.removeAttribute("title"); }
    }
    for (const doc of docs) {
      doc.groupEl = null;
      for (const page of doc.pages) page.walked = false;
      updateDocState(doc);
    }
    els.caughtList.textContent = "";
    for (const c of CATS) counts[c] = 0;
    renderCounts();
  }

  /* Catch everything left on a page that the spider is allowed to catch. */
  function sweepPage(page, animate) {
    for (const err of page.errors) if (!err.caught && catchable(err)) catchError(err, animate, true);
    page.walked = true;
    updateDocState(page.doc);
  }

  /* After the ignore list or the kinds filter changes, bring catches in line. */
  function syncCatches() {
    for (const err of errorsById.values()) {
      if (err.caught && isIgnored(err)) uncatch(err);
      else if (!err.caught && err.page.walked && catchable(err)) catchError(err, false, true);
    }
    for (const doc of docs) updateDocState(doc);
    refreshUI();
  }

  function renderCounts() {
    let total = 0;
    for (const c of CATS) {
      els.n[c].textContent = counts[c];
      if (settings.show[c]) total += counts[c];
    }
    els.caughtCount.textContent = total;
    els.caughtEmpty.hidden = errorsById.size > 0 && els.caughtList.children.length > 0;
    els.report.disabled = total === 0;
  }

  function visibleText(err) {
    const t = err.text;
    if (!t.trim()) return "extra space";
    return /\s/.test(t) && err.category === "style" ? t.replace(/ /g, "␣") : t;
  }

  function addToList(err, animate) {
    const doc = err.doc;
    if (!doc.groupEl || !doc.groupEl.isConnected) {
      const g = document.createElement("li");
      g.className = "ci-group";
      g.dataset.doc = doc.id;
      g.innerHTML = '<h3 class="ci-doc"></h3><ol class="ci-items"></ol>';
      g.querySelector(".ci-doc").textContent = doc.name;
      const order = docs.indexOf(doc);
      const after = Array.from(els.caughtList.children).find((el) => {
        const d = docs.find((x) => String(x.id) === el.dataset.doc);
        return d && docs.indexOf(d) > order;
      });
      els.caughtList.insertBefore(g, after || null);
      doc.groupEl = g;
    }
    const li = document.createElement("li");
    li.className = "ci cat-" + err.category;
    li.dataset.id = err.id;
    const key = err.page.index * 1e7 + err.offset;
    li.dataset.key = key;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ci-btn";
    btn.innerHTML = '<span class="ci-top"><span class="ci-word"></span><span class="ci-where"></span></span><span class="ci-msg"></span>';
    btn.querySelector(".ci-word").textContent = visibleText(err);
    btn.querySelector(".ci-where").textContent = `${CAT_LABEL[err.category]}, page ${err.page.index + 1}`;
    btn.querySelector(".ci-msg").textContent = err.message;
    if (err.replacements.length) {
      const fix = document.createElement("span");
      fix.className = "ci-fix";
      const r = err.replacements.slice(0, 3).map((s) => (s.trim() ? `“${s}”` : "removing it"));
      fix.textContent = "Try " + (r.length > 1 ? r.slice(0, -1).join(", ") + " or " + r[r.length - 1] : r[0]);
      btn.appendChild(fix);
    }
    btn.addEventListener("click", () => focusError(err));
    li.appendChild(btn);

    const items = doc.groupEl.querySelector(".ci-items");
    const before = Array.from(items.children).find((el) => +el.dataset.key > key);
    items.insertBefore(li, before || null);
    err.item = li;

    if (animate) {
      li.classList.add("is-new");
      setTimeout(() => li.classList.remove("is-new"), 700);
      revealInList(li, false);
    }
  }

  /* Scroll the mistakes list (only the list, never the whole page) so an item is visible. */
  function revealInList(li, center) {
    const sc = els.caughtScroll;
    const lr = li.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    let delta = 0;
    if (center) delta = lr.top - sr.top - sr.height / 3;
    else if (lr.bottom > sr.bottom) delta = lr.bottom - sr.bottom + 16;
    else if (lr.top < sr.top + 40) delta = lr.top - sr.top - 40;
    if (delta) sc.scrollTo({ top: sc.scrollTop + delta, behavior: center && !reducedMotion ? "smooth" : "auto" });
  }

  function focusError(err) {
    if (!err.el) return;
    const v = els.viewer;
    const r = err.el.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    const top = v.scrollTop + (r.top - vr.top) - v.clientHeight * 0.4;
    v.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
    userScrollUntil = performance.now() + 6000;
    err.el.classList.remove("lasso", "flash");
    void err.el.offsetWidth;
    if (!reducedMotion) err.el.classList.add("flash");
    setActiveItem(err);
  }

  function setActiveItem(err) {
    els.caughtList.querySelectorAll(".ci.is-active").forEach((el) => el.classList.remove("is-active"));
    if (err.item) err.item.classList.add("is-active");
  }

  /* ==========================================================================
     The walker
     The spider climbs straight down the middle of each page on its silk.
     At every line with mistakes it stops and stretches its legs out to grab
     them, up to four legs on each side at once. Extra mistakes on the same
     line get grabbed in another wave right after.
     ========================================================================== */
  const WALKING_MODES = ["travel", "descend", "reach"];

  function frameOffset(page) {
    if (page && page.el && page.el.isConnected) return { x: page.el.offsetLeft, y: page.el.offsetTop };
    return { x: 0, y: 0 };
  }
  /* Switch the spider's coordinates to another page without moving it on screen. */
  function setFrame(page) {
    const a = frameOffset(W.page);
    const b = frameOffset(page);
    const dx = a.x - b.x, dy = a.y - b.y;
    W.x += dx;
    W.y += dy;
    for (const L of W.legs) { L.px += dx; L.py += dy; L.tx += dx; L.ty += dy; }
    W.target = null;
    W.page = page;
  }
  function toPagesFrame() { setFrame(null); }

  function firstPage() {
    for (const doc of docs) if (doc.loaded && doc.pages.length) return doc.pages[0];
    return null;
  }
  function pageCenter(page) { return page.el.clientWidth / 2; }

  /* When nothing is happening, park the spider on the top edge of the first page. */
  function placeIdleSpider(force) {
    if (W.running || W.mode === "spin") return; // never yank a spider that's busy
    const page = firstPage();
    if (!page) { W.page = null; return; }
    if (force || !W.page || !W.page.el.isConnected || W.mode === "idle") {
      releaseLegs();
      W.page = page; W.x = pageCenter(page); W.y = -4; W.angle = W.targetAngle = 180;
      W.mode = "idle";
    }
  }

  function hasUnwalked() {
    return docs.some((d) => !d.removed && !d.failed && (!d.loaded || d.pages.some((p) => !p.walked)));
  }
  function anyLoaded() { return docs.some((d) => d.loaded && d.pages.length); }

  function findNextPage() {
    for (const doc of docs) {
      if (doc.removed || doc.failed) continue;
      if (!doc.loaded) return { loading: true };
      for (const page of doc.pages) if (!page.walked) return { page };
    }
    return {};
  }

  /* Measure every line of text on a page (positions relative to the page). */
  function computeLines(page) {
    const base = page.el.getBoundingClientRect();
    const lines = [];
    page.bodyEl.querySelectorAll("p.para").forEach((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const groups = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const cy = (r.top + r.bottom) / 2;
        const g = groups.find((g) => cy >= g.top - 1 && cy <= g.bottom + 1);
        if (g) {
          g.left = Math.min(g.left, r.left); g.right = Math.max(g.right, r.right);
          g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom);
        } else {
          groups.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
      }
      groups.sort((a, b) => a.top - b.top);
      for (const g of groups) {
        lines.push({
          left: g.left - base.left, right: g.right - base.left,
          top: g.top - base.top, bottom: g.bottom - base.top,
          cy: (g.top + g.bottom) / 2 - base.top,
        });
      }
    });
    return lines;
  }

  /* For every line, list its mistakes and the spot a leg will grab (the middle of the mistake). */
  function assignErrors(page, lines) {
    const base = page.el.getBoundingClientRect();
    const perLine = lines.map(() => []);
    for (const err of page.errors) {
      if (!err.el) continue;
      const rects = Array.from(err.el.getClientRects()).filter((r) => r.height > 0);
      if (!rects.length) continue; // caught by the sweep at the end of the page
      const r = rects[0];
      const cy = (r.top + r.bottom) / 2 - base.top;
      const li = lines.findIndex((l) => cy >= l.top - 2 && cy <= l.bottom + 2);
      if (li < 0) continue;
      perLine[li].push({ err, x: (r.left + r.right) / 2 - base.left, y: cy });
    }
    perLine.forEach((arr) => arr.sort((a, b) => a.x - b.x));
    return perLine;
  }

  function measurePage() {
    W.lines = computeLines(W.page);
    W.lineErrs = assignErrors(W.page, W.lines);
    if (W.lines.length) {
      const left = Math.min(...W.lines.map((l) => l.left));
      const right = Math.max(...W.lines.map((l) => l.right));
      W.col = (left + right) / 2;
    } else {
      W.col = pageCenter(W.page);
    }
    W.layoutWidth = els.pages.clientWidth;
    W.pageH = W.page.el.offsetHeight;
  }

  function startPoint() {
    return { x: W.col, y: Math.max(-4, W.lines[0].top - 30 * settings.size) };
  }
  function bottomY() {
    return W.lines[W.lines.length - 1].bottom + 20 * settings.size;
  }

  function startPage(page) {
    setFrame(page);
    measurePage();
    W.lineIdx = 0;
    if (!W.lines.length) { endPage(); return; }
    W.target = startPoint();
    W.mode = "travel";
    refreshUI();
  }

  function releaseLegs() {
    for (const L of W.legs) L.tk = 0;
    W.wave = [];
    W.reachQueue = [];
    W.reachHold = -1;
  }

  function endPage() {
    releaseLegs();
    const page = W.page;
    if (page && !page.doc.removed) sweepPage(page, true);
    W.mode = "next-page";
    refreshUI();
  }

  function finishWalk() {
    releaseLegs();
    W.running = false;
    W.paused = false;
    W.mode = "spin";
    W.spin = 1.1;
    showBubble("All done!", 3500);
    refreshUI();
  }

  /* Measure again after the layout changes, then carry on from the first line below the spider. */
  function relayout(force) {
    if (!W.page || !WALKING_MODES.includes(W.mode)) return;
    if (!force && els.pages.clientWidth === W.layoutWidth && W.page.el.offsetHeight === W.pageH) return;
    measurePage();
    if (!W.lines.length) { endPage(); return; }
    releaseLegs();
    if (W.mode === "travel") { W.target = startPoint(); return; }
    const idx = W.lines.findIndex((l) => l.cy > W.y + 0.5);
    W.lineIdx = idx < 0 ? W.lines.length : idx;
    W.mode = "descend";
  }

  function moveToward(t, speed, dt) {
    const dx = t.x - W.x, dy = t.y - W.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) { W.moving = false; return true; }
    W.targetAngle = Math.atan2(dy, dx) / DEG + 90;
    const moved = Math.min(d, speed * dt);
    W.x += (dx / d) * moved;
    W.y += (dy / d) * moved;
    const stride = 26 * settings.size;
    W.phase += Math.min((moved / stride) * Math.PI * 2, dt * Math.PI * 2 * 5.5);
    W.moving = true;
    return moved >= d - 0.01;
  }

  function catchableOnLine(i) {
    return (W.lineErrs[i] || []).filter((it) => !it.err.caught && catchable(it.err));
  }

  /* Send legs out to the next batch of mistakes on this line. */
  function nextWave() {
    for (const L of W.legs) L.tk = 0;
    W.wave = [];
    W.reachHold = -1;
    W.reachQueue = W.reachQueue.filter((it) => !it.err.caught && catchable(it.err));
    if (!W.reachQueue.length) { W.mode = "descend"; return; }
    const a = W.angle * DEG, cos = Math.cos(a), sin = Math.sin(a);
    const sides = [[], []];
    for (const it of W.reachQueue) {
      const lx = (it.x - W.x) * cos + (it.y - W.y) * sin; // left or right from the spider's point of view
      sides[lx >= 0 ? 0 : 1].push({ it, dist: Math.abs(lx) });
    }
    const order = [1, 2, 0, 3]; // middle legs take the nearest mistakes, front and back legs the farther ones
    sides.forEach((arr, side) => {
      arr.sort((p, q) => p.dist - q.dist);
      arr.slice(0, 4).forEach((p, j) => {
        const n = side * 4 + order[j];
        const L = W.legs[n];
        L.tx = p.it.x; L.ty = p.it.y; L.tk = 1;
        W.wave.push({ leg: n, it: p.it });
      });
    });
    const taken = new Set(W.wave.map((w) => w.it));
    W.reachQueue = W.reachQueue.filter((it) => !taken.has(it));
    W.mode = "reach";
  }

  function step(dt) {
    const v = SPEEDS[settings.speed - 1].px;
    const travelSpeed = Math.max(v * 1.6, 70);
    switch (W.mode) {
      case "idle":
      case "done":
        W.mode = "next-page";
        break;

      case "next-page": {
        const nx = findNextPage();
        if (nx.page) {
          if (nx.page.ready) startPage(nx.page);
          else { setFrame(nx.page); W.mode = "wait"; refreshUI(); }
        } else if (nx.loading) {
          W.mode = "wait-doc";
          refreshUI();
        } else {
          finishWalk();
        }
        break;
      }

      case "wait": {
        const page = W.page;
        if (!page || page.doc.removed || page.walked) { W.mode = "next-page"; break; }
        if (page.ready) { startPage(page); break; }
        moveToward({ x: pageCenter(page), y: -4 }, travelSpeed, dt);
        break;
      }

      case "wait-doc": {
        W.moving = false;
        const nx = findNextPage();
        if (nx.page || !nx.loading) W.mode = "next-page";
        break;
      }

      case "travel":
        if (moveToward(W.target, travelSpeed, dt)) W.mode = "descend";
        break;

      case "descend": {
        if (W.page.el.offsetHeight !== W.pageH) { relayout(true); break; } // fonts or layout changed
        let stop = W.lineIdx;
        while (stop < W.lines.length && !catchableOnLine(stop).length) stop++;
        const stopY = stop < W.lines.length ? W.lines[stop].cy : Infinity;
        const goalY = Math.min(bottomY(), stopY);
        if (moveToward({ x: W.col, y: goalY }, v, dt)) {
          if (goalY === stopY) {
            W.lineIdx = stop + 1;
            W.reachQueue = catchableOnLine(stop);
            nextWave();
          } else {
            W.lineIdx = W.lines.length;
            endPage();
          }
        }
        break;
      }

      case "reach": {
        W.moving = false;
        if (W.reachHold < 0) {
          const touched = W.wave.every(({ leg }) => {
            const L = W.legs[leg];
            return L.k > 0.9 && Math.abs(L.px - L.tx) < 3 && Math.abs(L.py - L.ty) < 3;
          });
          if (touched) {
            let first = true;
            for (const { it } of W.wave) {
              if (!it.err.caught && catchable(it.err)) { catchError(it.err, true, !first); first = false; }
            }
            W.reachHold = Math.max(0.12, settings.pause);
          }
        } else {
          W.reachHold -= dt;
          if (W.reachHold <= 0) nextWave();
        }
        break;
      }
    }
  }

  /* Ease every leg toward what it's reaching for (or back to walking). */
  function updateLegs(dt) {
    const f = Math.min(1, dt * (9 + settings.speed * 1.2));
    for (const L of W.legs) {
      if (L.tk > 0) {
        if (L.k < 0.03) { L.px = L.tx; L.py = L.ty; }
        else { L.px += (L.tx - L.px) * f; L.py += (L.ty - L.py) * f; }
      }
      L.k += (L.tk - L.k) * f;
      if (L.tk === 0 && L.k < 0.003) L.k = 0;
    }
  }

  /* ---------------- Drawing ---------------- */
  function showBubble(text, ms) {
    W.bubbleText = text;
    W.bubbleUntil = ms ? performance.now() + ms : Infinity;
  }

  function render(dt, now) {
    const visible = W.page ? W.page.el.isConnected : (W.running && docs.length > 0);
    spider.svg.style.display = visible ? "" : "none";
    if (!visible) {
      els.silk.style.display = "none";
      els.bubble.hidden = true;
      return;
    }
    const off = frameOffset(W.page);
    const ax = W.x + off.x, ay = W.y + off.y;
    spider.place(ax, ay, W.angle);
    W.stride += ((W.moving ? 1 : 0) - W.stride) * Math.min(1, dt * 10);

    // Turn each reaching leg's target into the spider's own coordinates
    const a = W.angle * DEG, cos = Math.cos(a), sin = Math.sin(a), s = settings.size;
    const reach = W.legs.map((L) => {
      if (L.k <= 0) return null;
      const dx = (L.px - W.x) / s, dy = (L.py - W.y) / s;
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos, k: L.k };
    });
    spider.pose(W.phase, W.busy, W.idle, W.stride, reach);

    // Silk thread from the top of the page straight down to the spider's back end
    const onSilk = W.page && (W.mode === "descend" || W.mode === "reach" || (W.mode === "travel" && W.y > 0));
    if (settings.silk && onSilk) {
      const r = 24 * s;
      const bx = ax - Math.sin(a) * r, by = ay + Math.cos(a) * r;
      const sx = ax, sy = off.y;
      const len = Math.max(0, Math.hypot(bx - sx, by - sy));
      els.silk.style.display = "block";
      els.silk.style.width = len + "px";
      els.silk.style.transform = `translate(${sx}px, ${sy}px) rotate(${Math.atan2(by - sy, bx - sx)}rad)`;
    } else {
      els.silk.style.display = "none";
    }

    // Speech bubble
    let text = "";
    if (W.running && (W.mode === "wait" || W.mode === "wait-doc")) text = "Reading ahead…";
    else if (now < W.bubbleUntil) text = W.bubbleText;
    if (text) {
      if (els.bubble.textContent !== text) els.bubble.textContent = text;
      els.bubble.hidden = false;
      els.bubble.style.transform = `translate(${ax}px, ${ay - 34 * s}px) translate(-50%, -100%)`;
    } else {
      els.bubble.hidden = true;
    }

    // Keep the spider in view
    if (settings.follow && W.running && !W.paused && now > userScrollUntil) {
      const v = els.viewer;
      const desired = els.pages.offsetTop + ay - v.clientHeight * 0.42;
      const target = Math.max(0, Math.min(desired, v.scrollHeight - v.clientHeight));
      const diff = target - v.scrollTop;
      if (Math.abs(diff) > 0.5) v.scrollTop += reducedMotion ? diff : diff * Math.min(1, dt * 3.2);
    }
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    W.idle += dt;

    if (W.mode === "spin") {
      W.moving = false;
      W.spin -= dt;
      W.angle += (360 * dt) / 1.1;
      W.targetAngle = W.angle;
      if (W.spin <= 0) { W.mode = "done"; W.angle %= 360; W.targetAngle = W.angle; refreshUI(); }
    } else if (W.running && !W.paused) {
      step(dt);
    } else {
      W.moving = false;
    }

    updateLegs(dt);
    W.busy += ((W.mode === "reach" ? 1 : 0) - W.busy) * Math.min(1, dt * 10);
    if (W.mode !== "spin") {
      const d = ((((W.targetAngle - W.angle) % 360) + 540) % 360) - 180;
      W.angle += d * Math.min(1, dt * 9);
    }
    render(dt, now);

    if (!els.empty.hidden) {
      const sway = Math.sin(W.idle * 0.9) * 7;
      emptySpider.place(100 + sway * 0.6, 150 + Math.sin(W.idle * 1.3) * 4, 180 + sway);
      emptySpider.pose(W.idle * 0.4, 0, W.idle, 0.12, null);
      const thread = els.emptyArt.firstElementChild;
      thread.style.height = 150 + Math.sin(W.idle * 1.3) * 4 - 40 + "px";
      thread.style.transform = `translateX(${sway * 0.3}px) rotate(${-sway * 0.18}deg)`;
    }
    requestAnimationFrame(frame);
  }

  /* ==========================================================================
     UI wiring
     ========================================================================== */
  function refreshUI() {
    const loaded = anyLoaded();
    const unwalked = hasUnwalked();
    const walkingPage = W.running && W.page && WALKING_MODES.includes(W.mode);

    let label;
    if (W.running) label = W.paused ? "Resume" : "Pause";
    else if (!unwalked && loaded) label = "Walk again";
    else if (docs.some((d) => d.pages.some((p) => p.walked))) label = "Keep walking";
    else label = "Start walking";
    els.run.textContent = label;
    els.run.disabled = !loaded;
    els.skip.disabled = !walkingPage;
    els.all.disabled = !unwalked || !loaded;
    els.recheck.disabled = !docs.some((d) => d.loaded);
    updateStatus();
  }

  function updateStatus() {
    const total = CATS.reduce((a, c) => a + (settings.show[c] ? counts[c] : 0), 0);
    const word = total === 1 ? "mistake" : "mistakes";
    let msg;
    if (!docs.length) msg = "Add documents to begin.";
    else if (W.running && W.paused) msg = "Paused. Press Resume to keep walking.";
    else if (W.running && W.mode === "wait") {
      msg = ltWaiting
        ? "Waiting for LanguageTool's free limit to reset. This can take up to a minute."
        : `Waiting for page ${W.page.index + 1} of “${W.page.doc.name}” to finish checking…`;
    } else if (W.running && W.mode === "wait-doc") msg = "Waiting for the next document to open…";
    else if (W.running && W.page) msg = `Walking page ${W.page.index + 1} of ${W.page.doc.pages.length} in “${W.page.doc.name}”.`;
    else if (!hasUnwalked() && anyLoaded()) {
      const n = docs.filter((d) => d.loaded).length;
      msg = `Finished. Caught ${total} ${word} in ${n} ${n === 1 ? "document" : "documents"}.`;
    } else if (docs.some((d) => d.checking || !d.loaded)) msg = "Checking your documents. You can start walking now.";
    else msg = "Ready. Press Start walking.";
    if (els.status.textContent !== msg) els.status.textContent = msg;
  }

  let toastTimer = null;
  function notice(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 7000);
  }

  /* ---------------- Sound ---------------- */
  let audio = null;
  function ensureAudio() {
    if (!settings.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  function playCatchSound(cat) {
    if (!settings.sound) return;
    ensureAudio();
    if (!audio) return;
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    const f = cat === "spelling" ? 660 : cat === "grammar" ? 520 : 420;
    o.type = "triangle";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.2);
  }

  /* ---------------- Report ---------------- */
  function contextOf(err) {
    const t = err.page.text;
    const a = Math.max(0, err.offset - 40), b = Math.min(t.length, err.offset + err.length + 40);
    return (a > 0 ? "…" : "") + t.slice(a, b).replace(/\s+/g, " ") + (b < t.length ? "…" : "");
  }
  function csvCell(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets treating text as a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadReport() {
    const rows = [["Document", "Page", "Type", "Mistake", "Message", "Suggestions", "Context"]];
    for (const doc of docs) {
      for (const page of doc.pages) {
        for (const err of page.errors) {
          if (!err.caught || !settings.show[err.category]) continue;
          rows.push([doc.name, page.index + 1, CAT_LABEL[err.category], err.text, err.message,
            err.replacements.join(" | "), contextOf(err)]);
        }
      }
    }
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spell-spider-report.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ---------------- Sample ---------------- */
  const SAMPLE = `The Library at the Edge of Town

Last saturday, me and my freind decided to explore the old libary at the edge of town. Their is a rumor that the building is haunted, but we didnt believe it. When we arrived , the door was already open and a owl was sitting on the stairs.

Inside, it was more darker then we expected. My freind said we should of brought a flashlight. i agreed, but we kept walking anyway. The the floor creaked under every step, and dust floated in the air like tiny ghosts.

We found a book that had fell off a shelf. Its a diary from 1923, and the handwritting was beautiful.The last page said: "Whoever reads this, please take care of the library." We was so suprised that we almost dropped it.

Now we visit every week and help sort the shelfs. Its not haunted at all. It was just lonely, and it needed somebody to notice it.`;

  function loadSample() {
    const file = new File([SAMPLE], "sample-story.txt", { type: "text/plain" });
    addFiles([file]);
  }

  /* ---------------- Controls ---------------- */
  function applySettingsToUI() {
    els.speed.value = settings.speed;
    els.speedOut.textContent = SPEEDS[settings.speed - 1].name;
    els.pause.value = settings.pause;
    els.pauseOut.textContent = settings.pause > 0 ? settings.pause.toFixed(1) + " s" : "No stop";
    els.size.value = settings.size;
    els.sizeOut.textContent = Math.round(settings.size * 100) + "%";
    els.follow.checked = settings.follow;
    els.silkToggle.checked = settings.silk;
    els.sound.checked = settings.sound;
    els.language.value = settings.language;
    els.ignore.value = settings.ignore;
    document.querySelectorAll('input[name="engine"]').forEach((r) => { r.checked = r.value === settings.engine; });
    els.langRow.hidden = settings.engine !== "languagetool";
    applyKindVisibility();
  }

  function buildSwatches() {
    const frag = document.createDocumentFragment();
    const themes = window.Spider.THEMES;
    for (const id of THEME_ORDER) {
      const t = themes[id];
      const label = document.createElement("label");
      label.className = "swatch";
      label.title = t.name;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "theme";
      input.value = id;
      input.setAttribute("aria-label", t.name);
      input.checked = settings.theme === id;
      const dot = document.createElement("span");
      const stops = t.body.concat(t.body[0]).join(", ");
      dot.style.setProperty("--sw", `conic-gradient(from 200deg, ${stops})`);
      label.append(input, dot);
      frag.appendChild(label);
    }
    const custom = document.createElement("label");
    custom.className = "swatch swatch-custom";
    custom.title = "One color of your choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "theme";
    radio.value = "custom";
    radio.setAttribute("aria-label", "One color of your choice");
    radio.checked = settings.theme === "custom";
    const dot = document.createElement("span");
    dot.style.setProperty("--sw", settings.color);
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = settings.color;
    picker.setAttribute("aria-label", "Choose the spider's color");
    picker.tabIndex = -1;
    custom.append(radio, dot, picker);
    frag.appendChild(custom);
    els.colors.appendChild(frag);
    els.themeName.textContent = settings.theme === "custom" ? "Your color" : themes[settings.theme].name;

    els.colors.addEventListener("change", (e) => {
      if (e.target.name !== "theme") return;
      if (e.target.value === "custom") picker.click();
      setTheme(e.target.value);
    });
    picker.addEventListener("input", () => {
      radio.checked = true;
      settings.color = picker.value;
      dot.style.setProperty("--sw", picker.value);
      setTheme("custom");
    });
  }

  function setTheme(id) {
    settings.theme = id;
    spider.setTheme(id, settings.color);
    emptySpider.setTheme(id, settings.color);
    els.themeName.textContent = id === "custom" ? "Your color" : window.Spider.THEMES[id].name;
    saveSettings();
  }

  function applyKindVisibility() {
    for (const c of CATS) {
      els.pages.classList.toggle("hide-" + c, !settings.show[c]);
      els.caughtList.classList.toggle("hide-" + c, !settings.show[c]);
      const chip = document.querySelector(`.chip[data-cat="${c}"]`);
      if (chip) chip.setAttribute("aria-pressed", String(settings.show[c]));
    }
  }

  function parseIgnore(text) {
    return new Set(text.split(/[\n,;]+/).map((s) => s.trim().toLowerCase().replace(/’/g, "'")).filter(Boolean));
  }

  function wire() {
    els.run.addEventListener("click", () => {
      ensureAudio();
      if (W.running) {
        W.paused = !W.paused;
      } else {
        if (!hasUnwalked()) { resetCatches(); placeIdleSpider(true); }
        W.running = true;
        W.paused = false;
        if (!["wait", "wait-doc", ...WALKING_MODES].includes(W.mode)) W.mode = "next-page";
        userScrollUntil = 0;
      }
      refreshUI();
    });

    els.skip.addEventListener("click", () => {
      if (W.running && W.page && WALKING_MODES.includes(W.mode)) endPage();
    });

    els.all.addEventListener("click", () => {
      for (const doc of docs) {
        for (const page of doc.pages) {
          if (page.walked) continue;
          if (page.ready) sweepPage(page, false);
          else page.autoCatch = true;
        }
      }
      releaseLegs();
      W.running = false;
      W.paused = false;
      W.mode = "idle";
      refreshUI();
    });

    els.speed.addEventListener("input", () => {
      settings.speed = +els.speed.value;
      els.speedOut.textContent = SPEEDS[settings.speed - 1].name;
      saveSettings();
    });
    els.pause.addEventListener("input", () => {
      settings.pause = +els.pause.value;
      els.pauseOut.textContent = settings.pause > 0 ? settings.pause.toFixed(1) + " s" : "No stop";
      saveSettings();
    });
    els.size.addEventListener("input", () => {
      settings.size = +els.size.value;
      els.sizeOut.textContent = Math.round(settings.size * 100) + "%";
      spider.setSize(settings.size);
      saveSettings();
    });
    els.follow.addEventListener("change", () => { settings.follow = els.follow.checked; saveSettings(); });
    els.silkToggle.addEventListener("change", () => { settings.silk = els.silkToggle.checked; saveSettings(); });
    els.sound.addEventListener("change", () => {
      settings.sound = els.sound.checked;
      saveSettings();
      if (settings.sound) { ensureAudio(); playCatchSound("spelling"); }
    });

    document.querySelectorAll('input[name="engine"]').forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        settings.engine = r.value;
        saveSettings();
        els.langRow.hidden = settings.engine !== "languagetool";
        els.engineNote.hidden = !docs.some((d) => d.loaded);
        if (settings.engine === "builtin") C.Builtin.load();
      });
    });
    els.language.addEventListener("change", () => {
      settings.language = els.language.value;
      saveSettings();
      els.engineNote.hidden = !docs.some((d) => d.loaded) || settings.engine !== "languagetool";
    });

    let ignoreTimer = null;
    els.ignore.addEventListener("input", () => {
      clearTimeout(ignoreTimer);
      ignoreTimer = setTimeout(() => {
        settings.ignore = els.ignore.value;
        ignoreSet = parseIgnore(settings.ignore);
        saveSettings();
        syncCatches();
      }, 350);
    });

    els.recheck.addEventListener("click", recheckAll);

    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const c = chip.dataset.cat;
        settings.show[c] = !settings.show[c];
        saveSettings();
        applyKindVisibility();
        syncCatches();
        renderCounts();
      });
    });

    els.report.addEventListener("click", downloadReport);

    els.fileInput.addEventListener("change", () => {
      const files = Array.from(els.fileInput.files || []);
      els.fileInput.value = "";
      if (files.length) addFiles(files);
    });
    els.sample.addEventListener("click", loadSample);
    els.emptySample.addEventListener("click", loadSample);

    // Clicking an outlined mistake highlights it in the list
    els.pages.addEventListener("click", (e) => {
      const m = e.target.closest("mark.err.caught");
      if (!m) return;
      const err = errorsById.get(+m.dataset.id);
      if (!err || !err.item) return;
      setActiveItem(err);
      revealInList(err.item, true);
    });

    // If you scroll the documents yourself, the camera stops following for a few seconds
    const userScrolled = () => { userScrollUntil = performance.now() + 4000; };
    els.viewer.addEventListener("wheel", userScrolled, { passive: true });
    els.viewer.addEventListener("touchmove", userScrolled, { passive: true });
    els.viewer.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) userScrolled();
    });

    // Drag and drop anywhere
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      dragDepth++;
      els.dropOverlay.hidden = false;
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) els.dropOverlay.hidden = true;
    });
    window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) addFiles(files);
    });

    // Re-measure lines when the layout width changes or web fonts finish loading
    let relayoutTimer = null;
    const scheduleRelayout = () => {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(relayout, 120);
    };
    if (window.ResizeObserver) new ResizeObserver(scheduleRelayout).observe(els.pages);
    else window.addEventListener("resize", scheduleRelayout);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", scheduleRelayout);

    C.LanguageTool.onWait = (waiting) => { ltWaiting = waiting; updateStatus(); };
  }

  /* ---------------- Start ---------------- */
  ignoreSet = parseIgnore(settings.ignore);
  buildSwatches();
  applySettingsToUI();
  wire();
  renderCounts();
  refreshUI();
  requestAnimationFrame(frame);

  // A tiny hook for testing from the browser console
  window.SpellSpider = { addFiles, state: W, docs, settings };
})();
