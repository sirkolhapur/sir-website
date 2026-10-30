// =====================================================================
// SIR Test & Assessment Coordinator — Question Bank workflow
// Upload → Extraction → Review & Edit → Verification → Final Question
// Bank → Draft Test Builder. Loaded by test-coordinator-dashboard.html,
// which provides window.SIR_TC (Supabase client, toast, esc, go).
//
// Every state change that matters (verify, return, reject, add to test)
// is a server function that re-checks permissions and gates; the buttons
// here are convenience only.
// =====================================================================
import { validateQuestion, QUESTION_TYPES } from "../tools/qb/parser.mjs?v=20261030-mathocr1";
import { linesFromPdfItems, segmentQuestions, reconcileExtraction, pageRecordText, PARSER_VERSION, UNREADABLE } from "../tools/qb/pdf-parser.mjs?v=20261030-mathocr1";
import { renderPage, ocrPage } from "../tools/qb/ocr-page.mjs?v=20261030-mathocr1";
import { helperHealth, runMathOcr, MATH_OCR_VERSION } from "../tools/qb/math-ocr.mjs?v=20261030-mathocr1";
import { parseDocx, WEB_IMAGE } from "../tools/qb/docx-parser.mjs?v=20261030-mathocr1";
import { parseXlsx } from "../tools/qb/xlsx-parser.mjs?v=20261030-mathocr1";
import { suggestClassification } from "../tools/qb/suggest.mjs?v=20261030-mathocr1";

const T = window.SIR_TC;
const sb = T.sb;
const esc = T.esc;
const toast = (m) => T.toast(m);
const QB_IMAGES_URL = `${T.SUPABASE_URL}/storage/v1/object/public/qb-images/`;
const MAX_BYTES = 50 * 1024 * 1024;
// Difficulty is stored 1–5. Bands used for display and filtering:
//   1–2 Easy (direct recall / one-step), 3 Medium (two or three steps or
//   concepts), 4–5 Hard (multi-concept, lengthy or tricky; JEE Adv level).
const BANDS = { easy: [1, 2], medium: [3], hard: [4, 5] };
const DIFF_LABEL = { 1: "1 · Easy", 2: "2 · Easy", 3: "3 · Medium", 4: "4 · Hard", 5: "5 · Hard (hardest)" };
const bandOf = (d) => Object.keys(BANDS).find((k) => BANDS[k].includes(Number(d)));
const TYPE_LABEL = { single: "Single correct", multi: "Multiple correct", integer: "Integer", numerical: "Numerical", matrix_match: "Matrix match" };
const ITEM_LABEL = { review_required: "Review required", corrected: "Corrected", returned: "Returned for correction", verified: "Verified", rejected: "Rejected" };
const JOB_LABEL = { uploaded: "Uploaded", processing: "Processing", review_required: "Review required", done: "Done", failed: "Failed", cancelled: "Cancelled" };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const S = { tax: null, taxonomy: null, root: null, bank: { page: 0, f: {} }, pick: {} };
const fail = (e) => { console.error(e); toast(e?.message || String(e)); };

// ---------------------------------------------------------------------
// Rendering: Markdown + KaTeX (+ mhchem), sanitised; images resolved to
// stable Storage URLs (or, during review, to the stored source media).
// ---------------------------------------------------------------------
const fixTex = (s) => s.replace(/(\\[,;:!]|\\quad|\\qquad)\s*(\^|_)/g, "$1{}$2");
const placeholder = (label) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='240' height='60'><rect width='240' height='60' fill='#fdf2e9' stroke='#b93838'/><text x='12' y='36' font-size='13' fill='#b93838'>${label}</text></svg>`);
function resolveImages(md, maps = {}) {
  return String(md ?? "")
    .replace(/\]\(figure:([A-Za-z0-9]+)\)/g, (_, n) => `](${maps.figures?.[n] || placeholder(`Figure ${n} — crop pending`)})`)
    .replace(/\]\(import-media:([^)\s]+)\)/g, (_, p) => `](${maps.media?.[p] || placeholder("Source image")})`)
    .replace(/\]\(qb-images\//g, `](${QB_IMAGES_URL}`);
}
function renderMd(el, md, maps) {
  const math = [];
  const shielded = resolveImages(md, maps).replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (m) => { math.push(fixTex(m)); return `@@MATH${math.length - 1}@@`; });
  let html = DOMPurify.sanitize(marked.parse(shielded, { breaks: true, gfm: true }));
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => esc(math[Number(i)]));
  el.innerHTML = html;
  renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false, strict: "ignore" });
  $$("img", el).forEach((img) => img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("div"), { className: "tag red", textContent: "Image missing: " + img.getAttribute("src").slice(-60) })); }, { once: true }));
}
const mdDiv = (md, maps, cls = "qb-md") => { const d = document.createElement("div"); d.className = cls; renderMd(d, md, maps); return d; };
const katexErrors = (el) => $$(".katex-error", el).map((e) => e.getAttribute("title") || e.textContent);

function answerText(a) {
  if (a == null) return "—";
  if (Array.isArray(a)) return a.join(", ");
  if (typeof a === "object") return Object.entries(a).map(([k, v]) => `${k}→${[].concat(v).join(",")}`).join("  ");
  return String(a);
}
function questionView(q, { answer, solution, maps } = {}) {
  const wrap = document.createElement("div");
  wrap.appendChild(mdDiv(q.question, maps));
  if (q.type === "single" || q.type === "multi") {
    const opts = document.createElement("div"); opts.className = "qb-opts";
    for (const o of q.options || []) {
      const ok = answer != null && (Array.isArray(answer) ? answer.includes(o.key) : answer === o.key);
      const row = document.createElement("div"); row.className = "qb-opt" + (ok ? " ok" : "");
      row.innerHTML = `<b>${esc(o.key)}</b>`; row.appendChild(mdDiv(o.text, maps)); opts.appendChild(row);
    }
    wrap.appendChild(opts);
  } else if (q.type === "matrix_match" && q.options) {
    const m = document.createElement("div"); m.className = "qb-matrix";
    for (const side of ["left", "right"]) {
      const col = document.createElement("div"); col.className = "qb-opts";
      col.innerHTML = `<div class="klabel">${side === "left" ? "Column I" : "Column II"}</div>`;
      for (const o of q.options[side] || []) { const row = document.createElement("div"); row.className = "qb-opt"; row.innerHTML = `<b>${esc(o.key)}</b>`; row.appendChild(mdDiv(o.text, maps)); col.appendChild(row); }
      m.appendChild(col);
    }
    wrap.appendChild(m);
  }
  if (answer != null && !(q.type === "single" || q.type === "multi")) {
    const a = document.createElement("div"); a.className = "qb-sol";
    a.innerHTML = `<b>Answer:</b> ${esc(answerText(answer))}${q.unit ? " " + esc(q.unit) : ""}${q.tolerance ? ` (± ${esc(q.tolerance)})` : ""}`;
    wrap.appendChild(a);
  }
  if (solution) { const s = document.createElement("div"); s.className = "qb-sol"; s.innerHTML = "<b>Solution</b>"; s.appendChild(mdDiv(solution, maps)); wrap.appendChild(s); }
  return wrap;
}

// ---------------------------------------------------------------------
// Taxonomy (DB → shape of question-bank/taxonomy.json for the parser)
// ---------------------------------------------------------------------
async function loadTaxonomy() {
  if (S.tax) return;
  const [s, c, t, st, e] = await Promise.all([
    sb.from("qb_subjects").select("*").order("sort_order"), sb.from("qb_chapters").select("*").order("sort_order"),
    sb.from("qb_topics").select("*").order("sort_order"), sb.from("qb_subtopics").select("*").order("sort_order"),
    sb.from("qb_exam_tags").select("*").order("sort_order"),
  ]);
  for (const r of [s, c, t, st, e]) if (r.error) throw r.error;
  S.tax = { subjects: s.data, chapters: c.data, topics: t.data, subtopics: st.data, examTags: e.data };
  S.taxonomy = {
    exam_tags: e.data.map((x) => x.id),
    subjects: s.data.map((sub) => ({ id: sub.id, code: sub.code, name: sub.name, branches: sub.branches,
      chapters: c.data.filter((ch) => ch.subject_id === sub.id).map((ch) => ({ id: ch.id, code: ch.code, slug: ch.slug, name: ch.name, branches: ch.branches,
        topics: t.data.filter((tp) => tp.chapter_id === ch.id).map((tp) => ({ slug: tp.slug, label: tp.label,
          subtopics: st.data.filter((x) => x.topic_id === tp.id).map((x) => [x.slug, x.label]) })) })) })),
  };
}
const chaptersOf = (sid) => S.tax.chapters.filter((c) => c.subject_id === sid);
const topicsOf = (cid) => S.tax.topics.filter((t) => t.chapter_id === cid);
const subtopicsOf = (tid) => S.tax.subtopics.filter((t) => t.topic_id === tid);
const chapterBySlug = (sid, slug) => S.tax.chapters.find((c) => c.subject_id === sid && c.slug === slug);
const chapterById = (id) => S.tax.chapters.find((c) => c.id === id);
const topicById = (id) => S.tax.topics.find((t) => t.id === id);
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel ?? "") ? " selected" : ""}>${esc(label)}</option>`;
const subjectOpts = (sel) => S.tax.subjects.map((s) => opt(s.id, s.name, sel)).join("");
const chapterOpts = (sid, sel, blank = "All chapters") => opt("", blank, sel) + chaptersOf(sid).map((c) => opt(c.id, c.name, sel)).join("");
const topicOpts = (cid, sel, blank = "All topics") => opt("", blank, sel) + topicsOf(cid).map((t) => opt(t.id, t.label, sel)).join("");
function matchChapter(sid, name) {
  const n = String(name || "").trim().toLowerCase(); if (!n) return null;
  return chaptersOf(sid).find((c) => c.slug === n || c.name.toLowerCase() === n || c.code.toLowerCase() === n) || null;
}
function matchTopic(chapterId, name) {
  const n = String(name || "").trim().toLowerCase(); if (!n || !chapterId) return null;
  return topicsOf(chapterId).find((t) => t.slug === n || t.label.toLowerCase() === n) || null;
}
function rowToQ(row, key) {
  const ch = chapterById(row.chapter_id), tp = topicById(row.topic_id);
  const stp = row.subtopic_id ? S.tax.subtopics.find((x) => x.id === row.subtopic_id) : null;
  return { id: row.id, code: row.code, subject: row.subject_id, chapter: ch?.slug, topic: tp?.slug, subtopic: stp?.slug || null,
    branch: row.branch, type: row.type, difficulty: row.difficulty, exam: row.exam_tags || [], tags: row.tags || [], source: row.source,
    status: row.status, marks: Number(row.default_marks), negative: Number(row.default_negative), question: row.question_md, options: row.options,
    hint: row.hint_md, unit: row.unit, answer: key?.answer ?? null, tolerance: key ? Number(key.tolerance) : 0, solution: key?.solution_md ?? null };
}
const metaTags = (q) => {
  const ch = chapterBySlug(q.subject, q.chapter), tp = ch && topicsOf(ch.id).find((t) => t.slug === q.topic);
  return `<span class="tag blue">${esc(q.code || "new")}</span> <span class="tag ${q.status === "live" ? "" : "amber"}">${esc(q.status === "live" ? "verified" : q.status)}</span> <span class="tag blue">${esc(ch?.name || q.chapter || "—")}</span> <span class="tag blue">${esc(tp?.label || q.topic || "—")}</span> <span class="tag blue">${esc(TYPE_LABEL[q.type] || q.type)}</span> <span class="tag blue">${q.difficulty ? esc(DIFF_LABEL[q.difficulty]) : "Difficulty not set"}</span>`;
};

// ---------------------------------------------------------------------
// Question editor (shared by review, verification and bank)
// Returns { el, getQ, setErrors }.
// ---------------------------------------------------------------------
function questionEditor(existing, { maps } = {}) {
  const q = structuredClone(existing);
  if (!q.exam) q.exam = []; if (!q.tags) q.tags = [];
  const el = document.createElement("div");
  el.className = "qb-editor";
  el.innerHTML = `<div class="card">
    <div class="qb-row3">
     <div><label class="darklabel">Subject</label><select class="lightfield" data-f="subject">${subjectOpts(q.subject)}</select></div>
     <div><label class="darklabel">Chapter</label><select class="lightfield" data-f="chapter"></select></div>
     <div><label class="darklabel">Topic</label><select class="lightfield" data-f="topic"></select></div>
     <div><label class="darklabel">Subtopic</label><select class="lightfield" data-f="subtopic"></select></div>
     <div><label class="darklabel">Type</label><select class="lightfield" data-f="type">${QUESTION_TYPES.map((t) => opt(t, TYPE_LABEL[t], q.type)).join("")}</select></div>
     <div><label class="darklabel">Difficulty</label><select class="lightfield" data-f="difficulty">${q.difficulty ? "" : opt("", "Choose…", "")}${[1, 2, 3, 4, 5].map((d) => opt(d, DIFF_LABEL[d], q.difficulty)).join("")}</select></div>
    </div>
    <div data-f="branchwrap" class="hide"><label class="darklabel">Branch</label><select class="lightfield" data-f="branch">${opt("", "—", q.branch)}${opt("botany", "Botany", q.branch)}${opt("zoology", "Zoology", q.branch)}</select></div>
    <label class="darklabel" style="margin-top:10px">Exam suitability</label><div class="toolbar" style="margin:0">${S.tax.examTags.map((t) => `<label class="checkline"><input type="checkbox" data-exam="${esc(t.id)}"${q.exam.includes(t.id) ? " checked" : ""}> ${esc(t.label)}</label>`).join("")}</div>
    <label class="darklabel" style="margin-top:10px">Question (Markdown + LaTeX: <code>$\\frac{1}{4\\pi\\varepsilon_0}$</code>, chemistry <code>$\\ce{H2SO4}$</code>)</label>
    <textarea class="lightfield qb-mono" data-f="question" rows="6">${esc(q.question)}</textarea>
    <div class="toolbar"><label class="btn outline small">Insert image<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" data-f="image" hidden></label></div>
    <div data-f="options"></div><div data-f="answer"></div>
    <label class="darklabel">Solution (optional — only a real worked solution)</label><textarea class="lightfield qb-mono" data-f="solution" rows="4">${esc(q.solution || "")}</textarea>
    <div class="qb-row3">
     <div><label class="darklabel">Tags (comma separated)</label><input class="lightfield" data-f="tags" value="${esc(q.tags.join(", "))}"></div>
     <div><label class="darklabel">Source</label><input class="lightfield" data-f="source" value="${esc(q.source || "")}"></div>
     <div><label class="darklabel">Marks / negative</label><div class="row"><input class="lightfield" type="number" step="0.25" min="0.25" data-f="marks" value="${esc(q.marks ?? 4)}"><input class="lightfield" type="number" step="0.25" min="0" data-f="negative" value="${esc(q.negative ?? 0)}"></div></div>
    </div>
    <div data-f="errors" class="notice hide" style="margin-top:12px;border-color:#efb5b5;background:#fdf0f0;color:#a32626"></div>
  </div>
  <div class="card" style="margin-top:12px"><h3 class="ctitle">Student preview</h3><p class="csub">Correct options are highlighted. Formulas that do not render are shown in red.</p><div data-f="preview"></div></div>`;
  const f = (n) => $(`[data-f="${n}"]`, el);
  const fillChapters = () => {
    const ch = chapterBySlug(f("subject").value, q.chapter);
    f("chapter").innerHTML = chapterOpts(f("subject").value, ch?.id, "Choose chapter");
    fillTopics();
    const subj = S.tax.subjects.find((s) => s.id === f("subject").value);
    f("branchwrap").classList.toggle("hide", !subj?.branches?.length);
  };
  const fillTopics = () => {
    const cid = f("chapter").value, tp = cid && topicsOf(cid).find((t) => t.slug === q.topic);
    f("topic").innerHTML = cid ? topicOpts(cid, tp?.id, "Choose topic") : opt("", "Choose chapter first", "");
    fillSubtopics();
  };
  const fillSubtopics = () => {
    const subs = f("topic").value ? subtopicsOf(f("topic").value) : [];
    f("subtopic").innerHTML = opt("", subs.length ? "None" : "No subtopics", q.subtopic) + subs.map((s) => opt(s.slug, s.label, q.subtopic)).join("");
  };
  f("subject").onchange = () => { q.subject = f("subject").value; q.chapter = q.topic = q.subtopic = null; fillChapters(); update(); };
  f("chapter").onchange = () => { q.chapter = chapterById(f("chapter").value)?.slug || null; q.topic = q.subtopic = null; fillTopics(); update(); };
  f("topic").onchange = () => { q.topic = topicById(f("topic").value)?.slug || null; q.subtopic = null; fillSubtopics(); };
  f("subtopic").onchange = () => { q.subtopic = f("subtopic").value || null; };
  f("branch").onchange = () => { q.branch = f("branch").value || null; };
  f("difficulty").onchange = () => { q.difficulty = Number(f("difficulty").value) || null; };
  fillChapters();

  const renderOptions = () => {
    const box = f("options");
    if (q.type === "single" || q.type === "multi") {
      if (!Array.isArray(q.options)) q.options = ["A", "B", "C", "D"].map((key) => ({ key, text: "" }));
      box.innerHTML = `<label class="darklabel">Options</label>` + q.options.map((o, i) => `<div class="qb-optrow"><b>${esc(o.key)}</b><textarea class="lightfield qb-mono" rows="1" data-opt="${i}">${esc(o.text)}</textarea><button class="btn outline small" data-del="${i}" title="Remove">✕</button></div>`).join("")
        + `<button class="btn outline small" data-add>+ Add option</button>`;
      $("[data-add]", box).onclick = () => { q.options.push({ key: String.fromCharCode(65 + q.options.length), text: "" }); renderOptions(); renderAnswer(); update(); };
      $$("[data-del]", box).forEach((b) => b.onclick = () => { q.options.splice(Number(b.dataset.del), 1); q.options.forEach((o, i) => o.key = String.fromCharCode(65 + i)); renderOptions(); renderAnswer(); update(); });
    } else if (q.type === "matrix_match") {
      if (!q.options || Array.isArray(q.options)) q.options = { left: ["A", "B", "C", "D"].map((key) => ({ key, text: "" })), right: ["P", "Q", "R", "S"].map((key) => ({ key, text: "" })) };
      box.innerHTML = ["left", "right"].map((side) => `<label class="darklabel">${side === "left" ? "Column I" : "Column II"}</label>` + q.options[side].map((o, i) => `<div class="qb-optrow"><b>${esc(o.key)}</b><textarea class="lightfield qb-mono" rows="1" data-side="${side}" data-opt="${i}">${esc(o.text)}</textarea><span></span></div>`).join("")).join("");
    } else {
      q.options = null;
      box.innerHTML = `<div class="qb-row3"><div><label class="darklabel">Unit (optional)</label><input class="lightfield" data-f="unit" value="${esc(q.unit || "")}"></div>${q.type === "numerical" ? `<div><label class="darklabel">Tolerance (±)</label><input class="lightfield" type="number" step="any" min="0" data-f="tol" value="${esc(q.tolerance ?? 0)}"></div>` : ""}</div>`;
      $("[data-f=unit]", box)?.addEventListener("input", (e) => { q.unit = e.target.value || null; update(); });
      $("[data-f=tol]", box)?.addEventListener("input", (e) => { q.tolerance = Number(e.target.value) || 0; update(); });
    }
    $$("textarea[data-opt]", box).forEach((t) => t.oninput = () => {
      const i = Number(t.dataset.opt);
      if (t.dataset.side) q.options[t.dataset.side][i].text = t.value; else q.options[i].text = t.value;
      update();
    });
  };
  const renderAnswer = () => {
    const box = f("answer");
    if (q.type === "single" || q.type === "multi") {
      const multi = q.type === "multi", cur = multi ? [].concat(q.answer || []) : q.answer;
      box.innerHTML = `<label class="darklabel">Correct answer${multi ? "s" : ""}</label><div class="toolbar" style="margin:0">${q.options.map((o) => `<label class="checkline"><input type="${multi ? "checkbox" : "radio"}" name="qbAns" value="${o.key}"${(multi ? cur.includes(o.key) : cur === o.key) ? " checked" : ""}> ${o.key}</label>`).join("")}</div>`;
      $$("input[name=qbAns]", box).forEach((i) => i.onchange = () => { q.answer = multi ? $$("input[name=qbAns]:checked", box).map((x) => x.value).sort() : i.value; update(); });
    } else if (q.type === "matrix_match") {
      const ans = (q.answer && typeof q.answer === "object" && !Array.isArray(q.answer)) ? q.answer : {};
      box.innerHTML = `<label class="darklabel">Correct matching (Column II keys)</label>` + q.options.left.map((o) => `<div class="qb-optrow"><b>${esc(o.key)}</b><input class="lightfield" data-mk="${esc(o.key)}" value="${esc((ans[o.key] || []).join(","))}" placeholder="e.g. Q or P,R"><span></span></div>`).join("");
      $$("[data-mk]", box).forEach((i) => i.oninput = () => {
        const out = {}; $$("[data-mk]", box).forEach((x) => { const v = x.value.toUpperCase().split(/[\s,]+/).filter(Boolean); if (v.length) out[x.dataset.mk] = v.sort(); });
        q.answer = out; update();
      });
    } else {
      box.innerHTML = `<label class="darklabel">Correct answer</label><input class="lightfield" type="number" step="${q.type === "integer" ? 1 : "any"}" data-f="num" value="${esc(q.answer ?? "")}">`;
      $("[data-f=num]", box).oninput = (e) => { q.answer = e.target.value === "" ? null : Number(e.target.value); update(); };
    }
  };
  f("type").onchange = () => {
    const kind = (t) => (t === "single" || t === "multi") ? "list" : t === "matrix_match" ? "matrix" : "none";
    const was = q.type; q.type = f("type").value;
    if (kind(was) !== kind(q.type)) q.options = undefined;
    q.answer = null; renderOptions(); renderAnswer(); update();
  };
  f("question").oninput = (e) => { q.question = e.target.value; update(); };
  f("solution").oninput = (e) => { q.solution = e.target.value || null; update(); };
  f("image").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller");
      const path = await uploadBankImage(file, file.type);
      const ta = f("question"), pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + `\n![Figure](qb-images/${path})\n` + ta.value.slice(pos);
      q.question = ta.value; update(); toast("Image stored");
    } catch (err) { fail(err); } finally { e.target.value = ""; }
  };
  renderOptions(); renderAnswer();
  let raf;
  function update() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { const p = f("preview"); p.innerHTML = ""; p.appendChild(questionView(q, { answer: q.answer, solution: q.solution, maps })); });
  }
  update();
  const getQ = () => {
    q.exam = $$("[data-exam]:checked", el).map((x) => x.dataset.exam);
    q.tags = f("tags").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    q.source = f("source").value.trim() || null;
    q.marks = Number(f("marks").value) || 4; q.negative = Math.max(0, Number(f("negative").value) || 0);
    q.difficulty = Number(f("difficulty").value) || null;
    if (q.type === "single" || q.type === "multi") q.options = q.options.map((o) => ({ key: o.key, text: o.text.trim() }));
    return structuredClone(q);
  };
  const setErrors = (errs) => {
    const box = f("errors");
    box.classList.toggle("hide", !errs.length);
    box.innerHTML = errs.length ? `<b>Cannot continue:</b><ul style="margin:6px 0 0;padding-left:18px">${errs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  };
  const formulaErrors = () => katexErrors(f("preview"));
  return { el, getQ, setErrors, formulaErrors };
}

// Local checks before any server call (the server re-checks).
function localErrors(q, { formulaErrors = [] } = {}) {
  const ch = chapterBySlug(q.subject, q.chapter);
  if (!ch) return ["Choose a chapter"];
  if (!q.topic) return ["Choose a topic"];
  if (!q.difficulty) return ["Choose a difficulty (1–2 Easy, 3 Medium, 4–5 Hard)"];
  const probe = { ...q, code: q.code || `${S.tax.subjects.find((s) => s.id === q.subject).code}-${ch.code}-0000`, status: "live" };
  const errs = validateQuestion(probe, S.taxonomy);
  if (formulaErrors.length) errs.push(`Formula does not render: ${formulaErrors[0].slice(0, 120)}`);
  if (/\]\((blob:|data:|file:|[A-Za-z]:\\)/.test(JSON.stringify(q))) errs.push("An image points to a temporary or local file — use Insert image so it is stored");
  if (JSON.stringify([q.question, q.options, q.solution]).includes(UNREADABLE)) errs.push(`Replace every ${UNREADABLE} with the value from the page — it marks an exponent or symbol the scan could not read`);
  return errs;
}
const notVerified = (err) => {
  const m = String(err?.message || err);
  return m.startsWith("NOT_VERIFIED: ") ? m.slice(14).split(" || ") : null;
};

// Stable, unguessable image paths in the public qb-images bucket.
async function uploadBankImage(blob, mime) {
  if (!WEB_IMAGE.test(mime)) throw new Error(`${mime || "This file"} cannot be shown in a browser — use PNG, JPEG, WebP, GIF or SVG`);
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/bmp": "bmp" }[mime];
  const path = `q/${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("qb-images").upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw error;
  return path;
}

// ---------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------
const PAGES = { upload: pageUpload, jobs: pageJobs, review: pageReviewList, verify: pageVerifyList, bank: pageBank, failed: pageFailed, builder: pageBuilder };
window.QB = {
  async init(key, root) {
    S.root = root;
    root.innerHTML = `<div class="empty">Loading…</div>`;
    try { await loadTaxonomy(); await PAGES[key](root); } catch (e) { root.innerHTML = `<div class="empty bad">${esc(e.message)}</div>`; console.error(e); }
  },
  counts: async () => (await sb.rpc("qb_overview")).data,
};
if (window.QB_PENDING) { const [k, r] = window.QB_PENDING; window.QB_PENDING = null; window.QB.init(k, r); }

// ---------- Upload Documents ----------
async function pageUpload(root) {
  const subj = S.tax.subjects[0]?.id;
  root.innerHTML = `<div class="notice"><b>Nothing is verified by uploading.</b> Files are read in this browser with free, open-source tools (PDF.js, Tesseract OCR, JSZip, SheetJS) — nothing is sent to an AI service. Each original file is stored unchanged with its SHA-256 fingerprint, and every extracted question waits in <b>Review &amp; Edit</b>.</div>
  <div class="card"><h3 class="ctitle">Upload documents</h3><p class="csub">PDF (text or scanned), Word (.docx) and Excel (.xlsx, SIR template) — up to 50 MB each. For Excel rows that name an <code>Image_Ref</code>, add those image files to the same upload.</p>
   <div class="formgrid">
    <div class="full"><label class="darklabel">Files</label><input class="lightfield" type="file" id="upFiles" multiple accept=".pdf,.docx,.xlsx,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"></div>
    <div><label class="darklabel">Subject (default for all files)</label><select class="lightfield" id="upSubject">${subjectOpts(subj)}</select></div>
    <div><label class="darklabel">Chapter (optional)</label><select class="lightfield" id="upChapter">${chapterOpts(subj, null, "Mixed / suggest per question")}</select></div>
    <div><label class="darklabel">Source name</label><input class="lightfield" id="upSource" placeholder="e.g. RCC Electrostatics-I"></div>
    <div><label class="darklabel">PDF pages (optional)</label><input class="lightfield" id="upPages" placeholder="All, or e.g. 1-5, 9"></div>
    <div class="full"><label class="checkline"><input type="checkbox" id="upMathOcr"> Read formulas with the SIR Math OCR helper on this PC (scanned PDFs only — start <code>start_helper.bat</code> first; see tools/mathocr/README.md)</label></div>
    <div class="full"><label class="darklabel">Exam suitability</label><div class="toolbar" style="margin:0">${S.tax.examTags.map((t) => `<label class="checkline"><input type="checkbox" value="${esc(t.id)}" data-upexam> ${esc(t.label)}</label>`).join("")}</div></div>
   </div>
   <div id="upList" style="margin-top:12px"></div>
   <div class="toolbar"><button class="btn primary" id="upStart" disabled>Upload and extract</button><button class="btn outline" id="upTemplate">Download Excel template</button></div>
   <div id="upLog"></div></div>`;
  $("#upSubject", root).onchange = (e) => { $("#upChapter", root).innerHTML = chapterOpts(e.target.value, null, "Mixed / suggest per question"); };
  $("#upTemplate", root).onclick = () => (typeof downloadTemplate === "function" ? downloadTemplate() : toast("Template not available"));
  const files = () => [...$("#upFiles", root).files];
  $("#upFiles", root).onchange = () => {
    const { docs, images, rejected } = classifyFiles(files());
    $("#upList", root).innerHTML = `<div class="tablewrap"><table><thead><tr><th>File</th><th>Type</th><th>Size</th><th>Status</th></tr></thead><tbody>${[...docs.map((f) => [f, f.kind, "ready"]), ...images.map((f) => [f, "image (for Excel Image_Ref)", "ready"]), ...rejected.map(([f, why]) => [f, "—", why])].map(([f, k, st]) => `<tr><td>${esc(f.name)}</td><td>${esc(k)}</td><td>${(f.size / 1048576).toFixed(2)} MB</td><td>${st === "ready" ? '<span class="tag">ready</span>' : `<span class="tag red">${esc(st)}</span>`}</td></tr>`).join("")}</tbody></table></div>`;
    $("#upStart", root).disabled = !docs.length;
  };
  $("#upStart", root).onclick = async (e) => {
    const startBtn = e.currentTarget; // currentTarget is cleared after the first await
    startBtn.disabled = true;
    const { docs, images } = classifyFiles(files());
    const common = { subject: $("#upSubject", root).value, chapterId: $("#upChapter", root).value || null, sourceLabel: $("#upSource", root).value.trim(),
      exam: $$("[data-upexam]:checked", root).map((x) => x.value), pages: $("#upPages", root).value, mathOcr: $("#upMathOcr", root).checked };
    for (const f of docs) {
      const row = document.createElement("div"); row.className = "card"; row.style.marginTop = "10px";
      row.innerHTML = `<b>${esc(f.name)}</b><div class="msg" data-s>Starting…</div><div class="qb-progress"><div></div></div>`;
      $("#upLog", root).appendChild(row);
      const status = (t, pct) => { $("[data-s]", row).textContent = t; if (pct != null) $(".qb-progress div", row).style.width = pct + "%"; };
      try { await processFile(f, f.kind, { ...common, images }, status); }
      catch (err) { console.error(err); status(`Failed: ${err.message}`, 100); $("[data-s]", row).className = "msg bad"; }
    }
    startBtn.disabled = false;
  };
}
function classifyFiles(list) {
  const docs = [], images = [], rejected = [];
  for (const f of list) {
    const ext = f.name.toLowerCase().split(".").pop();
    if (f.size > MAX_BYTES) { rejected.push([f, "larger than 50 MB"]); continue; }
    if (ext === "pdf" && (!f.type || f.type === "application/pdf")) docs.push(Object.assign(f, { kind: "pdf" }));
    else if (ext === "docx") docs.push(Object.assign(f, { kind: "docx" }));
    else if (ext === "xlsx") docs.push(Object.assign(f, { kind: "xlsx" }));
    else if (/^image\//.test(f.type) && WEB_IMAGE.test(f.type)) images.push(f);
    else rejected.push([f, ext === "doc" || ext === "xls" ? "old Office format — save as .docx/.xlsx" : "unsupported file type"]);
  }
  return { docs, images, rejected };
}
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const safeName = (n) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
const MIME_OF = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

async function storePrivate(path, blob, mime, job, kind, extra = {}) {
  const { error } = await sb.storage.from("qb-import").upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(`Could not store ${path.split("/").pop()}: ${error.message}`);
  const { error: ae } = await sb.from("qb_question_assets").insert({ import_job_id: job.id, bucket: "qb-import", path, kind, mime_type: mime, byte_size: blob.size, created_by: T.userId(), ...extra });
  if (ae) throw ae;
}

let ocrWorker = null;
async function processFile(file, kind, opts, status) {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  const { data: dupJob } = await sb.from("qb_import_jobs").select("id,file_name,created_at").eq("original_sha256", hash).neq("status", "cancelled").limit(1);
  if (dupJob?.length && !confirm(`${file.name} was already uploaded (${dupJob[0].file_name}, ${new Date(dupJob[0].created_at).toLocaleDateString()}). Upload it again?`)) { status("Skipped — already uploaded", 100); return; }
  const { data: job, error } = await sb.from("qb_import_jobs").insert({
    file_name: file.name, file_type: kind, original_sha256: hash, original_size: file.size, subject_id: opts.subject, chapter_id: opts.chapterId,
    source_label: opts.sourceLabel || file.name.replace(/\.[^.]+$/, ""), exam_tags: opts.exam, status: "uploaded", created_by: T.userId(),
  }).select().single();
  if (error) throw error;
  try {
    status("Storing the original file unchanged…", 5);
    const origPath = `jobs/${job.id}/original/${safeName(file.name)}`;
    await storePrivate(origPath, new Blob([buf], { type: MIME_OF[kind] }), MIME_OF[kind], job, "original", { sha256: hash });
    await sb.from("qb_import_jobs").update({ original_path: origPath, status: "processing" }).eq("id", job.id);

    const ctx = { subject: opts.subject, chapter: chapterById(opts.chapterId)?.slug ?? null, exam: opts.exam, sourceLabel: job.source_label };
    let items;
    if (kind === "pdf") items = await extractPdf(buf, job, ctx, opts, status);
    else if (kind === "docx") items = await extractDocx(buf, job, ctx, status);
    else items = await extractXlsx(buf, job, ctx, opts, status);

    status("Checking for duplicates and suggesting topics…", 92);
    await finishItems(items, job, opts);
    const rows = items.map((it, i) => ({ job_id: job.id, page_no: it.page_no, seq: i + 1, source_number: it.source_number, source_location: it.source_location,
      extracted: it.extracted, draft: it.draft, confidence: it.confidence, issues: it.issues, blocking_issues: it.issues }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: ie } = await sb.from("qb_import_items").insert(rows.slice(i, i + 200));
      if (ie) throw ie;
    }
    await sb.from("qb_import_jobs").update({ status: rows.length ? "review_required" : "done", page_count: job.page_count || 1 }).eq("id", job.id);
    const low = items.filter((x) => x.confidence === "low").length;
    status(`Done: ${rows.length} question(s) extracted${low ? `, ${low} uncertain` : ""}. Open Review & Edit.`, 100);
  } catch (err) {
    await sb.from("qb_import_jobs").update({ status: "failed", error: String(err.message || err).slice(0, 1000) }).eq("id", job.id);
    throw err;
  }
}

function parsePageList(text, max) {
  if (!String(text || "").trim() || /^\s*all(\s+pages)?\s*$/i.test(text)) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set();
  for (const part of text.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Pages: cannot read "${part.trim()}"`);
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= max) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

async function extractPdf(buf, job, ctx, opts, status) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const pageNos = parsePageList(opts.pages, pdf.numPages);
  job.page_count = pageNos.length;
  await sb.from("qb_import_jobs").update({ page_count: pageNos.length }).eq("id", job.id);
  const pagesData = [];
  for (const [i, pageNo] of pageNos.entries()) {
    const label = `Page ${pageNo} (${i + 1}/${pageNos.length})`;
    const pct = (k) => 8 + ((i + k) / pageNos.length) * 80;
    try {
      status(`${label}: rendering…`, pct(0));
      const page = await pdf.getPage(pageNo);
      // Review image (stored, never altered afterwards).
      const canvas = await renderPage(page, 2200);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: canvas.width / vp1.width });
      const tc = await page.getTextContent();
      const chars = tc.items.reduce((s, it) => s + (it.str || "").trim().length, 0);
      let pd, conf = null, rawText;
      if (chars >= 80) {
        const lines = linesFromPdfItems(tc.items, vp, pageNo);
        pd = { page: pageNo, width: canvas.width, height: canvas.height, source: "text", lines };
        rawText = pageRecordText(pd);
      } else {
        // Scanned page: OCR a higher-resolution render, cleaned and
        // straightened copy (see tools/qb/ocr-page.mjs).
        if (!ocrWorker) { status("Loading the OCR engine (first time only)…", pct(0)); ocrWorker = await Tesseract.createWorker("eng"); }
        const big = await renderPage(page);
        const r = await ocrPage(ocrWorker, big, { status: (m) => status(`${label}: OCR — ${m}…`, pct(0.4)) });
        pd = { page: pageNo, width: r.width, height: r.height, source: "ocr", lines: r.lines, figures: r.figures, columns: r.columns };
        conf = r.conf; rawText = pageRecordText(pd, r.dropped || []);
      }
      pagesData.push(pd);
      status(`${label}: storing page image…`, pct(0.8));
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      const path = `jobs/${job.id}/pages/p${String(pageNo).padStart(4, "0")}.jpg`;
      await storePrivate(path, blob, "image/jpeg", job, "page", { page_no: pageNo });
      const { error: pe } = await sb.from("qb_import_pages").insert({ job_id: job.id, page_no: pageNo, image_path: path, width: canvas.width, height: canvas.height,
        text_source: pd.source, ocr_confidence: conf == null ? null : Math.round(conf * 100) / 100, line_count: pd.lines.length, raw_text: rawText,
        status: "done", extracted_at: new Date().toISOString() });
      if (pe) throw pe;
    } catch (err) {
      // A failed page is recorded and shown in Failed / Uncertain; other pages continue.
      await sb.from("qb_import_pages").upsert({ job_id: job.id, page_no: pageNo, status: "failed", error: String(err.message || err).slice(0, 500) }, { onConflict: "job_id,page_no" });
    }
  }
  status("Finding questions and options…", 90);
  const { questions } = segmentQuestions(pagesData, ctx);
  // Optional (Upload page checkbox): formulas in options re-read by the local SIR Math OCR helper
  // (tools/mathocr) running on this PC. Unticked, the helper is never contacted.
  let mathOcr = null;
  if (opts.mathOcr && pagesData.some((p) => p.source === "ocr")) {
    const health = await helperHealth();
    if (health) {
      status("Math OCR helper found — reading formulas from the page images…", 91);
      const stats = await runMathOcr(questions, pagesData, { renderPage: async (n) => renderPage(await pdf.getPage(n)), katex: window.katex, status: (m) => status(m, 91) });
      mathOcr = { version: MATH_OCR_VERSION, helper: health.version, model: health.model, stats };
    } else {
      status("Math OCR helper not reachable on this PC (is start_helper.bat running?) — formulas kept as read by Tesseract", 91);
    }
  }
  return questions.map((q) => { const it = toItem(q, q.page_from); if (mathOcr) { it.extracted.math = q.math || []; it.extracted.math_ocr = { version: mathOcr.version, helper: mathOcr.helper, model: mathOcr.model }; } return it; });
}

async function extractDocx(buf, job, ctx, status) {
  status("Reading the Word document…", 20);
  const d = await parseDocx(buf, { JSZip: window.JSZip, DOMParser: window.DOMParser });
  status(`Storing ${Object.keys(d.media).length} embedded image(s) unchanged…`, 50);
  const mediaPath = {};
  for (const [p, m] of Object.entries(d.media)) {
    const path = `jobs/${job.id}/media/${safeName(p.split("/").pop())}`;
    await storePrivate(path, new Blob([m.bytes], { type: m.mime }), m.mime, job, "media");
    mediaPath[p] = path;
  }
  await sb.from("qb_import_pages").insert({ job_id: job.id, page_no: 1, text_source: "docx", line_count: d.lines.length, raw_text: d.lines.map((l) => l.text).join("\n"), status: "done", extracted_at: new Date().toISOString() });
  status("Finding questions and options…", 80);
  const { questions } = segmentQuestions([{ page: 1, width: 1000, height: d.lines.length * 20 + 20, source: "docx", lines: d.lines }], ctx);
  const relink = (s) => String(s ?? "").replace(/\]\(docx-media:([^)\s]+)\)/g, (_, p) => `](import-media:${mediaPath[p] || p})`);
  return questions.map((q) => {
    const it = toItem(q, 1);
    it.draft.question = relink(it.draft.question);
    if (Array.isArray(it.draft.options)) it.draft.options.forEach((o) => o.text = relink(o.text));
    it.draft.solution = it.draft.solution ? relink(it.draft.solution) : null;
    for (const [p, m] of Object.entries(d.media)) {
      if (it.draft.question.includes(mediaPath[p]) && !WEB_IMAGE.test(m.mime)) it.issues.push(`Embedded ${m.mime} picture cannot be shown in browsers — retype it (e.g. as LaTeX) or replace it with PNG/SVG`);
    }
    it.issues.push(...d.warnings.filter((w) => /equation|Symbol/.test(w)));
    return it;
  });
}

async function extractXlsx(buf, job, ctx, opts, status) {
  status("Reading the spreadsheet…", 20);
  const attachments = new Map(opts.images.map((f) => [f.name.toLowerCase(), f]));
  const x = await parseXlsx(buf, { XLSX: window.XLSX, JSZip: window.JSZip }, { attachments: new Set(attachments.keys()) });
  const stored = {};
  for (const [name, f] of attachments) {
    const path = `jobs/${job.id}/media/${safeName(f.name)}`;
    await storePrivate(path, f, f.type, job, "media", { sha256: await sha256(await f.arrayBuffer()) });
    stored[name] = path;
  }
  await sb.from("qb_import_pages").insert({ job_id: job.id, page_no: 1, text_source: "xlsx", line_count: x.rows.length, raw_text: x.rows.map((r) => r.source_text).join("\n---\n"), status: "done", extracted_at: new Date().toISOString() });
  return x.rows.map((r) => {
    const subject = S.tax.subjects.some((s) => s.id === r.given.subject) ? r.given.subject : ctx.subject;
    const ch = matchChapter(subject, r.given.chapter) || chapterById(opts.chapterId);
    const tp = matchTopic(ch?.id, r.given.topic);
    const draft = { ...r.draft, subject, chapter: ch?.slug ?? null, topic: tp?.slug ?? null, exam: r.draft.exam.length ? r.draft.exam : ctx.exam,
      source: r.draft.source || `sheet:${job.source_label}:row ${r.row}`,
      question: r.draft.question.replace(/\]\(attach:([^)]+)\)/g, (_, n) => `](import-media:${stored[n.toLowerCase()] || n})`) };
    const issues = [...r.blocking, ...x.warnings];
    if (r.given.chapter && !ch) issues.push(`Chapter "${r.given.chapter}" is not in the SIR syllabus list — choose one`);
    if (r.given.topic && !tp) issues.push(`Topic "${r.given.topic}" is not in the SIR syllabus list — choose one`);
    return { page_no: 1, source_number: r.source_number, source_location: r.source_location, confidence: r.blocking.length ? "low" : "high", issues,
      extracted: { source_text: r.source_text, answer_source: r.answer_source, source_method: "xlsx", regions: [] }, draft };
  });
}

function toItem(q, pageNo) {
  return { page_no: pageNo, source_number: q.source_number, source_location: q.source_location, confidence: q.confidence, issues: [...q.issues],
    extracted: { regions: q.regions, source_text: q.source_text, ocr_raw: q.ocr_raw ?? null, answer_source: q.answer_source, section: q.section, section_no: q.section_no ?? 1, number: q.number ?? null,
      assumed: !!q.assumed, option_markers: q.option_markers ?? null, kind: q.kind ?? null, source_method: q.source_method, page_from: q.page_from, page_to: q.page_to, parser_version: PARSER_VERSION },
    draft: { ...q.draft, figures: (q.draft.figures || []).map((f) => ({ ...f, page: f.page ?? pageNo })) } };
}

const plainStem = (md) => String(md || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
async function finishItems(items, job, opts) {
  // Topic suggestions — always marked and must be confirmed.
  for (const it of items) {
    if (!it.draft.topic) {
      const sg = suggestClassification(it.draft.question, S.taxonomy, it.draft.subject, it.draft.chapter);
      if (sg) {
        it.draft.chapter = sg.chapter; it.draft.topic = sg.topic;
        it.extracted.suggestion = { chapter: sg.chapter, topic: sg.topic, basis: sg.basis };
        it.issues.push(`Chapter/topic SUGGESTED automatically (${sg.chapterName} → ${sg.label}; ${sg.basis}) — confirm or change`);
      }
    }
  }
  // Duplicates: inside this upload and against the bank.
  const stems = items.map((it) => plainStem(it.draft.question));
  const seen = new Map();
  stems.forEach((s, i) => { const k = s.toLowerCase(); if (k.length >= 12 && seen.has(k)) items[i].issues.push(`Same text as question ${items[seen.get(k)].source_number} in this file`); else seen.set(k, i); });
  for (let i = 0; i < stems.length; i += 50) {
    const { data, error } = await sb.rpc("qb_find_similar", { p_texts: stems.slice(i, i + 50), p_subject: opts.subject, p_threshold: 0.6 });
    if (error) throw error;
    for (const m of data || []) items[i + m.idx - 1].issues.push(`Possible duplicate of ${m.code} (${Math.round(m.similarity * 100)}% similar)`);
  }
}

// ---------- Extraction Jobs ----------
async function pageJobs(root) {
  const { data, error } = await sb.from("qb_import_jobs").select("*, qb_import_pages(status,text_source), qb_import_items(status)").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  root.innerHTML = `<div class="card"><h3 class="ctitle">Extraction jobs</h3><p class="csub">One job per uploaded file. Originals are kept unchanged (download to compare).</p>${data.length ? `<div class="tablewrap"><table><thead><tr><th>File</th><th>Type</th><th>Status</th><th>Pages</th><th>Questions</th><th>Uploaded</th><th></th></tr></thead><tbody>${data.map((j) => {
    const pg = j.qb_import_pages || [], it = j.qb_import_items || [];
    const open = it.filter((x) => ["review_required", "corrected", "returned"].includes(x.status)).length, ver = it.filter((x) => x.status === "verified").length;
    return `<tr><td><b>${esc(j.source_label || j.file_name)}</b><br><span style="color:var(--m)">${esc(j.file_name)} · sha256 ${esc((j.original_sha256 || "").slice(0, 12))}…</span>${j.error ? `<br><span class="bad">${esc(j.error)}</span>` : ""}</td>
      <td>${esc(j.file_type)}</td><td><span class="tag ${j.status === "failed" ? "red" : j.status === "done" ? "" : "amber"}">${esc(JOB_LABEL[j.status] || j.status)}</span></td>
      <td>${pg.filter((p) => p.status === "done").length}${pg.some((p) => p.status === "failed") ? ` <span class="tag red">${pg.filter((p) => p.status === "failed").length} failed</span>` : ""}${pg.some((p) => p.text_source === "ocr") ? ` <span class="tag blue">OCR</span>` : ""}</td>
      <td>${it.length} · ${open} open · ${ver} verified</td><td>${esc(new Date(j.created_at).toLocaleString())}</td>
      <td>${it.length ? `<button class="btn primary small" data-recon="${esc(j.id)}">Reconciliation</button> ` : ""}${j.original_path ? `<button class="btn outline small" data-orig="${esc(j.original_path)}" data-name="${esc(j.file_name)}">Original</button>` : ""} ${["uploaded", "processing"].includes(j.status) ? `<button class="btn danger small" data-cancel="${esc(j.id)}" title="Interrupted upload">Cancel</button>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>` : `<div class="empty">No uploads yet.</div>`}</div><div id="reconBox"></div>`;
  $$("[data-recon]", root).forEach((b) => b.onclick = () => showReconciliation($("#reconBox", root), b.dataset.recon).catch(fail));
  $$("[data-orig]", root).forEach((b) => b.onclick = async () => {
    const { data: blob, error: de } = await sb.storage.from("qb-import").download(b.dataset.orig);
    if (de) return fail(de);
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: b.dataset.name }); a.click();
  });
  $$("[data-cancel]", root).forEach((b) => b.onclick = async () => { const { error: ce } = await sb.from("qb_import_jobs").update({ status: "cancelled" }).eq("id", b.dataset.cancel); if (ce) return fail(ce); pageJobs(root); });
}

// What the numbering in the source says vs what was extracted. A finished
// job is not a complete extraction: this lists everything that is missing,
// doubtful or still to be checked.
async function showReconciliation(box, jobId) {
  box.innerHTML = `<div class="empty">Building the report…</div>`;
  const [{ data: items, error: ie }, { data: pages, error: pe }, { data: job }] = await Promise.all([
    sb.from("qb_import_items").select("source_number,status,issues,extracted,draft").eq("job_id", jobId).order("seq"),
    sb.from("qb_import_pages").select("page_no,status").eq("job_id", jobId),
    sb.from("qb_import_jobs").select("file_name,source_label").eq("id", jobId).single(),
  ]);
  if (ie || pe) throw ie || pe;
  const num = (i) => i.extracted?.number ?? (/^\d+$/.test(String(i.source_number || "").replace("?", "")) ? Number(String(i.source_number).replace("?", "")) : null);
  const r = reconcileExtraction(items.map((i) => ({ source_number: i.source_number, section_no: i.extracted?.section_no ?? 1, number: num(i), assumed: i.extracted?.assumed ?? /\?$/.test(i.source_number || ""),
    page_from: i.extracted?.page_from, issues: i.issues, type: i.draft?.type, question: i.draft?.question, options: i.draft?.options, figures: i.draft?.figures, kind: i.extracted?.kind })), pages);
  const old = !items.some((i) => i.extracted?.section_no != null);
  const versions = [...new Set(items.map((i) => i.extracted?.parser_version || "before version stamps"))];
  const KIND = { mcq: "options found", assertion_reason: "Assertion–Reason", descriptive: "descriptive (not auto-gradable)", unknown: "no options, kind unclear" };
  const listCell = (a) => a.length ? `<span class="tag red">${a.length}</span> <span style="color:var(--m)">${esc(a.slice(0, 40).join(", "))}${a.length > 40 ? " …" : ""}</span>` : `<span class="tag">0</span>`;
  const byStatus = items.reduce((m, i) => (m[i.status] = (m[i.status] || 0) + 1, m), {});
  box.innerHTML = `<div class="card" style="margin-top:14px"><h3 class="ctitle">Reconciliation — ${esc(job?.source_label || job?.file_name || "")}</h3>
    <p class="csub">Counts come from the question numbers read in the source. A question whose number was not read and that was not recovered from the page layout stays inside the item before it: those items are listed under "Possibly merged or split". Compare the last page of each section, and check every item against the page.</p>
    ${old ? `<div class="notice">This file was extracted before sections were tracked: numbers that restart (Classwork, Assignment, …) all count as one section here. Re-upload it for an exact report.</div>` : ""}
    <div class="tablewrap"><table><tbody>
      <tr><th>Pages</th><td>${r.pages.processed} processed${r.pages.failed.length ? ` · <span class="bad">failed: ${esc(r.pages.failed.join(", "))}</span>` : " · none failed"}</td></tr>
      <tr><th>Extracted items (raw)</th><td>${r.items} (${esc(Object.entries(byStatus).map(([k, v]) => `${v} ${ITEM_LABEL[k] || k}`).join(", "))})</td></tr>
      <tr><th>Different question numbers found</th><td>${r.unique_numbers}${r.duplicate_total ? ` · <span class="bad">${r.duplicate_total} number(s) found twice</span>` : ""}${r.unnumbered_total ? ` · ${r.unnumbered_total} item(s) without a number` : ""} — one printed question split into two items still counts once</td></tr>
      <tr><th>Questions implied by numbering</th><td>${r.numbering_total} (sum of the highest number in each section)</td></tr>
      <tr><th>Missing numbers</th><td>${r.missing_total}</td></tr>
      <tr><th>Kinds</th><td>${esc(Object.entries(r.kinds).map(([k, v]) => `${v} ${KIND[k] || k}`).join(" · "))}</td></tr>
      <tr><th>Extracted by</th><td>parser ${esc(versions.join(", "))}</td></tr>
      <tr><th>Possibly merged or split</th><td>${listCell(r.merged_or_split)}</td></tr>
      <tr><th>Options not 4 / empty option</th><td>${listCell(r.option_problems)}</td></tr>
      <tr><th>No options found</th><td>${listCell(r.no_options)}</td></tr>
      <tr><th>Uncertain formulas / exponents</th><td>${listCell(r.uncertain_math)}</td></tr>
      <tr><th>Diagrams to confirm</th><td>${listCell(r.diagrams_to_confirm)}</td></tr>
      <tr><th>Diagram mentioned, none found</th><td>${listCell(r.diagram_mentioned_missing)}</td></tr>
    </tbody></table></div>
    <h3 class="ctitle" style="margin-top:12px">By section</h3>
    <div class="tablewrap"><table><thead><tr><th>Section</th><th>Pages</th><th>Items</th><th>Highest no.</th><th>Missing numbers</th><th>Repeated numbers</th><th>Assumed numbers</th><th>Unnumbered</th></tr></thead><tbody>
    ${r.sections.map((s) => `<tr><td>${s.section}</td><td>${s.pages ? `${s.pages[0]}–${s.pages[1]}` : "—"}</td><td>${s.items}</td><td>${s.highest}</td><td>${s.missing.length ? `<span class="bad">${esc(s.missing.join(", "))}</span>` : "none"}</td><td>${s.duplicates.length ? `<span class="bad">${esc(s.duplicates.join(", "))}</span>` : "none"}</td><td>${s.assumed.length ? esc(s.assumed.join(", ")) : "none"}</td><td>${s.unnumbered}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

// ---------- Review & Edit / Verification Queue lists ----------
// opts.onReject: show a Reject button per row (existing server function
// qb_reject_import_item: open items only, records who/when/why).
async function itemList(root, statuses, title, sub, opts = {}) {
  const { data, error } = await sb.from("qb_import_items").select("id,job_id,seq,source_number,source_location,status,confidence,issues,review_note,draft,qb_import_jobs(source_label,file_name,file_type)")
    .in("status", statuses).order("job_id").order("seq").limit(500);
  if (error) throw error;
  const box = document.createElement("div"); box.className = "card";
  box.innerHTML = `<h3 class="ctitle">${esc(title)} (${data.length})</h3><p class="csub">${esc(sub)}</p>${data.length ? `<div class="tablewrap"><table><thead><tr><th>Source</th><th>Location</th><th>Question</th><th>Status</th><th>Warnings</th><th></th></tr></thead><tbody>${data.map((i) => `<tr>
    <td>${esc(i.qb_import_jobs?.source_label || i.qb_import_jobs?.file_name)}<br><span style="color:var(--m)">${esc(i.qb_import_jobs?.file_type)}</span></td>
    <td>${esc(i.source_location || "")} · Q${esc(i.source_number || "?")}</td><td>${esc(plainStem(i.draft?.question).slice(0, 110))}</td>
    <td><span class="tag ${i.status === "returned" ? "red" : "amber"}">${esc(ITEM_LABEL[i.status])}</span>${i.confidence === "low" ? ' <span class="tag red">uncertain</span>' : ""}${i.review_note ? `<br><span style="color:var(--m)">${esc(i.review_note)}</span>` : ""}</td>
    <td>${(i.issues || []).length}</td><td style="white-space:nowrap"><button class="btn primary small" data-item="${esc(i.id)}">Open</button>${opts.onReject ? ` <button class="btn danger small" data-rej="${esc(i.id)}" data-label="${esc(`Q${i.source_number || "?"} · ${i.source_location || ""}`)}">Reject</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Nothing here.</div>`}`;
  root.appendChild(box);
  $$("[data-item]", box).forEach((b) => b.onclick = () => openItem(b.dataset.item, data.map((x) => x.id)).catch(fail));
  $$("[data-rej]", box).forEach((b) => b.onclick = async () => {
    const reason = prompt(`Reject ${b.dataset.label}?\n\nReason (duplicate, not a question, unreadable, subjective…):`);
    if (reason === null) return; // cancelled
    if (!confirm(`Reject ${b.dataset.label}? It leaves the review queues and can never be verified or added to a test. The source file and page images are not touched.`)) return;
    b.disabled = true;
    const { error: je } = await sb.rpc("qb_reject_import_item", { p_item_id: b.dataset.rej, p_reason: reason.trim() || null });
    if (je) { b.disabled = false; return fail(je); }
    toast(`${b.dataset.label} rejected`);
    opts.onReject();
  });
}

// Rejected items (status "rejected", not deleted). Restore puts one back in
// Review & Edit; Delete hides it (soft delete — the row and every file stay;
// an admin can bring it back). Before the restore/delete database update is
// applied, the list is read-only.
async function rejectedCard(card, onChange) {
  const cols = "id,source_number,source_location,review_note,reviewed_at,draft,qb_import_jobs(source_label,file_name)";
  let actions = true;
  let { data, error } = await sb.from("qb_import_items").select(cols + ",history").eq("status", "rejected").is("deleted_at", null).order("reviewed_at", { ascending: false }).limit(200);
  if (error && /deleted_at|history/.test(error.message)) {
    actions = false;
    ({ data, error } = await sb.from("qb_import_items").select(cols).eq("status", "rejected").order("reviewed_at", { ascending: false }).limit(200));
  }
  if (error) { card.innerHTML = `<div class="empty bad">${esc(error.message)}</div>`; return; }
  const label = (i) => `Q${i.source_number || "?"} · ${i.source_location || ""}`;
  card.innerHTML = `<details${S.rejectedOpen ? " open" : ""}><summary class="ctitle" style="cursor:pointer">Rejected extractions (${data.length}${data.length === 200 ? "+" : ""})</summary>
    <p class="csub">Kept with the reason and time; they cannot be verified or added to tests. ${actions ? "Restore sends one back to Review &amp; Edit. Delete hides it from this list — the source PDF, page images and question images are never removed." : "Restore and Delete become available after the database update."}</p>
    ${data.length ? `<div class="tablewrap"><table><thead><tr><th>Source</th><th>Location</th><th>Question</th><th>Reason</th><th>Rejected</th>${actions ? "<th></th>" : ""}</tr></thead><tbody>${data.map((i) => `<tr>
      <td>${esc(i.qb_import_jobs?.source_label || i.qb_import_jobs?.file_name || "")}</td><td>${esc(i.source_location || "")} · Q${esc(i.source_number || "?")}</td>
      <td>${esc(plainStem(i.draft?.question).slice(0, 110))}</td><td>${esc(i.review_note || "—")}</td><td>${i.reviewed_at ? esc(new Date(i.reviewed_at).toLocaleString()) : "—"}</td>
      ${actions ? `<td style="white-space:nowrap"><button class="btn outline small" data-restore="${esc(i.id)}" data-label="${esc(label(i))}">Restore</button> <button class="btn danger small" data-del="${esc(i.id)}" data-label="${esc(label(i))}">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">None.</div>`}
  </details>`;
  $("details", card).ontoggle = (e) => { S.rejectedOpen = e.target.open; };
  const run = async (b, fn, args, done) => {
    b.disabled = true;
    const { error: e } = await sb.rpc(fn, args);
    if (e) { b.disabled = false; return fail(e); }
    toast(done); onChange();
  };
  $$("[data-restore]", card).forEach((b) => b.onclick = () => {
    const note = prompt(`Restore ${b.dataset.label} to Review & Edit?\n\nNote (optional):`);
    if (note === null || !confirm(`Restore ${b.dataset.label}? It goes back to Review & Edit and must be checked and verified again.`)) return;
    run(b, "qb_restore_import_item", { p_item_id: b.dataset.restore, p_note: note.trim() || null }, `${b.dataset.label} restored to Review & Edit`);
  });
  $$("[data-del]", card).forEach((b) => b.onclick = () => {
    const typed = prompt(`Delete ${b.dataset.label}?\n\nIt disappears from this list. Files are not removed and an admin can bring it back.\nType DELETE to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== "DELETE") { toast("Not deleted — type DELETE to confirm"); return; }
    run(b, "qb_delete_import_item", { p_item_id: b.dataset.del, p_reason: null }, `${b.dataset.label} deleted`);
  });
}
async function pageReviewList(root) {
  root.innerHTML = "";
  await itemList(root, ["review_required", "returned"], "Review & Edit", "Extracted questions that need checking against their source. Correct them and save, or verify directly.");
}
async function pageVerifyList(root) {
  root.innerHTML = "";
  await itemList(root, ["corrected"], "Corrected imports awaiting verification", "Verifying runs every gate on the server and adds the question to the final bank.");
  const { data, error } = await sb.from("qb_questions").select("*").eq("status", "draft").order("updated_at", { ascending: false }).limit(200);
  if (error) throw error;
  const box = document.createElement("div"); box.className = "card"; box.style.marginTop = "14px";
  box.innerHTML = `<h3 class="ctitle">Draft questions (${data.length})</h3><p class="csub">Created in the editor, uploaded as Markdown, returned for correction, or edited after verification.</p>`;
  if (!data.length) box.insertAdjacentHTML("beforeend", `<div class="empty">No drafts.</div>`);
  for (const row of data) box.appendChild(bankCard(row));
  root.appendChild(box);
}

// ---------- Item review screen ----------
async function openItem(itemId, queue = []) {
  const root = S.root;
  const { data: item, error } = await sb.from("qb_import_items").select("*, qb_import_jobs(*)").eq("id", itemId).single();
  if (error) throw error;
  const job = item.qb_import_jobs, ex = item.extracted || {};
  const draft = structuredClone(item.draft);
  const figures = (draft.figures || []).map((f) => ({ ...f, box: [...f.box] }));
  const { data: pages } = await sb.from("qb_import_pages").select("page_no,image_path,ocr_confidence,text_source").eq("job_id", job.id).order("page_no");
  const regions = ex.regions || [];
  const pageImgs = {};
  const loadImg = async (path) => {
    const { data: blob, error: de } = await sb.storage.from("qb-import").download(path);
    if (de) throw de;
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode(); return img;
  };
  const mathItems = (ex.math || []).filter((m) => m.box);
  for (const pg of new Set([...regions.map((r) => r.page), ...figures.map((f) => f.page), ...mathItems.map((m) => m.page)])) {
    const p = pages?.find((x) => x.page_no === pg);
    if (p?.image_path) pageImgs[pg] = await loadImg(p.image_path);
  }
  // Source media (DOCX/XLSX images) as data URLs for preview.
  const media = {};
  for (const m of new Set([...JSON.stringify(draft).matchAll(/import-media:([^)\s"\\]+)/g)].map((x) => x[1]))) {
    const { data: blob } = await sb.storage.from("qb-import").download(m);
    if (blob) media[m] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  }
  const crop = (f) => {
    const img = pageImgs[f.page]; if (!img) return null;
    const [x0, y0, x1, y1] = f.box.map((v) => Math.max(0, Math.min(1000, Number(v) || 0)));
    const sx = (x0 / 1000) * img.naturalWidth, sy = (y0 / 1000) * img.naturalHeight, sw = Math.max(4, ((x1 - x0) / 1000) * img.naturalWidth), sh = Math.max(4, ((y1 - y0) / 1000) * img.naturalHeight);
    const c = document.createElement("canvas"); c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); return c;
  };
  const maps = () => ({ figures: Object.fromEntries(figures.map((f) => [f.label, crop(f)?.toDataURL("image/png") || placeholder("Figure — no page image")])), media });

  const { data: dups } = await sb.rpc("qb_find_similar", { p_texts: [plainStem(draft.question)], p_subject: draft.subject, p_threshold: 0.55 });
  const pageMeta = pages?.find((p) => p.page_no === item.page_no);
  const method = { text: "PDF text layer (exact characters)", ocr: `OCR (Tesseract)${pageMeta?.ocr_confidence ? `, page confidence ${Math.round(pageMeta.ocr_confidence)}%` : ""}`, docx: "Word document (exact text, equations converted)", xlsx: "Excel template row" }[ex.source_method] || ex.source_method;
  const idx = queue.indexOf(itemId);

  root.innerHTML = `<div class="toolbar"><button class="btn outline small" data-back>‹ Back to list</button>${idx > 0 ? `<button class="btn outline small" data-prev>Previous</button>` : ""}${idx >= 0 && idx < queue.length - 1 ? `<button class="btn outline small" data-next>Next</button>` : ""}<span class="tag amber">${esc(ITEM_LABEL[item.status])}</span>${item.confidence ? `<span class="tag ${item.confidence === "low" ? "red" : item.confidence === "medium" ? "amber" : ""}">${esc(item.confidence)} confidence</span>` : ""}</div>
   <div class="notice"><b>${esc(job.source_label || job.file_name)}</b> · ${esc(item.source_location || "")} · question ${esc(item.source_number || "?")}${ex.section ? ` · ${esc(ex.section)}` : ""}<br>Read by: ${esc(method)} · ${ex.answer_source ? `answer from <b>${esc(ex.answer_source)}</b> (confirm it)` : "<b>no answer in the source</b> — enter it yourself"}${item.review_note ? `<br><b>Note:</b> ${esc(item.review_note)}` : ""}</div>
   <div class="qb-review"><div class="qb-source card"><div class="qb-pagewrap" data-page></div><details open style="margin-top:10px"><summary class="darklabel" style="cursor:pointer">${ex.ocr_raw ? "Text as read (exponents rebuilt from the page; [[?]] = could not be read)" : "Text exactly as read from the source"}</summary><pre class="qb-src">${esc(ex.source_text || "")}</pre></details>${ex.ocr_raw ? `<details style="margin-top:6px"><summary class="darklabel" style="cursor:pointer">Original OCR output (unchanged, for comparison)</summary><pre class="qb-src">${esc(ex.ocr_raw)}</pre></details>` : ""}<div data-figs></div></div>
    <div><div data-editor></div><div class="card" style="margin-top:12px" data-gates></div></div></div>`;
  $("[data-back]", root).onclick = () => (item.status === "corrected" ? pageVerifyList(root) : pageReviewList(root)).catch(fail);
  $("[data-prev]", root)?.addEventListener("click", () => openItem(queue[idx - 1], queue).catch(fail));
  $("[data-next]", root)?.addEventListener("click", () => openItem(queue[idx + 1], queue).catch(fail));

  // Source page with the question region and diagram crops.
  const wrap = $("[data-page]", root);
  let viewPage = regions[0]?.page ?? figures[0]?.page ?? null, cropping = null;
  const drawPage = () => {
    wrap.innerHTML = "";
    if (viewPage == null || !pageImgs[viewPage]) { wrap.innerHTML = `<div class="empty">${ex.source_method === "docx" || ex.source_method === "xlsx" ? "No page image for this file type — compare with the source text below." : "Page image unavailable."}</div>`; return; }
    const pageImg = pageImgs[viewPage].cloneNode();
    pageImg.draggable = false; // otherwise the browser's native image drag cancels the crop gesture
    wrap.appendChild(pageImg);
    const box = (b, cls, label) => { const d = document.createElement("div"); d.className = cls; Object.assign(d.style, { left: b[0] / 10 + "%", top: b[1] / 10 + "%", width: (b[2] - b[0]) / 10 + "%", height: (b[3] - b[1]) / 10 + "%" }); if (label) d.innerHTML = `<span>${esc(label)}</span>`; wrap.appendChild(d); };
    regions.filter((r) => r.page === viewPage).forEach((r) => box(r.box, "qb-region"));
    figures.filter((f) => f.page === viewPage).forEach((f) => box(f.box, "qb-fbox", `Figure ${f.label}`));
    mathItems.filter((m) => m.page === viewPage).forEach((m) => box(m.box, "qb-mbox", m.target === "option" ? m.key : m.key));
  };
  let start = null, sel = null;
  const pt = (e) => { const rc = wrap.getBoundingClientRect(); return [Math.round(((e.clientX - rc.left) / rc.width) * 1000), Math.round(((e.clientY - rc.top) / rc.height) * 1000)]; };
  wrap.ondragstart = (e) => e.preventDefault();
  wrap.onpointerdown = (e) => { if (cropping == null || !pageImgs[viewPage]) return; e.preventDefault(); start = pt(e); sel = document.createElement("div"); sel.className = "qb-sel"; wrap.appendChild(sel); wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = (e) => { if (!start) return; const [x, y] = pt(e); Object.assign(sel.style, { left: Math.min(x, start[0]) / 10 + "%", top: Math.min(y, start[1]) / 10 + "%", width: Math.abs(x - start[0]) / 10 + "%", height: Math.abs(y - start[1]) / 10 + "%" }); };
  wrap.onpointerup = (e) => {
    if (!start) return; const [x, y] = pt(e);
    if (Math.abs(x - start[0]) > 8 && Math.abs(y - start[1]) > 8) { figures[cropping].box = [Math.min(x, start[0]), Math.min(y, start[1]), Math.max(x, start[0]), Math.max(y, start[1])]; figures[cropping].page = viewPage; delete figures[cropping].pending; delete figures[cropping].proposed; }
    sel.remove(); start = null; cropping = null; wrap.style.cursor = "";
    renderFigs(); rebuild();
  };
  const renderFigs = () => {
    drawPage();
    const panel = $("[data-figs]", root);
    const pageBtns = [...new Set(regions.map((r) => r.page))];
    panel.innerHTML = `${pageBtns.length > 1 ? `<div class="toolbar">${pageBtns.map((p) => `<button class="btn outline small" data-pg="${p}">Page ${p}</button>`).join("")}</div>` : ""}
      ${viewPage != null && pageImgs[viewPage] ? `<div class="darklabel">Diagrams (cropped from the page — the original page is never altered)</div><div class="qb-figs">${figures.map((f, i) => `<div class="qb-fig" data-fig="${i}"><div data-c></div>Figure ${esc(f.label)} · page ${f.page}<div class="toolbar" style="margin:4px 0 0">${f.proposed ? `<button class="btn gold small" data-confirm="${i}">Confirm crop</button>` : ""}<button class="btn outline small" data-crop="${i}">Re-crop</button><button class="btn danger small" data-rm="${i}">✕</button></div></div>`).join("")}</div><button class="btn outline small" data-addfig>+ Add diagram from page</button>` : ""}`;
    figures.forEach((f, i) => { const c = crop(f); if (c) $(`[data-fig="${i}"] [data-c]`, panel).appendChild(c); });
    $$("[data-pg]", panel).forEach((b) => b.onclick = () => { viewPage = Number(b.dataset.pg); drawPage(); });
    $$("[data-crop]", panel).forEach((b) => b.onclick = () => { cropping = Number(b.dataset.crop); viewPage = figures[cropping].page; drawPage(); wrap.style.cursor = "crosshair"; toast(`Drag over Figure ${figures[cropping].label} on the page`); });
    figures.forEach((f, i) => {
      if (f.pending) $(`[data-fig="${i}"]`, panel)?.insertAdjacentHTML("afterbegin", `<span class="tag red">crop not set — drag on the page</span>`);
      else if (f.proposed) $(`[data-fig="${i}"]`, panel)?.insertAdjacentHTML("afterbegin", `<span class="tag amber">detected automatically — confirm, re-crop or remove</span>`);
    });
    $$("[data-confirm]", panel).forEach((b) => b.onclick = () => { delete figures[Number(b.dataset.confirm)].proposed; current = editor.getQ(); renderFigs(); rebuild(false); });
    $$("[data-rm]", panel).forEach((b) => b.onclick = () => {
      const [f] = figures.splice(Number(b.dataset.rm), 1);
      current = editor.getQ(); current.question = current.question.replace(new RegExp(`\\n*!\\[[^\\]]*\\]\\(figure:${f.label}\\)`, "g"), "");
      renderFigs(); rebuild(false);
    });
    $("[data-addfig]", panel)?.addEventListener("click", () => {
      current = editor.getQ();
      const label = String(figures.reduce((m, f) => Math.max(m, Number(f.label) || 0), 0) + 1);
      // "pending" until the coordinator drags the crop: a default box is never saved.
      figures.push({ label, page: viewPage, option_key: null, box: [100, 100, 400, 300], description: "", pending: true });
      current.question += `\n\n![Figure ${label}](figure:${label})`;
      cropping = figures.length - 1; wrap.style.cursor = "crosshair";
      renderFigs(); rebuild(false); toast(`Drag over the diagram for Figure ${label}`);
    });
  };

  // Editor + gates panel
  let editor, current = draft;
  const rebuild = (keep = true) => {
    if (keep && editor) current = editor.getQ();
    editor = questionEditor(current, { maps: maps() });
    const host = $("[data-editor]", root); host.innerHTML = ""; host.appendChild(editor.el);
  };
  rebuild(false); renderFigs();

  // Formulas read from the page by the Math OCR helper — source
  // crop beside the recognised formula, with the original OCR text kept.
  if ((ex.math || []).length) {
    const card = document.createElement("div");
    card.className = "qb-math"; card.setAttribute("data-math", "");
    const TAG = { agreed: ["", "read the same 3 times"], uncertain: ["amber", "UNCERTAIN — compare"], failed: ["red", "could not be read"], text: ["", "words — left as text"], not_located: ["red", "option not found on the page"] };
    card.innerHTML = `<div class="darklabel" style="margin-top:10px">Formulas read from the page (Math OCR ${esc(ex.math_ocr?.version || "")}) — compare each crop with the formula</div>`
      + ex.math.map((m, i) => `<div class="qb-mrow" data-mi="${i}"><div class="qb-mhead"><b>${m.target === "option" ? `Option ${esc(m.key)}` : `Question text ${esc(m.key)}`}</b> <span class="tag ${TAG[m.status]?.[0] ?? ""}">${esc(TAG[m.status]?.[1] ?? m.status)}</span>${m.applied ? ` <span class="tag">put into the option</span>` : ""}</div>
        <div class="qb-mpair"><div data-mc></div><div data-mf></div></div>
        ${m.reasons?.length ? `<div class="csub">${esc(m.reasons.join("; "))}</div>` : ""}
        <div class="csub">OCR text before: <code>${esc(m.ocr_text || "—")}</code>${m.alternatives?.length ? ` · other readings: ${m.alternatives.map((a) => `<code>${esc(a)}</code>`).join(", ")}` : ""}</div>
        ${m.latex && m.target === "option" ? `<button class="btn outline small" data-use="${i}">Use this formula in option ${esc(m.key)}</button>` : ""}${m.latex && m.target === "stem" ? `<button class="btn outline small" data-copy="${i}">Copy LaTeX</button>` : ""}</div>`).join("");
    $(".qb-source", root).appendChild(card);
    ex.math.forEach((m, i) => {
      const row = $(`[data-mi="${i}"]`, card);
      const c = m.box ? crop(m) : null;
      if (c) $("[data-mc]", row).appendChild(c); else $("[data-mc]", row).textContent = "no crop";
      if (m.latex && m.status !== "failed") $("[data-mf]", row).appendChild(mdDiv(`$${m.latex}$`));
      else if (m.latex) $("[data-mf]", row).innerHTML = `<span class="tag red">does not render</span><pre class="qb-src">${esc(m.latex)}</pre>`;
    });
    $$("[data-use]", card).forEach((b) => b.onclick = () => {
      const m = ex.math[Number(b.dataset.use)];
      current = editor.getQ();
      const o = (current.options || []).find((x) => x.key === m.key);
      if (o) { o.text = `$${m.latex}$`; rebuild(false); toast(`Option ${m.key} set from the page reading — check it before saving`); }
    });
    $$("[data-copy]", card).forEach((b) => b.onclick = () => navigator.clipboard?.writeText(ex.math[Number(b.dataset.copy)].latex).then(() => toast("LaTeX copied")));
  }

  const gates = $("[data-gates]", root);
  const strong = (dups || []).filter((d) => d.similarity >= 0.9);
  gates.innerHTML = `<h3 class="ctitle">Verification</h3><p class="csub">Tick each warning only after checking it against the source. Verification also checks the answer, options, images and duplicates on the server.</p>
    ${(item.issues || []).length ? `<div class="darklabel">Extraction warnings</div>${item.issues.map((w, i) => `<label class="checkline"><input type="checkbox" data-ack="${i}"> ${esc(w)}</label>`).join("")}` : `<div class="msg success">No extraction warnings.</div>`}
    ${(dups || []).length ? `<div class="darklabel" style="margin-top:10px">Similar questions already in the bank</div>${dups.map((d) => `<label class="checkline">${d.similarity >= 0.9 ? `<input type="checkbox" data-notdup="${esc(d.question_id)}">` : "•"} ${esc(d.code)} (${esc(d.status)}, ${Math.round(d.similarity * 100)}% similar)${d.similarity >= 0.9 ? " — tick only if this is a <b>different</b> question" : ""}</label>`).join("")}` : ""}
    <div data-gatefail class="msg bad"></div>
    <div class="toolbar"><button class="btn gold" data-verify>Verify &amp; add to Question Bank</button><button class="btn outline" data-save>Save corrections</button><button class="btn outline" data-return>Return for correction</button><button class="btn danger" data-reject>Reject</button></div>`;
  const acks = () => $$("[data-ack]:checked", gates).map((c) => item.issues[Number(c.dataset.ack)]);
  const notDups = () => $$("[data-notdup]:checked", gates).map((c) => c.dataset.notdup);
  const showFail = (list) => { $("[data-gatefail]", gates).innerHTML = list.length ? `<ul style="padding-left:18px;margin:6px 0">${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; };
  const draftForSave = () => ({ ...editor.getQ(), figures });
  const after = () => { const next = queue[idx + 1]; if (next) openItem(next, queue).catch(fail); else (item.status === "corrected" ? pageVerifyList(root) : pageReviewList(root)).catch(fail); };

  $("[data-save]", gates).onclick = async () => {
    const { error: se } = await sb.rpc("qb_save_import_item", { p_item_id: item.id, p_draft: draftForSave() });
    if (se) return fail(se); toast("Corrections saved — waiting in the Verification Queue"); after();
  };
  $("[data-return]", gates).onclick = async () => {
    const note = prompt("What needs correcting?"); if (!note) return;
    const { error: re } = await sb.rpc("qb_return_import_item", { p_item_id: item.id, p_note: note });
    if (re) return fail(re); toast("Returned for correction"); after();
  };
  $("[data-reject]", gates).onclick = async () => {
    const reason = prompt("Reason for rejecting (duplicate, not a question, unreadable, subjective…):"); if (reason === null) return;
    const { error: je } = await sb.rpc("qb_reject_import_item", { p_item_id: item.id, p_reason: reason });
    if (je) return fail(je); toast("Rejected"); after();
  };
  $("[data-verify]", gates).onclick = async (ev) => {
    const btn = ev.currentTarget;
    const q = editor.getQ();
    const local = localErrors(q, { formulaErrors: editor.formulaErrors() });
    const unacked = (item.issues || []).filter((w) => !acks().includes(w));
    if (unacked.length) local.push(`${unacked.length} warning(s) not ticked yet`);
    const used = JSON.stringify(q);
    for (const fg of figures) if (fg.pending && used.includes(`](figure:${fg.label})`)) local.push(`Figure ${fg.label}: drag on the page to set its crop`);
    for (const fg of figures) if (fg.proposed && used.includes(`](figure:${fg.label})`)) local.push(`Figure ${fg.label} was detected automatically: confirm the crop, re-crop it or remove it`);
    const missingDup = strong.filter((d) => !notDups().includes(d.question_id));
    if (missingDup.length) local.push(`Possible duplicate of ${missingDup.map((d) => d.code).join(", ")} — reject this item, or tick that it is different`);
    editor.setErrors([]); showFail(local); if (local.length) return;
    btn.disabled = true; btn.textContent = "Verifying…";
    const uploaded = [];
    let ok = false;
    try {
      const ch = chapterBySlug(q.subject, q.chapter);
      const { data: codes, error: ce } = await sb.rpc("qb_next_codes", { p_chapter_id: ch.id, p_count: 1 });
      if (ce) throw ce;
      const { q: final, assets } = await storeImages(q, figures, crop, job, uploaded);
      final.code = codes[0]; final.status = "live"; final.content_hash = `import:${item.id}`; final.source_file = `${job.file_name}#${item.source_location || ""}`;
      final.assets = assets; delete final.figures;
      const { error: ve } = await sb.rpc("qb_verify_import_item", { p_item_id: item.id, p_question: final, p_acknowledged: acks(), p_not_duplicate_of: notDups() });
      if (ve) { const g = notVerified(ve); if (g) { showFail(g); return; } throw ve; }
      ok = true;
      toast(`${final.code} verified and added to the Question Bank`); after();
    } catch (err) { fail(err); } finally {
      // Verification rolled back, so the copies just made are unused; the
      // storage policy refuses to delete anything a question still uses.
      if (!ok && uploaded.length) sb.storage.from("qb-images").remove(uploaded).catch(() => {});
      btn.disabled = false; btn.textContent = "Verify & add to Question Bank";
    }
  };
}

// Copy every image a question uses into qb-images under a random, stable
// path and register it (crop box + source page) — originals untouched.
async function storeImages(q, figures, crop, job, uploaded = []) {
  const final = structuredClone(q), assets = [];
  const fields = () => [final, ...(Array.isArray(final.options) ? final.options : final.options ? [...final.options.left, ...final.options.right] : [])];
  const replaceAll = (from, to) => {
    final.question = final.question.split(from).join(to);
    if (final.solution) final.solution = final.solution.split(from).join(to);
    for (const o of fields().slice(1)) o.text = o.text.split(from).join(to);
  };
  for (const f of figures) {
    if (!JSON.stringify(final).includes(`](figure:${f.label})`)) continue;
    const c = crop(f); if (!c) throw new Error(`Figure ${f.label}: page image not available`);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    const path = await uploadBankImage(blob, "image/png");
    uploaded.push(path);
    const pg =(await sb.from("qb_import_pages").select("image_path").eq("job_id", job.id).eq("page_no", f.page).single()).data;
    assets.push({ path, kind: "figure", page_no: f.page, source_path: pg?.image_path, crop_box: f.box.map((v) => Math.round(v)) });
    replaceAll(`](figure:${f.label})`, `](qb-images/${path})`);
  }
  for (const m of new Set([...JSON.stringify(final).matchAll(/import-media:([^)\s"\\]+)/g)].map((x) => x[1]))) {
    const { data: blob, error } = await sb.storage.from("qb-import").download(m);
    if (error) throw new Error(`Source image ${m.split("/").pop()} is missing: ${error.message}`);
    const path = await uploadBankImage(blob, blob.type);
    uploaded.push(path);
    assets.push({ path, kind: "media", source_path: m });
    replaceAll(`](import-media:${m})`, `](qb-images/${path})`);
  }
  return { q: final, assets };
}

// ---------- Final Question Bank ----------
async function pageBank(root) {
  const f = S.bank.f, subject = f.subject || "";
  root.innerHTML = `<div class="card"><div class="formgrid" style="grid-template-columns:repeat(7,minmax(0,1fr))">
    <select class="lightfield" id="bS">${opt("", "All subjects", subject)}${subjectOpts(subject)}</select>
    <select class="lightfield" id="bC" ${subject ? "" : "disabled"}>${subject ? chapterOpts(subject, f.chapter) : opt("", "All chapters", "")}</select>
    <select class="lightfield" id="bT" ${f.chapter ? "" : "disabled"}>${f.chapter ? topicOpts(f.chapter, f.topic) : opt("", "All topics", "")}</select>
    <select class="lightfield" id="bY">${opt("", "All types", f.type)}${Object.entries(TYPE_LABEL).map(([k, v]) => opt(k, v, f.type)).join("")}</select>
    <select class="lightfield" id="bD">${opt("", "All difficulty", f.band)}${opt("easy", "Easy (1–2)", f.band)}${opt("medium", "Medium (3)", f.band)}${opt("hard", "Hard (4–5)", f.band)}</select>
    <select class="lightfield" id="bSt">${opt("live", "Verified (final bank)", f.status ?? "live")}${opt("retired", "Retired", f.status)}${opt("flagged", "Flagged by teacher", f.status)}</select>
    <input class="lightfield" id="bQ" placeholder="Search text or ID" value="${esc(f.q || "")}"></div>
    <div class="toolbar"><button class="btn primary small" id="bNew">+ New question (manual entry)</button></div>
    <div id="bankList" style="margin-top:12px"></div>
    <div class="toolbar" style="justify-content:flex-end"><span class="msg" id="bCount"></span><button class="btn outline small" id="bPrev">‹ Prev</button><button class="btn outline small" id="bNext">Next ›</button></div></div>`;
  const set = (k, v) => { f[k] = v || undefined; S.bank.page = 0; };
  $("#bS", root).onchange = (e) => { set("subject", e.target.value); f.chapter = f.topic = undefined; pageBank(root); };
  $("#bC", root).onchange = (e) => { set("chapter", e.target.value); f.topic = undefined; pageBank(root); };
  $("#bT", root).onchange = (e) => { set("topic", e.target.value); loadBank(root); };
  $("#bY", root).onchange = (e) => { set("type", e.target.value); loadBank(root); };
  $("#bD", root).onchange = (e) => { set("band", e.target.value); loadBank(root); };
  $("#bSt", root).onchange = (e) => { f.status = e.target.value; S.bank.page = 0; loadBank(root); };
  let t; $("#bQ", root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { set("q", e.target.value.trim()); loadBank(root); }, 350); };
  $("#bNew", root).onclick = () => newQuestion();
  $("#bPrev", root).onclick = () => { if (S.bank.page > 0) { S.bank.page--; loadBank(root); } };
  $("#bNext", root).onclick = () => { S.bank.page++; loadBank(root); };
  await loadBank(root);
}
async function loadBank(root) {
  const f = S.bank.f, size = 20, from = S.bank.page * size;
  let q = sb.from("qb_questions").select("*", { count: "exact" }).eq("status", f.status || "live").order("code").range(from, from + size - 1);
  if (f.subject) q = q.eq("subject_id", f.subject);
  if (f.chapter) q = q.eq("chapter_id", f.chapter);
  if (f.topic) q = q.eq("topic_id", f.topic);
  if (f.type) q = q.eq("type", f.type);
  if (f.band) q = q.in("difficulty", BANDS[f.band]);
  if (f.q) { const term = f.q.replace(/[%,()]/g, " "); q = /^[A-Za-z]{2,4}-/.test(term) ? q.ilike("code", `${term}%`) : q.ilike("question_md", `%${term}%`); }
  const { data, count, error } = await q;
  if (error) throw error;
  const list = $("#bankList", root); if (!list) return;
  $("#bCount", root).textContent = count ? `${from + 1}–${Math.min(from + size, count)} of ${count}` : "";
  $("#bPrev", root).disabled = S.bank.page === 0; $("#bNext", root).disabled = from + size >= (count || 0);
  list.innerHTML = data.length ? "" : `<div class="empty">No questions match.</div>`;
  for (const row of data) list.appendChild(bankCard(row));
}
function bankCard(row) {
  const q = rowToQ(row);
  const card = document.createElement("div"); card.className = "qb-q";
  card.innerHTML = `<div class="toolbar" style="margin:0 0 8px">${metaTags(q)}${row.verified_at ? `<span class="tag">verified ${esc(new Date(row.verified_at).toLocaleDateString())}</span>` : ""}${row.usage_count ? `<span class="tag blue">used ${row.usage_count}×</span>` : ""}</div>${row.review_note ? `<div class="notice">${esc(row.review_note)}</div>` : ""}${(row.open_issues || []).length ? `<div class="msg warn">Open warnings: ${esc(row.open_issues.join(" | "))}</div>` : ""}`;
  const body = document.createElement("div"); body.appendChild(questionView(q)); card.appendChild(body);
  const act = document.createElement("div"); act.className = "toolbar";
  act.innerHTML = `<button class="btn outline small" data-a="key">Answer &amp; solution</button><button class="btn outline small" data-a="check">Check images &amp; gates</button><button class="btn outline small" data-a="edit">${row.status === "live" ? "Edit (removes from bank until re-verified)" : "Edit / verify"}</button>
    ${row.status === "live" ? `<button class="btn outline small" data-a="return">Return for correction</button><button class="btn danger small" data-a="retire">Retire</button>` : ""}${row.status === "retired" ? `<button class="btn outline small" data-a="restore">Restore as draft</button>` : ""}`;
  card.appendChild(act);
  act.onclick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    try {
      if (a === "key") {
        const { data: key } = await sb.from("qb_question_keys").select("*").eq("question_id", row.id).maybeSingle();
        body.innerHTML = ""; body.appendChild(questionView(rowToQ(row, key), { answer: key?.answer, solution: key?.solution_md }));
      } else if (a === "check") {
        const { data, error } = await sb.rpc("qb_verification_check", { p_question_id: row.id });
        if (error) throw error;
        toast(data.length ? `Problems: ${data.join(" | ")}` : "Images present and all gates pass");
      } else if (a === "edit") {
        const { data: key } = await sb.from("qb_question_keys").select("*").eq("question_id", row.id).maybeSingle();
        openQuestionEditor(row, rowToQ(row, key));
      } else if (a === "return") {
        const note = prompt(`What needs correcting in ${row.code}? It leaves the final bank until verified again.`); if (!note) return;
        const { error } = await sb.rpc("qb_return_for_correction", { p_question_id: row.id, p_note: note }); if (error) throw error;
        toast(`${row.code} returned for correction`); card.remove();
      } else if (a === "retire" || a === "restore") {
        if (a === "retire" && !confirm(`Retire ${row.code}? It can no longer be added to tests. Tests already using it are unaffected.`)) return;
        const { error } = await sb.from("qb_questions").update({ status: a === "retire" ? "retired" : "draft" }).eq("id", row.id); if (error) throw error;
        toast(`${row.code} ${a === "retire" ? "retired" : "restored as draft"}`); card.remove();
      }
    } catch (err) { fail(err); }
  };
  return card;
}

// Edit an existing bank question (or a draft) with verify in one step.
function openQuestionEditor(row, q) {
  const root = S.root;
  root.innerHTML = `<div class="toolbar"><button class="btn outline small" data-back>‹ Back</button><span class="tag ${row?.status === "live" ? "" : "amber"}">${esc(row?.code || "New question")} · ${esc(row?.status || "new")}</span></div>
   ${row?.status === "live" ? `<div class="notice">This question is verified. Saving any change removes it from the final bank until it is verified again.</div>` : ""}<div data-editor></div>
   <div class="card" style="margin-top:12px" data-gates><h3 class="ctitle">Save</h3>
    ${(row?.open_issues || []).length ? `<div class="darklabel">Open warnings to check</div>${row.open_issues.map((w, i) => `<label class="checkline"><input type="checkbox" data-ack="${i}"> ${esc(w)}</label>`).join("")}` : ""}
    <div data-gatefail class="msg bad"></div>
    <div class="toolbar"><button class="btn gold" data-verify>Save &amp; verify</button><button class="btn outline" data-draft>Save as draft</button></div></div>`;
  const editor = questionEditor(q);
  $("[data-editor]", root).appendChild(editor.el);
  $("[data-back]", root).onclick = () => pageBank(root).catch(fail);
  const gates = $("[data-gates]", root);
  const showFail = (l) => { $("[data-gatefail]", gates).innerHTML = l.length ? `<ul style="padding-left:18px;margin:6px 0">${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; };
  const save = async (verify) => {
    const v = editor.getQ();
    const local = localErrors(v, { formulaErrors: editor.formulaErrors() }); showFail(local); if (local.length) return;
    if (!v.code) { const ch = chapterBySlug(v.subject, v.chapter); const { data, error } = await sb.rpc("qb_next_codes", { p_chapter_id: ch.id, p_count: 1 }); if (error) throw error; v.code = data[0]; }
    const { data: rep, error } = await sb.rpc("qb_import_questions", { p_questions: [{ ...v, status: "draft", content_hash: `edit:${Date.now()}` }] });
    if (error) throw error; if (rep.errors?.length) throw new Error(rep.errors[0].error);
    if (!verify) { toast(`${v.code} saved as draft`); return pageVerifyList(root); }
    const { data: idRow } = await sb.from("qb_questions").select("id").eq("code", v.code).single();
    const acks = $$("[data-ack]:checked", gates).map((c) => row.open_issues[Number(c.dataset.ack)]);
    const { error: ve } = await sb.rpc("qb_verify_question", { p_question_id: idRow.id, p_acknowledged: acks, p_not_duplicate_of: [] });
    if (ve) { const g = notVerified(ve); if (g) { showFail([...g, "Saved as draft — fix the above and verify again."]); return; } throw ve; }
    toast(`${v.code} verified`); S.bank.f.status = "live"; pageBank(root);
  };
  $("[data-verify]", gates).onclick = () => save(true).catch(fail);
  $("[data-draft]", gates).onclick = () => save(false).catch(fail);
}

// ---------- Failed / Uncertain ----------
async function pageFailed(root) {
  const [jobs, pages] = await Promise.all([
    sb.from("qb_import_jobs").select("id,file_name,source_label,error,created_at").eq("status", "failed").order("created_at", { ascending: false }),
    sb.from("qb_import_pages").select("job_id,page_no,error,qb_import_jobs(file_name)").eq("status", "failed"),
  ]);
  for (const r of [jobs, pages]) if (r.error) throw r.error;
  root.innerHTML = `${bulkResultBanner()}<div class="card"><h3 class="ctitle">Failed files (${jobs.data.length})</h3>${jobs.data.length ? `<div class="tablewrap"><table><thead><tr><th>File</th><th>Error</th><th>When</th></tr></thead><tbody>${jobs.data.map((j) => `<tr><td>${esc(j.source_label || j.file_name)}</td><td class="bad">${esc(j.error || "")}</td><td>${esc(new Date(j.created_at).toLocaleString())}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">None.</div>`}</div>
   <div class="card" style="margin-top:14px"><h3 class="ctitle">Pages that could not be read (${pages.data.length})</h3>${pages.data.length ? `<div class="tablewrap"><table><thead><tr><th>File</th><th>Page</th><th>Error</th></tr></thead><tbody>${pages.data.map((p) => `<tr><td>${esc(p.qb_import_jobs?.file_name)}</td><td>${p.page_no}</td><td class="bad">${esc(p.error || "")}</td></tr>`).join("")}</tbody></table></div><p class="csub">Re-upload the file with just these pages (Upload → PDF pages).</p>` : `<div class="empty">None.</div>`}</div>`;
  const imgs = document.createElement("div"); imgs.className = "card"; imgs.style.marginTop = "14px"; root.appendChild(imgs);
  unusedImagesCard(imgs);
  const box = document.createElement("div"); box.className = "card"; box.style.marginTop = "14px"; root.appendChild(box);
  await uncertainList(box).catch(fail);
  const rej = document.createElement("div"); rej.className = "card"; rej.style.marginTop = "14px"; root.appendChild(rej);
  await rejectedCard(rej, () => T.go("failed"));
}

// ---------- Uncertain extractions: select, bulk reject ----------
// All low-confidence open items are loaded on one page (no pagination, up
// to UNCERTAIN_MAX), so "Select all" means exactly the rows shown. Bulk
// rejection goes through qb_reject_import_items (one transaction; skips and
// reports anything not open or outside the chosen import). The list and
// counts change only after the server answers.
const OPEN_STATUSES = ["review_required", "corrected", "returned"];
const UNCERTAIN_MAX = 1000;

async function uncertainList(box) {
  const { data, error } = await sb.from("qb_import_items").select("id,job_id,seq,source_number,source_location,status,confidence,issues,review_note,draft,qb_import_jobs(source_label,file_name)")
    .in("status", OPEN_STATUSES).eq("confidence", "low").order("job_id").order("seq").limit(UNCERTAIN_MAX + 1);
  if (error) throw error;
  const more = data.length > UNCERTAIN_MAX, rows = data.slice(0, UNCERTAIN_MAX);
  const label = (i) => `Q${i.source_number || "?"} · ${i.source_location || ""}`;
  const src = (i) => i.qb_import_jobs?.source_label || i.qb_import_jobs?.file_name || "import";
  const byId = new Map(rows.map((i) => [i.id, i]));
  const imports = [...rows.reduce((m, i) => m.set(i.job_id, { id: i.job_id, name: src(i), file: i.qb_import_jobs?.file_name, n: (m.get(i.job_id)?.n || 0) + 1 }), new Map()).values()];
  const sel = new Set();
  box.innerHTML = `<h3 class="ctitle">Uncertain extractions (${rows.length}${more ? "+" : ""})</h3>
    <p class="csub">Low-confidence items: handwriting, tilted scans, unreadable formulas, missing options or numbers.
      ${more ? `<b>Only the first ${UNCERTAIN_MAX} are shown</b> — "Select all" selects these ${UNCERTAIN_MAX} only.` : `All ${rows.length} are listed here on one page, so "Select all" selects exactly these ${rows.length}.`}</p>
    ${rows.length ? `<div class="row" style="flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0">
        <label class="darklabel" style="margin:0">Import</label>
        <select class="lightfield" id="ucJob" style="max-width:360px">${imports.map((j) => opt(j.id, `${j.name} — ${j.n} uncertain`, imports[0].id)).join("")}</select>
        <button class="btn danger small" id="ucJobAll">Reject all uncertain from this import</button></div>
      <div id="ucBar" class="notice" style="display:none;position:sticky;top:0;z-index:5;align-items:center;gap:10px;flex-wrap:wrap">
        <b id="ucCount"></b><button class="btn danger small" id="ucRejectSel"></button><button class="btn outline small" id="ucClear">Clear selection</button></div>
      <div class="tablewrap"><table><thead><tr><th style="width:34px"><input type="checkbox" id="ucAll" aria-label="Select all ${rows.length} shown"></th><th>Source</th><th>Location</th><th>Question</th><th>Status</th><th>Warnings</th><th></th></tr></thead><tbody>
      ${rows.map((i) => `<tr><td><input type="checkbox" data-uc="${esc(i.id)}" aria-label="Select ${esc(label(i))}"></td>
        <td>${esc(src(i))}</td><td>${esc(i.source_location || "")} · Q${esc(i.source_number || "?")}</td><td>${esc(plainStem(i.draft?.question).slice(0, 110))}</td>
        <td><span class="tag ${i.status === "returned" ? "red" : "amber"}">${esc(ITEM_LABEL[i.status])}</span> <span class="tag red">uncertain</span></td><td>${(i.issues || []).length}</td>
        <td style="white-space:nowrap"><button class="btn primary small" data-item="${esc(i.id)}">Open</button> <button class="btn danger small" data-rej="${esc(i.id)}" data-label="${esc(label(i))}">Reject</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Nothing here.</div>`}`;
  if (!rows.length) return;

  const boxes = () => $$("[data-uc]", box);
  const sync = () => {
    $("#ucBar", box).style.display = sel.size ? "flex" : "none";
    $("#ucCount", box).textContent = `${sel.size} question${sel.size === 1 ? "" : "s"} selected`;
    $("#ucRejectSel", box).textContent = `Reject selected (${sel.size})`;
    const all = $("#ucAll", box);
    all.checked = sel.size === rows.length; all.indeterminate = sel.size > 0 && sel.size < rows.length;
  };
  boxes().forEach((c) => c.onchange = () => { c.checked ? sel.add(c.dataset.uc) : sel.delete(c.dataset.uc); sync(); });
  $("#ucAll", box).onchange = (e) => { boxes().forEach((c) => { c.checked = e.target.checked; c.checked ? sel.add(c.dataset.uc) : sel.delete(c.dataset.uc); }); sync(); };
  $("#ucClear", box).onclick = () => { sel.clear(); boxes().forEach((c) => { c.checked = false; }); sync(); };
  $("#ucRejectSel", box).onclick = () => bulkReject([...sel].map((id) => byId.get(id)), null);
  $("#ucJobAll", box).onclick = () => {
    const job = imports.find((j) => j.id === $("#ucJob", box).value);
    bulkReject(rows.filter((i) => i.job_id === job.id), job);
  };
  $$("[data-item]", box).forEach((b) => b.onclick = () => openItem(b.dataset.item, rows.map((x) => x.id)).catch(fail));
  // Single reject: the existing server function, unchanged.
  $$("[data-rej]", box).forEach((b) => b.onclick = async () => {
    const reason = prompt(`Reject ${b.dataset.label}?\n\nReason (duplicate, not a question, unreadable, subjective…):`);
    if (reason === null) return;
    if (!confirm(`Reject ${b.dataset.label}? It leaves the review queues and can never be verified or added to a test. The source file and page images are not touched.`)) return;
    b.disabled = true;
    const { error: je } = await sb.rpc("qb_reject_import_item", { p_item_id: b.dataset.rej, p_reason: reason.trim() || null });
    if (je) { b.disabled = false; return fail(je); }
    toast(`${b.dataset.label} rejected`); T.go("failed");
  });

  async function bulkReject(items, job) {
    if (!items.length) return;
    const sources = [...new Set(items.map(src))];
    const reason = await confirmBulk({ count: items.length, sources, scoped: !!job });
    if (reason === null) return;
    const buttons = [$("#ucRejectSel", box), $("#ucJobAll", box), $("#ucClear", box), ...$$("[data-rej]", box), ...boxes(), $("#ucAll", box)];
    buttons.forEach((b) => { b.disabled = true; });
    const status = document.createElement("div"); status.className = "msg"; status.textContent = `Rejecting ${items.length} question(s)…`;
    box.prepend(status);
    try {
      const r = await rejectMany(items.map((i) => i.id), reason || null, job?.id ?? null, (n) => { status.textContent = `Rejecting… ${n} of ${items.length}`; });
      S.bulkResult = {
        rejected: r.rejected.length, total: items.length, sources,
        skipped: r.skipped.map((s) => `${byId.get(s.id) ? label(byId.get(s.id)) : s.id}: ${s.reason}`),
      };
      T.go("failed"); // reload list + sidebar counts from the server
    } catch (err) {
      // Nothing is changed in the page: the server reported an error.
      status.className = "msg bad"; status.textContent = `Not rejected — ${err.message || err}. No question was changed by this request.`;
      buttons.forEach((b) => { b.disabled = false; });
    }
  }
}

// One server call (qb_reject_import_items). If that database update is not
// applied yet, fall back to the existing single-item function, one by one,
// collecting exactly which succeeded and which failed.
async function rejectMany(ids, reason, jobId, progress) {
  const { data, error } = await sb.rpc("qb_reject_import_items", { p_item_ids: ids, p_reason: reason, p_job_id: jobId });
  if (!error) return { rejected: data.rejected || [], skipped: data.skipped || [] };
  if (!/qb_reject_import_items|PGRST202|Could not find the function/i.test(`${error.code} ${error.message}`)) throw error;
  const out = { rejected: [], skipped: [] };
  for (const [k, id] of ids.entries()) {
    const { error: e } = await sb.rpc("qb_reject_import_item", { p_item_id: id, p_reason: reason });
    if (e) out.skipped.push({ id, reason: e.message }); else out.rejected.push(id);
    progress?.(k + 1);
  }
  return out;
}

// Modal confirmation. Resolves to the reason ("" allowed) or null if cancelled.
function confirmBulk({ count, sources, scoped }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.style.cssText = "max-width:min(540px,92vw);border:1px solid #c9a227;border-radius:12px;padding:18px;color:#10233f";
    d.innerHTML = `<h3 style="margin:0 0 8px">Reject ${count} question${count === 1 ? "" : "s"}?</h3>
      <p style="margin:0 0 6px"><b>${scoped ? "Import" : "From"}:</b> ${esc(sources.join(", "))}${scoped ? " — only this import's uncertain questions" : ""}</p>
      <p style="margin:0 0 10px">They will be removed from the active review queues and can never be verified or added to a test. The source PDF, page images and other questions are not touched. Rejected questions can be restored from <b>Rejected extractions</b>.</p>
      <label class="darklabel" for="bkReason">Reason (optional)</label>
      <input class="lightfield" id="bkReason" placeholder="e.g. unreadable scan — will re-upload" style="width:100%;margin-bottom:12px">
      <div class="toolbar" style="justify-content:flex-end;margin:0"><button class="btn outline" data-x>Cancel</button><button class="btn danger" data-ok>Confirm rejection of ${count}</button></div>`;
    document.body.appendChild(d);
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
    $("[data-x]", d).onclick = () => done(null);
    // Confirm resolves to the reason text, possibly "" (only Cancel is null).
    $("[data-ok]", d).onclick = (e) => { e.currentTarget.disabled = true; done($("#bkReason", d).value.trim()); };
    d.showModal();
  });
}

// Result of the last bulk action, shown once after the page reloads.
function bulkResultBanner() {
  const r = S.bulkResult; S.bulkResult = null;
  if (!r) return "";
  return `<div class="msg ${r.skipped.length ? "bad" : "success"}" id="bulkResult" style="margin-bottom:14px"><b>${r.rejected} of ${r.total} question(s) rejected</b> (${esc(r.sources.join(", "))}).
    ${r.skipped.length ? `<br>Not rejected (${r.skipped.length}):<ul style="margin:4px 0 0;padding-left:18px">${r.skipped.slice(0, 50).map((s) => `<li>${esc(s)}</li>`).join("")}${r.skipped.length > 50 ? `<li>… and ${r.skipped.length - 50} more</li>` : ""}</ul>` : ""}</div>`;
}

// Images in qb-images that no question, solution, import draft or test uses
// (left by a failed verification or an editor closed without saving).
async function unusedImagesCard(card) {
  const { data, error } = await sb.rpc("qb_unused_images", { p_min_age: "1 day", p_limit: 500 });
  if (error) { card.remove(); return; }
  const kb = Math.round(data.reduce((s, r) => s + Number(r.size_bytes || 0), 0) / 1024);
  card.innerHTML = `<h3 class="ctitle">Unused images (${data.length}${data.length === 500 ? "+" : ""})</h3>
    <p class="csub">Pictures uploaded more than a day ago that no question, solution, import or test uses${data.length ? ` — about ${kb} KB` : ""}. Images in use cannot be deleted.</p>
    ${data.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0">${data.slice(0, 12).map((r) => `<img src="${esc(QB_IMAGES_URL + r.name)}" alt="" loading="lazy" style="height:64px;max-width:120px;object-fit:contain;border:1px solid #ddd;border-radius:6px;background:#fff">`).join("")}</div>
    <div class="toolbar"><button class="btn outline small" data-clean>Delete ${data.length} unused image${data.length === 1 ? "" : "s"}</button></div>` : `<div class="empty">None.</div>`}`;
  const btn = $("[data-clean]", card); if (!btn) return;
  btn.onclick = async () => {
    if (!confirm(`Permanently delete ${data.length} unused image(s)?`)) return;
    btn.disabled = true; btn.textContent = "Deleting…";
    try {
      let n = 0;
      for (let i = 0; i < data.length; i += 100) {
        const { data: gone, error: re } = await sb.storage.from("qb-images").remove(data.slice(i, i + 100).map((r) => r.name));
        if (re) throw re; n += gone?.length || 0;
      }
      toast(`${n} unused image(s) deleted`); unusedImagesCard(card);
    } catch (err) { fail(err); btn.disabled = false; }
  };
}

// ---------- Draft Test Builder: add verified questions ----------
async function pageBuilder(root, testId) {
  const { data: tests, error } = await sb.rpc("qb_list_tests");
  if (error) throw error;
  const test = tests.find((t) => t.id === (testId || S.pick.testId)) || tests.find((t) => !t.is_published);
  if (!test) { root.innerHTML = `<div class="empty">No tests yet — create a draft test in Tests &amp; Assessments first.</div>`; return; }
  S.pick.testId = test.id;
  const { data: existing, error: ee } = await sb.rpc("qb_test_questions", { p_test_id: test.id });
  if (ee) throw ee;
  const f = S.pick.f ??= { subject: S.tax.subjects[0]?.id };
  root.innerHTML = `<div class="card"><div class="row"><label class="darklabel" style="margin:0">Test</label><select class="lightfield" id="tbTest" style="max-width:520px">${tests.map((t) => opt(t.id, `${t.title} · ${t.subject || "Mixed"} · ${t.is_published ? "PUBLISHED" : "draft"} · ${t.question_count} q`, test.id)).join("")}</select></div></div>
   <div class="card" style="margin-top:14px"><h3 class="ctitle">Questions in this test (${existing.length})</h3>${existing.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Question</th><th>Image</th><th>Key</th><th>Marks</th><th>Bank ID</th></tr></thead><tbody>${existing.map((q) => `<tr><td>${esc(q.question_order ?? "")}</td><td>${esc(String(q.question_text).slice(0, 140))}</td><td>${q.question_image_url ? `<img src="${esc(q.question_image_url)}" alt="" style="max-height:48px;max-width:110px;border:1px solid var(--line);border-radius:6px">` : "—"}</td><td>${esc(q.correct_option)}</td><td>+${esc(q.marks)} / −${esc(q.negative_marks)}</td><td>${esc(q.qb_code || "manual")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No questions yet.</div>`}</div>
   ${test.is_published ? `<div class="notice" style="margin-top:14px">This test is published, so its questions cannot be changed here.</div>` : `<div class="card" style="margin-top:14px"><h3 class="ctitle">Add verified questions</h3><p class="csub">Only questions verified in the final bank. This test format holds single-correct A–D questions with at most one question image; other types are refused with a reason. New questions go after the existing ones, in the order you tick them; nothing is deleted.</p>
    <div class="formgrid" style="grid-template-columns:repeat(7,minmax(0,1fr))">
     <select class="lightfield" id="tpS">${subjectOpts(f.subject)}</select>
     <select class="lightfield" id="tpC">${chapterOpts(f.subject, f.chapter)}</select>
     <select class="lightfield" id="tpT" ${f.chapter ? "" : "disabled"}>${f.chapter ? topicOpts(f.chapter, f.topic) : opt("", "All topics", "")}</select>
     <select class="lightfield" id="tpY">${opt("", "All types", f.type)}${Object.entries(TYPE_LABEL).map(([k, v]) => opt(k, v, f.type)).join("")}</select>
     <select class="lightfield" id="tpD">${opt("", "All difficulty", f.band)}${opt("easy", "Easy (1–2)", f.band)}${opt("medium", "Medium (3)", f.band)}${opt("hard", "Hard (4–5)", f.band)}</select>
     <input class="lightfield" id="tpSrc" placeholder="Source contains…" value="${esc(f.source || "")}">
     <input class="lightfield" id="tpQ" placeholder="Search text or ID" value="${esc(f.q || "")}"></div>
    <div class="row" style="margin-top:10px"><label class="darklabel" style="margin:0">Marks</label><input class="lightfield" type="number" step="0.25" min="0.25" id="tpM" value="4" style="max-width:90px"><label class="darklabel" style="margin:0">Negative</label><input class="lightfield" type="number" step="0.25" min="0" id="tpN" value="1" style="max-width:90px"><button class="btn gold" id="tpAdd" disabled>Add selected</button></div>
    <div id="tpList" style="margin-top:12px"></div></div>`}`;
  $("#tbTest", root).onchange = (e) => pageBuilder(root, e.target.value).catch(fail);
  if (test.is_published) return;
  const selected = [], already = new Set(existing.map((q) => q.qb_code).filter(Boolean));
  const load = async () => {
    let q = sb.from("qb_questions").select("*").eq("status", "live").eq("subject_id", f.subject).order("code").limit(60);
    if (f.chapter) q = q.eq("chapter_id", f.chapter); if (f.topic) q = q.eq("topic_id", f.topic); if (f.type) q = q.eq("type", f.type);
    if (f.band) q = q.in("difficulty", BANDS[f.band]);
    if (f.source) q = q.ilike("source", `%${f.source.replace(/[%,()]/g, " ")}%`);
    if (f.q) q = /^[A-Za-z]{2,4}-/.test(f.q) ? q.ilike("code", `${f.q}%`) : q.ilike("question_md", `%${f.q.replace(/[%,()]/g, " ")}%`);
    const { data, error: le } = await q; if (le) throw le;
    const list = $("#tpList", root); list.innerHTML = data.length ? "" : `<div class="empty">No verified questions match.</div>`;
    for (const row of data) {
      const imgs = (row.question_md.match(/!\[[^\]]*\]\(qb-images\//g) || []).length;
      const reason = already.has(row.code) ? "already in this test" : row.type !== "single" ? "type not supported by this test format"
        : JSON.stringify(row.options).includes("![") ? "images inside options" : imgs > 1 ? "more than one image" : null;
      const plainOnly = !reason && /^\s*\|/m.test(row.question_md);
      const card = document.createElement("div"); card.className = "qb-q";
      card.innerHTML = `<label class="checkline"><input type="checkbox" data-id="${esc(row.id)}" ${reason ? "disabled" : ""}${selected.includes(row.id) ? " checked" : ""}> <span>${metaTags(rowToQ(row))}${reason ? ` <span class="tag red">${esc(reason)}</span>` : ""}${plainOnly ? ` <span class="tag amber" title="The existing tests table stores plain text; formulas render in the Admin Dashboard but tables show as | rows">table shows as plain rows in this test format</span>` : ""}</span></label>`;
      card.appendChild(questionView(rowToQ(row))); list.appendChild(card);
    }
    $$("input[data-id]", list).forEach((c) => c.onchange = () => {
      const i = selected.indexOf(c.dataset.id); if (c.checked && i < 0) selected.push(c.dataset.id); else if (!c.checked && i >= 0) selected.splice(i, 1);
      $("#tpAdd", root).disabled = !selected.length; $("#tpAdd", root).textContent = `Add ${selected.length || ""} selected`;
    });
  };
  const set = (k, v) => { f[k] = v || undefined; };
  $("#tpS", root).onchange = (e) => { set("subject", e.target.value); f.chapter = f.topic = undefined; pageBuilder(root, test.id).catch(fail); };
  $("#tpC", root).onchange = (e) => { set("chapter", e.target.value); f.topic = undefined; pageBuilder(root, test.id).catch(fail); };
  $("#tpT", root).onchange = (e) => { set("topic", e.target.value); load().catch(fail); };
  $("#tpY", root).onchange = (e) => { set("type", e.target.value); load().catch(fail); };
  $("#tpD", root).onchange = (e) => { set("band", e.target.value); load().catch(fail); };
  let t; for (const [id, k] of [["#tpSrc", "source"], ["#tpQ", "q"]]) $(id, root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { set(k, e.target.value.trim()); load().catch(fail); }, 350); };
  $("#tpAdd", root).onclick = async (e) => {
    const addBtn = e.currentTarget; // currentTarget is cleared after the first await
    addBtn.disabled = true;
    try {
      const { data, error: ae } = await sb.rpc("qb_add_questions_to_test", { p_test_id: test.id, p_question_ids: selected, p_public_base: QB_IMAGES_URL, p_marks: Number($("#tpM", root).value), p_negative: Number($("#tpN", root).value) });
      if (ae) throw ae;
      const sk = data.skipped || [];
      toast(`${data.added} added${sk.length ? `, ${sk.length} not added` : ""}`);
      if (sk.length) alert("Not added:\n" + sk.map((s) => `${s.code || "?"}: ${s.reason}`).join("\n"));
      pageBuilder(root, test.id).catch(fail);
    } catch (err) { fail(err); addBtn.disabled = false; }
  };
  await load();
}
window.QB.openBuilder = (testId) => { S.pick.testId = testId; };
const newQuestion = () => openQuestionEditor(null, { code: null, subject: S.tax.subjects[0]?.id, chapter: null, topic: null, type: "single", difficulty: null, exam: [], tags: [], source: null, status: "draft", marks: 4, negative: 1, question: "", options: ["A", "B", "C", "D"].map((key) => ({ key, text: "" })), answer: null, tolerance: 0, solution: null });
