/* ==========================================================================
   Spell Spider — turning uploaded files into pages of paragraphs
   Supports .txt / .md (plain text), .pdf (PDF.js) and .docx (mammoth.js)
   Result: { kind, pages: [ { paragraphs: [string] } ] }
   ========================================================================== */
(function () {
  "use strict";

  const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
  const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js";

  const TEXT_PAGE_CHARS = 2600; // how much plain text goes on one "page"

  function kindOf(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
    if (name.endsWith(".docx")) return "docx";
    if (/\.(txt|md|markdown|text|rtf|csv|log)$/.test(name) || (file.type || "").startsWith("text/")) return "text";
    return null;
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
    const clean = text.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/\t/g, "    ");
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

  async function readText(file) {
    return paginateText(await file.text());
  }

  async function readDocx(file) {
    await window.SpiderCheck.loadScript(MAMMOTH);
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return paginateText(result.value || "");
  }

  /* ---- PDF: rebuild lines and paragraphs from positioned text pieces ---- */
  async function readPdf(file, onProgress) {
    await window.SpiderCheck.loadScript(PDFJS);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (onProgress) onProgress(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push({ paragraphs: pdfParagraphs(content.items) });
      page.cleanup();
    }
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
        (prevShort) ||
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
    if (!kind) throw new Error("This file type isn't supported. Use .txt, .md, .pdf or .docx.");
    let pages;
    if (kind === "pdf") pages = await readPdf(file, onProgress);
    else if (kind === "docx") pages = await readDocx(file);
    else pages = await readText(file);
    return { kind, pages };
  }

  window.SpiderExtract = { readFile, kindOf, paginateText };
})();
