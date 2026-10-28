// =====================================================================
// SIR question bank — rule-based classification suggestions
//
// Suggests a chapter/topic by matching words in the question against the
// SIR syllabus names (question-bank/taxonomy.json / qb_topics). It is a
// keyword heuristic, NOT a judgement: results are always shown to the
// coordinator as "suggested" and never applied without review.
// =====================================================================

const STOP = new Set(("the a an of and or to in on at for by with from into is are was were be been which what when where who " +
  "whose that this these those its it as than then there their will would can could should may might find value given " +
  "following correct statement statements option options answer question number shown figure below above per each one two " +
  "three four between about after before same other more less most least very also only not all any both such").split(" "));

export function tokens(text) {
  return String(text || "").toLowerCase()
    .replace(/\$[^$]*\$/g, " ")                        // ignore formulas
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")             // ignore images
    .replace(/[^a-z\s-]/g, " ").split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, ""));
}

// taxonomy: { subjects: [{ id, chapters: [{ slug, name, topics: [[slug,label]|{slug,label}] }] }] }
export function suggestClassification(text, taxonomy, subjectId, chapterSlug = null) {
  const qt = new Set(tokens(text));
  if (!qt.size) return null;
  const subject = taxonomy.subjects.find((s) => s.id === subjectId);
  if (!subject) return null;
  let best = null;
  for (const ch of subject.chapters) {
    if (chapterSlug && ch.slug !== chapterSlug) continue;
    const chTokens = new Set(tokens(ch.name));
    for (const t of ch.topics || []) {
      const slug = Array.isArray(t) ? t[0] : t.slug, label = Array.isArray(t) ? t[1] : t.label;
      const tt = new Set([...tokens(label), ...chTokens]);
      const hits = [...tt].filter((w) => qt.has(w));
      const score = hits.length + (chapterSlug ? 0 : 0) + hits.filter((w) => tokens(label).includes(w)).length * 0.5;
      if (hits.length && (!best || score > best.score)) best = { chapter: ch.slug, topic: slug, label, chapterName: ch.name, score, matched: hits };
    }
  }
  if (!best || best.matched.length < (chapterSlug ? 1 : 2)) return null;
  return { ...best, basis: `matched words: ${best.matched.join(", ")}` };
}
