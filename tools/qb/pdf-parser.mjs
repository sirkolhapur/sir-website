// =====================================================================
// SIR question bank — universal PDF question segmenter
//
// Pure functions (no DOM, no network): the browser portal and the Node
// test harness feed it lines from either
//   • PDF.js text content (text-based PDFs), or
//   • Tesseract OCR output (scanned / photographed pages),
// and it returns draft questions in the same shape as parser.mjs, plus
// source references (page, region, raw text) and review warnings.
//
// It never invents content: no answers, solutions or symbols that are not
// in the source. OCR text is kept verbatim next to the draft so the
// coordinator can compare and correct.
// =====================================================================

// ---------------------------------------------------------------------
// Text normalisation — only lossless, unambiguous fixes.
// ---------------------------------------------------------------------
const SUPERSCRIPT = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")", "ⁿ": "n" };
const SUBSCRIPT = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-" };

export function normalizeText(s) {
  let t = String(s ?? "")
    .normalize("NFC")
    .replace(/[­​-‍﻿]/g, "")          // soft hyphen, zero-width
    .replace(/[ﬁ]/g, "fi").replace(/[ﬂ]/g, "fl").replace(/[ﬀ]/g, "ff")
    .replace(/[−‒–]/g, "-")                  // minus / figure dash / en dash
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
    .replace(/\t/g, " ").replace(/ {2,}/g, " ");
  // Chemical formulas written with Unicode subscripts (H₂SO₄, NH₃, Ca(OH)₂)
  // → mhchem, which the portal's KaTeX already renders. Exact conversion.
  t = t.replace(/(?:[A-Z][a-z]?[₀-₉]*|\((?:[A-Z][a-z]?[₀-₉]*)+\)[₀-₉]*)+/g, (m) =>
    /[₀-₉]/.test(m) && /^[A-Z(]/.test(m) ? `$\\ce{${[...m].map((c) => SUBSCRIPT[c] ?? c).join("")}}$` : m);
  // Remaining Unicode super/subscript runs → LaTeX (exact, nothing guessed).
  // The base is the whole number or word before it ("10⁻¹⁹", "m²", "kg²").
  t = t.replace(/(\d+(?:\.\d+)?|[A-Za-z]+|[)\]]) ?([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿ]+)/g, (_, base, sup) =>
    `$${base}^{${[...sup].map((c) => SUPERSCRIPT[c]).join("")}}$`);
  t = t.replace(/([A-Za-z]+|[)\]])([₀₁₂₃₄₅₆₇₈₉₊₋]+)/g, (_, base, sub) =>
    `$${base}_{${[...sub].map((c) => SUBSCRIPT[c]).join("")}}$`);
  return t.trim();
}

// Patterns that usually mean OCR lost a superscript/subscript or a symbol.
// They are flagged for review, never "fixed".
export const UNREADABLE = "[[?]]";
const SUSPECT = [
  [/[x×*]\s*10(?!\s*\^)(?:\b|\D)/, "Power of ten without a readable exponent — scans usually lose superscripts (10¹⁸ becomes 10%, 10\" or 10°); re-type every exponent from the page"],
  [/[x×*]\s*10\d{1,2}\b/, "Possible exponent read as ordinary digits (10⁷ read as 107) — check every power of ten against the page"],
  [/[~«»¢¥§¶|]{1,}/, "unusual symbol — possibly an unreadable formula character"],
  [/\b[A-Z][a-z]?\d[A-Z]/, "chemical formula subscripts may be lost (e.g. H2SO4)"],
  [/\?{2,}|�/, "unreadable characters"],
];

// ---------------------------------------------------------------------
// Line building
// Line = { text, page, x0, y0, x1, y1, conf }   (page pixel coords, top-left origin)
// ---------------------------------------------------------------------

// PDF.js getTextContent() items → lines. `viewport` from page.getViewport({scale}).
export function linesFromPdfItems(items, viewport, page) {
  const pieces = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, , d, e, f] = it.transform;
    const fontH = Math.hypot(b, d) || Math.abs(d) || 10;
    // Convert PDF user space (origin bottom-left) to viewport pixels (origin top-left).
    const [x, yBase] = viewport.convertToViewportPoint(e, f);
    const scale = viewport.scale;
    const h = fontH * scale;
    pieces.push({ text: it.str, x0: x, x1: x + (it.width || Math.abs(a) * it.str.length * 0.5) * scale, y0: yBase - h, y1: yBase, h });
  }
  return groupIntoLines(pieces, viewport.width, page, null);
}

// Tesseract.js recognize() data → lines (keeps per-line confidence).
// Pass one result per OCR'd region (e.g. each column); coordinates are
// full-page pixels.
export function linesFromOcr(results, pageWidth, page) {
  const out = [];
  // Each result is one column, OCR'd separately: keep column order
  // (left, then right) and top-to-bottom order inside each column.
  [].concat(results).forEach((data, col) => {
    const lines = data.lines || (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
    const colLines = [];
    for (const l of lines) {
      const text = (l.text || "").replace(/\s+$/, "");
      if (!text.trim()) continue;
      colLines.push({ text, page, col, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, conf: l.confidence ?? null });
    }
    out.push(...colLines.sort((a, b) => a.y0 - b.y0));
  });
  return out;
}

// Column layout from a first full-page OCR pass: Tesseract's own line
// finder merges lines across the gutter of tilted two-column photos, so
// the portal re-OCRs each column separately using these rectangles.
export function ocrColumnRects(words, pageWidth, pageHeight) {
  const boxes = (words || []).filter((w) => (w.text || "").trim()).map((w) => w.bbox);
  const gutter = findGutter(boxes, pageWidth);
  if (gutter == null) return [{ left: 0, top: 0, width: pageWidth, height: pageHeight }];
  const pad = Math.round(pageWidth * 0.004);
  return [
    { left: 0, top: 0, width: Math.min(pageWidth, Math.round(gutter + pad)), height: pageHeight },
    { left: Math.max(0, Math.round(gutter - pad)), top: 0, width: pageWidth - Math.max(0, Math.round(gutter - pad)), height: pageHeight },
  ];
}

// Running headers/footers, page numbers and section banners.
const REPEATED_TOKEN = /(\b[A-Za-z]{2,8}\b)(?:\W+\1\b){3,}/;
export function classifyLine(text) {
  const t = text.trim();
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(t)) return "text";   // Markdown table separator row
  if (!t || /^[\W_]+$/.test(t)) return "noise";
  if (/^\d{1,4}$/.test(t) || REPEATED_TOKEN.test(t)) return "furniture";
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && t.length <= 45 && t.split(/\s+/).length <= 6 && !/^\(?\d/.test(t) && !/^[a-dA-D][).]/.test(t)
      && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.85) return "heading";
  return "text";
}

// Group positioned text pieces (one PDF text run each) into lines per column.
function groupIntoLines(pieces, pageWidth, page) {
  const gutter = findGutter(pieces, pageWidth);
  const lines = [];
  for (const col of splitByGutter(pieces, gutter)) {
    const sorted = col.sort((p, q) => (p.y1 - q.y1) || (p.x0 - q.x0));
    let cur = null;
    for (const p of sorted) {
      const tol = Math.max(2, p.h * 0.45);
      if (cur && Math.abs(p.y1 - cur.y1) <= tol) {
        cur.parts.push(p);
        cur.y0 = Math.min(cur.y0, p.y0); cur.x1 = Math.max(cur.x1, p.x1); cur.x0 = Math.min(cur.x0, p.x0);
      } else {
        cur = { parts: [p], x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 };
        lines.push(cur);
      }
    }
  }
  const built = lines.map((l) => {
    const parts = l.parts.sort((a, b) => a.x0 - b.x0);
    let text = "";
    for (let i = 0; i < parts.length; i++) {
      const gap = i ? parts[i].x0 - parts[i - 1].x1 : 0;
      text += (i && gap > parts[i].h * 0.15 && !text.endsWith(" ") ? " " : "") + parts[i].text;
    }
    return { text, page, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, conf: null };
  });
  return orderColumns(built, pageWidth);
}

// Find a vertical gutter between two text columns, or null for one column.
function findGutter(boxes, pageWidth) {
  if (boxes.length < 12) return null;
  const lo = pageWidth * 0.3, hi = pageWidth * 0.7, step = Math.max(2, pageWidth / 400);
  let best = null;
  for (let x = lo; x <= hi; x += step) {
    const crossing = boxes.filter((b) => b.x0 < x - 1 && b.x1 > x + 1).length;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  const left = boxes.filter((b) => b.x1 <= best.x).length;
  const right = boxes.filter((b) => b.x0 >= best.x).length;
  const ok = best.crossing <= boxes.length * 0.06 && left >= boxes.length * 0.2 && right >= boxes.length * 0.2;
  return ok ? best.x : null;
}
function splitByGutter(boxes, gutter) {
  if (gutter == null) return [boxes.slice()];
  const left = [], right = [], wide = [];
  for (const b of boxes) (b.x1 <= gutter + 2 ? left : b.x0 >= gutter - 2 ? right : wide).push(b);
  return [left, right, wide];
}

// Reading order for lines: full-width lines split the page into bands;
// inside each band read the left column, then the right column.
export function orderColumns(lines, pageWidth) {
  const gutter = findGutter(lines, pageWidth);
  if (gutter == null) return lines.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const wide = lines.filter((l) => l.x0 < gutter - 2 && l.x1 > gutter + 2).sort((a, b) => a.y0 - b.y0);
  const narrow = lines.filter((l) => !wide.includes(l));
  const out = [];
  let top = -Infinity;
  for (const w of [...wide, { y0: Infinity }]) {
    const band = narrow.filter((l) => l.y0 >= top && l.y0 < w.y0);
    const byY = (a, b) => a.y0 - b.y0;
    out.push(...band.filter((l) => l.x1 <= gutter + 2).sort(byY), ...band.filter((l) => l.x1 > gutter + 2).sort(byY));
    if (w.y0 !== Infinity) { out.push(w); top = w.y0; }
  }
  return out;
}

// ---------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------
// "12. Text", "12) Text", "(12) Text", "12.) Text", "Q12. Text", and
// "118.A charged…" (no space, capital letter next). A dot followed by a
// digit is never a question number, so "1.34 x 10" is safe.
const Q_START = /^\s*(?:Q(?:ue)?(?:stion)?\s*\.?\s*)?(?:\(|\[)?(\d{1,3})\s*(?:\.\)?\s+|\.(?=[A-Z(“"'])|\)\s*|\]\s*|\s-\s+)(?=\S)/i;
const ANSWER_KEY_HEADING = /^\s*(answer\s*key|answers?|ans(?:wer)?s?\.?\s*key|hints?\s*(?:&|and)\s*solutions?)\s*[:.-]?\s*$/i;
const SOLUTION_START = /^\s*(?:sol(?:ution)?|explanation|hint)\s*[.:-]\s*/i;
const INLINE_ANSWER = /\b(?:ans(?:wer)?|correct\s+(?:option|answer))\s*[.:-]?\s*\(?\s*([a-dA-D1-4])\s*\)?(?!\w)/;

// Lines that start a new question, keeping the numbering plausible:
//   • next = previous + 1, or a short skip (flagged);
//   • a new section: numbering restarts at a small number (1, or 2–5 when
//     the "1." is unreadable) and the following numbers continue it;
//   • a misread number ("193" between 92 and 94) is taken as the missing
//     one and flagged.
// Each start carries its section number; restarts begin a new section.
export function findQuestionStarts(lines) {
  const cands = [];
  lines.forEach((l, i) => {
    const m = l.text.match(Q_START);
    if (m) cands.push({ index: i, number: Number(m[1]) });
  });
  // Does the sequence continue from n? (one of the next three candidates is n+1…n+3)
  const ahead = (k, n) => cands.slice(k + 1, k + 4).some((x) => x.number > n && x.number - n <= 3);
  const starts = [];
  let last = 0, section = 1;
  cands.forEach((c, k) => {
    const next = cands[k + 1];
    const continues = c.number === last + 1;
    const smallSkip = c.number > last && c.number - last <= 3;
    // A restart needs two following numbers continuing it, and must not be
    // followed by the old sequence carrying on (figure labels "(1)", "(3)").
    const nextFew = cands.slice(k + 1, k + 6);
    const runs = new Set(nextFew.filter((x) => x.number > c.number && x.number - c.number <= 4).map((x) => x.number)).size >= 2;
    const oldGoesOn = nextFew.slice(0, 4).some((x) => x.number > last && x.number - last <= 3);
    const restart = last >= 3 && c.number <= 5 && c.number < last && runs && !oldGoesOn;
    const jump = c.number > last && ahead(k, c.number) && (last === 0 || c.number - last <= 40);
    if (continues || smallSkip || restart || jump) {
      if (restart) section++;
      const skipped = restart ? c.number - 1 : (last && c.number > last + 1 ? c.number - last - 1 : (last === 0 ? c.number - 1 : 0));
      starts.push({ index: c.index, number: c.number, skipped, restart, section });
      last = c.number;
    } else if (next && next.number === last + 2 && c.number !== last) {
      // Misread number in the slot of last + 1.
      starts.push({ index: c.index, number: last + 1, skipped: 0, restart: false, section, assumed: true, readAs: c.number });
      last = last + 1;
    }
  });
  return starts;
}

// When a printed number is unreadable (a handwritten circle over "7."),
// the question would merge into the previous one. Recover it from layout:
// question numbers hang at the column's left margin, so a line at that
// margin, appearing after the previous question already has options
// a)–d), starts a new question. Its number is assumed and flagged.
export function recoverUnnumberedStarts(lines, starts, pageDims) {
  if (!starts.length) return starts;
  const colKey = (l) => `${l.page}:${l.col ?? (l.x0 < (pageDims[l.page]?.w ?? 1) / 2 ? 0 : 1)}`;
  const margins = {};
  for (const s of starts) (margins[colKey(lines[s.index])] ??= []).push(lines[s.index].x0);
  const marginOf = (l) => {
    const xs = margins[colKey(l)];
    if (!xs) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const out = [];
  starts.forEach((s, qi) => {
    out.push(s);
    const end = qi + 1 < starts.length ? starts[qi + 1].index : lines.length;
    let hasD = false;
    for (let i = s.index; i < end; i++) {
      const l = lines[i];
      if (/(?<![A-Za-z0-9])[(\[]?d\s?[).\]](?=\s|$)/i.test(l.text)) { hasD = true; continue; }
      if (!hasD || i === s.index) continue;
      const m = marginOf(l), w = pageDims[l.page]?.w ?? 1000;
      const atMargin = m != null && Math.abs(l.x0 - m) <= w * 0.015;
      const looksLikeOption = /^\s*[(\[]?[a-dA-D]\s?[).\]]/.test(l.text);
      if (atMargin && !looksLikeOption && /[A-Za-z]{3}/.test(l.text)) {
        const next = qi + 1 < starts.length ? starts[qi + 1] : null;
        const prevNum = out[out.length - 1].number;
        if (next && next.number === prevNum + 1) break; // numbering is already continuous: nothing missing
        out.push({ index: i, number: prevNum + 1, skipped: 0, restart: false, assumed: true, section: s.section });
        hasD = false;
      }
    }
  });
  // Numbers after an assumed question no longer count as a skip.
  for (let k = 1; k < out.length; k++) {
    if (out[k].skipped && !out[k].restart && out[k].number - out[k - 1].number === 1) out[k].skipped = 0;
  }
  return out;
}

// Split a question body into stem + options. Accepts a) (a) A) (A) a. A.
// and (1)…(4); options may share a line ("a) x  b) y").
export function extractOptions(body) {
  // Common OCR misreads of an option letter on scans: ¢) ©) co) → c),
  // "by Friction" / "dy both" (a ticked "b)" / "d)") → "b) Friction".
  body = body.replace(/(^|[\s(])(?:[¢©]|co)(\s?[).])/g, "$1c$2").replace(/(^|\n)(\W?)by(?=\s+[A-Z0-9])/g, "$1$2b)")
    .replace(/(^|\n)(\W?)dy(?=\s+\S)/g, "$1$2d)").replace(/(\s)dy(?=\s+[\d(+-])/g, "$1d)");
  // A ticked letter is sometimes read as a look-alike, but only where the
  // sequence expects it (b after a, c after b): p) 6) → b), e) → c).
  const LOOK = { a: "a", b: "[bp6]", c: "[ce]", d: "d", 1: "1", 2: "2", 3: "3", 4: "4" };
  // One stray tick/mark character may precede the letter ("La)", "Jb)",
  // "_c)", "/d)", "'d)"); a ")" may be followed directly by the text ("p)15").
  const markerRe = (k, lineStart) => new RegExp(`${lineStart ? "(?:^|(?<=\\n))" : "(?:^|(?<=[\\s(\\[]))"}[LJlIP/\\\\|_vV✓√'"‘’“”.,:;~-]?[(\\[]?${LOOK[k] ?? k}\\s?(?:[).\\]](?=\\s|$)|\\)(?=[^\\s)]))`, /[a-d]/.test(k) ? "gim" : "gm");
  const tryKeys = (keys) => {
    const found = [];
    let from = 0;
    for (const [i, k] of keys.entries()) {
      // The first option almost always starts a line: prefer that, so "(a)
      // and (b)" inside the stem is not taken for options.
      let hit = null;
      for (const re of i === 0 ? [markerRe(k, true), markerRe(k, false)] : [markerRe(k, false)]) {
        re.lastIndex = from;
        let m;
        while ((m = re.exec(body))) { if (m.index >= from) { hit = m; break; } }
        if (hit) break;
      }
      if (!hit) continue; // a missing marker (e.g. hidden by a tick) does not stop the search
      found.push({ key: k, at: hit.index, end: hit.index + hit[0].length });
      from = hit.index + hit[0].length;
    }
    return found;
  };
  let marks = tryKeys(["a", "b", "c", "d"]);
  let reordered = false;
  if (marks.length < 4) {
    // Curved or tilted scans can put "b) …" before "a) …" in the text. If
    // each of a)–d) appears exactly once after the stem, take each option's
    // text from its own marker and order them by letter (flagged).
    const all = ["a", "b", "c", "d"].map((k) => [...body.matchAll(new RegExp(`(?:^|(?<=\\s))[LJlI/\\\\|_'"‘’“”]?${k}\\s?\\)(?=\\s|[^\\s)])`, "gim"))]);
    const start = all.flat().length ? Math.min(...all.flat().map((m) => m.index)) : 0;
    const each = all.map((ms) => ms.filter((m) => m.index >= start));
    if (each.every((ms) => ms.length === 1)) {
      const found = each.map((ms, i) => ({ key: "abcd"[i], at: ms[0].index, end: ms[0].index + ms[0][0].length }));
      const inText = [...found].sort((x, y) => x.at - y.at);
      if (inText.some((m, i) => m.key !== "abcd"[i])) { marks = inText; reordered = true; }
    }
  }
  if (marks.length < 4 && !reordered) {
    const numeric = tryKeys(["1", "2", "3", "4"]);
    if (numeric.length === 4) marks = numeric;
  }
  if (marks.length < 2) return { stem: body.trim(), options: [], found: marks.length, missing: [] };
  const numericKeys = marks[0].key === "1";
  const toLetter = (k) => numericKeys ? "ABCD"[Number(k) - 1] : k.toUpperCase();
  const options = marks.map((m, i) => ({
    key: toLetter(m.key),
    text: body.slice(m.end, i + 1 < marks.length ? marks[i + 1].at : undefined).replace(/\s+/g, " ").trim(),
  }));
  if (reordered) {
    options.sort((x, y) => x.key.localeCompare(y.key));
    return { stem: body.slice(0, marks[0].at).trim(), options, found: 4, missing: [], secondSet: false, reordered };
  }
  const missing = ["A", "B", "C", "D"].filter((L) => !options.some((o) => o.key === L));
  // Keep keys A–D contiguous for the editor; the missing letter's text is
  // still inside the neighbouring option and is reported for review.
  options.forEach((o, i) => { o.key = "ABCD"[i]; });
  // A second "a) … b)" after the last option: probably two questions merged
  // (the next question's number was not read).
  const tail = marks.length ? body.slice(marks[marks.length - 1].end) : "";
  const secondSet = !numericKeys && /(?:^|\n)\W?[(\[]?a\s?[).\]]\s[\s\S]*(?:^|\s)\W?[(\[]?b\s?[).\]]\s/m.test(tail);
  return { stem: body.slice(0, marks[0].at).trim(), options, found: marks.length, missing, secondSet };
}

// Answer key section → { number: "A" | "B" | … }. Only read after an
// explicit heading such as "Answer Key" so stray "2. (b)" text is ignored.
export function parseAnswerKey(lines) {
  const keyStart = lines.findIndex((l) => ANSWER_KEY_HEADING.test(l.text));
  if (keyStart < 0) return { answers: {}, keyStart: -1 };
  const text = lines.slice(keyStart + 1).map((l) => l.text).join("  ");
  const answers = {};
  const re = /(\d{1,3})\s*[.):\-]?\s*\(?\s*([a-dA-D1-4])\s*\)?(?![A-Za-z0-9])/g;
  let m;
  while ((m = re.exec(text))) {
    const v = m[2].toUpperCase();
    answers[Number(m[1])] = /[1-4]/.test(v) ? "ABCD"[Number(v) - 1] : v;
  }
  return { answers, keyStart };
}

// Is there a large vertical gap (a likely diagram) inside a question?
function figureGaps(qLines) {
  const hs = qLines.map((l) => l.y1 - l.y0).filter((h) => h > 0).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)] || 20;
  const gaps = [];
  for (let i = 1; i < qLines.length; i++) {
    const a = qLines[i - 1], b = qLines[i];
    if (a.page === b.page && b.y0 - a.y1 > med * 2.5) {
      gaps.push({ page: a.page, y0: a.y1, y1: b.y0, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1) });
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------
// Main entry: pages → draft questions
//   pages: [{ page, width, height, source: "text" | "ocr", lines }]
//   ctx:   { subject, chapter, exam, sourceLabel }
// ---------------------------------------------------------------------
export function segmentQuestions(pages, ctx = {}) {
  const pageDims = Object.fromEntries(pages.map((p) => [p.page, { w: p.width, h: p.height, source: p.source }]));
  // Running headers/footers sit in the top ~7% / bottom ~4.5% of a page.
  // Only short lines there are treated as headers/footers — a question can
  // start right at the top of a page.
  const inMargin = (l) => { const d = pageDims[l.page]; return d && l.text.trim().length <= 32 && (l.y1 < d.h * 0.07 || l.y0 > d.h * 0.955); };
  const all = pages.flatMap((p) => p.lines.map((l) => ({ ...l, page: p.page, text: normalizeText(l.text) })))
    .map((l) => ({ ...l, kind: inMargin(l) ? "furniture" : (l.conf != null && l.conf < 30) ? "unreadable" : classifyLine(l.text) }))
    .filter((l) => l.kind !== "noise" && l.kind !== "furniture");
  const { answers: keyAnswers, keyStart } = parseAnswerKey(all);
  const scope = keyStart >= 0 ? all.slice(0, keyStart) : all;
  // Section banners are remembered (and kept out of question text).
  const body = [];
  let section = null;
  for (const l of scope) {
    if (l.kind === "heading") section = l.text;
    else body.push({ ...l, section });
  }
  const starts = recoverUnnumberedStarts(body, findQuestionStarts(body), pageDims);
  const questions = [];

  // Text before the first detected question is never dropped silently: it
  // becomes its own review item (it often holds questions whose numbers
  // were unreadable).
  const preEnd = starts.length ? starts[0].index : body.length;
  const pre = body.slice(0, preEnd).filter((l) => l.kind === "text" && /[A-Za-z]{3}/.test(l.text));
  if (pre.length) starts.unshift({ index: body.indexOf(pre[0]), number: null, skipped: 0, restart: false, preamble: true, section: starts[0]?.section ?? 1 });

  // Which question owns each line (for placing diagram areas).
  const owner = new Map();
  starts.forEach((s, qi) => { for (let i = s.index; i < (starts[qi + 1]?.index ?? body.length); i++) owner.set(body[i], qi); });
  const figsByQ = new Map();
  for (const p of pages) for (const f of p.figures || []) {
    const cy = (f.y0 + f.y1) / 2;
    const same = body.filter((l) => l.page === p.page && (f.col == null || l.col == null || l.col === f.col));
    const above = same.filter((l) => l.y0 <= cy).sort((a, b) => b.y0 - a.y0)[0];
    const below = same.filter((l) => l.y0 > cy).sort((a, b) => a.y0 - b.y0)[0];
    const qi = owner.get(above ?? below);
    if (qi != null) (figsByQ.get(qi) ?? figsByQ.set(qi, []).get(qi)).push({ ...f, page: p.page });
  }
  const inkData = pages.some((p) => Array.isArray(p.figures));

  starts.forEach((s, qi) => {
    const end = qi + 1 < starts.length ? starts[qi + 1].index : body.length;
    const allQLines = body.slice(s.index, end);
    const unreadable = allQLines.filter((l) => l.kind === "unreadable");
    const qLines = allQLines.filter((l) => l.kind !== "unreadable");
    if (!qLines.length) return;
    const issues = [];
    if (s.preamble) {
      const firstNum = starts[qi + 1]?.number;
      issues.push(`Text found before the first readable question number${firstNum > 1 ? ` (${firstNum})` : ""} — it may contain earlier questions whose numbers could not be read. Split or reject.`);
    }
    if (unreadable.length) issues.push(`${unreadable.length} unreadable line(s) were left out of this question — compare with the page`);
    const qSection = qLines[0].section;
    if (s.assumed) issues.push(s.readAs != null
      ? `Question number read as ${s.readAs} — assumed ${s.number} from the sequence; confirm against the page`
      : `Question number was not readable (handwriting or damage over it?) — assumed ${s.number}; confirm against the page`);
    if (s.skipped) issues.push(s.restart || s.number === s.skipped + 1
      ? `Section ${s.section}: question(s) 1${s.skipped > 1 ? `–${s.skipped}` : ""} not found before ${s.number} — missing or merged into the previous question`
      : `Numbering jumps from ${s.number - s.skipped - 1} to ${s.number} — a question may be missing or merged into this one`);

    // First line without its number; join the rest with newlines.
    const first = s.preamble || s.assumed ? qLines[0].text : qLines[0].text.replace(Q_START, "");
    let raw = [first, ...qLines.slice(1).map((l) => l.text)].join("\n");

    // Source solution / explanation (kept separate, labelled as source).
    let solution = null;
    const solIdx = raw.split("\n").findIndex((ln) => SOLUTION_START.test(ln));
    if (solIdx > 0) {
      const parts = raw.split("\n");
      solution = parts.slice(solIdx).join("\n").replace(SOLUTION_START, "").trim();
      raw = parts.slice(0, solIdx).join("\n");
    }

    // Answer printed with the question ("Ans. (b)").
    let answer = null, answerSource = null;
    const inl = raw.match(INLINE_ANSWER);
    if (inl) {
      const v = inl[1].toUpperCase();
      answer = /[1-4]/.test(v) ? "ABCD"[Number(v) - 1] : v;
      answerSource = "printed with question";
      raw = raw.replace(INLINE_ANSWER, "").trim();
    } else if (s.number != null && !s.assumed && keyAnswers[s.number] && !s.restart && !starts.slice(0, qi).some((x) => x.number === s.number)) {
      answer = keyAnswers[s.number];
      answerSource = "answer key in the PDF";
    } else if (keyAnswers[s.number]) {
      issues.push(`Answer key has an entry for ${s.number}, but this number repeats in the PDF — key not applied, choose manually`);
    }

    const { stem, options, found, missing, secondSet, reordered } = extractOptions(raw);
    const isMcq = found >= 2;
    if (found > 0 && found < 4) issues.push(`Only ${found} of 4 option markers read${missing?.length ? ` — option ${missing.join(", ")} not found; its text is probably joined to the option before it. Split it before verifying` : ""}`);
    if (!isMcq) issues.push("No options detected — may be integer/numerical/subjective, or options were not read");
    if (reordered) issues.push("Options were out of order in the scan (curved or tilted page) and were matched by their letters — check each option against the page");
    if (secondSet) issues.push("A second set of options a), b)… follows — this item probably contains two questions (the next number was not read). Split it");
    if (!stem || stem.length < 8) issues.push("Question text missing or very short");
    if (!answer) issues.push(keyStart >= 0
      ? `The source's answer key has no entry for ${s.number ?? "this question"} — enter and verify the correct answer`
      : "The source has no answer key — enter and verify the correct answer (handwritten ticks on the page are not used)");
    const unreadableMath = (stem + options.map((o) => o.text).join(" ")).split(UNREADABLE).length - 1;
    if (unreadableMath) issues.push(`${unreadableMath} exponent(s)/symbol(s) could not be read reliably — shown as ${UNREADABLE}. Type them from the page`);

    const fullText = [stem, ...options.map((o) => o.text)].join(" ");
    // Already-converted math is not suspect; a "$^{…}$" right after a number
    // means its exponent was read. Markdown table rows use "|" legitimately.
    const plainText = fullText
      .replace(/\$\^\{[^$]*\$/g, "^E").replace(/\$[^$]*\$/g, " ")
      .split("\n").filter((ln) => !/^\s*\|/.test(ln)).join("\n");
    for (const [re, msg] of SUSPECT) if (re.test(plainText)) issues.push(msg);

    const lowConf = qLines.filter((l) => l.conf != null && l.conf < 70);
    if (lowConf.length) issues.push(`Low OCR confidence on ${lowConf.length} line(s): "${lowConf[0].text.slice(0, 50)}"`);

    // Source regions (one per page the question touches), in thousandths.
    // Word documents have no page geometry: they get paragraph numbers.
    const regions = [];
    const paras = qLines.map((l) => l.para).filter((p) => p != null);
    const sourceLocation = paras.length
      ? (Math.min(...paras) === Math.max(...paras) ? `paragraph ${paras[0]}` : `paragraphs ${Math.min(...paras)}–${Math.max(...paras)}`)
      : null;
    for (const pg of paras.length ? [] : [...new Set(qLines.map((l) => l.page))]) {
      const ls = qLines.filter((l) => l.page === pg), d = pageDims[pg];
      const box = [Math.min(...ls.map((l) => l.x0)), Math.min(...ls.map((l) => l.y0)), Math.max(...ls.map((l) => l.x1)), Math.max(...ls.map((l) => l.y1))];
      regions.push({ page: pg, box: [box[0] / d.w, box[1] / d.h, box[2] / d.w, box[3] / d.h].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000)) });
    }
    if (regions.length > 1) issues.push(`Question continues across pages ${regions.map((r) => r.page).join(" → ")} — check the join`);

    // Diagrams: ink on the page that is not text (scans), or large blank
    // gaps (text PDFs). Always a proposal: the reviewer confirms each crop.
    const areas = inkData ? (figsByQ.get(qi) || []) : figureGaps(qLines);
    const figures = areas.map((g, i) => {
      const d = pageDims[g.page];
      return { label: String(i + 1), page: g.page, option_key: null, description: "", proposed: true,
        box: [g.x0 / d.w, g.y0 / d.h, g.x1 / d.w, g.y1 / d.h].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000)) };
    });
    if (/\b(figure|fig\.|diagram|shown|graph|circuit|structure)\b/i.test(fullText) && !figures.length && !/!\[[^\]]*\]\(/.test(fullText)) {
      issues.push("Mentions a figure/diagram but none was located — crop it from the page (tick only if no diagram is needed)");
    }
    if (figures.length) issues.push(`${figures.length} diagram area(s) detected — confirm or re-crop each one; a diagram that belongs to this question must be attached`);

    const minConf = qLines.reduce((m, l) => l.conf == null ? m : Math.min(m, l.conf), 100);
    const severe = !isMcq || !stem || found < 4 || minConf < 60 || s.skipped || s.assumed || s.preamble || unreadable.length || unreadableMath || secondSet;
    const confidence = severe ? "low" : (issues.length > 1 || minConf < 85) ? "medium" : "high";

    const question = stem + figures.map((f) => `\n\n![Figure ${f.label}](figure:${f.label})`).join("");
    const pageFrom = regions[0]?.page ?? qLines[0].page, pageTo = regions[regions.length - 1]?.page ?? qLines[0].page;
    questions.push({
      source_number: s.preamble ? "?" : String(s.number) + (s.assumed ? "?" : ""),
      number: s.preamble ? null : s.number,
      assumed: !!s.assumed,
      section: qSection,
      section_no: s.section ?? 1,
      option_markers: found,
      ocr_raw: qLines.some((l) => l.raw != null) ? qLines.map((l) => l.raw ?? l.text).join("\n") : null,
      page_from: pageFrom,
      page_to: pageTo,
      source_location: sourceLocation ?? (pageFrom === pageTo ? `page ${pageFrom}` : `pages ${pageFrom}–${pageTo}`),
      regions,
      source_text: qLines.map((l) => l.text).join("\n"),
      source_method: [...new Set(qLines.map((l) => pageDims[l.page].source))].join("+"),
      answer_source: answerSource,
      confidence,
      issues,
      draft: {
        code: null,
        subject: ctx.subject ?? null,
        chapter: ctx.chapter ?? null,
        topic: null,
        subtopic: null,
        branch: null,
        type: isMcq ? "single" : "integer",
        difficulty: null, // never guessed: the reviewer chooses

        exam: ctx.exam ?? [],
        tags: [],
        source: ["book", ctx.sourceLabel, qSection, paras.length ? null : `p.${pageFrom}`, s.number != null ? `Q${s.number}` : null].filter(Boolean).join(":"),
        status: "live",
        marks: 4,
        negative: isMcq ? 1 : 0,
        question,
        options: isMcq ? options : null,
        hint: null,
        solution,
        unit: null,
        answer,
        tolerance: 0,
        figures,
      },
    });
  });

  return { questions, answerKeyFound: keyStart >= 0, answerKeyEntries: Object.keys(keyAnswers).length };
}

// ---------------------------------------------------------------------
// Reconciliation: what the numbering says vs what was extracted.
//   items: [{ source_number, section_no, number, assumed, option_markers,
//             page_from, issues[], question, options, figures }]
//   pages: [{ page_no, status }]
// Missing numbers can only be seen between found numbers: questions after
// the last number read in a section cannot be detected from numbering.
// ---------------------------------------------------------------------
export function reconcileExtraction(items, pages = []) {
  const has = (it, re) => (it.issues || []).some((s) => re.test(s));
  const bySection = new Map();
  for (const it of items) {
    const k = it.section_no ?? 1;
    (bySection.get(k) ?? bySection.set(k, []).get(k)).push(it);
  }
  const sections = [...bySection.entries()].sort((a, b) => a[0] - b[0]).map(([no, its]) => {
    const nums = its.map((i) => i.number).filter((n) => Number.isInteger(n));
    const count = new Map(); nums.forEach((n) => count.set(n, (count.get(n) || 0) + 1));
    const max = nums.length ? Math.max(...nums) : 0;
    const missing = []; for (let n = 1; n <= max; n++) if (!count.has(n)) missing.push(n);
    const pgs = its.map((i) => i.page_from).filter(Boolean);
    return {
      section: no, pages: pgs.length ? [Math.min(...pgs), Math.max(...pgs)] : null,
      items: its.length, highest: max, found: count.size,
      missing, duplicates: [...count.entries()].filter(([, c]) => c > 1).map(([n]) => n),
      assumed: its.filter((i) => i.assumed).map((i) => i.number),
      unnumbered: its.filter((i) => i.number == null).length,
    };
  });
  const list = (pred) => items.filter(pred).map((i) => `${i.section_no ?? 1}:${i.source_number}`);
  return {
    pages: { processed: pages.filter((p) => p.status === "done").length, failed: pages.filter((p) => p.status === "failed").map((p) => p.page_no) },
    items: items.length,
    sections,
    numbering_total: sections.reduce((s, x) => s + x.highest, 0),
    missing_total: sections.reduce((s, x) => s + x.missing.length, 0),
    merged_or_split: list((i) => has(i, /two questions|merged|not found before|jumps from/)),
    option_problems: list((i) => i.type !== "integer" && Array.isArray(i.options) && i.options.length > 0 && (i.options.length !== 4 || i.options.some((o) => !String(o.text || "").trim()))),
    no_options: list((i) => !Array.isArray(i.options) || !i.options.length),
    uncertain_math: list((i) => JSON.stringify([i.question, i.options]).includes(UNREADABLE) || has(i, /exponent|formula character|subscripts may be lost/)),
    diagrams_to_confirm: list((i) => (i.figures || []).some((f) => f.proposed || f.pending)),
    diagram_mentioned_missing: list((i) => has(i, /Mentions a figure/)),
    needs_review: items.length,
  };
}
