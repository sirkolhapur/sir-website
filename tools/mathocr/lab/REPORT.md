# Math OCR prototype: evaluation report (2026-10-29)

Branch `mathocr-prototype` (prototype, **not for merge**). Nothing was deployed. No production data, production import or live database was touched. Every test ran on this PC against the local test database.

## What was built

1. **Local helper** (`tools/mathocr`).
   - Runs Pix2Text MFR 1.5 directly with onnxruntime: no PyTorch, no internet after installation, listens on 127.0.0.1 only.
   - Every crop is read three ways (as cut, padded, enlarged).
   - It reproduces pix2text's own output exactly: 302 of 303 readings identical on the 101 lab crops. The one difference is a runaway reading on a blurred crop, which both versions get wrong.
2. **Formula regions from the question's own structure** (`tools/qb/math-ocr.mjs`).
   - Tesseract still reads the page.
   - Each option's region starts at its option marker ("a)", "(b)") and ends at the next marker or exam-year label on the row. Its height comes from the page ink, so stacked fractions are included.
   - Neighbouring printed lines bound every region.
   - The general formula detector is **not** used.
3. **Placing the results.**
   - A reading replaces only the text of **the same option of the same question**.
   - Options whose marker is lost keep the Tesseract text plus a warning.
   - When the text parser found no options, or only some, the missing options are recovered from the markers on the page and always flagged.
   - No question is dropped and no option is moved.
4. **Flagging.** A formula is `agreed` only if all of these hold:
   - the three readings mean the same thing;
   - every symbol is at least 50% certain;
   - it renders;
   - it holds one line and one option;
   - its marker letter was actually read, not inferred.

   Everything else is `uncertain` (put in the option **and** a review warning added) or `failed` (Tesseract text kept and a warning added).
5. **Kept for audit** (`extracted.math`): crop box, original OCR text, all three readings with scores and times, alternatives and reasons.
6. **Review & Edit (branch dashboard)** shows each **source crop beside the recognised formula**, outlines the regions on the page, and offers "Use this formula in option X".
7. **Bugs fixed** (`pdf-parser.mjs`):
   - **Stray `$`:** a pen tick before "c)" was read by OCR as `$` and paired with the delimiter that the exponent conversion inserts (`“$1.8 x $10^{[[?]]}$`). OCR'd `$` now becomes the full-width `＄`, flagged as an unusual symbol.
   - **C⁻¹ → `\ce{C1}`:** Tesseract read C⁻¹ as `C1`, `rebuildLine` made the 1 a subscript, and the chemistry rule made `\ce{C1}` (similarly `\ce{J2}` from junk). `\ce{}` now needs real element symbols (at least two, or a bracket group) and no subscript 1. A unit followed by a stray 1, `'` or `!` is flagged as a probable lost negative power, never rewritten.

## Data sets

- **Benchmark:** the earlier 100 formulas (pages 3, 4, 10, 12, 17, 19, 21, 22), plus 1 marked needs-human. These pages were also the **development pages**: the region rules were fixed on them.
- **Held-out:** pages 13, 16, 18 and questions 23–25 of page 20. That's 35 questions and **140 options** (95 formula, 41 text, 4 graph).
  - Every option was transcribed **before** the prototype saw these pages, and committed as `heldout-truth.json` in commit `1fdcd24`.
  - The code was frozen (commit `89a4625`) and run **once** on them; nothing was tuned on them.
  - After that run, one bug found by the UI test on development page 12 was fixed (command names such as `\left` counted as words). The "final" column shows the effect.
- **Ground truth:** transcribed by Claude from zoomed page images. **It has NOT been checked by a teacher yet** (see *Teacher spot-check* below).

## Results

Exact = same meaning (both rendered with the portal's KaTeX 0.16.9 to MathML and compared); layout = same structure. All three systems were measured on **the same OCR run**:
- **Current:** the Tesseract text that production stores today.
- **Pix2Text alone:** the raw reading, where a region was read.
- **Pix2Text + clean-up:** what the prototype stores.

### Held-out (the result to judge the prototype by)

| | Frozen run (89a4625) | Final code |
|---|---:|---:|
| Current: exact / layout | 24/95 (25%) / 34% | same |
| Pix2Text alone: exact / layout | 54/95 (57%) / 68% | 54/95 (57%) / 68% |
| **Pix2Text + clean-up: exact / layout** | **58/95 (61%) / 69%** | **59/95 (62%) / 71%** |
| Formula-detection recall (a region was read) | 73/95 (77%) | 73/95 (77%) |
| `agreed` formulas (no extra review tick) | 39, of which **2 wrong** | 39, of which **2 wrong** |
| Wrong stored formulas that are flagged or left as Tesseract text | 34 of 37 (unflagged: the 2 below + 1 wrongly classed as "text") | 34 of 36 (unflagged: the 2 below) |
| False detections: text/graph options sent to the helper | 3 of 45 | 3 of 45 |
| Text/graph options replaced (meaning changed) | 2, **both flagged** | 2, both flagged |
| Questions the segmenter lost (not Math OCR) | 1 (p.16 Q9) | 1 |

**The 2 unflagged errors** (all three readings agreed, all symbols confident, still wrong):
- `p13 Q23 A`: printed v ∝ x^{1/2}, stored `v \propto x_{1}^{\frac{1}{2}}` (an invented subscript).
- `p16 Q16 D`: printed λ/(πε₀R) N/C, stored `\frac{\cdots}{\pi\varepsilon_0 R} N/C` (the numerator was lost).

**So "agreed" does not mean correct.** Every formula must still be compared with its crop before verification. The prototype makes that a quick visual check, not retyping.

### Benchmark (development pages, final code)

| | Exact | Layout |
|---|---:|---:|
| Current (Tesseract) | 0/100 (0%) | 12% |
| Pix2Text alone | 37/100 (37%) | 54% |
| **Pix2Text + clean-up** | **46/100 (46%)** | **60%** |
| Options only: Pix2Text + clean-up | 46/89 (52%) | |
| Formula-detection recall | 68/100 (68%); options 68/89 (76%) | |
| Unflagged wrong formulas | 0 (these rules were developed on these pages) | |

The earlier lab measured **92%** on the same formulas with **hand-cut** crops. The gap to 46% comes almost entirely from **finding** the formula on the page:
- **26 options "not located":** the option letter was unreadable or the row was merged.
- **6 "not sent":** options of questions the text parser merged into others.
- **11 formulas inside question text:** shown as suggestions only.

Better recognition will not close that gap. Better question/option segmentation will.

### Time and review workload (this PC: i5-1135G7, 8 GB)

- **OCR:** about 50 s per page (unchanged).
- **Math OCR:** about 40–50 s per page, about 2.1 s per formula (three readings).
- **Whole chapter:** a 28-page chapter adds roughly 20–25 minutes.
- **Helper memory:** 160 MB working set, peak 230 MB.
- **Held-out review workload:** 44 questions, 76 formula readings.
  - 39 agreed: compare with the crop, no warning to tick.
  - 43 flagged in 21 questions: warning to tick, compare and correct.
  - 22 formula options not read: they keep today's behaviour (retype from the page).

  Today all 95 formula options need checking, and most need retyping. 24 of them are already right in the Tesseract text.

### Full local flow (`ui_mathocr.mjs`): 18/18 passed

Steps: scanned 2-page PDF uploaded through the branch dashboard → Tesseract → segmentation → helper → 16 items. Checks:
- **Stored record:** every reading keeps its original text, box and readings; each applied formula sits in its own option; every uncertain formula carries a warning.
- **Review panel:** shows every source crop beside its rendered formula, with unrenderable readings shown raw and marked; "Use this formula" works.
- **Correction and save:** the reviewer's correction saves byte-identically, and the Math OCR record survives the save.
- **Reopen:** the reopened editor matches.
- **Student preview:** shows a real fraction, with no KaTeX error and no page errors.

### Installation, offline use, licensing (requirement 13)

- **Clean install** with `install.bat` on this PC: fresh venv, model downloaded from Hugging Face with SHA-256 verification, self-test `ALL CHECKS PASSED`.
- **Offline:** `offline_check.py` blocks every non-local connection, then recognises a formula over HTTP: passed, with no connection attempts.
- **Licences:** model MIT, Pix2Text code MIT, onnxruntime MIT, tokenizers Apache-2.0, NumPy BSD-3, Pillow MIT-CMU. No paid service.
- **Not yet verified:** that the **actual office PC** runs it reliably. Run `selftest.py` there and one test import. This PC (8 GB RAM) had only 0.5–0.6 GB free during the tests because Docker and the browsers were running; the helper still worked.

## Teacher spot-check (requirement 11): PENDING

`spotcheck.html` was generated locally (not committed: it holds book page crops).
- **Contents:** 241 rows, every benchmark formula and every held-out option, each with its source crop, the expected formula and the prototype's output.
- **How it's used:** the teacher marks "ground truth correct?" and "prototype correct?" per row and exports a CSV.
- **Status:** no teacher has checked it yet, so all numbers above rest on an AI transcription.

## Remaining limitations

1. **Lost option letters.** When Tesseract loses an option letter entirely, or a question's rows are merged into another question, the formula is not read: 23% of held-out formulas. Fixing this needs better question/option segmentation, not a better formula model.
2. **Question text.** Formulas inside the question text are only suggested beside their crop; the stem is never rewritten.
3. **Confident misreads.** About 5% of `agreed` formulas were wrong on the held-out pages: look-alike letters (q/g, e/c), invented sub- or superscripts, lost numerators. Reviewers must compare every formula with its crop.
4. **Multi-line and diagram-adjacent rows.** Rows running into diagram labels produce `uncertain` or `failed` readings, and occasionally a wrong option region (an added option landing on the next row). These are always flagged.
5. **Live-site connection untested.** Calls from the **live https site** to `127.0.0.1` depend on Chrome's local-network permission. The helper answers the private-network preflight, but this was only tested from a local `http://127.0.0.1` copy of the dashboard.
6. **Speed.** About 2 s per formula on this PC; a full chapter adds about 20–25 minutes.
7. **Small held-out set.** 95 formulas from one book. Results on other books, scans or phone photos are unknown.
8. **Answer key and answers.** The answer key and answers are untouched; the segmentation losses (e.g. the 297 vs 303 RCC count) are unchanged by this prototype.
