// =====================================================================
// SIR question bank — Math OCR step (PROTOTYPE, branch mathocr-prototype)
//
// After Tesseract has read a scanned page and the segmenter has found the
// questions and their option markers, formula options are re-read from the
// page image by the local SIR Math OCR helper (tools/mathocr, Pix2Text MFR
// running on the office PC — nothing leaves the PC).
//
//   1. Regions come from the question's OWN structure: each option's marker
//      word ("a)", "(b)" …) gives the row and where the option starts; the
//      next marker on the row (or the column edge) where it ends; the page
//      ink around the marker row gives the height (stacked fractions reach
//      above and below the row). Stacked fragments in the question text
//      become suggestions only — the stem is never rewritten.
//   2. Each crop is read three ways; cleanTex() applies exact rewrites;
//      readings that disagree, an unsure symbol or a formula that does not
//      render are FLAGGED for the reviewer. Nothing uncertain is silent.
//   3. A result only ever replaces the text of the SAME option of the SAME
//      question. Options whose marker was not found, prose options and
//      failed readings keep the Tesseract text. No question is dropped.
//   4. Every reading keeps the original OCR text and the crop coordinates
//      (extracted.math) so the reviewer can compare and correct.
// =====================================================================

export const MATH_OCR_URL = "http://127.0.0.1:8765";
export const MATH_OCR_VERSION = "2026-10-29.proto1";
const MIN_PROB = 0.5;

// ---------------------------------------------------------------------
// LaTeX clean-up: exact rewrites only (frozen from the Math OCR Lab before
// the held-out pages were transcribed).
// ---------------------------------------------------------------------
export function cleanTex(s) {
  let t = String(s ?? "").trim();
  t = t.replace(/^(\\q?quad\s*)+/, "").replace(/(\\q?quad\s*)+$/, "");
  t = t.replace(/\\[cd]frac\b/g, "\\frac");
  t = t.replace(/(_\{(?:\\mathrm\{)?)\s*(?:\{\s*\})?\s*_/g, "$1");
  t = t.replace(/(\\(?:var)?epsilon)\s*_\s*\{?\s*(?:\\mathrm\{\s*[oO]\s*\}|\\omicron|[oO])\s*\}?/g, "$1_{0}");
  t = t.replace(/\\(?:textrm|text)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (m, body) =>
    /[\^_]/.test(body) ? `\\mathrm{${body.trim().replace(/\s+/g, "\\,")}}` : m);
  t = t.replace(/(\d)\s+(?=[\d.])/g, "$1").replace(/(\d)\s*\.\s*(?=\d)/g, "$1.");
  return t;
}

// ---------------------------------------------------------------------
// Meaning key of a formula: KaTeX MathML with spacing, fonts and grouping
// normalised (two spellings of the same rendered formula → same key).
// ---------------------------------------------------------------------
const STRUCT = { mfrac: "frac", msqrt: "sqrt", mroot: "root", msup: "sup", msub: "sub", msubsup: "subsup", mover: "over", munder: "under", munderover: "underover" };
const GLYPH = { "ϵ": "ε", "∈": "ε", "ϕ": "φ", "−": "-", "–": "-", "∗": "*", " ": "", "⁡": "", "⁢": "", "⁣": "", "⁤": "", "​": "" };
function parseXml(s) {
  const root = { tag: "#root", kids: [] }, st = [root];
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[5] != null) { st[st.length - 1].kids.push({ tag: "#text", text: m[5] }); continue; }
    if (m[1]) { st.pop(); continue; }
    const n = { tag: m[2], kids: [] };
    st[st.length - 1].kids.push(n);
    if (!m[4]) st.push(n);
  }
  return root;
}
const decode = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const textOf = (n) => n.tag === "#text" ? decode(n.text) : n.kids.map(textOf).join("");
function norm(n) {
  if (n.tag === "#text" || n.tag === "annotation" || n.tag === "mspace") return [];
  if (n.tag === "semantics") return norm(n.kids[0]);
  if (["mi", "mn", "mo", "mtext", "ms"].includes(n.tag)) return [...textOf(n)].map((c) => GLYPH[c] ?? c).filter((c) => c.trim());
  const s = STRUCT[n.tag];
  if (!s) return n.kids.flatMap(norm);
  if (s === "sqrt") return [{ s, a: [n.kids.flatMap(norm)] }];
  const args = n.kids.filter((k) => k.tag !== "#text").map(norm);
  if (["sup", "sub", "subsup"].includes(s) && args[0].length > 1) return [...args[0].slice(0, -1), { s, a: [[args[0][args[0].length - 1]], ...args.slice(1)] }];
  return [{ s, a: args }];
}
const ser = (list) => list.map((it) => typeof it === "string" ? it : it.s + "{" + it.a.map(ser).join("}{") + "}").join("");
export function formulaKey(tex, katex) {
  try {
    let list = norm(parseXml(katex.renderToString(tex, { output: "mathml", throwOnError: true, strict: "ignore" })));
    while (list.length && /^[.,;:]$/.test(list[0])) list.shift();
    while (list.length && /^[.,;:]$/.test(list[list.length - 1])) list.pop();
    return ser(list);
  } catch { return null; }
}

// ---------------------------------------------------------------------
// Regions from the question's structure
// ---------------------------------------------------------------------
const STRICT = { A: "a", B: "b", C: "c", D: "d" };
const LOOKALIKE = { A: "[aα]", B: "[bp6h]", C: "[ce¢©o0&]", D: "[d]" };
const markerRe = (cls) => new RegExp(`^([^\\w\\s(\\[]{0,2}[(\\[]?${cls}\\s?[).\\]}])(.*)$`, "i");
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const lineH = (l) => l.hgt || (l.y1 - l.y0);

// Words in reading order with their line.
function wordsOf(lines) {
  return lines.flatMap((l, li) => (l.words || []).map((w) => ({ ...w, line: l, li })).sort((a, b) => a.x0 - b.x0));
}

// Option markers a)…d) in order, strict letters first, look-alikes (pen
// ticks) only between two found neighbours. Returns { A: marker, … }.
export function findOptionMarkers(lines, keys = ["A", "B", "C", "D"]) {
  const words = wordsOf(lines);
  const found = {};
  let from = 0;
  for (const k of keys) {
    const re = markerRe(STRICT[k]);
    const i = words.findIndex((w, idx) => idx >= from && re.test(w.text) && (w.text.length <= 4 || /[).\]}]/.test(w.text.slice(0, 4))) && !(/\.$/.test(w.text.match(re)[1]) && idx > 0 && words[idx - 1].li === w.li));
    if (i >= 0) { found[k] = { ...words[i], idx: i }; from = i + 1; }
  }
  // Look-alike letters only in the gap between found markers.
  keys.forEach((k, n) => {
    if (found[k]) return;
    const lo = n > 0 && found[keys[n - 1]] ? found[keys[n - 1]].idx + 1 : 0;
    const nextFound = keys.slice(n + 1).map((x) => found[x]).find(Boolean);
    const hi = nextFound ? nextFound.idx : words.length;
    const re = markerRe(LOOKALIKE[k]);
    for (let i = lo; i < hi; i++) {
      const w = words[i];
      const first = i === 0 || words[i - 1].li !== w.li;
      if (re.test(w.text) && (first || words[i - 1].x1 < w.x0 - 0.4 * lineH(w.line))) { found[k] = { ...w, idx: i, lookalike: true }; break; }
    }
  });
  // Last tier, position only: the letter itself is unreadable ("2)", ")",
  // "<Q)") but a short ")"-token starts a row, or stands apart, in the gap
  // between two found neighbours. Marked inferred → never "agreed".
  const LOOSE = /^[^\w\s]{0,2}[\w<]?\)$/;
  keys.forEach((k, n) => {
    if (found[k]) return;
    const prev = keys.slice(0, n).reverse().map((x) => found[x]).find(Boolean), next = keys.slice(n + 1).map((x) => found[x]).find(Boolean);
    if (!prev && !next) return;
    const lo = prev ? prev.idx + 1 : 0, hi = next ? next.idx : words.length;
    for (let i = lo; i < hi; i++) {
      const w = words[i];
      const first = i === 0 || words[i - 1].li !== w.li;
      if (w.text.length <= 3 && LOOSE.test(w.text) && (first || words[i - 1].x1 < w.x0 - 0.4 * lineH(w.line))) { found[k] = { ...w, idx: i, inferred: true }; break; }
    }
  });
  for (const k of keys) if (found[k]) {
    const w = found[k], m = w.inferred ? [w.text, w.text] : w.text.match(markerRe(LOOKALIKE[k])) || w.text.match(markerRe(STRICT[k]));
    const frac = m ? m[1].length / w.text.length : 1;
    found[k].markEnd = w.x0 + (w.x1 - w.x0) * frac;
  }
  return found;
}

// Ink band: rows of dark pixels around the marker row, joined while the
// blank gaps stay small (a fraction's numerator/denominator), then trimmed
// to the inked columns. grey: Uint8Array of the page (0 = black).
export function inkBox(grey, W, Hpx, box, seedY0, seedY1, h) {
  const x0 = Math.max(0, Math.floor(box[0])), x1 = Math.min(W - 1, Math.ceil(box[2]));
  const y0 = Math.max(0, Math.floor(box[1])), y1 = Math.min(Hpx - 1, Math.ceil(box[3]));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const rowInk = (y) => { let n = 0; for (let x = x0; x <= x1; x++) if (grey[y * W + x] < 140) n++; return n; };
  // Inside a stacked formula the blank rows are thin (bar ↔ numerator);
  // between printed lines they are wider. 0.3 × line height separates them
  // on the RCC scans (measured on the development pages).
  const minInk = 2, gap = Math.max(3, Math.round(0.3 * h));
  let top = Math.max(y0, Math.round(seedY0)), bot = Math.min(y1, Math.round(seedY1));
  for (let y = top - 1, blank = 0; y >= y0; y--) { if (rowInk(y) >= minInk) { top = y; blank = 0; } else if (++blank > gap) break; }
  for (let y = bot + 1, blank = 0; y <= y1; y++) { if (rowInk(y) >= minInk) { bot = y; blank = 0; } else if (++blank > gap) break; }
  let cx0 = x1, cx1 = x0;
  for (let y = top; y <= bot; y++) for (let x = x0; x <= x1; x++) if (grey[y * W + x] < 140) { if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; }
  if (cx1 <= cx0) return null;
  return [cx0, top, cx1 + 1, bot + 1];
}

const proseWord = (w) => /^[^A-Za-z]*[A-Za-z]?[a-z]{3,}[^A-Za-z]*$/.test(w.text) && /[aeiou]/i.test(w.text) && (w.conf ?? 0) >= 80 && w.text.replace(/[^A-Za-z]/g, "").length >= 4;

// Any option-marker-like word ("a)", "(c)", a ticked "0)") — used to end a
// region at the next option on the row even when that option's letter was
// misread, and to recognise option rows of other questions.
const ANY_MARKER = /^[^\w\s(\[]{0,2}[(\[]?[a-dA-D]\s?[).\]}]/;
const LOOK_MARKER = /^[^\w\s(\[]{0,2}[(\[]?[aαbp6hce¢©o0&d]\s?[).\]}]$/;
const QNUM = /^\(?\d{1,3}[.)]$/;

// Coarse regions of a question's options (page coords) + stacked-fragment
// suggestions in its question text.
//   dims: { [page]: { w, h } }   page: { [page]: { lines, columns } } (all
//   OCR lines of the page — neighbouring questions bound the regions too).
export function mathRegions(q, dims, page = {}) {
  const lines = q.lines || [];
  if (!lines.length || !lines.some((l) => l.words)) return { options: [], stem: [], why: "no word geometry (not an OCR page)" };
  const keys = (q.draft.options?.length ? q.draft.options.map((o) => o.key) : ["A", "B", "C", "D"]).filter((k) => STRICT[k]);
  const marks = findOptionMarkers(lines, keys);
  const hs = lines.map(lineH).filter((v) => v > 0);
  const H = median(hs) || 30;
  const options = [];
  for (const k of keys) {
    const m = marks[k];
    if (!m) { options.push({ key: k, missing: "option marker not found on the page" }); continue; }
    const L = m.line, pg = L.page, col = L.col ?? 0;
    const pageLines = (page[pg]?.lines || lines).filter((l) => l.page === undefined || l.page === pg);
    const colLines = pageLines.filter((l) => (l.col ?? 0) === col);
    // Right edge: where this column's justified text lines end (median —
    // some lines carry junk from the neighbouring page out to the edge), but
    // never left of the option row itself, never beyond the column.
    const colRect = page[pg]?.columns?.[col];
    const longX1 = colLines.filter((l) => (l.text || "").length > 20).map((l) => l.x1);
    const textRight = Math.max(longX1.length ? median(longX1) + 0.3 * H : -Infinity, L.x1);
    const colRight = Math.min(colRect ? colRect.left + colRect.width : Infinity, textRight);
    const yc = (m.y0 + m.y1) / 2;
    const sameRow = (w) => Math.abs((w.y0 + w.y1) / 2 - yc) < 0.8 * H;
    // The next marker-like word on the same row ends this option.
    const rowWords = colLines.flatMap((l) => l.words || []).filter((w) => sameRow(w) && w.x0 > m.x1 + 0.5 * H);
    // …and so does an exam-year label "(2001)" printed at the row's end.
    const rowNext = rowWords.filter((w) => ANY_MARKER.test(w.text) || LOOK_MARKER.test(w.text) || /^\(?(?:19|20)\d\d\)?[.,]?$/.test(w.text)).sort((a, b) => a.x0 - b.x0)[0];
    const rx0 = m.markEnd + 0.15 * H, rx1 = rowNext ? rowNext.x0 - 0.25 * H : colRight - 0.1 * H;
    // Text rows, option rows and question-number rows (of ANY question in
    // this column) bound the region vertically.
    // Only short broken fragments (a fraction's numerator / denominator)
    // may join the option; every other line is a boundary. Printed lines
    // can sit so close that their boxes overlap, so the cut is half-way
    // between the two rows' centres.
    const isAnchor = (l) => {
      if (l === L) return false;
      const t = (l.text || "").trim(), ws = l.words || [];
      return t.length > 14 || ws.some(proseWord) || (ws[0] && (ANY_MARKER.test(ws[0].text) || QNUM.test(ws[0].text))) || keys.some((x) => marks[x] && marks[x].line === l);
    };
    const over = (l) => l.x1 > rx0 && l.x0 < rx1;
    const cy = (l) => (l.y0 + l.y1) / 2;
    const above = colLines.filter((l) => isAnchor(l) && over(l) && cy(l) < yc - 0.6 * H).sort((a, b) => cy(b) - cy(a))[0];
    const below = colLines.filter((l) => isAnchor(l) && over(l) && cy(l) > yc + 0.6 * H).sort((a, b) => cy(a) - cy(b))[0];
    const top = Math.max(!above ? -Infinity : above.y1 < m.y0 ? above.y1 + 1 : (cy(above) + yc) / 2, yc - 2.6 * H);
    const bottom = Math.min(!below ? Infinity : below.y0 > m.y1 ? below.y0 - 1 : (cy(below) + yc) / 2, yc + 2.6 * H);
    const inRegion = colLines.flatMap((l) => (l.words || []).filter((w) => (w.x0 + w.x1) / 2 >= rx0 && (w.x0 + w.x1) / 2 <= rx1 && (w.y0 + w.y1) / 2 >= top && (w.y0 + w.y1) / 2 <= bottom));
    options.push({ key: k, page: pg, col, box: [rx0, top, rx1, bottom], seed: [m.y0, m.y1], H, prose: inRegion.filter(proseWord).length >= 1, lookalike: !!m.lookalike, inferred: !!m.inferred, words: inRegion.map((w) => w.text).join(" ") });
  }
  // Stem: groups of stacked fragment lines before the first option row.
  const firstOpt = Math.min(...keys.map((k) => marks[k]?.idx ?? Infinity));
  const firstLine = Number.isFinite(firstOpt) ? wordsOf(lines)[firstOpt].li : lines.length;
  const frag = lines.slice(1, firstLine).filter((l) => { const t = (l.text || "").trim(); return t.length > 0 && t.length <= 14 && ((l.conf ?? 100) < 75 || (t.match(/[A-Za-z]{3,}/g) || []).length === 0); });
  const groups = [];
  for (const l of frag) {
    const g = groups.find((g) => g.page === l.page && l.y0 - g.box[3] < 2.2 * H && l.x0 < g.box[2] + H && l.x1 > g.box[0] - H);
    if (g) { g.box = [Math.min(g.box[0], l.x0), Math.min(g.box[1], l.y0), Math.max(g.box[2], l.x1), Math.max(g.box[3], l.y1)]; g.n++; g.text.push(l.text); }
    else groups.push({ page: l.page, box: [l.x0, l.y0, l.x1, l.y1], n: 1, text: [l.text] });
  }
  const stem = groups.filter((g) => g.n >= 2).map((g, i) => ({ id: `S${i + 1}`, page: g.page, box: [g.box[0] - 0.4 * H, g.box[1] - 0.2 * H, g.box[2] + 0.4 * H, g.box[3] + 0.2 * H], ocr: g.text.join(" / "), H }));
  return { options, stem };
}

// ---------------------------------------------------------------------
// Decision on three readings
// ---------------------------------------------------------------------
const PROSE_TEX = /\\(?:text|mathrm|textrm|operatorname)\s*\{[^}]*[a-z]{4,}/;
// Region-boundary repair (developed on the development pages only): the
// crop may start with the tail of the option's own marker — ")" or "b)".
// Only a LEADING label is removed, and only when no "(" opens before it.
// Added AFTER the clean-up freeze, from the development pages only (the
// held-out pages were not looked at): a trailing exam-year label
// "( 2001 )" from the same row is not part of the formula, and an
// empty-base superscript 10^{^{-3}} is the same as 10^{-3} (as cleanTex
// already does for subscripts).
export function stripLabel(t) {
  return String(t ?? "")
    .replace(/^\s*(?:\\mathrm\{\s*[a-dA-D]?\s*\)\s*\}|[a-dA-D]?\s*\))\s*(?:\\[ ,;:!]|~|\\q?quad)*\s*/, "")
    .replace(/(?:\\[ ,;:!]|~|\\q?quad|\s)*\(\s*(?:1\s*9|2\s*0)\s*\d\s*\d\s*\)\s*$/, "")
    .replace(/\^\{\s*(?:\{\s*\})?\s*\^/g, "^{")
    .trim();
}
// A reading of more than one printed line, or with another option's label
// inside, means the crop held more than this option.
const MULTI_LINE = /\\begin\{(?:array|matrix|aligned|gathered|cases)\}|\\\\/;
const OTHER_LABEL = /\\mathrm\{\s*[a-dA-D]\s*\)\s*\}|(?:^|[^\\a-zA-Z])[a-dA-D]\s\)/;
export function decide(reads, katex) {
  if (!reads?.length) return { latex: null, status: "failed", reasons: ["the helper returned no reading"] };
  const cleaned = reads.map((r) => stripLabel(cleanTex(r.latex)));
  const keys = cleaned.map((t) => formulaKey(t, katex));
  const reasons = [];
  if (!cleaned[0]) reasons.push("empty reading");
  if (keys[0] == null) reasons.push("the formula does not render");
  if (reads.some((r) => r.truncated)) reasons.push("a reading ran on without finishing (repeating symbols)");
  if (MULTI_LINE.test(cleaned[0])) reasons.push("the crop holds more than one printed line");
  if (OTHER_LABEL.test(cleaned[0])) reasons.push("the crop holds another option's label");
  if (new Set(keys).size > 1) reasons.push("the three readings disagree");
  const minProb = Math.min(...reads.map((r) => r.min));
  if (minProb < MIN_PROB) reasons.push(`one symbol was read with low certainty (${Math.round(minProb * 100)}%)`);
  // Words, not LaTeX command names (\left, \frac …), decide "prose".
  // (Fixed after the held-out run: found by the UI test on development page 12.)
  const prose = PROSE_TEX.test(cleaned[0]) && /[a-z]{4,}/.test(cleaned[0].replace(/\\[a-zA-Z]+/g, " "));
  const status = keys[0] == null || !cleaned[0] ? "failed" : prose ? "text" : reasons.length ? "uncertain" : "agreed";
  return { latex: cleaned[0] || null, alternatives: [...new Set(cleaned.slice(1).filter((t, i) => keys[i + 1] !== keys[0]))], status, reasons, minProb: Math.round(minProb * 1000) / 1000 };
}

// ---------------------------------------------------------------------
// Helper calls (browser)
// ---------------------------------------------------------------------
export async function helperHealth(url = MATH_OCR_URL, ms = 2000) {
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url + "/health", { signal: ac.signal }); clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function recognize(url, crops) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000 + crops.length * 15000);
  try {
    const r = await fetch(url + "/recognize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crops }), signal: ac.signal });
    if (!r.ok) throw new Error(`helper answered ${r.status}`);
    return (await r.json()).results;
  } finally { clearTimeout(t); }
}
function cropPng(canvas, b, pad = 6) {
  const x0 = Math.max(0, Math.floor(b[0] - pad)), y0 = Math.max(0, Math.floor(b[1] - pad));
  const x1 = Math.min(canvas.width, Math.ceil(b[2] + pad)), y1 = Math.min(canvas.height, Math.ceil(b[3] + pad));
  const c = document.createElement("canvas"); c.width = x1 - x0; c.height = y1 - y0;
  c.getContext("2d").drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return { png: c.toDataURL("image/png").split(",")[1], box: [x0, y0, x1, y1] };
}
const thousandths = (b, d) => [b[0] / d.w, b[1] / d.h, b[2] / d.w, b[3] / d.h].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000));

// Runs the whole step on segmented questions (mutates them: draft options,
// issues, q.math). renderPage(pageNo) → canvas at the OCR resolution.
export async function runMathOcr(questions, pagesData, { renderPage, katex, url = MATH_OCR_URL, status = () => {}, batch = 8 } = {}) {
  const t0 = Date.now();
  const stats = { regions: 0, sent: 0, agreed: 0, uncertain: 0, failed: 0, text: 0, prose: 0, noMarker: 0, stemSuggestions: 0, helperMs: 0, pages: 0 };
  const dims = Object.fromEntries(pagesData.map((p) => [p.page, { w: p.width, h: p.height }]));
  const pageCtx = Object.fromEntries(pagesData.map((p) => [p.page, { columns: p.columns, lines: (p.lines || []).map((l) => ({ ...l, page: p.page })) }]));
  const work = [];
  for (const q of questions) {
    q.math = [];
    if (!q.lines?.some((l) => l.words)) continue;
    // The text parser found no options (typically every option a garbled
    // stacked formula): if the page shows at least three markers a)…d) in
    // order, the options are recovered from the page — always flagged.
    const m = findOptionMarkers(q.lines);
    // Option rows are short (formulas, numbers) or share a row; sub-part
    // questions ("(a) Explain why …") have sentence-long rows.
    const optionLike = (w) => {
      const rest = (w.line.words || []).filter((x) => x.x0 > w.x1).map((x) => x.text).join(" ");
      return rest.length < 35 || Object.values(m).some((o) => o !== w && o.line === w.line);
    };
    if (!q.draft.options?.length) {
      // The text parser found no options — typically every option a garbled
      // stacked formula, which can also make it call the question
      // "descriptive". Recovered only from ≥3 option-like markers; flagged.
      if (q.kind && !["unknown", "descriptive"].includes(q.kind)) continue;
      const found = Object.values(m).filter(optionLike);
      if (found.length < 3) continue;
      q.draft.options = ["A", "B", "C", "D"].filter((k) => m[k] || k < Object.keys(m).sort().pop()).map((key) => ({ key, text: "" }));
      q.draft.type = "single";
      q.recovered = true;
      stats.recoveredQuestions = (stats.recoveredQuestions || 0) + 1;
      q.issues.push(`Math OCR: the text reader found no options${q.kind === "descriptive" ? " and took this for a descriptive question" : ""}; option markers a)–d) were found on the page and each option was read from its image — check the question type, every option and the answer before verifying`);
    } else if (q.draft.options.length < 4 && Array.isArray(q.draft.options)) {
      // Some options missing from the text: add those whose marker is on the page.
      const add = ["A", "B", "C", "D"].filter((k) => m[k] && optionLike(m[k]) && !q.draft.options.some((o) => o.key === k));
      if (add.length) {
        for (const key of add) q.draft.options.push({ key, text: "" });
        q.draft.options.sort((a, b) => a.key.localeCompare(b.key));
        q.recoveredKeys = add;
        q.issues.push(`Math OCR: option ${add.join(", ")} was missing from the text but its marker was found on the page — read from the image; check it`);
      }
    }
    const r = mathRegions(q, dims, pageCtx);
    for (const o of r.options) {
      if (o.missing) { stats.noMarker++; q.math.push({ target: "option", key: o.key, status: "not_located", reasons: [o.missing], ocr_text: q.draft.options.find((x) => x.key === o.key)?.text ?? "" }); continue; }
      if (o.prose) { stats.prose++; continue; }
      work.push({ q, kind: "option", ...o });
    }
    for (const s of r.stem) work.push({ q, kind: "stem", key: s.id, ...s });
  }
  const byPage = new Map();
  for (const w of work) { if (!byPage.has(w.page)) byPage.set(w.page, []); byPage.get(w.page).push(w); }
  for (const [page, items] of byPage) {
    stats.pages++;
    status(`Math OCR: page ${page} — ${items.length} formula region(s)…`);
    const canvas = await renderPage(page);
    const img = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const grey = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < grey.length; i++) grey[i] = (img[i * 4] * 299 + img[i * 4 + 1] * 587 + img[i * 4 + 2] * 114) / 1000;
    const crops = [];
    for (const w of items) {
      const box = w.kind === "option" ? inkBox(grey, canvas.width, canvas.height, w.box, w.seed[0], w.seed[1], w.H) : w.box;
      if (!box) { w.result = { status: "failed", reasons: ["no ink found in the option area"] }; continue; }
      const c = cropPng(canvas, box);
      w.crop = c.box; stats.regions++;
      crops.push({ id: String(crops.length), png: c.png, w });
    }
    for (let i = 0; i < crops.length; i += batch) {
      const part = crops.slice(i, i + batch);
      const t = Date.now();
      let res;
      try { res = await recognize(url, part.map(({ id, png }) => ({ id, png }))); } catch (e) { res = part.map((p) => ({ id: p.id, error: String(e.message || e) })); }
      stats.helperMs += Date.now() - t; stats.sent += part.length;
      for (const r of res) {
        const p = part.find((x) => x.id === r.id);
        p.w.reads = r.reads || null;
        p.w.result = r.error ? { status: "failed", reasons: ["helper error: " + r.error] } : decide(r.reads, katex);
      }
    }
  }
  // Apply — only to the same option of the same question.
  for (const w of work) {
    const q = w.q, res = w.result || { status: "failed", reasons: ["not read"] };
    if (q.recoveredKeys?.includes(w.key) && res.status === "agreed") { res.status = "uncertain"; res.reasons = [...(res.reasons || []), "this option was missing from the text and was read from the page"]; }
    if (q.recovered && res.status === "agreed") { res.status = "uncertain"; res.reasons = [...(res.reasons || []), "options recovered from the page (the text reader found none)"]; }
    if (w.inferred && res.status === "agreed") { res.status = "uncertain"; res.reasons = [...(res.reasons || []), "the option letter was unreadable; its place was inferred from the other options"]; }
    const opt = w.kind === "option" ? q.draft.options.find((o) => o.key === w.key) : null;
    const entry = { target: w.kind, key: w.key, page: w.page, crop_px: w.crop ?? null, box: w.crop ? thousandths(w.crop, dims[w.page]) : null,
      ocr_text: w.kind === "option" ? (opt?.text ?? "") : w.ocr, latex: res.latex ?? null, alternatives: res.alternatives ?? [], status: res.status,
      reasons: res.reasons ?? [], min_prob: res.minProb ?? null, reads: (w.reads || []).map((r) => ({ latex: r.latex, min: r.min, ms: r.ms })), applied: false };
    if (w.kind === "option" && opt && res.latex && (res.status === "agreed" || res.status === "uncertain")) {
      opt.text = `$${res.latex}$`; entry.applied = true;
    }
    stats[res.status === "not_located" ? "noMarker" : res.status] = (stats[res.status] || 0) + (w.kind === "option" ? 1 : 0);
    if (w.kind === "stem") stats.stemSuggestions++;
    q.math.push(entry);
  }
  for (const q of questions) {
    const opts = q.math.filter((m) => m.target === "option");
    const unc = opts.filter((m) => m.status === "uncertain").map((m) => m.key);
    const fail = opts.filter((m) => m.status === "failed").map((m) => m.key);
    if (unc.length) q.issues.push(`Math OCR: option ${unc.join(", ")} read from the page image but NOT certain (${[...new Set(opts.filter((m) => m.status === "uncertain").flatMap((m) => m.reasons))].join("; ")}) — compare each with its source crop`);
    if (fail.length) q.issues.push(`Math OCR could not read option ${fail.join(", ")} — the OCR text was kept; type the formula from the source crop`);
    if (q.math.some((m) => m.target === "stem")) q.issues.push(`Math OCR: ${q.math.filter((m) => m.target === "stem").length} formula suggestion(s) for the question text are shown beside their source crop — the question text was not changed`);
  }
  stats.ms = Date.now() - t0;
  return stats;
}
