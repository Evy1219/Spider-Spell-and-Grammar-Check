/* ==========================================================================
   Spell Spider — turning uploaded files into pages of paragraphs
   Supports plain text (.txt .md .csv .log), .html, .rtf, .pdf (PDF.js) and .docx (mammoth.js)
   Result: { kind, pages: [ { paragraphs: [string] } ] }
   ========================================================================== */
(function () {
  "use strict";

  // Bundled copies first (they work offline and from a double-clicked index.html), CDN as a backup.
  const PDFJS = ["lib/pdf.min.js", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js"];
  const PDFJS_WORKER = ["lib/pdf.worker.min.js", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js"];
  const MAMMOTH = ["lib/mammoth.browser.min.js", "https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js"];

  const TEXT_PAGE_CHARS = 2600; // how much plain text goes on one "page"

  function kindOf(file) {
    const name = (file.name || "").toLowerCase();
    const type = file.type || "";
    if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
    if (name.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
    if (/\.(html?|xhtml)$/.test(name) || type === "text/html") return "html";
    if (name.endsWith(".rtf") || /rtf/.test(type)) return "rtf";
    if (/\.(txt|md|markdown|text|csv|log)$/.test(name) || type.startsWith("text/")) return "text";
    if (!/\.[a-z0-9]{1,5}$/.test(name) && !type) return "text"; // a file with no extension: try it as text
    return null;
  }

  function label(kind) {
    return { pdf: ".pdf", docx: ".docx", html: ".html", rtf: ".rtf" }[kind] || ".txt";
  }

  /* Split one very long paragraph at sentence ends so a page never gets huge. */
  function splitLong(para, max) {
    if (para.length <= max) return [para];
    const parts = [];
    let rest = para;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(". ", max);
      if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
      if (cut < max * 0.3) cut = max;
      parts.push(rest.slice(0, cut + 1).trimEnd());
      rest = rest.slice(cut + 1).trimStart();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  function paginateText(text) {
    const clean = text
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u2028\u2029]/g, "\n")
      .replace(/\u00A0/g, " ")
      .replace(/\t/g, "    ")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    const paras = [];
    for (const block of clean.split(/\n[ \t]*\n+/)) {
      const p = block.replace(/^\n+|\s+$/g, "");
      if (p.trim()) paras.push(...splitLong(p, TEXT_PAGE_CHARS));
    }
    const pages = [];
    let cur = [], size = 0;
    for (const p of paras) {
      if (cur.length && size + p.length > TEXT_PAGE_CHARS) {
        pages.push({ paragraphs: cur });
        cur = []; size = 0;
      }
      cur.push(p);
      size += p.length + 2;
    }
    if (cur.length) pages.push({ paragraphs: cur });
    if (!pages.length) pages.push({ paragraphs: [] });
    return pages;
  }

  /* Read text as UTF-8, or as Windows-1252 when it isn't valid UTF-8 (older Windows text files). */
  async function decodeText(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch (e) {
      try { return new TextDecoder("windows-1252").decode(buf); } catch (e2) { return new TextDecoder().decode(buf); }
    }
  }

  async function readText(file) {
    return paginateText(await decodeText(file));
  }

  /* ---- HTML: keep the visible text, one paragraph per block ---- */
  async function readHtml(file) {
    const doc = new DOMParser().parseFromString(await decodeText(file), "text/html");
    doc.querySelectorAll("script, style, noscript, template, svg, head").forEach((n) => n.remove());
    const blocks = "p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr,section,article,header,footer,td,th,dt,dd,figcaption";
    doc.querySelectorAll(blocks).forEach((n) => { n.insertAdjacentText("beforebegin", "\n\n"); n.insertAdjacentText("afterend", "\n\n"); });
    doc.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
    const text = (doc.body ? doc.body.textContent : doc.documentElement.textContent) || "";
    return paginateText(text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"));
  }

  /* ---- RTF (WordPad, TextEdit): a small reader that keeps the text and drops the formatting ---- */
  const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl",
    "headerr", "footerl", "footerr", "object", "themedata", "colorschememapping", "latentstyles", "datastore",
    "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator", "mmathPr", "fldinst"]);
  const CP1252 = { 128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ", 137: "‰", 138: "Š",
    139: "‹", 140: "Œ", 142: "Ž", 145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜",
    153: "™", 154: "š", 155: "›", 156: "œ", 158: "ž", 159: "Ÿ" };

  function rtfToText(rtf) {
    let out = "";
    const stack = [];
    let skip = false, uc = 1, skipChars = 0;
    let i = 0;
    const n = rtf.length;
    const emit = (s) => {
      if (skip) return;
      if (skipChars > 0) { skipChars--; return; }
      out += s;
    };
    while (i < n) {
      const c = rtf[i];
      if (c === "{") { stack.push({ skip, uc }); i++; continue; }
      if (c === "}") { const st = stack.pop(); if (st) { skip = st.skip; uc = st.uc; } i++; continue; }
      if (c === "\\") {
        const next = rtf[i + 1];
        if (next === "\\" || next === "{" || next === "}") { emit(next); i += 2; continue; }
        if (next === "'") {
          const code = parseInt(rtf.substr(i + 2, 2), 16);
          if (!isNaN(code)) emit(CP1252[code] || String.fromCharCode(code));
          i += 4; continue;
        }
        if (next === "*") { skip = true; i += 2; continue; }
        if (next === "~") { emit(" "); i += 2; continue; }
        if (next === "-" || next === "_") { if (next === "_") emit("-"); i += 2; continue; }
        if (next === "\n" || next === "\r") { emit("\n"); i += 2; continue; }
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
        if (!m) { i += 2; continue; }
        const word = m[1], arg = m[2] !== undefined ? parseInt(m[2], 10) : null;
        i += 1 + m[0].length;
        if (RTF_SKIP.has(word)) { skip = true; continue; }
        switch (word) {
          case "par": case "line": case "sect": case "row": emit("\n"); break;
          case "page": emit("\n\n"); break;
          case "tab": case "cell": emit("\t"); break;
          case "emdash": emit("—"); break;
          case "endash": emit("–"); break;
          case "lquote": emit("‘"); break;
          case "rquote": emit("’"); break;
          case "ldblquote": emit("“"); break;
          case "rdblquote": emit("”"); break;
          case "bullet": emit("•"); break;
          case "uc": uc = arg || 0; break;
          case "u": {
            let code = arg || 0;
            if (code < 0) code += 65536;
            emit(String.fromCharCode(code));
            skipChars = uc;
            break;
          }
          default: break;
        }
        continue;
      }
      if (c === "\r" || c === "\n") { i++; continue; }
      emit(c);
      i++;
    }
    // A single \par is a new paragraph in RTF, so turn line breaks into paragraph breaks.
    return out.replace(/\t/g, " ").replace(/[ ]*\n[ ]*/g, "\n").replace(/\n+/g, "\n\n");
  }

  async function readRtf(file) {
    const raw = await decodeText(file);
    if (!/^\s*\{\\rtf/.test(raw)) return paginateText(raw);
    return paginateText(rtfToText(raw));
  }

  /* ---- Word .docx ---- */
  async function readDocx(file) {
    await window.SpiderCheck.loadFirst(MAMMOTH, () => !!window.mammoth);
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return paginateText(result.value || "");
  }

  /* ---- PDF: rebuild lines and paragraphs from positioned text pieces ---- */
  let pdfMainThread = false;

  async function usePdfMainThread() {
    // Web workers can't start from a file:// page in some browsers. Loading the worker
    // code onto the page makes PDF.js run it here instead.
    await window.SpiderCheck.loadFirst(PDFJS_WORKER, () => !!(window.pdfjsWorker && window.pdfjsWorker.WorkerMessageHandler));
    pdfMainThread = true;
  }

  async function openPdf(lib, data) {
    try {
      return await lib.getDocument({ data: data.slice(0), isEvalSupported: false }).promise;
    } catch (err) {
      if (err && err.name === "PasswordException") throw new Error("this PDF is password-protected");
      if (pdfMainThread) throw err;
      await usePdfMainThread();
      return await lib.getDocument({ data: data.slice(0), isEvalSupported: false }).promise;
    }
  }

  async function readPdf(file, onProgress) {
    await window.SpiderCheck.loadFirst(PDFJS, () => !!window.pdfjsLib);
    const lib = window.pdfjsLib;
    const local = !/^https?:/.test(location.protocol);
    if (local && !pdfMainThread) {
      try { await usePdfMainThread(); } catch (e) { /* try the worker anyway */ }
    }
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER[0], location.href).href;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await openPdf(lib, data);
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (onProgress) onProgress(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push({ paragraphs: pdfParagraphs(content.items) });
      page.cleanup();
    }
    pdf.destroy();
    return pages;
  }

  function pdfParagraphs(items) {
    const lines = [];
    let cur = null;
    let lastEndX = null;
    const pushLine = () => {
      if (cur && cur.text.trim()) {
        cur.text = cur.text.replace(/\s+/g, " ").trim();
        lines.push(cur);
      }
      cur = null;
      lastEndX = null;
    };

    for (const it of items) {
      if (typeof it.str !== "string") continue;
      const t = it.transform;
      const x = t[4], y = t[5];
      const size = Math.abs(t[3]) || Math.hypot(t[0], t[1]) || it.height || 10;
      const str = it.str.normalize("NFKC");
      if (cur && Math.abs(cur.y - y) > size * 0.45 && str.trim()) pushLine();
      if (!cur) {
        if (!str.trim()) { if (it.hasEOL) pushLine(); continue; }
        cur = { y, size, left: x, right: x, text: "" };
      }
      if (lastEndX !== null && str && cur.text && !/\s$/.test(cur.text) && !/^\s/.test(str) &&
          x - lastEndX > size * 0.12) {
        cur.text += " ";
      }
      cur.text += str;
      if (str.trim()) {
        lastEndX = x + (it.width || 0);
        cur.right = Math.max(cur.right, lastEndX);
        cur.size = Math.max(cur.size, size);
      }
      if (it.hasEOL) pushLine();
    }
    pushLine();
    if (!lines.length) return [];

    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i - 1].y - lines[i].y;
      if (dy > 0) gaps.push(dy);
    }
    gaps.sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    const maxRight = Math.max(...lines.map((l) => l.right));
    const minLeft = Math.min(...lines.map((l) => l.left));
    const width = Math.max(1, maxRight - minLeft);

    const paras = [];
    let para = lines[0].text;
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1], line = lines[i];
      const dy = prev.y - line.y;
      const prevShort = prev.right < minLeft + width * 0.62;
      const prevEnds = /[.!?:;"”)]$/.test(prev.text);
      const newPara =
        dy <= 0 || dy > typical * 1.45 ||
        Math.abs(line.size - prev.size) > 1.5 ||
        prevShort ||
        (prevEnds && prev.right < minLeft + width * 0.85);
      if (newPara) {
        paras.push(para);
        para = line.text;
      } else if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(line.text)) {
        para = para.slice(0, -1) + line.text; // re-join a word split by hyphenation
      } else {
        para += " " + line.text;
      }
    }
    paras.push(para);
    return paras.filter((p) => p.trim()).flatMap((p) => splitLong(p, 6000));
  }

  async function readFile(file, onProgress) {
    const kind = kindOf(file);
    if (!kind) throw new Error("This file type isn't supported. Use .txt, .md, .pdf, .docx, .rtf or .html.");
    let pages;
    if (kind === "pdf") pages = await readPdf(file, onProgress);
    else if (kind === "docx") pages = await readDocx(file);
    else if (kind === "html") pages = await readHtml(file);
    else if (kind === "rtf") pages = await readRtf(file);
    else pages = await readText(file);
    return { kind, pages };
  }

  window.SpiderExtract = { readFile, kindOf, label, paginateText, rtfToText };
})();
