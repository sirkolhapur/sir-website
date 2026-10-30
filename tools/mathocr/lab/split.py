# split.py: coordinate-aware layout for approach A2. For each crop, find a
# top-level fraction bar (longest thin horizontal ink run >= 45% of the crop
# width with ink above and below it) and cut numerator / denominator / left /
# right parts. Writes parts/<id>_<part>.png (padded white) + parts.json.
import json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ids = list(json.load(open(os.path.join(HERE, "truth.json"), encoding="utf-8"))["items"].keys())
os.makedirs(os.path.join(HERE, "parts"), exist_ok=True)

def longest_run(row):
    best = cur = 0; be = 0
    for x, v in enumerate(row):
        cur = cur + 1 if v else 0
        if cur > best: best, be = cur, x
    return best, be - best + 1, be

def save(im, name):
    w, h = im.size
    pad = Image.new("L", (w + 40, h + 40), 255); pad.paste(im, (20, 20))
    pad.save(os.path.join(HERE, "parts", name + ".png"))
    return name

man = {}
for i in ids:
    im = Image.open(os.path.join(HERE, "crops", i + ".png")).convert("L")
    a = np.array(im) < 140
    H, W = a.shape
    runs = [longest_run(a[y]) for y in range(H)]
    y = max(range(H), key=lambda r: runs[r][0])
    L, x0, x1 = runs[y]
    bar = None
    if L >= 0.45 * W:
        ys = [r for r in range(max(0, y - 8), min(H, y + 9)) if runs[r][0] >= 0.8 * L]
        top, bot = min(ys), max(ys)
        above = a[:top, x0:x1 + 1].sum() > 20
        below = a[bot + 1:, x0:x1 + 1].sum() > 20
        if above and below and bot - top <= 8:
            bar = (top, bot, x0, x1)
    if not bar:
        man[i] = {"whole": save(im, i + "_whole")}
        continue
    top, bot, x0, x1 = bar
    parts = {"num": save(im.crop((x0, 0, x1 + 1, top - 1)), i + "_num"),
             "den": save(im.crop((x0, bot + 2, x1 + 1, H)), i + "_den")}
    if a[:, :max(0, x0 - 4)].sum() > 30: parts["left"] = save(im.crop((0, 0, max(1, x0 - 4), H)), i + "_left")
    if a[:, min(W, x1 + 5):].sum() > 30: parts["right"] = save(im.crop((min(W - 1, x1 + 5), 0, W, H)), i + "_right")
    man[i] = parts
json.dump(man, open(os.path.join(HERE, "parts.json"), "w"), indent=1)
print(sum(1 for v in man.values() if "num" in v), "fractions split of", len(man))
