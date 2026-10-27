/* ==========================================================================
   Spell Spider — app
   Loads documents, sends them to a checker, renders pages, and runs the
   walker: the spider walks straight down the middle of every page without
   stopping, and as it goes it plants a foot on each mistake. The moment a
   foot lands on a mistake, the mistake is outlined and added to the list.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const C = window.SpiderCheck;
  const X = window.SpiderExtract;
  const DEG = Math.PI / 180;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Settings ---------------- */
  // How fast the spider walks down the page, in pixels per second.
  const SPEEDS = [
    { px: 18, name: "Crawl" }, { px: 30, name: "Creep" }, { px: 48, name: "Amble" },
    { px: 72, name: "Stroll" }, { px: 105, name: "Walk" }, { px: 150, name: "Trot" },
    { px: 220, name: "Scurry" }, { px: 330, name: "Dash" }, { px: 520, name: "Sprint" },
    { px: 850, name: "Zoom" },
  ];
  const COLORS = [
    { hex: "#2b2140", name: "Midnight" },
    { hex: "#6b3a22", name: "Tarantula" },
    { hex: "#2f5d3a", name: "Moss" },
    { hex: "#8c1d3b", name: "Garnet" },
    { hex: "#8f8aa3", name: "Ghost" },
  ];
  const CATS = ["spelling", "grammar", "style"];
  const CAT_LABEL = { spelling: "Spelling", grammar: "Grammar", style: "Style" };

  // Body size on screen (pixels per body unit) before the Size setting is applied.
  const BODY_SCALE = 1.5;

  // Where each foot rests compared with the body, as a fraction of the leg reach R
  // (R is half the width of the text). x = out to the side, y = forward (-) or back (+).
  // Right legs front to back; the left legs mirror them.
  const HOME = [[0.66, -0.46], [0.93, -0.15], [0.91, 0.17], [0.64, 0.48]];
  const LOOK_AHEAD = 0.5;  // reach for mistakes this far ahead of the body (fraction of R)

  const STORE_KEY = "spell-spider-settings-v2";
  const DEFAULTS = {
    speed: 4, size: 1, color: "#2b2140",
    follow: true, silk: true, sound: false,
    engine: "languagetool", language: "en-US", ignore: "",
    show: { spelling: true, grammar: true, style: true },
  };

  function loadSettings() {
    const base = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("spell-spider-settings-v1");
      if (raw) {
        const s = JSON.parse(raw);
        const merged = Object.assign(base, s, { show: Object.assign(base.show, s.show || {}) });
        merged.speed = clamp(Math.round(+merged.speed || 4), 1, SPEEDS.length);
        merged.size = clamp(+merged.size || 1, 0.6, 1.8);
        delete merged.pause;
        return merged;
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
    size: $("#size"), sizeOut: $("#sizeOut"),
    colors: $("#colors"), follow: $("#follow"), silkToggle: $("#silkToggle"), sound: $("#sound"),
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
  const stats = { legs: 0, sweep: 0, direct: 0 }; // how each mistake got caught (for testing)
  let nextDocId = 1;
  let nextErrId = 1;
  let ignoreSet = new Set();
  let ltWaiting = false;
  let fallbackNoticeShown = false;
  let userScrollUntil = 0;

  const spider = new window.Spider({ color: settings.color, size: BODY_SCALE * settings.size });
  els.pages.appendChild(spider.svg);
  spider.svg.style.display = "none";

  const emptySpider = new window.Spider({ color: settings.color, size: 1.9, legPx: 5 });
  els.emptyArt.appendChild(emptySpider.svg);

  // The walker: where the spider is and what it's doing. x/y are measured from the
  // top-left of the current page (W.page), so the spider stays put on screen when
  // documents above it are added or removed.
  const W = {
    running: false, paused: false, mode: "idle",
    page: null, x: 0, y: 24, angle: 180, targetAngle: 180,
    speedNow: 0, moving: false, idle: 0, clock: 0, grab: 0, spin: 0,
    cx: 0, R: 160, textTop: 0, textBottom: 0, targets: [], targetById: new Map(), measuredPage: null,
    legs: Array.from({ length: 8 }, () => ({ x: 0, y: 0, lift: 0, swing: null, err: null, landedAt: -1 })),
    layoutWidth: 0, pageH: 0, bubbleUntil: 0, bubbleText: "",
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
    li.querySelector(".doc-ext").textContent = X.label(kind);
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
        notice(`“${file.name}” can't be read. Use .txt, .md, .pdf, .docx, .rtf or .html files.`);
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
        console.error(err);
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
      setFrame(null);
      if (W.running && !["spin", "done", "idle"].includes(W.mode)) W.mode = "next-page";
    }
    doc.removed = true;
    for (const page of doc.pages) {
      for (const err of page.errors) {
        if (err.caught) counts[err.category]--;
        errorsById.delete(err.id);
      }
    }
    // Any foot on its way to one of this document's mistakes just takes a normal step.
    for (const leg of W.legs) {
      if (leg.swing && leg.swing.err && leg.swing.err.doc === doc) leg.swing.err = null;
      if (leg.err && leg.err.doc === doc) leg.err = null;
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
        if (!doc.removed && doc.loaded) {
          try { await checkDoc(doc); } catch (err) { console.error(err); finishDocAnyway(doc); }
        }
      }
    } finally {
      checkBusy = false;
    }
  }

  /* If checking crashes, still show the pages so the spider doesn't wait forever. */
  function finishDocAnyway(doc) {
    doc.checking = false;
    for (const page of doc.pages) if (!page.ready) { page.piecesLeft = 0; finalizePage(page); }
    updateDocState(doc);
    refreshUI();
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

  function englishResult(matches) {
    const lang = (matches && matches.language) || settings.language || "";
    return /^en/i.test(lang) || (settings.language === "auto" && !matches.language);
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
        notice("The spelling dictionary couldn't load, so only the grammar rules are running.");
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
        if (engine === C.LanguageTool && englishResult(matches)) {
          // The built-in grammar rules add the odd mistake LanguageTool lets slide.
          matches = C.mergeExtra(matches, C.Builtin.grammar(batch.text));
        }
      } catch (err) {
        if (engine === C.LanguageTool) {
          if (!fallbackNoticeShown) {
            notice(`${err.message} Using the private built-in checker instead for now.`);
            fallbackNoticeShown = true;
          }
          engine = C.Builtin;
          try { matches = await C.Builtin.check(batch.text); } catch (e) { matches = []; }
        } else {
          console.error(err);
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
        ruleId: m.ruleId || "", caught: false, el: null, item: null, leg: null,
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
    if (W.measuredPage === page) measurePage(page);
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
    W.targets = [];
    W.targetById.clear();
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
  function alive(err) {
    return errorsById.get(err.id) === err && !err.doc.removed;
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
      err.leg = null;
      if (err.el) { err.el.classList.remove("caught", "lasso", "flash"); err.el.removeAttribute("title"); }
    }
    for (const leg of W.legs) {
      if (leg.swing) leg.swing.err = null;
      leg.err = null;
    }
    for (const doc of docs) {
      doc.groupEl = null;
      for (const page of doc.pages) page.walked = false;
      updateDocState(doc);
    }
    els.caughtList.textContent = "";
    for (const c of CATS) counts[c] = 0;
    stats.legs = stats.sweep = stats.direct = 0;
    renderCounts();
  }

  /* Catch everything left on a page that the spider is allowed to catch. */
  function sweepPage(page, animate) {
    for (const err of page.errors) {
      if (!err.caught && catchable(err)) { catchError(err, animate, true); stats.sweep++; }
    }
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
    els.caughtEmpty.hidden = els.caughtList.children.length > 0;
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
     The body walks straight down the middle of the text. Each of the eight feet
     stays planted where it landed until the body has moved on, then steps
     forward again (alternating groups of four, like a real spider). When a
     mistake comes within reach, the best-placed free leg steps right onto it,
     and the mistake is caught the instant that foot lands. The body never
     slows down for a catch.
     ========================================================================== */
  function frameOffset(page) {
    if (page && page.el && page.el.isConnected) return { x: page.el.offsetLeft, y: page.el.offsetTop };
    return { x: 0, y: 0 };
  }

  /* Switch the spider's coordinates to another page without moving it on screen. */
  function setFrame(page) {
    const a = frameOffset(W.page);
    const b = frameOffset(page);
    const dx = a.x - b.x, dy = a.y - b.y;
    W.x += dx; W.y += dy;
    for (const leg of W.legs) {
      leg.x += dx; leg.y += dy;
      const s = leg.swing;
      if (s) {
        s.sx += dx; s.sy += dy;
        s.target = { x: s.target.x + dx, y: s.target.y + dy };
      }
    }
    W.page = page;
  }

  function rot(deg, x, y) {
    const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }
  function forward() {
    const a = W.angle * DEG;
    return { x: Math.sin(a), y: -Math.cos(a) };
  }
  // Leg k's resting foot position relative to the body, in pixels, before rotation.
  function homeLocal(k) {
    const h = HOME[k & 3];
    return [(k < 4 ? 1 : -1) * h[0] * W.R, h[1] * W.R];
  }
  // Leg k's resting foot position in page coordinates.
  function homeAt(k, tuck) {
    const [lx, ly] = homeLocal(k);
    const t = tuck || 1;
    const [ox, oy] = rot(W.angle, lx * t, ly * t);
    return { x: W.x + ox, y: W.y + oy };
  }
  function gaitGroup(k) { return ((k & 3) + (k >> 2)) % 2; }

  function snapFeet() {
    for (let k = 0; k < 8; k++) {
      const h = homeAt(k);
      const leg = W.legs[k];
      if (leg.swing && leg.swing.err && leg.swing.err.leg === k) leg.swing.err.leg = null;
      leg.x = h.x; leg.y = h.y; leg.swing = null; leg.lift = 0; leg.err = null;
    }
  }

  /* Measure the page: its middle, how far the legs must reach, where the text
     starts and ends, and where every mistake sits. */
  function measurePage(page) {
    if (!page || !page.el.isConnected) return;
    const body = page.bodyEl;
    W.cx = body.offsetLeft + body.offsetWidth / 2;
    W.R = Math.max(60, body.clientWidth / 2 + 4);
    const blocks = body.children;
    if (blocks.length) {
      const first = blocks[0], last = blocks[blocks.length - 1];
      W.textTop = first.offsetTop;
      W.textBottom = last.offsetTop + last.offsetHeight;
    } else {
      W.textTop = body.offsetTop;
      W.textBottom = body.offsetTop + body.offsetHeight;
    }
    if (W.measuredPage !== page) { W.targetById = new Map(); W.measuredPage = page; }
    const base = page.el.getBoundingClientRect();
    const list = [];
    for (const err of page.errors) {
      if (!err.el) continue;
      const rects = Array.from(err.el.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
      if (!rects.length) continue;
      const r = rects[0];
      let t = W.targetById.get(err.id);
      if (!t || t.err !== err) { t = { err, x: 0, y: 0 }; W.targetById.set(err.id, t); }
      t.x = r.left + r.width / 2 - base.left;
      t.y = r.top + r.height / 2 - base.top;
      list.push(t);
    }
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    W.targets = list;
    W.layoutWidth = els.pages.clientWidth;
    W.pageH = page.el.offsetHeight;
  }

  function firstPage() {
    for (const doc of docs) if (doc.loaded && doc.pages.length) return doc.pages[0];
    return null;
  }

  /* When nothing is happening, park the spider at the top of the first page. */
  function placeIdleSpider(force) {
    if (W.running || W.mode === "spin") return; // never yank a spider that's busy
    const page = firstPage();
    if (!page) { W.page = null; return; }
    if (force || !W.page || !W.page.el.isConnected || W.mode === "idle") {
      W.page = page;
      measurePage(page);
      W.x = W.cx; W.y = 24; W.angle = W.targetAngle = 180; W.speedNow = 0;
      W.mode = "idle";
      snapFeet();
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

  function startPage(page) {
    setFrame(page);
    measurePage(page);
    // If the spider is already below the start of this page's text (a document above it
    // was removed, or everything was re-checked), hop back to the top of the page first,
    // so no part of the page is skipped.
    if (W.y > W.textTop) {
      W.x = W.cx; W.y = 24; W.speedNow = 0; W.angle = W.targetAngle = 180;
      snapFeet();
    }
    W.mode = "walk";
    refreshUI();
  }

  function endPage() {
    const page = W.page;
    if (page && !page.doc.removed) sweepPage(page, true); // safety net: nothing is ever left behind
    W.mode = "next-page";
    refreshUI();
  }

  function finishWalk() {
    W.running = false;
    W.paused = false;
    W.mode = "spin";
    W.spin = 1.1;
    W.speedNow = 0;
    for (const leg of W.legs) leg.swing = null;
    showBubble("All done!", 3500);
    refreshUI();
  }

  function relayout() {
    if (!W.page || !W.page.el.isConnected) return;
    if (els.pages.clientWidth === W.layoutWidth && W.page.el.offsetHeight === W.pageH) return;
    measurePage(W.page);
    if (!W.running && W.mode === "idle") { W.x = W.cx; snapFeet(); }
  }

  /* ---- Moving the body ---- */
  function walkBody(dt, v) {
    // Full walking speed over the text; hurry through empty space between pages.
    const zoneTop = W.textTop - W.R * 0.7;
    const zoneBottom = W.textBottom + W.R * 0.2;
    let want = v;
    if (W.y < zoneTop) want = Math.max(v, Math.min(1400, 160 + (zoneTop - W.y) * 2.5));
    else if (W.y > zoneBottom) want = Math.max(v, 240);
    W.speedNow += (want - W.speedNow) * Math.min(1, dt * 6);
    W.y += W.speedNow * dt;
    W.x += (W.cx - W.x) * Math.min(1, dt * 4);
    W.targetAngle = 180;
    W.moving = W.speedNow > 0.5;
  }

  function moveToward(tx, ty, speed, dt) {
    const dx = tx - W.x, dy = ty - W.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) { W.moving = false; W.speedNow = 0; return true; }
    const moved = Math.min(d, speed * dt);
    W.x += (dx / d) * moved;
    W.y += (dy / d) * moved;
    W.speedNow = moved / Math.max(dt, 1e-6);
    W.moving = true;
    W.targetAngle = 180;
    return moved >= d - 0.5;
  }

  /* ---- Legs ---- */
  function catchStepTime(v) { return clamp(18 / Math.max(v, W.speedNow, 1), 0.07, 0.24); }
  function walkStepTime(v) { return clamp(30 / Math.max(v, W.speedNow, 1), 0.12, 0.42); }

  function startSwing(k, target, err, dur) {
    const leg = W.legs[k];
    if (leg.swing && leg.swing.err && leg.swing.err !== err && leg.swing.err.leg === k) leg.swing.err.leg = null;
    leg.swing = { sx: leg.x, sy: leg.y, target, err: err || null, t: 0, dur };
    if (err) err.leg = k;
  }

  function land(k) {
    const leg = W.legs[k];
    const s = leg.swing;
    leg.swing = null;
    leg.lift = 0;
    leg.x = s.target.x;
    leg.y = s.target.y;
    leg.err = null;
    const err = s.err;
    if (!err) return;
    if (err.leg === k) err.leg = null;
    if (!alive(err)) return;
    leg.err = err;
    leg.landedAt = W.clock;
    if (!err.caught && catchable(err)) {
      catchError(err, true);
      stats.legs++;
      footBurst(leg.x, leg.y, err.category);
      W.grab = 1;
    }
  }

  /* Pick the free leg whose resting spot is closest to the mistake, preferring
     legs on the same side of the body. */
  function pickLeg(t) {
    let best = -1, bestScore = Infinity;
    const side = t.x - W.x;
    for (let k = 0; k < 8; k++) {
      const leg = W.legs[k];
      if (leg.swing && leg.swing.err) continue; // already heading for a mistake
      const h = homeAt(k);
      const sameSide = Math.abs(side) < W.R * 0.08 || Math.sign(h.x - W.x) === Math.sign(side);
      let score = Math.hypot(h.x - t.x, h.y - t.y) + (sameSide ? 0 : W.R * 0.9);
      if (leg.err && W.clock - leg.landedAt < 0.12) score += W.R * 0.3; // it just landed; let it stand a beat
      if (score < bestScore) { bestScore = score; best = k; }
    }
    return best;
  }

  /* Send legs to every mistake that has come within reach. */
  function reachForMistakes(v) {
    const f = forward();
    const ahead0 = W.R * LOOK_AHEAD;
    for (const t of W.targets) {
      const err = t.err;
      if (err.caught || err.leg != null || !catchable(err) || !alive(err)) continue;
      const ahead = (t.x - W.x) * f.x + (t.y - W.y) * f.y;
      if (ahead > ahead0) break; // targets are sorted top to bottom
      const urgent = ahead < -W.R * 0.45; // the body already went past it: grab it right now
      const k = pickLeg(t);
      if (k < 0) {
        if (urgent) { catchError(err, true); stats.direct++; }
        continue;
      }
      startSwing(k, t, err, urgent ? 0.06 : catchStepTime(v));
    }
  }

  function pendingCatchesOn(page) {
    return W.legs.some((l) => l.swing && l.swing.err && l.swing.err.page === page);
  }

  function updateLegs(dt, v, gait) {
    // Move feet that are mid-step.
    for (let k = 0; k < 8; k++) {
      const leg = W.legs[k];
      const s = leg.swing;
      if (!s) continue;
      s.t = Math.min(1, s.t + dt / s.dur);
      const e = s.t < 0.5 ? 2 * s.t * s.t : 1 - Math.pow(-2 * s.t + 2, 2) / 2;
      leg.x = s.sx + (s.target.x - s.sx) * e;
      leg.y = s.sy + (s.target.y - s.sy) * e;
      leg.lift = Math.sin(Math.PI * s.t);
      if (s.t >= 1) land(k);
    }
    if (!gait) return;

    // Ordinary walking: a planted foot that has fallen behind steps forward again.
    const T = W.R * 0.24;
    const f = forward();
    const busy = [false, false];
    for (let k = 0; k < 8; k++) {
      const s = W.legs[k].swing;
      if (s && !s.err) busy[gaitGroup(k)] = true;
    }
    for (let k = 0; k < 8; k++) {
      const leg = W.legs[k];
      if (leg.swing) continue;
      const h = homeAt(k);
      const lag = (h.x - leg.x) * f.x + (h.y - leg.y) * f.y;
      const dist = Math.hypot(h.x - leg.x, h.y - leg.y);
      if (leg.err) {
        // A foot standing on a mistake stays there until the body has walked past it.
        if (lag <= T * 0.8 && dist <= W.R * 1.4) continue;
        if (W.clock - leg.landedAt < 0.18) continue;
      } else if (lag <= T && dist <= W.R * 0.5) {
        continue;
      }
      const g = gaitGroup(k);
      if (busy[1 - g] && lag < T * 1.8 && dist < W.R * 0.85) continue;
      const lead = W.moving ? T * 0.45 : 0;
      startSwing(k, { x: h.x + f.x * lead, y: h.y + f.y * lead }, null, walkStepTime(v));
      busy[g] = true;
    }
  }

  function step(dt) {
    const v = SPEEDS[settings.speed - 1].px;
    switch (W.mode) {
      case "idle":
      case "done":
        W.mode = "next-page";
        break;

      case "next-page": {
        const nx = findNextPage();
        if (nx.page) {
          if (nx.page.ready) startPage(nx.page);
          else { setFrame(nx.page); measurePage(nx.page); W.mode = "wait"; refreshUI(); }
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
        // Walk to the top of the page that's still being checked and wait there.
        moveToward(W.cx, W.y < 24 ? 24 : W.y, Math.max(v, 160), dt);
        break;
      }

      case "wait-doc": {
        W.moving = false;
        W.speedNow = 0;
        const nx = findNextPage();
        if (nx.page || !nx.loading) W.mode = "next-page";
        break;
      }

      case "walk": {
        walkBody(dt, v);
        reachForMistakes(v);
        if (W.y >= W.textBottom + W.R * 0.1 && !pendingCatchesOn(W.page)) endPage();
        break;
      }
    }
    if (W.mode !== "spin") updateLegs(dt, v, true);
  }

  /* ---------------- Drawing ---------------- */
  function showBubble(text, ms) {
    W.bubbleText = text;
    W.bubbleUntil = ms ? performance.now() + ms : Infinity;
  }

  function footBurst(x, y, cat) {
    if (reducedMotion) return;
    const off = frameOffset(W.page);
    const b = document.createElement("span");
    b.className = "foot-burst cat-" + cat;
    b.style.left = off.x + x + "px";
    b.style.top = off.y + y + "px";
    els.pages.appendChild(b);
    setTimeout(() => b.remove(), 700);
  }

  function drawSpider() {
    const sc = spider.size;
    const feet = [], rest = [], lift = [];
    for (let k = 0; k < 8; k++) {
      const leg = W.legs[k];
      feet.push(rot(-W.angle, (leg.x - W.x) / sc, (leg.y - W.y) / sc));
      const [hx, hy] = homeLocal(k);
      const hp = window.Spider.hip(k);
      rest.push(Math.max(8, Math.hypot(hx / sc - hp[0], hy / sc - hp[1])));
      lift.push(leg.lift || 0);
    }
    spider.reach(feet, rest, lift);
    spider.face(W.idle, W.grab);
  }

  function render(dt, now) {
    const visible = !!(W.page && W.page.el.isConnected);
    spider.svg.style.display = visible ? "" : "none";
    if (!visible) {
      els.silk.style.display = "none";
      els.bubble.hidden = true;
      return;
    }
    const off = frameOffset(W.page);
    const ax = W.x + off.x, ay = W.y + off.y;
    spider.place(ax, ay, W.angle);
    drawSpider();

    // Silk thread from the top of the page down to the spider's back end
    const walking = W.running && ["walk", "wait"].includes(W.mode);
    const [tx, ty] = rot(W.angle, 0, 25 * spider.size);
    const bx = ax + tx, by = ay + ty;
    const sx = off.x + W.cx, sy = off.y;
    if (settings.silk && walking && by - sy > 4) {
      const len = Math.hypot(bx - sx, by - sy);
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
      els.bubble.style.transform = `translate(${ax}px, ${ay - 30 * spider.size}px) translate(-50%, -100%)`;
    } else {
      els.bubble.hidden = true;
    }

    // Keep the spider in view, with room to see what's coming
    if (settings.follow && W.running && !W.paused && now > userScrollUntil) {
      const v = els.viewer;
      const desired = els.pages.offsetTop + ay - v.clientHeight * 0.36;
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
    const v = SPEEDS[settings.speed - 1].px;

    if (W.mode === "spin") {
      // A happy twirl at the end, legs pulled in a little.
      W.moving = false;
      W.spin -= dt;
      W.angle += (360 * dt) / 1.1;
      W.targetAngle = W.angle;
      for (let k = 0; k < 8; k++) {
        const h = homeAt(k, 0.6);
        const leg = W.legs[k];
        leg.x += (h.x - leg.x) * Math.min(1, dt * 14);
        leg.y += (h.y - leg.y) * Math.min(1, dt * 14);
        leg.lift = 0.4;
      }
      if (W.spin <= 0) {
        W.mode = "done";
        W.angle = W.targetAngle = 180;
        for (let k = 0; k < 8; k++) startSwing(k, homeAt(k), null, 0.35);
        refreshUI();
      }
    } else if (W.running && !W.paused) {
      W.clock += dt;
      step(dt);
    } else if (!W.paused) {
      W.clock += dt;
      W.moving = false;
      updateLegs(dt, v, false);
    } else {
      W.moving = false;
    }

    W.grab += (0 - W.grab) * Math.min(1, dt * 8);
    if (W.mode !== "spin") {
      const d = ((((W.targetAngle - W.angle) % 360) + 540) % 360) - 180;
      W.angle += d * Math.min(1, dt * 9);
    }
    render(dt, now);

    if (!els.empty.hidden) {
      const sway = Math.sin(W.idle * 0.9) * 7;
      emptySpider.place(100 + sway * 0.6, 150 + Math.sin(W.idle * 1.3) * 4, 180 + sway);
      emptySpider.hangPose(W.idle * 0.4, W.idle, 0.12);
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
    const walkingPage = W.running && W.page && W.mode === "walk";

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
    else if (W.running && W.mode === "wait" && W.page) {
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
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
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
    let file;
    try { file = new File([SAMPLE], "sample-story.txt", { type: "text/plain" }); }
    catch (e) { file = new Blob([SAMPLE], { type: "text/plain" }); file.name = "sample-story.txt"; }
    addFiles([file]);
  }

  /* ---------------- Controls ---------------- */
  function applySettingsToUI() {
    els.speed.value = settings.speed;
    els.speedOut.textContent = SPEEDS[settings.speed - 1].name;
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
    let matched = false;
    for (const c of COLORS) {
      const label = document.createElement("label");
      label.className = "swatch";
      label.title = c.name;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "color";
      input.value = c.hex;
      input.setAttribute("aria-label", c.name);
      if (c.hex.toLowerCase() === settings.color.toLowerCase()) { input.checked = true; matched = true; }
      const dot = document.createElement("span");
      dot.style.setProperty("--sw", c.hex);
      label.append(input, dot);
      frag.appendChild(label);
    }
    const custom = document.createElement("label");
    custom.className = "swatch swatch-custom";
    custom.title = "Pick any color";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "color";
    radio.value = "custom";
    radio.setAttribute("aria-label", "Custom color");
    radio.checked = !matched;
    const dot = document.createElement("span");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = settings.color;
    picker.setAttribute("aria-label", "Choose a custom color");
    picker.tabIndex = -1;
    custom.append(radio, dot, picker);
    frag.appendChild(custom);
    els.colors.appendChild(frag);

    els.colors.addEventListener("change", (e) => {
      if (e.target.name === "color" && e.target.value !== "custom") setColor(e.target.value);
      if (e.target.name === "color" && e.target.value === "custom") picker.click();
    });
    picker.addEventListener("input", () => { radio.checked = true; setColor(picker.value); });
  }

  function setColor(hex) {
    settings.color = hex;
    spider.setColor(hex);
    emptySpider.setColor(hex);
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
        if (!hasUnwalked()) { resetCatches(); W.mode = "idle"; placeIdleSpider(true); }
        W.running = true;
        W.paused = false;
        if (!["wait", "wait-doc", "walk"].includes(W.mode)) W.mode = "next-page";
        userScrollUntil = 0;
      }
      refreshUI();
    });

    els.skip.addEventListener("click", () => {
      if (W.running && W.page && W.mode === "walk") endPage();
    });

    els.all.addEventListener("click", () => {
      for (const doc of docs) {
        for (const page of doc.pages) {
          if (page.walked) continue;
          if (page.ready) sweepPage(page, false);
          else page.autoCatch = true;
        }
      }
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
    els.size.addEventListener("input", () => {
      settings.size = +els.size.value;
      els.sizeOut.textContent = Math.round(settings.size * 100) + "%";
      spider.setSize(BODY_SCALE * settings.size);
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

    // Picking files. Copy the list first, then clear the input so the same file can be picked again.
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

    // Drag and drop anywhere on the page
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      els.dropOverlay.hidden = false;
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) els.dropOverlay.hidden = true;
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) addFiles(files);
    });

    // Re-measure when the layout width changes or web fonts finish loading
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
  // Get the private dictionary ready in the background, so it's there instantly if it's needed.
  setTimeout(() => { C.Builtin.load(); }, 1500);

  // A tiny hook for testing from the browser console
  window.SpellSpider = { addFiles, state: W, docs, settings, stats };
})();
