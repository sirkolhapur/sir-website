// =====================================================================
// SIR Teacher — "Tests assigned to me" (teacher-dashboard.html → Test Composer)
//
//   1  Admin asks for the syllabus → teacher picks chapters / topics of
//      their OWN subject and sends them.
//   2  Admin verifies and gives access → teacher picks questions of their
//      own subject only (the database refuses any other subject) and
//      submits their part.
//
// Needs migration 20261126090000_test_setup_flow.sql.
// =====================================================================
(function () {
  "use strict";
  const db = () => (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const fmtDate = (v) => (v ? new Date(v + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "date to be fixed");
  const inDays = (v) => { if (!v) return ""; const d = Math.round((new Date(v + "T00:00:00") - new Date(new Date().toDateString())) / 864e5); return d === 0 ? "today" : d === 1 ? "tomorrow" : d > 1 ? `in ${d} days` : `${-d} days ago`; };
  const TYPE = { single: "Single correct", multi: "Multiple correct", integer: "Integer", numerical: "Numerical", matrix_match: "Matrix match" };

  const A = { list: [], chapters: [], topics: [], root: null, busy: false, pick: null, tcache: {}, scache: {} };
  // Difficulty filter: levels 1-2 easy, 3 medium, 4 hard, 5 very hard.
  const diffOk = (f, d) => !f || (f === "easy" ? d <= 2 : f === "medium" ? d === 3 : f === "hard" ? d === 4 : d >= 5);
  // Topics of a chapter and subtopics of a topic are fetched when chosen (small, cached).
  async function ensureTopics(chapterId) { if (A.tcache[chapterId]) return; const r = await db().from("qb_topics").select("id,label,sort_order").eq("chapter_id", chapterId).eq("is_active", true).order("sort_order"); A.tcache[chapterId] = r.data || []; }
  async function ensureSubs(topicId) { if (A.scache[topicId]) return; const r = await db().from("qb_subtopics").select("id,label,sort_order").eq("topic_id", topicId).eq("is_active", true).order("sort_order"); A.scache[topicId] = r.data || []; }

  // -------------------------------------------------------------- load
  async function load() {
    const { data, error } = await db().rpc("asm_teacher_assignments");
    if (error) throw error;
    A.list = data || [];
    const subjects = [...new Set(A.list.map((x) => x.subject))];
    if (subjects.length && !A.chapters.length) {
      const [ch, tp] = await Promise.all([
        db().from("qb_chapters").select("id,subject_id,name,sort_order,class_level").eq("is_active", true).in("subject_id", subjects).order("sort_order"),
        db().from("qb_topics").select("id,chapter_id,label,sort_order").eq("is_active", true).order("sort_order"),
      ]);
      A.chapters = ch.data || []; A.topics = tp.data || [];
    }
  }
  async function refresh() {
    try { await load(); } catch (e) { return paintError(e); }
    paint();
    if (A.pick) { const cur = A.list.find((x) => x.section_id === A.pick.section_id); if (cur) { A.pick.s = cur; paintPicker(); } }
  }
  function paintError(e) {
    // Quietly stay hidden until the database update is applied.
    if (/asm_teacher_assignments|schema cache|does not exist/i.test(e.message || "")) { A.root.innerHTML = ""; return; }
    A.root.innerHTML = `<div class="tsa-card tsa-bad">Could not load your assigned tests: ${esc(e.message || e)}</div>`;
  }

  // --------------------------------------------------------- list view
  const pill = (t, c) => `<span class="tsa-pill ${c || ""}">${esc(t)}</span>`;
  function statusOf(s) {
    if (s.assessment_status === "approved") return [s.phase === "live" ? "Live for students" : "Published", "ok"];
    if (s.assessment_status === "draft") {
      return { requested: ["Send the syllabus", "hot"], changes: ["Changes asked", "hot"], submitted: ["Syllabus with admin", "watch"], verified: ["Syllabus verified", "ok"], none: ["Waiting for admin", "watch"] }[s.syllabus_status] || ["Waiting", "watch"];
    }
    if (s.assessment_status === "with_teachers") {
      if (s.section_status === "submitted") return ["Submitted", "ok"];
      return [s.section_status === "reassigned" ? "Changes asked" : "Pick questions", "hot"];
    }
    if (s.assessment_status === "submitted") return [s.section_status === "submitted" ? "Submitted" : "With admin", "ok"];
    return [s.assessment_status, ""];
  }
  const scopeChips = (sc) => (sc || []).map((c) => `<span class="tsa-chip">${esc(c.chapter)}${c.whole || !(c.topics || []).length ? "" : ` <i>${esc(c.topics.join(", "))}</i>`}</span>`).join("") || "";

  function card(s) {
    const [st, sc] = statusOf(s); const pg = s.progress || {};
    let body = "", act = "";
    if (s.assessment_status === "draft") {
      if (["requested", "changes"].includes(s.syllabus_status)) {
        body += s.syllabus_comment ? `<div class="tsa-note bad">↩ Admin asked: ${esc(s.syllabus_comment)}</div>` : '<div class="tsa-note">The admin needs the syllabus for this test — which chapters / topics of your subject will be asked?</div>';
        if ((s.scope || []).length) body += `<div class="tsa-chips">${scopeChips(s.scope)}</div>`;
        act = `<button class="tsa-btn primary" data-tsa-syl="${esc(s.section_id)}">${s.syllabus_status === "changes" ? "Update syllabus" : "Send syllabus"}</button>`;
      } else {
        body += `<div class="tsa-chips">${scopeChips(s.scope)}</div>${s.syllabus_note ? `<div class="tsa-note">📝 ${esc(s.syllabus_note)}</div>` : ""}`;
        body += `<div class="tsa-sub">${s.syllabus_status === "verified" ? "Syllabus verified. The admin will open question picking soon." : "Sent. Waiting for the admin to verify."}</div>`;
      }
    } else if (s.assessment_status === "with_teachers" && s.section_status !== "submitted") {
      body += `<div class="tsa-chips">${scopeChips(s.scope)}</div>`;
      if (s.section_status === "reassigned" && s.admin_comment) body += `<div class="tsa-note bad">↩ Admin asked: ${esc(s.admin_comment)}</div>`;
      body += `<div class="tsa-prog"><div class="tsa-bar"><i style="width:${pg.needed ? Math.round((100 * pg.picked) / pg.needed) : 0}%"></i></div><b>${pg.picked || 0}</b> of ${pg.needed || 0} questions picked</div>`;
      act = `<button class="tsa-btn primary" data-tsa-pick="${esc(s.section_id)}">${pg.picked ? "Continue picking" : "Pick questions"} →</button>`;
    } else {
      body += `<div class="tsa-chips">${scopeChips(s.scope)}</div><div class="tsa-sub">${pg.picked || 0} questions picked${s.section_status === "submitted" ? " · submitted to the admin" : ""}.</div>`;
      if ((pg.picked || 0) > 0) act = `<button class="tsa-btn" data-tsa-view="${esc(s.section_id)}">View my questions</button>`;
    }
    return `<div class="tsa-card"><div class="tsa-top"><div><b class="tsa-title">${esc(s.title)}</b><div class="tsa-meta">📅 ${esc(fmtDate(s.scheduled_on))} ${s.scheduled_on ? `<em>(${inDays(s.scheduled_on)})</em>` : ""} · ${s.duration_minutes} min · <b>${esc(s.label)}</b></div></div>${pill(st, sc)}</div>${body}${act ? `<div class="tsa-act">${act}</div>` : ""}</div>`;
  }
  function paint() {
    if (!A.list.length) { A.root.innerHTML = ""; return; }
    const todo = A.list.filter((s) => statusOf(s)[1] === "hot").length;
    A.root.innerHTML = `<div class="tsa-wrap"><div class="tsa-head"><h3>Tests assigned to me ${todo ? `<span class="tsa-pill hot">${todo} need you</span>` : ""}</h3>
      <p>The admin sets the test and date. You send the syllabus, then pick questions of <b>your subject only</b>.</p></div>${A.list.map(card).join("")}</div>`;
    const navBtn = document.querySelector('[data-section="tests"]');
    if (navBtn) { let b = navBtn.querySelector(".tsa-count"); if (!b) { b = document.createElement("span"); b.className = "tsa-count"; navBtn.appendChild(b); } b.textContent = todo; b.hidden = !todo; }
  }

  // --------------------------------------------------- syllabus modal
  function modal(html) {
    let m = document.getElementById("tsaModal");
    if (!m) { m = document.createElement("div"); m.id = "tsaModal"; document.body.appendChild(m); }
    m.hidden = false; m.innerHTML = `<div class="tsa-mbox"><button class="tsa-x" data-tsa-close="1" aria-label="Close">✕</button>${html}</div>`; return m;
  }
  const closeModal = () => { const m = document.getElementById("tsaModal"); if (m) { m.hidden = true; m.innerHTML = ""; } };

  function sylModal(sectionId) {
    const s = A.list.find((x) => x.section_id === sectionId); if (!s) return;
    const chosen = new Map((s.scope || []).map((c) => [c.chapter_id, new Set(c.whole ? [] : c.topic_ids || [])]));
    const chapters = A.chapters.filter((c) => c.subject_id === s.subject);
    modal(`<h2>Syllabus — ${esc(s.label)}</h2><p class="tsa-sub">${esc(s.title)} · ${esc(fmtDate(s.scheduled_on))}. Tick the chapters (and topics) that will come in this test.</p>
      <form data-tsa-sylform="${esc(sectionId)}"><div class="tsa-chaps">${chapters.map((c) => {
        const tps = A.topics.filter((t) => t.chapter_id === c.id); const on = chosen.has(c.id); const set = chosen.get(c.id) || new Set();
        return `<div class="tsa-chap${on ? " on" : ""}"><label class="tsa-chap-h"><input type="checkbox" data-chap="${esc(c.id)}"${on ? " checked" : ""}> <b>${esc(c.name)}</b>${c.class_level ? ` <small>Class ${esc(c.class_level)}</small>` : ""}</label>
          ${tps.length ? `<div class="tsa-tops"${on ? "" : " hidden"}><label class="tsa-top all"><input type="checkbox" data-alltop="${esc(c.id)}"${on && !set.size ? " checked" : ""}> Whole chapter</label>${tps.map((t) => `<label class="tsa-top"><input type="checkbox" data-top="${esc(t.id)}" data-of="${esc(c.id)}"${set.has(t.id) ? " checked" : ""}> ${esc(t.label)}</label>`).join("")}</div>` : ""}</div>`;
      }).join("") || '<div class="tsa-sub">No chapters for this subject in the question bank yet. Tell the admin.</div>'}</div>
      <label class="tsa-lbl">Note for the admin and students <small>(optional)</small><textarea name="note" maxlength="1500" placeholder="e.g. Numericals from NCERT exemplar; no derivations">${esc(s.syllabus_note || "")}</textarea></label>
      <div class="tsa-act"><button class="tsa-btn primary" type="submit">Send syllabus to admin</button><span class="tsa-err" data-tsa-err></span></div></form>`);
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

  // ------------------------------------------------------ question picker
  async function openPicker(sectionId, viewOnly) {
    const s = A.list.find((x) => x.section_id === sectionId); if (!s) return;
    A.pick = { section_id: sectionId, s, part: (s.parts[0] || {}).id, tab: viewOnly ? "picked" : "bank", viewOnly: !!viewOnly, other: false, chap: "", q: "", shown: 25, bank: null, cache: new Map(), loading: true };
    let el = document.getElementById("tsaPicker"); if (!el) { el = document.createElement("div"); el.id = "tsaPicker"; document.body.appendChild(el); }
    el.hidden = false; document.body.style.overflow = "hidden";
    paintPicker();
    await loadBank();
  }
  function closePicker() { const el = document.getElementById("tsaPicker"); if (el) { el.hidden = true; el.innerHTML = ""; } document.body.style.overflow = ""; A.pick = null; }

  async function loadBank() {
    const P = A.pick; if (!P) return; const s = P.s;
    P.loading = true; paintPicker();
    const part = s.parts.find((p) => p.id === P.part);
    const scopeChap = (s.scope || []).map((c) => c.chapter_id);
    const chapterIds = P.other ? A.chapters.filter((c) => c.subject_id === s.subject).map((c) => c.id) : scopeChap;
    let rows = [];
    if (chapterIds.length && part) {
      let q = db().from("qb_questions").select("id,code,type,difficulty,chapter_id,topic_id,subtopic_id,question_md,options,unit,branch").eq("subject_id", s.subject).eq("status", "live").in("type", part.types).in("chapter_id", chapterIds).order("code").limit(1000);
      const r = await q; if (r.error) { P.error = r.error.message; } else rows = r.data || [];
    }
    if (s.branch) rows = rows.filter((x) => !x.branch || x.branch === s.branch);
    P.bank = rows; rows.forEach((r) => P.cache.set(r.id, r)); P.loading = false;
    await loadPicked(); paintPicker();
  }
  async function loadPicked() {
    const P = A.pick; if (!P) return;
    const ids = P.s.parts.flatMap((p) => p.picks.map((k) => k.question_id)).filter((id) => !P.cache.has(id));
    for (let i = 0; i < ids.length; i += 80) {
      const r = await db().from("qb_questions").select("id,code,type,difficulty,chapter_id,topic_id,question_md,options,unit,branch").in("id", ids.slice(i, i + 80));
      (r.data || []).forEach((x) => P.cache.set(x.id, x));
    }
  }
  const inScope = (s, q) => (s.scope || []).some((c) => c.chapter_id === q.chapter_id && (c.whole || !(c.topic_ids || []).length || c.topic_ids.includes(q.topic_id)));

  // Re-draw the picker without throwing the teacher back to the top of the list.
  function paintPicker() {
    const P0 = A.pick, old = document.getElementById("tsaPBody");
    const top = P0 && P0.keep && old ? old.scrollTop : 0; if (P0) P0.keep = false;
    paintPickerRaw();
    if (top) { const nb = document.getElementById("tsaPBody"); if (nb) nb.scrollTop = top; }
  }
  function paintPickerRaw() {
    const P = A.pick; const el = document.getElementById("tsaPicker"); if (!P || !el) return;
    const s = P.s; const pg = s.progress || {}; const part = s.parts.find((p) => p.id === P.part) || s.parts[0];
    const editable = !P.viewOnly && s.assessment_status === "with_teachers" && ["pending", "reassigned"].includes(s.section_status);
    const allPicked = new Set(s.parts.flatMap((p) => p.picks.map((k) => k.question_id)));
    const done = s.parts.every((p) => p.picks.length === p.question_count);
    let body = "";
    if (P.tab === "bank") {
      const chapOpts = A.chapters.filter((c) => (P.other ? c.subject_id === s.subject : (s.scope || []).some((x) => x.chapter_id === c.id)));
      let list = (P.bank || []).filter((q) => (!P.chap || q.chapter_id === P.chap) && (!P.q || (q.code + " " + q.question_md).toLowerCase().includes(P.q.toLowerCase())) && (P.other || inScope(s, q)) && (!P.topic || q.topic_id === P.topic) && (!P.sub || q.subtopic_id === P.sub) && diffOk(P.diff, q.difficulty));
      const full = part && part.picks.length >= part.question_count;
      const chapRow = (s.scope || []).find((x) => x.chapter_id === P.chap);
      const allowedTopics = !P.other && chapRow && !chapRow.whole && (chapRow.topic_ids || []).length ? new Set(chapRow.topic_ids) : null;
      const topicRows = (A.tcache[P.chap] || []).filter((t) => !allowedTopics || allowedTopics.has(t.id));
      const subRows = A.scache[P.topic] || [];
      const cnt = (fn) => (P.bank || []).filter(fn).length;
      body = `<div class="tsa-filters">
          <select data-tsa-chap aria-label="Chapter"><option value="">All syllabus chapters</option>${chapOpts.map((c) => `<option value="${esc(c.id)}"${P.chap === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <select data-tsa-topic aria-label="Topic" ${P.chap ? "" : "disabled"}><option value="">${P.chap ? "All topics" : "Topic (pick a chapter)"}</option>${topicRows.map((t) => { const n = cnt((q) => q.chapter_id === P.chap && q.topic_id === t.id); return `<option value="${esc(t.id)}"${P.topic === t.id ? " selected" : ""}>${esc(t.label)} (${n})</option>`; }).join("")}</select>
          <select data-tsa-sub aria-label="Subtopic" ${P.topic ? "" : "disabled"}><option value="">${P.topic ? (subRows.length ? "All subtopics" : "No subtopics") : "Subtopic (pick a topic)"}</option>${subRows.map((x) => { const n = cnt((q) => q.topic_id === P.topic && q.subtopic_id === x.id); return `<option value="${esc(x.id)}"${P.sub === x.id ? " selected" : ""}>${esc(x.label)} (${n})</option>`; }).join("")}</select>
          <select data-tsa-diff aria-label="Difficulty">${[["", "All levels"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["vhard", "Very hard"]].map(([v, l]) => `<option value="${v}"${(P.diff || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="tsa-filters2"><input data-tsa-q value="${esc(P.q)}" placeholder="Search text or code"><label class="tsa-chk"><input type="checkbox" data-tsa-other${P.other ? " checked" : ""}> Also other ${esc(s.label.split(" — ")[0])} chapters</label></div>
        ${P.other ? '<div class="tsa-note">Questions outside the verified syllabus are marked <b>out of syllabus</b> for the admin.</div>' : ""}
        ${P.error ? `<div class="tsa-note bad">${esc(P.error)}</div>` : ""}
        ${P.loading ? '<div class="tsa-sub">Loading questions…</div>' : `<div class="tsa-sub">${list.length} question${list.length === 1 ? "" : "s"} · ${esc((part?.types || []).map((t) => TYPE[t] || t).join(" / "))}</div>` +
          list.slice(0, P.shown).map((q) => { const picked = allPicked.has(q.id); const out = !inScope(s, q);
            return `<div class="tsa-q${picked ? " picked" : ""}"><div class="tsa-qh"><span class="tsa-code">${esc(q.code)}</span>${out ? '<span class="tsa-pill watch">out of syllabus</span>' : ""}<span class="tsa-diff">${["", "Easy", "Easy", "Medium", "Hard", "Very hard"][q.difficulty] || ""}</span>
              <button class="tsa-btn${picked ? "" : " primary"}" ${picked || full || !editable ? "disabled" : ""} data-tsa-add="${esc(q.id)}">${picked ? "✓ Added" : full ? "Part full" : "+ Add"}</button></div>${SIRPaper.questionHtml(q)}</div>`; }).join("") +
          (list.length > P.shown ? `<button class="tsa-btn" data-tsa-more="1">Show more (${list.length - P.shown})</button>` : "") + (!list.length ? '<div class="tsa-sub">No question matches. Try "Also other chapters" or clear the filters.</div>' : "")}`;
    } else {
      body = s.parts.map((p) => `<div class="tsa-partbox"><h4>${esc(p.label)} <span>${p.picks.length}/${p.question_count}</span></h4>${p.picks.length ? p.picks.map((k, i) => { const q = P.cache.get(k.question_id);
        return `<div class="tsa-q"><div class="tsa-qh"><span class="tsa-code">${i + 1} · ${esc(q?.code || "")}</span>${k.out_of_scope ? '<span class="tsa-pill watch">out of syllabus</span>' : ""}${editable ? `<span class="tsa-mv"><button class="tsa-btn sm" data-tsa-up="${esc(k.aq_id)}" data-pos="${k.position}" ${i === 0 ? "disabled" : ""}>↑</button><button class="tsa-btn sm" data-tsa-down="${esc(k.aq_id)}" data-pos="${k.position}" ${i === p.picks.length - 1 ? "disabled" : ""}>↓</button><button class="tsa-btn sm danger" data-tsa-rm="${esc(k.aq_id)}">Remove</button></span>` : ""}</div>${q ? SIRPaper.questionHtml(q) : "…"}</div>`; }).join("") : '<div class="tsa-sub">Nothing picked yet.</div>'}</div>`).join("");
    }
    el.innerHTML = `<div class="tsa-ph"><div><b>${esc(s.title)}</b><small>${esc(s.label)} · ${esc(fmtDate(s.scheduled_on))}</small></div><div class="tsa-pc"><b>${pg.picked || 0}</b>/${pg.needed || 0}</div><button class="tsa-x2" data-tsa-closepick="1" aria-label="Close">✕</button></div>
      ${s.parts.length > 1 || true ? `<div class="tsa-parts">${s.parts.map((p) => `<button class="tsa-part${p.id === (part && part.id) ? " on" : ""}" data-tsa-part="${esc(p.id)}">${esc(p.label)} <i>${p.picks.length}/${p.question_count}</i><small>+${Number(p.marks_correct)}${Number(p.marks_wrong) ? " / −" + Number(p.marks_wrong) : ""}</small></button>`).join("")}</div>` : ""}
      <div class="tsa-tabs"><button class="${P.tab === "bank" ? "on" : ""}" data-tsa-tab="bank">Question bank</button><button class="${P.tab === "picked" ? "on" : ""}" data-tsa-tab="picked">My picks (${pg.picked || 0})</button></div>
      <div class="tsa-pbody" id="tsaPBody">${body}</div>
      ${editable ? `<div class="tsa-pfoot"><span>${done ? "All questions picked ✓" : `${(pg.needed || 0) - (pg.picked || 0)} more to pick`}</span><button class="tsa-btn primary" ${done ? "" : "disabled"} data-tsa-submit="1">Submit my part to the admin</button></div>` : ""}`;
  }

  // ----------------------------------------------------------- events
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tsa-syl],[data-tsa-pick],[data-tsa-view],[data-tsa-close],[data-tsa-closepick],[data-tsa-part],[data-tsa-tab],[data-tsa-add],[data-tsa-rm],[data-tsa-up],[data-tsa-down],[data-tsa-more],[data-tsa-submit]");
    if (!t) { if (e.target.id === "tsaModal") closeModal(); return; }
    const d = t.dataset;
    if (d.tsaSyl) return sylModal(d.tsaSyl);
    if (d.tsaPick) return openPicker(d.tsaPick, false);
    if (d.tsaView) return openPicker(d.tsaView, true);
    if (d.tsaClose) return closeModal();
    if (d.tsaClosepick) { closePicker(); return refresh(); }
    const P = A.pick;
    if (d.tsaPart && P) { P.part = d.tsaPart; P.shown = 25; return loadBank(); }
    if (d.tsaTab && P) { P.tab = d.tsaTab; return paintPicker(); }
    if (d.tsaMore && P) { P.shown += 25; P.keep = true; return paintPicker(); }
    if (!P || A.busy) return;
    const run = async (fn) => { A.busy = true; try { const r = await fn(); if (r?.error) throw r.error; await load(); P.s = A.list.find((x) => x.section_id === P.section_id) || P.s; await loadPicked(); P.keep = true; paintPicker(); } catch (err) { alert(err.message || String(err)); } finally { A.busy = false; } };
    if (d.tsaAdd) return run(() => db().rpc("asm_add_question", { p_part_id: P.part, p_question_id: d.tsaAdd }));
    if (d.tsaRm) return run(() => db().rpc("asm_remove_question", { p_assessment_question_id: d.tsaRm }));
    if (d.tsaUp) return run(() => db().rpc("asm_move_question", { p_assessment_question_id: d.tsaUp, p_new_position: Number(d.pos) - 1 }));
    if (d.tsaDown) return run(() => db().rpc("asm_move_question", { p_assessment_question_id: d.tsaDown, p_new_position: Number(d.pos) + 1 }));
    if (d.tsaSubmit) {
      if (!confirm("Submit your part of this test to the admin? You can't change it afterwards unless the admin sends it back.")) return;
      A.busy = true;
      try { const { error } = await db().rpc("asm_submit_section", { p_section_id: P.section_id }); if (error) throw error; closePicker(); alert("Submitted. The admin will review the paper."); await refresh(); }
      catch (err) { alert(err.message || String(err)); } finally { A.busy = false; }
    }
  });
  document.addEventListener("change", async (e) => {
    const m = document.getElementById("tsaModal");
    if (m && !m.hidden) {
      const ch = e.target.closest("[data-chap]"); if (ch) { const box = ch.closest(".tsa-chap"); box.classList.toggle("on", ch.checked); const tops = box.querySelector(".tsa-tops"); if (tops) { tops.hidden = !ch.checked; const all = tops.querySelector("[data-alltop]"); if (ch.checked && all && !tops.querySelector("[data-top]:checked")) all.checked = true; } }
      const all = e.target.closest("[data-alltop]"); if (all && all.checked) all.closest(".tsa-tops").querySelectorAll("[data-top]").forEach((x) => (x.checked = false));
      const tp = e.target.closest("[data-top]"); if (tp && tp.checked) { const a2 = tp.closest(".tsa-tops").querySelector("[data-alltop]"); if (a2) a2.checked = false; }
    }
    const P = A.pick; if (!P) return;
    if (e.target.matches("[data-tsa-chap]")) { P.chap = e.target.value; P.topic = ""; P.sub = ""; P.shown = 25; if (P.chap) await ensureTopics(P.chap); paintPicker(); }
    if (e.target.matches("[data-tsa-topic]")) { P.topic = e.target.value; P.sub = ""; P.shown = 25; if (P.topic) await ensureSubs(P.topic); paintPicker(); }
    if (e.target.matches("[data-tsa-sub]")) { P.sub = e.target.value; P.shown = 25; paintPicker(); }
    if (e.target.matches("[data-tsa-diff]")) { P.diff = e.target.value; P.shown = 25; paintPicker(); }
    if (e.target.matches("[data-tsa-other]")) { P.other = e.target.checked; P.chap = ""; P.topic = ""; P.sub = ""; P.shown = 25; loadBank(); }
  });
  document.addEventListener("input", (e) => { const P = A.pick; if (P && e.target.matches("[data-tsa-q]")) { P.q = e.target.value; P.shown = 25; const pos = e.target.selectionStart; paintPicker(); const n = $("[data-tsa-q]"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });
  document.addEventListener("submit", async (e) => {
    const f = e.target; if (!f.matches("[data-tsa-sylform]")) return; e.preventDefault();
    const err = f.querySelector("[data-tsa-err]"); const scope = readScope(f);
    if (!scope.length) { err.textContent = "Choose at least one chapter."; return; }
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const { error } = await db().rpc("asm_teacher_submit_syllabus", { p_section_id: f.dataset.tsaSylform, p_scope: scope, p_note: f.note.value.trim() || null });
    btn.disabled = false;
    if (error) { err.textContent = error.message; return; }
    closeModal(); await refresh();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (document.getElementById("tsaModal") && !document.getElementById("tsaModal").hidden) closeModal(); else if (A.pick) { closePicker(); refresh(); } } });

  // ------------------------------------------------------------- start
  function start() {
    const sec = document.getElementById("section-tests"); if (!sec) return;
    let root = document.getElementById("teacherAssignments");
    if (!root) { root = document.createElement("div"); root.id = "teacherAssignments"; const anchor = document.getElementById("testEngineNotice"); (anchor || sec.querySelector(".section-header"))?.after(root); }
    A.root = root; if (window.SIRPaper && typeof SUPABASE_URL !== "undefined") SIRPaper.init(SUPABASE_URL);
    const go = async () => { const { data } = await db().auth.getSession(); if (!data?.session) return false; await refresh(); return true; };
    let tries = 0; const iv = setInterval(async () => { tries++; if (await go().catch(() => false) || tries > 40) clearInterval(iv); }, 1500);
    document.querySelector('[data-section="tests"]')?.addEventListener("click", () => refresh());
    if (location.hash === "#tests") setTimeout(() => document.querySelector('[data-section="tests"]')?.click(), 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.SIRTeacherAssignments = { refresh };
})();
