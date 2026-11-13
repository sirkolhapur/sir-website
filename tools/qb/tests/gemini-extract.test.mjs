// node --test tools/qb/tests/gemini-extract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesToItems, setFromHeading, letterOf, openTail } from "../gemini-extract.mjs";

const ctx = { subject: "physics", chapter: "units-and-measurement", exam: [], sourceLabel: "RCC NEET Physics 11", questionSet: null,
  setLabels: { classwork: "Classwork", "pyq-neet": "Previous Year NEET MCQs" } };
const opts = (a, b, c, d) => [{ key: "(a)", text: a }, { key: "(b)", text: b }, { key: "(c)", text: c }, { key: "(d)", text: d }];

test("question sets from page headings", () => {
  assert.equal(setFromHeading("MCQs — Classwork"), "classwork");
  assert.equal(setFromHeading("Previous Year NEET MCQs"), "pyq-neet");
  assert.equal(setFromHeading("Previous Year AIIMS MCQs"), "pyq-aiims");
  assert.equal(setFromHeading("NCERT Unsolved"), "ncert-unsolved");
  assert.equal(setFromHeading("PREVIOUS YEAR JEE MCQS"), "pyq-jee-main");
  assert.equal(setFromHeading("Previous Year JEE Advanced Questions"), "pyq-jee-adv");
  assert.equal(setFromHeading("NCERT Exemplar"), "ncert-exemplar");
  assert.equal(setFromHeading("Assignment"), "assignment");
  assert.equal(setFromHeading(""), null);
  assert.equal(letterOf("(c)"), "C"); assert.equal(letterOf("3"), "C"); assert.equal(letterOf("x"), null);
});

test("full page: options, LaTeX kept, answer, topic, set tag, figure", () => {
  const items = pagesToItems([{ pageNo: 31, model: "gemini-test", result: { section_heading: "Classwork", questions: [
    { number: 1, type: "single", question: "The dimensional formula of $\\frac{1}{2}mv^2$ is", options: opts("$[ML^2T^{-2}]$", "$[MLT^{-2}]$", "$[ML^2T^{-1}]$", "$[M^0L^0T^0]$"),
      answer: "(a)", answer_printed: true, topic: "dimensions-of-some-units", subtopic: "none" },
    { number: 2, type: "single", question: "From the graph [Figure 1], the slope is", options: opts("1", "2", "3", "4"), answer: "", answer_printed: false,
      topic: "significant-figures", figures: [{ label: "1", box_2d: [100, 200, 300, 600] }] },
  ] } }], ctx);
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.draft.answer, "A");
  assert.deepEqual(a.draft.options.map((o) => o.key), ["A", "B", "C", "D"]);
  assert.match(a.draft.question, /\\frac\{1\}\{2\}mv\^2/);
  assert.equal(a.draft.topic, "dimensions-of-some-units");
  assert.equal(a.draft.subtopic, null);
  assert.deepEqual(a.draft.tags, ["set:classwork"]);
  assert.equal(a.draft.source, "book:RCC NEET Physics 11:Classwork:p.31:Q1");
  assert.equal(a.confidence, "high");
  assert.match(b.draft.question, /!\[Figure 1\]\(figure:1\)/);
  assert.deepEqual(b.draft.figures[0].box, [200, 100, 600, 300], "box_2d [ymin,xmin,ymax,xmax] → [x0,y0,x1,y1]");
  assert.ok(b.issues.some((x) => /No answer printed/.test(x)));
  assert.equal(b.confidence, "medium");
});

test("question split across pages is joined; answer key on a later page fills answers; PYQ set adds exam tag", () => {
  const p1 = { section_heading: "Previous Year NEET MCQs", questions: [
    { number: 7, type: "single", question: "A ball is thrown up with $u = 20\\,\\text{m s}^{-1}$. The", options: [], continues_on_next_page: true, topic: "motion-with-uniform-acceleration", exam_year: "NEET 2019" }] };
  const p2 = { section_heading: "", questions: [
    { number: 0, continued_from_previous_page: true, type: "single", question: "maximum height is", options: opts("10 m", "20 m", "30 m", "40 m"), topic: "motion-with-uniform-acceleration" },
    { number: 8, type: "multi", question: "Which are vectors?", options: opts("speed", "velocity", "displacement", "distance"), topic: "velocity" },
    { number: 9, type: "integer", question: "Find $x$.", topic: "acceleration" }] };
  const p3 = { page_kind: "answer_key", questions: [], answer_key: [{ number: 7, answer: "2" }, { number: 8, answer: "b, c" }, { number: 9, answer: "12" }] };
  assert.equal(openTail(p1), "A ball is thrown up with $u = 20\\,\\text{m s}^{-1}$. The");
  const items = pagesToItems([{ pageNo: 4, result: p1 }, { pageNo: 5, result: p2 }, { pageNo: 6, result: p3 }], { ...ctx, chapter: "motion-in-a-straight-line" });
  assert.equal(items.length, 3, "continued part is joined, not a new question");
  const [q7, q8, q9] = items;
  assert.match(q7.draft.question, /The\nmaximum height is/);
  assert.equal(q7.draft.options.length, 4);
  assert.equal(q7.source_location, "pages 4–5");
  assert.equal(q7.draft.answer, "B");
  assert.equal(q7.extracted.answer_source, "answer key, page 6");
  assert.deepEqual(q7.draft.exam, ["neet"]);
  assert.deepEqual(q7.draft.tags, ["set:pyq-neet", "year:2019"]);
  assert.deepEqual(q8.draft.answer, ["B", "C"]);
  assert.equal(q8.draft.type, "multi");
  assert.equal(q9.draft.answer, 12);
  assert.equal(q9.draft.options, null);
});

test("assertion–reason and match-the-columns become single-answer with a note; unsure readings are flagged", () => {
  const items = pagesToItems([{ pageNo: 2, result: { questions: [
    { number: 3, type: "assertion_reason", question: "**Assertion:** … **Reason:** …", options: opts("Both true, R explains A", "Both true, R does not explain A", "A true, R false", "A false, R true"), answer: "(c)", topic: "force" },
    { number: 4, type: "matrix_match", question: "| Column I | Column II |\n|---|---|", options: opts("A-p", "A-q", "A-r", "A-s"), answer: "D", topic: "force", uncertain: true, uncertain_reason: "smudged column II" }] } }],
    { ...ctx, chapter: "newtons-laws-of-motion", questionSet: "classwork" });
  assert.equal(items[0].draft.type, "single"); assert.equal(items[0].draft.answer, "C");
  assert.equal(items[1].draft.type, "single"); assert.equal(items[1].draft.answer, "D");
  assert.ok(items[1].issues.some((x) => /Match-the-columns/.test(x)));
  assert.ok(items[1].issues.some((x) => /unsure: smudged column II/.test(x)));
  assert.equal(items[1].confidence, "low");
  assert.deepEqual(items[0].draft.tags, ["set:classwork"], "chosen set wins over page headings");
});

test("short-answer questions: subjective type, text answer, separate parts become 22(i), 22(ii); column-less 'matrix' becomes subjective", () => {
  const items = pagesToItems([{ pageNo: 15, result: { section_heading: "", questions: [
    { number: 22, part: "i", type: "subjective", question: "Find the dimensions of linear momentum $(P)$", topic: "dimensions-of-some-units" },
    { number: 22, part: "(ii)", type: "subjective", question: "Find the dimensions of frequency $(f)$", topic: "dimensions-of-some-units" },
    { number: 24, type: "matrix_match", question: "Find the dimensions of Planck's constant $h$ from $E = h\nu$", options: [], topic: "dimensions-of-some-units" },
    { number: 30, type: "single", question: "Young's modulus of steel …", options: opts("1", "2", "3", "4"), answer: "", topic: "dimensions-of-some-units" },
  ] } }], ctx);
  assert.deepEqual(items.map((i) => i.source_number), ["22(i)", "22(ii)", "24", "30"]);
  assert.equal(items[0].draft.type, "subjective");
  assert.equal(items[0].draft.options, null);
  assert.equal(items[0].draft.source, "book:RCC NEET Physics 11:p.15:Q22(i)");
  assert.equal(items[1].extracted.part, "ii");
  assert.equal(items[2].draft.type, "subjective");
  assert.ok(items[2].issues.some((x) => /no columns were found — stored as a subjective question/.test(x)));
  assert.equal(items[3].draft.type, "single");
  const withKey = pagesToItems([{ pageNo: 1, result: { questions: [{ number: 5, type: "subjective", question: "Find …", answer: "$[MLT^{-2}]$", answer_printed: true, topic: "x" }] } }], ctx);
  assert.equal(withKey[0].draft.answer, "$[MLT^{-2}]$");
});

test("LaTeX written with single backslashes is repaired (frac → form feed, text/times → tab, nu → newline)", async () => {
  const { repairLatex } = await import("../gemini-extract.mjs");
  // exactly what JSON.parse makes of "\frac", "\text", "\times", "\beta", "\nu", "\right" written unescaped
  const broken = JSON.parse(String.raw`"($P = \text{mass} \times \text{velocity}$) $f = \frac{1}{T}$ $\beta$ $E = h\nu$ $\\left( x \right)$\nNext line"`);
  assert.equal(repairLatex(broken), String.raw`($P = \text{mass} \times \text{velocity}$) $f = \frac{1}{T}$ $\beta$ $E = h\nu$ $\left( x \right)$` + "\nNext line");
  assert.deepEqual(repairLatex({ a: [JSON.parse(String.raw`"$\frac{a}{b}$"`)], n: 3 }), { a: [String.raw`$\frac{a}{b}$`], n: 3 });
  assert.equal(repairLatex("Line one\nLine two"), "Line one\nLine two", "real newlines outside maths stay");
  const items = pagesToItems([{ pageNo: 1, result: JSON.parse(String.raw`{"questions": [{"number": 1, "type": "single", "question": "Find $\frac{1}{2}mv^2$", "options": [{"key": "A", "text": "$\times$"}, {"key": "B", "text": "b"}, {"key": "C", "text": "c"}, {"key": "D", "text": "d"}], "answer": "A", "topic": "t"}]}`) }], ctx);
  assert.equal(items[0].draft.question, String.raw`Find $\frac{1}{2}mv^2$`);
  assert.equal(items[0].draft.options[0].text, String.raw`$\times$`);
});

test("an MCQ read without any options becomes a subjective question with a warning", () => {
  const items = pagesToItems([{ pageNo: 1, result: { questions: [
    { number: 23, type: "single", question: "Find the dimensions of angular speed $(\omega)$", options: [], topic: "t" },
    { number: 24, type: "multi", question: "Find the dimensions of Planck's constant", options: [{ key: "a", text: "x" }], topic: "t" }] } }], ctx);
  assert.deepEqual(items.map((i) => i.draft.type), ["subjective", "subjective"]);
  assert.equal(items[0].draft.options, null);
  assert.equal(items[0].draft.negative, 0);
  assert.ok(items[0].issues.some((w) => /No answer choices were read — stored as a subjective/.test(w)));
  assert.ok(!items[0].issues.some((w) => /option\(s\) read/.test(w)));
});

test("test-series paper read for the whole subject: chapter/topic per question, institute set tag", () => {
  const items = pagesToItems([{ pageNo: 1, model: "m", result: { section_heading: "Narayana Grand Test 05", questions: [
    { number: 1, type: "single", question: "Orbital speed of a satellite …", options: opts("a", "b", "c", "d"), answer: "B", answer_printed: true, topic: "gravitation/orbital-velocity", subtopic: "none" },
    { number: 2, type: "integer", question: "Number of unpaired electrons in $\text{Fe}^{3+}$", answer: "5", answer_printed: true, topic: "", subtopic: "none" },
  ] } }], { ...ctx, chapter: null, questionSet: "ts-narayana", setLabels: { "ts-narayana": "Narayana Test Series" } });
  assert.equal(items[0].draft.chapter, "gravitation");
  assert.equal(items[0].draft.topic, "orbital-velocity");
  assert.deepEqual(items[0].draft.tags, ["pool:advanced"]);                 // institute never reaches the bank
  assert.ok(!/narayana/i.test(items[0].draft.source));
  assert.equal(items[0].draft.source, "test-series:p.1:Q1");
  assert.match(items[0].extracted.suggestion.basis, /whole subject/);
  assert.equal(items[1].draft.chapter, null);
  assert.ok(items[1].issues.some((x) => /No chapter chosen/.test(x)));
});

test("a test-series question that names an institute is flagged", () => {
  const items = pagesToItems([{ pageNo: 2, model: "m", result: { questions: [
    { number: 7, type: "single", question: "ALLEN Career Institute — A block slides …", options: opts("a", "b", "c", "d"), answer: "A", answer_printed: true, topic: "laws-of-motion/friction", subtopic: "none" } ] } }],
    { ...ctx, chapter: null, questionSet: "ts-allen", setLabels: { "ts-allen": "Allen Test Series" } });
  assert.ok(items[0].issues.some((x) => /institute's name/.test(x)));
  assert.deepEqual(items[0].draft.tags, ["pool:advanced"]);
});
