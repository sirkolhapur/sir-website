// Real-scan regression: the RCC Electrostatics-I module (28 photographed
// pages, 303 printed questions; ground truth in fixtures/). The book's text
// cannot be committed, so this test runs only when the cached OCR pages are
// supplied:  QB_RCC_OCR=<dir with p01.json … p28.json> node --test "tools/qb/tests/*.test.mjs"
// (made by the OCR harness from the PDF; see the audit report).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { segmentQuestions } from "../pdf-parser.mjs";
import { scoreAgainstTruth } from "./truth-score.mjs";

const dir = process.env.QB_RCC_OCR;
const truth = JSON.parse(fs.readFileSync(new URL("./fixtures/rcc-electrostatics-truth.json", import.meta.url), "utf8"));

test("RCC scan: every printed question is matched or flagged; nothing phantom", { skip: !dir && "QB_RCC_OCR not set (cached OCR of the scan is local only)" }, () => {
  const pages = fs.readdirSync(dir).filter((f) => /^p\d+\.json$/.test(f)).sort().map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { page: d.page, width: d.width, height: d.height, source: "ocr", lines: d.lines, figures: d.figures, columns: d.columns };
  });
  assert.equal(pages.length, 28);
  const { questions } = segmentQuestions(pages, { subject: "physics" });
  const s = scoreAgainstTruth(truth, questions, Object.fromEntries(pages.map((p) => [p.page, p])));
  const silent = s.rows.filter((r) => r.status !== "matched" && !r.flagged).map((r) => r.key);
  assert.deepEqual(silent, [], "printed questions lost without any warning");
  assert.deepEqual(s.extras, [], "items that are not a printed question");
  assert.ok(s.matched >= Number(process.env.QB_RCC_MIN || 290), `matched ${s.matched}`);
});
