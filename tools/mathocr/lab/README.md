# Math OCR lab (measurement scripts)

`REPORT.md` is the evaluation report. The scripts here produced its numbers. They ran from a local lab folder next to:
- the RCC Electrostatics PDF and its page renders (not in the repository: published book scans);
- a Playwright install;
- the local Supabase test stack.

| File | What it does |
|---|---|
| `benchmark-truth.json`, `benchmark-boxes.json` | 100 benchmark formulas (+1 needs-human): expected LaTeX and page boxes |
| `heldout-truth.json` | held-out pages 13/16/18/20: every option, transcribed before the prototype was run on them |
| `proto_harness.mjs` | runs the real pipeline in Chromium: pdf.js → `ocrPage` → `segmentQuestions` → `runMathOcr` (helper) |
| `score_proto.mjs` | scores a harness run: current vs Pix2Text alone vs Pix2Text + clean-up |
| `score.mjs`, `canon_test.mjs` | KaTeX-MathML meaning/layout comparison and its self-test |
| `ui_mathocr.mjs` | end-to-end UI test on the local stack (`QB_LOCAL_USER` / `QB_LOCAL_PASSWORD` = local test account) |
| `spotcheck.mjs` | builds the teacher spot-check sheet (`spotcheck.html`, kept local) |
| `equiv.py` | proves the helper's ONNX recogniser matches pix2text's output |
| `crops.py`, `split.py` | benchmark crops; the Tesseract fraction-split baseline |
| `results.json`, `summary-*.txt` | per-expression results and summaries quoted in the report |
