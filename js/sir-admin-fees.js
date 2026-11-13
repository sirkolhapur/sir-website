// =====================================================================
// SIR Admin — Fees & collection (admin-dashboard.html → Fees).
// Nothing about the fee structure is fixed: the admin creates fee plans,
// instalments, discounts and receipt settings here. Payments and receipt
// numbers go through fee_record_payment() / fee_cancel_payment().
//   SIRAdminFees.render(sectionEl)   SIRAdminFees.homeNumbers()
// Needs migration 20261123090000_fees.sql.
// =====================================================================
(function () {
  "use strict";
  const db = () => (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const num = (v) => Math.round(Number(v || 0) * 100) / 100;
  const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
  const fmtDate = (v) => (v ? new Date(v + (String(v).length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const MODES = [["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank", "Bank transfer"], ["card", "Card"], ["online", "Online (gateway)"]];
  const modeLabel = (m) => (MODES.find((x) => x[0] === m) || [m, m])[1];

  const F = { tab: "overview", filter: { batch: "", status: "", q: "" }, payRange: "month" };
  let root = null;

  // --------------------------------------------------------------- data
  async function load() {
    const [set, plans, fees, pays, st, ba, co] = await Promise.all([
      db().from("fee_settings").select("*").eq("id", 1).maybeSingle(),
      db().from("fee_plans").select("*").order("created_at"),
      db().from("student_fees").select("*").order("created_at"),
      db().from("fee_payments").select("*").order("paid_on", { ascending: false }).limit(10000),
      db().from("students").select("id,student_uid,full_name,phone,batch_id,course_id,is_active"),
      db().from("batches").select("id,name,course_id,is_active").order("name"),
      db().from("courses").select("id,name").order("name"),
    ]);
    if (set.error) throw Object.assign(new Error(set.error.message), { setup: /fee_settings|relation|schema cache/i.test(set.error.message) });
    for (const r of [plans, fees, pays, st, ba, co]) if (r.error) throw r.error;
    F.settings = set.data || {};
    F.plans = plans.data || []; F.fees = fees.data || []; F.payments = pays.data || [];
    F.batches = ba.data || []; F.courses = co.data || [];
    const bn = new Map(F.batches.map((b) => [b.id, b.name]));
    F.students = (st.data || []).map((s) => ({ ...s, batch: bn.get(s.batch_id) || "—" }));
    F.studentById = new Map(F.students.map((s) => [s.id, s]));
    compute();
  }

  // Allocates paid money to instalments in order.
  function feeState(fee) {
    const paid = F.payments.filter((p) => p.student_fee_id === fee.id && !p.cancelled_at).reduce((a, p) => a + Number(p.amount), 0);
    const net = num(fee.total_amount - fee.discount_amount);
    const balance = num(net - paid);
    let left = paid;
    const today = todayIso();
    const insts = (Array.isArray(fee.installments) && fee.installments.length ? fee.installments : [{ label: "Full fee", amount: net, due_date: null }]).map((i) => {
      const amt = num(i.amount); const covered = Math.min(amt, Math.max(0, left)); left -= covered;
      const open = num(amt - covered);
      const status = open <= 0 ? "paid" : i.due_date && i.due_date < today ? "overdue" : covered > 0 ? "partial" : "due";
      return { ...i, amount: amt, covered: num(covered), open, status };
    });
    const next = insts.find((i) => i.open > 0) || null;
    const overdue = num(insts.filter((i) => i.status === "overdue").reduce((a, i) => a + i.open, 0));
    return { paid: num(paid), net, balance, insts, next, overdue };
  }
  function compute() {
    F.state = new Map(F.fees.map((f) => [f.id, feeState(f)]));
    F.activeFeesOf = (sid) => F.fees.filter((f) => f.student_id === sid && f.status !== "cancelled");
  }
  function totals() {
    const today = todayIso(), month = today.slice(0, 7);
    const live = F.payments.filter((p) => !p.cancelled_at);
    const active = F.fees.filter((f) => f.status !== "cancelled");
    return {
      today: live.filter((p) => p.paid_on === today).reduce((a, p) => a + Number(p.amount), 0),
      month: live.filter((p) => String(p.paid_on).startsWith(month)).reduce((a, p) => a + Number(p.amount), 0),
      outstanding: active.reduce((a, f) => a + Math.max(0, F.state.get(f.id).balance), 0),
      overdue: active.reduce((a, f) => a + F.state.get(f.id).overdue, 0),
      overdueStudents: new Set(active.filter((f) => F.state.get(f.id).overdue > 0).map((f) => f.student_id)).size,
      notAssigned: F.students.filter((s) => s.is_active !== false && !F.activeFeesOf(s.id).length).length,
    };
  }

  // ------------------------------------------------------------- render
  async function render(el) {
    root = el || root;
    root.innerHTML = `<div class="hub-loading">Loading fees…</div>`;
    try { await load(); }
    catch (e) {
      root.innerHTML = head() + (e.setup
        ? `<div class="hub-card hub-bad"><b>One database update is needed.</b> Run <code>npx supabase db push --remote</code> (migration 20261123090000_fees.sql), then reopen Fees.</div>`
        : `<div class="hub-card hub-bad">Could not load fees: ${esc(e.message || e)}</div>`);
      return;
    }
    paint();
  }
  const head = () => `<div class="section-head hub-head"><div><div class="hub-kicker">OPERATIONS</div><h2>Fees &amp; Collection</h2><p class="hub-sub">Set your fee plans and instalments whenever they are decided, give them to students, record payments with numbered receipts, and see dues at a glance.</p></div></div>`;
  function paint() {
    const T = [["overview", "Overview"], ["students", "Students"], ["plans", "Fee plans"], ["payments", "Payments"], ["settings", "Settings"]];
    root.innerHTML = head() + `<div class="fee-tabs">${T.map(([id, l]) => `<button class="fee-tab${F.tab === id ? " on" : ""}" data-fee-tab="${id}">${l}</button>`).join("")}</div><div id="feeBody"></div>`;
    const body = root.querySelector("#feeBody");
    body.innerHTML = ({ overview: vOverview, students: vStudents, plans: vPlans, payments: vPayments, settings: vSettings })[F.tab]();
    homeNumbers();
  }

  const kpi = (l, v, s = "", tone = "") => `<div class="hub-kpi ${tone}"><span>${esc(l)}</span><b>${v}</b><small>${s}</small></div>`;

  function vOverview() {
    const t = totals();
    const setupHint = !F.plans.length ? `<div class="hub-next"><span class="hub-pill watch">start here</span> No fee plan yet. Open <b>Fee plans</b> → <b>New plan</b> when your fee structure is decided (you can change it any time). Then give it to students from <b>Students</b>.</div>` : "";
    const overdue = [];
    for (const f of F.fees.filter((x) => x.status !== "cancelled")) {
      const s = F.state.get(f.id); if (s.overdue <= 0) continue;
      const first = s.insts.find((i) => i.status === "overdue");
      overdue.push({ f, s, st: F.studentById.get(f.student_id), first });
    }
    overdue.sort((a, b) => String(a.first?.due_date).localeCompare(String(b.first?.due_date)));
    const recent = F.payments.slice(0, 10);
    return setupHint + `<div class="hub-kpis">${kpi("Today's collection", money(t.today), "payments received today", t.today ? "glow" : "")}${kpi("This month", money(t.month), "month to date")}${kpi("Outstanding", money(t.outstanding), "balance of all active fees")}${kpi("Overdue", money(t.overdue), `${t.overdueStudents} student${t.overdueStudents === 1 ? "" : "s"}`, t.overdue ? "bad" : "")}</div>` +
      (t.notAssigned && F.plans.length ? `<div class="hub-next"><span class="hub-pill watch">${t.notAssigned}</span> active student${t.notAssigned === 1 ? " has" : "s have"} no fee yet — <a href="#" data-fee-tab="students" data-fee-status="none">assign now</a>.</div>` : "") +
      `<div class="hub-grid2"><div class="hub-card"><h3>Overdue instalments</h3>${overdue.length ? overdue.map((o) => {
        const phone = String(o.st?.phone || "").replace(/\D/g, ""), p91 = phone.length === 10 ? "91" + phone : phone;
        const msg = `Dear Parent, the fee instalment "${o.first.label}" of ${money(o.first.open)} for ${o.st?.full_name} was due on ${fmtDate(o.first.due_date)}. Kindly pay at the earliest. — ${F.settings.institute_name || "SIR"}`;
        return `<div class="fee-line"><div><b>${esc(o.st?.full_name || "—")}</b><small>${esc(o.st?.batch || "")} · ${esc(o.first.label)} due ${fmtDate(o.first.due_date)}</small></div><em>${money(o.s.overdue)}</em>${p91 ? `<a class="hub-link" target="_blank" rel="noopener" href="https://wa.me/${esc(p91)}?text=${encodeURIComponent(msg)}">Remind</a>` : ""}<button class="hub-link fee-linkbtn" data-fee-open="${esc(o.f.student_id)}">Open</button></div>`;
      }).join("") : `<div class="hub-empty">No overdue instalments.</div>`}</div>
      <div class="hub-card"><h3>Recent payments</h3>${recent.length ? recent.map((p) => `<div class="fee-line${p.cancelled_at ? " cancelled" : ""}"><div><b>${esc(F.studentById.get(p.student_id)?.full_name || "—")}</b><small>${esc(p.receipt_no)} · ${fmtDate(p.paid_on)} · ${esc(modeLabel(p.mode))}${p.cancelled_at ? " · cancelled" : ""}</small></div><em>${money(p.amount)}</em><button class="hub-link fee-linkbtn" data-fee-receipt="${esc(p.id)}">Receipt</button></div>`).join("") : `<div class="hub-empty">No payments recorded yet.</div>`}</div></div>`;
  }

  function vStudents() {
    const f = F.filter;
    const rows = F.students.filter((s) => s.is_active !== false).filter((s) => (!f.batch || s.batch_id === f.batch) && (!f.q || (s.full_name + " " + (s.student_uid || "")).toLowerCase().includes(f.q.toLowerCase()))).map((s) => {
      const fees = F.activeFeesOf(s.id); const sts = fees.map((x) => F.state.get(x.id));
      const net = sts.reduce((a, x) => a + x.net, 0), paid = sts.reduce((a, x) => a + x.paid, 0), bal = sts.reduce((a, x) => a + x.balance, 0), over = sts.reduce((a, x) => a + x.overdue, 0);
      const next = sts.map((x) => x.next).filter(Boolean).sort((a, b) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")))[0];
      const status = !fees.length ? "none" : over > 0 ? "overdue" : bal <= 0 ? "paid" : "due";
      return { s, fees, net, paid, bal, over, next, status };
    }).filter((r) => !f.status || r.status === f.status).sort((a, b) => a.s.full_name.localeCompare(b.s.full_name));
    const pill = { none: '<span class="hub-pill">no fee</span>', overdue: '<span class="hub-pill high">overdue</span>', paid: '<span class="hub-pill ok">paid</span>', due: '<span class="hub-pill watch">due</span>' };
    return `<div class="hub-card hub-row fee-filters">
      <label>Batch<select data-fee-filter="batch"><option value="">All batches</option>${F.batches.map((b) => `<option value="${esc(b.id)}"${f.batch === b.id ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label>Status<select data-fee-filter="status">${[["", "All"], ["overdue", "Overdue"], ["due", "Due"], ["paid", "Fully paid"], ["none", "No fee yet"]].map(([v, l]) => `<option value="${v}"${f.status === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Search<input data-fee-filter="q" value="${esc(f.q)}" placeholder="Name or UID"></label>
      <div class="fee-filter-actions"><button class="primary-btn" data-fee-bulk="1"${F.plans.length ? "" : " disabled title=\"Create a fee plan first\""}>Give a plan to a batch</button></div></div>
      <div class="table-card"><table class="hub-table"><thead><tr><th>Student</th><th>Batch</th><th>Fee</th><th>Net fee</th><th>Paid</th><th>Balance</th><th>Next due</th><th></th></tr></thead><tbody>${rows.length ? rows.map((r) =>
        `<tr><td><b>${esc(r.s.full_name)}</b><small>${esc(r.s.student_uid || "")}</small></td><td>${esc(r.s.batch)}</td><td>${r.fees.length ? esc(r.fees.map((x) => x.title).join(", ")) : "—"}<small>${pill[r.status]}</small></td><td>${r.fees.length ? money(r.net) : "—"}</td><td>${r.fees.length ? money(r.paid) : "—"}</td><td>${r.fees.length ? `<b class="${r.bal > 0 ? "fee-due" : "fee-ok"}">${money(r.bal)}</b>` : "—"}</td><td>${r.next ? `${money(r.next.open)}<small>${r.next.due_date ? fmtDate(r.next.due_date) : "no date"}</small>` : "—"}</td><td><button class="hub-link fee-linkbtn" data-fee-open="${esc(r.s.id)}">${r.fees.length ? "Open" : "Give fee"}</button></td></tr>`).join("") : `<tr><td colspan="8"><div class="hub-empty">No students match.</div></td></tr>`}</tbody></table></div>`;
  }

  function vPlans() {
    return `<div class="fee-toolbar"><button class="primary-btn" data-fee-plan="new">+ New plan</button><span class="hub-sub">A plan is a template (e.g. "JEE 2-year — 4 instalments"). Changing a plan later does not change fees already given to students.</span></div>` +
      (F.plans.length ? `<div class="fee-plans">${F.plans.map((p) => {
        const used = F.fees.filter((f) => f.plan_id === p.id && f.status !== "cancelled").length;
        const course = F.courses.find((c) => c.id === p.course_id)?.name, batch = F.batches.find((b) => b.id === p.batch_id)?.name;
        return `<div class="hub-card fee-plan${p.is_active ? "" : " off"}"><div class="fee-planhead"><b>${esc(p.name)}</b>${p.is_active ? "" : '<span class="hub-pill">inactive</span>'}</div>
          <div class="fee-planamt">${money(p.total_amount)}</div><small>${esc([course, batch, p.academic_year].filter(Boolean).join(" · ") || "Any course / batch")}</small>
          <ul>${(p.installments || []).map((i) => `<li>${esc(i.label)} — ${money(i.amount)}${i.due_date ? ` · ${fmtDate(i.due_date)}` : ""}</li>`).join("") || "<li>One payment, no due dates</li>"}</ul>
          <div class="fee-planfoot"><span>${used} student${used === 1 ? "" : "s"}</span><button class="hub-link fee-linkbtn" data-fee-plan="${esc(p.id)}">Edit</button></div></div>`;
      }).join("")}</div>` : `<div class="hub-empty">No fee plans yet. Create one when the fee structure is decided — amounts, instalments and due dates are all up to you.</div>`);
  }

  function vPayments() {
    const today = todayIso(), month = today.slice(0, 7);
    const list = F.payments.filter((p) => F.payRange === "all" || (F.payRange === "today" ? p.paid_on === today : String(p.paid_on).startsWith(month)));
    const total = list.filter((p) => !p.cancelled_at).reduce((a, p) => a + Number(p.amount), 0);
    const byMode = {}; list.filter((p) => !p.cancelled_at).forEach((p) => (byMode[p.mode] = (byMode[p.mode] || 0) + Number(p.amount)));
    return `<div class="fee-toolbar">${[["today", "Today"], ["month", "This month"], ["all", "All"]].map(([v, l]) => `<button class="fee-chip${F.payRange === v ? " on" : ""}" data-fee-range="${v}">${l}</button>`).join("")}
      <span class="fee-total">Total ${money(total)}</span><button class="hub-btn2" data-fee-csv="1">Download CSV</button></div>
      ${Object.keys(byMode).length ? `<div class="hub-kpis small">${Object.entries(byMode).map(([m, v]) => kpi(modeLabel(m), money(v))).join("")}</div>` : ""}
      <div class="table-card"><table class="hub-table"><thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Mode</th><th>Reference</th><th>Amount</th><th></th></tr></thead><tbody>${list.length ? list.map((p) =>
        `<tr class="${p.cancelled_at ? "fee-cancelled" : ""}"><td><b>${esc(p.receipt_no)}</b>${p.cancelled_at ? `<small>cancelled: ${esc(p.cancel_reason || "")}</small>` : ""}</td><td>${fmtDate(p.paid_on)}</td><td>${esc(F.studentById.get(p.student_id)?.full_name || "—")}<small>${esc(F.studentById.get(p.student_id)?.batch || "")}</small></td><td>${esc(modeLabel(p.mode))}</td><td>${esc(p.reference || "—")}</td><td><b>${money(p.amount)}</b></td><td><button class="hub-link fee-linkbtn" data-fee-receipt="${esc(p.id)}">Receipt</button></td></tr>`).join("") : `<tr><td colspan="7"><div class="hub-empty">No payments in this period.</div></td></tr>`}</tbody></table></div>`;
  }

  function vSettings() {
    const s = F.settings;
    const modes = new Set(s.payment_modes || []);
    return `<form class="hub-card fee-form" data-fee-settings="1">
      <h3>Receipt &amp; institute details</h3>
      <div class="fee-grid">
        <label>Institute name<input name="institute_name" value="${esc(s.institute_name)}" required maxlength="120"></label>
        <label>Phone<input name="phone" value="${esc(s.phone)}" maxlength="40"></label>
        <label class="wide">Address<input name="address" value="${esc(s.address)}" maxlength="300"></label>
        <label>E-mail<input name="email" value="${esc(s.email)}" maxlength="120"></label>
        <label>Receipt number prefix<input name="receipt_prefix" value="${esc(s.receipt_prefix)}" pattern="[A-Z0-9-]{1,12}" title="Capital letters, digits or -" required></label>
        <label>GSTIN <small>(leave empty if not registered)</small><input name="gstin" value="${esc(s.gstin)}" maxlength="20"></label>
        <label>GST % included in fees<input name="gst_percent" type="number" min="0" max="28" step="0.01" value="${esc(s.gst_percent ?? 0)}"></label>
        <label>Late fee per day (₹) <small>(shown on reminders; 0 = none)</small><input name="late_fee_per_day" type="number" min="0" step="1" value="${esc(s.late_fee_per_day ?? 0)}"></label>
        <label class="wide">Note printed on receipts<input name="receipt_note" value="${esc(s.receipt_note)}" maxlength="300" placeholder="e.g. Fees once paid are not refundable."></label>
      </div>
      <h3>Accepted payment modes</h3>
      <div class="fee-modes">${MODES.filter(([v]) => v !== "online").map(([v, l]) => `<label><input type="checkbox" name="mode" value="${v}"${modes.has(v) ? " checked" : ""}> ${l}</label>`).join("")}</div>
      <div class="hub-next"><span class="hub-pill watch">next phase</span> Online payment links (UPI / Razorpay) and automatic WhatsApp reminders — switched on once a merchant account and WhatsApp templates are ready.</div>
      <div class="hub-actions"><button class="primary-btn" type="submit">Save settings</button><span class="hub-sub" data-fee-saved></span></div></form>`;
  }

  // -------------------------------------------------------------- modal
  function modal(html, wide) {
    let m = document.getElementById("feeModal");
    if (!m) { m = document.createElement("div"); m.id = "feeModal"; document.body.appendChild(m); }
    m.className = "fee-modal" + (wide ? " wide" : "");
    m.innerHTML = `<div class="fee-mbox"><button class="fee-x" data-fee-close="1" aria-label="Close">✕</button>${html}</div>`;
    m.hidden = false;
    return m;
  }
  const closeModal = () => { const m = document.getElementById("feeModal"); if (m) { m.hidden = true; m.innerHTML = ""; } };

  // Instalment editor (used by plans and student fees).
  function instEditor(list) {
    const rows = (list && list.length ? list : []).map((i) => instRow(i)).join("");
    return `<div class="fee-inst"><div class="fee-insthead"><b>Instalments</b><span class="hub-sub">Leave empty for one payment with no due date.</span></div>
      <table class="hub-table"><thead><tr><th>Name</th><th>Amount (₹)</th><th>Due date</th><th></th></tr></thead><tbody data-inst-rows>${rows}</tbody></table>
      <div class="fee-instfoot"><button type="button" class="hub-link fee-linkbtn" data-inst-add="1">+ Add instalment</button>
      <span>Split equally into <input type="number" min="1" max="24" value="2" data-inst-n> parts, first due <input type="date" data-inst-first>, every <input type="number" min="1" max="12" value="3" data-inst-gap> month(s) <button type="button" class="hub-link fee-linkbtn" data-inst-split="1">Split</button></span>
      <span class="fee-sum" data-inst-sum></span></div></div>`;
  }
  const instRow = (i = {}) => `<tr><td><input data-i="label" value="${esc(i.label || "")}" placeholder="e.g. Instalment 1" maxlength="60"></td><td><input data-i="amount" type="number" min="0" step="1" value="${esc(i.amount ?? "")}"></td><td><input data-i="due_date" type="date" value="${esc(i.due_date || "")}"></td><td><button type="button" class="hub-link fee-linkbtn" data-inst-del="1">Remove</button></td></tr>`;
  function readInst(box) {
    return [...box.querySelectorAll("[data-inst-rows] tr")].map((tr) => ({ label: tr.querySelector('[data-i="label"]').value.trim() || "Instalment", amount: num(tr.querySelector('[data-i="amount"]').value), due_date: tr.querySelector('[data-i="due_date"]').value || null })).filter((i) => i.amount > 0);
  }
  function instSum(box, target) {
    const sum = readInst(box).reduce((a, i) => a + i.amount, 0); const el = box.querySelector("[data-inst-sum]");
    if (el) { const ok = !readInst(box).length || Math.abs(sum - target) < 0.01; el.textContent = readInst(box).length ? `Instalments total ${money(sum)} ${ok ? "✓" : `— must equal ${money(target)}`}` : ""; el.className = "fee-sum " + (ok ? "ok" : "bad"); }
    return sum;
  }

  // Plan create / edit
  function planModal(id) {
    const p = F.plans.find((x) => x.id === id) || { name: "", total_amount: "", installments: [], is_active: true };
    const m = modal(`<h2>${id ? "Edit fee plan" : "New fee plan"}</h2><form data-fee-planform="${esc(id || "")}">
      <div class="fee-grid"><label class="wide">Plan name<input name="name" required maxlength="120" value="${esc(p.name)}" placeholder="e.g. JEE 2027 — Two-year programme"></label>
      <label>Course<select name="course_id"><option value="">Any</option>${F.courses.map((c) => `<option value="${esc(c.id)}"${c.id === p.course_id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label>Batch<select name="batch_id"><option value="">Any</option>${F.batches.map((b) => `<option value="${esc(b.id)}"${b.id === p.batch_id ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label>Academic year<input name="academic_year" value="${esc(p.academic_year || "")}" placeholder="2026-27" maxlength="20"></label>
      <label>Total fee (₹)<input name="total_amount" type="number" min="0" step="1" required value="${esc(p.total_amount)}"></label>
      <label class="wide">Notes<input name="notes" value="${esc(p.notes || "")}" maxlength="300" placeholder="e.g. includes study material"></label>
      <label><span><input type="checkbox" name="is_active"${p.is_active ? " checked" : ""}> Active (can be given to students)</span></label></div>
      ${instEditor(p.installments)}
      <div class="hub-actions"><button class="primary-btn" type="submit">Save plan</button>${id ? `<button type="button" class="hub-link fee-linkbtn fee-danger" data-fee-plandel="${esc(id)}">Delete plan</button>` : ""}<span class="hub-sub" data-fee-err></span></div></form>`, true);
    instSum(m, num(p.total_amount));
  }

  // Give / edit a student's fee
  function feeModal(studentId, feeId) {
    const s = F.studentById.get(studentId);
    const fee = F.fees.find((x) => x.id === feeId) || { title: "", total_amount: "", discount_amount: 0, installments: [] };
    const hasPay = feeId && F.payments.some((p) => p.student_fee_id === feeId && !p.cancelled_at);
    const plans = F.plans.filter((p) => p.is_active || p.id === fee.plan_id);
    const m = modal(`<h2>${feeId ? "Edit fee" : "Give a fee"} — ${esc(s?.full_name || "")}</h2><form data-fee-feeform="${esc(feeId || "")}" data-student="${esc(studentId)}">
      <div class="fee-grid"><label class="wide">Start from a plan<select name="plan_id"><option value="">Custom (type below)</option>${plans.map((p) => `<option value="${esc(p.id)}"${p.id === fee.plan_id ? " selected" : ""}>${esc(p.name)} — ${money(p.total_amount)}</option>`).join("")}</select></label>
      <label class="wide">Fee name (shown on receipts)<input name="title" required maxlength="160" value="${esc(fee.title)}" placeholder="e.g. JEE 2027 — Two-year programme"></label>
      <label>Total fee (₹)<input name="total_amount" type="number" min="0" step="1" required value="${esc(fee.total_amount)}"></label>
      <label>Discount / scholarship (₹)<input name="discount_amount" type="number" min="0" step="1" value="${esc(fee.discount_amount || 0)}"></label>
      <label class="wide">Discount reason<input name="discount_reason" maxlength="200" value="${esc(fee.discount_reason || "")}" placeholder="e.g. SAGE scholarship 25%"></label></div>
      ${instEditor(fee.installments)}
      ${hasPay ? `<div class="hub-next">Payments already exist for this fee — amounts can still be corrected; receipts are not changed.</div>` : ""}
      <div class="hub-actions"><button class="primary-btn" type="submit">Save fee</button>${feeId ? `<button type="button" class="hub-link fee-linkbtn fee-danger" data-fee-feecancel="${esc(feeId)}">Cancel this fee</button>` : ""}<span class="hub-sub" data-fee-err></span></div></form>`, true);
    const net = () => num(m.querySelector('[name="total_amount"]').value) - num(m.querySelector('[name="discount_amount"]').value);
    instSum(m, net());
    m.querySelector('[name="plan_id"]').onchange = (e) => {
      const p = F.plans.find((x) => x.id === e.target.value); if (!p) return;
      m.querySelector('[name="title"]').value = p.name; m.querySelector('[name="total_amount"]').value = p.total_amount;
      m.querySelector("[data-inst-rows]").innerHTML = (p.installments || []).map((i) => instRow(i)).join("");
      instSum(m, net());
    };
    m._net = net;
  }

  // Student detail: fees, instalments, payments, record payment
  function studentModal(studentId, focusFee) {
    const s = F.studentById.get(studentId);
    const fees = F.fees.filter((f) => f.student_id === studentId).sort((a, b) => (a.status === "cancelled") - (b.status === "cancelled"));
    const modes = (F.settings.payment_modes || []).map((v) => [v, modeLabel(v)]);
    const blocks = fees.map((f) => {
      const st = F.state.get(f.id);
      const pays = F.payments.filter((p) => p.student_fee_id === f.id);
      return `<div class="hub-card fee-feeblock${f.status === "cancelled" ? " off" : ""}"><div class="fee-planhead"><b>${esc(f.title)}</b>${f.status === "cancelled" ? '<span class="hub-pill">cancelled</span>' : st.balance <= 0 ? '<span class="hub-pill ok">paid</span>' : st.overdue > 0 ? '<span class="hub-pill high">overdue</span>' : '<span class="hub-pill watch">due</span>'}
        ${f.status !== "cancelled" ? `<button class="hub-link fee-linkbtn" data-fee-editfee="${esc(f.id)}">Edit</button>` : ""}</div>
        <div class="fee-sumrow"><span>Total ${money(f.total_amount)}</span>${Number(f.discount_amount) ? `<span>Discount −${money(f.discount_amount)}${f.discount_reason ? ` (${esc(f.discount_reason)})` : ""}</span>` : ""}<span>Net <b>${money(st.net)}</b></span><span>Paid <b>${money(st.paid)}</b></span><span>Balance <b class="${st.balance > 0 ? "fee-due" : "fee-ok"}">${money(st.balance)}</b></span></div>
        <table class="hub-table"><thead><tr><th>Instalment</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead><tbody>${st.insts.map((i) => `<tr><td>${esc(i.label)}</td><td>${i.due_date ? fmtDate(i.due_date) : "—"}</td><td>${money(i.amount)}</td><td>${money(i.covered)}</td><td><span class="hub-pill ${{ paid: "ok", overdue: "high", partial: "medium", due: "watch" }[i.status]}">${i.status}</span></td></tr>`).join("")}</tbody></table>
        ${f.status !== "cancelled" && st.balance > 0 ? `<form class="fee-pay" data-fee-payform="${esc(f.id)}"><b>Record a payment</b>
          <label>Amount (₹)<input name="amount" type="number" min="1" step="1" max="${st.balance}" required value="${st.next ? Math.min(st.next.open, st.balance) : st.balance}"></label>
          <label>Date<input name="paid_on" type="date" required value="${todayIso()}" max="${todayIso()}"></label>
          <label>Mode<select name="mode">${modes.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>
          <label>Reference <small>(UTR / cheque no.)</small><input name="reference" maxlength="80"></label>
          <label class="wide">Note<input name="note" maxlength="200"></label>
          <button class="primary-btn" type="submit">Save &amp; make receipt</button><span class="hub-sub" data-fee-err></span></form>` : ""}
        ${pays.length ? `<h4>Payments</h4>${pays.map((p) => `<div class="fee-line${p.cancelled_at ? " cancelled" : ""}"><div><b>${esc(p.receipt_no)}</b><small>${fmtDate(p.paid_on)} · ${esc(modeLabel(p.mode))}${p.reference ? " · " + esc(p.reference) : ""}${p.cancelled_at ? ` · cancelled (${esc(p.cancel_reason || "")})` : ""}</small></div><em>${money(p.amount)}</em><button class="hub-link fee-linkbtn" data-fee-receipt="${esc(p.id)}">Receipt</button>${p.cancelled_at ? "" : `<button class="hub-link fee-linkbtn fee-danger" data-fee-paycancel="${esc(p.id)}">Cancel</button>`}</div>`).join("")}` : ""}
      </div>`;
    }).join("");
    modal(`<h2>${esc(s?.full_name || "Student")} <small class="hub-sub">${esc(s?.student_uid || "")} · ${esc(s?.batch || "")}</small></h2>
      ${blocks || `<div class="hub-empty">No fee given yet.</div>`}
      <div class="hub-actions">${F.plans.length || true ? `<button class="primary-btn" data-fee-newfee="${esc(studentId)}">+ Give a fee</button>` : ""}</div>`, true);
    if (focusFee) document.querySelector(`[data-fee-payform="${CSS.escape(focusFee)}"]`)?.scrollIntoView({ block: "center" });
  }

  function bulkModal() {
    modal(`<h2>Give a plan to a batch</h2><form data-fee-bulkform="1"><div class="fee-grid">
      <label class="wide">Plan<select name="plan_id" required>${F.plans.filter((p) => p.is_active).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.total_amount)}</option>`).join("")}</select></label>
      <label class="wide">Batch<select name="batch_id" required>${F.batches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label></div>
      <p class="hub-sub">Only students of the batch who have no active fee get it. Discounts can be added per student afterwards.</p>
      <div class="hub-actions"><button class="primary-btn" type="submit">Give plan</button><span class="hub-sub" data-fee-err></span></div></form>`);
  }

  // ------------------------------------------------------------ receipt
  function words(n) {
    n = Math.floor(Number(n) || 0);
    const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
    const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
    if (!n) return "Zero";
    const parts = [];
    const cr = Math.floor(n / 1e7); n %= 1e7; const la = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
    if (cr) parts.push(three(cr) + " Crore"); if (la) parts.push(two(la) + " Lakh"); if (th) parts.push(two(th) + " Thousand"); if (n) parts.push(three(n));
    return parts.join(" ");
  }
  function receipt(payId) {
    const p = F.payments.find((x) => x.id === payId); if (!p) return;
    const f = F.fees.find((x) => x.id === p.student_fee_id); const s = F.studentById.get(p.student_id); const S = F.settings;
    const st = F.state.get(f.id);
    const g = Number(S.gst_percent || 0);
    const taxable = g ? num(Number(p.amount) / (1 + g / 100)) : null;
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) { alert("Allow pop-ups to print the receipt."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(p.receipt_no)}</title><style>
      body{font-family:Arial,sans-serif;color:#111;margin:0;padding:28px}.r{max-width:720px;margin:auto;border:2px solid #111;padding:24px;position:relative}
      h1{margin:0;font-size:22px}.sub{color:#444;font-size:13px;margin-top:4px}.row{display:flex;justify-content:space-between;margin-top:16px;font-size:14px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td{padding:8px;border:1px solid #999}td:first-child{width:38%;background:#f3f3f3;font-weight:bold}
      .amt{font-size:20px;font-weight:bold}.foot{display:flex;justify-content:space-between;margin-top:40px;font-size:13px}.note{font-size:12px;color:#444;margin-top:14px}
      .void{position:absolute;top:40%;left:20%;font-size:72px;color:rgba(200,0,0,.25);transform:rotate(-20deg);font-weight:bold}@media print{button{display:none}body{padding:0}}</style></head><body>
      <div class="r">${p.cancelled_at ? '<div class="void">CANCELLED</div>' : ""}<h1>${esc(S.institute_name || "")}</h1><div class="sub">${esc([S.address, S.phone, S.email].filter(Boolean).join(" · "))}${S.gstin ? `<br>GSTIN: ${esc(S.gstin)}` : ""}</div>
      <div class="row"><b>FEE RECEIPT</b><span>No. <b>${esc(p.receipt_no)}</b> &nbsp; Date: <b>${fmtDate(p.paid_on)}</b></span></div>
      <table><tr><td>Student</td><td>${esc(s?.full_name || "")} (${esc(s?.student_uid || "")})</td></tr><tr><td>Batch</td><td>${esc(s?.batch || "")}</td></tr>
      <tr><td>Towards</td><td>${esc(f?.title || "")}</td></tr><tr><td>Amount received</td><td class="amt">${money(p.amount)}</td></tr>
      <tr><td>In words</td><td>Rupees ${esc(words(p.amount))} only</td></tr><tr><td>Mode</td><td>${esc(modeLabel(p.mode))}${p.reference ? ` — ${esc(p.reference)}` : ""}</td></tr>
      ${g ? `<tr><td>Of which GST (${g}%)</td><td>${money(num(Number(p.amount) - taxable))} (taxable value ${money(taxable)})</td></tr>` : ""}
      <tr><td>Balance after this receipt</td><td>${money(st.balance)}${st.next && st.next.due_date ? ` · next due ${fmtDate(st.next.due_date)}` : ""}</td></tr></table>
      ${S.receipt_note ? `<div class="note">${esc(S.receipt_note)}</div>` : ""}
      <div class="foot"><span>This is a computer-generated receipt.</span><span>Authorised signatory<br><br>________________</span></div></div>
      <p style="text-align:center"><button onclick="print()">Print</button></p></body></html>`);
    w.document.close();
  }

  // ------------------------------------------------------------ actions
  const errEl = (form) => form.querySelector("[data-fee-err]");
  async function refresh(keepModal) { await load(); paint(); if (!keepModal) closeModal(); }

  async function savePlan(form) {
    const id = form.dataset.feePlanform || null; const fd = new FormData(form);
    const total = num(fd.get("total_amount")); const inst = readInst(form);
    if (inst.length && Math.abs(inst.reduce((a, i) => a + i.amount, 0) - total) > 0.01) { errEl(form).textContent = "Instalments must add up to the total fee."; return; }
    const row = { name: String(fd.get("name")).trim(), course_id: fd.get("course_id") || null, batch_id: fd.get("batch_id") || null, academic_year: String(fd.get("academic_year") || "").trim() || null,
      total_amount: total, installments: inst, notes: String(fd.get("notes") || "").trim() || null, is_active: !!fd.get("is_active"), updated_at: new Date().toISOString() };
    const r = id ? await db().from("fee_plans").update(row).eq("id", id) : await db().from("fee_plans").insert(row);
    if (r.error) { errEl(form).textContent = r.error.message; return; }
    F.tab = "plans"; await refresh();
  }
  async function saveFee(form) {
    const id = form.dataset.feeFeeform || null; const fd = new FormData(form);
    const total = num(fd.get("total_amount")), disc = num(fd.get("discount_amount"));
    if (disc > total) { errEl(form).textContent = "Discount cannot be more than the total fee."; return; }
    const inst = readInst(form);
    if (inst.length && Math.abs(inst.reduce((a, i) => a + i.amount, 0) - (total - disc)) > 0.01) { errEl(form).textContent = `Instalments must add up to the net fee (${money(total - disc)}).`; return; }
    const paid = id ? F.state.get(id).paid : 0;
    if (total - disc < paid - 0.01) { errEl(form).textContent = `Net fee cannot be less than what is already paid (${money(paid)}).`; return; }
    const row = { student_id: form.dataset.student, plan_id: fd.get("plan_id") || null, title: String(fd.get("title")).trim(), total_amount: total, discount_amount: disc,
      discount_reason: String(fd.get("discount_reason") || "").trim() || null, installments: inst, status: total - disc - paid <= 0.005 ? "closed" : "active", updated_at: new Date().toISOString() };
    const r = id ? await db().from("student_fees").update(row).eq("id", id) : await db().from("student_fees").insert(row);
    if (r.error) { errEl(form).textContent = r.error.message; return; }
    await refresh(true); studentModal(form.dataset.student);
  }
  async function savePayment(form) {
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; errEl(form).textContent = "Saving…";
    const fd = new FormData(form); const feeId = form.dataset.feePayform;
    const r = await db().rpc("fee_record_payment", { p_student_fee_id: feeId, p_amount: num(fd.get("amount")), p_paid_on: fd.get("paid_on"), p_mode: fd.get("mode"), p_reference: fd.get("reference") || null, p_note: fd.get("note") || null });
    btn.disabled = false;
    if (r.error) { errEl(form).textContent = r.error.message; return; }
    const studentId = F.fees.find((f) => f.id === feeId)?.student_id;
    await refresh(true); studentModal(studentId); receipt(r.data.id);
  }
  async function saveSettings(form) {
    const fd = new FormData(form);
    const modes = fd.getAll("mode");
    if (!modes.length) { form.querySelector("[data-fee-saved]").textContent = "Choose at least one payment mode."; return; }
    const row = { institute_name: String(fd.get("institute_name")).trim(), phone: String(fd.get("phone") || "").trim() || null, address: String(fd.get("address") || "").trim() || null,
      email: String(fd.get("email") || "").trim() || null, receipt_prefix: String(fd.get("receipt_prefix")).trim().toUpperCase(), gstin: String(fd.get("gstin") || "").trim().toUpperCase() || null,
      gst_percent: num(fd.get("gst_percent")), late_fee_per_day: num(fd.get("late_fee_per_day")), receipt_note: String(fd.get("receipt_note") || "").trim() || null,
      payment_modes: modes, updated_at: new Date().toISOString() };
    const r = await db().from("fee_settings").update(row).eq("id", 1);
    form.querySelector("[data-fee-saved]").textContent = r.error ? r.error.message : "Saved ✓";
    if (!r.error) { await load(); }
  }
  async function giveToBatch(form) {
    const fd = new FormData(form); const p = F.plans.find((x) => x.id === fd.get("plan_id")); const batch = fd.get("batch_id");
    const targets = F.students.filter((s) => s.is_active !== false && s.batch_id === batch && !F.activeFeesOf(s.id).length);
    if (!targets.length) { errEl(form).textContent = "Every student of this batch already has a fee."; return; }
    if (!confirm(`Give "${p.name}" (${money(p.total_amount)}) to ${targets.length} student(s)?`)) return;
    const rows = targets.map((s) => ({ student_id: s.id, plan_id: p.id, title: p.name, total_amount: p.total_amount, discount_amount: 0, installments: p.installments || [] }));
    const r = await db().from("student_fees").insert(rows);
    if (r.error) { errEl(form).textContent = r.error.message; return; }
    F.tab = "students"; F.filter.batch = batch; await refresh();
  }
  function csv() {
    const today = todayIso(), month = today.slice(0, 7);
    const list = F.payments.filter((p) => F.payRange === "all" || (F.payRange === "today" ? p.paid_on === today : String(p.paid_on).startsWith(month)));
    const cell = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = [["Receipt", "Date", "Student", "UID", "Batch", "Fee", "Mode", "Reference", "Amount", "Status"].map(cell).join(",")].concat(list.map((p) => {
      const s = F.studentById.get(p.student_id), f = F.fees.find((x) => x.id === p.student_fee_id);
      return [p.receipt_no, p.paid_on, s?.full_name, s?.student_uid, s?.batch, f?.title, modeLabel(p.mode), p.reference, p.amount, p.cancelled_at ? "cancelled" : "ok"].map(cell).join(",");
    }));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })); a.download = `fee-payments-${F.payRange}-${today}.csv`; a.click();
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-fee-tab],[data-fee-open],[data-fee-receipt],[data-fee-plan],[data-fee-bulk],[data-fee-range],[data-fee-csv],[data-fee-close],[data-fee-newfee],[data-fee-editfee],[data-fee-feecancel],[data-fee-paycancel],[data-fee-plandel],[data-inst-add],[data-inst-del],[data-inst-split]");
    if (!t) { if (e.target.id === "feeModal") closeModal(); return; }
    if (t.dataset.feeTab) { e.preventDefault(); F.tab = t.dataset.feeTab; if (t.dataset.feeStatus) F.filter.status = t.dataset.feeStatus; return paint(); }
    if (t.dataset.feeOpen) return studentModal(t.dataset.feeOpen);
    if (t.dataset.feeReceipt) return receipt(t.dataset.feeReceipt);
    if (t.dataset.feePlan) return planModal(t.dataset.feePlan === "new" ? null : t.dataset.feePlan);
    if (t.dataset.feeBulk) return bulkModal();
    if (t.dataset.feeRange) { F.payRange = t.dataset.feeRange; return paint(); }
    if (t.dataset.feeCsv) return csv();
    if (t.dataset.feeClose) return closeModal();
    if (t.dataset.feeNewfee) return feeModal(t.dataset.feeNewfee, null);
    if (t.dataset.feeEditfee) { const f = F.fees.find((x) => x.id === t.dataset.feeEditfee); return feeModal(f.student_id, f.id); }
    if (t.dataset.feeFeecancel) {
      const f = F.fees.find((x) => x.id === t.dataset.feeFeecancel);
      if (!confirm(`Cancel the fee "${f.title}"? Payments already received stay on record.`)) return;
      const r = await db().from("student_fees").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", f.id);
      if (r.error) return alert(r.error.message);
      await refresh(true); return studentModal(f.student_id);
    }
    if (t.dataset.feePaycancel) {
      const p = F.payments.find((x) => x.id === t.dataset.feePaycancel);
      const reason = prompt(`Cancel receipt ${p.receipt_no} (${money(p.amount)})? The receipt number stays used.\nReason:`);
      if (reason == null) return;
      const r = await db().rpc("fee_cancel_payment", { p_payment_id: p.id, p_reason: reason });
      if (r.error) return alert(r.error.message);
      await refresh(true); return studentModal(p.student_id);
    }
    if (t.dataset.feePlandel) {
      const used = F.fees.filter((f) => f.plan_id === t.dataset.feePlandel).length;
      if (!confirm(used ? `Delete this plan? ${used} student fee(s) made from it stay unchanged.` : "Delete this plan?")) return;
      const r = await db().from("fee_plans").delete().eq("id", t.dataset.feePlandel);
      if (r.error) return alert(r.error.message);
      F.tab = "plans"; return refresh();
    }
    const box = t.closest("form");
    const target = () => (box.dataset.feeFeeform != null ? box.closest(".fee-modal")._net?.() ?? 0 : num(box.querySelector('[name="total_amount"]')?.value));
    if (t.dataset.instAdd) { box.querySelector("[data-inst-rows]").insertAdjacentHTML("beforeend", instRow({ label: `Instalment ${box.querySelectorAll("[data-inst-rows] tr").length + 1}` })); return instSum(box, target()); }
    if (t.dataset.instDel) { t.closest("tr").remove(); return instSum(box, target()); }
    if (t.dataset.instSplit) {
      const n = Math.max(1, Math.min(24, Number(box.querySelector("[data-inst-n]").value) || 1)), gap = Math.max(1, Number(box.querySelector("[data-inst-gap]").value) || 1);
      const first = box.querySelector("[data-inst-first]").value; const tot = target();
      if (!(tot > 0)) return alert("Enter the total fee first.");
      const each = Math.floor(tot / n), last = num(tot - each * (n - 1));
      const rows = Array.from({ length: n }, (_, k) => {
        let due = null; if (first) { const d = new Date(first + "T00:00:00"); d.setMonth(d.getMonth() + k * gap); due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
        return instRow({ label: `Instalment ${k + 1}`, amount: k === n - 1 ? last : each, due_date: due });
      });
      box.querySelector("[data-inst-rows]").innerHTML = rows.join(""); return instSum(box, target());
    }
  });
  document.addEventListener("input", (e) => {
    const box = e.target.closest(".fee-modal form");
    if (box && (e.target.matches('[data-i="amount"]') || e.target.matches('[name="total_amount"],[name="discount_amount"]'))) instSum(box, box.dataset.feeFeeform != null ? box.closest(".fee-modal")._net?.() ?? 0 : num(box.querySelector('[name="total_amount"]')?.value));
    const flt = e.target.closest("[data-fee-filter]");
    if (flt && flt.dataset.feeFilter === "q") { F.filter.q = flt.value; const pos = flt.selectionStart; paint(); const n = root.querySelector('[data-fee-filter="q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  document.addEventListener("change", (e) => {
    const flt = e.target.closest("[data-fee-filter]");
    if (flt && flt.dataset.feeFilter !== "q") { F.filter[flt.dataset.feeFilter] = flt.value; paint(); }
  });
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (f.matches("[data-fee-planform]")) { e.preventDefault(); return savePlan(f); }
    if (f.matches("[data-fee-feeform]")) { e.preventDefault(); return saveFee(f); }
    if (f.matches("[data-fee-payform]")) { e.preventDefault(); return savePayment(f); }
    if (f.matches("[data-fee-settings]")) { e.preventDefault(); return saveSettings(f); }
    if (f.matches("[data-fee-bulkform]")) { e.preventDefault(); return giveToBatch(f); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.getElementById("feeModal")?.hidden) closeModal(); });

  // Numbers for the home screen (Dashboard cards + command centre).
  async function homeNumbers() {
    try { if (!F.state) await load(); } catch (e) { return null; }
    const t = totals();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("dashboardTodayCollection", Number(t.today).toLocaleString("en-IN"));
    set("dashboardTodayCollectionSmall", money(t.today));
    set("dashboardMonthCollection", money(t.month));
    set("dashboardFeesConnectionNote", F.plans.length ? `Outstanding ${money(t.outstanding)} · overdue ${money(t.overdue)}` : "Create a fee plan in Fees to start tracking collection.");
    return t;
  }

  window.SIRAdminFees = { render, homeNumbers, money };
})();
