# Is the helper's direct-ONNX recogniser identical to pix2text's LatexOCR?
# Compares all three read variants on the 101 crops with the lab outputs.
import json, os, sys, time
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "repo", "tools", "mathocr"))
from mathocr.recognizer import FormulaRecognizer

rec = FormulaRecognizer(os.path.join(os.environ["APPDATA"], "pix2text", "1.1", "mfr-1.5-onnx"))
lab = [json.load(open(os.path.join(HERE, f), encoding="utf-8")) for f in ("out_mfr.json", "out_mfr_pad.json", "out_mfr_x15.json")]
same = [0, 0, 0]; dmin = 0.0; n = 0; t = time.time(); diffs = []
out = {}
for i in lab[0]:
    r3 = rec.read3(Image.open(os.path.join(HERE, "crops", i + ".png")))
    out[i] = r3
    n += 1
    for k in range(3):
        if r3[k]["latex"] == lab[k][i]["tex"]: same[k] += 1
        else: diffs.append((i, k, lab[k][i]["tex"], r3[k]["latex"]))
    dmin = max(dmin, abs(r3[0]["min"] - lab[0][i]["min"]))
print("identical LaTeX:", same, "of", n, "| max |min-prob difference| (read 1):", round(dmin, 4), "| total", round(time.time() - t), "s")
for d in diffs[:10]: print("DIFF", d)
json.dump(out, open(os.path.join(HERE, "out_helper.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
