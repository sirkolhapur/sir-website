// =====================================================================
// AI answer, approach and worked solution for Review & Edit items.
//
// The Edge Function qb-ai-solve solves questions blind (it never sees the
// book's answer). This module decides what to do with its answers:
//   * book answer printed → keep it; a different AI answer is a blocking
//     warning (catches book typos, mis-read options and AI mistakes alike);
//   * no book answer → the question is solved twice independently; if both
//     agree, the answer is filled in as "suggested by AI" — still a blocking
//     warning the coordinator must tick; if they disagree, no answer is set.
// The approach goes to draft.hint, the worked solution (plus why each wrong
// option is wrong) to draft.solution. Human-written text is never replaced.
// Subjective (short-answer) questions get a text answer and, from the AI,
// a separate single-correct MCQ version (mcqVersion) for online tests.
// Difficulty (1–5; 1–2 easy, 3 medium, 4–5 hard) is filled when empty or
// set by an earlier AI run. Every AI warning starts with "AI: " so a re-run
// replaces the old ones.
// =====================================================================
import { repairLatex } from "./gemini-extract.mjs";
export const AI_SOLVE_VERSION = "ai-solve-1";
export const MAX_PER_CALL = 7;
const AI = "AI: ";
const OPT_TYPES = new Set(["single", "multi"]);

export function normAnswer(type, raw, optionKeys = ["A", "B", "C", "D"]) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (type === "subjective") return s;
  if (OPT_TYPES.has(type)) {
    const letters = [...new Set((s.toUpperCase().replace(/\bAND\b/g, ",").match(/\b[A-F]\b/g) || []))].filter((l) => optionKeys.includes(l)).sort();
    if (!letters.length) return null;
    return type === "single" ? (letters.length === 1 ? letters[0] : null) : letters;
  }
  const n = s.replace(/[−–]/g, "-").match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i);
  return n ? Number(n[0]) : null;
}

// "$[ML^2T^{-1}]$" and "[M L^{2} T^{-1}]" are the same written answer.
const squash = (t) => String(t).toLowerCase().replace(/\\(text|mathrm|rm|left|right|,|;|!|\s)/g, "").replace(/[\s${}]/g, "").replace(/\\cdot|\\times|×|·|\*/g, "");
export function sameAnswer(type, a, b, tolerance = 0) {
  if (a == null || b == null) return false;
  if (type === "subjective") return squash(a) === squash(b);
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify([].concat(a).sort()) === JSON.stringify([].concat(b).sort());
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(Number(tolerance) || 0, Math.abs(b) * 0.01, 1e-9);
  return String(a) === String(b);
}
export const LEVEL_NAME = (n) => (n == null ? "—" : n <= 2 ? "Easy" : n === 3 ? "Medium" : "Hard");
export const showAnswer = (a) => (a == null ? "—" : Array.isArray(a) ? a.join(", ") : String(a));

// What the function is sent: never the answer.
export function toSolveQuestion(item) {
  const d = item.draft || {};
  return { ref: item.id, type: d.type || "single", question: d.question || "", options: OPT_TYPES.has(d.type) ? (d.options || []).map((o) => ({ key: o.key, text: o.text })) : null, unit: d.type === "subjective" ? null : d.unit || null };
}

// The answer printed in the book (not one an earlier AI run filled in).
export const bookAnswerOf = (item) => (item.extracted?.ai?.answer_from_ai ? null : item.draft?.answer ?? null);

// Calls per page (the page image goes with them), at most MAX_PER_CALL each.
export function solveBatches(items) {
  const byPage = new Map();
  for (const it of items) {
    const p = it.extracted?.page_from ?? it.page_no ?? null;
    if (!byPage.has(p)) byPage.set(p, []);
    byPage.get(p).push(it);
  }
  const out = [];
  for (const [page, list] of byPage) for (let i = 0; i < list.length; i += MAX_PER_CALL) out.push({ page, items: list.slice(i, i + MAX_PER_CALL) });
  return out;
}

function solutionText(sol, type) {
  let text = String(sol?.solution || "").trim();
  const notes = OPT_TYPES.has(type) ? (sol?.option_notes || []).filter((n) => n?.key && String(n.note || "").trim()) : [];
  if (notes.length) text += `\n\n**Why the other options are wrong**\n${notes.map((n) => `- **${String(n.key).replace(/[^A-F]/gi, "").toUpperCase() || n.key}**: ${String(n.note).trim()}`).join("\n")}`;
  return text || null;
}

const LETTERS = ["A", "B", "C", "D"];
const letter = (v) => { const m = String(v ?? "").toUpperCase().match(/\b([A-D])\b/); return m ? m[1] : null; };
// A single-correct MCQ made by the AI from a subjective question, or null
// when its options are unusable (not four, empty or repeated, answer not A–D).
export function mcqVersion(draft, mcq, model) {
  const opts = (mcq?.options || []).map((o, i) => ({ key: letter(o?.key) || LETTERS[i], text: String(o?.text ?? "").trim() }));
  const ans = letter(mcq?.answer);
  if (opts.length !== 4 || opts.some((o) => !o.text) || new Set(opts.map((o) => o.key)).size !== 4 || new Set(opts.map((o) => o.text)).size !== 4 || !ans) return null;
  opts.sort((x, y) => x.key.localeCompare(y.key));
  const notes = (mcq.option_notes || []).filter((n) => letter(n?.key) && letter(n.key) !== ans && String(n.note || "").trim());
  const tags = [...new Set([...(draft.tags || []).filter((t) => t !== "ai:answer"), "ai:mcq-options", "ai:answer"])];
  return {
    draft: { ...structuredClone(draft), type: "single", question: String(mcq.question || "").trim() || draft.question, options: opts, answer: ans, unit: null, tolerance: 0,
      marks: 4, negative: 1, tags, solution: [draft.solution, notes.length ? `**Why the other options are wrong**\n${notes.map((n) => `- **${letter(n.key)}**: ${String(n.note).trim()}`).join("\n")}` : null].filter(Boolean).join("\n\n") || null },
    issues: [`AI: MCQ version made by AI (${model}) from a short-answer question — its options were written by AI: check that exactly one option (${ans}) is correct and the other three are wrong`],
  };
}

// item: { id, draft, extracted, issues, blocking_issues }
// a, b: solutions from two blind runs (b may be null), model, at: ISO time.
// → { draft, ai, issues, blocking } ready for qb_ai_apply_solution.
export function applySolution(item, { a: rawA, b: rawB = null, model, at = new Date().toISOString() }) {
  const a = repairLatex(rawA), b = repairLatex(rawB);
  const prev = item.extracted?.ai || null;
  const d = structuredClone(item.draft || {});
  const type = d.type || "single";
  const keys = (d.options || []).map((o) => o.key);
  const book = bookAnswerOf(item);
  const A = normAnswer(type, a?.answer, keys), B = b ? normAnswer(type, b.answer, keys) : null;
  const blocking = [], notes = [];
  let answerFromAi = false;

  if (book != null && !(Array.isArray(book) && !book.length)) {
    if (A == null) notes.push(`${AI}AI could not reach one of the options${a?.doubt ? ` (${a.doubt})` : ""} — check the question and the book's answer`);
    else if (!sameAnswer(type, A, book, d.tolerance)) blocking.push(`${AI}AI's answer (${showAnswer(A)}) differs from the book's answer (${showAnswer(book)}) — re-check the question, the options and the answer key before verifying`);
  } else if (A != null && (b == null || sameAnswer(type, A, B, d.tolerance))) {
    d.answer = A; answerFromAi = true;
    blocking.push(`${AI}Answer ${showAnswer(A)} was suggested by AI (${b ? "two independent solutions agree" : "solved once"}) — confirm it is correct before verifying`);
  } else if (A != null && B != null) {
    d.answer = prev?.answer_from_ai ? null : d.answer;
    blocking.push(`${AI}AI gave two different answers (${showAnswer(A)} and ${showAnswer(B)}) — work it out and set the answer yourself`);
  } else {
    if (prev?.answer_from_ai) d.answer = null;
    blocking.push(`${AI}AI could not find an answer${a?.doubt ? ` (${a.doubt})` : ""} — work it out and set the answer yourself`);
  }
  for (const s of [a, b]) if (s && s.confidence && s.confidence !== "high" && s.doubt) notes.push(`${AI}AI was not sure: ${String(s.doubt).slice(0, 200)}`);

  // Approach / solution: fill only empty fields or ones an earlier AI run wrote.
  const aiWrote = (field) => prev && (prev[field] || "") === (item.draft?.[field] || "");
  const sol = solutionText(a, type), approach = String(a?.approach || "").trim() || null;
  if (approach && (!d.hint || aiWrote("hint"))) d.hint = approach;
  if (sol && (!d.solution || aiWrote("solution"))) d.solution = sol;
  if (d.solution !== sol && sol) notes.push(`${AI}A solution was already written, so the AI solution was not used`);
  const lv = Math.round(Number(a?.difficulty));
  const level = lv >= 1 && lv <= 5 ? lv : null;
  if (level && (d.difficulty == null || (prev && prev.difficulty === item.draft?.difficulty))) d.difficulty = level;
  const wroteLevel = level != null && d.difficulty === level;
  if (d.solution === sol || d.hint === approach || wroteLevel) notes.push(`${AI}${[d.solution === sol || d.hint === approach ? "Approach and solution" : null, wroteLevel ? `difficulty ${level} (${LEVEL_NAME(level)})` : null].filter(Boolean).join(" and ")} set by AI (${model}) — read them before verifying`);

  const tags = new Set((d.tags || []).filter((t) => t !== "ai:answer"));
  if (d.solution === sol || d.hint === approach) tags.add("ai:solution");
  if (answerFromAi) tags.add("ai:answer");
  d.tags = [...tags];

  // Old AI warnings go; "no answer printed" goes once AI has filled an answer.
  const kept = (item.issues || []).filter((w) => !w.startsWith(AI) && !(answerFromAi && /^No answer printed/.test(w)));
  const ai = {
    version: AI_SOLVE_VERSION, model, at, book_answer: book, answers: [A, ...(b ? [B] : [])], answer_from_ai: answerFromAi,
    confidence: a?.confidence || null, doubt: a?.doubt || null, difficulty: wroteLevel ? level : null, difficulty_reason: a?.difficulty_reason || null, hint: d.hint === approach ? approach : null, solution: d.solution === sol ? sol : null,
  };
  const mcq = type === "subjective" && a?.mcq ? mcqVersion(d, a.mcq, model) : null;
  if (type === "subjective" && a?.mcq && !mcq) notes.push(`${AI}AI's MCQ version was unusable (options missing or repeated) — no MCQ version made`);
  return { draft: d, ai, issues: [...kept, ...notes, ...blocking], blocking, mcq };
}
