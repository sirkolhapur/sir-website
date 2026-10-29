// Math OCR prototype: pure parts (no helper, no browser).
//   node --test tools/qb/tests/math-ocr.test.mjs
// Tests that need KaTeX run when QB_KATEX points at a katex package
// (e.g. QB_KATEX=…/node_modules/katex); they are skipped otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cleanTex, findOptionMarkers, inkBox, mathRegions, decide } from "../math-ocr.mjs";
import { normalizeText, segmentQuestions } from "../pdf-parser.mjs";

const katex = process.env.QB_KATEX ? createRequire(import.meta.url)(process.env.QB_KATEX) : null;
const needKatex = katex ? {} : { skip: "set QB_KATEX to a katex package to run" };

test("cleanTex: exact rewrites only", () => {
  assert.equal(cleanTex("\\frac{q} {\\varepsilon_{_0}}"), "\\frac{q} {\\varepsilon_{0}}");
  assert.equal(cleanTex("\\frac{4 \\pi\\in_{\\mathrm{{}_{0}}} F}{e}"), "\\frac{4 \\pi\\in_{\\mathrm{{0}}} F}{e}");
  assert.equal(cleanTex("\\frac{Q} {8 \\epsilon_{\\mathrm{o}}}"), "\\frac{Q} {8 \\epsilon_{0}}");
  assert.equal(cleanTex("\\cfrac{Q}{6}"), "\\frac{Q}{6}");
  assert.equal(cleanTex("1 6 4 0 \\textrm{N m^{2} C^{-1}}"), "1640 \\mathrm{N\\,m^{2}\\,C^{-1}}");
  assert.equal(cleanTex("\\qquad\\bar{E}=E_{0}"), "\\bar{E}=E_{0}");
  // Letters that are not ε keep their subscript o; braces stay balanced.
  assert.equal(cleanTex("m_{o}"), "m_{o}");
  const b = (s) => [...s].reduce((n, c) => n + (c === "{") - (c === "}"), 0);
  for (const s of ["\\frac{1}{2}\\left(\\frac{q}{\\varepsilon_{_0}}-\\phi\\right)", "\\frac{Q}{6\\epsilon_{_0}}\\times10^{-3}"]) assert.equal(b(cleanTex(s)), 0);
});

test("stray OCR $ cannot pair with formula delimiters; Word math is kept", () => {
  const t = normalizeText('"$1.8 x 10⁻¹⁹ m', { ocrText: true });
  assert.equal(t, '"＄1.8 x $10^{-19}$ m');
  assert.equal((t.match(/\$/g) || []).length % 2, 0);
  assert.equal(normalizeText("$\\frac{1}{2}$"), "$\\frac{1}{2}$");
});

test("units are never turned into chemistry; real formulas still are", () => {
  assert.equal(normalizeText("1.36 x 10⁴ N m2 C₁"), "1.36 x $10^{4}$ N m2 $C_{1}$");
  assert.equal(normalizeText("J₂ dren"), "$J_{2}$ dren");
  assert.equal(normalizeText("H₂SO₄"), "$\\ce{H2SO4}$");
  assert.equal(normalizeText("Ca(OH)₂"), "$\\ce{Ca(OH)2}$");
  assert.equal(normalizeText("NH₃"), "$\\ce{NH3}$");
});

test("a lost negative power on a unit is flagged, not rewritten", () => {
  const page = { page: 1, width: 1000, height: 1400, source: "ocr", lines: [
    { text: "48. The electric flux through the sheet is", x0: 50, y0: 100, x1: 900, y1: 130, conf: 95 },
    { text: "a) 1.36 x 10² N m² C' b) 1.36 x 10⁴ N m² C₁", x0: 80, y0: 140, x1: 900, y1: 170, conf: 90 },
    { text: "c) 0.515 x 10² N m² C1 d) 0.515 x 10⁴ N m²", x0: 80, y0: 180, x1: 900, y1: 210, conf: 90 },
  ] };
  const { questions } = segmentQuestions([page]);
  assert.ok(questions[0].issues.some((i) => /negative power/.test(i)));
  assert.ok(!JSON.stringify(questions[0].draft).includes("\\\\ce"));
});

// Synthetic words for one question: stem line, options a) b) on one row,
// c) d) on the next.
const W = (text, x0, y0, x1, y1, conf = 95) => ({ text, x0, y0, x1, y1, conf });
const line = (words, extra = {}) => ({ page: 1, col: 0, text: words.map((w) => w.text).join(" "), words, x0: Math.min(...words.map((w) => w.x0)), y0: Math.min(...words.map((w) => w.y0)), x1: Math.max(...words.map((w) => w.x1)), y1: Math.max(...words.map((w) => w.y1)), hgt: 30, conf: 90, ...extra });
const qLines = [
  line([W("16.", 10, 100, 50, 130), W("Equal", 60, 100, 140, 130), W("charges", 150, 100, 260, 130), W("are", 270, 100, 320, 130), W("placed", 330, 100, 430, 130)]),
  line([W("a)", 60, 200, 90, 230), W("4rega'", 120, 200, 260, 230, 40), W("b)", 500, 200, 530, 230), W("dren?", 560, 200, 680, 230, 35)]),
  line([W("¢)", 60, 300, 90, 330), W("x", 120, 300, 140, 330, 50), W("d)", 500, 300, 530, 330), W("zero", 560, 300, 640, 330, 96)]),
];

test("option markers: strict letters, a ticked look-alike only in its gap, reading order", () => {
  const m = findOptionMarkers(qLines);
  assert.deepEqual(Object.keys(m).sort(), ["A", "B", "C", "D"]);
  assert.equal(m.C.lookalike, true);
  assert.equal(m.B.x0, 500);
  assert.ok(m.A.markEnd > 60 && m.A.markEnd <= 90);
});

test("regions: one per option, ending at the next marker on the row; prose options are skipped", () => {
  const q = { lines: qLines, draft: { options: ["A", "B", "C", "D"].map((key) => ({ key, text: "x" })) } };
  const r = mathRegions(q, { 1: { w: 1000, h: 1400 } });
  const a = r.options.find((o) => o.key === "A"), b = r.options.find((o) => o.key === "B");
  assert.ok(a.box[2] < 500 && a.box[0] > 85, `A ends before b): ${a.box}`);
  assert.ok(b.box[0] > 525);
  assert.ok(a.box[1] > 130, "region stays below the stem line");
  assert.equal(r.options.find((o) => o.key === "D").prose, true, "'zero' (confident word) is prose");
  assert.equal(a.prose, false, "OCR junk with low confidence is not prose");
});

test("a question without word geometry (text PDF / Word) gets no regions", () => {
  const q = { lines: [{ page: 1, text: "a) 1 b) 2", x0: 0, y0: 0, x1: 10, y1: 10 }], draft: { options: [{ key: "A", text: "1" }] } };
  assert.equal(mathRegions(q, {}).options.length, 0);
});

test("ink box joins a fraction's numerator and denominator but not the next row", () => {
  const Wd = 200, Hd = 300, g = new Uint8Array(Wd * Hd).fill(255);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * Wd + x] = 0; };
  ink(60, 80, 80, 100);   // numerator
  ink(40, 106, 120, 109); // bar (marker row)
  ink(50, 115, 110, 135); // denominator
  ink(40, 200, 150, 225); // next option row, far below
  const b = inkBox(g, Wd, Hd, [30, 40, 190, 290], 98, 118, 30);
  assert.deepEqual(b, [40, 80, 120, 135]);
});

test("decision: agreement → agreed; disagreement / unsure symbol / no render → flagged; prose → text", needKatex, () => {
  const r = (latex, min = 0.9) => ({ latex, min, mean: 0.95, ms: 1, truncated: false });
  assert.equal(decide([r("\\frac{q}{2 \\varepsilon_{0}}"), r("\\frac{q}{2\\varepsilon_0}"), r("{\\frac{q}{2\\varepsilon_{0}}}")], katex).status, "agreed");
  const d = decide([r("\\frac{cE}{m}"), r("\\frac{eE}{m}"), r("\\frac{cE}{m}")], katex);
  assert.equal(d.status, "uncertain"); assert.match(d.reasons.join(), /disagree/); assert.deepEqual(d.alternatives, ["\\frac{eE}{m}"]);
  assert.equal(decide([r("x^{2}", 0.3), r("x^{2}", 0.9), r("x^{2}", 0.9)], katex).status, "uncertain");
  assert.equal(decide([r("\\frac{1}{"), r("\\frac{1}{"), r("\\frac{1}{")], katex).status, "failed");
  assert.equal(decide([r("4\\,\\mathrm{N\\,(repulsive)}"), r("4\\,\\mathrm{N\\,(repulsive)}"), r("4\\,\\mathrm{N\\,(repulsive)}")], katex).status, "text");
  assert.equal(decide([{ ...r("\\alpha\\alpha"), truncated: true }, r("\\alpha"), r("\\alpha")], katex).status, "uncertain");
});
