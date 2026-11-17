// =====================================================================
// SIR Admin — Test Setup (admin-dashboard.html → Exams & Results → Test Setup)
//
//   New test (name, date, batches, pattern, one teacher per subject)
//     → teachers send the syllabus → admin verifies → announces it on the
//       students' dashboard → gives teachers access to pick questions
//       (their own subject only) → admin reviews in Test Approvals →
//       students' dashboard, or Print / Word for offline.
//
// Needs migration 20261126090000_test_setup_flow.sql.
//   SIRAdminTests.render(sectionElement)
// =====================================================================
(function () {
  "use strict";
  const db = () => (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (v) => (v ? new Date(String(v).length === 10 ? v + "T00:00:00" : v).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—");
  const fmtDT = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
  const inDays = (v) => { if (!v) return ""; const d = Math.round((new Date(v + "T00:00:00") - new Date(new Date().toDateString())) / 864e5); return d === 0 ? "today" : d === 1 ? "tomorrow" : d > 1 ? `in ${d} days` : `${-d} days ago`; };
  const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

  // Marking is decided here, by the pattern — never by the question bank.
  const SUBJECT_NAME = { physics: "Physics", chemistry: "Chemistry", mathematics: "Mathematics", biology: "Biology" };
  const P3 = (f) => ["physics", "chemistry", "mathematics"].map(f);
  const PATTERNS = {
    "jee-main": { label: "JEE Main", duration: 180, note: "75 questions · 300 marks · +4 / −1",
      rows: P3((s) => ({ subject: s, parts: [{ label: "Section A — Single correct", types: ["single"], count: 20, mc: 4, mw: 1 }, { label: "Section B — Numerical", types: ["numerical", "integer"], count: 5, mc: 4, mw: 1 }] })) },
    neet: { label: "NEET", duration: 180, note: "180 questions · 720 marks · +4 / −1",
      rows: [{ subject: "physics", parts: [{ label: "Physics", types: ["single"], count: 45, mc: 4, mw: 1 }] }, { subject: "chemistry", parts: [{ label: "Chemistry", types: ["single"], count: 45, mc: 4, mw: 1 }] },
        { subject: "biology", branch: "botany", parts: [{ label: "Botany", types: ["single"], count: 45, mc: 4, mw: 1 }] }, { subject: "biology", branch: "zoology", parts: [{ label: "Zoology", types: ["single"], count: 45, mc: 4, mw: 1 }] }] },
    "mht-cet": { label: "MHT-CET (PCM)", duration: 180, note: "150 questions · 200 marks · no negative",
      rows: P3((s) => ({ subject: s, parts: [{ label: s === "mathematics" ? "Mathematics (2 marks each)" : SUBJECT_NAME[s] + " (1 mark each)", types: ["single"], count: 50, mc: s === "mathematics" ? 2 : 1, mw: 0 }] })) },
    "jee-adv-p1": { label: "JEE Advanced — Paper 1", duration: 180, note: "Indicative · 7 single, 6 multiple, 4 numerical per subject",
      rows: P3((s) => ({ subject: s, parts: [{ label: "Single correct", types: ["single"], count: 7, mc: 3, mw: 1 }, { label: "Multiple correct (partial)", types: ["multi"], count: 6, mc: 4, mw: 2, partial: true }, { label: "Numerical", types: ["numerical", "integer"], count: 4, mc: 4, mw: 0 }] })) },
    "jee-adv-p2": { label: "JEE Advanced — Paper 2", duration: 180, note: "Indicative · 6 single, 5 multiple, 6 numerical per subject",
      rows: P3((s) => ({ subject: s, parts: [{ label: "Single correct", types: ["single"], count: 6, mc: 3, mw: 1 }, { label: "Multiple correct (partial)", types: ["multi"], count: 5, mc: 4, mw: 2, partial: true }, { label: "Numerical", types: ["numerical", "integer"], count: 6, mc: 4, mw: 0 }] })) },
    custom: { label: "Custom (chapter / weekly test)", duration: 60, note: "Your own subjects, counts and marks",
      rows: [{ subject: "physics", parts: [{ label: "Questions", types: ["single"], count: 20, mc: 4, mw: 1 }] }] },
  };
  const STAGES = [["syllabus_wait", "Waiting for syllabus", "watch"], ["syllabus_review", "Syllabus to verify", "medium"], ["syllabus_ready", "Syllabus verified", "ok"],
    ["composing", "Teachers picking questions", "watch"], ["review", "Paper ready for review", "medium"], ["live", "Published to students", "ok"], ["cancelled", "Cancelled", ""]];
  const SYL = { none: ["—", ""], requested: ["Waiting", "watch"], submitted: ["To verify", "medium"], changes: ["Changes asked", "high"], verified: ["Verified", "ok"] };

  const T = { tab: "open", list: [], open: [], done: [], teachers: [], batches: [], chapters: [], topics: [], busy: false, root: null };
  const $ = (s, r = document) => r.querySelector(s);

  // -------------------------------------------------------------- data
  async function load() {
    const [setups, doneRes, teachers, batches, ch, tp] = await Promise.all([
      db().rpc("asm_admin_setups", { p_filter: "open" }),
      db().rpc("asm_admin_setups", { p_filter: "done" }),
      db().from("teachers").select("id,full_name,subject,is_active").eq("is_active", true).order("full_name"),
      db().from("batches").select("id,name,is_active").eq("is_active", true).order("name"),
      db().from("qb_chapters").select("id,subject_id,name,sort_order,class_level,is_active").eq("is_active", true).order("sort_order"),
      db().from("qb_topics").select("id,chapter_id,label,sort_order,is_active").eq("is_active", true).order("sort_order"),
    ]);
    if (setups.error) throw Object.assign(new Error(setups.error.message), { setup: /asm_admin_setups|schema cache|does not exist/i.test(setups.error.message) });
    T.open = setups.data || []; T.done = doneRes.data || [];
    T.list = T.tab === "open" ? T.open : T.done.filter((a) => a.status === (T.tab === "cancelled" ? "cancelled" : "approved"));
    T.teachers = teachers.data || []; T.batches = batches.data || [];
    T.chapters = ch.data || []; T.topics = tp.data || [];
  }
  async function render(el) {
    T.root = el || T.root; if (!T.root) return;
    T.root.innerHTML = '<div class="hub-loading">Loading tests…</div>';
    try { await load(); } catch (e) {
      T.root.innerHTML = head() + (e.setup ? '<div class="hub-card hub-bad"><b>One database update is needed.</b> Run <code>npx supabase db push --remote</code> (migration 20261126090000_test_setup_flow.sql), then reopen this page.</div>'
        : '<div class="hub-card hub-bad">Could not load: ' + esc(e.message || e) + "</div>"); return;
    }
    paint();
  }
  const head = () => `<div class="section-head hub-head"><div><div class="hub-kicker">EXAMS</div><h2>Test Setup</h2>
    <p class="hub-sub">Fix the test name, date and teachers. Teachers send the syllabus, you verify and announce it to students, then give the teachers access to pick questions from their own subject. Finished papers go to <b>Test Approvals</b> for students, or print / Word for offline.</p></div>
    <button class="primary-btn" data-ts-new="1">+ New test</button></div>`;

  // ------------------------------------------------------------ views
  const pill = (txt, cls) => `<span class="hub-pill ${cls || ""}">${esc(txt)}</span>`;
  function stepper(stage) {
    const order = ["syllabus", "announce", "compose", "review", "live"];
    const at = { syllabus_wait: 0, syllabus_review: 0, syllabus_ready: 1, composing: 2, review: 3, live: 4 }[stage] ?? 0;
    const names = ["1 · Syllabus", "2 · Verify & announce", "3 · Teachers pick", "4 · Review", "5 · Live"];
    return `<div class="ts-steps">${order.map((_, i) => `<span class="${i < at ? "done" : i === at ? "now" : ""}">${names[i]}</span>`).join("")}</div>`;
  }
  const scopeText = (sc) => (sc || []).map((c) => `<span class="ts-chip">${esc(c.chapter)}${c.whole || !(c.topics || []).length ? "" : ` <i>(${c.topics.length} topic${c.topics.length > 1 ? "s" : ""})</i>`}</span>`).join("") || '<span class="hub-sub">no syllabus yet</span>';

  function sectionRow(a, s) {
    const [sl, sc] = SYL[s.syllabus_status] || SYL.none;
    const prog = s.progress || {};
    const inDraft = a.status === "draft";
    let actions = "";
    if (inDraft && s.syllabus_status === "submitted") actions += `<button class="ts-btn primary" data-ts-verify="${esc(s.id)}">Verify</button><button class="ts-btn" data-ts-back="${esc(s.id)}">Send back</button>`;
    if (inDraft) actions += `<button class="ts-btn" data-ts-edit="${esc(s.id)}" data-subject="${esc(s.subject)}" data-aid="${esc(a.id)}">${s.syllabus_status === "none" || s.syllabus_status === "requested" ? "Write syllabus" : "Edit syllabus"}</button>`;
    if (a.status === "submitted" && s.section_status === "submitted") actions += `<button class="ts-btn" data-ts-reassign="${esc(s.id)}" data-aid="${esc(a.id)}">Send back to teacher</button>`;
    const teacher = esc(s.teacher || "—");
    return `<div class="ts-sec"><div class="ts-sec-main"><b>${esc(s.label)}</b>
        <small>${teacher}${a.status === "draft" || a.status === "with_teachers" ? ` · <a href="#" data-ts-teacher="${esc(s.id)}" data-subject="${esc(s.subject)}" data-cur="${esc(s.teacher_id || "")}">change</a>` : ""}</small></div>
      <div class="ts-sec-syl">${pill(sl, sc)} ${scopeText(s.scope)}${s.syllabus_note ? `<div class="ts-note">📝 ${esc(s.syllabus_note)}</div>` : ""}${s.syllabus_comment ? `<div class="ts-note bad">↩ You asked: ${esc(s.syllabus_comment)}</div>` : ""}${s.admin_comment && s.section_status === "reassigned" ? `<div class="ts-note bad">↩ Sent back: ${esc(s.admin_comment)}</div>` : ""}</div>
      <div class="ts-sec-prog">${a.status === "draft" ? "" : `<span class="ts-count"><b>${prog.picked || 0}</b> / ${prog.needed || 0} <small>questions</small></span>${s.section_status === "submitted" ? pill("submitted", "ok") : ""}`}</div>
      <div class="ts-sec-act">${actions}</div></div>`;
  }

  function actionsFor(a) {
    const allVerified = (a.sections || []).length && a.sections.every((s) => s.syllabus_status === "verified");
    let h = "";
    if (a.status === "draft") {
      if (allVerified) {
        h += a.syllabus_published_at
          ? `<button class="ts-btn" data-ts-unpub="${esc(a.id)}">Hide announcement</button>`
          : `<button class="ts-btn primary" data-ts-pub="${esc(a.id)}">📣 Announce to students</button>`;
        h += `<button class="ts-btn primary" data-ts-grant="${esc(a.id)}">Give teachers access to pick questions →</button>`;
      } else h += '<span class="hub-sub">Verify every subject\'s syllabus to continue.</span>';
    }
    if (a.status === "with_teachers") h += '<span class="hub-sub">Teachers are picking questions. You will be notified when all subjects are submitted.</span>';
    if (a.status === "submitted") h += `<button class="ts-btn primary" data-ts-review="1">Review & publish in Test Approvals →</button>`;
    if (a.status === "approved") h += `<button class="ts-btn" data-ts-review="1">Open in Test Approvals</button>`;
    if (["draft", "with_teachers", "submitted"].includes(a.status)) h += `<button class="ts-btn" data-ts-date="${esc(a.id)}" data-cur="${esc(a.scheduled_on || "")}">Change date</button>`;
    if (a.status === "cancelled") h += `<button class="ts-btn primary" data-ts-restore="${esc(a.id)}">↩ Restore this test</button><span class="hub-sub">Picked questions and syllabus are still saved.</span>`;
    if (!["approved", "cancelled"].includes(a.status)) h += `<button class="ts-btn danger" data-ts-cancel="${esc(a.id)}">Cancel test</button>`;
    return h;
  }

  function card(a) {
    const st = STAGES.find((x) => x[0] === a.stage) || [a.stage, a.stage, ""];
    const pat = PATTERNS[a.pattern_key]?.label || (a.pattern_key ? a.pattern_key : "Custom");
    return `<div class="hub-card ts-card"><div class="ts-head"><div><h3>${esc(a.title)}</h3>
      <div class="ts-meta">📅 <b>${fmtDate(a.scheduled_on)}</b> ${a.scheduled_on ? `<em>(${inDays(a.scheduled_on)})</em>` : ""} · ⏱ ${a.duration_minutes} min · ${esc(pat)} · ${(a.batches || []).map((b) => esc(b.name)).join(", ") || '<span class="hub-sub">no batch chosen</span>'}${a.syllabus_published_at ? ' · <span class="ts-ann">📣 announced to students</span>' : ""}</div></div>${pill(st[1], st[2])}</div>
      ${stepper(a.stage)}
      <div class="ts-secs">${(a.sections || []).map((s) => sectionRow(a, s)).join("")}</div>
      <div class="ts-actions">${actionsFor(a)}</div></div>`;
  }

  // Cancelled tests: one compact card, with Restore and Delete.
  function archiveCard(a) {
    const pat = PATTERNS[a.pattern_key]?.label || (a.pattern_key ? a.pattern_key : "Custom");
    const sum = (a.sections || []).map((s) => `<b>${esc(s.label)}</b> ${(s.progress || {}).picked || 0}/${(s.progress || {}).needed || 0}`).join(" · ");
    return `<div class="hub-card ts-card ts-arch"><div class="ts-head"><div><h3>${esc(a.title)}</h3>
      <div class="ts-meta">📅 ${fmtDate(a.scheduled_on)} · ⏱ ${a.duration_minutes} min · ${esc(pat)} · ${(a.batches || []).map((b) => esc(b.name)).join(", ") || "no batch"}</div></div>${pill("Cancelled", "")}</div>
      <div class="ts-arch-sum">Picked questions kept: ${sum || "none"}</div>
      <div class="ts-actions"><button class="ts-btn primary" data-ts-restore="${esc(a.id)}">↩ Restore</button><button class="ts-btn danger" data-ts-delete="${esc(a.id)}">Delete permanently</button></div></div>`;
  }

  function paint() {
    const nPub = T.done.filter((a) => a.status === "approved").length, nCan = T.done.filter((a) => a.status === "cancelled").length;
    const tabs = [["open", "In progress" + (T.open.length ? ` (${T.open.length})` : "")], ["published", "Published" + (nPub ? ` (${nPub})` : "")], ["cancelled", "Cancelled" + (nCan ? ` (${nCan})` : "")]];
    T.root.innerHTML = head() + `<div class="fee-tabs">${tabs.map(([id, l]) => `<button class="fee-tab${T.tab === id ? " on" : ""}" data-ts-tab="${id}">${l}</button>`).join("")}</div>` +
      (T.list.length ? T.list.map(T.tab === "cancelled" ? archiveCard : card).join("") : `<div class="hub-empty">${T.tab === "open" ? "No test is being set up. Press <b>+ New test</b> — pick the name, date, pattern and a teacher for each subject." : T.tab === "cancelled" ? "No cancelled tests." : "No published tests yet."}</div>`);
  }

  // ----------------------------------------------------------- modals
  function modal(html, wide) {
    let m = document.getElementById("tsModal");
    if (!m) { m = document.createElement("div"); m.id = "tsModal"; document.body.appendChild(m); }
    m.className = "fee-modal" + (wide ? " wide" : ""); m.hidden = false;
    m.innerHTML = `<div class="fee-mbox"><button class="fee-x" data-ts-close="1" aria-label="Close">✕</button>${html}</div>`;
    return m;
  }
  const closeModal = () => { const m = document.getElementById("tsModal"); if (m) { m.hidden = true; m.innerHTML = ""; } };

  const teacherOptions = (subject, sel) => {
    const mine = T.teachers.filter((t) => String(t.subject || "").toLowerCase().includes(subject));
    const rest = T.teachers.filter((t) => !mine.includes(t));
    const opt = (t) => `<option value="${esc(t.id)}"${t.id === sel ? " selected" : ""}>${esc(t.full_name)}${t.subject ? " — " + esc(t.subject) : ""}</option>`;
    return `<option value="">Choose teacher…</option>` + (mine.length ? `<optgroup label="${esc(SUBJECT_NAME[subject] || subject)} teachers">${mine.map(opt).join("")}</optgroup>` : "") + (rest.length ? `<optgroup label="Other teachers">${rest.map(opt).join("")}</optgroup>` : "");
  };

  // New test ----------------------------------------------------------
  let CREATE = null;
  function newTest() {
    CREATE = { pattern: "neet", rows: [] };
    const d = new Date(Date.now() + 7 * 864e5);
    const m = modal(`<h2>New test</h2><form data-ts-createform="1">
      <div class="fee-grid"><label class="wide">Test name<input name="title" required maxlength="160" placeholder="e.g. NEET Mock 4 — Chapters 1 to 8"></label>
      <label>Test date<input name="scheduled_on" type="date" required min="${todayIso()}" value="${d.toISOString().slice(0, 10)}"></label>
      <label>Pattern (decides questions and marks)<select name="pattern">${Object.entries(PATTERNS).map(([k, p]) => `<option value="${k}"${k === "neet" ? " selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
      <label>Duration (minutes)<input name="duration_minutes" type="number" min="1" max="600" required value="180"></label>
      <label><span><input type="checkbox" name="request_syllabus" checked> Ask teachers for the syllabus first</span></label></div>
      <div class="hub-sub" id="tsPatNote"></div>
      <h4>Which students?</h4><div class="ts-batches">${T.batches.map((b) => `<label><input type="checkbox" name="batch" value="${esc(b.id)}"> ${esc(b.name)}</label>`).join("") || '<span class="hub-sub">No active batches.</span>'}</div>
      <h4>Subjects and teachers</h4><div id="tsRows"></div><div id="tsAddRow" class="hide"><button type="button" class="ts-btn" data-ts-addrow="1">+ Add a subject</button></div>
      <div class="hub-actions"><button class="primary-btn" type="submit">Create test & ask teachers</button><span class="hub-sub" data-ts-err></span></div></form>`, true);
    applyPattern(m, "neet");
  }
  function applyPattern(m, key) {
    const p = PATTERNS[key]; CREATE.pattern = key;
    CREATE.rows = JSON.parse(JSON.stringify(p.rows));
    m.querySelector('[name="duration_minutes"]').value = p.duration;
    m.querySelector("#tsPatNote").textContent = p.note;
    m.querySelector("#tsAddRow").classList.toggle("hide", key !== "custom");
    paintRows(m);
  }
  function rowLabel(r) { return r.subject === "biology" && r.branch ? "Biology — " + r.branch[0].toUpperCase() + r.branch.slice(1) : SUBJECT_NAME[r.subject] || r.subject; }
  function paintRows(m) {
    const custom = CREATE.pattern === "custom";
    m.querySelector("#tsRows").innerHTML = CREATE.rows.map((r, i) => `<div class="ts-row" data-i="${i}">
      <div class="ts-row-h">${custom ? `<select data-row="subject">${Object.entries(SUBJECT_NAME).map(([k, v]) => `<option value="${k}"${k === r.subject ? " selected" : ""}>${v}</option>`).join("")}</select>` : `<b>${esc(rowLabel(r))}</b>`}
        <select data-row="teacher" name="teacher_${i}" required>${teacherOptions(r.subject, r.teacher)}</select>${custom && CREATE.rows.length > 1 ? `<button type="button" class="hub-link fee-linkbtn fee-danger" data-ts-delrow="${i}">Remove</button>` : ""}</div>
      <div class="ts-parts">${r.parts.map((pt, k) => custom
        ? `<span class="ts-part"><input data-part="${k}" data-f="count" type="number" min="1" max="500" value="${pt.count}"> questions · types <select data-part="${k}" data-f="types"><option value="single"${pt.types[0] === "single" ? " selected" : ""}>Single correct</option><option value="multi"${pt.types[0] === "multi" ? " selected" : ""}>Multiple correct</option><option value="numerical"${pt.types[0] === "numerical" ? " selected" : ""}>Numerical</option></select> · +<input data-part="${k}" data-f="mc" type="number" min="0.25" step="0.25" value="${pt.mc}"> / −<input data-part="${k}" data-f="mw" type="number" min="0" step="0.25" value="${pt.mw}"></span>`
        : `<span class="ts-part">${esc(pt.label)}: <b>${pt.count}</b> questions · +${pt.mc}${pt.mw ? " / −" + pt.mw : " / 0"}</span>`).join("")}</div></div>`).join("");
  }
  async function createTest(form) {
    const err = form.querySelector("[data-ts-err]"); const fd = new FormData(form);
    const batchIds = fd.getAll("batch");
    const sections = [];
    for (const [i, r] of CREATE.rows.entries()) {
      const tid = form.querySelector(`[name="teacher_${i}"]`).value;
      if (!tid) { err.textContent = `Choose a teacher for ${rowLabel(r)}.`; return; }
      sections.push({ subject_id: r.subject, branch: r.branch || null, label: rowLabel(r), teacher_id: tid,
        parts: r.parts.map((p) => ({ label: p.label, allowed_types: p.types.length ? p.types : ["single"], question_count: Number(p.count), marks_correct: Number(p.mc), marks_wrong: Number(p.mw), partial_marking: !!p.partial })) });
    }
    if (!batchIds.length && !confirm("No batch chosen yet. You can still create the test, but you must choose batches before announcing it. Continue?")) return;
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; err.textContent = "Creating…";
    const { error } = await db().rpc("asm_admin_create_test", { p: { title: String(fd.get("title")).trim(), scheduled_on: fd.get("scheduled_on"), duration_minutes: Number(fd.get("duration_minutes")),
      pattern_key: CREATE.pattern === "custom" ? null : CREATE.pattern, request_syllabus: !!fd.get("request_syllabus"), batch_ids: batchIds, sections } });
    btn.disabled = false;
    if (error) { err.textContent = error.message; return; }
    closeModal(); T.tab = "open"; await render();
  }

  // Syllabus editor (admin writes the syllabus himself) ---------------
  function scopeModal(sectionId, subject, aid) {
    const a = T.list.find((x) => x.id === aid); const s = a?.sections.find((x) => x.id === sectionId);
    const chosen = new Map((s?.scope || []).map((c) => [c.chapter_id, new Set(c.whole ? [] : c.topic_ids || [])]));
    const chapters = T.chapters.filter((c) => c.subject_id === subject);
    const m = modal(`<h2>Syllabus — ${esc(s?.label || subject)} <small class="hub-sub">${esc(a?.title || "")}</small></h2><form data-ts-scopeform="${esc(sectionId)}">
      ${chapterPicker(chapters, chosen)}<div class="hub-actions"><button class="primary-btn" type="submit">Save syllabus (counts as verified)</button><span class="hub-sub" data-ts-err></span></div></form>`, true);
    return m;
  }
  function chapterPicker(chapters, chosen) {
    return `<div class="ts-chaps">${chapters.map((c) => {
      const tps = T.topics.filter((t) => t.chapter_id === c.id); const on = chosen.has(c.id); const set = chosen.get(c.id) || new Set();
      return `<div class="ts-chap${on ? " on" : ""}"><label class="ts-chap-h"><input type="checkbox" data-chap="${esc(c.id)}"${on ? " checked" : ""}> <b>${esc(c.name)}</b>${c.class_level ? ` <small>Class ${esc(c.class_level)}</small>` : ""}</label>
        ${tps.length ? `<div class="ts-tops"${on ? "" : " hidden"}><label class="ts-top all"><input type="checkbox" data-alltop="${esc(c.id)}"${on && !set.size ? " checked" : ""}> Whole chapter</label>${tps.map((t) => `<label class="ts-top"><input type="checkbox" data-top="${esc(t.id)}" data-of="${esc(c.id)}"${set.has(t.id) ? " checked" : ""}> ${esc(t.label)}</label>`).join("")}</div>` : ""}</div>`;
    }).join("") || '<div class="hub-empty">No chapters for this subject in the question bank.</div>'}</div>`;
  }
  function readScope(form) {
    const out = [];
    form.querySelectorAll("[data-chap]:checked").forEach((c) => {
      const id = c.dataset.chap; const tops = [...form.querySelectorAll(`[data-top][data-of="${id}"]:checked`)].map((t) => t.dataset.top);
      const whole = form.querySelector(`[data-alltop="${id}"]`)?.checked;
      out.push(tops.length && !whole ? { chapter_id: id, topic_ids: tops } : { chapter_id: id });
    });
    return out;
  }

  // Change teacher ----------------------------------------------------
  function dateModal(aid, cur) {
    modal(`<h2>Change the test date</h2><form data-ts-dateform="${esc(aid)}"><label class="wide">New date<input type="date" name="d" value="${esc(cur || "")}" required></label>
      <p class="hub-sub">Teachers are notified. The syllabus and the questions they have already picked stay as they are.</p>
      <div class="hub-actions"><button class="primary-btn" type="submit">Save date</button><span class="hub-sub" data-ts-err></span></div></form>`);
  }

  function teacherModal(sectionId, subject, cur) {
    modal(`<h2>Change teacher</h2><form data-ts-teacherform="${esc(sectionId)}"><label class="wide">Teacher<select name="t" required>${teacherOptions(subject, cur)}</select></label>
      <div class="hub-actions"><button class="primary-btn" type="submit">Save</button><span class="hub-sub" data-ts-err></span></div></form>`);
  }

  // ----------------------------------------------------------- actions
  async function act(fn, ok) {
    if (T.busy) return; T.busy = true;
    try { const { error } = await fn(); if (error) throw error; if (ok) toast(ok); await render(); }
    catch (e) { alert(e.message || String(e)); } finally { T.busy = false; }
  }
  function toast(msg) { let t = document.getElementById("tsToast"); if (!t) { t = document.createElement("div"); t.id = "tsToast"; document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-ts-tab],[data-ts-new],[data-ts-close],[data-ts-verify],[data-ts-back],[data-ts-edit],[data-ts-teacher],[data-ts-pub],[data-ts-unpub],[data-ts-grant],[data-ts-cancel],[data-ts-date],[data-ts-restore],[data-ts-delete],[data-ts-reassign],[data-ts-review],[data-ts-addrow],[data-ts-delrow]");
    if (!t) { if (e.target.id === "tsModal") closeModal(); return; }
    const d = t.dataset;
    if (d.tsTab) { T.tab = d.tsTab; return render(); }
    if (d.tsNew) return newTest();
    if (d.tsClose) return closeModal();
    if (d.tsVerify) return act(() => db().rpc("asm_admin_verify_syllabus", { p_section_id: d.tsVerify, p_approve: true }), "Syllabus verified");
    if (d.tsBack) { const c = prompt("What should the teacher change in the syllabus?"); if (!c || !c.trim()) return; return act(() => db().rpc("asm_admin_verify_syllabus", { p_section_id: d.tsBack, p_approve: false, p_comment: c.trim() }), "Sent back to the teacher"); }
    if (d.tsEdit) return scopeModal(d.tsEdit, d.subject, d.aid);
    if (d.tsTeacher) { e.preventDefault(); return teacherModal(d.tsTeacher, d.subject, d.cur); }
    if (d.tsPub) { const a = T.list.find((x) => x.id === d.tsPub); if (!a.batches.length) return alert("Choose the batches first. (Cancel this test and create it again with batches, or ask for batch editing.)"); if (!confirm(`Announce "${a.title}" (${fmtDate(a.scheduled_on)}) with its syllabus to ${a.batches.map((b) => b.name).join(", ")}?\nStudents will be notified.`)) return; return act(() => db().rpc("asm_admin_set_syllabus_publish", { p_assessment_id: d.tsPub, p_publish: true }), "Announced on the students' dashboard"); }
    if (d.tsUnpub) { if (!confirm("Hide this announcement from the students' dashboard?")) return; return act(() => db().rpc("asm_admin_set_syllabus_publish", { p_assessment_id: d.tsUnpub, p_publish: false }), "Announcement hidden"); }
    if (d.tsGrant) { const a = T.list.find((x) => x.id === d.tsGrant); if (!confirm(`Give the teachers access to pick questions for "${a.title}"?\nEach teacher sees only questions of their own subject and the verified syllabus. The syllabus can't be changed after this.`)) return; return act(() => db().rpc("asm_admin_grant_compose", { p_assessment_id: d.tsGrant }), "Teachers can now pick questions"); }
    if (d.tsDate) return dateModal(d.tsDate, d.cur);
    if (d.tsDelete) { const a = T.list.find((x) => x.id === d.tsDelete); if (!a) return; const typed = prompt(`This deletes "${a.title}" for good, with its syllabus and all picked questions. A cancelled test can be restored instead. Type the test name to confirm:`); if (typed === null) return; if (typed.trim() !== String(a.title).trim()) return alert("The name did not match. Nothing was deleted."); return act(() => db().rpc("asm_admin_delete_test", { p_assessment_id: d.tsDelete }), "Test deleted"); }
    if (d.tsRestore) { if (!confirm("Restore this test? It goes back to the stage it was at, with the syllabus and every picked question.")) return; return act(() => db().rpc("asm_admin_restore", { p_assessment_id: d.tsRestore }), "Test restored"); }
    if (d.tsCancel) { const r = prompt("Why is this test being cancelled? (kept in the history)\nTo move the test to another day, use \"Change date\" instead of cancelling."); if (r === null) return; return act(() => db().rpc("asm_cancel", { p_assessment_id: d.tsCancel, p_reason: r.trim() || "Cancelled by admin" }), "Test cancelled"); }
    if (d.tsReassign) { const c = prompt("What should the teacher change in their questions?"); if (!c || !c.trim()) return; return act(() => db().rpc("asm_reassign", { p_assessment_id: d.aid, p_section_ids: [d.tsReassign], p_comment: c.trim() }), "Sent back to the teacher"); }
    if (d.tsReview) { document.querySelector('.nav-btn[data-section="testApprovals"]')?.click(); return; }
    if (d.tsAddrow) { const m = document.getElementById("tsModal"); CREATE.rows.push({ subject: "physics", parts: [{ label: "Questions", types: ["single"], count: 20, mc: 4, mw: 1 }] }); return paintRows(m); }
    if (d.tsDelrow) { const m = document.getElementById("tsModal"); CREATE.rows.splice(Number(d.tsDelrow), 1); return paintRows(m); }
  });
  document.addEventListener("change", (e) => {
    const m = document.getElementById("tsModal"); if (!m || m.hidden) return;
    if (e.target.name === "pattern") return applyPattern(m, e.target.value);
    const row = e.target.closest(".ts-row"); if (row && CREATE) {
      const r = CREATE.rows[Number(row.dataset.i)];
      if (e.target.dataset.row === "subject") { r.subject = e.target.value; r.teacher = null; paintRows(m); }
      if (e.target.dataset.row === "teacher") r.teacher = e.target.value;
      if (e.target.dataset.part != null) { const p = r.parts[Number(e.target.dataset.part)], f = e.target.dataset.f; if (f === "types") p.types = e.target.value === "multi" ? ["multi"] : e.target.value === "numerical" ? ["numerical", "integer"] : ["single"]; else p[f] = Number(e.target.value); if (f === "types") p.partial = e.target.value === "multi"; }
    }
    const ch = e.target.closest("[data-chap]"); if (ch) { const box = ch.closest(".ts-chap"); box.classList.toggle("on", ch.checked); const tops = box.querySelector(".ts-tops"); if (tops) { tops.hidden = !ch.checked; const all = tops.querySelector("[data-alltop]"); if (ch.checked && all && !tops.querySelector("[data-top]:checked")) all.checked = true; } }
    const all = e.target.closest("[data-alltop]"); if (all && all.checked) all.closest(".ts-tops").querySelectorAll("[data-top]").forEach((x) => (x.checked = false));
    const tp = e.target.closest("[data-top]"); if (tp && tp.checked) { const all2 = tp.closest(".ts-tops").querySelector("[data-alltop]"); if (all2) all2.checked = false; }
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.matches("[data-ts-createform]")) { e.preventDefault(); return createTest(f); }
    if (f.matches("[data-ts-scopeform]")) {
      e.preventDefault(); const scope = readScope(f); const err = f.querySelector("[data-ts-err]");
      if (!scope.length) { err.textContent = "Choose at least one chapter."; return; }
      const { error } = await db().rpc("asm_admin_set_scope", { p_section_id: f.dataset.tsScopeform, p_scope: scope });
      if (error) { err.textContent = error.message; return; } closeModal(); toast("Syllabus saved"); return render();
    }
    if (f.matches("[data-ts-dateform]")) {
      e.preventDefault(); const { error } = await db().rpc("asm_admin_reschedule", { p_assessment_id: f.dataset.tsDateform, p_date: f.d.value });
      if (error) { f.querySelector("[data-ts-err]").textContent = error.message; return; } closeModal(); toast("Date changed"); return render();
    }
    if (f.matches("[data-ts-teacherform]")) {
      e.preventDefault(); const { error } = await db().rpc("asm_admin_set_teacher", { p_section_id: f.dataset.tsTeacherform, p_teacher_id: f.t.value });
      if (error) { f.querySelector("[data-ts-err]").textContent = error.message; return; } closeModal(); toast("Teacher changed"); return render();
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // badge: syllabus waiting for the admin
  async function badge() {
    try { const { data } = await db().rpc("asm_admin_setups", { p_filter: "open" }); if (!Array.isArray(data)) return;
      const n = data.filter((a) => a.stage === "syllabus_review" || a.stage === "review").length;
      const b = document.querySelector('.nav-btn[data-section="hubTestSetup"]'); if (!b) return;
      let c = b.querySelector(".ta-count"); if (!c) { c = document.createElement("span"); c.className = "ta-count"; b.appendChild(c); } c.textContent = n; c.hidden = !n;
    } catch (e) { /* section not set up yet */ }
  }
  window.SIRAdminTests = { render, badge };
})();
