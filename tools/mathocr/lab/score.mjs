// Score every approach against truth.json.
//
// Comparison goes through the portal's own KaTeX (0.16.9) MathML output, so
// two LaTeX spellings that render the same expression compare equal
// ({\frac{1}{2}} = \frac{1}{2}, \mathrm{N} = N, "1 0^{2}" = "10^{2}") while a
// different symbol, exponent, sign or layout does not.
//   exact      — same symbols in the same structure (meaning preserved)
//   structure  — same layout skeleton (fractions, roots, powers, subscripts,
//                accents) with every symbol replaced by a placeholder
//   renders    — the stored text renders with KaTeX without an error
// Lenient display equivalences (documented in the report): ε/ϵ/∈ are one
// symbol (the book prints ∈₀ for ε₀ in some options); ϕ/φ; font variants
// (bold, roman, blackboard) are ignored; trailing/leading . , ; : are crop
// punctuation, not part of the expression.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "rtest", "x.js"));
const katex = require("katex");
require("katex/contrib/mhchem");

// ---------------------------------------------------------------- MathML
function parseXml(s) {
  const root = { tag: "#root", kids: [] }, st = [root];
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[5] != null) { st[st.length - 1].kids.push({ tag: "#text", text: m[5] }); continue; }
    if (m[1]) { st.pop(); continue; }
    const n = { tag: m[2], attrs: m[3], kids: [] };
    st[st.length - 1].kids.push(n);
    if (!m[4]) st.push(n);
  }
  return root;
}
const decode = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
// U+2061–2064 / U+200B: invisible operators KaTeX emits for \! and friends.
const MAP = { "ϵ": "ε", "∈": "ε", "ϕ": "φ", "−": "-", "–": "-", "∗": "*", " ": "", "⁡": "", "⁢": "", "⁣": "", "⁤": "", "​": "" };
const STRUCT = { mfrac: "frac", msqrt: "sqrt", mroot: "root", msup: "sup", msub: "sub", msubsup: "subsup", mover: "over", munder: "under", munderover: "underover" };
const textOf = (n) => n.tag === "#text" ? decode(n.text) : n.kids.map(textOf).join("");
function norm(n) {
  // Returns a flat list of items: leaf strings or {s: kind, a: [list...]}.
  if (n.tag === "#text") return [];
  if (n.tag === "annotation" || n.tag === "mspace") return [];
  if (n.tag === "semantics") return norm(n.kids[0]);
  if (["mi", "mn", "mo", "mtext", "ms"].includes(n.tag))
    return [...textOf(n)].map((c) => MAP[c] ?? c).filter((c) => c.trim());
  const s = STRUCT[n.tag];
  if (!s) return n.kids.flatMap(norm);           // math, mrow, mstyle, mpadded, menclose…
  const args = n.kids.filter((k) => k.tag !== "#text").map(norm);
  if (s === "sqrt") return [{ s, a: [n.kids.flatMap(norm)] }];
  // A power/subscript on a group renders the same as on its last item.
  if (["sup", "sub", "subsup"].includes(s) && args[0].length > 1) {
    const base = args[0];
    return [...base.slice(0, -1), { s, a: [[base[base.length - 1]], ...args.slice(1)] }];
  }
  return [{ s, a: args }];
}
const ser = (list, skel = false) => {
  let out = "";
  for (const it of list) {
    if (typeof it === "string") out += skel ? (out.endsWith("x") ? "" : "x") : it;
    else out += it.s + "{" + it.a.map((a) => ser(a, skel)).join("}{") + "}";
  }
  return out;
};
function canon(tex) {
  const ml = katex.renderToString(tex, { output: "mathml", throwOnError: true, strict: "ignore" });
  let list = norm(parseXml(ml));
  while (list.length && /^[.,;:]$/.test(list[0])) list.shift();
  while (list.length && /^[.,;:]$/.test(list[list.length - 1])) list.pop();
  return { exact: ser(list), skel: ser(list, true) };
}
const tryCanon = (tex) => { try { return { ok: true, ...canon(tex) }; } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 120) }; } };

// -------------------------------------------- production text → LaTeX
// Production stores Markdown with inline $…$; outside math, OCR text is
// plain characters. For comparison the plain parts are escaped literally.
const UNI = { "×": "\\times ", "π": "\\pi ", "ε": "\\varepsilon ", "∈": "\\in ", "μ": "\\mu ", "λ": "\\lambda ", "σ": "\\sigma ", "φ": "\\phi ", "√": "\\surd ", "°": "^{\\circ}" };
function prodToTex(s, lenient) {
  const t = String(s ?? "").split(/(\$[^$]*\$)/).map((seg) => {
    if (/^\$[^$]*\$$/.test(seg)) return "{" + seg.slice(1, -1) + "}";
    return seg.replace(/[\\{}%&#_^~$]/g, (c) => "\\" + (c === "\\" ? "backslash " : c === "^" ? "^{}" : c === "~" ? "~{}" : c))
      .replace(/[×πε∈μλσφ√°]/g, (c) => UNI[c]).replace(/[^\x20-\x7e\\]/g, "?");
  }).join("");
  // Text-normalisation leniency: the letter x between numbers read as ×.
  return lenient ? t.replace(/(\d)\s*[xX*]\s*(?=\d|\{)/g, "$1\\times ") : t;
}
// Does the stored Markdown render? The portal shields $…$ pairs; an odd
// number of $ (an OCR'd literal "$") pairs the wrong delimiters.
function prodRenders(s) {
  s = String(s ?? "");
  const dollars = (s.match(/\$/g) || []).length;
  if (dollars % 2) return { ok: false, err: "odd number of $ — math delimiters pair wrongly" };
  for (const m of s.matchAll(/\$([^$\n]+?)\$/g)) {
    try { katex.renderToString(m[1], { throwOnError: true, strict: "ignore" }); } catch (e) { return { ok: false, err: String(e.message).slice(0, 100) }; }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- data
const truth = JSON.parse(fs.readFileSync(path.join(HERE, "truth.json"), "utf8")).items;
const prodQ = JSON.parse(fs.readFileSync(path.join(HERE, "..", "ocr", "v5_final.json"), "utf8")).questions;
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8")); } catch { return {}; } };
const { cleanTex } = await import("./cleanup.mjs");
const mfr = load("out_mfr.json");
const models = { A2_tesseract_coords: load("out_a2.json"), B_pix2tex: load("out_pix2tex.json"), C_pix2text_mfr: mfr,
  "C+_mfr_cleanup": Object.fromEntries(Object.entries(mfr).map(([k, v]) => [k, { ...v, tex: cleanTex(v.tex) }])),
  // D: no hand-cut crop — the formula box is found by the MFD detector.
  "D_autodetect_C+": Object.fromEntries(Object.entries(load("out_mfd.json").items || {}).map(([k, v]) => [k, { tex: v.best ? cleanTex(v.best.tex) : "\\text{(no formula box found)}" }])) };

function production(t) {
  const [sec, num, key] = t.q;
  const q = prodQ.find((x) => x.section_no === sec && x.number === num);
  if (!q) return { text: null, why: "question not extracted" };
  if (key === "stem") return { text: q.draft.question, stem: true };
  const o = (q.draft.options || []).find((o) => o.key === key);
  return { text: o ? o.text : null, why: o ? null : "option missing" };
}

function judge(expC, predTex, contains) {
  const p = tryCanon(predTex);
  if (!p.ok) return { res: "latex_error", err: p.err };
  const ex = contains ? p.exact.includes(expC.exact) : p.exact === expC.exact;
  const sk = contains ? p.skel.includes(expC.skel) : p.skel === expC.skel;
  return { res: ex ? "pass" : sk ? "symbols" : "structure", exact: ex, skel: sk, got: p.exact };
}

const rows = [], sums = {};
const add = (ap, cat, r) => {
  for (const c of ["ALL", ...cat]) {
    const k = ap + "|" + c; const s = (sums[k] ||= { n: 0, exact: 0, skel: 0, render: 0, present: 0 });
    s.n++; if (r.exact) s.exact++; if (r.skel) s.skel++;
    // Render rate is over output that exists; a missing option is counted as missing, not as a render failure.
    if (r.res !== "missing") { s.present++; if (r.render) s.render++; }
  }
};
const boxes = JSON.parse(fs.readFileSync(path.join(HERE, "boxes.json"), "utf8"));
const catOf = Object.fromEntries(boxes.map((b) => [b.id, b.cat]));
let human = [];
for (const [id, t] of Object.entries(truth)) {
  if (!t.tex) { human.push({ id, why: t.needs_human }); continue; }
  const expC = canon(t.tex);
  const row = { id, cat: catOf[id], expected: t.tex, res: {} };
  // A1 — production as deployed (audit3 parser on the v5 page OCR).
  const pr = production(t);
  if (pr.text == null) row.res.A1_production = { res: "missing", why: pr.why, text: null, render: false };
  else {
    const strict = judge(expC, prodToTex(pr.text, false), pr.stem);
    const len = judge(expC, prodToTex(pr.text, true), pr.stem);
    const rend = prodRenders(pr.text);
    row.res.A1_production = { ...strict, text: pr.text, render: rend.ok, renderErr: rend.err, lenientExact: len.exact };
  }
  for (const [ap, out] of Object.entries(models)) {
    const o = out[id];
    if (!o) { row.res[ap] = { res: "missing" }; continue; }
    const j = judge(expC, o.tex, false);
    row.res[ap] = { ...j, text: o.tex, ms: o.ms, render: j.res !== "latex_error" };
  }
  for (const [ap, r] of Object.entries(row.res)) add(ap, row.cat, r);
  rows.push(row);
}

fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify({ rows, sums, human }, null, 1));
const aps = ["A1_production", ...Object.keys(models)];
const pct = (a, n) => n ? (100 * a / n).toFixed(0) + "%" : "-";
console.log(`scored ${rows.length} expressions; needs human: ${human.map((h) => h.id).join(", ")}`);
console.log("approach".padEnd(22), "exact".padStart(10), "structure".padStart(10), "renders".padStart(10));
for (const ap of aps) { const s = sums[ap + "|ALL"]; console.log(ap.padEnd(22), `${s.exact}/${s.n} ${pct(s.exact, s.n)}`.padStart(10), `${pct(s.skel, s.n)}`.padStart(10), `${s.render}/${s.present}`.padStart(10), `missing ${s.n - s.present}`); }
const lenient = rows.filter((r) => r.res.A1_production.lenientExact).length;
console.log(`A1 with "x"→× leniency: ${lenient}/${rows.length}`);
const cats = [...new Set(boxes.flatMap((b) => b.cat))];
console.log("\nexact by category:", "".padEnd(4), aps.map((a) => a.split("_")[0]).join("   "));
for (const c of cats) console.log(c.padEnd(16), String(sums["A1_production|" + c].n).padStart(3), aps.map((a) => pct(sums[a + "|" + c].exact, sums[a + "|" + c].n).padStart(5)).join(" "));
