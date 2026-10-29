// End-to-end (LOCAL stack + local Math OCR helper only): a 2-page scan
// (RCC pages 12 and 17) is uploaded through the real dashboard (branch
// code) → Tesseract OCR → segmentation → Math OCR helper → items →
// Review & Edit (source crop beside each recognised formula) → the
// reviewer corrects a wrong formula → save → reopen → Student preview.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "rtest", "x.js"));
const { chromium } = require("playwright");

const URL = "http://127.0.0.1:8766/test-coordinator/test-coordinator-dashboard.html";
const PDF = path.join(HERE, "ui_p12_p17.pdf"), SHOTS = path.join(HERE, "vis");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 300) : ""}`); };
const sql = (q) => { const f = path.join(HERE, "_q.sql"); fs.writeFileSync(f, q); return execSync(`docker exec -i supabase_db_sir-local-test psql -U postgres -d postgres -t -A -F"|" < "${f}"`).toString().trim(); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("dialog", (d) => d.accept());
const nav = async (k) => { await page.click(`.nav[data-page="${k}"]`); await page.waitForTimeout(400); await page.waitForFunction(() => !/Loading…/.test(document.querySelector("#mainContent")?.textContent || "")); };
const waitToast = (re, timeout = 30000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#toastRoot")?.textContent || ""), re.source, { timeout });
const inked = (sel) => page.$$eval(sel, (els) => els.map((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 128) dark++; return dark > 10; }));

await page.goto(URL);
await page.fill("#loginId", process.env.QB_LOCAL_USER || "tac.local"); await page.fill("#loginPassword", process.env.QB_LOCAL_PASSWORD || ""); await page.click("#loginButton");
await page.waitForSelector("#appView:not(.hide)", { timeout: 20000 });

// ---------------- Upload ----------------
const t0 = Date.now();
await nav("upload");
await page.setInputFiles("#upFiles", [PDF]);
await page.selectOption("#upSubject", "physics");
await page.selectOption("#upChapter", { label: "Electrostatics" });
await page.fill("#upSource", "RCC math OCR prototype test");
const statusLog = [];
const poll = setInterval(async () => { try { const t = await page.textContent("#upLog"); if (t && statusLog[statusLog.length - 1] !== t) statusLog.push(t); } catch {} }, 1500);
await page.click("#upStart");
await page.waitForFunction(() => [...document.querySelectorAll("#upLog [data-s]")].every((e) => /^(Done|Failed|Skipped)/.test(e.textContent)) && document.querySelectorAll("#upLog [data-s]").length === 1, null, { timeout: 1500000 });
clearInterval(poll);
const upMsg = await page.textContent("#upLog [data-s]");
check("scanned 2-page PDF processed in the browser", /^Done/.test(upMsg), `${upMsg} (${Math.round((Date.now() - t0) / 1000)} s)`);
check("the dashboard found the local Math OCR helper and used it", statusLog.some((s) => /Math OCR(?: helper found|: page \d+)/.test(s)) && !statusLog.some((s) => /helper not running/.test(s)), statusLog.filter((s) => /Math OCR/.test(s)).slice(-1)[0]);

const job = sql("select id from qb_import_jobs order by created_at desc limit 1;");
const n = sql(`select count(*), count(*) filter (where jsonb_array_length(coalesce(extracted->'math','[]'::jsonb))>0), count(*) filter (where extracted->>'parser_version' like '%mathocr%') from qb_import_items where job_id='${job}';`).split("|").map(Number);
check("items created, Math OCR results stored with them, parser version recorded", n[0] >= 15 && n[1] >= 5 && n[2] === n[0], `items ${n[0]}, with math ${n[1]}, versioned ${n[2]}`);
// A reading: original OCR text + source box + three readings. A marker that
// was not found: original OCR text + the reason (nothing was read).
const keep = sql(`select count(*), count(*) filter (where e ? 'ocr_text' and ((e->'box' is not null and jsonb_array_length(e->'reads')=3) or (e->>'status'='not_located' and jsonb_array_length(e->'reasons')>0))) from qb_import_items i, jsonb_array_elements(i.extracted->'math') e where job_id='${job}';`).split("|").map(Number);
check("every reading keeps the original OCR text, its source box and the three readings (an unlocated option keeps its text and the reason)", keep[0] > 0 && keep[0] === keep[1], `${keep[1]}/${keep[0]}`);
// Applied readings changed only their own option: the option text equals $latex$ of an entry with that key.
const wrongTarget = sql(`select count(*) from qb_import_items i, jsonb_array_elements(i.extracted->'math') e where job_id='${job}' and (e->>'applied')::boolean and not exists (select 1 from jsonb_array_elements(i.draft->'options') o where o->>'key'=e->>'key' and o->>'text'='$'||(e->>'latex')||'$');`);
check("each applied formula sits in its own option of its own question", wrongTarget === "0", wrongTarget);
const uncertainIssue = sql(`select count(*) from qb_import_items i where job_id='${job}' and exists (select 1 from jsonb_array_elements(i.extracted->'math') e where e->>'status'='uncertain' and e->>'target'='option') and not exists (select 1 from unnest(i.issues) s where s like 'Math OCR: option%NOT certain%');`);
check("every item with an uncertain formula carries a review warning", uncertainIssue === "0", uncertainIssue);

// ---------------- Review: Q16 (stacked fractions) ----------------
// Page 12 Q16 (four stacked-fraction options); its number is read as "16?".
const pick = sql(`select id from qb_import_items where job_id='${job}' and source_number like '16%' and page_no=1 limit 1;`);
if (!pick) { console.log("FAIL  Q16 of page 12 not found among the items"); process.exit(1); }
const mathEntries = JSON.parse(sql(`select extracted->'math' from qb_import_items where id='${pick}';`));
await nav("review");
await page.click(`[data-item="${pick}"]`);
await page.waitForSelector("[data-math] .qb-mrow", { timeout: 30000 });
await page.waitForTimeout(800);
const rows = await page.$$eval("[data-math] .qb-mrow", (r) => r.length);
check("Review & Edit lists every formula reading", rows === mathEntries.length, `${rows} rows / ${mathEntries.length} entries`);
const crops = await inked("[data-math] [data-mc] canvas");
check("each reading shows its SOURCE CROP from the stored page image", crops.length === mathEntries.filter((m) => m.box).length && crops.every(Boolean), JSON.stringify(crops));
const formulas = await page.$$eval("[data-math] [data-mf]", (els) => els.map((e) => ({ k: e.querySelectorAll(".katex").length, err: e.querySelectorAll(".katex-error").length })));
check("… beside the recognised formula, rendered without KaTeX errors (a reading that cannot render is shown as raw LaTeX, marked)", formulas.filter((f) => f.k).length === mathEntries.filter((m) => m.latex && m.status !== "failed").length && formulas.every((f) => f.err === 0)
  && (await page.$$eval("[data-math] [data-mf] .tag.red", (t) => t.length)) === mathEntries.filter((m) => m.latex && m.status === "failed").length, JSON.stringify(formulas));
check("formula boxes are outlined on the page view", (await page.$$(".qb-mbox")).length >= 1);
check("uncertain readings are marked UNCERTAIN in the panel", (await page.$$eval("[data-math] .tag.amber", (t) => t.length)) === mathEntries.filter((m) => m.status === "uncertain").length);
await page.screenshot({ path: path.join(SHOTS, "ui_mathocr_review.png"), fullPage: true });

// "Use this formula" puts the reading into the option (editor only).
const useIdx = mathEntries.findIndex((m) => m.latex && m.target === "option");
await page.click(`[data-use="${useIdx}"]`);
const keyIdx = ["A", "B", "C", "D"].indexOf(mathEntries[useIdx].key);
check(`"Use this formula" puts the reading into option ${mathEntries[useIdx].key}`, (await page.inputValue(`textarea[data-opt="${keyIdx}"]`)) === `$${mathEntries[useIdx].latex}$`);

// The reviewer types the correct formula for option A (verified against the page).
const FIX = "$\\frac{3q^{2}}{4\\pi\\varepsilon_{0}a^{2}}$";
await page.fill('textarea[data-opt="0"]', FIX);
const before = await page.$$eval("textarea[data-opt]", (ts) => ts.map((t) => t.value));
await page.click("[data-save]");
await waitToast(/Corrections saved/);
const dbOpts = JSON.parse(sql(`select draft->'options' from qb_import_items where id='${pick}';`)).map((o) => o.text);
check("saved: database option text is byte-identical to the editor", JSON.stringify(dbOpts) === JSON.stringify(before), JSON.stringify(dbOpts));
const stillMath = sql(`select jsonb_array_length(extracted->'math') from qb_import_items where id='${pick}';`);
check("the Math OCR record (source crops, original text) survives the save", Number(stillMath) === mathEntries.length, stillMath);

// ---------------- Reopen → Student preview ----------------
await nav("verify");
await page.click(`[data-item="${pick}"]`);
await page.waitForSelector('[data-f="preview"] .qb-opt', { timeout: 30000 });
await page.waitForTimeout(600);
check("reopened: the editor shows the saved options", JSON.stringify(await page.$$eval("textarea[data-opt]", (ts) => ts.map((t) => t.value))) === JSON.stringify(before));
const prev = await page.$$eval('[data-f="preview"] .qb-opt', (rows) => rows.map((r) => ({ err: r.querySelectorAll(".katex-error").length, frac: r.querySelectorAll(".katex-mathml mfrac").length, sqrt: r.querySelectorAll(".katex-mathml msqrt").length })));
check("Student preview: corrected option A shows a real fraction; no option has a KaTeX error", prev.length >= 2 && prev[0].frac === 1 && prev.every((p) => p.err === 0), JSON.stringify(prev));
check("the formula panel is still there after reopening", (await page.$$("[data-math] .qb-mrow")).length === mathEntries.length);
await page.screenshot({ path: path.join(SHOTS, "ui_mathocr_reopen.png"), fullPage: true });
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
fs.writeFileSync(path.join(HERE, "ui_mathocr_status.json"), JSON.stringify(statusLog, null, 1));
await browser.close();
