// =====================================================================
// SIR Test Center (student dashboard → Tests)
//
//   Hub        Attempt test · Results & analysis · Missed, with live
//              countdowns. Only papers the admin approved and published
//              to the student's batch appear (asm_student_list).
//   Brief      instructions + "I'm ready" before the timer starts.
//   Exam       NTA-style: section tabs, question palette (side panel on
//              wide screens, bottom sheet on phones), mark for review,
//              per-question time, server deadline, autosave per question,
//              keyboard shortcuts, submit summary.
//   Result     score ring, rank/percentile, class comparison, sections,
//              chapter/topic strengths, time analysis, full solutions
//              with filters.
//
// Answers never reach the browser before release: everything goes
// through asm_start_attempt / asm_get_paper / asm_save_response /
// asm_submit_attempt / asm_get_attempt_result (server-side scoring).
//
//   SIRTests.start(supabaseClient, supabaseUrl)   after the student loads
// =====================================================================
(function () {
  let sb = null;
  const esc = (s) => SIRPaper.esc(s);
  const $ = (id) => document.getElementById(id);
  const md = (t, o) => SIRPaper.md(t, o);
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const fmt = (v) => v ? new Date(v).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const fmtDay = (v) => v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const human = (sec) => { sec = Math.max(0, Math.round(sec || 0)); if (sec < 60) return sec + "s"; const m = Math.round(sec / 60); return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m"; };
  const until = (ms) => { if (ms <= 0) return "now"; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m ? m + "m " + (s % 60) + "s" : (s % 60) + "s"; };
  const blank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
  const TYPE = { single: "Single correct", multi: "One or more correct", integer: "Integer", numerical: "Numerical value", matrix_match: "Matrix match" };
  const TYPE_HINT = { single: "Choose one option", multi: "Choose one or more options", integer: "Type a whole number", numerical: "Type the answer (number)", matrix_match: "Match the columns" };
  const DIFF = { 1: "Easy", 2: "Easy", 3: "Medium", 4: "Hard", 5: "Very hard" };

  let toastTimer = null;
  function toast(msg, kind) {
    let t = $("tcToast");
    if (!t) { t = document.createElement("div"); t.id = "tcToast"; document.body.appendChild(t); }
    t.className = kind || ""; t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // =================================================================
  // HUB
  // =================================================================
  let LIST = [], TAB = "attempt", hubTick = null;

  async function loadList() {
    const box = $("onlineTestsList");
    if (!box) return;
    const { data, error } = await sb.rpc("asm_student_list");
    if (error) { box.innerHTML = '<div class="tc-empty">Could not load tests: ' + esc(error.message) + "</div>"; return; }
    LIST = (data || []).filter((t) => t.phase !== "cancelled");
    renderHero();
    renderHub();
  }

  function groups() {
    const attempt = LIST.filter((t) => (t.phase === "live" && (t.open_attempt_id || !t.last_submitted_attempt_id)) || t.phase === "scheduled")
      .sort((a, b) => (a.phase === "live" ? 0 : 1) - (b.phase === "live" ? 0 : 1) || new Date(a.starts_at || 0) - new Date(b.starts_at || 0));
    const done = LIST.filter((t) => t.last_submitted_attempt_id && !(t.open_attempt_id))
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
    const missed = LIST.filter((t) => t.phase === "closed" && !t.last_submitted_attempt_id && !t.open_attempt_id);
    return { attempt, done, missed };
  }

  function renderHero() {
    const live = LIST.filter((t) => t.phase === "live" && (t.open_attempt_id || !t.last_submitted_attempt_id)).length;
    const badge = $("onlineTestsBadge");
    if (badge) { badge.textContent = live ? live + " live" : ""; badge.hidden = !live; }
    const hero = $("onlineTestsHero");
    if (!hero) return;
    const next = LIST.filter((t) => t.phase === "scheduled").sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
    const results = LIST.filter((t) => t.results_available && t.last_submitted_attempt_id).length;
    const [title, sub] = live ? [live + (live === 1 ? " test is live now" : " tests are live now"), "Tap to attempt"]
      : next ? ["Next test: " + next.title, "Opens " + fmt(next.starts_at)]
      : results ? ["Your test results are out", "Tap for analysis and solutions"] : [null, null];
    hero.hidden = !title;
    if (title) hero.innerHTML = '<span class="ot-hero-ic">✎</span><span><b>' + esc(title) + "</b><small>" + esc(sub) + '</small></span><span class="ot-hero-go">›</span>';
  }

  function renderHub() {
    const box = $("onlineTestsList");
    const g = groups();
    const scored = g.done.filter((t) => t.results_available && t.my_max_score > 0);
    const avg = scored.length ? Math.round(scored.reduce((s, t) => s + (100 * t.my_score) / t.my_max_score, 0) / scored.length) : null;
    const best = scored.length ? Math.max(...scored.map((t) => Math.round((100 * t.my_score) / t.my_max_score))) : null;
    const liveN = g.attempt.filter((t) => t.phase === "live").length;
    const upN = g.attempt.filter((t) => t.phase === "scheduled").length;
    let html = '<div class="tc-stats">' +
      stat("Live now", liveN, liveN ? "live" : "") + stat("Upcoming", upN) + stat("Completed", g.done.length) +
      stat("Average", avg == null ? "—" : avg + "%", "", best == null ? "" : "Best " + best + "%") + "</div>";
    html += '<div class="tc-tabs" role="tablist">' +
      tab("attempt", "Attempt test", g.attempt.length) + tab("results", "Results & analysis", g.done.length) + tab("missed", "Missed", g.missed.length) + "</div>";
    const list = TAB === "attempt" ? g.attempt : TAB === "results" ? g.done : g.missed;
    if (!list.length) {
      html += '<div class="tc-empty">' + ({
        attempt: "<b>No test to attempt right now.</b><br>When your teacher's paper is approved and published for your batch, it appears here with a countdown.",
        results: "<b>No attempts yet.</b><br>After you take a test, your score, rank and full analysis appear here.",
        missed: "Nothing missed. Keep it that way!",
      })[TAB] + "</div>";
    } else {
      html += '<div class="tc-list">' + list.map(card).join("") + "</div>";
    }
    box.innerHTML = html;
    clearInterval(hubTick);
    if (box.querySelector("[data-countdown]")) hubTick = setInterval(tickCountdowns, 1000);
  }
  const stat = (l, v, cls, sub) => '<div class="tc-stat ' + (cls || "") + '"><b>' + esc(v) + "</b><span>" + esc(l) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  const tab = (id, label, n) => '<button class="tc-tab' + (TAB === id ? " on" : "") + '" data-tc-tab="' + id + '" role="tab" aria-selected="' + (TAB === id) + '">' + esc(label) + (n ? " <i>" + n + "</i>" : "") + "</button>";

  function tickCountdowns() {
    let reload = false;
    document.querySelectorAll("[data-countdown]").forEach((el) => {
      const ms = new Date(el.dataset.countdown) - Date.now();
      if (ms <= 0) reload = true;
      el.textContent = until(ms);
    });
    if (reload) { clearInterval(hubTick); setTimeout(loadList, 1500); }
  }

  function card(t) {
    const done = !!t.last_submitted_attempt_id;
    const secs = (t.sections || []).map((s) => '<span class="tc-subj">' + esc(s) + "</span>").join("");
    const kind = t.kind === "practice" ? '<span class="tc-kind">Practice</span>' : "";
    let status = "", body = "", action = "", cls = "";
    if (t.open_attempt_id && t.phase === "live") {
      cls = "live"; status = '<span class="tc-chip live"><i></i>In progress</span>';
      body = t.ends_at ? '<div class="tc-count">Window closes in <b data-countdown="' + esc(t.ends_at) + '">' + until(new Date(t.ends_at) - Date.now()) + "</b></div>" : "";
      action = '<button class="tc-btn glow" data-ot-resume="' + t.id + '">Resume test ›</button>';
    } else if (t.phase === "live" && !done) {
      cls = "live"; status = '<span class="tc-chip live"><i></i>Live now</span>';
      body = t.ends_at ? '<div class="tc-count">Closes in <b data-countdown="' + esc(t.ends_at) + '">' + until(new Date(t.ends_at) - Date.now()) + "</b></div>" : "";
      action = '<button class="tc-btn glow" data-ot-brief="' + t.id + '">Attempt test ›</button>';
    } else if (t.phase === "scheduled") {
      cls = "soon"; status = '<span class="tc-chip">Upcoming</span>';
      body = '<div class="tc-count">Opens in <b data-countdown="' + esc(t.starts_at) + '">' + until(new Date(t.starts_at) - Date.now()) + "</b><small>" + esc(fmt(t.starts_at)) + "</small></div>";
      action = '<button class="tc-btn ghost" data-ot-brief="' + t.id + '">Read instructions</button>';
    } else if (done && t.results_available) {
      const pct = t.my_max_score > 0 ? Math.round((100 * t.my_score) / t.my_max_score) : null;
      status = '<span class="tc-chip ok">Result out</span>';
      body = pct == null ? "" : '<div class="tc-scorebar"><div><b>' + Number(t.my_score) + "</b> / " + Number(t.my_max_score) + "<span>" + pct + "%</span></div><i style=\"--p:" + Math.max(0, pct) + '%"></i></div>';
      action = '<button class="tc-btn" data-ot-result="' + t.last_submitted_attempt_id + '">View analysis ›</button>';
      if (t.kind === "practice" && t.phase === "live" && t.max_attempts > t.attempts_used) action += '<button class="tc-btn ghost" data-ot-brief="' + t.id + '">Attempt again (' + (t.max_attempts - t.attempts_used) + " left)</button>";
    } else if (done) {
      status = '<span class="tc-chip ok">Submitted</span>';
      body = '<div class="tc-count">Result in <b data-countdown="' + esc(t.ends_at) + '">' + until(new Date(t.ends_at) - Date.now()) + "</b><small>after the test closes · " + esc(fmt(t.ends_at)) + "</small></div>";
    } else {
      cls = "dim"; status = '<span class="tc-chip muted">Missed</span>';
      body = '<div class="tc-note">Closed ' + esc(fmt(t.ends_at)) + ". You did not attempt this test.</div>";
    }
    return '<article class="tc-card ' + cls + '"><div class="tc-top"><div><div class="tc-subjs">' + kind + secs + "</div><h3>" + esc(t.title) + "</h3></div>" + status + "</div>" +
      '<div class="tc-meta"><span>⧉ ' + t.question_count + " questions</span><span>◎ " + Number(t.max_marks) + " marks</span><span>⏱ " + t.duration_minutes + " min</span>" +
      (done && t.submitted_at ? "<span>✓ " + esc(fmtDay(t.submitted_at)) + "</span>" : "") + "</div>" + body + action + "</article>";
  }

  // =================================================================
  // OVERLAY SHELL
  // =================================================================
  let X = null;   // exam state, or { result: true } while a result is open

  function overlay(cls) {
    let el = $("sirExam");
    if (!el) { el = document.createElement("div"); el.id = "sirExam"; document.body.appendChild(el); }
    el.className = cls || "";
    el.hidden = false;
    document.body.style.overflow = "hidden";
    return el;
  }
  function closeOverlay() {
    if (X?.timer) clearInterval(X.timer);
    X = null;
    const el = $("sirExam"); if (el) { el.hidden = true; el.innerHTML = ""; el.className = ""; }
    document.body.style.overflow = "";
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    loadList();
  }

  // =================================================================
  // BRIEF (instructions)
  // =================================================================
  function brief(id) {
    const t = LIST.find((x) => x.id === id);
    if (!t) return;
    X = { brief: t };
    const el = overlay("tc-dark");
    const canStart = t.phase === "live";
    el.innerHTML =
      '<header class="ex-head"><div class="ex-brand">SIR<span>TEST</span></div><div class="ex-title">Instructions</div><button class="ex-x" data-ex="close" aria-label="Close">✕</button></header>' +
      '<div class="ex-body"><div class="br-wrap">' +
      '<div class="br-hero"><div class="tc-subjs">' + (t.sections || []).map((s) => '<span class="tc-subj">' + esc(s) + "</span>").join("") + "</div>" +
      "<h1>" + esc(t.title) + "</h1>" +
      '<div class="br-facts"><div><b>' + t.duration_minutes + "</b><span>minutes</span></div><div><b>" + t.question_count + "</b><span>questions</span></div><div><b>" + Number(t.max_marks) + "</b><span>marks</span></div>" +
      (t.ends_at ? '<div><b class="sm">' + esc(fmt(t.ends_at)) + "</b><span>window closes</span></div>" : "") + "</div></div>" +
      (t.instructions_md ? '<section class="br-card"><h2>From your teacher</h2><div class="br-md">' + md(t.instructions_md) + "</div></section>" : "") +
      '<section class="br-card"><h2>How this test works</h2><ol class="br-rules">' +
      "<li>The timer starts when you press <b>Start test</b> and keeps running even if you close the page or lose internet. When it reaches 0:00 the test submits by itself.</li>" +
      "<li>Your answer is saved on the server every time you press <b>Save &amp; Next</b>, move to another question or use the palette.</li>" +
      "<li>Marks for each section (and negative marking, if any) are shown at the top of every question.</li>" +
      "<li>Use <b>Mark for review</b> to come back to a question. A marked question that has an answer <b>is evaluated</b>.</li>" +
      "<li>On a computer: keys <b>A–D</b> or <b>1–4</b> pick an option, <b>→</b> saves and moves on, <b>←</b> goes back.</li>" +
      (t.kind === "practice" ? "<li>This is a <b>practice</b> paper: your result and solutions show right after you submit.</li>" : "<li>Results, rank and solutions open after the test window closes.</li>") +
      "</ol>" +
      '<div class="br-legend"><span><i class="pc nv"></i>Not visited</span><span><i class="pc na"></i>Not answered</span><span><i class="pc ans"></i>Answered</span><span><i class="pc mr"></i>Marked for review</span><span><i class="pc mra"></i>Answered &amp; marked</span></div></section>' +
      (canStart
        ? '<label class="br-agree"><input type="checkbox" id="brAgree"> I have read the instructions. I will not take help from anyone or anything during the test.</label>' +
          '<button class="tc-btn glow big" id="brStart" data-ex="begin" disabled>Start test · ' + t.duration_minutes + " min</button>"
        : '<div class="tc-note center">This test opens ' + esc(fmt(t.starts_at)) + ' — in <b data-countdown="' + esc(t.starts_at) + '">' + until(new Date(t.starts_at) - Date.now()) + "</b>.</div>") +
      "</div></div>";
    const agree = $("brAgree");
    if (agree) agree.addEventListener("change", () => { $("brStart").disabled = !agree.checked; });
    history.pushState({ sirExam: true }, "");
  }

  async function begin(id) {
    const btn = $("brStart"); if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
    try {
      const { data: attemptId, error } = await sb.rpc("asm_start_attempt", { p_assessment_id: id });
      if (error) throw error;
      if (window.matchMedia("(min-width: 960px)").matches && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      await openAttempt(attemptId);
    } catch (e) { toast(e.message || String(e), "bad"); if (btn) { btn.disabled = false; btn.textContent = "Start test"; } }
  }

  async function resume(id) {
    const t = LIST.find((x) => x.id === id);
    try { await openAttempt(t.open_attempt_id); history.pushState({ sirExam: true }, ""); }
    catch (e) { toast(e.message || String(e), "bad"); loadList(); }
  }

  // =================================================================
  // EXAM
  // =================================================================
  async function openAttempt(attemptId) {
    const { data: paper, error } = await sb.rpc("asm_get_paper", { p_attempt_id: attemptId });
    if (error) throw error;
    if (paper.status !== "in_progress") { toast("This attempt is already submitted."); closeOverlay(); return; }
    const responses = {}, visit = {}, spent = {};
    for (const [aq, r] of Object.entries(paper.responses || {})) { responses[aq] = r.response; visit[aq] = r.visit_state; spent[aq] = r.time_spent_sec || 0; }
    X = { paper, i: 0, responses, visit, spent, offset: new Date(paper.server_now) - Date.now(), seen: Date.now(),
          total: new Date(paper.deadline_at) - new Date(paper.started_at) };
    const firstOpen = paper.questions.findIndex((q) => !visit[q.aq_id]);
    X.i = firstOpen > 0 ? firstOpen : 0;
    buildShell();
    renderQuestion();
    X.timer = setInterval(tick, 1000);
    tick();
  }

  function buildShell() {
    const el = overlay("tc-exam");
    const secs = X.paper.sections;
    el.innerHTML =
      '<header class="ex-head"><div class="ex-brand">SIR<span>TEST</span></div><div class="ex-title">' + esc(X.paper.assessment.title) + "</div>" +
      '<button class="ex-icon" data-ex="fullscreen" title="Full screen" aria-label="Full screen">⛶</button>' +
      '<div class="ex-timer" id="exTimer" aria-live="off">--:--</div>' +
      '<button class="ex-sub" data-ex="submit">Submit</button></header>' +
      '<div class="ex-progress"><i id="exTimeBar"></i></div>' +
      (secs.length > 1 ? '<nav class="ex-secs" id="exSecs"></nav>' : "") +
      '<div class="ex-main"><div class="ex-body" id="exBody"></div>' +
      '<aside class="ex-side" id="exSide"></aside></div>' +
      '<footer class="ex-foot">' +
      '<button class="ex-b" data-ex="clear" id="exClear">Clear</button>' +
      '<button class="ex-b mark" data-ex="mark" id="exMark">☆ Mark &amp; Next</button>' +
      '<button class="ex-b pal" data-ex="palette">▦ <span id="exCount"></span></button>' +
      '<span class="ex-gap"></span>' +
      '<button class="ex-b" data-ex="prev">‹ Prev</button>' +
      '<button class="ex-b next" data-ex="next" id="exNext">Save &amp; Next ›</button></footer>' +
      '<div class="ex-pal" id="exPal" hidden></div><div class="ex-modal" id="exModal" hidden></div>';
  }

  const answered = (aq) => !blank(X.responses[aq]);
  function stateFor(aq) {
    const marked = /^mr/.test(X.visit[aq] || "");
    if (answered(aq)) return marked ? "mra" : "ans";
    return marked ? "mr" : "na";
  }
  const cellState = (q) => (!X.visit[q.aq_id] ? "nv" : stateFor(q.aq_id));
  function partOf(q) {
    for (const s of X.paper.sections) for (const p of s.parts) if (p.id === q.part_id) return { s, p };
    return { s: X.paper.sections.find((s) => s.id === q.section_id) || { label: "" }, p: { marks_correct: 0, marks_wrong: 0 } };
  }
  const liveSpent = (q) => (X.spent[q.aq_id] || 0) + (X.paper.questions[X.i] === q ? Math.round((Date.now() - X.seen) / 1000) : 0);

  function renderQuestion() {
    const q = X.paper.questions[X.i];
    const { s, p } = partOf(q);
    if (!X.visit[q.aq_id]) X.visit[q.aq_id] = "na";
    const r = X.responses[q.aq_id];
    const marks = "+" + Number(p.marks_correct) + (Number(p.marks_wrong) ? " / −" + Number(p.marks_wrong) : " / 0") + (p.partial_marking ? " · partial" : "");
    let html = '<div class="ex-card">' +
      '<div class="ex-qhead"><div class="ex-qn">Q<b>' + (X.i + 1) + "</b><small>of " + X.paper.questions.length + "</small></div>" +
      '<div class="ex-tags"><span class="ex-tag">' + esc(s.label) + "</span><span class=\"ex-tag\">" + esc(TYPE[q.type] || q.type) + '</span><span class="ex-tag mk">' + esc(marks) + '</span><span class="ex-tag tm" id="exQTime">⏱ ' + mmss(liveSpent(q)) + "</span></div></div>";
    if (q.passage_md) html += '<div class="ex-passage">' + md(q.passage_md) + "</div>";
    html += '<div class="ex-q">' + md(q.question_md) + "</div>";
    html += '<div class="ex-hint">' + (TYPE_HINT[q.type] || "") + "</div>";
    if (q.type === "single" || q.type === "multi") {
      const picked = q.type === "multi" ? (Array.isArray(r) ? r : []) : [r];
      html += '<div class="ex-opts">' + (q.options || []).map((o, k) =>
        '<button class="ex-opt' + (picked.includes(o.key) ? " on" : "") + (q.type === "multi" ? " multi" : "") + '" data-opt="' + esc(o.key) + '" aria-pressed="' + picked.includes(o.key) + '"><b>' + esc(o.key) + "</b><span>" + md(o.text, { inline: true }) + '</span><kbd>' + (k + 1) + "</kbd></button>").join("") + "</div>";
    } else {
      html += '<div class="ex-num"><input id="exNum" type="text" inputmode="' + (q.type === "integer" ? "numeric" : "decimal") + '" autocomplete="off" placeholder="Type your answer" value="' + esc(r ?? "") + '">' + (q.unit ? "<span>" + esc(q.unit) + "</span>" : "") + "</div>" +
        (q.type === "integer" ? "" : '<div class="ex-hint">Decimals allowed, e.g. 2.5 or -0.75</div>');
    }
    if (q.dropped) html += '<div class="ex-hint warn">This question was dropped — everyone gets the marks.</div>';
    html += "</div>";
    const body = $("exBody");
    body.innerHTML = html;
    body.scrollTop = 0;
    const marked = /^mr/.test(X.visit[q.aq_id]);
    $("exMark").innerHTML = marked ? "★ Unmark" : "☆ Mark &amp; Next";
    $("exMark").classList.toggle("on", marked);
    $("exClear").disabled = blank(r);
    $("exNext").innerHTML = X.i === X.paper.questions.length - 1 ? "Save" : "Save &amp; Next ›";
    $("exCount").textContent = X.paper.questions.filter((x) => answered(x.aq_id)).length + "/" + X.paper.questions.length;
    const inp = $("exNum");
    if (inp) inp.addEventListener("input", () => { X.responses[q.aq_id] = inp.value.trim(); X.dirty = true; $("exClear").disabled = !inp.value.trim(); renderSide(); });
    renderSide();
  }

  // Section tabs + desktop side palette (also used by the phone sheet).
  function paletteHtml(withHead) {
    const counts = { ans: 0, na: 0, mr: 0, mra: 0, nv: 0 };
    X.paper.questions.forEach((q) => counts[cellState(q)]++);
    let html = withHead ? '<div class="pal-head"><b>Question palette</b><button data-ex="palclose" aria-label="Close">✕</button></div>' : '<div class="side-who"><b>Question palette</b><small>Tap a number to jump</small></div>';
    html += '<div class="pal-legend">' +
      '<span><i class="pc ans"></i>' + counts.ans + " Answered</span><span><i class=\"pc na\"></i>" + counts.na + " Not answered</span>" +
      '<span><i class="pc nv"></i>' + counts.nv + " Not visited</span><span><i class=\"pc mr\"></i>" + counts.mr + " Marked</span>" +
      '<span class="wide"><i class="pc mra"></i>' + counts.mra + " Answered &amp; marked (evaluated)</span></div>";
    for (const s of X.paper.sections) {
      const idx = X.paper.questions.map((q, i) => [q, i]).filter(([q]) => q.section_id === s.id);
      if (!idx.length) continue;
      if (X.paper.sections.length > 1) html += '<div class="pal-sec">' + esc(s.label) + "</div>";
      html += '<div class="pal-grid">' + idx.map(([q, i]) => '<button class="pc ' + cellState(q) + (i === X.i ? " cur" : "") + '" data-jump="' + i + '">' + (i + 1) + "</button>").join("") + "</div>";
    }
    return html;
  }
  function renderSide() {
    const side = $("exSide");
    if (side) side.innerHTML = paletteHtml(false) + '<button class="tc-btn glow side-submit" data-ex="submit">Submit test</button>';
    const nav = $("exSecs");
    if (nav) {
      const cur = X.paper.questions[X.i].section_id;
      nav.innerHTML = X.paper.sections.map((s) => {
        const qs = X.paper.questions.filter((q) => q.section_id === s.id);
        if (!qs.length) return "";
        const a = qs.filter((q) => answered(q.aq_id)).length;
        return '<button class="ex-sectab' + (s.id === cur ? " on" : "") + '" data-sec="' + s.id + '">' + esc(s.label) + "<small>" + a + "/" + qs.length + "</small></button>";
      }).join("");
    }
  }

  function palette(show) {
    const pal = $("exPal");
    if (!show) { pal.hidden = true; return; }
    pal.innerHTML = '<div class="pal-sheet">' + paletteHtml(true) + "</div>";
    pal.hidden = false;
  }

  async function save(q, { quiet } = {}) {
    const aq = q.aq_id;
    let resp = X.responses[aq];
    if ((q.type === "integer" || q.type === "numerical") && !blank(resp)) {
      if (!/^-?\d*\.?\d+$/.test(String(resp))) { toast("Enter a number, e.g. 12 or -3.5", "bad"); return false; }
      if (q.type === "integer" && !/^-?\d+$/.test(String(resp))) { toast("This one needs a whole number.", "bad"); return false; }
      resp = Number(resp);
    }
    if (!/^mr/.test(X.visit[aq] || "")) X.visit[aq] = answered(aq) ? "ans" : "na"; else X.visit[aq] = stateFor(aq);
    const dt = Math.round((Date.now() - X.seen) / 1000); X.seen = Date.now();
    X.spent[aq] = (X.spent[aq] || 0) + dt;
    X.saving = true;
    let { error } = await sb.rpc("asm_save_response", { p_attempt_id: X.paper.attempt_id, p_aq_id: aq,
      p_response: blank(resp) ? null : resp, p_visit_state: X.visit[aq], p_time_spent_sec: dt });
    if (error && !/TIME_UP|ATTEMPT_SUBMITTED/.test(error.message)) {   // one quiet retry for flaky phone networks
      await new Promise((r) => setTimeout(r, 1200));
      ({ error } = await sb.rpc("asm_save_response", { p_attempt_id: X.paper.attempt_id, p_aq_id: aq,
        p_response: blank(resp) ? null : resp, p_visit_state: X.visit[aq], p_time_spent_sec: 0 }));
    }
    X.saving = false;
    if (error) {
      if (/TIME_UP|ATTEMPT_SUBMITTED/.test(error.message)) { finish(true); return false; }
      if (!quiet) toast("Not saved — check your internet and try again.", "bad");
      return false;
    }
    X.dirty = false;
    return true;
  }

  async function go(to) {
    if (X.saving) return;
    const ok = await save(X.paper.questions[X.i]);
    if (!ok) return;
    X.i = Math.max(0, Math.min(X.paper.questions.length - 1, to));
    renderQuestion();
  }

  function tick() {
    if (!X?.paper) return;
    const left = Math.max(0, new Date(X.paper.deadline_at) - (Date.now() + X.offset));
    const el = $("exTimer");
    if (el) {
      el.textContent = mmss(left / 1000);
      el.classList.toggle("warn", left < 10 * 60000 && left >= 5 * 60000);
      el.classList.toggle("low", left < 5 * 60000);
    }
    const bar = $("exTimeBar"); if (bar && X.total > 0) bar.style.width = (100 * left) / X.total + "%";
    const qt = $("exQTime"); if (qt) qt.textContent = "⏱ " + mmss(liveSpent(X.paper.questions[X.i]));
    if (left <= 0) finish(true);
  }

  function summaryHtml() {
    let rows = "", tot = { ans: 0, na: 0, nv: 0, mr: 0, mra: 0, n: 0 };
    for (const s of X.paper.sections) {
      const qs = X.paper.questions.filter((q) => q.section_id === s.id);
      if (!qs.length) continue;
      const c = { ans: 0, na: 0, nv: 0, mr: 0, mra: 0 };
      qs.forEach((q) => c[cellState(q)]++);
      Object.keys(c).forEach((k) => (tot[k] += c[k])); tot.n += qs.length;
      rows += "<tr><td>" + esc(s.label) + "</td><td>" + qs.length + "</td><td class=\"g\">" + (c.ans + c.mra) + "</td><td class=\"r\">" + c.na + "</td><td>" + c.nv + "</td><td class=\"p\">" + (c.mr + c.mra) + "</td></tr>";
    }
    return '<div class="mod-card"><h2>Submit your test?</h2><p>You can\'t change answers after submitting.</p>' +
      '<div class="mod-table"><table><thead><tr><th>Section</th><th>Qs</th><th>Answered</th><th>Not answered</th><th>Not visited</th><th>Marked</th></tr></thead><tbody>' + rows + "</tbody>" +
      (X.paper.sections.length > 1 ? "<tfoot><tr><td>Total</td><td>" + tot.n + "</td><td class=\"g\">" + (tot.ans + tot.mra) + "</td><td class=\"r\">" + tot.na + "</td><td>" + tot.nv + "</td><td class=\"p\">" + (tot.mr + tot.mra) + "</td></tr></tfoot>" : "") +
      "</table></div>" + (tot.mr ? '<p class="mod-warn">' + tot.mr + " marked question" + (tot.mr > 1 ? "s have" : " has") + " no answer and will not be evaluated.</p>" : "") +
      '<div class="mod-actions"><button class="tc-btn ghost dark" data-ex="modclose">Back to test</button><button class="tc-btn glow" data-ex="confirm">Submit now</button></div></div>';
  }

  async function submit() {
    if (X.saving) return;
    if (!(await save(X.paper.questions[X.i]))) return;
    palette(false);
    const m = $("exModal"); m.innerHTML = summaryHtml(); m.hidden = false;
  }

  async function finish(timeUp) {
    if (!X || !X.paper || X.finishing) return;
    X.finishing = true;
    clearInterval(X.timer);
    if (timeUp && X.dirty) await save(X.paper.questions[X.i], { quiet: true }).catch(() => {});
    const m = $("exModal"); if (m) m.hidden = true;
    palette(false);
    const { data, error } = await sb.rpc("asm_submit_attempt", { p_attempt_id: X.paper.attempt_id });
    const attemptId = X.paper.attempt_id;
    const el = $("sirExam");
    el.querySelector(".ex-foot").hidden = true;
    el.querySelectorAll(".ex-sub,.ex-icon,#exSide,#exSecs,.ex-progress").forEach((n) => (n.hidden = true));
    $("exTimer").hidden = true;
    el.classList.add("tc-done");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const body = $("exBody");
    if (error) {
      body.innerHTML = '<div class="ex-done"><h2>Could not submit</h2><p>' + esc(error.message) + '</p><button class="tc-btn glow" data-ex="retry">Try again</button></div>';
      X.finishing = false;
      return;
    }
    if (data.results_available) { await showResult(attemptId, true); return; }
    body.innerHTML = '<div class="ex-done"><div class="ex-tick">✓</div><h2>' + (timeUp ? "Time's up — test submitted" : "Test submitted") + "</h2>" +
      "<p>Your answers are safely saved. Your score, rank and full analysis open after the test closes" + (data.results_at ? " — <b>" + esc(fmt(data.results_at)) + "</b>" : "") + ".</p>" +
      '<button class="tc-btn glow" data-ex="close">Back to dashboard</button></div>';
  }

  // =================================================================
  // RESULT + ANALYSIS
  // =================================================================
  async function showResult(attemptId, inExam) {
    if (!inExam) {
      X = { result: true };
      const el = overlay("tc-dark");
      el.innerHTML = '<header class="ex-head"><div class="ex-brand">SIR<span>TEST</span></div><div class="ex-title">Result</div><button class="ex-x" data-ex="close" aria-label="Close">✕</button></header><div class="ex-body" id="exBody"><div class="ex-done"><div class="tc-spin"></div></div></div>';
      history.pushState({ sirExam: true }, "");
    } else {
      $("sirExam").className = "tc-dark";
      const head = $("sirExam").querySelector(".ex-head");
      head.innerHTML = '<div class="ex-brand">SIR<span>TEST</span></div><div class="ex-title">Result</div><button class="ex-x" data-ex="close" aria-label="Close">✕</button>';
      ["exSide", "exPal", "exModal"].forEach((id) => { const n = $(id); if (n) n.remove(); });
    }
    const { data: r, error } = await sb.rpc("asm_get_attempt_result", { p_attempt_id: attemptId });
    const body = $("exBody");
    if (error) { body.innerHTML = '<div class="ex-done"><h2>Could not load the result</h2><p>' + esc(error.message) + '</p><button class="tc-btn glow" data-ex="close">Back</button></div>'; return; }
    if (!r.released) { body.innerHTML = '<div class="ex-done"><h2>Result not out yet</h2><p>Results open after ' + esc(fmt(r.results_at)) + '.</p><button class="tc-btn glow" data-ex="close">Back</button></div>'; return; }
    X.res = r; X.rtab = "overview"; X.rfilter = "all";
    const head = $("sirExam").querySelector(".ex-title"); if (head) head.textContent = r.assessment.title;
    renderResult();
  }

  function renderResult() {
    const r = X.res, body = $("exBody");
    const tabs = [["overview", "Overview"], ["sections", "Sections"], ["topics", "Topics"], ["time", "Time"], ["solutions", "Solutions"]];
    let html = '<div class="rs-wrap"><nav class="rs-tabs">' + tabs.map(([id, l]) => '<button class="rs-tab' + (X.rtab === id ? " on" : "") + '" data-rtab="' + id + '">' + l + "</button>").join("") + "</nav>";
    html += ({ overview: rOverview, sections: rSections, topics: rTopics, time: rTime, solutions: rSolutions })[X.rtab](r);
    html += '<div class="rs-foot"><button class="tc-btn ghost" data-ex="close">Back to dashboard</button></div></div>';
    body.innerHTML = html;
  }

  const qs = () => X.res.questions || [];
  const isOk = (q) => q.result === "correct" || q.result === "bonus";
  const cls = (q) => (isOk(q) ? "c" : q.result === "wrong" ? "w" : q.result === "partial" ? "p" : "s");
  const LBL = { c: "Correct", w: "Wrong", p: "Partly correct", s: "Not answered" };

  function ring(pct, label, sub) {
    const p = Math.max(0, Math.min(100, pct || 0)), C = 2 * Math.PI * 52;
    return '<div class="rs-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="rsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0cf7a"/><stop offset="1" stop-color="#4fd1ff"/></linearGradient></defs>' +
      '<circle cx="60" cy="60" r="52" class="trk"/><circle cx="60" cy="60" r="52" class="val" stroke-dasharray="' + ((C * p) / 100).toFixed(1) + " " + C.toFixed(1) + '"/></svg>' +
      "<div><b>" + label + "</b><span>" + sub + "</span></div></div>";
  }

  function rOverview(r) {
    const score = Number(r.score), max = Number(r.max_score) || 0;
    const pct = max ? Math.round((100 * score) / max) : 0;
    const attempted = r.correct + r.wrong + (r.partial || 0);
    const acc = attempted ? Math.round((100 * (r.correct + 0.5 * (r.partial || 0))) / attempted) : null;
    let html = '<section class="rs-hero">' + ring(pct, score + '<small>/' + max + "</small>", pct + "% score") +
      '<div class="rs-kpis">' +
      kpi("Accuracy", acc == null ? "—" : acc + "%", "of attempted") +
      kpi("Attempted", attempted + "/" + qs().length, (r.skipped || 0) + " skipped") +
      kpi("Rank", r.batch_rank ? "#" + r.batch_rank : r.overall_rank ? "#" + r.overall_rank : "—", r.percentile != null ? Number(r.percentile).toFixed(1) + " percentile" : "batch") +
      kpi("Time used", r.time_used_sec != null ? human(r.time_used_sec) : "—", r.assessment.duration_minutes ? "of " + r.assessment.duration_minutes + " min" : "") +
      "</div></section>";
    html += '<section class="rs-card"><h3>Answer split</h3><div class="rs-split">' +
      seg("c", r.correct, "Correct") + seg("p", r.partial || 0, "Partial") + seg("w", r.wrong, "Wrong") + seg("s", r.skipped || 0, "Skipped") + "</div>" +
      '<div class="rs-splitlbl"><span class="c">✓ ' + r.correct + " correct</span>" + (r.partial ? '<span class="p">◐ ' + r.partial + " partial</span>" : "") + '<span class="w">✗ ' + r.wrong + ' wrong</span><span class="s">– ' + (r.skipped || 0) + " skipped</span></div></section>";
    const c = r.class;
    if (c && c.attempts > 1) {
      const top = Number(c.top_score), avg = Number(c.avg_score), M = Math.max(max, top, score, 1);
      html += '<section class="rs-card"><h3>You vs the class <small>' + c.attempts + " students</small></h3>" +
        bar("You", score, M, "you") + bar("Class average", avg, M, "avg") + bar("Topper", top, M, "top") +
        '<p class="rs-insight">' + (score >= top ? "🏆 You topped this test." : score >= avg ? "You scored <b>" + (score - avg).toFixed(1).replace(/\.0$/, "") + " marks above</b> the class average. Topper is " + (top - score).toFixed(1).replace(/\.0$/, "") + " marks ahead." : "You are <b>" + (avg - score).toFixed(1).replace(/\.0$/, "") + " marks below</b> the class average — the Solutions tab shows exactly where.") + "</p></section>";
    }
    const ins = insights(r);
    if (ins.length) html += '<section class="rs-card"><h3>What to do next</h3><ul class="rs-next">' + ins.map((x) => "<li>" + x + "</li>").join("") + "</ul></section>";
    return html;
  }
  const kpi = (l, v, s) => '<div class="rs-kpi"><span>' + l + "</span><b>" + v + "</b><small>" + esc(s) + "</small></div>";
  const seg = (c, n, l) => (n ? '<i class="' + c + '" style="flex:' + n + '" title="' + l + " " + n + '"></i>' : "");
  const bar = (l, v, M, c) => '<div class="rs-bar ' + c + '"><span>' + l + "</span><div><i style=\"width:" + Math.max(2, (100 * Math.max(0, v)) / M) + '%"></i></div><b>' + (Math.round(v * 10) / 10) + "</b></div>";

  function insights(r) {
    const out = [], Q = qs();
    const quick = Q.filter((q) => !isOk(q) && q.class_correct_pct != null && q.class_correct_pct >= 60);
    if (quick.length) out.push("<b>" + quick.length + " question" + (quick.length > 1 ? "s" : "") + "</b> that most of the class got right went wrong or unanswered for you (Q" + quick.slice(0, 6).map((q) => q.n).join(", Q") + "). Revise these first.");
    const wrongNeg = Q.filter((q) => q.result === "wrong" && Number(q.marks) < 0).reduce((s, q) => s + Number(q.marks), 0);
    if (wrongNeg < 0) out.push("Negative marking cost you <b>" + Math.abs(wrongNeg) + " marks</b>. Attempt a question only when you can rule out at least two options.");
    const slow = Q.filter((q) => q.time_spent_sec && q.class_avg_time_sec && q.time_spent_sec > 2 * q.class_avg_time_sec && !isOk(q));
    if (slow.length) out.push("You spent more than double the class time on <b>" + slow.length + "</b> question" + (slow.length > 1 ? "s" : "") + " and still missed " + (slow.length > 1 ? "them" : "it") + ". Learn to leave and come back.");
    const weak = topicRows().filter((t) => t.n >= 2 && t.acc < 40).slice(0, 3);
    if (weak.length) out.push("Weakest topics: <b>" + weak.map((t) => esc(t.topic)).join("</b>, <b>") + "</b>. See the Topics tab.");
    if (!out.length && qs().length) out.push("Solid paper. Open <b>Solutions</b> to read the approach for every question — even the ones you got right.");
    return out;
  }

  function rSections(r) {
    const secs = r.sections || [];
    if (!secs.length) return '<div class="tc-empty">No section data.</div>';
    return '<div class="rs-grid">' + secs.map((s) => {
      const pct = Number(s.max) ? Math.round((100 * Number(s.score)) / Number(s.max)) : 0;
      const att = Number(s.correct) + Number(s.wrong);
      return '<section class="rs-card sec"><div class="rs-sechead"><h3>' + esc(s.label) + "</h3><b>" + Number(s.score) + "<small>/" + Number(s.max) + "</small></b></div>" +
        '<div class="rs-meter"><i style="width:' + Math.max(0, pct) + '%"></i></div>' +
        '<div class="rs-split sm">' + seg("c", s.correct, "Correct") + seg("w", s.wrong, "Wrong") + seg("s", s.skipped, "Skipped") + "</div>" +
        '<div class="rs-mini"><span>' + pct + "% score</span><span>" + (att ? Math.round((100 * s.correct) / att) + "% accuracy" : "no attempts") + "</span>" + (s.time_sec != null ? "<span>⏱ " + human(s.time_sec) + "</span>" : "") + "</div></section>";
    }).join("") + "</div>";
  }

  function topicRows() {
    const map = new Map();
    for (const q of qs()) {
      const key = (q.chapter || "") + "|" + (q.topic || q.chapter || "Other");
      if (!map.has(key)) map.set(key, { chapter: q.chapter || "", topic: q.topic || q.chapter || "Other", n: 0, c: 0, w: 0, s: 0, list: [] });
      const t = map.get(key); t.n++; t.list.push(q.n);
      if (isOk(q)) t.c++; else if (q.result === "wrong" || q.result === "partial") t.w++; else t.s++;
    }
    return [...map.values()].map((t) => ({ ...t, acc: Math.round((100 * t.c) / t.n) })).sort((a, b) => a.acc - b.acc || b.n - a.n);
  }
  function rTopics() {
    const rows = topicRows();
    if (!rows.length || (rows.length === 1 && rows[0].topic === "Other")) return '<div class="tc-empty">Topic analysis appears once the question bank topics are linked to this paper.</div>';
    const strong = rows.filter((t) => t.acc >= 75), weak = rows.filter((t) => t.acc < 40);
    let html = '<div class="rs-chips">' + (strong.length ? '<span class="rs-pill c">💪 Strong: ' + strong.length + "</span>" : "") + (weak.length ? '<span class="rs-pill w">🎯 Focus: ' + weak.length + "</span>" : "") + "</div>";
    html += '<section class="rs-card"><div class="rs-topics">' + rows.map((t) =>
      '<div class="rs-topic ' + (t.acc >= 75 ? "c" : t.acc < 40 ? "w" : "m") + '"><div class="tt"><b>' + esc(t.topic) + "</b>" + (t.chapter && t.chapter !== t.topic ? "<small>" + esc(t.chapter) + "</small>" : "") + '<small class="qs">Q' + t.list.slice(0, 8).join(", Q") + (t.list.length > 8 ? " +" + (t.list.length - 8) + " more" : "") + "</small></div>" +
      '<div class="rs-meter"><i style="width:' + t.acc + '%"></i></div><div class="tn">' + t.acc + "%<small>" + t.c + " of " + t.n + " right</small></div></div>").join("") + "</div></section>";
    return html;
  }

  function rTime(r) {
    const Q = qs();
    const maxT = Math.max(1, ...Q.map((q) => q.time_spent_sec || 0));
    const total = Q.reduce((s, q) => s + (q.time_spent_sec || 0), 0);
    let html = '<section class="rs-card"><h3>Time on each question <small>' + human(total) + " in total · tap a bar</small></h3>" +
      '<div class="rs-strip">' + Q.map((q) => '<button class="' + cls(q) + '" data-goto="' + q.n + '" style="height:' + Math.max(4, (100 * (q.time_spent_sec || 0)) / maxT) + '%" title="Q' + q.n + " · " + mmss(q.time_spent_sec) + '"></button>').join("") + "</div>" +
      '<div class="rs-splitlbl"><span class="c">■ correct</span><span class="w">■ wrong</span><span class="p">■ partial</span><span class="s">■ not answered</span></div></section>';
    const att = Q.filter((q) => q.result && q.result !== "skipped");
    const avgOk = avgOf(Q.filter(isOk)), avgW = avgOf(Q.filter((q) => q.result === "wrong"));
    html += '<div class="rs-grid three">' + kpiCard("Avg per correct", avgOk == null ? "—" : mmss(avgOk)) + kpiCard("Avg per wrong", avgW == null ? "—" : mmss(avgW)) + kpiCard("Attempt rate", Q.length ? Math.round((100 * att.length) / Q.length) + "%" : "—") + "</div>";
    const sinks = Q.filter((q) => !isOk(q) && q.time_spent_sec > 0).sort((a, b) => b.time_spent_sec - a.time_spent_sec).slice(0, 5);
    if (sinks.length) html += '<section class="rs-card"><h3>Time sinks <small>most time, no marks</small></h3>' + sinks.map((q) =>
      '<button class="rs-row" data-goto="' + q.n + '"><b>Q' + q.n + "</b><span>" + esc(q.topic || q.chapter || "") + "</span><em>" + mmss(q.time_spent_sec) + (q.class_avg_time_sec ? " <small>class " + mmss(q.class_avg_time_sec) + "</small>" : "") + "</em></button>").join("") + "</section>";
    return html;
  }
  const avgOf = (a) => { const t = a.filter((q) => q.time_spent_sec > 0); return t.length ? t.reduce((s, q) => s + q.time_spent_sec, 0) / t.length : null; };
  const kpiCard = (l, v) => '<section class="rs-card kpi"><span>' + l + "</span><b>" + v + "</b></section>";

  function rSolutions() {
    const Q = qs();
    const count = (f) => Q.filter(f).length;
    const F = [["all", "All", Q.length], ["w", "Wrong", count((q) => cls(q) === "w" || cls(q) === "p")], ["s", "Not answered", count((q) => cls(q) === "s")], ["c", "Correct", count((q) => cls(q) === "c")], ["m", "Marked", count((q) => /^mr/.test(q.visit_state || ""))]];
    let html = '<div class="rs-filters">' + F.map(([id, l, n]) => '<button class="rs-f' + (X.rfilter === id ? " on" : "") + '" data-rfilter="' + id + '">' + l + " <i>" + n + "</i></button>").join("") + "</div>";
    const show = Q.filter((q) => X.rfilter === "all" || (X.rfilter === "w" ? ["w", "p"].includes(cls(q)) : X.rfilter === "m" ? /^mr/.test(q.visit_state || "") : cls(q) === X.rfilter));
    if (!show.length) return html + '<div class="tc-empty">No questions here.</div>';
    return html + show.map(solution).join("");
  }

  function solution(q) {
    const c = cls(q);
    const secLabel = (X.res.sections || []).length > 1 ? ((X.res.sections.find((s) => s.subject === q.subject) || {}).label || "") : "";
    let h = '<article class="rs-q ' + c + '" id="rsq' + q.n + '"><div class="rs-qh"><b>Q' + q.n + "</b>" +
      '<span class="rs-tag ' + c + '">' + LBL[c] + " · " + (Number(q.marks) > 0 ? "+" : "") + Number(q.marks || 0) + "</span></div>" +
      '<div class="rs-qmeta">' + [secLabel, q.topic || q.chapter, DIFF[q.difficulty], q.time_spent_sec ? "⏱ you " + mmss(q.time_spent_sec) + (q.class_avg_time_sec ? " · class " + mmss(q.class_avg_time_sec) : "") : "", q.class_correct_pct != null ? q.class_correct_pct + "% of class got it" : ""].filter(Boolean).map((x) => "<span>" + esc(x) + "</span>").join("") + "</div>";
    if (q.passage_md) h += '<div class="ex-passage">' + md(q.passage_md) + "</div>";
    h += '<div class="rs-qbody">' + md(q.question_md) + "</div>";
    const ans = q.answer, resp = q.response;
    if (Array.isArray(q.options) && q.options.length) {
      const inAns = (k) => (Array.isArray(ans) ? ans.includes(k) : String(ans) === k);
      const inResp = (k) => (Array.isArray(resp) ? resp.includes(k) : resp != null && String(resp) === k);
      h += '<div class="rs-opts">' + q.options.map((o) => {
        const a = inAns(o.key), y = inResp(o.key);
        return '<div class="rs-opt' + (a ? " ans" : "") + (y && !a ? " bad" : "") + (y ? " you" : "") + '"><b>' + esc(o.key) + "</b><span>" + md(o.text, { inline: true }) + "</span>" +
          (a ? '<em class="ok">✓ Correct</em>' : "") + (y ? '<em class="' + (a ? "ok" : "no") + '">Your answer</em>' : "") + "</div>";
      }).join("") + "</div>";
    } else {
      h += '<div class="rs-numans"><div><span>Your answer</span><b class="' + (c === "c" ? "ok" : resp == null ? "" : "no") + '">' + esc(SIRPaper.answerText(resp)) + (q.unit ? " " + esc(q.unit) : "") + "</b></div>" +
        "<div><span>Correct answer</span><b class=\"ok\">" + esc(SIRPaper.answerText(ans)) + (q.unit ? " " + esc(q.unit) : "") + (Number(q.tolerance) ? " <small>(± " + Number(q.tolerance) + ")</small>" : "") + "</b></div></div>";
    }
    if (q.hint_md) h += '<details class="rs-sol"><summary>Approach</summary><div>' + md(q.hint_md) + "</div></details>";
    if (q.solution_md) h += '<details class="rs-sol"' + (c !== "c" ? " open" : "") + "><summary>Solution</summary><div>" + md(q.solution_md) + "</div></details>";
    return h + "</article>";
  }

  // =================================================================
  // EVENTS
  // =================================================================
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-tc-tab],[data-ot-brief],[data-ot-resume],[data-ot-result],[data-ex],[data-opt],[data-jump],[data-sec],[data-rtab],[data-rfilter],[data-goto]");
    if (!t) return;
    if (t.dataset.tcTab) { TAB = t.dataset.tcTab; return renderHub(); }
    if (t.dataset.otBrief) return brief(t.dataset.otBrief);
    if (t.dataset.otResume) return resume(t.dataset.otResume);
    if (t.dataset.otResult) return showResult(t.dataset.otResult, false);
    if (!X) return;
    if (t.dataset.rtab) { X.rtab = t.dataset.rtab; renderResult(); $("exBody").scrollTop = 0; return; }
    if (t.dataset.rfilter) { X.rfilter = t.dataset.rfilter; return renderResult(); }
    if (t.dataset.goto) { X.rtab = "solutions"; X.rfilter = "all"; renderResult(); const el = $("rsq" + t.dataset.goto); if (el) el.scrollIntoView({ block: "start" }); return; }
    if (t.dataset.opt != null && X.paper) {
      const q = X.paper.questions[X.i], k = t.dataset.opt;
      if (q.type === "multi") {
        const cur = Array.isArray(X.responses[q.aq_id]) ? X.responses[q.aq_id] : [];
        X.responses[q.aq_id] = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].sort();
      } else X.responses[q.aq_id] = X.responses[q.aq_id] === k ? null : k;
      X.dirty = true;
      const y = $("exBody").scrollTop; renderQuestion(); $("exBody").scrollTop = y;
      return;
    }
    if (t.dataset.jump != null) { palette(false); return go(Number(t.dataset.jump)); }
    if (t.dataset.sec) { const i = X.paper.questions.findIndex((q) => q.section_id === t.dataset.sec); if (i >= 0) return go(i); return; }
    const a = t.dataset.ex;
    if (a === "close") return closeOverlay();
    if (a === "begin") return begin(X.brief.id);
    if (!X.paper) return;
    if (a === "next") return X.i === X.paper.questions.length - 1 ? go(X.i) : go(X.i + 1);
    if (a === "prev") return go(X.i - 1);
    if (a === "mark") {
      const q = X.paper.questions[X.i];
      const was = /^mr/.test(X.visit[q.aq_id] || "");
      X.visit[q.aq_id] = was ? (answered(q.aq_id) ? "ans" : "na") : (answered(q.aq_id) ? "mra" : "mr");
      if (was) { renderQuestion(); return save(q, { quiet: true }); }
      return go(X.i + 1 < X.paper.questions.length ? X.i + 1 : X.i);
    }
    if (a === "clear") { const q = X.paper.questions[X.i]; X.responses[q.aq_id] = null; X.dirty = true; renderQuestion(); return; }
    if (a === "palette") return palette(true);
    if (a === "palclose") return palette(false);
    if (a === "fullscreen") { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen?.().catch(() => {}); return; }
    if (a === "submit") return submit();
    if (a === "modclose") { $("exModal").hidden = true; return; }
    if (a === "confirm") return finish(false);
    if (a === "retry") { X.finishing = false; return finish(false); }
  });

  document.addEventListener("change", (ev) => {
    // checkbox inside the brief is handled inline; nothing else here
    if (ev.target.id === "brAgree") { const b = $("brStart"); if (b) b.disabled = !ev.target.checked; }
  });

  document.addEventListener("keydown", (ev) => {
    if (!X?.paper || X.finishing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!$("exModal")?.hidden || !$("exPal")?.hidden) { if (ev.key === "Escape") { $("exModal").hidden = true; palette(false); } return; }
    if (ev.target.tagName === "INPUT") { if (ev.key === "Enter") { ev.preventDefault(); go(X.i + 1 < X.paper.questions.length ? X.i + 1 : X.i); } return; }
    const q = X.paper.questions[X.i];
    if (ev.key === "ArrowRight") { ev.preventDefault(); return go(X.i + 1 < X.paper.questions.length ? X.i + 1 : X.i); }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); return go(X.i - 1); }
    if ((q.type === "single" || q.type === "multi") && q.options) {
      const k = ev.key.toUpperCase();
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : q.options.findIndex((o) => String(o.key).toUpperCase() === k);
      const o = q.options[idx];
      if (o) { ev.preventDefault(); document.querySelector('#exBody [data-opt="' + CSS.escape(o.key) + '"]')?.click(); }
    }
  });

  // Phone back button: never drop out of a running test by accident; elsewhere back closes the overlay.
  window.addEventListener("popstate", () => {
    if (!X) return;
    if (X.paper && !X.finishing && !X.res) { history.pushState({ sirExam: true }, ""); palette(false); const m = $("exModal"); if (m) m.hidden = true; return; }
    closeOverlay();
  });
  // Warn before closing the tab mid-test (answers are saved, but the timer runs on).
  window.addEventListener("beforeunload", (ev) => { if (X?.paper && !X.finishing && !X.res) { ev.preventDefault(); ev.returnValue = ""; } });

  window.SIRTests = {
    start(client, url) {
      sb = client;
      SIRPaper.init(url);
      loadList();
      setInterval(() => { if (!X) loadList(); }, 60000);
    },
  };
})();
