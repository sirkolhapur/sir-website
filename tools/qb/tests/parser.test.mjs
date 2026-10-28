// Regression tests for the question parser (pure functions, no network).
// Cases come from the RCC Electrostatics scan that produced 250 items for
// ~300 questions. Run:  node --test tools/qb/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { findQuestionStarts, extractOptions, normalizeText, segmentQuestions, reconcileExtraction, UNREADABLE } from "../pdf-parser.mjs";
import { rebuildLine, exponentShape, readingOrder } from "../ocr-page.mjs";

// Lines start below the running-header band (top 7% of a 1000 px page).
const L = (texts) => texts.map((text, i) => ({ text, page: 1, x0: 10, y0: 100 + i * 20, x1: 500, y1: 100 + i * 20 + 15 }));
const nums = (starts) => starts.map((s) => `${s.section}:${s.number}${s.assumed ? "?" : ""}`).join(" ");

test("question numbers printed without a space after the dot (118.A charged…)", () => {
  const s = findQuestionStarts(L(["117. text", "a) x", "118.A charged particle", "a) x", "119.In the given figure", "120. Figures below"]));
  assert.equal(nums(s), "1:117 1:118 1:119 1:120");
});

test("a decimal is never a question number", () => {
  const s = findQuestionStarts(L(["5. Text", "1.34 x 10 C", "6. Next"]));
  assert.equal(nums(s), "1:5 1:6");
});

test("new section whose '1.' is unreadable still starts a section", () => {
  const s = findQuestionStarts(L(["128. a", "129. b", "Under the influence…", "2. A ball", "3. Five balls", "4. A charge", "5. Two"]));
  assert.equal(nums(s), "1:128 1:129 2:2 2:3 2:4 2:5");
  assert.equal(s[2].skipped, 1);
});

test("restart at 1 begins a new section", () => {
  const s = findQuestionStarts(L(["40. a", "41. b", "1. c", "2. d", "3. e"]));
  assert.equal(nums(s), "1:40 1:41 2:1 2:2 2:3");
});

test("a stray '1' inside a section is not a restart", () => {
  const s = findQuestionStarts(L(["10. a", "1) figure label", "11. b", "12. c"]));
  assert.equal(nums(s), "1:10 1:11 1:12");
});

test("a misread number in the sequence is assumed and flagged (193 between 92 and 94)", () => {
  const s = findQuestionStarts(L(["92. a", "193. b", "94. c", "95. d"]));
  assert.equal(nums(s), "1:92 1:93? 1:94 1:95");
  assert.equal(s[1].readAs, 193);
});

test("options: ticks over the letter, look-alikes, missing space", () => {
  const r = extractOptions("The number\na) 2.5 x 10 _p)15 x 10\nc) 1.5 x 10 dy 2.5 x 10");
  assert.deepEqual(r.options.map((o) => o.text), ["2.5 x 10", "15 x 10", "1.5 x 10", "2.5 x 10"]);
});

test("options: three markers read → the fourth is reported, never invented", () => {
  const r = extractOptions("Q\na) one b) two\nc) three four");
  assert.equal(r.options.length, 3);
  assert.deepEqual(r.missing, ["D"]);
});

test("options out of order on a curved scan are matched by letter and flagged", () => {
  const r = extractOptions("A cup\nb) 1.34 x 10⁷ C\na) 1.34 x 10¹⁹ C\nd) 2.43 x 10⁷ C\nc) 2.43 x 10¹⁹ C");
  assert.equal(r.reordered, true);
  assert.deepEqual(r.options.map((o) => `${o.key}:${o.text}`), ["A:1.34 x 10¹⁹ C", "B:1.34 x 10⁷ C", "C:2.43 x 10¹⁹ C", "D:2.43 x 10⁷ C"]);
});

test("'(a) and (b)' inside the stem are not options", () => {
  const r = extractOptions("Find (a) and (b) in the figure\na) x b) y c) z d) w");
  assert.equal(r.stem, "Find (a) and (b) in the figure");
  assert.equal(r.options.length, 4);
});

test("'by' starting an ordinary text line is not option b)", () => {
  const r = extractOptions("Two balls are hung\nby strings of equal length\na) one b) two c) three d) four");
  assert.match(r.stem, /by strings/);
});

test("two sets of options in one item are reported as merged", () => {
  const r = extractOptions("Q1\na) x b) y c) z d) w\nNext question text\na) p b) q c) r d) s");
  assert.equal(r.secondSet, true);
});

test("Unicode exponents become LaTeX exactly", () => {
  assert.equal(normalizeText("1.6 x 10⁻¹⁹ C"), "1.6 x $10^{-19}$ C");
});

// --- exponent reconstruction from character geometry ---
const sym = (text, x0, y0, x1, y1, confidence = 95) => ({ text, bbox: { x0, y0, x1, y1 }, confidence });
const line = (words) => ({ baseline: { x0: 0, y0: 100, x1: 1000, y1: 100 }, bbox: { x0: 0, y0: 60, x1: 1000, y1: 100 }, words });

test("'× 10' + raised run becomes a placeholder for the pixel check", () => {
  const l = line([
    { text: "6", symbols: [sym("6", 0, 60, 25, 100)] },
    { text: "x", symbols: [sym("x", 40, 75, 60, 100)] },
    { text: "10%", symbols: [sym("1", 70, 60, 85, 100), sym("0", 88, 60, 113, 100), sym("%", 116, 50, 140, 72, 40)] },
    { text: "C", symbols: [sym("C", 160, 60, 185, 100)] },
  ]);
  const r = rebuildLine(l);
  assert.equal(r.exps.length, 1);
  assert.equal(r.exps[0].digits, null); // "%" is not a number: must be checked on the page
  assert.match(r.text, /^6 x 10\u00010\u0002 C$/);
});

test("raised digits after a letter become a superscript; degree signs are kept", () => {
  const r = rebuildLine(line([
    { text: "ms-2", symbols: [sym("m", 0, 75, 25, 100), sym("s", 27, 75, 45, 100), sym("-", 47, 58, 55, 62), sym("2", 57, 50, 67, 72)] },
    { text: "60°", symbols: [sym("6", 100, 60, 125, 100), sym("0", 127, 60, 152, 100), sym("°", 154, 55, 164, 68)] },
  ]));
  assert.equal(r.text, "ms⁻² 60°");
});

// Synthetic page: a "0" (ring) + optional dash + exponent digit blocks.
function page({ dash, digits = 2, fused = false }) {
  const W = 220, H = 120, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * W + x) * 4] = 0; };
  ink(20, 40, 60, 46); ink(20, 94, 60, 100); ink(20, 40, 26, 100); ink(54, 40, 60, 100); // the 0 (x 20–60, y 40–100)
  if (dash) ink(fused ? 60 : 64, 47, 80, 51);
  for (let i = 0; i < digits; i++) ink(84 + i * 22, 30, 100 + i * 22, 64);
  return { data, width: W, height: H };
}
const E = { baseBox: { x0: 20, y0: 40, x1: 60, y1: 100 }, runBox: { x0: 84, y0: 30, x1: 128, y1: 64 }, H: 60 };

test("exponent sign: a separate dash before the digits is a minus", () => {
  assert.deepEqual([exponentShape(page({ dash: true }), E).sign, exponentShape(page({ dash: true }), E).digits], ["minus", 2]);
});
test("exponent sign: a dash fused to the 0 is still a minus", () => {
  assert.equal(exponentShape(page({ dash: true, fused: true }), E).sign, "minus");
});
test("exponent sign: clean paper before the digits means no sign", () => {
  assert.equal(exponentShape(page({ dash: false }), E).sign, "none");
});
test("exponent digit count comes from the page, not the OCR text", () => {
  assert.equal(exponentShape(page({ dash: false, digits: 1 }), E).digits, 1);
});

test("pieces of one row are read left to right even if the right piece is higher", () => {
  const o = readingOrder([{ text: "b)", x0: 600, y0: 95, x1: 900, y1: 140 }, { text: "a)", x0: 0, y0: 110, x1: 300, y1: 155 }, { text: "next", x0: 0, y0: 170, x1: 300, y1: 215 }]);
  assert.deepEqual(o.map((l) => l.text), ["a)", "b)", "next"]);
});

// --- whole-page segmentation + reconciliation ---
test("segmenter: sections, unreadable exponents flagged, no answer invented, difficulty not guessed", () => {
  const lines = L(["28. A charge of 2 x $10^{[[?]]}$ C is placed", "a) 1 N b) 2 N", "c) 3 N d) 4 N", "29. Next one", "a) x b) y c) z d) w",
    "30. Third", "a) x b) y c) z d) w", "2. Section two starts with an unreadable 1", "a) x b) y c) z d) w", "3. Another", "a) x b) y c) z d) w",
    "4. And another", "a) x b) y c) z d) w"]);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 1000, source: "ocr", lines }], {});
  assert.deepEqual(questions.map((q) => `${q.section_no}:${q.number}`), ["1:28", "1:29", "1:30", "2:2", "2:3", "2:4"]);
  assert.ok(questions[0].issues.some((s) => s.includes(UNREADABLE)));
  assert.ok(questions.every((q) => q.draft.answer === null && q.draft.difficulty === null));
  assert.ok(questions[0].issues.some((s) => /has no answer key/.test(s)));
  const r = reconcileExtraction(questions.map((q) => ({ ...q, question: q.draft.question, options: q.draft.options, type: q.draft.type, figures: q.draft.figures })), [{ page_no: 1, status: "done" }]);
  assert.deepEqual(r.sections.map((s) => [s.section, s.highest, s.missing.join(",")]), [[1, 30, "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27"], [2, 4, "1"]]);
  assert.equal(r.uncertain_math.length, 1);
});

test("segmenter: detected diagram areas are proposals attached to the right question", () => {
  const lines = L(["1. In the figure shown", "a) x b) y c) z d) w", "2. Plain question", "a) x b) y c) z d) w"]);
  const figures = [{ x0: 600, y0: 122, x1: 900, y1: 138 }]; // beside question 1's option line
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 1000, source: "ocr", lines, figures }], {});
  assert.equal(questions[0].draft.figures.length, 1);
  assert.equal(questions[0].draft.figures[0].proposed, true);
  assert.equal(questions[1].draft.figures.length, 0);
});

test("figure labels (1), (3) inside a section are not a new section", () => {
  const s = findQuestionStarts(L(["119. In the given figure", "120. Figures below show", "(1) hexagon", "(3) hexagon", "121. An electron", "122. Next"]));
  assert.deepEqual(s.map((x) => x.section), [1, 1, 1, 1]);
  assert.equal(nums(s), "1:119 1:120 1:121 1:122");
});
