// =====================================================================
// SIR question rendering + paper export, shared by the teacher, admin
// and student dashboards.
//
//   SIRPaper.init(SUPABASE_URL)
//   SIRPaper.md(markdown)              → safe HTML (KaTeX maths, figures)
//   SIRPaper.questionHtml(q, opts)     → question + options block
//   SIRPaper.printPaper(win, paper)    → write a printable paper into win
//   SIRPaper.downloadDoc(paper)        → Word (.doc) download
//
// Question text is stored as Markdown with $…$ / $$…$$ maths and figures
// as ![Figure n](qb-images/…). Needs KaTeX, marked and DOMPurify on the
// page; without them it falls back to escaped plain text.
// =====================================================================
(function () {
  let imagesUrl = "";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  const fixTex = (s) => s.replace(/(\\[,;:!]|\\quad|\\qquad)\s*(\^|_)/g, "$1{}$2");

  const TYPE_LABEL = { single: "Single correct", multi: "Multiple correct", integer: "Integer", numerical: "Numerical", matrix_match: "Matrix match", subjective: "Short answer" };
  const DIFF_LABEL = { 1: "Easy", 2: "Easy", 3: "Medium", 4: "Hard", 5: "Very hard" };

  function resolveImages(md) {
    return String(md ?? "").replace(/\]\(qb-images\//g, `](${imagesUrl}`);
  }

  function tex(src, display) {
    if (!window.katex) return esc(display ? `$$${src}$$` : `$${src}$`);
    return window.katex.renderToString(fixTex(src), { throwOnError: false, displayMode: display, strict: "ignore" });
  }

  // Markdown + maths → HTML. Maths is cut out before Markdown so that
  // underscores and asterisks inside formulas are not read as emphasis.
  function md(text, { inline = false } = {}) {
    const math = [];
    const shielded = resolveImages(text).replace(MATH, (m, d, i) => { math.push(d != null ? tex(d, true) : tex(i, false)); return `@@M${math.length - 1}@@`; });
    let html;
    if (window.marked && window.DOMPurify) {
      html = inline ? window.marked.parseInline(shielded) : window.marked.parse(shielded, { breaks: true, gfm: true });
      html = window.DOMPurify.sanitize(html);
    } else {
      html = esc(shielded).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">').replace(/\n/g, "<br>");
    }
    return html.replace(/@@M(\d+)@@/g, (_, n) => math[Number(n)]);
  }

  function answerText(a) {
    if (a == null || a === "") return "—";
    if (Array.isArray(a)) return a.join(", ");
    if (typeof a === "object") return Object.entries(a).map(([k, v]) => `${k}→${[].concat(v).join(",")}`).join("  ");
    return String(a);
  }

  function isCorrect(answer, key) {
    if (answer == null) return false;
    return Array.isArray(answer) ? answer.includes(key) : String(answer) === key;
  }

  // q: { question_md|question, options, type, unit }
  // opts: { answer, solution, showAnswer, number, marks }
  function questionHtml(q, opts = {}) {
    const body = q.question_md ?? q.question ?? "";
    let html = `<div class="sp-q">`;
    if (opts.number != null) html += `<div class="sp-qn">Q${opts.number}${opts.marks ? `<span>${esc(opts.marks)}</span>` : ""}</div>`;
    html += `<div class="sp-qbody">${md(body)}</div>`;
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length) {
      html += `<ol class="sp-opts">`;
      for (const o of options) {
        const ok = opts.showAnswer && isCorrect(opts.answer, o.key);
        html += `<li class="${ok ? "ok" : ""}"><b>${esc(o.key)}</b><div>${md(o.text, { inline: true })}</div></li>`;
      }
      html += `</ol>`;
    } else if (q.type === "integer" || q.type === "numerical") {
      html += `<div class="sp-ans-line">Answer: ____________${q.unit ? " " + esc(q.unit) : ""}</div>`;
    }
    if (opts.showAnswer && opts.answer != null) {
      html += `<div class="sp-key"><b>Answer:</b> ${md(answerText(opts.answer), { inline: true })}</div>`;
    }
    if (opts.showAnswer && opts.solution) {
      html += `<details class="sp-sol"><summary>Solution</summary>${md(opts.solution)}</details>`;
    }
    return html + `</div>`;
  }

  // ---------------------------------------------------------------
  // Paper export
  // paper = { title, subtitle, duration, maxMarks, instructions[],
  //           sections: [{ label, note, questions: [{ q, answer, solution, marks }] }],
  //           withKey, withSolutions }
  // ---------------------------------------------------------------
  const PRINT_CSS = `
    *{box-sizing:border-box}
    body{font-family:"Times New Roman",Georgia,serif;color:#111;margin:0;padding:18mm 14mm;font-size:12pt;line-height:1.45}
    h1{font-size:18pt;margin:0;text-align:center}
    .sub{text-align:center;color:#333;margin:4px 0 0}
    .meta{display:flex;justify-content:space-between;border-top:2px solid #111;border-bottom:1px solid #111;padding:6px 0;margin:12px 0;font-weight:bold;font-size:11pt}
    .instr{font-size:10.5pt;margin:0 0 10px;padding-left:18px}
    h2{font-size:13pt;background:#eee;padding:5px 8px;margin:18px 0 6px;border-left:4px solid #111}
    .note{font-size:10pt;color:#333;margin:0 0 6px}
    .sp-q{display:grid;grid-template-columns:42px 1fr;gap:0 6px;padding:8px 0;break-inside:avoid;page-break-inside:avoid;border-bottom:1px dotted #bbb}
    .sp-qn{font-weight:bold}
    .sp-qn span{display:block;font-weight:normal;font-size:9pt;color:#444}
    .sp-qbody,.sp-opts,.sp-key,.sp-ans-line,.sp-sol{grid-column:2}
    .sp-qbody p{margin:0 0 4px}
    .sp-qbody img,.sp-sol img{max-width:70%;max-height:200px;display:block;margin:6px 0}
    .sp-opts{list-style:none;margin:4px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:3px 18px}
    .sp-opts li{color:#101b2d;display:flex;gap:6px}
    .sp-opts li div p{margin:0}
    .sp-ans-line{margin-top:6px;color:#333}
    .key{break-before:page;page-break-before:always}
    .key table{border-collapse:collapse;width:100%;font-size:11pt}
    .key td,.key th{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
    .sol{padding:6px 0;border-bottom:1px dotted #bbb;break-inside:avoid}
    .sol p{margin:0 0 4px}
    @page{margin:12mm}
    @media print{body{padding:0}}
  `;

  function numberedSections(paper) {
    let n = 0;
    return paper.sections.map((s) => ({ ...s, questions: s.questions.map((x) => ({ ...x, n: ++n })) }));
  }

  function paperBody(paper, render) {
    const sections = numberedSections(paper);
    let html = `<h1>${esc(paper.title)}</h1>`;
    if (paper.subtitle) html += `<p class="sub">${esc(paper.subtitle)}</p>`;
    html += `<div class="meta"><span>Time: ${esc(paper.duration || "—")} min</span><span>Maximum marks: ${esc(paper.maxMarks ?? "—")}</span></div>`;
    if (paper.instructions?.length) html += `<ol class="instr">${paper.instructions.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
    for (const s of sections) {
      html += `<h2>${esc(s.label)}</h2>`;
      if (s.note) html += `<p class="note">${esc(s.note)}</p>`;
      for (const x of s.questions) html += render.question(x.q, { number: x.n, marks: x.marks });
    }
    if (paper.withKey) {
      html += `<div class="key"><h1>Answer key</h1><p class="sub">${esc(paper.title)}</p><table><tr><th>Q</th><th>Answer</th><th>Q</th><th>Answer</th></tr>`;
      const all = sections.flatMap((s) => s.questions);
      const half = Math.ceil(all.length / 2);
      for (let i = 0; i < half; i++) {
        const a = all[i], b = all[i + half];
        html += `<tr><td>${a.n}</td><td>${render.inline(answerText(a.answer))}</td><td>${b ? b.n : ""}</td><td>${b ? render.inline(answerText(b.answer)) : ""}</td></tr>`;
      }
      html += `</table>`;
      if (paper.withSolutions) {
        html += `<h2>Solutions</h2>`;
        for (const x of all) if (x.solution) html += `<div class="sol"><b>Q${x.n}.</b> ${render.block(x.solution)}</div>`;
      }
      html += `</div>`;
    }
    return html;
  }

  // Into a window the caller opened synchronously in the click handler
  // (so phones don't block it as a pop-up). The browser's print dialog
  // offers "Save as PDF".
  function printPaper(win, paper) {
    const body = paperBody(paper, {
      question: (q, o) => questionHtml(q, o),
      inline: (t) => md(t, { inline: true }),
      block: (t) => md(t),
    });
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(paper.title)}</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
      <style>${PRINT_CSS}</style></head><body>${body}
      <script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)});<\/script></body></html>`);
    win.document.close();
  }

  // Word can't run KaTeX, so maths becomes plain text with real
  // superscripts, subscripts and symbols (v² , √x, a⃗, θ …).
  const SYM = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", nu: "ν", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω", eta: "η", zeta: "ζ", kappa: "κ", chi: "χ", psi: "ψ",
    Delta: "Δ", Gamma: "Γ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Omega: "Ω", Psi: "Ψ",
    times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", sim: "∼", propto: "∝", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", rightleftharpoons: "⇌",
    degree: "°", circ: "°", partial: "∂", nabla: "∇", int: "∫", sum: "∑", prod: "∏", angle: "∠", perp: "⊥", parallel: "∥", therefore: "∴", because: "∵", ldots: "…", dots: "…", cdots: "⋯", quad: "  ", qquad: "    ",
    left: "", right: "", displaystyle: "", limits: "" };

  function texText(src) {
    let s = fixTex(String(src));
    const group = String.raw`\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}`;
    const arg = (re) => new RegExp(re.replace(/G/g, group), "g");
    const wrap = (x) => (/^[\w.]+(\^\{?\w+\}?)?$/.test(x.trim()) ? x.trim() : `(${x})`);
    for (let i = 0; i < 4; i++) {
      s = s.replace(arg(String.raw`\\d?frac\s*GG`), (_, a, b) => `${wrap(a)}/${wrap(b)}`)
        .replace(arg(String.raw`\\sqrt\s*G`), (_, a) => `√(${a})`)
        .replace(arg(String.raw`\\(?:text|mathrm|mathbf|mathit|operatorname|textbf|ce)\s*G`), (_, a) => a)
        .replace(arg(String.raw`\\(?:vec|overrightarrow)\s*G`), (_, a) => `${a}⃗`)
        .replace(arg(String.raw`\\hat\s*G`), (_, a) => `${a}̂`)
        .replace(arg(String.raw`\\(?:bar|overline)\s*G`), (_, a) => `${a}̅`)
        .replace(arg(String.raw`\\dot\s*G`), (_, a) => `${a}̇`);
    }
    s = s.replace(/\\(?:vec|overrightarrow)\s*(\\[A-Za-z]+|[A-Za-z])/g, (_, a) => `${a}⃗`)
      .replace(/\\hat\s*(\\[A-Za-z]+|[A-Za-z])/g, (_, a) => `${a}̂`)
      .replace(/\\dot\s*(\\[A-Za-z]+|[A-Za-z])/g, (_, a) => `${a}̇`)
      .replace(/\\([A-Za-z]+)/g, (m, w) => (w in SYM ? SYM[w] : w))
      .replace(/\\[,;:!]/g, " ").replace(/\\\\/g, " ");
    // Escape before adding <sup>/<sub>.
    s = esc(s)
      .replace(/\^\{([^{}]*)\}/g, "<sup>$1</sup>").replace(/\^(.)/g, "<sup>$1</sup>")
      .replace(/_\{([^{}]*)\}/g, "<sub>$1</sub>").replace(/_(.)/g, "<sub>$1</sub>")
      .replace(/[{}]/g, "");
    return `<i>${s}</i>`;
  }

  function docMd(text, inline) {
    const math = [];
    const shielded = resolveImages(text).replace(MATH, (m, d, i) => { math.push(texText(d ?? i)); return `@@M${math.length - 1}@@`; });
    let html = window.marked && window.DOMPurify
      ? window.DOMPurify.sanitize(inline ? window.marked.parseInline(shielded) : window.marked.parse(shielded, { breaks: true, gfm: true }))
      : esc(shielded).replace(/\n/g, "<br>");
    html = html.replace(/<img /g, '<img width="300" ');
    return html.replace(/@@M(\d+)@@/g, (_, n) => math[Number(n)]);
  }

  function docQuestion(q, o) {
    let html = `<p style="margin:10pt 0 2pt"><b>Q${o.number}.</b> ${o.marks ? `<span style="color:#555">[${esc(o.marks)}]</span> ` : ""}</p>${docMd(q.question_md ?? q.question ?? "")}`;
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length) html += `<table style="width:100%;margin-left:18pt">${options.map((x) => `<tr><td style="width:24pt;vertical-align:top"><b>(${esc(x.key)})</b></td><td>${docMd(x.text, true)}</td></tr>`).join("")}</table>`;
    return html;
  }

  function downloadDoc(paper) {
    const body = paperBody(paper, { question: docQuestion, inline: (t) => docMd(t, true), block: (t) => docMd(t) })
      .replace('<div class="key">', '<br clear="all" style="page-break-before:always"><div class="key">');
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(paper.title)}</title>
      <style>body{font-family:"Times New Roman";font-size:12pt}h1{text-align:center;font-size:16pt}h2{font-size:13pt;background:#eeeeee}.sub{text-align:center}.meta{font-weight:bold}.key td,.key th{border:1px solid #999;padding:3pt}</style></head><body>${body}</body></html>`;
    const blob = new Blob(["﻿", doc], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (paper.title || "test").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".doc";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // On-screen look of questionHtml(); pages can override.
  const SCREEN_CSS = `
    .sp-q{padding:2px 0;color:#101b2d}
    .sp-qn{font-weight:700;font-size:12px;color:#5a6b85;margin-bottom:4px;display:flex;gap:8px;align-items:center}
    .sp-qn span{font-weight:600;background:#eef2f7;border-radius:999px;padding:2px 8px;font-size:11px}
    .sp-qbody{font-size:15px;line-height:1.65;color:#101b2d;overflow-wrap:anywhere}
    .sp-qbody p{margin:0 0 6px}
    .sp-qbody img,.sp-sol img{display:block;max-width:100%;max-height:260px;margin:8px 0;border-radius:6px;background:#fff}
    .sp-qbody table{border-collapse:collapse;margin:6px 0;font-size:14px}
    .sp-qbody td,.sp-qbody th{border:1px solid #d8e0ec;padding:4px 8px}
    .sp-opts{list-style:none;margin:8px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .sp-opts li{color:#101b2d;display:flex;gap:8px;align-items:flex-start;border:1px solid #e3e8ef;border-radius:10px;padding:8px 10px;font-size:14px;line-height:1.5;background:#fbfcfe;min-width:0}
    .sp-opts li b{flex:none;width:22px;height:22px;border-radius:50%;background:#eef2f7;display:grid;place-items:center;font-size:12px}
    .sp-opts li div{min-width:0;overflow-wrap:anywhere}
    .sp-opts li.ok{border-color:#1c8a4e;background:#e4f5eb}
    .sp-opts li.ok b{background:#1c8a4e;color:#fff}
    .sp-ans-line{margin-top:8px;color:#5a6b85;font-size:13px}
    .sp-key{margin-top:8px;font-size:13.5px;color:#14532d;background:#ecfdf3;border-radius:8px;padding:6px 10px}
    .sp-sol{margin-top:6px;font-size:13.5px;line-height:1.6}
    .sp-sol summary{cursor:pointer;color:#1e56f0;font-weight:600}
    .katex{font-size:1.05em}
    .katex-display{overflow-x:auto;overflow-y:hidden;padding:2px 0}
    @media(max-width:560px){.sp-opts{grid-template-columns:1fr}}
  `;
  if (typeof document !== "undefined" && !document.getElementById("sir-paper-css")) {
    const st = document.createElement("style");
    st.id = "sir-paper-css";
    st.textContent = SCREEN_CSS;
    document.head.appendChild(st);
  }

  window.SIRPaper = {
    init(supabaseUrl) { imagesUrl = `${supabaseUrl}/storage/v1/object/public/qb-images/`; },
    esc, md, questionHtml, answerText, printPaper, downloadDoc, texText,
    typeLabel: (t) => TYPE_LABEL[t] || t,
    difficultyLabel: (d) => DIFF_LABEL[d] || "",
  };
})();
