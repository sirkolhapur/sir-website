// =====================================================================
// SIR result formulas — shared by the teacher and student dashboards so
// both show the same numbers as the database (see the results_integrity
// migration):
//
//   percentage  = marks ÷ max × 100          (negative marks allowed)
//   accuracy    = correct ÷ (correct + wrong) × 100
//   absent (AB) tests are listed but never counted in averages
//   subject max = questions × marks per question (NEET/JEE 4; MHT-CET
//                 Maths 2, others 1) when the row has no max of its own
// =====================================================================
(function () {
  const num = (v) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

  const isAbsent = (r) => /^(ab|absent)$/i.test(String(r?.status || "").trim());

  function percentage(r) {
    if (!r || isAbsent(r)) return null;
    const m = num(r.marks_obtained), mx = num(r.max_marks);
    if (m !== null && mx !== null && mx > 0) return (m / mx) * 100;
    return null;
  }

  function marksPerQuestion(testType, subject) {
    return /cet/i.test(String(testType || "")) ? (/^math/i.test(String(subject || "")) ? 2 : 1) : 4;
  }

  function subjectRow(s, testType) {
    const c = num(s.correct), w = num(s.wrong), sk = num(s.skipped), m = num(s.marks_obtained);
    let mx = num(s.max_marks);
    if ((mx === null || mx <= 0) && c !== null && w !== null && sk !== null && c + w + sk > 0) mx = (c + w + sk) * marksPerQuestion(testType, s.subject);
    const attempted = num(s.attempted) ?? (c !== null && w !== null ? c + w : null);
    return {
      subject: s.subject || "Subject", marks: m, max: mx, correct: c, wrong: w, skipped: sk, attempted,
      percentage: m !== null && mx > 0 ? (m / mx) * 100 : null,
      accuracy: c !== null && w !== null && c + w > 0 ? (c / (c + w)) * 100 : null,
    };
  }

  // Whole-test counts from its subject rows (null when any subject lacks them).
  function counts(subjects) {
    if (!Array.isArray(subjects) || !subjects.length) return null;
    const t = { correct: 0, wrong: 0, skipped: 0 };
    for (const s of subjects) {
      const c = num(s.correct), w = num(s.wrong), sk = num(s.skipped);
      if (c === null || w === null || sk === null) return null;
      t.correct += c; t.wrong += w; t.skipped += sk;
    }
    t.attempted = t.correct + t.wrong;
    t.total = t.attempted + t.skipped;
    t.accuracy = t.attempted > 0 ? (t.correct / t.attempted) * 100 : null;
    return t;
  }

  const rankOf = (r) => num(r?.batch_rank) ?? num(r?.overall_rank);

  // results: newest first or any order; returns a summary over appeared tests.
  function summary(results) {
    const sorted = [...results].sort((a, b) => String(b.test_date || "").localeCompare(String(a.test_date || "")));
    const appeared = sorted.filter((r) => !isAbsent(r));
    const pcts = appeared.map(percentage).filter((p) => p !== null);
    const ranks = appeared.map(rankOf).filter((x) => x !== null && x > 0);
    return {
      total: sorted.length,
      appeared: appeared.length,
      absent: sorted.length - appeared.length,
      average: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
      best: pcts.length ? Math.max(...pcts) : null,
      latest: appeared[0] || null,
      bestRank: ranks.length ? Math.min(...ranks) : null,
    };
  }

  // Same test across students: one key per exam name + date.
  const testKey = (r) => String(r.exam_name || "").trim().toLowerCase() + "|" + (r.test_date || "");

  const fmtPct = (p) => (p === null || p === undefined || !Number.isFinite(p) ? "—" : p.toFixed(1) + "%");

  window.SIRResults = { num, isAbsent, percentage, marksPerQuestion, subjectRow, counts, rankOf, summary, testKey, fmtPct };
})();
