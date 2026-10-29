// Regression tests for the extraction pipeline fixes of the RCC audit
// (missing / merged questions, answer-key false positives, question kinds,
// column rules, neighbouring-page strips, figure association).
// All fixtures here are SYNTHETIC: hand-written lines and generated pixel
// arrays that reproduce the failure patterns measured on the real scan. The
// real-scan check (303 printed questions) is tools/qb/tests/rcc-truth.test.mjs.
// Run:  node --test "tools/qb/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { findQuestionStarts, segmentQuestions, parseAnswerKey, questionKind, extractOptions } from "../pdf-parser.mjs";
import { findVerticalRules, eraseVerticalRules, otherColumnWords, edgeStrips, edgeBleed } from "../ocr-page.mjs";

// Lines of one column. A line is [text, indent]: indent 0 = the hanging
// question-number margin, 1 = body text (40 px right of it).
const H = 40, GAP = 15;
const col = (rows, { page = 1, col = 0, x = 100, y = 200 } = {}) =>
  rows.map(([text, indent = 1], i) => ({ text, page, col, x0: x + indent * 40, y0: y + i * (H + GAP), x1: x + 900, y1: y + i * (H + GAP) + H }));
const nums = (starts) => starts.map((s) => `${s.number}${s.assumed ? "?" : ""}`).join(" ");

test("start behind a stray prefix (other column / rule fragment) is found where the next number is expected", () => {
  const s = findQuestionStarts(col([["38. An electron is moving", 0], ["towards x-axis"], ["mly 39. At a point 20 cm from", 0], ["the centre of a sphere"], ["40. Three concentric shells", 0], ["of radii R"]]));
  assert.equal(nums(s), "38 39 40");
  assert.ok(s[1].loose);
});

test("column rule read as a digit in front of the number: 1111. → 111, 3126. → 26", () => {
  assert.equal(nums(findQuestionStarts(col([["110. A particle", 0], ["of mass m"], ["1111. A negatively charged oil drop", 0], ["is prevented"], ["112. Two point charges", 0], ["are 10 cm"]]))), "110 111 112");
  assert.equal(nums(findQuestionStarts(col([["25. In 1959, Lyttleton", 0], ["and Bondi"], ["3126. Consider a sphere of radius R", 0], ["with charge"], ["27. Two fixed plates", 0], ["of area"]]))), "25 26 27");
});

test("comma instead of the dot after the number (71, Consider…)", () => {
  assert.equal(nums(findQuestionStarts(col([["70. A ring of radius r", 0], ["carries Q"], ["71, Consider a neutral conducting sphere", 0], ["A positive charge"], ["72. A conductor has", 0], ["been given"]]))), "70 71 72");
});

test("a number that did not survive OCR ('. Assertion') on a hanging line becomes an assumed start; runs at a section end are recovered", () => {
  const s = findQuestionStarts(col([["26. Assertion : The Coulomb force dominates", 0], ["Reason : it is weaker than gravity"],
    ["27. Assertion : In a cavity the field is zero", 0], ["Reason : charges reside at the surface"],
    [". Assertion : Gauss's law shows diversion", 0], ["Reason : Gauss's law is a consequence"],
    [". Assertion : An electrostatic field line never forms", 0], ["closed loop. Reason : conservative field"]]));
  assert.equal(nums(s), "26 27 28? 29?");
});

test("a misread digit on a hanging line (04 for 94, 25 for 28) is assumed as the expected number", () => {
  assert.equal(nums(findQuestionStarts(col([["93. The charges on two spheres", 0], ["are +7 uC"], ["04. Two identical spheres carrying charges", 0], ["-9 uC and 5 uC"], ["95. Two charges of equal magnitude", 0], ["at a distance"]]))), "93 94? 95");
  assert.equal(nums(findQuestionStarts(col([["27. Four point charges", 0], ["are placed"], ["25. Three charges of equal magnitude", 0], ["q is placed"], ["29. A particle of mass", 0], ["is thrown"]]))), "27 28? 29");
});

test("negative: a number inside running text is never a start (no hanging layout)", () => {
  const s = findQuestionStarts(col([["5. A charge Q is divided", 0], ["into parts and the ratio is 6. Then the"], ["force is maximum"], ["6. Next question", 0], ["text"]]));
  assert.equal(nums(s), "5 6");
  assert.equal(s[1].index, 3);
});

test("negative: a stray '1.' of a neighbouring figure label does not start a question", () => {
  const s = findQuestionStarts(col([["8. Figure shows tracks", 0], ["(1) A (2) B"], ["9. Next", 0], ["text"]]));
  assert.equal(nums(s), "8 9");
});

test("a sentence ending in 'answer.' is not an answer-key heading; the rest of the document is kept", () => {
  const lines = col([["23. Figure shows field lines", 0], ["c) In which region could the field be zero? Justify your"], ["answer.", 1],
    ["24. Five charges q each are placed", 0], ["at the corners"], ["25. In 1959, Lyttleton and Bondi", 0], ["suggested"], ["26. Consider a sphere", 0], ["of radius R"]]);
  assert.equal(parseAnswerKey(lines).keyStart, -1);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  assert.deepEqual(questions.map((q) => q.number), [23, 24, 25, 26]);
});

test("a real answer key is still read", () => {
  const lines = col([["1. Q one", 0], ["a) x b) y c) z d) w"], ["2. Q two", 0], ["a) x b) y c) z d) w"], ["Answer Key", 0], ["1. (b) 2. (c) 3. (a) 4. (d) 5. (a) 6. (b)"]]);
  const k = parseAnswerKey(lines);
  assert.equal(k.keyStart, 4);
  assert.equal(k.answers[1], "B");
});

test("Assertion–Reason without printed options: type single, NO invented options, flagged", () => {
  const lines = col([["26. Assertion : The Coulomb force is dominating", 0], ["Reason : The Coulomb force is weaker than gravity"], ["27. Assertion : In a cavity the field is zero", 0], ["Reason : Charges reside at the surface"]]);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  assert.equal(questions.length, 2);
  for (const q of questions) {
    assert.equal(q.kind, "assertion_reason");
    assert.equal(q.draft.type, "single");
    assert.deepEqual(q.draft.options, []);
    assert.ok(q.issues.some((i) => /printed without options/.test(i)));
  }
});

test("two Assertion–Reason questions merged into one item are flagged", () => {
  const lines = col([["26. Assertion : A", 0], ["Reason : B"], ["Assertion : C"], ["Reason : D"]]);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  assert.ok(questions[0].issues.some((i) => /2 "Assertion" statements/.test(i)));
  assert.equal(questions[0].confidence, "low");
});

test("descriptive question: sub-questions a) b) are not options", () => {
  const raw = "The electrostatic force on a small sphere of charge 0.4 uC is 0.2 N.\na) What is the distance between two spheres?\nb) What is the force on the second sphere due to the first?";
  const o = extractOptions(raw);
  const k = questionKind(raw, o, "NCERT UNSOLVED");
  assert.equal(k.name, "descriptive");
  assert.ok(k.subparts);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines: col([["2. " + raw.split("\n")[0], 0], ...raw.split("\n").slice(1).map((t) => [t])]) }]);
  assert.equal(questions[0].draft.options, null);
  assert.ok(questions[0].issues.some((i) => /Descriptive question/.test(i)));
  assert.match(questions[0].draft.question, /a\) What is the distance/);
});

test("negative: a normal MCQ stays an MCQ with four options", () => {
  const raw = "The SI unit of electric flux is\na) N C-1 m2 b) N C m-2\nc) N C-2 m2 d) N C-1 m-2";
  const o = extractOptions(raw);
  assert.equal(o.found, 4);
  assert.equal(questionKind(raw, o, "CLASSWORK").name, "mcq");
});

test("a start-like hanging line left inside an item is reported (possible merged question)", () => {
  // "Two charges" hangs like a first line but its number is unreadable and
  // no rule recovers it (no options d) before it, no number-like token).
  const lines = col([["4. A rod lies along the x-axis", 0], ["with charge"], ["5. A charge is placed at the centre", 0], ["of a square"], ["(2) Two charges are kept apart", 0], ["at distance d"]]);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  assert.deepEqual(questions.map((q) => q.number), [4, 5]);
  assert.ok(questions[1].issues.some((i) => /look like the start of another question/.test(i)));
});

// ---------------- OCR stage (pure functions on synthetic pixels) ----------------
function page(w, h) { return new Uint8ClampedArray(w * h).fill(255); }
function ink(g, w, x0, y0, x1, y1) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = 20; }

test("a long, slightly tilted column rule is found and erased; text blocks are not rules", () => {
  const w = 600, h = 1000, g = page(w, h);
  // rule: x = 300 + 0.02·y, 3 px thick, y 50..950
  for (let y = 50; y < 950; y++) { const x = Math.round(300 + 0.02 * y); ink(g, w, x - 1, y, x + 2, y + 1); }
  // "text": short bars with line gaps, left and right of the rule
  for (let y = 60; y < 940; y += 40) { ink(g, w, 40, y, 260, y + 22); ink(g, w, 340, y, 560, y + 22); }
  const rules = findVerticalRules(g, w, h);
  assert.equal(rules.length, 1);
  const r = rules[0];
  assert.ok(Math.abs(r.a + r.b * 500 - 310) <= 4, `rule at ${r.a + r.b * 500}`);
  eraseVerticalRules(g, w, h, rules);
  assert.equal(g[500 * w + 310], 255);
  assert.equal(g[70 * w + 100], 20); // text untouched
});

test("other-column masks never cover a word of this column (box of 'uniformly' running over '39.')", () => {
  const rects = [{ left: 0, width: 1330, gutter: 1317 }, { left: 1300, width: 1032, gutter: 1317 }];
  const words = [
    { text: "uniformly", bbox: { x0: 1174, y0: 216, x1: 1446, y1: 250 } },   // left column, box too wide
    { text: "39.", bbox: { x0: 1390, y0: 211, x1: 1455, y1: 250 } },         // right column number
    { text: "At", bbox: { x0: 1477, y0: 215, x1: 1517, y1: 250 } },
  ];
  const m = otherColumnWords(words, rects, 1);
  assert.equal(m.length, 1);
  assert.ok(m[0].x1 < 1390, `mask ends at ${m[0].x1}`);
});

test("a strip of the neighbouring page at the image edge is found from the word boxes", () => {
  const w = 2332, h = 3300, rects = [{ left: 0, width: 1158 }, { left: 1140, width: 1192 }];
  const words = [];
  for (let i = 0; i < 12; i++) {
    const y = 600 + i * 55;
    words.push({ text: "configuration", bbox: { x0: 1290, y0: y, x1: 1700, y1: y + 40 } }, { text: "of", bbox: { x0: 1720, y0: y, x1: 2040, y1: y + 40 } });
    if (i < 8) words.push({ text: "shall", bbox: { x0: 2190, y0: y, x1: 2330, y1: y + 40 } });
  }
  const strips = edgeStrips(words, rects, w, h);
  assert.equal(strips.length, 1);
  assert.ok(strips[0].x0 > 2040 && strips[0].x0 <= 2190);
  // negative: a column whose own text runs to the edge is not a strip
  const own = words.filter((x) => x.text !== "shall").map((x) => ({ ...x, bbox: { ...x.bbox, x1: x.text === "of" ? 2330 : x.bbox.x1 } }));
  assert.equal(edgeStrips(own, rects, w, h).length, 0);
});

test("edge-bleed lines are separated from the page's own lines (kept for audit)", () => {
  const rects = [{ left: 0, width: 1158 }, { left: 1140, width: 1192 }];
  const lines = [{ col: 1, x0: 1290, x1: 2040, text: "configuration of" }, { col: 1, x0: 2186, x1: 2329, text: "In figure," }, { col: 1, x0: 2203, x1: 2330, text: "a) shall" }];
  const r = edgeBleed(lines, rects, 2332);
  assert.equal(r.keep.length, 1);
  assert.equal(r.bleed.length, 2);
});

// ---------------- Figures ----------------
test("diagram areas go to the question whose text is beside/above them, per column; two figures can belong to one question", () => {
  const left = col([["11. Three charges are placed", 0], ["at the vertices of a triangle"], ["as shown in the figure."], ["a) x b) y c) z d) w"], ["12. Two particles", 0], ["a) x b) y c) z d) w"]], { y: 100 });
  const right = col([["13. An electron moves", 0], ["in a field. See figure."], ["a) x b) y c) z d) w"]], { col: 1, x: 1100, y: 100 });
  const pages = [{ page: 1, width: 2000, height: 1500, source: "ocr", lines: [...left, ...right], figures: [
    { x0: 600, y0: 150, x1: 900, y1: 260, col: 0 },     // beside Q11's stem
    { x0: 600, y0: 262, x1: 900, y1: 310, col: 0 },     // a second figure of Q11
    { x0: 1500, y0: 160, x1: 1800, y1: 240, col: 1 },   // right column: Q13
  ] }];
  const { questions } = segmentQuestions(pages);
  const byNum = Object.fromEntries(questions.map((q) => [q.number, q.draft.figures.length]));
  assert.deepEqual(byNum, { 11: 2, 12: 0, 13: 1 });
  assert.ok(questions.every((q) => q.draft.figures.every((f) => f.proposed)));
});

// ---------------- Saved page data (re-segmentation without OCR) ----------------
test("a page's OCR lines are saved with positions and read back; left-out edge text stays in the readable record", async () => {
  const { pageRecordText, pageDataFromRecord, PARSER_VERSION } = await import("../pdf-parser.mjs");
  const pd = { page: 3, width: 2332, height: 3300, source: "ocr", columns: [{ left: 0, width: 1160 }], figures: [{ x0: 10, y0: 20, x1: 300, y1: 400, col: 0 }],
    lines: [{ text: "1. A charge", raw: "1. A charge", col: 0, conf: 91.5, x0: 100.4, y0: 200.6, x1: 900, y1: 240 }] };
  const rec = pageRecordText(pd, [{ text: "In figure,", x0: 2190, y0: 800, x1: 2330, y1: 840, reason: "outside the page's text area (neighbouring page in the photo)" }]);
  assert.match(rec, /^1\. A charge/);
  assert.match(rec, /Left out — outside the page's text area/);
  const back = pageDataFromRecord(rec);
  assert.equal(back.lines[0].text, "1. A charge");
  assert.equal(back.lines[0].x0, 100);
  assert.equal(back.figures.length, 1);
  assert.equal(back.parser, PARSER_VERSION);
  const { questions } = segmentQuestions([back]);
  assert.equal(questions.length, 1);
});

test("a skip ahead followed by the expected number is a misread (1, 2, 5, 4 → 1, 2, 3?, 4)", () => {
  const s = findQuestionStarts(col([["1. Under the influence", 0], ["a) x b) y"], ["2. A ball with charge", 0], ["a) x b) y"], ["5. Five balls numbered 1 to 5", 0], ["a) x b) y"], ["4. A charge Q is placed", 0], ["a) x b) y"]]));
  assert.equal(nums(s), "1 2 3? 4");
});

test("an MCQ whose four options end before a column break but which continues is flagged; regions are per column", () => {
  const left = col([["6. Number of electrons in -1 C of", 0], ["charge is"], ["a) 6 x 10^18 b) 1.6 x 10^19"], ["c) 6 x 10^19 d) 1.6 x 10^18"]], { y: 2700 });
  const right = col([["water.", 1], ["contains 250 g of water. Find the"], ["a) 1.34 C b) 1.34 C"], ["c) 2.43 C d) 2.43 C"], ["8. A polythene piece", 0], ["a) x b) y c) z d) w"]], { col: 1, x: 1100, y: 150 });
  const { questions } = segmentQuestions([{ page: 1, width: 2300, height: 3300, source: "ocr", lines: [...col([["5. A method", 0], ["a) x b) y c) z d) w"]], { y: 2500 }), ...left, ...right] }]);
  const q6 = questions.find((q) => q.number === 6);
  assert.equal(q6.regions.length, 2, "one box per column");
  assert.ok(q6.regions[1].box[0] > 400, "second box is in the right column");
  assert.ok(q6.issues.some((i) => /Continues after its four options into the next column/.test(i)));
  assert.equal(q6.confidence, "low");
});

test("negative: a question that legitimately continues into the next column (options after the break) is not flagged", () => {
  const left = col([["4. Five charges are fixed as shown.", 0], ["Which statement is correct?"], ["a) E on the LHS has a contribution from q1"]], { y: 2900 });
  const right = col([["b) E on the LHS from q2 and q4 only", 1], ["c) E from all charges"], ["d) Both E and q from q2, q4"], ["5. A point charge", 0], ["a) x b) y c) z d) w"]], { col: 1, x: 1100, y: 150 });
  const { questions } = segmentQuestions([{ page: 1, width: 2300, height: 3300, source: "ocr", lines: [...col([["3. The flux", 0], ["a) x b) y c) z d) w"]], { y: 2700 }), ...left, ...right] }]);
  const q4 = questions.find((q) => q.number === 4);
  assert.equal(q4.draft.options.length, 4);
  assert.ok(!q4.issues.some((i) => /Continues after its four options/.test(i)));
});

test("a garbled '3 )' before a new section's '1.' does not start the section (no silent loss of 1 and 2)", () => {
  const s = findQuestionStarts(col([["24. A hollow sphere", 0], ["a) x b) y c) z d) w"], ["25. A point charge", 0], ["3 ) Si, c) zero d) x", 0],
    ["1. It is possible to have a charged body", 0], ["a) x b) y c) z d) w"], ["2. A body can be negatively charged", 0], ["a) x"], ["4. The spatial distribution", 0], ["a) x"], ["5. Identify incorrect", 0], ["a) x"]]));
  assert.equal(s.map((x) => `${x.section}:${x.number}`).join(" "), "1:24 1:25 2:1 2:2 2:4 2:5");
});

test("negative: hanging question numbers at the very left edge of a tight photo are never dropped as a neighbouring page", () => {
  const rects = [{ left: 0, width: 1150 }, { left: 1130, width: 1200 }];
  const lines = [{ col: 0, x0: 20, x1: 110, text: "29." }, { col: 0, x0: 22, x1: 112, text: "30." }, { col: 0, x0: 150, x1: 1050, text: "A particle of mass" }];
  assert.equal(edgeBleed(lines, rects, 2332).bleed.length, 0);
});

test("negative: the page's own column of hanging numbers at the left edge is not a neighbouring-page strip", () => {
  const w = 2332, h = 3300, rects = [{ left: 0, width: 1150 }, { left: 1130, width: 1200 }];
  const words = [];
  for (let i = 0; i < 10; i++) {
    const y = 400 + i * 220;
    words.push({ text: `${26 + i}.`, bbox: { x0: 54, y0: y, x1: 120, y1: y + 40 } });
    for (let k = 0; k < 3; k++) words.push({ text: "charges", bbox: { x0: 150 + k * 300, y0: y + k * 55, x1: 400 + k * 300, y1: y + k * 55 + 40 } });
  }
  assert.equal(edgeStrips(words, rects, w, h).length, 0);
});

test("a short real answer key (3 entries) is read and not turned into a question", () => {
  const lines = col([["1. Q one", 0], ["a) x b) y c) z d) w"], ["2. Q two", 0], ["a) x b) y c) z d) w"], ["3. Q three", 0], ["a) x b) y c) z d) w"], ["Answer Key", 0], ["1. (b)"], ["2. (c)"], ["3. (a)"]]);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  assert.deepEqual(questions.map((q) => q.number), [1, 2, 3]);
  assert.deepEqual(questions.map((q) => q.draft.answer), ["B", "C", "A"]);
});

test("RCC p1 pattern: Q2's number read on Q1's c)/d) row — the row stays with Q1, Q2 keeps only its own text and options", () => {
  // Synthetic lines with the structure measured on the live job (the margin
  // pass glued "2." to Q1's last option row; a pen tick hid Q1's "a)").
  const lines = col([["1. There are two types of electric charges", 0], ["The property which differentiates them is"],
    ["a) field of charge b) amount of charge"], ["2. c) strength of charge d) polarity of charge", 1],
    ["What will happen when we rub a glass rod", 0], ["with silk cloth?"],
    ["a) electrons go to silk"], ["b) rod positive, silk negative"], ["c) new charge is created"], ["d) both a and b"],
    ["3. When a person combs his hair", 0], ["a) w b) x c) y d) z"]]);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  assert.deepEqual(questions.map((q) => q.number), [1, 2, 3]);
  const [q1, q2] = questions;
  assert.deepEqual(q1.draft.options.map((o) => o.key + ":" + o.text), ["A:field of charge", "B:amount of charge", "C:strength of charge", "D:polarity of charge"]);
  assert.match(q2.draft.question, /^What will happen when we rub a glass rod/);
  assert.ok(!/strength of charge|polarity of charge/.test(JSON.stringify(q2.draft)), "no Q1 text inside Q2");
  assert.deepEqual(q2.draft.options.map((o) => o.text), ["electrons go to silk", "rod positive, silk negative", "new charge is created", "both a and b"]);
  assert.ok(q1.issues.some((i) => /last option row/.test(i)) && q2.issues.some((i) => /read beside the previous question's option row/.test(i)));
});

test("an option letter hidden by a pen tick keeps the other options under their PRINTED letters (empty slot, never re-lettered)", () => {
  const o = extractOptions("The property is\n7 icld of charge b) amount of charge\nc) strength of charge d) polarity of charge");
  assert.deepEqual(o.options.map((x) => `${x.key}:${x.text}`), ["A:", "B:amount of charge", "C:strength of charge", "D:polarity of charge"]);
  assert.deepEqual(o.missing, ["A"]);
});

test("a stacked fraction read as broken fragments is flagged for retyping, never rebuilt into a guessed formula", () => {
  const lines = col([["34. The force per unit charge is", 0], ["a) flux b) field c) potential d) current"],
    ["35. Five equal charges are placed at the corners of a pentagon", 0], ["The electric field at the centre is"], ["q"], ["a b"], [") 4dnegr? dneqr?"], ["): dra d) zero"],
    ["36. In above question what is the field", 0], ["a) x b) y c) z d) w"]]).map((l) => (l.text.length <= 18 ? { ...l, conf: 40 } : l));
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: 2000, source: "ocr", lines }]);
  const q35 = questions.find((q) => q.number === 35);
  assert.ok(q35.issues.some((i) => /stacked formula/.test(i)));
  assert.equal(q35.confidence, "low");
  assert.ok(!/\\frac/.test(JSON.stringify(q35.draft)), "no fraction invented");
  assert.ok(!questions.find((q) => q.number === 34).issues.some((i) => /stacked formula/.test(i)));
});

test("notation: powers of ten, negative exponents, units, dimensions, chemistry and Greek bases convert exactly", async () => {
  const { normalizeText: n } = await import("../pdf-parser.mjs");
  assert.equal(n("1.6 × 10⁻¹⁹ C"), "1.6 × $10^{-19}$ C");
  assert.equal(n("2 × 10⁴ N/C"), "2 × $10^{4}$ N/C");
  assert.equal(n("m s⁻²"), "m $s^{-2}$");
  assert.equal(n("[M¹L³T⁻³A⁻¹]"), "[$M^{1}$$L^{3}$$T^{-3}$$A^{-1}$]");
  assert.equal(n("H₂SO₄"), "$\\ce{H2SO4}$");
  assert.equal(n("ε₀ and μ₀"), "$ε_{0}$ and $μ_{0}$");
  assert.equal(n("λ²"), "$λ^{2}$");
  // nothing guessed: an exponent OCR could not read stays visibly unresolved
  assert.equal(n("10^{[[?]]}"), "10^{[[?]]}");
});
