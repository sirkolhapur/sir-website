// =====================================================================
// SIR student online tests — the list on the dashboard, the exam screen
// and the result review. Papers come from teachers via the admin
// (asm_approve); everything here goes through the asm_student_* /
// asm_*_attempt functions, which never send answers before release.
//
//   SIRTests.start(supabaseClient, supabaseUrl)   after the student loads
// =====================================================================
(function () {
  let sb = null;
  const esc = (s) => SIRPaper.esc(s);
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => v ? new Date(v).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const TYPE_HINT = { single: "Choose one option", multi: "Choose one or more options", integer: "Type a whole number", numerical: "Type the answer (number)", matrix_match: "Match the columns" };

  // ---------------------------------------------------------------
  // List
  // ---------------------------------------------------------------
  let LIST = [];
  async function loadList() {
    const box = $("onlineTestsList");
    if (!box) return;
    const { data, error } = await sb.rpc("asm_student_list");
    if (error) { box.innerHTML = '<div class="ot-empty">Could not load tests: ' + esc(error.message) + "</div>"; return; }
    LIST = (data || []).filter((t) => t.phase !== "cancelled");
    const live = LIST.filter((t) => t.phase === "live" && !t.last_submitted_attempt_id).length;
    const badge = $("onlineTestsBadge");
    if (badge) { badge.textContent = live ? live + " live" : ""; badge.hidden = !live; }
    // Home-screen banner: the tests section itself opens from the menu.
    const hero = $("onlineTestsHero");
    if (hero) {
      const next = LIST.filter((t) => t.phase === "scheduled").sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
      const results = LIST.filter((t) => t.results_available && t.last_submitted_attempt_id).length;
      const [title, sub] = live ? [live + (live === 1 ? " test is live now" : " tests are live now"), "Tap to start"]
        : next ? ["Next test: " + next.title, "Opens " + fmt(next.starts_at)]
        : results ? ["Your test results are out", "Tap to see answers and solutions"] : [null, null];
      hero.hidden = !title;
      if (title) hero.innerHTML = '<span class="ot-hero-ic">✎</span><span><b>' + esc(title) + "</b><small>" + esc(sub) + '</small></span><span class="ot-hero-go">›</span>';
    }
    if (!LIST.length) { box.innerHTML = '<div class="ot-empty">No online tests yet. When your teacher publishes one, it appears here.</div>'; return; }
    box.innerHTML = LIST.map(card).join("");
  }

  function card(t) {
    const done = !!t.last_submitted_attempt_id;
    let status, action = "";
    if (t.open_attempt_id && t.phase === "live") {
      status = '<span class="ot-chip live">In progress</span>';
      action = '<button class="ot-btn gold" data-ot-start="' + t.id + '">Resume</button>';
    } else if (done && t.results_available) {
      status = '<span class="ot-chip ok">Result out</span>';
      action = '<button class="ot-btn" data-ot-result="' + t.last_submitted_attempt_id + '">See result</button>';
    } else if (done) {
      status = '<span class="ot-chip ok">Submitted</span>';
      action = '<div class="ot-note">Result after ' + fmt(t.ends_at) + "</div>";
    } else if (t.phase === "live") {
      status = '<span class="ot-chip live">Live now</span>';
      action = '<button class="ot-btn gold" data-ot-start="' + t.id + '">Start test</button>';
    } else if (t.phase === "scheduled") {
      status = '<span class="ot-chip">Upcoming</span>';
      action = '<div class="ot-note">Opens ' + fmt(t.starts_at) + "</div>";
    } else {
      status = '<span class="ot-chip muted">Closed</span>';
      action = '<div class="ot-note">You did not attempt this test.</div>';
    }
    return '<div class="ot-card"><div class="ot-top"><h3>' + esc(t.title) + "</h3>" + status + "</div>" +
      '<div class="ot-meta">' + t.question_count + " questions · " + Number(t.max_marks) + " marks · " + t.duration_minutes + " min" +
      (t.ends_at && t.phase !== "closed" && !done ? " · closes " + fmt(t.ends_at) : "") + "</div>" + action + "</div>";
  }

  // ---------------------------------------------------------------
  // Exam
  // ---------------------------------------------------------------
  let X = null;          // { paper, i, responses, visit, offset, timer, saving }

  async function startTest(id) {
    const t = LIST.find((x) => x.id === id);
    if (!t.open_attempt_id && !confirm('Start "' + t.title + '"?\n\nYou get ' + t.duration_minutes + " minutes. The timer keeps running even if you close the page.")) return;
    try {
      const { data: attemptId, error } = await sb.rpc("asm_start_attempt", { p_assessment_id: id });
      if (error) throw error;
      await openAttempt(attemptId);
    } catch (e) { alert(e.message || String(e)); loadList(); }
  }

  async function openAttempt(attemptId) {
    const { data: paper, error } = await sb.rpc("asm_get_paper", { p_attempt_id: attemptId });
    if (error) throw error;
    if (paper.status !== "in_progress") { alert("This attempt is already submitted."); loadList(); return; }
    const responses = {}, visit = {};
    for (const [aq, r] of Object.entries(paper.responses || {})) { responses[aq] = r.response; visit[aq] = r.visit_state; }
    X = { paper, i: 0, responses, visit, offset: new Date(paper.server_now) - Date.now(), seen: Date.now() };
    const firstOpen = paper.questions.findIndex((q) => !visit[q.aq_id]);
    X.i = firstOpen > 0 ? firstOpen : 0;
    buildShell();
    renderQuestion();
    X.timer = setInterval(tick, 1000);
    tick();
    document.body.style.overflow = "hidden";
    history.pushState({ sirExam: true }, "");
  }

  function buildShell() {
    let el = $("sirExam");
    if (!el) { el = document.createElement("div"); el.id = "sirExam"; document.body.appendChild(el); }
    el.innerHTML =
      '<header class="ex-head"><div class="ex-title">' + esc(X.paper.assessment.title) + '</div>' +
      '<div class="ex-timer" id="exTimer">--:--</div>' +
      '<button class="ex-sub" data-ex="submit">Submit</button></header>' +
      '<div class="ex-body" id="exBody"></div>' +
      '<footer class="ex-foot">' +
      '<button class="ex-b" data-ex="prev">‹ Prev</button>' +
      '<button class="ex-b" data-ex="palette" id="exPalBtn">▦ <span id="exCount"></span></button>' +
      '<button class="ex-b mark" data-ex="mark" id="exMark">☆ Review</button>' +
      '<button class="ex-b next" data-ex="next" id="exNext">Save & Next ›</button></footer>' +
      '<div class="ex-pal" id="exPal" hidden></div>';
    el.hidden = false;
  }

  const answered = (aq) => !SIRPaper_blank(X.responses[aq]);
  function SIRPaper_blank(v) { return v == null || v === "" || (Array.isArray(v) && !v.length); }

  function sectionOf(q) {
    for (const s of X.paper.sections) for (const p of s.parts) if (p.id === q.part_id) return { s, p };
    return { s: { label: "" }, p: { marks_correct: 0, marks_wrong: 0 } };
  }

  function renderQuestion() {
    const q = X.paper.questions[X.i];
    const { s, p } = sectionOf(q);
    const visit = X.visit[q.aq_id];
    if (!visit) X.visit[q.aq_id] = "na";
    const r = X.responses[q.aq_id];
    let html = '<div class="ex-qhead"><span class="ex-qn">Question ' + (X.i + 1) + " of " + X.paper.questions.length + "</span>" +
      '<span class="ex-sec">' + esc(s.label) + " · +" + Number(p.marks_correct) + (Number(p.marks_wrong) ? " / −" + Number(p.marks_wrong) : "") + "</span></div>";
    if (q.passage_md) html += '<div class="ex-passage">' + SIRPaper.md(q.passage_md) + "</div>";
    html += '<div class="ex-q">' + SIRPaper.md(q.question_md) + "</div>";
    html += '<div class="ex-hint">' + (TYPE_HINT[q.type] || "") + "</div>";
    if (q.type === "single" || q.type === "multi") {
      const picked = q.type === "multi" ? (Array.isArray(r) ? r : []) : [r];
      html += '<div class="ex-opts">' + (q.options || []).map((o) =>
        '<button class="ex-opt' + (picked.includes(o.key) ? " on" : "") + (q.type === "multi" ? " multi" : "") + '" data-opt="' + esc(o.key) + '"><b>' + esc(o.key) + "</b><span>" + SIRPaper.md(o.text, { inline: true }) + "</span></button>").join("") + "</div>";
      if (!SIRPaper_blank(r)) html += '<button class="ex-clear" data-ex="clear">Clear answer</button>';
    } else {
      html += '<div class="ex-num"><input id="exNum" type="text" inputmode="' + (q.type === "integer" ? "numeric" : "decimal") + '" autocomplete="off" placeholder="Your answer" value="' + esc(r ?? "") + '">' + (q.unit ? '<span>' + esc(q.unit) + "</span>" : "") + "</div>";
    }
    if (q.dropped) html += '<div class="ex-hint">This question was dropped — everyone gets the marks.</div>';
    $("exBody").innerHTML = html;
    $("exBody").scrollTop = 0;
    const marked = /^mr/.test(X.visit[q.aq_id]);
    $("exMark").textContent = marked ? "★ Marked" : "☆ Review";
    $("exMark").classList.toggle("on", marked);
    $("exNext").textContent = X.i === X.paper.questions.length - 1 ? "Save" : "Save & Next ›";
    $("exCount").textContent = X.paper.questions.filter((x) => answered(x.aq_id)).length + "/" + X.paper.questions.length;
    const num = $("exNum");
    if (num) num.addEventListener("input", () => { X.responses[q.aq_id] = num.value.trim(); X.dirty = true; });
  }

  function stateFor(aq) {
    const marked = /^mr/.test(X.visit[aq] || "");
    if (answered(aq)) return marked ? "mra" : "ans";
    return marked ? "mr" : "na";
  }

  async function save(q) {
    const aq = q.aq_id;
    let resp = X.responses[aq];
    if (q.type === "integer" || q.type === "numerical") {
      if (resp !== "" && resp != null) {
        if (!/^-?\d*\.?\d+$/.test(String(resp))) { alert("Enter a number."); return false; }
        if (q.type === "integer" && !/^-?\d+$/.test(String(resp))) { alert("Enter a whole number."); return false; }
        resp = Number(resp);
      }
    }
    X.visit[aq] = stateFor(aq);
    const spent = Math.round((Date.now() - X.seen) / 1000); X.seen = Date.now();
    const { error } = await sb.rpc("asm_save_response", { p_attempt_id: X.paper.attempt_id, p_aq_id: aq,
      p_response: SIRPaper_blank(resp) ? null : resp, p_visit_state: X.visit[aq], p_time_spent_sec: spent });
    if (error) {
      if (/TIME_UP|ATTEMPT_SUBMITTED/.test(error.message)) { finish(true); return false; }
      alert("Not saved — check your internet and try again.\n" + error.message);
      return false;
    }
    return true;
  }

  async function go(to) {
    const ok = await save(X.paper.questions[X.i]);
    if (!ok) return;
    X.i = Math.max(0, Math.min(X.paper.questions.length - 1, to));
    renderQuestion();
  }

  function palette(show) {
    const pal = $("exPal");
    if (!show) { pal.hidden = true; return; }
    const counts = { ans: 0, na: 0, mr: 0, nv: 0 };
    const cells = X.paper.questions.map((q, i) => {
      const v = X.visit[q.aq_id]; const st = !v ? "nv" : stateFor(q.aq_id);
      counts[st === "mra" ? "ans" : st]++;
      return '<button class="pc ' + st + (i === X.i ? " cur" : "") + '" data-jump="' + i + '">' + (i + 1) + "</button>";
    });
    let html = '<div class="pal-sheet"><div class="pal-head"><b>All questions</b><button data-ex="palclose">✕</button></div>' +
      '<div class="pal-legend"><span class="pc ans"></span>Answered ' + counts.ans + '<span class="pc na"></span>Not answered ' + counts.na +
      '<span class="pc mr"></span>Marked ' + counts.mr + '<span class="pc nv"></span>Not seen ' + counts.nv + "</div>";
    for (const s of X.paper.sections) {
      const idx = X.paper.questions.map((q, i) => [q, i]).filter(([q]) => q.section_id === s.id).map(([, i]) => i);
      if (!idx.length) continue;
      html += '<div class="pal-sec">' + esc(s.label) + '</div><div class="pal-grid">' + idx.map((i) => cells[i]).join("") + "</div>";
    }
    pal.innerHTML = html + "</div>";
    pal.hidden = false;
  }

  function tick() {
    const left = Math.max(0, new Date(X.paper.deadline_at) - (Date.now() + X.offset));
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    const h = Math.floor(m / 60);
    const el = $("exTimer");
    if (el) { el.textContent = (h ? h + ":" + String(m % 60).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); el.classList.toggle("low", left < 5 * 60000); }
    if (left <= 0) finish(true);
  }

  async function submit() {
    const q = X.paper.questions[X.i];
    if (!(await save(q))) return;
    const n = X.paper.questions.length, a = X.paper.questions.filter((x) => answered(x.aq_id)).length;
    if (!confirm("Submit the test?\n\nAnswered: " + a + " of " + n + (n - a ? "\nNot answered: " + (n - a) : "") + "\n\nYou can't change answers after submitting.")) return;
    finish(false);
  }

  async function finish(timeUp) {
    if (!X || X.finishing) return;
    X.finishing = true;
    clearInterval(X.timer);
    if (timeUp && X.dirty) await save(X.paper.questions[X.i]).catch(() => {});
    const { data, error } = await sb.rpc("asm_submit_attempt", { p_attempt_id: X.paper.attempt_id });
    const attemptId = X.paper.attempt_id;
    const body = $("exBody");
    $("sirExam").querySelector(".ex-foot").hidden = true;
    $("sirExam").querySelector(".ex-sub").hidden = true;
    $("exTimer").hidden = true;
    if (error) {
      body.innerHTML = '<div class="ex-done"><h2>Could not submit</h2><p>' + esc(error.message) + '</p><button class="ot-btn gold" data-ex="retry">Try again</button></div>';
      X.finishing = false;
      return;
    }
    if (data.results_available) { await showResult(attemptId, true); return; }
    body.innerHTML = '<div class="ex-done"><div class="ex-tick">✓</div><h2>' + (timeUp ? "Time's up — test submitted" : "Test submitted") + "</h2>" +
      "<p>Your answers are saved. Results come out after the test closes" + (data.results_at ? " (" + fmt(data.results_at) + ")" : "") + ".</p>" +
      '<button class="ot-btn gold" data-ex="close">Back to dashboard</button></div>';
  }

  function closeExam() {
    if (X?.timer) clearInterval(X.timer);
    X = null;
    const el = $("sirExam"); if (el) { el.hidden = true; el.innerHTML = ""; }
    document.body.style.overflow = "";
    loadList();
  }

  // ---------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------
  async function showResult(attemptId, inExam) {
    const { data: r, error } = await sb.rpc("asm_get_attempt_result", { p_attempt_id: attemptId });
    if (error) { alert(error.message); return; }
    if (!inExam) { X = { result: true }; buildResultShell(); }
    const body = $("exBody");
    if (!r.released) { body.innerHTML = '<div class="ex-done"><h2>Result not out yet</h2><p>Results come out after ' + fmt(r.results_at) + '.</p><button class="ot-btn gold" data-ex="close">Back</button></div>'; return; }
    const pct = r.max_score ? Math.round((100 * r.score) / r.max_score) : 0;
    let html = '<div class="rs-hero"><div class="rs-score"><b>' + Number(r.score) + "</b><span>/ " + Number(r.max_score) + "</span></div><div class=\"rs-pct\">" + pct + "%</div>" +
      '<div class="rs-stats"><span class="c">✓ ' + r.correct + ' correct</span><span class="w">✗ ' + r.wrong + ' wrong</span><span class="s">– ' + r.skipped + " skipped</span></div>" +
      (r.batch_rank ? '<div class="rs-rank">Batch rank ' + r.batch_rank + (r.percentile != null ? " · percentile " + Number(r.percentile).toFixed(1) : "") + "</div>" : "") + "</div>";
    if ((r.sections || []).length > 1) html += '<div class="rs-secs">' + r.sections.map((s) => '<div><b>' + esc(s.label) + "</b><span>" + Number(s.score) + " / " + Number(s.max) + "</span></div>").join("") + "</div>";
    html += '<h3 class="rs-h">Answers & solutions</h3>';
    html += r.questions.map((q) => {
      const cls = q.result === "correct" || q.result === "bonus" ? "c" : q.result === "wrong" ? "w" : q.result === "partial" ? "p" : "s";
      const label = { c: "Correct", w: "Wrong", p: "Partly correct", s: "Not answered" }[cls];
      return '<div class="rs-q ' + cls + '"><div class="rs-qh"><span>Q' + q.n + "</span><span class=\"rs-tag " + cls + '">' + label + " · " + (Number(q.marks) > 0 ? "+" : "") + Number(q.marks || 0) + "</span></div>" +
        SIRPaper.questionHtml(q, { showAnswer: true, answer: q.answer, solution: q.solution_md }) +
        (q.response != null ? '<div class="rs-you">Your answer: <b>' + esc(SIRPaper.answerText(q.response)) + "</b></div>" : "") + "</div>";
    }).join("");
    html += '<div class="ex-done"><button class="ot-btn gold" data-ex="close">Back to dashboard</button></div>';
    body.innerHTML = html;
    body.scrollTop = 0;
    const head = $("sirExam").querySelector(".ex-title"); if (head) head.textContent = r.assessment.title + " — Result";
  }
  function buildResultShell() {
    let el = $("sirExam");
    if (!el) { el = document.createElement("div"); el.id = "sirExam"; document.body.appendChild(el); }
    el.innerHTML = '<header class="ex-head"><div class="ex-title">Result</div><button class="ex-sub" data-ex="close">Close</button></header><div class="ex-body" id="exBody"><div class="ex-done">Loading…</div></div>';
    el.hidden = false;
    document.body.style.overflow = "hidden";
  }

  // ---------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-ot-start],[data-ot-result],[data-ex],[data-opt],[data-jump]");
    if (!t) return;
    if (t.dataset.otStart) return startTest(t.dataset.otStart);
    if (t.dataset.otResult) return showResult(t.dataset.otResult, false);
    if (!X) return;
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
    const a = t.dataset.ex;
    if (a === "next") return X.i === X.paper.questions.length - 1 ? go(X.i) : go(X.i + 1);
    if (a === "prev") return go(X.i - 1);
    if (a === "mark") { const q = X.paper.questions[X.i]; X.visit[q.aq_id] = /^mr/.test(X.visit[q.aq_id]) ? "na" : "mr"; return go(X.i + 1 < X.paper.questions.length ? X.i + 1 : X.i); }
    if (a === "clear") { X.responses[X.paper.questions[X.i].aq_id] = null; X.dirty = true; return renderQuestion(); }
    if (a === "palette") return palette(true);
    if (a === "palclose") return palette(false);
    if (a === "submit") return submit();
    if (a === "retry") { X.finishing = false; return finish(false); }
    if (a === "close") return closeExam();
  });
  // Phone back button: never drop out of a running test by accident.
  window.addEventListener("popstate", () => {
    if (X && X.paper && !X.finishing) { history.pushState({ sirExam: true }, ""); palette(false); }
  });

  window.SIRTests = {
    start(client, url) {
      sb = client;
      SIRPaper.init(url);
      loadList();
      setInterval(() => { if (!X) loadList(); }, 60000);
    },
  };
})();
