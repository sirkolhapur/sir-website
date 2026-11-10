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
// Every AI warning starts with "AI: " so a re-run replaces the old ones.
// =====================================================================
export const AI_SOLVE_VERSION = "ai-solve-1";
export const MAX_PER_CALL = 7;
const AI = "AI: ";
const OPT_TYPES = new Set(["single", "multi"]);

export function normAnswer(type, raw, optionKeys = ["A", "B", "C", "D"]) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (OPT_TYPES.has(type)) {
    const letters = [...new Set((s.toUpperCase().replace(/\bAND\b/g, ",").match(/\b[A-F]\b/g) || []))].filter((l) => optionKeys.includes(l)).sort();
    if (!letters.length) return null;
    return type === "single" ? (letters.length === 1 ? letters[0] : null) : letters;
  }
  const n = s.replace(/[−–]/g, "-").match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i);
  return n ? Number(n[0]) : null;
}

export function sameAnswer(type, a, b, tolerance = 0) {
  if (a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify([].concat(a).sort()) === JSON.stringify([].concat(b).sort());
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(Number(tolerance) || 0, Math.abs(b) * 0.01, 1e-9);
  return String(a) === String(b);
}
export const showAnswer = (a) => (a == null ? "—" : Array.isArray(a) ? a.join(", ") : String(a));

// What the function is sent: never the answer.
export function toSolveQuestion(item) {
  const d = item.draft || {};
  return { ref: item.id, type: d.type || "single", question: d.question || "", options: OPT_TYPES.has(d.type) ? (d.options || []).map((o) => ({ key: o.key, text: o.text })) : null, unit: d.unit || null };
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

// item: { id, draft, extracted, issues, blocking_issues }
// a, b: solutions from two blind runs (b may be null), model, at: ISO time.
// → { draft, ai, issues, blocking } ready for qb_ai_apply_solution.
export function applySolution(item, { a, b = null, model, at = new Date().toISOString() }) {
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
  if (d.solution === sol || d.hint === approach) notes.push(`${AI}Approach and solution written by AI (${model}) — read them before verifying`);

  const tags = new Set((d.tags || []).filter((t) => t !== "ai:answer"));
  if (d.solution === sol || d.hint === approach) tags.add("ai:solution");
  if (answerFromAi) tags.add("ai:answer");
  d.tags = [...tags];

  // Old AI warnings go; "no answer printed" goes once AI has filled an answer.
  const kept = (item.issues || []).filter((w) => !w.startsWith(AI) && !(answerFromAi && /^No answer printed/.test(w)));
  const ai = {
    version: AI_SOLVE_VERSION, model, at, book_answer: book, answers: [A, ...(b ? [B] : [])], answer_from_ai: answerFromAi,
    confidence: a?.confidence || null, doubt: a?.doubt || null, hint: d.hint === approach ? approach : null, solution: d.solution === sol ? sol : null,
  };
  return { draft: d, ai, issues: [...kept, ...notes, ...blocking], blocking };
}
