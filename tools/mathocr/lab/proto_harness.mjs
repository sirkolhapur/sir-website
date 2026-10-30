// Runs the PROTOTYPE pipeline exactly as the portal would, in Chromium:
// pdf.js render → ocrPage (Tesseract) → segmentQuestions → runMathOcr
// (local helper on 127.0.0.1:8765). Uses the branch code in ../repo.
//   node proto_harness.mjs <outdir> <pages e.g. 3,4,10>
// Writes <outdir>/ocr/pNN.json (cached OCR incl. word boxes) and
// <outdir>/result.json (questions before/after Math OCR, regions, timings).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "rtest", "x.js"));
const { chromium } = require("playwright");

const [outDir, pagesArg] = process.argv.slice(2);
const PDF = path.join(HERE, "..", "fixture", "es.pdf");
const REPO = path.join(HERE, "..", "repo");
fs.mkdirSync(path.join(outDir, "ocr"), { recursive: true });
const pages = pagesArg.split(",").map(Number);
// Contiguous runs are segmented together (a question may continue over a page break).
const runs = []; for (const p of pages) { const r = runs[runs.length - 1]; if (r && r[r.length - 1] === p - 1) r.push(p); else runs.push([p]); }

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<!doctype html><meta charset="utf-8"><body>proto</body>`); }
  const f = u === "/doc.pdf" ? PDF : u.startsWith("/repo/") ? path.join(REPO, u.slice(6)) : null;
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": f.endsWith(".mjs") ? "text/javascript" : "application/pdf" });
  fs.createReadStream(f).pipe(res);
}).listen(8799);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
await page.goto("http://127.0.0.1:8799/");
for (const src of ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js"]) await page.addScriptTag({ url: src });
await page.evaluate(async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  window.doc = await pdfjsLib.getDocument("/doc.pdf").promise;
  window.ocr = await import("/repo/tools/qb/ocr-page.mjs");
  window.parser = await import("/repo/tools/qb/pdf-parser.mjs");
  window.mocr = await import("/repo/tools/qb/math-ocr.mjs");
});

const timing = { ocr: {} };
for (const p of pages) {
  const f = path.join(outDir, "ocr", `p${String(p).padStart(2, "0")}.json`);
  if (fs.existsSync(f)) continue;
  const t = Date.now();
  const r = await page.evaluate(async (p) => {
    if (!window.worker) window.worker = await Tesseract.createWorker("eng");
    const canvas = await ocr.renderPage(await doc.getPage(p));
    const r = await ocr.ocrPage(worker, canvas);
    return { page: p, width: r.width, height: r.height, source: "ocr", lines: r.lines, figures: r.figures, columns: r.columns, conf: r.conf };
  }, p);
  timing.ocr[p] = Date.now() - t;
  fs.writeFileSync(f, JSON.stringify(r));
  console.log(`page ${p}: OCR ${r.lines.length} lines, ${(timing.ocr[p] / 1000).toFixed(0)} s`);
}

const health = await page.evaluate(() => mocr.helperHealth());
console.log("helper:", JSON.stringify(health));
const result = { health, runs: [] };
for (const run of runs) {
  const pd = run.map((p) => JSON.parse(fs.readFileSync(path.join(outDir, "ocr", `p${String(p).padStart(2, "0")}.json`), "utf8")));
  const t = Date.now();
  const out = await page.evaluate(async (pd) => {
    const { questions } = parser.segmentQuestions(pd, {});
    const before = questions.map((q) => JSON.parse(JSON.stringify(q.draft.options)));
    const markers = questions.map((q) => {
      const m = mocr.findOptionMarkers(q.lines || [], (q.draft.options || []).map((o) => o.key));
      return Object.fromEntries(Object.entries(m).map(([k, w]) => [k, { page: w.line.page, col: w.line.col ?? 0, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, lookalike: !!w.lookalike }]));
    });
    const stats = await mocr.runMathOcr(questions, pd, { renderPage: async (p) => ocr.renderPage(await doc.getPage(p)), katex: window.katex });
    return { stats, questions: questions.map((q, i) => ({ number: q.number, source_number: q.source_number, section_no: q.section_no, page_from: q.page_from, page_to: q.page_to,
      stem: q.draft.question, before: before[i], after: q.draft.options, markers: markers[i], math: q.math, issues: q.issues, confidence: q.confidence })) };
  }, pd);
  out.pages = run; out.ms = Date.now() - t;
  result.runs.push(out);
  console.log(`pages ${run.join(",")}: ${out.questions.length} questions, math ${JSON.stringify(out.stats)}`);
}
result.timing = timing;
fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 1));
await browser.close(); srv.close();
