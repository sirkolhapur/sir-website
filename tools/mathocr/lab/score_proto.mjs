// Scores a prototype harness run.
//   node score_proto.mjs bench <outdir>    — the 100-formula benchmark (crop boxes)
//   node score_proto.mjs held  <outdir>    — the held-out set (every option)
// Three systems, all from the SAME OCR run:
//   current  — the Tesseract option text (what production stores today)
//   p2t      — Pix2Text MFR reading as returned (no clean-up), where a region was read
//   p2t+     — what the prototype stores: cleaned reading if applied, else the Tesseract text
// exact = same meaning (KaTeX MathML, see ./score.mjs); layout = same structure.
import fs from "node:fs";
const { canon } = await import("./_canon.mjs");
const [mode, dir] = process.argv.slice(2);
const R = JSON.parse(fs.readFileSync(`${dir}/result.json`, "utf8"));
const qs = R.runs.flatMap((r) => r.questions);

const UNI = { "×": "\\times ", "π": "\\pi ", "ε": "\\varepsilon ", "∈": "\\in ", "μ": "\\mu ", "λ": "\\lambda ", "σ": "\\sigma ", "φ": "\\phi ", "√": "\\surd ", "°": "^{\\circ}" };
function mdToTex(s) { // stored Markdown with $…$ → one LaTeX string
  return String(s ?? "").split(/(\$[^$]*\$)/).map((seg) => /^\$[^$]*\$$/.test(seg) ? "{" + seg.slice(1, -1) + "}"
    : seg.replace(/[\\{}%&#_^~$]/g, (c) => "\\" + (c === "\\" ? "backslash " : c === "^" ? "^{}" : c === "~" ? "~{}" : c)).replace(/[×πε∈μλσφ√°]/g, (c) => UNI[c]).replace(/[^\x20-\x7e\\]/g, "?")).join("");
}
const C = (tex) => { try { return canon(tex); } catch { return null; } };
function judge(exp, tex, contains = false) {
  const e = C(exp), p = C(tex);
  if (!p) return { exact: false, layout: false, renders: false };
  return { exact: contains ? p.exact.includes(e.exact) : p.exact === e.exact, layout: contains ? p.skel.includes(e.skel) : p.skel === e.skel, renders: true };
}
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const flagged = (m) => m && (m.status === "uncertain" || m.status === "failed" || m.status === "not_located");

const rows = [];
if (mode === "bench") {
  const truth = JSON.parse(fs.readFileSync("./truth.json", "utf8")).items;
  const boxes = Object.fromEntries(JSON.parse(fs.readFileSync("./boxes.json", "utf8")).map((b) => [b.id, b]));
  for (const [id, t] of Object.entries(truth)) {
    if (!t.tex) continue;
    const b = boxes[id], stem = t.q[2] === "stem";
    const onPage = qs.filter((q) => q.page_from <= b.page && q.page_to >= b.page);
    // 1. a Math OCR region over the expression (detection)
    let hit = null, hq = null;
    for (const q of onPage) for (const m of q.math || []) if (m.page === b.page && m.crop_px && inter(m.crop_px, b.box) >= 0.5 * area(b.box) && area(m.crop_px) <= 6 * area(b.box) && (!hit || inter(m.crop_px, b.box) > inter(hit.crop_px, b.box))) { hit = m; hq = q; }
    // 2. otherwise the option whose marker sits on the expression's row, left of it
    let key = hit?.key, q = hq;
    if (!hit && !stem) {
      let best = null;
      for (const qq of onPage) for (const [k, mk] of Object.entries(qq.markers || {})) {
        const cyc = (mk.y0 + mk.y1) / 2;
        if (mk.page === b.page && mk.x0 < b.box[0] && cyc > b.box[1] - 10 && cyc < b.box[3] + 10 && (!best || mk.x0 > best.mk.x0)) best = { q: qq, k, mk };
      }
      if (best) { q = best.q; key = best.k; }
    }
    const before = q && !stem ? (q.before || []).find((o) => o.key === key)?.text : null;
    const after = q && !stem ? (q.after || []).find((o) => o.key === key)?.text : null;
    const stemText = stem ? (onPage.find((qq) => qq.stem && mdToTex(qq.stem) && judge(t.tex, mdToTex(qq.stem), true).exact)?.stem ?? onPage.map((qq) => qq.stem).join(" ")) : null;
    const cur = stem ? judge(t.tex, mdToTex(stemText), true) : before != null ? judge(t.tex, mdToTex(before)) : { exact: false, layout: false, renders: false, missing: true };
    const p2t = hit?.reads?.[0] ? judge(t.tex, hit.reads[0].latex) : cur;
    const plus = stem ? (hit?.latex ? { ...judge(t.tex, hit.latex), suggestionOnly: true } : cur) : after != null ? judge(t.tex, mdToTex(after)) : cur;
    rows.push({ id, cat: b.cat, stem, detected: !!hit, status: hit?.status ?? (key ? "not_sent" : "not_located"), flagged: flagged(hit), cur, p2t, plus, got: stem ? hit?.latex : after });
  }
} else {
  const truth = JSON.parse(fs.readFileSync("./held/truth.json", "utf8")).questions;
  for (const tq of truth) {
    const q = qs.find((x) => x.page_from === tq.page && x.number === tq.num) || qs.find((x) => x.page_from <= tq.page && x.page_to >= tq.page && x.number === tq.num);
    for (const [key, [kind, exp]] of Object.entries(tq.opts)) {
      const id = `p${tq.page}_q${tq.num}${key}`;
      if (!q) { rows.push({ id, kind, questionFound: false, detected: false, status: "question_not_found", cur: { exact: false, layout: false }, p2t: { exact: false, layout: false }, plus: { exact: false, layout: false } }); continue; }
      const m = (q.math || []).find((x) => x.target === "option" && x.key === key);
      const before = (q.before || []).find((o) => o.key === key)?.text ?? null, after = (q.after || []).find((o) => o.key === key)?.text ?? null;
      const changed = before !== after;
      if (kind === "formula") {
        const cur = before != null ? judge(exp, mdToTex(before)) : { exact: false, layout: false, missing: true };
        const p2t = m?.reads?.[0] ? judge(exp, m.reads[0].latex) : cur;
        const plus = after != null ? judge(exp, mdToTex(after)) : { exact: false, layout: false, missing: true };
        rows.push({ id, kind, questionFound: true, recovered: !before?.length && !!after, detected: !!m?.crop_px, status: m?.status ?? "not_sent", flagged: flagged(m), cur, p2t, plus, got: after });
      } else {
        // Text / graph options: a change is a FALSE detection; harmful if the meaning changed.
        const harmless = kind === "text" && changed && after && judge(mdToTex(exp), mdToTex(after)).exact;
        rows.push({ id, kind, questionFound: true, detected: !!m?.crop_px, status: m?.status ?? "not_sent", flagged: flagged(m), changed, falseReplace: changed && !harmless, got: after, before });
      }
    }
  }
}

const pct = (a, n) => n ? `${a}/${n} (${Math.round(100 * a / n)}%)` : "-";
const F = rows.filter((r) => mode === "bench" ? true : r.kind === "formula");
const opts = F.filter((r) => !r.stem);
console.log(`== ${mode}: ${F.length} expressions${mode === "bench" ? ` (${opts.length} in options, ${F.length - opts.length} in question text)` : ""}`);
for (const sys of ["cur", "p2t", "plus"]) console.log(`${{ cur: "current (Tesseract)", p2t: "Pix2Text alone", plus: "Pix2Text + clean-up" }[sys].padEnd(22)} exact ${pct(F.filter((r) => r[sys].exact).length, F.length).padEnd(14)} layout ${pct(F.filter((r) => r[sys].layout).length, F.length)}`);
console.log(`options only: current exact ${pct(opts.filter((r) => r.cur.exact).length, opts.length)}, p2t+ exact ${pct(opts.filter((r) => r.plus.exact).length, opts.length)}`);
console.log(`formula-detection recall (a Math OCR region read it): ${pct(F.filter((r) => r.detected).length, F.length)}; options only ${pct(opts.filter((r) => r.detected).length, opts.length)}`);
const wrongStored = opts.filter((r) => !r.plus.exact);
console.log(`stored option formulas still wrong: ${wrongStored.length}; of these flagged for review: ${wrongStored.filter((r) => r.flagged || r.status === "not_located" || r.status === "not_sent" || r.status === "question_not_found").length} (not sent / not located count as 'still Tesseract text, existing warnings apply')`);
const silent = opts.filter((r) => r.status === "agreed" && !r.plus.exact);
console.log(`UNFLAGGED wrong formulas (agreed but wrong): ${silent.length}${silent.length ? " — " + silent.map((r) => r.id + " → " + r.got).join(" | ") : ""}`);
const st = {}; for (const r of F) st[r.status] = (st[r.status] || 0) + 1; console.log("status of the formula options:", JSON.stringify(st));
if (mode === "held") {
  const T = rows.filter((r) => r.kind !== "formula");
  console.log(`text/graph options: ${T.length}; sent to Math OCR ${T.filter((r) => r.detected).length}; text replaced ${T.filter((r) => r.changed).length}; FALSE replacements (meaning changed) ${T.filter((r) => r.falseReplace).length}${T.some((r) => r.falseReplace) ? " — " + T.filter((r) => r.falseReplace).map((r) => `${r.id} [${r.status}${r.flagged ? ", flagged" : ""}] "${r.before}" → "${r.got}"`).join(" | ") : ""}`);
  console.log(`questions not found by the segmenter: ${[...new Set(rows.filter((r) => r.status === "question_not_found").map((r) => r.id.replace(/[A-D]$/, "")))].join(", ") || "none"}`);
}
// Review workload and time.
const allMath = qs.flatMap((q) => q.math || []);
const flagQ = qs.filter((q) => (q.math || []).some(flagged));
console.log(`review workload (pages ${R.runs.flatMap((r) => r.pages).join(",")}): ${qs.length} questions; Math OCR readings ${allMath.filter((m) => m.crop_px).length}; flagged formulas ${allMath.filter(flagged).length} in ${flagQ.length} questions; agreed (no extra tick) ${allMath.filter((m) => m.status === "agreed").length}; recovered questions ${qs.filter((q) => (q.issues || []).some((i) => /found no options/.test(i))).length}`);
const ocrMs = Object.values(R.timing?.ocr || {}), mathMs = R.runs.map((r) => r.stats.ms), reads = allMath.filter((m) => m.reads?.length);
console.log(`time: OCR ${ocrMs.length ? Math.round(ocrMs.reduce((a, b) => a + b, 0) / ocrMs.length / 1000) + " s/page (this run)" : "cached"}; Math OCR ${Math.round(mathMs.reduce((a, b) => a + b, 0) / 1000)} s for ${R.runs.flatMap((r) => r.pages).length} pages = ${(mathMs.reduce((a, b) => a + b, 0) / 1000 / R.runs.flatMap((r) => r.pages).length).toFixed(1)} s/page; ${(reads.reduce((s, m) => s + m.reads.reduce((a, x) => a + x.ms, 0), 0) / Math.max(1, reads.length) / 1000).toFixed(2)} s per formula (3 readings)`);
fs.writeFileSync(`${dir}/score_${mode}.json`, JSON.stringify(rows, null, 1));
