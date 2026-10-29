// =====================================================================
// SIR question bank — OCR of one scanned / photographed PDF page (browser)
//
// Shared by the portal and the regression harness so both run exactly the
// same steps:
//   1. render the page at OCR resolution (higher than the review preview);
//   2. clean a COPY for OCR: flatten uneven phone-photo lighting and drop
//      coloured ink (pen ticks/circles over option letters, pink banners,
//      watermarks). The stored page image and the original PDF are never
//      changed;
//   3. find the column gutter, straighten and OCR each column separately;
//   4. rebuild exponents / subscripts from character positions. An exponent
//      that is clearly there but cannot be read confidently becomes [[?]]
//      for the reviewer — it is never guessed;
//   5. locate diagram areas: ink that is not recognised text.
// Returned coordinates are OCR-canvas pixels (top-left origin).
// =====================================================================

export const UNREADABLE = "[[?]]";
export const OCR_LONG_SIDE = 3300;

export async function renderPage(page, longSide = OCR_LONG_SIDE) {
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: longSide / Math.max(vp1.width, vp1.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  return canvas;
}

// ---------------------------------------------------------------------
// Image clean-up (pure: RGBA in, grey out)
// ---------------------------------------------------------------------
export function prepPixels(rgba, w, h, { dropColour = true, sat = 60, flatten = true, binarize = 0 } = {}) {
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // Coloured, not near-black: pen marks, banners, watermark → paper.
    grey[i] = dropColour && mx - mn > sat && mx > 90 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
  }
  if (!flatten) return Uint8ClampedArray.from(grey, (v) => binarize ? (v < binarize ? 0 : 255) : v);
  // Paper brightness per block (its brightest pixels), smoothed, then
  // every pixel is divided by it: shadows and gradients disappear.
  const B = Math.max(16, Math.round(Math.max(w, h) / 60));
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const vals = [];
    for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2) for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) vals.push(grey[y * w + x]);
    vals.sort((a, b) => b - a);
    bg[by * bw + bx] = vals[Math.floor(vals.length * 0.1)] || 255;
  }
  const sm = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.min(bw - 1, Math.max(0, bx + dx)), y = Math.min(bh - 1, Math.max(0, by + dy));
      m = Math.max(m, bg[y * bw + x]);
    }
    sm[by * bw + bx] = Math.max(60, m);
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, y / B - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, x / B - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
      const a = sm[y0 * bw + x0], b2 = sm[y0 * bw + x0 + 1] ?? a, c = sm[(y0 + 1) * bw + x0] ?? a, d = sm[(y0 + 1) * bw + x0 + 1] ?? a;
      const paper = (a * (1 - tx) + b2 * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      const v = Math.min(255, (grey[y * w + x] / paper) * 255);
      out[y * w + x] = binarize ? (v < binarize ? 0 : 255) : v;
    }
  }
  return out;
}

// Printed column rules: long, thin, near-vertical strokes (often coloured).
// Tesseract reads one next to a question number as "1" or "|" ("1111.",
// "| 102.") or drops the number with it. Found on a 2× reduced dark mask;
// each rule is returned as a line x = a + b·y (page pixels) with a
// half-thickness t. Searched as straight dark runs at small slants (a phone
// photo tilts the rule by a degree or two); text never makes one, because
// the gaps between text lines break it.
export function findVerticalRules(grey, w, h, { dark = 170, minLen = 0.12, maxGap = 2 } = {}) {
  // Searched on a 4× reduced mask (a cell is dark if any of its pixels is):
  // a 3–5 px rule stays one cell wide and the search is ~16× cheaper than
  // at full size. The eraser then follows the real stroke at full size.
  const D = 4, mw = Math.ceil(w / D), mh = Math.ceil(h / D);
  const m = new Uint8Array(mw * mh);
  for (let y = 0; y < h; y++) {
    const row = (y >> 2) * mw, src = y * w;
    for (let x = 0; x < w; x++) if (grey[src + x] < dark) m[row + (x >> 2)] = 1;
  }
  const cands = [];
  const off = new Int32Array(mh + 1);
  // Slants up to ±3.4° (curled page edges); every long run counts, so a
  // curved rule is found as several straight pieces.
  for (let s = -6; s <= 6; s++) {
    const b = s * 0.01;
    for (let y = 0; y <= mh; y++) off[y] = Math.round(b * y);
    for (let a = 0; a < mw; a++) {
      let start = -1, last = -1, hits = 0, thin = 0;
      for (let y = 0; y <= mh; y++) {
        const x = a + off[y], row = y * mw;
        const on = y < mh && x >= 1 && x < mw - 1 && (m[row + x] | m[row + x - 1] | m[row + x + 1]) === 1;
        if (on && !(start >= 0 && y - last > maxGap)) {
          if (start < 0) { start = y; hits = 0; thin = 0; }
          last = y; hits++;
          if (!(x >= 3 && m[row + x - 3]) && !(x + 3 < mw && m[row + x + 3])) thin++;
          continue;
        }
        if (start >= 0 && (y - last > maxGap || y === mh || on)) {
          const len = last - start;
          if (len >= mh * minLen && hits >= len * 0.85 && thin >= hits * 0.6) cands.push({ a, b, len, y0: start, y1: last });
          start = on ? y : -1; hits = on ? 1 : 0; thin = 0; last = on ? y : -1;
        }
      }
    }
  }
  // One rule per stroke: neighbouring positions/slants describe the same one
  // (same place where their heights overlap).
  cands.sort((p, q) => q.len - p.len);
  const kept = [];
  for (const c of cands) {
    const same = kept.some((r) => {
      const lo = Math.max(r.y0, c.y0), hi = Math.min(r.y1, c.y1);
      if (hi <= lo) return false;
      const mid = (lo + hi) / 2;
      return Math.abs((r.a + r.b * mid) - (c.a + c.b * mid)) < 4;
    });
    if (!same) kept.push(c);
  }
  return kept.map((c) => ({ a: (c.a + 0.5) * D, b: c.b, y0: c.y0 * D, y1: (c.y1 + 1) * D, t: 3 * D }));
}

// Paint the rules as paper (OCR copy only; the stored page is untouched).
// Per row only the thin dark run nearest the predicted line is erased (at
// most 10 px wide), so a character close to the rule keeps its pixels.
export function eraseVerticalRules(grey, w, h, rules, { dark = 170 } = {}) {
  for (const r of rules) {
    for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++) {
      const xc = Math.round(r.a + r.b * y), row = y * w;
      let best = -1;
      for (let d = 0; d <= r.t && best < 0; d++) {
        if (xc - d >= 0 && grey[row + xc - d] < dark) best = xc - d;
        else if (xc + d < w && grey[row + xc + d] < dark) best = xc + d;
      }
      if (best < 0) continue;
      let x0 = best, x1 = best;
      while (x0 > 0 && grey[row + x0 - 1] < dark && best - x0 < 10) x0--;
      while (x1 < w - 1 && grey[row + x1 + 1] < dark && x1 - best < 10) x1++;
      if (x1 - x0 + 1 > 10) continue; // a wide run here is not the rule alone
      for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) grey[row + x] = 255;
    }
  }
  return grey;
}

export function prepareCanvas(src, opts = {}) {
  const ctx = src.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const g = prepPixels(img.data, src.width, src.height, opts);
  if (opts.rules) {
    opts.rules.push(...findVerticalRules(g, src.width, src.height));
    eraseVerticalRules(g, src.width, src.height, opts.rules);
  }
  const out = document.createElement("canvas"); out.width = src.width; out.height = src.height;
  const oimg = new ImageData(src.width, src.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) { oimg.data[p] = oimg.data[p + 1] = oimg.data[p + 2] = g[i]; oimg.data[p + 3] = 255; }
  out.getContext("2d").putImageData(oimg, 0, 0);
  return { canvas: out, grey: g };
}

// ---------------------------------------------------------------------
// Columns and skew
// ---------------------------------------------------------------------
// The gap between two columns. Question numbers of the right column hang
// into this gap, so the split is placed at the gap's LEFT edge (where the
// left column's text ends), not at its emptiest point — otherwise the right
// column loses its numbers.
function findGutter(boxes, pageWidth) {
  if (boxes.length < 12) return null;
  const lo = pageWidth * 0.3, hi = pageWidth * 0.7, step = Math.max(2, pageWidth / 400);
  const prof = [];
  for (let x = lo; x <= hi; x += step) prof.push({ x, crossing: boxes.filter((b) => b.x0 < x - 1 && b.x1 > x + 1).length });
  const best = prof.reduce((m, p) => (p.crossing < m.crossing ? p : m), prof[0]);
  const left = boxes.filter((b) => b.x1 <= best.x).length, right = boxes.filter((b) => b.x0 >= best.x).length;
  if (!(best.crossing <= boxes.length * 0.06 && left >= boxes.length * 0.2 && right >= boxes.length * 0.2)) return null;
  const tol = best.crossing + Math.max(2, Math.round(boxes.length * 0.015));
  let i = prof.indexOf(best);
  while (i > 0 && prof[i - 1].crossing <= tol) i--;
  return prof[i].x;
}

export function columnRects(words, w, h) {
  const gutter = findGutter((words || []).filter((x) => (x.text || "").trim()).map((x) => x.bbox), w);
  if (gutter == null) return [{ left: 0, top: 0, width: w, height: h }];
  const pad = Math.round(w * 0.004);
  return [
    { left: 0, top: 0, width: Math.min(w, Math.round(gutter + pad)), height: h, gutter },
    { left: Math.max(0, Math.round(gutter - pad)), top: 0, width: w - Math.max(0, Math.round(gutter - pad)), height: h, gutter },
  ];
}

// Words of the layout pass that belong to the OTHER column: on a tilted or
// curved photo the ends of left-column lines reach past the split and were
// read glued in front of right-column numbers ("mly 39.", "eld 123.").
// A mask never covers a word of this column: the layout pass sometimes
// returns a box that runs over the neighbouring number ("uniformly" over
// "39."), so masks are cut back at this column's words.
export function otherColumnWords(words, rects, col) {
  if (rects.length < 2) return [];
  const g = rects[0].gutter;
  const boxes = (words || []).filter((x) => (x.text || "").trim() && x.bbox).map((x) => x.bbox);
  const mine = boxes.filter((b) => (col === 0 ? (b.x0 + b.x1) / 2 <= g : (b.x0 + b.x1) / 2 >= g));
  const vOverlap = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.3 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return boxes.filter((b) => !mine.includes(b)).map((b) => {
    const m = { ...b };
    for (const o of mine) {
      if (!vOverlap(m, o)) continue;
      if (col === 1 && o.x0 > m.x0) m.x1 = Math.min(m.x1, o.x0 - 3);
      if (col === 0 && o.x1 < m.x1) m.x0 = Math.max(m.x0, o.x1 + 3);
    }
    return m;
  }).filter((m) => m.x1 > m.x0);
}

// A strip of the NEIGHBOURING page at the image edge: words beyond an empty
// vertical gap in the outer column, all running to the edge. Found on the
// layout pass (before column OCR, which may glue the strip onto real lines).
// Returns page rectangles to paint out of the OCR copy.
export function edgeStrips(words, rects, w, h) {
  const boxes = (words || []).filter((x) => (x.text || "").trim() && x.bbox).map((x) => x.bbox);
  const out = [];
  const side = (outer, inner) => {
    // Candidate gap positions in the outer 40% of the outer column.
    const r = outer, lo = inner ? r.left + r.width * 0.6 : r.left, hi = inner ? w * 0.97 : r.left + r.width * 0.4;
    let best = null;
    for (let x = lo; x <= hi; x += 4) {
      const crossing = boxes.filter((b) => b.x0 < x && b.x1 > x).length;
      const beyond = boxes.filter((b) => (inner ? b.x0 >= x : b.x1 <= x));
      if (crossing === 0 && beyond.length >= 3 && (!best || (inner ? x < best.x : x > best.x))) best = { x, beyond };
    }
    if (!best) return;
    // The strip must reach the edge, and the page's own text must be on the
    // other side of the gap along most of the strip's height.
    const reach = inner ? Math.max(...best.beyond.map((b) => b.x1)) >= w * 0.97 : Math.min(...best.beyond.map((b) => b.x0)) <= w * 0.03;
    const y0 = Math.min(...best.beyond.map((b) => b.y0)), y1 = Math.max(...best.beyond.map((b) => b.y1));
    const pageSide = boxes.filter((b) => (inner ? b.x1 <= best.x : b.x0 >= best.x) && b.y1 > y0 && b.y0 < y1 && (inner ? b.x0 >= r.left : b.x1 <= r.left + r.width));
    if (reach && pageSide.length >= best.beyond.length) out.push(inner ? { x0: best.x, y0: 0, x1: w, y1: h } : { x0: 0, y0: 0, x1: best.x, y1: h });
  };
  if (rects.length) { side(rects[rects.length - 1], true); side(rects[0], false); }
  return out;
}

// Lines photographed from the NEIGHBOURING page: a strip at the image edge
// (start far into the outer column and run off the image). Returned
// separately so they stay in the audit text but never join a question.
export function edgeBleed(lines, rects, w) {
  const keep = [], bleed = [];
  const last = rects[rects.length - 1], first = rects[0];
  for (const l of lines) {
    const right = l.col === rects.length - 1 && l.x0 > last.left + 0.6 * last.width && l.x1 >= w * 0.985;
    const left = l.col === 0 && l.x0 <= w * 0.015 && l.x1 < first.left + 0.35 * first.width;
    (right || left ? bleed : keep).push(l);
  }
  // A single line at the edge can be a long line of the page itself; a strip
  // is several lines.
  return bleed.length >= 2 ? { keep, bleed } : { keep: lines, bleed: [] };
}

// Median slope (radians) of long text lines inside a rectangle.
export function skewOf(lines, r) {
  const a = [];
  for (const l of lines || []) {
    const b = l.baseline, bb = l.bbox;
    if (!b || !bb || bb.x0 < r.left - 5 || bb.x1 > r.left + r.width + 5) continue;
    if (b.x1 - b.x0 < r.width * 0.4) continue;
    a.push(Math.atan2(b.y1 - b.y0, b.x1 - b.x0));
  }
  if (a.length < 3) return 0;
  a.sort((x, y) => x - y);
  const m = a[Math.floor(a.length / 2)];
  return Math.abs(m) < 0.15 ? m : 0;
}

// The column as its own canvas, rotated by -angle; map() turns its
// coordinates back into page coordinates.
function columnCanvas(src, r, angle, mask = []) {
  // Padding so rotated corners are not cut off.
  const pad = Math.ceil(Math.abs(Math.sin(angle)) * Math.max(r.width, r.height) / 2) + 8;
  // The column alone, with the other column's words painted out.
  const part = document.createElement("canvas"); part.width = r.width; part.height = r.height;
  const pctx = part.getContext("2d");
  pctx.drawImage(src, r.left, r.top, r.width, r.height, 0, 0, r.width, r.height);
  pctx.fillStyle = "#fff";
  for (const b of mask) pctx.fillRect(b.x0 - r.left - 2, b.y0 - r.top - 2, b.x1 - b.x0 + 4, b.y1 - b.y0 + 4);
  const c = document.createElement("canvas"); c.width = r.width + 2 * pad; c.height = r.height + 2 * pad;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  const cx = c.width / 2, cy = c.height / 2;
  ctx.translate(cx, cy); ctx.rotate(-angle); ctx.translate(-cx, -cy);
  ctx.drawImage(part, 0, 0, r.width, r.height, pad, pad, r.width, r.height);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const pt = (x, y) => [r.left - pad + cx + (x - cx) * cos - (y - cy) * sin, r.top - pad + cy + (x - cx) * sin + (y - cy) * cos];
  const map = (b) => {
    const ps = [pt(b.x0, b.y0), pt(b.x1, b.y0), pt(b.x0, b.y1), pt(b.x1, b.y1)];
    return { x0: Math.min(...ps.map((p) => p[0])), y0: Math.min(...ps.map((p) => p[1])), x1: Math.max(...ps.map((p) => p[0])), y1: Math.max(...ps.map((p) => p[1])) };
  };
  return { canvas: c, map };
}

// ---------------------------------------------------------------------
// Exponents and subscripts from character geometry (pure)
// ---------------------------------------------------------------------
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻", "+": "⁺" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Returns { text, exps }. Every power of ten written as "10" + a raised
// run becomes a placeholder \u0001n\u0002 in the text; the caller decides
// its value from the page pixels (digits read or re-read, sign measured).
// Other raised runs: a clean number after a letter becomes a superscript
// (m s⁻², r²); anything else is kept exactly as read (°, ′, quotes).
export function rebuildLine(line) {
  const words = (line.words || []).filter((w) => (w.text || "").trim());
  const syms = words.flatMap((w) => w.symbols || []).filter((s) => s.bbox && /[A-Za-z0-9]/.test(s.text || ""));
  const H = median(syms.map((s) => s.bbox.y1 - s.bbox.y0).filter((v) => v > 0).sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(syms.length * 0.4)))) || 0;
  const bl = line.baseline && line.baseline.x1 > line.baseline.x0 ? line.baseline : null;
  const baseY = (x) => bl ? bl.y0 + (bl.y1 - bl.y0) * (x - bl.x0) / (bl.x1 - bl.x0) : (line.bbox?.y1 ?? 0);
  const raised = (s) => H > 0 && s.bbox.y1 < baseY((s.bbox.x0 + s.bbox.x1) / 2) - 0.3 * H && s.bbox.y1 - s.bbox.y0 < 0.85 * H;
  const lowered = (s) => H > 0 && /\d/.test(s.text) && s.bbox.y1 > baseY((s.bbox.x0 + s.bbox.x1) / 2) + 0.18 * H && s.bbox.y1 - s.bbox.y0 < 0.78 * H;
  const out = [], exps = [];
  const MUL = /^[x×*X]$/;
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi], s = w.symbols || [];
    if (!H || !s.length || s.some((x) => !x.bbox)) { out.push(w.text.trim()); continue; }
    const prevText = out[out.length - 1] || "";
    // Scientific notation: "× 10…" / "x10…". Everything after the "10" is a
    // candidate exponent, raised or not — the page pixels decide later.
    let ten = -1;
    for (let i = 0; i + 1 < s.length; i++) {
      if (s[i].text === "1" && s[i + 1].text === "0" && (i === 0 ? MUL.test(prevText) || /[x×*]$/.test(prevText) : MUL.test(s[i - 1].text))) { ten = i; break; }
    }
    if (ten >= 0) {
      let run = s.slice(ten + 2), skip = 0;
      // Exponent read as a separate word right after "10".
      const nx = words[wi + 1];
      if (!run.length && nx?.symbols?.length && nx.symbols.every((x) => x.bbox && raised(x)) && nx.bbox.x0 - s[s.length - 1].bbox.x1 < 0.6 * H) { run = nx.symbols; skip = 1; }
      const base = s.slice(0, ten + 2).map((x) => x.text).join("");
      const zb = s[ten + 1].bbox, zh = zb.y1 - zb.y0;
      if (run.length) {
        const rt = run.map((x) => x.text).join("").replace(/[−–—]/g, "-");
        const conf = Math.min(...run.map((x) => x.confidence ?? 0));
        exps.push({ digits: /^-?\d{1,3}$/.test(rt) && conf >= 70 ? rt.replace("-", "") : null, negRead: rt.startsWith("-"), raw: rt, runBox: union(run.map((x) => x.bbox)), baseBox: zb, H });
      } else {
        // OCR returned nothing after "10": still look above-right of the 0
        // on the page (exponents are often dropped entirely).
        exps.push({ digits: null, negRead: false, raw: "", runBox: { x0: zb.x1, y0: zb.y0 - 0.25 * zh, x1: zb.x1 + 0.9 * zh, y1: zb.y0 + 0.4 * zh }, baseBox: zb, H, searched: true });
      }
      out.push(base + `\u0001${exps.length - 1}\u0002`);
      wi += skip;
      continue;
    }
    // Other raised runs: a clean number after a letter is a superscript
    // (m s⁻², r²); anything else is kept as read (°, ′, quotes).
    let k = s.length;
    while (k > 0 && raised(s[k - 1])) k--;
    const run = s.slice(k), rt = run.map((x) => x.text).join("").replace(/[−–—]/g, "-");
    const bs = s.slice(0, k);
    // Subscript digits after a letter: q1 → q₁, ε0 → ε₀ (never after a digit).
    let t2 = "";
    bs.forEach((x, i) => { t2 += i > 0 && lowered(x) && /[A-Za-zα-ωΑ-Ω]$/.test(t2) ? (SUB[x.text] ?? x.text) : x.text; });
    const supOk = run.length && t2 && /[A-Za-z)]$/.test(t2) && /^-?\d{1,2}$/.test(rt) && Math.min(...run.map((x) => x.confidence ?? 0)) >= 70;
    out.push(t2 + (supOk ? [...rt].map((c) => SUP[c]).join("") : run.map((x) => x.text).join("")));
  }
  return { text: out.join(" "), exps };
}

// Shapes of the exponent, measured on the cleaned page pixels (OCR drops
// the small minus very often, and sometimes misreads digits):
//   sign:   "minus" — a short flat dash before the first digit, or a flat
//           stub sticking out of the "0" at exponent height;
//           "none"  — nothing between the "0" and the first digit;
//           "unsure" otherwise.
//   digits: number of digit-sized shapes in the exponent.
//   px: { data, width, height } RGBA (grey in R).
export function exponentShape(px, e) {
  const res = { sign: "unsure", digits: null };
  if (!e.baseBox) return res;
  const eh = e.runBox.y1 - e.runBox.y0, bh = e.baseBox.y1 - e.baseBox.y0, bw = e.baseBox.x1 - e.baseBox.x0;
  if (eh < 5 || bh < 6) return res;
  const X0 = Math.max(0, Math.floor(e.baseBox.x0)), X1 = Math.min(px.width - 1, Math.ceil(e.runBox.x1 + 2 * eh));
  const Y0 = Math.max(0, Math.floor(Math.min(e.runBox.y0, e.baseBox.y0) - 0.2 * eh)), Y1 = Math.min(px.height - 1, Math.ceil(e.baseBox.y1 + 2));
  const W = X1 - X0 + 1, Hh = Y1 - Y0 + 1;
  if (W < 4 || Hh < 4) return res;
  const dark = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) dark[y * W + x] = px.data[((Y0 + y) * px.width + X0 + x) * 4] < 128 ? 1 : 0;
  const lab = new Int32Array(W * Hh).fill(-1), ccs = [];
  for (let i = 0; i < dark.length; i++) {
    if (!dark[i] || lab[i] >= 0) continue;
    const cc = { x0: W, y0: Hh, x1: 0, y1: 0, n: 0, rows: new Map() }, st = [i]; lab[i] = ccs.length;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0;
      cc.n++; cc.x0 = Math.min(cc.x0, x); cc.x1 = Math.max(cc.x1, x); cc.y0 = Math.min(cc.y0, y); cc.y1 = Math.max(cc.y1, y);
      const r = cc.rows.get(y); cc.rows.set(y, r ? [Math.min(r[0], x), Math.max(r[1], x)] : [x, x]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, k = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < Hh && dark[k] && lab[k] < 0) { lab[k] = ccs.length; st.push(k); }
      }
    }
    ccs.push(cc);
  }
  const baseCx = (e.baseBox.x0 + e.baseBox.x1) / 2 - X0;
  // The "0": tallest shape covering the base box centre.
  const zero = ccs.filter((c) => c.x0 <= baseCx && c.x1 >= baseCx - bw * 0.3).sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0))[0];
  if (!zero || zero.y1 - zero.y0 < bh * 0.6) return res;
  const mid = zero.y0 + (zero.y1 - zero.y0) * 0.55;
  const expo = ccs.filter((c) => c !== zero && c.n >= 4 && c.y1 < mid && c.x0 > zero.x0 + (zero.x1 - zero.x0) * 0.5);
  const isDash = (c) => (c.x1 - c.x0 + 1) >= 1.4 * (c.y1 - c.y0 + 1) && (c.y1 - c.y0 + 1) <= 0.35 * eh && (c.x1 - c.x0 + 1) >= 0.2 * eh;
  // Digit shapes: raised, digit-sized, starting near the 0 and chained by
  // small gaps (so a following unit or word is not counted).
  const cand = expo.filter((c) => !isDash(c) && (c.y1 - c.y0 + 1) >= 0.5 * eh).sort((a, b) => a.x0 - b.x0);
  const digitCCs = [];
  for (const c of cand) {
    const prevX = digitCCs.length ? digitCCs[digitCCs.length - 1].x1 : zero.x1;
    if (c.x0 - prevX > (digitCCs.length ? 0.6 : 1.2) * eh) break;
    digitCCs.push(c);
  }
  res.digits = digitCCs.length;
  const first = digitCCs[0];
  if (!first) return res;
  res.digitBox = { x0: X0 + first.x0, y0: Y0 + Math.min(...digitCCs.map((c) => c.y0)), x1: X0 + Math.max(...digitCCs.map((c) => c.x1)) + 1, y1: Y0 + Math.max(...digitCCs.map((c) => c.y1)) + 1 };
  const dashBefore = expo.some((c) => isDash(c) && c.x1 <= first.x0 + 0.15 * eh);
  // Dash fused with the "0": rows at exponent height reach further right
  // than the 0's own widest point below.
  const right = (lo, hi) => { let m = -1; for (let y = Math.round(lo); y <= Math.round(hi); y++) { const r = zero.rows.get(y); if (r) m = Math.max(m, r[1]); } return m; };
  const zeroWide = right(zero.y0 + (zero.y1 - zero.y0) * 0.45, zero.y1);
  const fused = right(first.y0 + (first.y1 - first.y0) * 0.25, first.y0 + (first.y1 - first.y0) * 0.85) - zeroWide >= 0.25 * eh;
  // Anything dark between the 0 and the first digit, at exponent height?
  let between = 0;
  for (let y = first.y0; y <= first.y1; y++) for (let x = zero.x1 + 1; x < first.x0; x++) if (dark[y * W + x] && lab[y * W + x] !== lab[first.y0 * W + first.x0]) between++;
  // A dash fused onto the first digit makes that shape unusually wide, or
  // sticks out to the left at mid-height: never call that "no sign".
  const left = (lo, hi) => { let m = Infinity; for (let y = Math.round(lo); y <= Math.round(hi); y++) { const r = first.rows.get(y); if (r) m = Math.min(m, r[0]); } return m; };
  const fh = first.y1 - first.y0 + 1;
  const midLeft = left(first.y0 + fh * 0.3, first.y0 + fh * 0.65);
  const edgeLeft = Math.min(left(first.y0, first.y0 + fh * 0.2), left(first.y1 - fh * 0.2, first.y1));
  const digitFused = (first.x1 - first.x0 + 1) > 0.85 * fh || edgeLeft - midLeft >= 0.2 * eh;
  if (dashBefore || fused) res.sign = "minus";
  else if (between === 0 && first.x0 - zero.x1 >= 1 && !digitFused) res.sign = "none";
  return res;
}
function union(bs) { return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) }; }

// ---------------------------------------------------------------------
// Diagram areas: ink that is not covered by recognised text (pure)
// ---------------------------------------------------------------------
export function findFigureAreas(grey, w, h, textBoxes, lineH) {
  const C = Math.max(4, Math.round(Math.max(w, h) / 330));
  const gw = Math.ceil(w / C), gh = Math.ceil(h / C);
  const ink = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let n = 0, tot = 0;
    for (let y = gy * C; y < Math.min(h, (gy + 1) * C); y += 2) for (let x = gx * C; x < Math.min(w, (gx + 1) * C); x += 2) { tot++; if (grey[y * w + x] < 140) n++; }
    ink[gy * gw + gx] = n / Math.max(1, tot) > 0.03 ? 1 : 0;
  }
  for (const b of textBoxes) {
    for (let gy = Math.max(0, Math.floor(b.y0 / C) - 1); gy <= Math.min(gh - 1, Math.ceil(b.y1 / C)); gy++)
      for (let gx = Math.max(0, Math.floor(b.x0 / C) - 1); gx <= Math.min(gw - 1, Math.ceil(b.x1 / C)); gx++) ink[gy * gw + gx] = 0;
  }
  // Join nearby strokes, then collect connected areas.
  const R = 2, grown = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) if (ink[gy * gw + gx])
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = gx + dx, y = gy + dy; if (x >= 0 && y >= 0 && x < gw && y < gh) grown[y * gw + x] = 1; }
  const seen = new Uint8Array(gw * gh), areas = [];
  for (let i = 0; i < grown.length; i++) {
    if (!grown[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, inkCells = 0;
    while (st.length) {
      const j = st.pop(), x = j % gw, y = (j / gw) | 0;
      if (ink[j]) { inkCells++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * gw + nx;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && grown[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
    if (!inkCells) continue;
    const box = { x0: x0 * C, y0: y0 * C, x1: (x1 + 1) * C, y1: (y1 + 1) * C };
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const touchesEdge = box.x0 < w * 0.02 || box.x1 > w * 0.98 || box.y0 < h * 0.03 || box.y1 > h * 0.97;
    if (touchesEdge || bw < lineH * 4 || bh < lineH * 2.5 || inkCells < 30 || bw / bh > 8 || bh / bw > 8) continue;
    areas.push(box);
  }
  return areas;
}

// ---------------------------------------------------------------------
// Whole page
// ---------------------------------------------------------------------
// worker: a Tesseract.js worker ("eng"). Returns lines in page coordinates
// plus diagram areas and per-page statistics for the reconciliation report.
// Top to bottom; pieces of one row (OCR sometimes splits "a) …   b) …" on
// a tilted page, with b) slightly higher) left to right.
export function readingOrder(lines) {
  const sorted = [...lines].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [];
  for (const l of sorted) {
    const row = rows[rows.length - 1], cy = (l.y0 + l.y1) / 2, h = l.y1 - l.y0;
    if (row && Math.abs(cy - row.cy) < 0.5 * Math.min(h, row.h)) row.items.push(l);
    else rows.push({ cy, h, items: [l] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));
}

function debugCrop(canvas, e) {
  const b = e.baseBox || e.runBox, x0 = Math.max(0, b.x0 - 10), y0 = Math.max(0, Math.min(b.y0, e.runBox.y0) - 10);
  const x1 = e.runBox.x1 + 10, y1 = Math.max(b.y1, e.runBox.y1) + 10;
  const c = document.createElement("canvas"); c.width = (x1 - x0) * 3; c.height = (y1 - y0) * 3;
  const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  ctx.strokeStyle = "red"; ctx.lineWidth = 1;
  for (const [bx, col] of [[e.baseBox, "blue"], [e.firstBox, "green"], [e.runBox, "orange"]]) if (bx) { ctx.strokeStyle = col; ctx.strokeRect((bx.x0 - x0) * 3, (bx.y0 - y0) * 3, (bx.x1 - bx.x0) * 3, (bx.y1 - bx.y0) * 3); }
  return c.toDataURL("image/png");
}

// Measured on the RCC Electrostatics scans: lighting correction helps, but
// removing coloured ink makes Tesseract drop the question numbers in the
// margin, so OCR runs on the lighting-corrected copy with colours kept.
// Diagram detection uses a colour-free copy (no banners or pen marks).
export async function ocrPage(worker, srcCanvas, { status = () => {}, clean = true, dropColour = false, deskew = true, exponents = true, debug = false } = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const rules = [];
  const prepared = clean ? prepareCanvas(srcCanvas, { dropColour, rules }) : null;
  const canvas = prepared ? prepared.canvas : srcCanvas;
  // Stricter colour cut for diagram finding: banner edges and pen strokes go.
  const grey = prepareCanvas(srcCanvas, { dropColour: true, sat: 35 }).grey;
  status("finding columns");
  await worker.setParameters({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" });
  const { data: layout } = await worker.recognize(canvas);
  const rects = columnRects(layout.words, w, h);
  const strips = edgeStrips(layout.words, rects, w, h);
  const lines = [], textBoxes = [], stats = { columns: rects.length, skew: [], exponentsRead: 0, exponentsReread: 0, exponentsUnreadable: 0, rulesErased: rules.length, edgeStrips: strips.length };
  for (const [col, r] of rects.entries()) {
    const angle = deskew ? skewOf(layout.lines, r) : 0;
    stats.skew.push(Math.round(angle * 1800 / Math.PI) / 10);
    const cc = columnCanvas(canvas, r, angle, [...otherColumnWords(layout.words, rects, col), ...strips]);
    status(`column ${col + 1}/${rects.length}`);
    await worker.setParameters({ tessedit_pageseg_mode: "4", tessedit_char_whitelist: "" });
    const { data } = await worker.recognize(cc.canvas);
    const colLines = [];
    const px = exponents ? cc.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, cc.canvas.width, cc.canvas.height) : null;
    for (const l of data.lines || []) {
      if (!(l.text || "").trim()) continue;
      let text = (l.text || "").replace(/\s+$/, "");
      const rawText = text;
      if (exponents) {
        const rb = rebuildLine(l);
        text = rb.text;
        for (const [i, e] of rb.exps.entries()) {
          // Digits count only when two independent reads agree (in-line and
          // enlarged), or one read matches the number of digit shapes.
          // Digits are accepted only when two of three reads agree (in-line,
          // enlarged as a line, enlarged as a word) and the count matches
          // the digit shapes on the page.
          const shape = exponentShape(px, e);
          const r1 = shape.digitBox ? await rereadExponent(worker, cc.canvas, shape.digitBox, 56, "7") : null;
          const r2 = shape.digitBox && !(r1 && r1 === e.digits) ? await rereadExponent(worker, cc.canvas, shape.digitBox, 96, "8") : null;
          const votes = [e.digits, r1, r2].filter(Boolean);
          let digits = votes.find((v, i) => votes.indexOf(v) !== i) ?? null;
          if (digits && digits !== e.digits) stats.exponentsReread++;
          if (digits && shape.digits !== digits.length) digits = null;
          const sign = shape.sign === "none" && e.negRead ? "unsure" : shape.sign;
          stats.signs = stats.signs || { minus: 0, none: 0, unsure: 0 }; stats.signs[sign]++;
          if (debug) (stats.debug ||= []).push({ raw: e.raw, digits, sign, crop: debugCrop(cc.canvas, e) });
          let val;
          if (e.searched && !shape.digits) val = "10"; // nothing raised there: leave as read (flagged later if suspicious)
          else if (digits == null) { val = `$10^{${UNREADABLE}}$`; stats.exponentsUnreadable++; }
          else if (sign === "unsure") { val = `$10^{${UNREADABLE}${digits}}$`; stats.exponentsUnreadable++; }
          else { val = "10" + [...(sign === "minus" ? "-" : "") + digits].map((c) => SUP[c]).join(""); stats.exponentsRead++; }
          text = text.replace(`10\u0001${i}\u0002`, val);
        }
      }
      // Text areas (not diagrams): words read with some confidence, and whole
      // lines that read as text — but a line's box only when its words are
      // contiguous: a line that runs on into a diagram's labels beside it
      // ("…are placed , -4uC 3uC") would otherwise cover the diagram.
      for (const wd of l.words || []) if ((wd.confidence ?? 0) >= 40 && /[A-Za-z0-9]{2}|^[A-Za-z0-9]$/.test(wd.text || "")) textBoxes.push(cc.map(wd.bbox));
      const letters = (l.text.match(/[A-Za-z]/g) || []).length;
      const wb = (l.words || []).filter((wd) => wd.bbox && (wd.text || "").trim()).map((wd) => wd.bbox).sort((a, b) => a.x0 - b.x0);
      const lh = l.bbox.y1 - l.bbox.y0;
      const contiguous = wb.every((b, i) => i === 0 || b.x0 - wb[i - 1].x1 <= 1.5 * lh);
      if ((l.confidence ?? 0) >= 60 && letters >= 8 && letters / Math.max(1, l.text.replace(/\s/g, "").length) >= 0.7 && contiguous) textBoxes.push(cc.map(l.bbox));
      // hgt: the line's own height in the straightened column (page boxes of
      // a tilted column are taller than the text).
      colLines.push({ text, raw: rawText, col, conf: l.confidence ?? null, ...l.bbox, hgt: lh, pageBox: cc.map(l.bbox) });
    }
    // Question numbers hang in the column's left margin; the text pass
    // sometimes drops that strip entirely. Read it on its own.
    const added = await marginNumbers(worker, cc.canvas, colLines, debug ? (stats.marginDebug ||= []) : null);
    stats.marginNumbers = (stats.marginNumbers || 0) + added;
    // Order in the straightened column, then convert to page coordinates.
    lines.push(...readingOrder(colLines).map(({ pageBox, ...l }) => ({ ...l, ...pageBox })));
  }
  const { keep, bleed } = edgeBleed(lines, rects, w);
  stats.edgeLines = bleed.length;
  const lineH = median(keep.map((l) => l.hgt ?? (l.y1 - l.y0))) || h / 60;
  const figures = findFigureAreas(grey, w, h, textBoxes, lineH).map((b) => ({ ...b, col: rects.findIndex((r) => (b.x0 + b.x1) / 2 >= r.left && (b.x0 + b.x1) / 2 < r.left + r.width) }));
  const conf = keep.length ? keep.reduce((s, l) => s + (l.conf ?? 0), 0) / keep.length : 0;
  // Text of a masked neighbouring-page strip stays in the audit record.
  const inStrip = (bb) => strips.some((r) => bb.x0 >= r.x0 - 2 && bb.x1 <= r.x1 + 2);
  const stripLines = (layout.lines || []).filter((l) => l.bbox && (l.text || "").trim() && inStrip(l.bbox)).map((l) => ({ text: l.text.trim(), raw: l.text.trim(), conf: l.confidence ?? null, ...l.bbox }));
  const dropped = [...bleed, ...stripLines].map((l) => ({ ...l, reason: "outside the page's text area (neighbouring page in the photo)" }));
  return { lines: keep, dropped, figures, columns: rects, width: w, height: h, conf, stats };
}

// Margin pass. Question numbers hang left of the text; the text pass
// sometimes drops them. For every line that does not already start with a
// number, look at the page just left of it: if there is ink of digit height,
// OCR that small patch alone (digits and brackets only) and put the number
// in front of the line. A bare "29." line is joined to the text beside it.
// Returns how many numbers were added.
export async function marginNumbers(worker, canvas, colLines, dbg = null) {
  if (colLines.length < 5) return 0;
  const lineH = median(colLines.map((l) => l.y1 - l.y0));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const NUM = /^\W{0,3}\d{1,3}\s*[.)]/;
  let added = 0;
  // Bare number lines first.
  for (const row of colLines) {
    const bare = row.text.match(/^\W{0,2}(\d{1,3})\W{0,2}$/);
    if (!bare) continue;
    const next = colLines.find((l) => l !== row && l.text && Math.abs((l.y0 + l.y1) / 2 - (row.y0 + row.y1) / 2) < 0.6 * lineH && l.x0 > row.x0);
    if (next && !NUM.test(next.text)) { next.text = `${bare[1]}. ${next.text}`; next.x0 = Math.min(next.x0, row.x0); next.marginNumber = true; row.text = ""; added++; }
  }
  for (const l of colLines) {
    if (!l.text || NUM.test(l.text)) continue;
    const x1 = Math.round(l.x0 - 0.12 * lineH), x0 = Math.max(0, Math.round(l.x0 - 3.2 * lineH));
    const y0 = Math.max(0, Math.round(l.y0 - 0.1 * lineH)), y1 = Math.min(canvas.height, Math.round(l.y1 + 0.1 * lineH));
    if (x1 - x0 < 0.6 * lineH || y1 - y0 < 4) continue;
    // Ink extent in the patch (dark pixels only).
    const px = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, W = x1 - x0;
    let ix0 = W, ix1 = -1, iy0 = y1 - y0, iy1 = -1, n = 0;
    for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4] < 110) { n++; ix0 = Math.min(ix0, x); ix1 = Math.max(ix1, x); iy0 = Math.min(iy0, y); iy1 = Math.max(iy1, y); }
    if (n < 0.02 * lineH * lineH || iy1 - iy0 < 0.45 * lineH || ix1 - ix0 > 3 * lineH) continue;
    const c = document.createElement("canvas"), k = 48 / (iy1 - iy0 + 1);
    c.width = Math.round((ix1 - ix0 + 1) * k) + 40; c.height = 88;
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(canvas, x0 + ix0, y0 + iy0, ix1 - ix0 + 1, iy1 - iy0 + 1, 20, 20, c.width - 40, 48);
    await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789.()" });
    const { data } = await worker.recognize(c);
    const t = (data.text || "").replace(/\s/g, ""), m = t.match(/^\(?(\d{1,3})\.?\)?$/);
    if (dbg) dbg.push(`${Math.round(l.y0)}:${t}:${Math.round(data.confidence)}`);
    if (!m || (data.confidence ?? 0) < 60) continue;
    l.text = `${m[1]}. ${l.text}`; l.x0 = x0 + ix0; l.marginNumber = true; added++;
  }
  await worker.setParameters({ tessedit_pageseg_mode: "4", tessedit_char_whitelist: "" });
  for (let i = colLines.length - 1; i >= 0; i--) if (!colLines[i].text) colLines.splice(i, 1);
  return added;
}

// OCR the exponent digits again (measured digit shapes only), enlarged,
// digits only.
async function rereadExponent(worker, canvas, b, size, psm) {
  const pad = 2;
  const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad), x1 = Math.min(canvas.width, b.x1 + pad), y1 = Math.min(canvas.height, b.y1 + pad);
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  const k = size / (y1 - y0);
  const c = document.createElement("canvas"); c.width = Math.round((x1 - x0) * k) + 48; c.height = Math.round((y1 - y0) * k) + 48;
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 24, 24, c.width - 48, c.height - 48);
  await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: "0123456789" });
  const { data } = await worker.recognize(c);
  await worker.setParameters({ tessedit_char_whitelist: "" });
  const t = (data.text || "").replace(/\s/g, "");
  return /^\d{1,3}$/.test(t) && (data.confidence ?? 0) >= 70 ? t : null;
}
