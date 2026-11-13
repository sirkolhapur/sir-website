// =====================================================================
// SIR Admin Hub — grouped navigation + "command centre" features for the
// admin dashboard (admin-dashboard.html). Loaded with `defer`, after the
// page's own scripts; uses the page's global `supabaseClient`.
//
// Working now (real data, nothing invented):
//   Command centre KPIs + alerts on Dashboard, Weekly summary, At-risk
//   radar, Teacher performance, Topic heatmap, Question bank stats,
//   Admissions pipeline, Parent weekly report, Teacher reviews,
//   Trust & security.
// Next phase (clear plan, no fake numbers):
//   Fees Pro, QR attendance, Lectures, Institute & branding,
//   Plans & billing, Onboarding, Demo mode, App & languages, Roadmap.
// =====================================================================
(function () {
  "use strict";
  const db = () => (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5;
  const iso = (d) => new Date(d).toISOString();
  const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
  const pct = (v) => (v == null || isNaN(v) ? "—" : `${Math.round(Number(v))}%`);
  const ago = (v) => { const d = Math.floor((Date.now() - new Date(v)) / DAY); return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`; };
  async function q(builder) { try { const r = await builder; return r.error ? { data: null, error: r.error, count: null } : r; } catch (e) { return { data: null, error: e, count: null }; } }

  // -------------------------------------------------------------------
  // Shared data cache (refreshed when a section opens)
  // -------------------------------------------------------------------
  const C = {};
  async function students() {
    if (C.students) return C.students;
    const [s, b] = await Promise.all([
      q(db().from("students").select("id,student_uid,full_name,phone,batch_id,is_active,created_at")),
      q(db().from("batches").select("id,name,is_active")),
    ]);
    C.batches = b.data || [];
    const bn = new Map(C.batches.map((x) => [x.id, x.name]));
    C.students = (s.data || []).map((x) => ({ ...x, batch: bn.get(x.batch_id) || "—" }));
    return C.students;
  }
  async function results() {
    if (C.results) return C.results;
    const r = await q(db().from("student_test_results").select("student_id,exam_name,test_date,percentage,percentile,batch_rank,marks_obtained,max_marks").order("test_date", { ascending: true }).limit(5000));
    C.results = r.data || [];
    return C.results;
  }
  async function attendance(days) {
    const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
    const r = await q(db().from("student_attendance").select("student_id,attendance_date,status").gte("attendance_date", since).limit(10000));
    return r.data || [];
  }

  // -------------------------------------------------------------------
  // Navigation: groups + new sections
  // -------------------------------------------------------------------
  const NEW = [
    // id, label, group, render, status
    ["hubSummary", "Weekly Summary", "home", renderSummary, "live"],
    ["hubRisk", "At-risk Radar", "academics", renderRisk, "live"],
    ["hubTeacherPerf", "Teacher Performance", "academics", renderTeacherPerf, "live"],
    ["hubHeatmap", "Topic Heatmap", "exams", renderHeatmap, "live"],
    ["hubQB", "Question Bank Stats", "exams", renderQB, "live"],
    ["hubAdmissions", "Admissions Pipeline", "growth", renderAdmissions, "live"],
    ["hubParent", "Parent Weekly Report", "growth", renderParent, "live"],
    ["hubBranding", "Institute & Branding", "platform", () => nextPhase("branding"), "next"],
    ["hubPlans", "Plans & Billing", "platform", () => nextPhase("plans"), "next"],
    ["hubOnboarding", "Onboarding Wizard", "platform", () => nextPhase("onboarding"), "next"],
    ["hubDemo", "Demo Mode", "platform", () => nextPhase("demo"), "next"],
    ["hubApp", "App & Languages", "platform", () => nextPhase("app"), "next"],
    ["hubTrust", "Trust & Security", "platform", renderTrust, "live"],
    ["hubRoadmap", "Build Roadmap", "platform", renderRoadmap, "live"],
  ];
  // Existing sections that are placeholders today get a proper plan page.
  const REPLACE = { attendance: "attendance", lectures: "lectures" };
  const GROUPS = [
    ["home", "Home", ["overview", "hubSummary"]],
    ["academics", "Academics", ["students", "batches", "courses", "teachers", "hubTeacherPerf", "hubRisk"]],
    ["exams", "Exams & Results", ["testApprovals", "results", "hubHeatmap", "hubQB"]],
    ["growth", "Admissions & Parents", ["hubAdmissions", "hubParent"]],
    ["ops", "Operations", ["fees", "attendance", "absentStudents", "lectures"]],
    ["comm", "Communication", ["notices", "reviews", "dsp"]],
    ["settings", "Settings", ["branches", "staff", "staffAccess"]],
    ["platform", "Platform (multi-institute)", ["hubBranding", "hubPlans", "hubOnboarding", "hubDemo", "hubApp", "hubTrust", "hubRoadmap"]],
  ];
  const RENDER = {};
  const LOADED = new Set();

  function showSection(id) {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === id));
    document.querySelectorAll(".section").forEach((s) => s.classList.toggle("active", s.id === id));
    if (RENDER[id]) RENDER[id](false);
    window.scrollTo({ top: 0 });
  }

  function buildNav() {
    const side = $(".sidebar");
    const main = $("main.main");
    if (!side || !main) return;
    const btnFor = (id) => side.querySelector(`.nav-btn[data-section="${id}"]`);
    // New sections + buttons
    for (const [id, label, , render, status] of NEW) {
      if (!document.getElementById(id)) {
        const sec = document.createElement("section");
        sec.className = "section hub-section"; sec.id = id;
        sec.innerHTML = `<div class="hub-loading">Loading…</div>`;
        main.appendChild(sec);
      }
      if (!btnFor(id)) {
        const b = document.createElement("button");
        b.className = "nav-btn"; b.dataset.section = id; b.type = "button";
        b.innerHTML = esc(label) + (status === "next" ? ' <span class="hub-soon">next</span>' : "");
        b.addEventListener("click", () => showSection(id));
        side.appendChild(b);
      }
      RENDER[id] = (force) => { if (force || !LOADED.has(id)) { LOADED.add(id); Promise.resolve(render()).catch((e) => fail(id, e)); } };
    }
    for (const id of Object.keys(REPLACE)) {
      RENDER[id] = () => { if (!LOADED.has(id)) { LOADED.add(id); nextPhase(REPLACE[id], id); } };
      const b = btnFor(id); if (b && !b.querySelector(".hub-soon")) { b.innerHTML = b.textContent.trim() + ' <span class="hub-soon">next</span>'; b.addEventListener("click", () => RENDER[id]()); }
    }
    // Fees: the real module (js/sir-admin-fees.js), reloaded every time it opens.
    RENDER.fees = () => { const el = document.getElementById("fees"); if (el && window.SIRAdminFees) SIRAdminFees.render(el); };
    btnFor("fees")?.addEventListener("click", () => RENDER.fees());
    RENDER.reviews = () => { if (!LOADED.has("reviews")) { LOADED.add("reviews"); renderReviews().catch((e) => fail("reviews", e)); } };
    btnFor("reviews")?.addEventListener("click", () => RENDER.reviews());
    btnFor("overview")?.addEventListener("click", () => refreshHome());

    // Regroup: keep every existing button (and its listeners), add group titles.
    const placed = new Set();
    const frag = document.createDocumentFragment();
    for (const [, title, ids] of GROUPS) {
      const t = document.createElement("div"); t.className = "nav-title hub-nav-title"; t.textContent = title; frag.appendChild(t);
      for (const id of ids) { const b = btnFor(id); if (b) { frag.appendChild(b); placed.add(b); } }
    }
    // Anything not grouped (e.g. SAGE) keeps its own block at the end.
    const rest = [...side.children].filter((el) => !placed.has(el) && !(el.classList.contains("nav-title") && !el.classList.contains("sage-nav-title")));
    side.innerHTML = "";
    side.appendChild(frag);
    rest.forEach((el) => side.appendChild(el));
  }

  function fail(id, e) {
    console.error("Admin hub", id, e);
    const s = document.getElementById(id);
    if (s) s.innerHTML = head(id, "Could not load") + `<div class="hub-card hub-bad">Could not load this view: ${esc(e?.message || e)}</div>`;
  }
  const head = (kicker, title, sub = "", actions = "") =>
    `<div class="section-head hub-head"><div><div class="hub-kicker">${esc(kicker)}</div><h2>${esc(title)}</h2>${sub ? `<p class="hub-sub">${sub}</p>` : ""}</div>${actions}</div>`;
  const kpi = (label, value, sub = "", tone = "", go = "") =>
    `<div class="hub-kpi ${tone}" ${go ? `data-hub-go="${go}" role="button" tabindex="0"` : ""}><span>${esc(label)}</span><b>${value}</b><small>${sub}</small></div>`;
  const empty = (msg) => `<div class="hub-empty">${msg}</div>`;

  // -------------------------------------------------------------------
  // HOME: command centre (injected at the top of the existing overview)
  // -------------------------------------------------------------------
  async function refreshHome() {
    const ov = document.getElementById("overview");
    if (!ov || !db()) return;
    let box = document.getElementById("hubCommand");
    if (!box) {
      box = document.createElement("div"); box.id = "hubCommand";
      const anchor = ov.querySelector(".page-header");
      anchor ? anchor.after(box) : ov.prepend(box);
    }
    box.innerHTML = `<div class="hub-loading">Loading live numbers…</div>`;
    Object.keys(C).forEach((k) => delete C[k]);
    const now = new Date();
    const [st, adm, admOpen, waiting, live, res30, att, risk, fees] = await Promise.all([
      students(),
      q(db().from("admissions").select("id").gte("created_at", iso(Date.now() - 7 * DAY))),
      q(db().from("admissions").select("id,created_at,student_name").eq("status", "new").order("created_at")),
      q(db().from("assessments").select("id").eq("status", "submitted")),
      q(db().from("assessments").select("id,title,ends_at").eq("status", "approved").lte("starts_at", now.toISOString()).gte("ends_at", now.toISOString())),
      q(db().from("student_test_results").select("percentage").gte("test_date", iso(Date.now() - 30 * DAY).slice(0, 10))),
      attendance(0),
      riskList(),
      window.SIRAdminFees ? SIRAdminFees.homeNumbers() : Promise.resolve(null),
    ]);
    const active = st.filter((s) => s.is_active !== false);
    const absentToday = att.filter((a) => a.attendance_date === today() && a.status === "absent").length;
    const markedToday = att.filter((a) => a.attendance_date === today()).length;
    const r30 = (res30.data || []).map((x) => Number(x.percentage)).filter((x) => !isNaN(x));
    const avg30 = r30.length ? r30.reduce((a, b) => a + b, 0) / r30.length : null;
    const stale = (admOpen.data || []).filter((a) => Date.now() - new Date(a.created_at) > 2 * DAY);
    const highRisk = risk.filter((r) => r.level === "high");
    waiting.count = waiting.data ? waiting.data.length : null;
    adm.count = adm.data ? adm.data.length : null;

    const alerts = [];
    if (highRisk.length) alerts.push(["bad", `${highRisk.length} student${highRisk.length > 1 ? "s" : ""} at high risk — falling scores or low marks.`, "hubRisk"]);
    if (stale.length) alerts.push(["warn", `${stale.length} admission enquir${stale.length > 1 ? "ies have" : "y has"} waited more than 2 days without a call.`, "hubAdmissions"]);
    if ((waiting.count || 0) > 0) alerts.push(["warn", `${waiting.count} teacher paper${waiting.count > 1 ? "s are" : " is"} waiting for your approval.`, "testApprovals"]);
    if (fees && fees.overdueStudents) alerts.push(["bad", `${fees.overdueStudents} student${fees.overdueStudents > 1 ? "s have" : " has"} overdue fees (${SIRAdminFees.money(fees.overdue)}).`, "fees"]);
    if (!markedToday) alerts.push(["info", "Attendance has not been marked today.", "absentStudents"]);
    if (absentToday) alerts.push(["warn", `${absentToday} student${absentToday > 1 ? "s" : ""} absent today.`, "absentStudents"]);
    if (!alerts.length) alerts.push(["ok", "All clear — nothing needs your attention right now.", ""]);

    box.innerHTML = `<div class="hub-command">
      <div class="hub-kpis">
        ${kpi("Active students", active.length, `${C.batches.filter((b) => b.is_active !== false).length} batches`, "", "students")}
        ${kpi("Tests live now", (live.data || []).length, (live.data || [])[0] ? esc((live.data || [])[0].title) : "none running", (live.data || []).length ? "glow" : "", "testApprovals")}
        ${kpi("Papers waiting", waiting.count ?? "—", "teacher papers to approve", (waiting.count || 0) ? "warn" : "", "testApprovals")}
        ${kpi("New enquiries (7 days)", adm.count ?? "—", `${(admOpen.data || []).length} not contacted yet`, "", "hubAdmissions")}
        ${kpi("Results (30 days)", r30.length, avg30 == null ? "no tests" : `average ${pct(avg30)}`, "", "results")}
        ${kpi("At-risk students", risk.length, `${highRisk.length} high risk`, highRisk.length ? "bad" : "", "hubRisk")}
        ${kpi("Absent today", markedToday ? absentToday : "—", markedToday ? `${markedToday} marked` : "attendance not marked", "", "absentStudents")}
        ${fees ? kpi("Fees outstanding", SIRAdminFees.money(fees.outstanding), fees.overdue ? `${SIRAdminFees.money(fees.overdue)} overdue` : `today ${SIRAdminFees.money(fees.today)}`, fees.overdue ? "bad" : "", "fees") : kpi("Fees", "—", "open Fees to set up", "dim", "fees")}
      </div>
      <div class="hub-card hub-alerts"><h3>Needs attention</h3>${alerts.map(([t, m, go]) => `<div class="hub-alert ${t}" ${go ? `data-hub-go="${go}" role="button" tabindex="0"` : ""}><i></i><span>${esc(m)}</span>${go ? "<b>›</b>" : ""}</div>`).join("")}</div>
    </div>`;
  }

  // -------------------------------------------------------------------
  // AT-RISK RADAR
  // -------------------------------------------------------------------
  async function riskList() {
    const [st, res, att] = await Promise.all([students(), results(), attendance(14)]);
    const by = new Map();
    for (const r of res) { if (!by.has(r.student_id)) by.set(r.student_id, []); by.get(r.student_id).push(r); }
    const abs = new Map();
    for (const a of att) if (a.status === "absent") abs.set(a.student_id, (abs.get(a.student_id) || 0) + 1);
    const out = [];
    for (const s of st.filter((x) => x.is_active !== false)) {
      const list = (by.get(s.id) || []).filter((r) => r.percentage != null);
      const reasons = []; let score = 0;
      const last = list[list.length - 1];
      if (last && Number(last.percentage) < 40) { reasons.push(`Latest test ${pct(last.percentage)}`); score += 2; }
      if (list.length >= 3) {
        const prev = list.slice(-4, -1).map((r) => Number(r.percentage));
        const avgPrev = prev.reduce((a, b) => a + b, 0) / prev.length;
        const drop = avgPrev - Number(last.percentage);
        if (drop >= 15) { reasons.push(`Dropped ${Math.round(drop)} points vs. previous tests`); score += 2; }
        else if (drop >= 8) { reasons.push(`Down ${Math.round(drop)} points`); score += 1; }
      }
      const a = abs.get(s.id) || 0;
      if (a >= 3) { reasons.push(`${a} absences in 14 days`); score += a >= 5 ? 2 : 1; }
      if (last && Date.now() - new Date(last.test_date) > 45 * DAY && res.some((r) => Date.now() - new Date(r.test_date) < 30 * DAY)) { reasons.push(`No test since ${fmtDate(last.test_date)}`); score += 1; }
      if (score) out.push({ s, reasons, score, level: score >= 3 ? "high" : score === 2 ? "medium" : "watch", last, tests: list.length });
    }
    return out.sort((x, y) => y.score - x.score);
  }
  async function renderRisk() {
    const sec = document.getElementById("hubRisk");
    const list = await riskList();
    sec.innerHTML = head("ACADEMICS", "At-risk Radar", "Early warning from real results and attendance: low latest score, a fall versus earlier tests, repeated absences, or no recent test. Call the student or parent before it becomes a drop-out.",
      `<button class="primary-btn" data-hub-refresh="hubRisk">Refresh</button>`) +
      `<div class="hub-kpis small">${kpi("High risk", list.filter((x) => x.level === "high").length, "act this week", "bad")}${kpi("Medium", list.filter((x) => x.level === "medium").length, "watch closely", "warn")}${kpi("Watch", list.filter((x) => x.level === "watch").length, "early signs")}</div>` +
      (list.length ? `<div class="table-card"><table class="hub-table"><thead><tr><th>Student</th><th>Batch</th><th>Risk</th><th>Why</th><th>Latest</th><th>Tests</th><th></th></tr></thead><tbody>${list.map((r) =>
        `<tr><td><b>${esc(r.s.full_name)}</b><small>${esc(r.s.student_uid || "")}</small></td><td>${esc(r.s.batch)}</td><td><span class="hub-pill ${r.level}">${r.level}</span></td><td>${r.reasons.map(esc).join("<br>")}</td><td>${r.last ? `${pct(r.last.percentage)}<small>${fmtDate(r.last.test_date)}</small>` : "—"}</td><td>${r.tests}</td><td>${r.s.phone ? `<a class="hub-link" href="tel:${esc(r.s.phone)}">Call</a>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : empty("No student shows a risk signal right now. 🎉"));
  }

  // -------------------------------------------------------------------
  // TEACHER PERFORMANCE
  // -------------------------------------------------------------------
  async function renderTeacherPerf() {
    const sec = document.getElementById("hubTeacherPerf");
    const since = iso(Date.now() - 30 * DAY);
    const [t, secs, slots, books, revs] = await Promise.all([
      q(db().from("teachers").select("id,full_name,subject,is_active").order("full_name")),
      q(db().from("assessment_sections").select("teacher_id,assessment_id,status")),
      q(db().from("dsp_slots").select("teacher_id,status,slot_date").gte("slot_date", since.slice(0, 10))),
      q(db().from("dsp_bookings").select("teacher_id,status,booking_date").gte("booking_date", since.slice(0, 10))),
      q(db().from("student_reviews").select("teacher_id,created_at").gte("created_at", since)),
    ]);
    const rows = (t.data || []).filter((x) => x.is_active !== false).map((x) => {
      const mySecs = (secs.data || []).filter((s) => s.teacher_id === x.id);
      return {
        x, papers: new Set(mySecs.map((s) => s.assessment_id)).size,
        sent: mySecs.filter((s) => s.status === "submitted" || s.status === "approved").length,
        slots: (slots.data || []).filter((s) => s.teacher_id === x.id).length,
        booked: (books.data || []).filter((s) => s.teacher_id === x.id && s.status !== "cancelled").length,
        done: (books.data || []).filter((s) => s.teacher_id === x.id && s.status === "completed").length,
        reviews: (revs.data || []).filter((s) => s.teacher_id === x.id).length,
      };
    });
    sec.innerHTML = head("ACADEMICS", "Teacher Performance", "Last 30 days: test papers, Doubt Solving slots and bookings, and weekly student reviews written.") +
      (rows.length ? `<div class="table-card"><table class="hub-table"><thead><tr><th>Teacher</th><th>Subject</th><th>Test papers</th><th>DSP slots</th><th>DSP booked</th><th>DSP completed</th><th>Student reviews</th></tr></thead><tbody>${rows.map((r) =>
        `<tr><td><b>${esc(r.x.full_name)}</b></td><td>${esc(r.x.subject || "—")}</td><td>${r.papers}${r.sent ? `<small>${r.sent} sent</small>` : ""}</td><td>${r.slots}</td><td>${r.booked}</td><td>${r.done}</td><td>${r.reviews}${r.reviews ? "" : ' <span class="hub-pill watch">none</span>'}</td></tr>`).join("")}</tbody></table></div>` : empty("No active teachers."));
  }

  // -------------------------------------------------------------------
  // TOPIC HEATMAP (online tests → topic accuracy per batch)
  // -------------------------------------------------------------------
  async function renderHeatmap() {
    const sec = document.getElementById("hubHeatmap");
    sec.innerHTML = head("EXAMS", "Topic Heatmap", "Accuracy of each batch on each chapter / topic, from online tests taken on the student dashboard.") + `<div class="hub-loading">Building heatmap…</div>`;
    const att = await q(db().from("assessment_attempts").select("id,student_id").eq("status", "submitted").limit(5000));
    if (!(att.data || []).length) { sec.innerHTML = head("EXAMS", "Topic Heatmap", "Accuracy of each batch on each chapter / topic, from online tests.") + empty("The heatmap fills in after the first online test is taken. Publish a paper from <b>Test Approvals</b> to start."); return; }
    const ids = att.data.map((a) => a.id);
    const resp = [];
    for (let i = 0; i < ids.length; i += 200) { const r = await q(db().from("assessment_responses").select("attempt_id,aq_id,result").in("attempt_id", ids.slice(i, i + 200))); resp.push(...(r.data || [])); }
    const aqIds = [...new Set(resp.map((r) => r.aq_id))];
    const aqs = []; for (let i = 0; i < aqIds.length; i += 200) { const r = await q(db().from("assessment_questions").select("id,question_id").in("id", aqIds.slice(i, i + 200))); aqs.push(...(r.data || [])); }
    const qIds = [...new Set(aqs.map((a) => a.question_id))];
    const qs = []; for (let i = 0; i < qIds.length; i += 200) { const r = await q(db().from("qb_questions").select("id,chapter_id,topic_id").in("id", qIds.slice(i, i + 200))); qs.push(...(r.data || [])); }
    const [tp, ch, st] = await Promise.all([q(db().from("qb_topics").select("id,label")), q(db().from("qb_chapters").select("id,name")), students()]);
    const topicName = new Map((tp.data || []).map((x) => [x.id, x.label])), chName = new Map((ch.data || []).map((x) => [x.id, x.name]));
    const qOf = new Map(aqs.map((a) => [a.id, a.question_id])), qRow = new Map(qs.map((x) => [x.id, x]));
    const batchOf = new Map(st.map((s) => [s.id, s.batch])), studOf = new Map(att.data.map((a) => [a.id, a.student_id]));
    const grid = new Map(), topics = new Map();
    for (const r of resp) {
      const qq = qRow.get(qOf.get(r.aq_id)); if (!qq) continue;
      const key = qq.topic_id || qq.chapter_id; const label = topicName.get(qq.topic_id) || chName.get(qq.chapter_id) || "Other";
      topics.set(key, { label, chapter: chName.get(qq.chapter_id) || "" });
      const batch = batchOf.get(studOf.get(r.attempt_id)) || "—";
      const k = batch + "|" + key; const g = grid.get(k) || { n: 0, c: 0 }; g.n++; if (r.result === "correct" || r.result === "bonus") g.c++; grid.set(k, g);
    }
    const batches = [...new Set([...grid.keys()].map((k) => k.split("|")[0]))].sort();
    const cols = [...topics.entries()].sort((a, b) => a[1].chapter.localeCompare(b[1].chapter) || a[1].label.localeCompare(b[1].label));
    const cell = (b, key) => { const g = grid.get(b + "|" + key); if (!g) return `<td class="hm-na">·</td>`; const p = Math.round((100 * g.c) / g.n); return `<td class="hm" style="--p:${p}" title="${g.c}/${g.n} correct">${p}%</td>`; };
    sec.innerHTML = head("EXAMS", "Topic Heatmap", "Accuracy of each batch on each topic (online tests). Red = re-teach, green = strong.") +
      `<div class="table-card hub-scroll"><table class="hub-table hm-table"><thead><tr><th>Batch</th>${cols.map(([, t]) => `<th title="${esc(t.chapter)}">${esc(t.label)}</th>`).join("")}</tr></thead><tbody>${batches.map((b) => `<tr><td><b>${esc(b)}</b></td>${cols.map(([k]) => cell(b, k)).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  // -------------------------------------------------------------------
  // QUESTION BANK STATS
  // -------------------------------------------------------------------
  async function renderQB() {
    const sec = document.getElementById("hubQB");
    const [subs, live, pending, adv, papers] = await Promise.all([
      q(db().from("qb_subjects").select("id,name").order("sort_order")),
      q(db().from("qb_questions").select("subject_id,status,tags").limit(20000)),
      q(db().from("qb_import_items").select("id", { count: "exact", head: true }).eq("status", "review_required").is("deleted_at", null)),
      Promise.resolve(null),
      q(db().from("assessments").select("status,kind")),
    ]);
    const Q = live.data || [];
    const by = (s, st) => Q.filter((x) => x.subject_id === s && (!st || x.status === st)).length;
    const advN = Q.filter((x) => (x.tags || []).includes("pool:advanced")).length;
    const P = papers.data || [];
    sec.innerHTML = head("EXAMS", "Question Bank Stats", "Size and health of the question bank, and how many papers were made from it.") +
      `<div class="hub-kpis">${kpi("Verified (live)", Q.filter((x) => x.status === "live").length, "usable in tests", "glow")}${kpi("Waiting in Review & Edit", pending.count ?? "—", "extracted, not verified yet", (pending.count || 0) ? "warn" : "")}${kpi("Advanced (tough)", advN, "test-series level")}${kpi("Papers published", P.filter((p) => p.status === "approved").length, `${P.filter((p) => p.status === "submitted").length} waiting`)}</div>` +
      `<div class="table-card"><table class="hub-table"><thead><tr><th>Subject</th><th>Live</th><th>Draft</th><th>Retired</th></tr></thead><tbody>${(subs.data || []).map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${by(s.id, "live")}</td><td>${by(s.id, "draft")}</td><td>${by(s.id, "retired")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  // -------------------------------------------------------------------
  // ADMISSIONS PIPELINE
  // -------------------------------------------------------------------
  const STAGES = [["new", "New enquiry"], ["contacted", "Contacted"], ["processing", "Demo / counselling"], ["approved", "Admitted"], ["rejected", "Not interested"], ["closed", "Closed"]];
  async function renderAdmissions() {
    const sec = document.getElementById("hubAdmissions");
    const [r, cs] = await Promise.all([
      q(db().from("admissions").select("*").order("created_at", { ascending: false }).limit(500)),
      q(db().rpc("crm_counsellors")),
    ]);
    const who = new Map((cs.data || []).map((c) => [c.id, c.full_name]));
    if (r.error) throw r.error;
    const list = r.data || [];
    const conv = list.length ? Math.round((100 * list.filter((a) => a.status === "approved").length) / list.length) : 0;
    sec.innerHTML = head("ADMISSIONS", "Admissions Pipeline", "Every enquiry, from first call to admission. Admission Counsellors work in the <b>Admission CRM</b> (calls, follow-ups, WhatsApp, timeline); you see everything here.",
      `<div class="hub-actions" style="margin:0"><a class="hub-btn2" href="crm.html" target="_blank" rel="noopener">Open Admission CRM ↗</a><button class="primary-btn" data-hub-refresh="hubAdmissions">Refresh</button></div>`) +
      ((cs.data || []).some((c) => c.designation === "Admission Counsellor") ? "" : `<div class="hub-next"><span class="hub-pill watch">set up</span> No Admission Counsellor yet. In <b>Staff Directory</b>, give a staff member the designation <b>Admission Counsellor</b> — new enquiries are then assigned to them automatically and they log in at <b>sir.net.in/crm.html</b>.</div>`) +
      `<div class="hub-kpis small">${kpi("Enquiries", list.length, "all time")}${kpi("This week", list.filter((a) => Date.now() - new Date(a.created_at) < 7 * DAY).length, "new")}${kpi("Waiting > 2 days", list.filter((a) => a.status === "new" && Date.now() - new Date(a.created_at) > 2 * DAY).length, "call them first", "warn")}${kpi("Conversion", conv + "%", "enquiry → admitted")}</div>` +
      `<div class="hub-board">${STAGES.map(([st, label]) => {
        const items = list.filter((a) => a.status === st);
        return `<div class="hub-col"><div class="hub-colhead">${esc(label)} <i>${items.length}</i></div>${items.map((a) => {
          const wa = String(a.phone || "").replace(/\D/g, "");
          const wa91 = wa.length === 10 ? "91" + wa : wa;
          return `<div class="hub-lead"><b>${esc(a.student_name)}</b><small>${esc([a.course_interest, a.school_name].filter(Boolean).join(" · ") || "—")}</small><small>👤 ${esc(who.get(a.assigned_to) || "Unassigned")}${a.next_follow_up_at ? " · follow-up " + esc(fmtDate(a.next_follow_up_at)) : ""}</small>
            ${a.message ? `<p>${esc(a.message).slice(0, 160)}</p>` : ""}
            <div class="hub-leadmeta"><span>${ago(a.created_at)}</span>${a.phone ? `<a class="hub-link" href="tel:${esc(a.phone)}">Call</a><a class="hub-link" target="_blank" rel="noopener" href="https://wa.me/${esc(wa91)}?text=${encodeURIComponent(`Hello${a.parent_name ? " " + a.parent_name : ""}, this is SIR Kolhapur regarding the admission enquiry for ${a.student_name}.`)}">WhatsApp</a>` : ""}</div>
            <select class="hub-stage" data-hub-stage="${esc(a.id)}">${STAGES.map(([v, l]) => `<option value="${v}"${v === a.status ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
        }).join("") || '<div class="hub-colempty">—</div>'}</div>`;
      }).join("")}</div>`;
  }
  async function setStage(id, status, el) {
    el.disabled = true;
    const r = await q(db().from("admissions").update({ status }).eq("id", id));
    el.disabled = false;
    if (r.error) { alert("Could not change the stage: " + (r.error.message || r.error)); return; }
    LOADED.delete("hubAdmissions"); RENDER.hubAdmissions(true);
  }

  // -------------------------------------------------------------------
  // WEEKLY SUMMARY (auto-written from the data)
  // -------------------------------------------------------------------
  async function renderSummary() {
    const sec = document.getElementById("hubSummary");
    const since = Date.now() - 7 * DAY;
    const [st, res, att, adm, papers, books, risk] = await Promise.all([
      students(), results(), attendance(7),
      q(db().from("admissions").select("status,created_at").gte("created_at", iso(since))),
      q(db().from("assessments").select("title,status,approved_at").gte("approved_at", iso(since))),
      q(db().from("dsp_bookings").select("status,booking_date").gte("booking_date", iso(since).slice(0, 10))),
      riskList(),
    ]);
    const wk = res.filter((r) => new Date(r.test_date) >= new Date(since - DAY));
    const exams = [...new Set(wk.map((r) => r.exam_name))];
    const pcts = wk.map((r) => Number(r.percentage)).filter((x) => !isNaN(x));
    const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    const top = [...wk].sort((a, b) => Number(b.percentage) - Number(a.percentage))[0];
    const name = (id) => st.find((s) => s.id === id)?.full_name || "a student";
    const present = att.filter((a) => a.status === "present" || a.status === "late").length;
    const lines = [
      `📅 Week ending ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
      exams.length ? `📝 ${exams.length} test${exams.length > 1 ? "s" : ""} recorded (${exams.slice(0, 4).join(", ")}${exams.length > 4 ? "…" : ""}) — average ${pct(avg)}.` : "📝 No test results recorded this week.",
      top ? `🏆 Top score: ${name(top.student_id)} with ${pct(top.percentage)} in ${top.exam_name}.` : null,
      att.length ? `✅ Attendance: ${Math.round((100 * present) / att.length)}% (${att.length} marks).` : "✅ Attendance was not marked this week.",
      `🎯 At-risk students: ${risk.length} (${risk.filter((r) => r.level === "high").length} high).`,
      `📞 New admission enquiries: ${(adm.data || []).length}.`,
      `🧪 Online papers published: ${(papers.data || []).filter((p) => p.status === "approved").length}.`,
      `💬 Doubt Solving sessions booked: ${(books.data || []).filter((b) => b.status !== "cancelled").length}.`,
    ].filter(Boolean);
    sec.innerHTML = head("HOME", "Weekly Summary", "Written automatically from this week's data — copy it into the staff WhatsApp group.", `<button class="primary-btn" data-hub-copy="hubSummaryText">Copy</button>`) +
      `<div class="hub-card"><pre class="hub-pre" id="hubSummaryText">${esc(lines.join("\n"))}</pre></div>`;
  }

  // -------------------------------------------------------------------
  // PARENT WEEKLY REPORT
  // -------------------------------------------------------------------
  async function renderParent() {
    const sec = document.getElementById("hubParent");
    const st = (await students()).filter((s) => s.is_active !== false).sort((a, b) => a.full_name.localeCompare(b.full_name));
    sec.innerHTML = head("PARENTS", "Parent Weekly Report", "A ready report for each student — latest tests, attendance and the teacher's review. Copy it or open WhatsApp. (Automatic weekly sending comes with the WhatsApp integration.)") +
      `<div class="hub-card hub-row"><label>Batch<select id="hubPBatch"><option value="">All batches</option>${C.batches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
       <label>Student<select id="hubPStudent">${st.map((s) => `<option value="${esc(s.id)}" data-batch="${esc(s.batch_id || "")}">${esc(s.full_name)} (${esc(s.student_uid || "")})</option>`).join("")}</select></label></div>
       <div id="hubPOut"></div>`;
    const draw = async () => {
      const id = $("#hubPStudent").value; const s = st.find((x) => x.id === id); const out = $("#hubPOut");
      if (!s) { out.innerHTML = empty("Choose a student."); return; }
      const [res, att, rev] = await Promise.all([
        results(), attendance(7),
        q(db().from("student_reviews").select("week_start,week_end,strengths,areas_to_improve,teacher_note,created_at").eq("student_id", id).order("created_at", { ascending: false }).limit(1)),
      ]);
      const mine = res.filter((r) => r.student_id === id).slice(-3).reverse();
      const a = att.filter((x) => x.student_id === id);
      const pres = a.filter((x) => x.status === "present" || x.status === "late").length;
      const rv = (rev.data || [])[0];
      const text = [
        `Dear Parent,`, `Weekly update for ${s.full_name} (${s.batch}) from SIR Kolhapur:`, ``,
        mine.length ? `📝 Recent tests:\n${mine.map((r) => `• ${r.exam_name} (${fmtDate(r.test_date)}): ${r.marks_obtained ?? "—"}/${r.max_marks ?? "—"} = ${pct(r.percentage)}${r.batch_rank ? `, batch rank ${r.batch_rank}` : ""}`).join("\n")}` : `📝 No test results this week.`,
        a.length ? `✅ Attendance this week: ${pres}/${a.length} days.` : `✅ Attendance: not recorded this week.`,
        rv ? `👩‍🏫 Teacher's review:${rv.strengths ? `\n• Strengths: ${rv.strengths}` : ""}${rv.areas_to_improve ? `\n• To improve: ${rv.areas_to_improve}` : ""}${rv.teacher_note ? `\n• Note: ${rv.teacher_note}` : ""}` : null,
        ``, `For any query, please contact the SIR office.`,
      ].filter((x) => x !== null).join("\n");
      const phone = String(s.phone || "").replace(/\D/g, ""); const p91 = phone.length === 10 ? "91" + phone : phone;
      out.innerHTML = `<div class="hub-card"><pre class="hub-pre" id="hubPText">${esc(text)}</pre><div class="hub-actions"><button class="primary-btn" data-hub-copy="hubPText">Copy</button>${p91 ? `<a class="hub-btn2" target="_blank" rel="noopener" href="https://wa.me/${esc(p91)}?text=${encodeURIComponent(text)}">Open in WhatsApp</a>` : '<span class="hub-sub">No phone number saved for this student.</span>'}</div></div>`;
    };
    $("#hubPBatch").onchange = () => { const b = $("#hubPBatch").value; [...$("#hubPStudent").options].forEach((o) => (o.hidden = !!b && o.dataset.batch !== b)); const first = [...$("#hubPStudent").options].find((o) => !o.hidden); if (first) $("#hubPStudent").value = first.value; draw(); };
    $("#hubPStudent").onchange = draw;
    draw();
  }

  // -------------------------------------------------------------------
  // TEACHER REVIEWS (was a placeholder)
  // -------------------------------------------------------------------
  async function renderReviews() {
    const sec = document.getElementById("reviews");
    const [r, t, st] = await Promise.all([
      q(db().from("student_reviews").select("student_id,teacher_id,week_start,week_end,academic_understanding,class_participation,practice_consistency,strengths,areas_to_improve,created_at").order("created_at", { ascending: false }).limit(100)),
      q(db().from("teachers").select("id,full_name")), students(),
    ]);
    const tn = new Map((t.data || []).map((x) => [x.id, x.full_name])), sn = new Map(st.map((x) => [x.id, x]));
    const list = r.data || [];
    sec.innerHTML = head("COMMUNICATION", "Teacher Reviews", "Weekly reviews teachers write for students (shown on the student dashboard).") +
      (list.length ? `<div class="table-card"><table class="hub-table"><thead><tr><th>Week</th><th>Student</th><th>Teacher</th><th>Understanding</th><th>Participation</th><th>Practice</th><th>Strengths / to improve</th></tr></thead><tbody>${list.map((x) =>
        `<tr><td>${fmtDate(x.week_start)} – ${fmtDate(x.week_end)}</td><td><b>${esc(sn.get(x.student_id)?.full_name || "—")}</b><small>${esc(sn.get(x.student_id)?.batch || "")}</small></td><td>${esc(tn.get(x.teacher_id) || "—")}</td><td>${esc(x.academic_understanding || "—")}</td><td>${esc(x.class_participation || "—")}</td><td>${esc(x.practice_consistency || "—")}</td><td>${esc(x.strengths || "")}${x.areas_to_improve ? `<small>↗ ${esc(x.areas_to_improve)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : empty("No weekly reviews written yet. Teachers write them from the teacher dashboard."));
  }

  // -------------------------------------------------------------------
  // TRUST & SECURITY (real status)
  // -------------------------------------------------------------------
  function renderTrust() {
    const items = [
      ["done", "Row-level security on every table", "Students see only their own data; teachers only their scope."],
      ["done", "Admin-only actions checked on the server", "Teacher password resets, staff creation and student status need an admin role."],
      ["done", "Login throttling and OTP limits", "8 failed student logins / 15 min lock; OTP capped per number and site-wide."],
      ["done", "Answers never sent before release", "Online tests are scored on the server; answers appear only after the test closes."],
      ["done", "Confidential test-series sources", "The institute behind a tough question is known only to the coordinator/admin."],
      ["done", "Pinned, integrity-checked scripts", "All CDN scripts are version-pinned with SRI hashes."],
      ["next", "Security headers via Cloudflare", "CSP (report-only first), HSTS, frame protection — rule ready in docs/cloudflare-security-headers.md."],
      ["next", "DMARC enforcement", "Move _dmarc to p=quarantine to stop spoofed @sir.net.in mail."],
      ["next", "Daily backups + restore drill", "Supabase Pro point-in-time recovery; monthly restore test."],
      ["next", "Admin audit log", "Who changed what and when — results, fees, approvals."],
      ["next", "MFA for admin accounts", "Second factor for every admin login."],
    ];
    document.getElementById("hubTrust").innerHTML = head("PLATFORM", "Trust & Security", "What protects student data today, and what comes next. Show this page to parents and partner institutes.") +
      `<div class="hub-list">${items.map(([s, t, d]) => `<div class="hub-item ${s}"><i>${s === "done" ? "✓" : "…"}</i><div><b>${esc(t)}</b><small>${esc(d)}</small></div><span class="hub-pill ${s === "done" ? "ok" : "watch"}">${s === "done" ? "live" : "next"}</span></div>`).join("")}</div>`;
  }

  // -------------------------------------------------------------------
  // NEXT-PHASE PAGES
  // -------------------------------------------------------------------
  const PLAN = {
    fees: { k: "OPERATIONS", t: "Fees & Collection", why: "Know today's collection, dues and defaulters in one place — and remind parents automatically.",
      will: ["Fee plans per course/batch with instalments and due dates", "Record payments (cash / UPI / cheque / online) with PDF receipts", "Dues and defaulter list, today / month collection on the home screen", "WhatsApp reminders 3 days before and on the due date", "Online payment link (UPI / Razorpay) — parent pays, receipt auto-sent"],
      need: ["Your fee structure (courses, amounts, instalments)", "Receipt format (institute name, GST if any)", "Razorpay/UPI merchant account for online payment (optional)"] },
    attendance: { k: "OPERATIONS", t: "Attendance (QR)", why: "Attendance in seconds and an instant message to parents when a child is absent.",
      will: ["Teacher marks a batch in one screen (present / absent / late)", "QR code per class: students scan from their phone on arrival", "Automatic WhatsApp to the parent on absence", "Monthly attendance report per student and batch", "Feeds the At-risk Radar and the Parent Weekly Report"],
      need: ["Batch timetable (which batch, which days/times)", "Decision: teacher marking, QR, or both", "WhatsApp templates approved in AiSensy"] },
    lectures: { k: "OPERATIONS", t: "Lectures & Timetable", why: "One timetable for every batch, teacher hours, and recorded lectures for revision.",
      will: ["Weekly timetable per batch and per teacher, clash detection", "Mark lecture done + topic covered (syllabus progress)", "Teacher hours report (for payroll)", "Recorded lecture links per chapter on the student dashboard"],
      need: ["Current timetable (any format)", "Where recordings are kept (YouTube unlisted / Drive)"] },
    branding: { k: "PLATFORM", t: "Institute & Branding", why: "Run other institutes on the same software — each with its own name, logo, colours and web address.",
      will: ["Institute profile: name, logo, colours, contact, address", "Own sub-domain (e.g. abc.sir.net.in) or their domain", "Every table separated by institute (no data mixing)", "Remove SIR-only settings (e.g. fixed admin e-mail checks)"],
      need: ["Decision to sell to other institutes", "Pricing model (see Plans & Billing)"] },
    plans: { k: "PLATFORM", t: "Plans & Billing", why: "Charge partner institutes per student, with features per plan.",
      will: ["Plans: Basic (students, results, notices) / Pro (+ question bank, online tests, AI) / Enterprise", "Per-student monthly pricing, invoices, usage limits", "Feature switches per institute by plan", "Free trial with demo data"],
      need: ["Price points you want to charge", "Billing method (Razorpay subscriptions / manual invoice)"] },
    onboarding: { k: "PLATFORM", t: "Onboarding Wizard", why: "A new institute goes live in 10 minutes.",
      will: ["Step 1: institute profile and logo", "Step 2: courses and batches", "Step 3: import students from Excel (template provided)", "Step 4: add teachers and staff", "Step 5: first notice and first test — done"],
      need: ["Excel templates (students, teachers) — we already have the result template"] },
    demo: { k: "PLATFORM", t: "Demo Mode", why: "Show the full product to a prospective institute without exposing real students.",
      will: ["A separate demo institute with realistic sample students, results and tests", "One-click 'Reset demo'", "Demo login for sales calls"],
      need: ["Multi-institute setup (Institute & Branding) first"] },
    app: { k: "PLATFORM", t: "App & Languages", why: "Parents and students use phones — an installable app and their own language increase daily use.",
      will: ["Installable app (PWA) for students, parents and teachers — home-screen icon, works on slow internet", "Push notifications for tests, results and notices", "Marathi and Hindi interface", "Parent login with a child switcher"],
      need: ["App icon and name", "Translations review by a staff member"] },
  };
  function nextPhase(key, sectionId) {
    const p = PLAN[key]; const sec = document.getElementById(sectionId || NEW.find((n) => n[4] === "next" && PLAN_KEY[n[0]] === key)?.[0]);
    if (!p || !sec) return;
    sec.innerHTML = head(p.k, p.t, esc(p.why)) +
      `<div class="hub-next"><span class="hub-pill watch">next phase</span> This module is planned and not switched on yet — no numbers are shown until real records exist.</div>
       <div class="hub-grid2"><div class="hub-card"><h3>What it will do</h3><ul>${p.will.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
       <div class="hub-card"><h3>What we need from you</h3><ul>${p.need.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>`;
  }
  const PLAN_KEY = { hubBranding: "branding", hubPlans: "plans", hubOnboarding: "onboarding", hubDemo: "demo", hubApp: "app" };

  // -------------------------------------------------------------------
  // ROADMAP
  // -------------------------------------------------------------------
  function renderRoadmap() {
    const live = [["Fees & collection (plans, instalments, receipts, dues)", "fees"], ["Command centre & alerts", "overview"], ["Weekly summary", "hubSummary"], ["At-risk radar", "hubRisk"], ["Teacher performance", "hubTeacherPerf"], ["Topic heatmap", "hubHeatmap"], ["Question bank stats", "hubQB"], ["Admissions pipeline", "hubAdmissions"], ["Parent weekly report (copy / WhatsApp)", "hubParent"], ["Teacher reviews", "reviews"], ["Trust & security", "hubTrust"]];
    const next = [["1", "Attendance (teacher + QR) with parent alerts", "attendance"], ["2", "Automatic WhatsApp: weekly parent report + fee reminders", "hubParent"], ["3", "Online fee payment (UPI / Razorpay)", "fees"], ["4", "Lectures & timetable", "lectures"], ["5", "Multi-institute + branding", "hubBranding"], ["6", "Onboarding wizard", "hubOnboarding"], ["7", "Plans & billing", "hubPlans"], ["8", "Demo mode", "hubDemo"], ["9", "App (PWA) + Marathi / Hindi", "hubApp"], ["10", "Ask-AI assistant for the admin", "hubSummary"]];
    document.getElementById("hubRoadmap").innerHTML = head("PLATFORM", "Build Roadmap", "What is live in the admin dashboard and the order in which the rest is being built.") +
      `<div class="hub-grid2"><div class="hub-card"><h3>Live now</h3>${live.map(([t, go]) => `<div class="hub-item done" data-hub-go="${go}" role="button" tabindex="0"><i>✓</i><div><b>${esc(t)}</b></div><span class="hub-pill ok">live</span></div>`).join("")}</div>
       <div class="hub-card"><h3>Next, in order</h3>${next.map(([n, t, go]) => `<div class="hub-item" data-hub-go="${go}" role="button" tabindex="0"><i>${n}</i><div><b>${esc(t)}</b></div><span class="hub-pill watch">next</span></div>`).join("")}</div></div>`;
  }

  // -------------------------------------------------------------------
  // Wire-up
  // -------------------------------------------------------------------
  function cleanDevText() {
    // Notes meant for developers should not show to the admin.
    document.querySelectorAll("#absentStudents p, #absentStudents .note, #absentStudents small, #overview p, #overview small").forEach((el) => {
      if (/SQL migration|V2 source|not connected|will appear here once/i.test(el.textContent)) el.textContent = el.textContent.replace(/This list uses the additive student_attendance table\.\s*Run the supplied SQL migration before using it\./i, "Shows students marked absent on the chosen date.").replace(/Collection figures will appear here once payment records are connected\./i, "Fee collection appears here once the Fees module is switched on.");
    });
  }

  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-hub-go]");
    if (go) { const id = go.dataset.hubGo; const b = document.querySelector(`.nav-btn[data-section="${id}"]`); b ? b.click() : showSection(id); return; }
    const rf = e.target.closest("[data-hub-refresh]");
    if (rf) { Object.keys(C).forEach((k) => delete C[k]); LOADED.delete(rf.dataset.hubRefresh); RENDER[rf.dataset.hubRefresh]?.(true); return; }
    const cp = e.target.closest("[data-hub-copy]");
    if (cp) { const t = document.getElementById(cp.dataset.hubCopy)?.textContent || ""; navigator.clipboard?.writeText(t).then(() => { cp.textContent = "Copied ✓"; setTimeout(() => (cp.textContent = "Copy"), 1500); }); }
  });
  // Every menu click starts the section at the top (the menu is long).
  document.addEventListener("click", (e) => { if (e.target.closest(".sidebar .nav-btn")) window.scrollTo({ top: 0 }); });
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-hub-go]")) { e.preventDefault(); e.target.click(); } });
  document.addEventListener("change", (e) => { const s = e.target.closest("[data-hub-stage]"); if (s) setStage(s.dataset.hubStage, s.value, s); });

  function start() {
    buildNav();
    cleanDevText();
    // Home numbers after the admin session is ready (wraps the page's loader).
    if (typeof window.loadAdminModules === "function" && !window.loadAdminModules.__hub) {
      const orig = window.loadAdminModules;
      window.loadAdminModules = async function () { const r = await orig.apply(this, arguments); refreshHome().catch((e) => console.error("Admin hub home", e)); return r; };
      window.loadAdminModules.__hub = true;
    }
    // The page may already have loaded its modules before this script ran
    // (saved session): fill the home numbers once the dashboard is visible.
    let tries = 0;
    const wait = setInterval(async () => {
      tries++;
      const page = document.getElementById("dashboardPage");
      const visible = page && getComputedStyle(page).display !== "none";
      let session = null; try { session = (await db()?.auth.getSession())?.data?.session; } catch (e) {}
      if ((visible && session) || tries > 60) { clearInterval(wait); if (visible && session && !document.getElementById("hubCommand")) refreshHome().catch((e) => console.error("Admin hub home", e)); }
    }, 500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.SIRAdminHub = { refreshHome, showSection };
})();
