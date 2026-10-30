// Math OCR prototype: pure parts (no helper, no browser).
//   node --test tools/qb/tests/math-ocr.test.mjs
// Tests that need KaTeX run when QB_KATEX points at a katex package
// (e.g. QB_KATEX=…/node_modules/katex); they are skipped otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cleanTex, stripLabel, findOptionMarkers, inkBox, mathRegions, decide, markersFromInk } from "../math-ocr.mjs";

// Synthetic page: white, with ink rectangles.
const page = (W, H) => ({ W, H, g: new Uint8Array(W * H).fill(255), ink(x0, y0, x1, y1) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.g[y * W + x] = 0; return this; } });

test("option labels found from page pixels when the text reader read none (2×2 grid), a column rule does not merge the rows", () => {
  const p = page(1200, 700);
  p.ink(1, 0, 3, 700); // column rule / page edge on every row
  for (const [x, y] of [[100, 100], [600, 100], [100, 330], [600, 330]]) { p.ink(x, y + 20, x + 30, y + 60); p.ink(x + 60, y, x + 300, y + 110); } // "a)" + formula
  const m = markersFromInk(p.g, p.W, p.H, { x0: 0, x1: 1199, y0: 50, y1: 690, H: 50 });
  assert.deepEqual(Object.keys(m), ["A", "B", "C", "D"]);
  assert.equal(m.B.x0, 600); assert.equal(m.C.y0 > m.A.y0, true);
});

test("ink labels: anything other than a 2×2 grid or a column of four is rejected (no guessed options)", () => {
  const p = page(1200, 700);
  for (const [x, y] of [[100, 100], [600, 100], [100, 330]]) { p.ink(x, y + 20, x + 30, y + 60); p.ink(x + 60, y, x + 300, y + 110); }
  assert.deepEqual(markersFromInk(p.g, p.W, p.H, { x0: 0, x1: 1199, y0: 50, y1: 690, H: 50 }), {});
});

test("a speck of ink is never sent as a formula (RCC p.12 Q16 B was read as \\imath from a 23×35 px crop)", async () => {
  const { runMathOcr } = await import("../math-ocr.mjs");
  const W = 600, H = 300, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; } };
  ink(340, 205, 351, 213);            // B: a speck (11 × 8 px, as on RCC p.12 Q16 B)
  ink(470, 196, 492, 236);            // C: a single printed letter "F" (22 × 40 px) — a real option
  ink(560, 210, 576, 232);            // D: a lone lowercase "r" (16 × 22 px, RCC p.12 Q14 A) — a real option
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,AA==" }) };
  const canvas = { width: W, height: H, getContext: () => ({ getImageData: () => ({ data }) }) };
  const L = (words) => ({ page: 1, col: 0, text: words.map((w) => w.text).join(" "), words, x0: Math.min(...words.map((w) => w.x0)), y0: Math.min(...words.map((w) => w.y0)), x1: Math.max(...words.map((w) => w.x1)), y1: Math.max(...words.map((w) => w.y1)), hgt: 48, conf: 90 }); // RCC body line height ≈ 49 px
  const lines = [L([W_("5.", 10, 100, 40, 130), W_("Which", 50, 100, 150, 130), W_("charges", 160, 100, 280, 130), W_("placed", 290, 100, 400, 130)]), L([W_("a)", 20, 200, 45, 230), W_("x", 60, 200, 70, 230, 30), W_("b)", 300, 200, 325, 230), W_("c)", 450, 200, 475, 230), W_("d)", 520, 200, 545, 230)])];
  const q = { lines, issues: [], kind: "mcq", draft: { options: ["A", "B", "C", "D"].map((key) => ({ key, text: "?" })) } };
  let sent = 0;
  globalThis.fetch = async () => { sent++; return { ok: true, json: async () => ({ results: [] }) }; };
  await runMathOcr([q], [{ page: 1, width: W, height: H, lines }], { renderPage: async () => canvas, katex: null });
  const b = q.math.find((m) => m.key === "B");
  assert.equal(b.status, "failed"); assert.match(b.reasons.join(), /speck/); assert.ok(b.box, "the speck keeps its source box");
  assert.equal(q.draft.options.find((o) => o.key === "B").text, "?", "the OCR text is kept");
  assert.notEqual(q.math.find((m) => m.key === "C").reasons.join(), "the option area holds only a speck of ink — not read; check the page", "a single letter is not a speck");
  assert.ok(!/speck/.test(q.math.find((m) => m.key === "D").reasons.join()), "a lowercase letter is not a speck");
  assert.equal(sent, 1, "both letters were sent for reading (one batch)");
  delete globalThis.document; delete globalThis.fetch;
});
const W_ = (text, x0, y0, x1, y1, conf = 95) => ({ text, x0, y0, x1, y1, conf });

test("inkBox: a smaller gap allowance keeps a nearby row out (tight fallback crop)", () => {
  const p = page(300, 300);
  p.ink(40, 100, 200, 130);  // the option row
  p.ink(40, 142, 200, 170);  // the next row, 12 px below
  assert.ok(inkBox(p.g, p.W, p.H, [0, 60, 299, 220], 100, 130, 50)[3] >= 170, "default joins the row 12 px below");
  assert.ok(inkBox(p.g, p.W, p.H, [0, 60, 299, 220], 100, 130, 50, 0.12)[3] < 142, "tight stops before it");
});
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

test("region repair: the option's own label, a trailing exam year and an empty-base power are removed; real brackets stay", () => {
  assert.equal(stripLabel(") \\ -K \\frac{e^{2}}{r^{3}}"), "-K \\frac{e^{2}}{r^{3}}");
  assert.equal(stripLabel("\\mathrm{b )}\\ x^{2}"), "x^{2}");
  assert.equal(stripLabel("\\frac{Q} {6 \\epsilon_{0}} \\times10^{^{-3}} \\ \\ ( 2001 )"), "\\frac{Q} {6 \\epsilon_{0}} \\times10^{{-3}}");
  assert.equal(stripLabel("(a+b)^{2}"), "(a+b)^{2}");
  assert.equal(stripLabel("x(2+1)"), "x(2+1)");
});

test("an unreadable option letter is placed from the layout, as 'inferred'", () => {
  const lines = [
    line([W("2)", 60, 200, 85, 230, 69), W("Q=+2", 120, 200, 260, 230, 52), W("b)", 500, 200, 530, 230), W("Q=-2q", 560, 200, 680, 230, 10)]),
    line([W(")", 62, 300, 72, 330, 16), W("Q=2V2q", 120, 300, 260, 330, 1), W("d)", 500, 300, 530, 330), W("Q=-2V2", 560, 300, 680, 330, 13)]),
  ];
  const m = findOptionMarkers(lines);
  assert.equal(m.A.text, "2)"); assert.equal(m.A.inferred, true);
  assert.equal(m.C.text, ")"); assert.equal(m.C.inferred, true);
  assert.ok(!m.B.inferred && !m.D.inferred);
});

test("stray OCR $ cannot pair with formula delimiters; Word math is kept", () => {
  const t = normalizeText('"$1.8 x 10⁻¹⁹ m', { ocrText: true });
  assert.equal(t, '"＄1.8 x $10^{-19}$ m');
  assert.equal((t.match(/\$/g) || []).length % 2, 0);
  assert.equal(normalizeText("$\\frac{1}{2}$"), "$\\frac{1}{2}$");
  // The OCR step's own unreadable-exponent marker stays real math (42 RCC questions use it).
  assert.equal(normalizeText("4.2 x $10^{[[?]]}$ m", { ocrText: true }), "4.2 x $10^{[[?]]}$ m");
  assert.equal(normalizeText('"$1.8 x $10^{[[?]]4}$ m', { ocrText: true }), '"＄1.8 x $10^{[[?]]4}$ m');
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
  // A lost numerator read three times as \cdots is never "agreed" (RCC p.16 Q16 D).
  const lost = decide([r("\\frac{\\cdots}{\\pi\\varepsilon_{0}R}N/C"), r("\\frac{\\cdots}{\\pi\\varepsilon_{0}R}N/C"), r("\\frac{\\cdots}{\\pi\\varepsilon_{0}R}N/C")], katex);
  assert.equal(lost.status, "uncertain"); assert.match(lost.reasons.join(), /ellipsis/);
});
