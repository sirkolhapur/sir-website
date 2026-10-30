# SIR Math OCR helper (prototype)

A small program that runs **on the office PC** while a coordinator imports a scanned PDF in the Test & Assessment Coordinator portal. It reads formula options (fractions, roots, powers, Greek letters, vectors, scientific notation) from the page image and returns LaTeX.

- **Tesseract stays in charge** of ordinary text and page layout.
- **Formula regions come from the question's own option markers** (a) … d)) found by the portal; there is no general formula finder.
- **Every reading keeps its source crop and the original OCR text.** Uncertain readings are flagged for the reviewer.

> **Status: prototype on branch `mathocr-prototype`. Not merged, not deployed.** The live portal does not call this helper. To try it, run the branch copy of the dashboard locally (see *Trying it with the portal* below).

## Privacy and network

- **Listens on `127.0.0.1` only.** Other computers cannot reach it.
- **Only the crops travel.** The portal page sends cropped formula images from the coordinator's own browser to the helper on the same PC. Nothing is sent anywhere else.
- **Internet is used once**, by `get_model.py` to download the model (115 MB). After that the helper works fully offline. `offline_check.py` proves this by blocking every outgoing connection and then reading a formula.
- **Only these pages may call it:** `https://sir.net.in`, `https://www.sir.net.in` and the local test copy (`http://127.0.0.1:8766`). The browser refuses calls from any other website.

## Hardware

| | Minimum | Measured on the test PC |
|---|---|---|
| CPU | 64-bit, 2 cores (no GPU needed) | Intel Core i5-1135G7, 8 threads |
| RAM | 4 GB total, about 1 GB free while importing | 7.7 GB total |
| Disk | about 300 MB (Python packages 171 MB + model 115 MB) | |
| OS | Windows 10/11 64-bit (macOS/Linux also work with `python3`) | Windows 11 |
| Python | 3.10 – 3.13, 64-bit | 3.13.13 |

Speed on the test PC:
- **Per formula:** 0.3 – 2 s for the three readings. A long, multi-line crop can take up to about 10 s.
- **Model load:** about 2 s at start-up.

Whether the actual office PC is fast enough has **not** been tested yet. Run `selftest.py` there; it prints that PC's speed.

## Install (once, needs internet)

1. Install Python 3.10–3.13 (64-bit) from https://www.python.org/downloads/. Tick **"Add python.exe to PATH"**.
2. Copy this `tools/mathocr` folder to the office PC, for example `C:\SIR\mathocr`.
3. Double-click **`install.bat`**. It:
   - creates `.venv` with the four packages in `requirements.txt`;
   - downloads the model into `model\`, checking every file's SHA-256;
   - runs `selftest.py`.

   The last line must be **`ALL CHECKS PASSED`**.

**No internet on the office PC?** Run `install.bat` on another PC, then copy the whole folder, including `.venv` and `model`. Or copy only the four model files and run `python get_model.py --from <folder>`, which also checks them.

## Run (every import session)

- **Start:** double-click **`start_helper.bat`** and keep its window open while importing PDFs. It shows `Listening on http://127.0.0.1:8765`.
- **Check it's running:** `python selftest.py --server`.
- **Stop:** close the window.

If the helper is not running, the portal imports exactly as before. Formulas are left as Tesseract read them, and the upload log says so.

## Trying it with the portal (prototype)

The branch's dashboard (`test-coordinator/` on `mathocr-prototype`) calls the helper after OCR and segmentation. Each import item then carries:

- **`extracted.math`:** one entry per formula region. Each holds the page, the crop box (pixels and thousandths), the original OCR text, the three readings with their scores and times, the chosen LaTeX, its status and the reasons.
- **Status values:**
  - `agreed`: the three readings mean the same thing and every symbol is confident.
  - `uncertain`: the readings disagree, a symbol is unsure, the crop holds more than one line or option, or the options had to be recovered from the page. The formula is put into the option **and** the item gets a review warning.
  - `failed`, `text`, `not_located`: the Tesseract text is kept, and a warning is added where needed.
- **Review & Edit:** shows each source crop beside the recognised formula, with "Use this formula in option X".
- **Where results go:** a reading only ever replaces the text of **the same option of the same question**. No question is dropped and no option is moved.

## Files

| File | Purpose |
|---|---|
| `server.py` | the local HTTP service (`/health`, `/recognize`) |
| `mathocr/recognizer.py` | Pix2Text MFR 1.5 run with onnxruntime (no PyTorch); three readings per crop |
| `mathocr/postprocess.py` | Pix2Text's own LaTeX post-processing, copied unchanged (MIT) |
| `get_model.py` | model download or copy with SHA-256 checks (pinned revision) |
| `selftest.py` | checks Python, memory, the model, a test fraction and speed; `--server` checks the running helper |
| `offline_check.py` | proves no network access is needed |
| `install.bat`, `start_helper.bat` | Windows one-click install and start |
| `lab/` | benchmark and held-out ground truth used to measure the prototype |

## Licences

| Component | Licence | Use |
|---|---|---|
| Pix2Text MFR 1.5 model (`breezedeus/pix2text-mfr-1.5`) | MIT (stated in `model/README.md`) | formula recognition |
| Pix2Text post-processing code (vendored) | MIT, © Breezedeus | `mathocr/postprocess.py` |
| onnxruntime | MIT | runs the model |
| tokenizers (Hugging Face) | Apache-2.0 | decodes model tokens |
| NumPy | BSD-3-Clause | arrays |
| Pillow | MIT-CMU (HPND) | images |
| Tesseract.js / Tesseract (already in the portal) | Apache-2.0 | text OCR |

All of them allow free use, including commercial use, with the licence notice kept. No paid service is used.

## Known limitations

See the evaluation report in the PR description. In short:
- A wrong option-marker reading can leave an option "not located"; it then keeps the Tesseract text plus a warning.
- Formulas inside the question text are only **suggested** next to their crop; the stem is not rewritten.
- The model sometimes confuses look-alike letters (q/g, e/c, a/q, ε₀/ε∘), sometimes confidently. Three-way agreement catches most of these but not all, so a reviewer must still compare each formula with its crop before verifying.
- The browser–helper connection from the **live https site** depends on Chrome's local-network rules. It was tested only from a local copy (`http://127.0.0.1`), and must be tested on the office PC before any production use.
