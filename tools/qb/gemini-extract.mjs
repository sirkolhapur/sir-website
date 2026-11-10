// =====================================================================
// Gemini page readings → Question Bank import items.
//
// The Edge Function qb-gemini-extract returns, per page image:
//   { page_kind, section_heading, questions: [...], answer_key: [{number, answer}] }
// pagesToItems() turns a whole upload (in page order) into the same item
// shape the local PDF parser produces, so Review & Edit, verification and
// the bank work unchanged:
//   * a question split across two pages is joined;
//   * answers printed in a separate answer key are matched by number
//     (within the same question set);
//   * diagram boxes become figure crops (0–1000 page scale, like the parser);
//   * the question set (Classwork, PYQ NEET, …) becomes tag "set:<id>" and,
//     for previous-year sets, the exam tag;
//   * anything Gemini was unsure about, or a missing answer, becomes an issue
//     the coordinator must look at. Nothing is ever marked verified here;
//   * short-answer questions ("Find the dimensions of …") are type
//     "subjective" with a text answer; separate parts (i), (ii) / a)–d) come
//     as separate entries with "part" and become questions "22(i)", "22(ii)".
// =====================================================================
export const GEMINI_EXTRACT_VERSION = "gemini-1";

export const SET_EXAM = { "pyq-neet": "neet", "pyq-aiims": "aiims", "pyq-jipmer": "jipmer" };

// "Previous Year NEET MCQs" → "pyq-neet", "NCERT Exemplar" → "ncert-exemplar", …
export function setFromHeading(heading) {
  const h = String(heading || "").toLowerCase();
  if (!h.trim()) return null;
  if (/exemplar/.test(h)) return "ncert-exemplar";
  if (/ncert/.test(h) && /unsolved/.test(h)) return "ncert-unsolved";
  if (/ncert/.test(h) && /solved/.test(h)) return "ncert-solved";
  if (/(previous|pyq|past|year)/.test(h) || /\b(neet|aiims|jipmer)\b/.test(h)) {
    if (/aiims/.test(h)) return "pyq-aiims";
    if (/jipmer/.test(h)) return "pyq-jipmer";
    if (/neet|aipmt/.test(h)) return "pyq-neet";
  }
  if (/class\s*work/.test(h)) return "classwork";
  if (/assignment|home\s*work/.test(h)) return "assignment";
  return null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
// "(a)", "a", "1", "(1)", "A." → "A"
export function letterOf(v) {
  const s = String(v ?? "").trim().replace(/^[([{]\s*|\s*[)\].:]\s*$/g, "");
  if (/^[A-Fa-f]$/.test(s)) return s.toUpperCase();
  if (/^[1-6]$/.test(s)) return LETTERS[Number(s) - 1];
  return null;
}
function answerFor(type, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (type === "subjective") return s;
  if (type === "multi") {
    const parts = s.replace(/\band\b/gi, ",").split(/[\s,;/&]+/).map(letterOf).filter(Boolean);
    return parts.length ? [...new Set(parts)].sort() : null;
  }
  if (type === "single") {
    const m = s.match(/^\(?\s*([A-Fa-f]|[1-6])\s*\)?(?:[.\s]|$)/) || s.match(/\b(?:option|ans(?:wer)?)\s*[:.-]?\s*\(?([A-Fa-f]|[1-6])\)?/i);
    return m ? letterOf(m[1]) : null;
  }
  if (type === "integer" || type === "numerical") {
    const n = s.replace(/[−–]/g, "-").match(/-?\d+(?:\.\d+)?/);
    return n ? Number(n[0]) : null;
  }
  return null;
}

// "[Figure 2]" → "![Figure 2](figure:2)"; boxes [ymin,xmin,ymax,xmax] → [x0,y0,x1,y1].
function placeFigures(q, page, labelOffset) {
  const figures = [], rename = new Map();
  (q.figures || []).forEach((f, i) => {
    const b = (f.box_2d || []).map((v) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
    if (b.length !== 4 || b[2] <= b[0] || b[3] <= b[1]) return;
    const label = String(labelOffset + figures.length + 1);
    rename.set(String(f.label ?? i + 1), label);
    figures.push({ label, page, option_key: letterOf(f.option_key) || null, description: f.description || "", proposed: true, box: [b[1], b[0], b[3], b[2]] });
  });
  const fix = (text) => String(text || "").replace(/\[\s*(?:figure|fig\.?|diagram)\s*([0-9A-Za-z]+)\s*\]/gi, (all, l) => (rename.has(String(l)) ? `![Figure ${rename.get(String(l))}](figure:${rename.get(String(l))})` : all));
  let question = fix(q.question);
  const options = (q.options || []).map((o) => ({ key: letterOf(o.key) || String(o.key || "").toUpperCase(), text: fix(o.text) }));
  // A diagram Gemini found but did not place: show it after the question text.
  for (const f of figures) {
    const tag = `](figure:${f.label})`;
    if (!question.includes(tag) && !options.some((o) => o.text.includes(tag))) {
      if (f.option_key) { const o = options.find((x) => x.key === f.option_key); if (o) { o.text = `${o.text} ![Figure ${f.label}](figure:${f.label})`.trim(); continue; } }
      question += `\n\n![Figure ${f.label}](figure:${f.label})`;
    }
  }
  return { question, options, figures };
}

// pages: [{ pageNo, model, result: { section_heading, questions, answer_key, truncated } }] in reading order.
// ctx:   { subject, chapter (slug), exam: [], sourceLabel, questionSet (id | null = detect), setLabels: {id: label} }
export function pagesToItems(pages, ctx) {
  const items = [], keys = [];
  let detectedSet = null;
  for (const pg of pages) {
    const r = pg.result || {};
    const fromHeading = setFromHeading(r.section_heading);
    if (fromHeading) detectedSet = fromHeading;
    const set = ctx.questionSet || detectedSet || null;
    for (const k of r.answer_key || []) keys.push({ set, number: Number(k.number), answer: k.answer, page: pg.pageNo });
    for (const q of r.questions || []) {
      const prev = items[items.length - 1];
      // Joined with the previous page's unfinished question.
      if (q.continued_from_previous_page && prev && prev._open && prev.extracted.page_to === pg.pageNo - 1) {
        const off = prev.draft.figures.length;
        const placed = placeFigures(q, pg.pageNo, off);
        const d = prev.draft;
        if (placed.question.trim()) d.question = `${d.question.trim()}\n${placed.question.trim()}`;
        for (const o of placed.options) { const same = d.options?.find((x) => x.key === o.key); if (same) same.text = `${same.text} ${o.text}`.trim(); else (d.options ||= []).push(o); }
        d.figures.push(...placed.figures);
        prev.extracted.page_to = pg.pageNo; prev.source_location = `pages ${prev.extracted.page_from}–${pg.pageNo}`;
        prev._open = !!q.continues_on_next_page;
        if (q.answer && !prev._answerRaw) prev._answerRaw = q.answer;
        if (q.uncertain) prev._uncertain.push(q.uncertain_reason || "unsure about the continued part");
        prev.extracted.joined_pages = true;
        continue;
      }
      const placed = placeFigures(q, pg.pageNo, 0);
      const rawType = q.type || "single";
      // Match-the-columns without any columns is really a short-answer question.
      const type = rawType === "assertion_reason" || (rawType === "matrix_match" && placed.options.length >= 2) ? "single" : rawType === "matrix_match" ? "subjective" : rawType;
      const n = Number(q.number) || null;
      const part = String(q.part || "").trim().replace(/^[([]|[)\].]$/g, "");
      const label = n != null ? `${n}${part ? `(${part})` : ""}` : null;
      const setLabel = set ? (ctx.setLabels?.[set] || set) : null;
      const exam = [...new Set([...(ctx.exam || []), ...(set && SET_EXAM[set] ? [SET_EXAM[set]] : [])])];
      const year = String(q.exam_year || "").match(/(19|20)\d{2}/)?.[0];
      const tags = [...(set ? [`set:${set}`] : []), ...(year ? [`year:${year}`] : [])];
      items.push({
        _open: !!q.continues_on_next_page, _answerRaw: q.answer_printed !== false ? q.answer || "" : "", _uncertain: q.uncertain ? [q.uncertain_reason || "unsure about part of this question"] : [],
        _set: set,
        page_no: pg.pageNo,
        source_number: label ?? "?",
        source_location: `page ${pg.pageNo}`,
        confidence: "high",
        issues: [],
        extracted: {
          source_method: "gemini", model: pg.model || null, extractor_version: GEMINI_EXTRACT_VERSION, number: n, part: part || null, section: setLabel, section_no: 1,
          page_from: pg.pageNo, page_to: pg.pageNo, kind: rawType, exam_year: q.exam_year || null, regions: [], source_text: q.question || "", option_markers: null, assumed: false,
          suggestion: { chapter: ctx.chapter, topic: q.topic, subtopic: q.subtopic, basis: "chosen by Gemini from this chapter's topic list" },
        },
        draft: {
          code: null, subject: ctx.subject ?? null, chapter: ctx.chapter ?? null, topic: q.topic || null, subtopic: q.subtopic && q.subtopic !== "none" ? q.subtopic : null, branch: null,
          type, difficulty: null, exam, tags,
          source: ["book", ctx.sourceLabel, setLabel, `p.${pg.pageNo}`, label ? `Q${label}` : null].filter(Boolean).join(":"),
          status: "live", marks: 4, negative: type === "single" || type === "multi" ? 1 : 0,
          question: placed.question, options: type === "single" || type === "multi" ? placed.options : null,
          hint: null, solution: q.solution ? String(q.solution) : null, unit: null, answer: null, tolerance: 0, figures: placed.figures,
        },
      });
    }
    if (r.truncated) {
      const last = items.filter((it) => it.page_no === pg.pageNo).pop();
      if (last) last._uncertain.push("Gemini's answer for this page was cut short — check that no question is missing from this page");
    }
  }
  // Answer key (often printed at the end of a set): match by set + number,
  // and by number alone when only one question has that number.
  for (const it of items) {
    if (!it._answerRaw && it.extracted.number != null && !it.extracted.part) {
      const sameSet = keys.filter((k) => k.number === it.extracted.number && k.set === it._set);
      const any = keys.filter((k) => k.number === it.extracted.number);
      const only = items.filter((x) => x.extracted.number === it.extracted.number).length === 1;
      const k = sameSet[0] || (only && any.length === 1 ? any[0] : null);
      if (k) { it._answerRaw = k.answer; it.extracted.answer_source = `answer key, page ${k.page}`; }
    } else if (it._answerRaw) it.extracted.answer_source = "printed with the question";
  }
  for (const it of items) {
    const d = it.draft;
    d.answer = answerFor(d.type, it._answerRaw);
    if (it._answerRaw && d.answer == null) it.issues.push(`Answer "${String(it._answerRaw).slice(0, 40)}" could not be matched to an option — set the correct answer`);
    if (!it._answerRaw) it.issues.push("No answer printed on these pages — add the correct answer before verifying");
    if ((d.type === "single" || d.type === "multi") && (d.options || []).length < 4) it.issues.push(`Only ${(d.options || []).length} option(s) read — compare with the page`);
    if (d.type === "single" && Array.isArray(d.answer)) d.answer = d.answer[0];
    for (const u of it._uncertain) it.issues.push(`Gemini was unsure: ${u} — compare with the page image`);
    if (it.extracted.kind === "matrix_match" && d.type === "single") it.issues.push("Match-the-columns question stored as a single-answer question with coded options — check the table");
    if (it.extracted.kind === "matrix_match" && d.type === "subjective") it.issues.push("Read as match-the-columns but no columns were found — stored as a subjective question; check the type");
    if (d.figures.length) it.issues.push(`${d.figures.length} diagram(s) cropped automatically — check each crop holds the whole diagram`);
    if (it._open) it.issues.push("This question continues on a page that was not uploaded — complete it");
    if (!d.topic) it.issues.push("No topic chosen — choose the topic");
    it.confidence = it._uncertain.length || it._open ? "low" : (!d.answer && d.answer !== 0) || it.issues.some((x) => /option\(s\) read/.test(x)) ? "medium" : "high";
    delete it._open; delete it._answerRaw; delete it._uncertain; delete it._set;
  }
  return items;
}

// The unfinished end of a page, sent with the next page so Gemini can join it.
export function openTail(result) {
  const qs = result?.questions || [];
  const last = qs[qs.length - 1];
  return last && last.continues_on_next_page ? String(last.question || "").slice(-600) : "";
}
