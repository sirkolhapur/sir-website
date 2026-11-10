// node --test tools/qb/tests/ai-solve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySolution, normAnswer, solveBatches, toSolveQuestion, MAX_PER_CALL } from "../ai-solve.mjs";

const opts = [{ key: "A", text: "Time" }, { key: "B", text: "Mass" }, { key: "C", text: "Distance" }, { key: "D", text: "Energy" }];
const item = (draft, extra = {}) => ({ id: "i1", page_no: 1, extracted: { page_from: 1 }, issues: [], blocking_issues: [], ...extra, draft: { type: "single", options: opts, answer: null, tags: ["set:classwork"], hint: null, solution: null, ...draft } });
const sol = (answer, more = {}) => ({ ref: "i1", approach: "Light year is the distance light travels in one year.", solution: "1. $1\\,\\text{ly} = c \\times 1\\,\\text{yr}$\n2. So it is a distance.", answer, option_notes: [{ key: "A", note: "Year is time, light year is not." }], confidence: "high", ...more });

test("answers are normalised to option letters / numbers", () => {
  assert.equal(normAnswer("single", "(c)"), "C");
  assert.equal(normAnswer("single", "Option B"), "B");
  assert.equal(normAnswer("single", "A, C"), null, "two letters is not a single answer");
  assert.deepEqual(normAnswer("multi", "c and a"), ["A", "C"]);
  assert.equal(normAnswer("single", "E"), null, "not one of the options");
  assert.equal(normAnswer("numerical", "≈ 9.8 m/s²"), 9.8);
  assert.equal(normAnswer("integer", "−3"), -3);
});

test("the function is never sent the answer", () => {
  const q = toSolveQuestion(item({ answer: "C", question: "Light year is unit of" }));
  assert.deepEqual(Object.keys(q).sort(), ["options", "question", "ref", "type", "unit"]);
});

test("no book answer + two agreeing blind solutions → AI answer filled, blocking confirm warning, approach + solution written", () => {
  const it = item({}, { issues: ["No answer printed on these pages — add the correct answer before verifying"] });
  const r = applySolution(it, { a: sol("C"), b: sol("(c)"), model: "gemini-x" });
  assert.equal(r.draft.answer, "C");
  assert.equal(r.ai.answer_from_ai, true);
  assert.match(r.blocking[0], /^AI: Answer C was suggested by AI \(two independent solutions agree\)/);
  assert.match(r.draft.hint, /distance light travels/);
  assert.match(r.draft.solution, /Why the other options are wrong\*\*\n- \*\*A\*\*: Year is time/);
  assert.deepEqual(r.draft.tags.sort(), ["ai:answer", "ai:solution", "set:classwork"]);
  assert.ok(!r.issues.some((w) => /^No answer printed/.test(w)), "the 'no answer' warning is replaced");
});

test("two blind solutions disagree → no answer set, blocking warning", () => {
  const r = applySolution(item({}), { a: sol("C"), b: sol("D"), model: "m" });
  assert.equal(r.draft.answer, null);
  assert.match(r.blocking[0], /two different answers \(C and D\)/);
  assert.ok(!r.draft.tags.includes("ai:answer"));
});

test("book answer kept; AI disagreeing is a blocking warning; agreeing adds nothing blocking", () => {
  const bad = applySolution(item({ answer: "B" }), { a: sol("C"), model: "m" });
  assert.equal(bad.draft.answer, "B");
  assert.match(bad.blocking[0], /AI's answer \(C\) differs from the book's answer \(B\)/);
  const good = applySolution(item({ answer: "C" }), { a: sol("C"), model: "m" });
  assert.deepEqual(good.blocking, []);
  assert.equal(good.draft.answer, "C");
  assert.ok(!good.draft.tags.includes("ai:answer"));
});

test("re-run replaces old AI warnings and the old AI answer counts as no book answer; human text is kept", () => {
  const first = applySolution(item({}), { a: sol("C"), b: sol("C"), model: "m" });
  const it2 = item(first.draft, { extracted: { page_from: 1, ai: first.ai }, issues: first.issues });
  const second = applySolution(it2, { a: sol("D"), b: sol("D"), model: "m" });
  assert.equal(second.draft.answer, "D", "earlier AI answer is not treated as the book's");
  assert.equal(second.issues.filter((w) => /suggested by AI/.test(w)).length, 1);
  const human = applySolution(item({ solution: "My own worked solution", hint: "My approach" }), { a: sol("C"), b: sol("C"), model: "m" });
  assert.equal(human.draft.solution, "My own worked solution");
  assert.equal(human.draft.hint, "My approach");
  assert.ok(human.issues.some((w) => /already written/.test(w)));
});

test("unsure AI and numerical tolerance", () => {
  const r = applySolution(item({}), { a: sol("C", { confidence: "low", doubt: "option C looks mis-typed" }), b: sol("C"), model: "m" });
  assert.ok(r.issues.some((w) => /AI was not sure: option C looks mis-typed/.test(w)));
  const n = applySolution(item({ type: "numerical", options: null, answer: null }), { a: sol("9.80"), b: sol("9.81"), model: "m" });
  assert.equal(n.draft.answer, 9.8, "within 1 % counts as agreeing");
});

test("difficulty: filled when empty or set by AI before, never over a person's choice", () => {
  const r = applySolution(item({ difficulty: null }), { a: sol("C", { difficulty: "2", difficulty_reason: "recall" }), b: sol("C"), model: "m" });
  assert.equal(r.draft.difficulty, 2);
  assert.equal(r.ai.difficulty, 2);
  assert.ok(r.issues.some((w) => /difficulty 2 \(Easy\) set by AI/.test(w)));
  const again = applySolution(item(r.draft, { extracted: { page_from: 1, ai: r.ai }, issues: r.issues }), { a: sol("C", { difficulty: "4" }), b: sol("C"), model: "m" });
  assert.equal(again.draft.difficulty, 4, "earlier AI level is replaced");
  const human = applySolution(item({ difficulty: 3 }), { a: sol("C", { difficulty: "5" }), b: sol("C"), model: "m" });
  assert.equal(human.draft.difficulty, 3);
  assert.equal(human.ai.difficulty, null);
});

test("batches: grouped by page, at most MAX_PER_CALL each", () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ id: `q${i}`, page_no: i < 10 ? 1 : 2, extracted: { page_from: i < 10 ? 1 : 2 } }));
  const b = solveBatches(items);
  assert.deepEqual(b.map((x) => [x.page, x.items.length]), [[1, MAX_PER_CALL], [1, 10 - MAX_PER_CALL], [2, 6]]);
});
