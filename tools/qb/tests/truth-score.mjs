// =====================================================================
// SIR question bank — score an extraction against a hand-made ground truth
// (tests and diagnostics only; the portal never knows the truth).
//
// truth:  tools/qb/tests/fixtures/*-truth.json (sections → page → column
//         number ranges, types, figures)
// items:  parser questions ({ number, assumed, section_no, regions[],
//         page_from, draft{ type, options, figures } , issues })
// pages:  { [page]: { width, columns:[{left,width}…] } } to tell columns
//
// Every printed question ends up in exactly one bucket:
//   matched     one item carries it (number read or aligned by position)
//   merged      its text is inside another question's item
//   missing     no item carries it
// and every item that is not a printed question is listed as
//   duplicate / extra (bleed, figure label, split continuation …).
// =====================================================================

export function truthQuestions(truth) {
  const out = [];
  for (const s of truth.sections) {
    const inRange = (n, r) => r && n >= r[0] && n <= r[1];
    for (const [page, cols] of Object.entries(s.pages)) {
      for (const col of ["L", "R"]) {
        const [a, b] = cols[col];
        for (let n = a; n <= b; n++) {
          const type = inRange(n, s.types?.assertion_reason) ? "assertion_reason" : inRange(n, s.types?.subjective) || s.type === "subjective" ? "subjective" : "mcq";
          out.push({ key: `${s.no}:${n}`, section: s.no, heading: s.heading, n, page: Number(page), col: col === "L" ? 0 : 1, type,
            figure: s.figures.includes(n), figureOptions: (s.figure_options || []).includes(n) });
        }
      }
    }
  }
  return out;
}

// Column of an item = column of the first line it starts with.
function itemPlace(it, pages) {
  const r = it.regions?.[0];
  if (!r) return { page: it.page_from, col: 0, y: 0 };
  const p = pages[r.page];
  const x = (r.box[0] / 1000) * (p?.width ?? 1000);
  // Right-column numbers hang into the gap, left of the OCR split: compare
  // with the middle of the gap minus a margin, not with the split itself.
  const split = p?.columns?.length > 1 ? p.columns[1].left - 0.04 * (p.width ?? 1000) : (p?.width ?? 1000) / 2;
  return { page: r.page, col: x >= split ? 1 : 0, y: r.box[1] };
}

export function scoreAgainstTruth(truth, items, pages) {
  const T = truthQuestions(truth);
  const its = items.map((it, i) => ({ i, it, ...itemPlace(it, pages), num: Number.isInteger(it.number) ? it.number : null }));
  const byPlace = (page, col) => its.filter((x) => x.page === page && x.col === col).sort((a, b) => a.y - b.y);
  const match = new Map();    // truth key → item index
  const used = new Map();     // item index → truth key
  const how = new Map();

  // 1. Number read and in the right page/column.
  for (const t of T) {
    const c = byPlace(t.page, t.col).find((x) => x.num === t.n && !used.has(x.i));
    if (c) { match.set(t.key, c.i); used.set(c.i, t.key); how.set(t.key, c.it.assumed ? "assumed" : "read"); }
  }
  // 2. A question that starts in one column and is listed under the next
  //    (number at the very bottom of the left column, text continues): same
  //    page, other column.
  for (const t of T) {
    if (match.has(t.key)) continue;
    const c = its.find((x) => x.page === t.page && x.num === t.n && !used.has(x.i));
    if (c) { match.set(t.key, c.i); used.set(c.i, t.key); how.set(t.key, "other column"); }
  }
  // 3. Misread or missing number: an unused item between two matched
  //    neighbours, with exactly one unmatched printed number in that slot.
  for (const page of new Set(T.map((t) => t.page))) {
    for (const col of [0, 1]) {
      const tq = T.filter((t) => t.page === page && t.col === col);
      const slot = byPlace(page, col);
      for (const x of slot) {
        if (used.has(x.i)) continue;
        const before = [...slot].reverse().find((y) => y.y < x.y && used.has(y.i));
        const after = slot.find((y) => y.y > x.y && used.has(y.i));
        const lo = before ? T.find((t) => t.key === used.get(before.i)) : null;
        const hi = after ? T.find((t) => t.key === used.get(after.i)) : null;
        const open = tq.filter((t) => !match.has(t.key) && (!lo || (t.section === lo.section && t.n > lo.n)) && (!hi || (t.section === hi.section && t.n < hi.n)));
        if (open.length === 1) { match.set(open[0].key, x.i); used.set(x.i, open[0].key); how.set(open[0].key, "aligned by position"); }
      }
    }
  }

  // Unmatched printed questions: merged into the item before them on the
  // same page/column (the usual effect of an unread number), or missing.
  // "flagged": the item that holds it carries a warning that sends the
  // reviewer to it (numbering gap, second option set, start-like line …) —
  // an unflagged merge is a SILENT loss, the one outcome that must not happen.
  const MERGE_HINT = /jumps from|not found before|two questions|look like the start of another|"Assertion" statements|continues across pages|Continues after its four options|Text found before the first/;
  const rows = T.map((t) => {
    const k = match.get(t.key);
    if (k != null) return { ...t, status: "matched", item: k, how: how.get(t.key) };
    const prev = T.slice(0, T.indexOf(t)).reverse().find((u) => match.has(u.key) && u.section === t.section);
    const into = prev ? match.get(prev.key) : null;
    const nextItem = items[into + 1];
    const flagged = into != null && ((items[into].issues || []).some((s) => MERGE_HINT.test(s)) || (nextItem?.issues || []).some((s) => /jumps from|not found before/.test(s)));
    return { ...t, status: prev ? "merged" : "missing", into, intoKey: prev?.key ?? null, flagged };
  });

  // Items that are not a printed question.
  const extras = its.filter((x) => !used.has(x.i)).map((x) => {
    const dupOf = T.find((t) => t.n === x.num && match.has(t.key) && t.page === x.page);
    return { item: x.i, number: x.it.number, source_number: x.it.source_number, page: x.page, col: x.col, y: x.y,
      kind: dupOf ? `duplicate of ${dupOf.key}` : x.num == null ? "unnumbered text" : "extra", text: String(x.it.draft?.question ?? "").slice(0, 80) };
  });

  // Correctness of matched items.
  const checks = rows.filter((r) => r.status === "matched").map((r) => {
    const it = items[r.item], d = it.draft || {};
    const opts = Array.isArray(d.options) ? d.options.length : 0;
    const problems = [];
    if (r.type === "mcq" && opts !== 4) problems.push(`options ${opts}/4`);
    if (r.type !== "mcq" && opts > 0) problems.push(`${r.type} given ${opts} options`);
    const figs = (d.figures || []).length;
    if (r.figure && !figs) problems.push("figure not attached");
    if (!r.figure && figs) problems.push(`${figs} figure(s) attached to a question without one`);
    const merged = rows.filter((x) => x.status === "merged" && x.into === r.item).map((x) => x.key);
    if (merged.length) problems.push(`also contains ${merged.join(", ")}`);
    if (String(d.question ?? "").includes("[[?]]") || (d.options || []).some((o) => String(o.text).includes("[[?]]"))) problems.push("unreadable math [[?]]");
    return { key: r.key, page: r.page, item: r.item, problems };
  });

  const sec = truth.sections.map((s) => {
    const rs = rows.filter((r) => r.section === s.no);
    return { section: s.no, heading: s.heading, expected: rs.length, matched: rs.filter((r) => r.status === "matched").length,
      merged: rs.filter((r) => r.status === "merged").map((r) => r.n), missing: rs.filter((r) => r.status === "missing").map((r) => r.n),
      clean: checks.filter((c) => rows.find((r) => r.key === c.key).section === s.no && !c.problems.length).length };
  });
  return { expected: T.length, items: items.length, matched: rows.filter((r) => r.status === "matched").length, rows, extras, checks, sections: sec };
}
