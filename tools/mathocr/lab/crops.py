# Cut benchmark crops from the 3300px page renders. Boxes are given in the
# 1100px "view" coordinates (x3 = full resolution). Writes crops/<id>.png and
# contact sheets sheets/sheetN.png (crop + id) for visual checking.
import json, sys, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(os.path.join(HERE, "boxes.json"), encoding="utf-8"))
os.makedirs(os.path.join(HERE, "crops"), exist_ok=True)
os.makedirs(os.path.join(HERE, "sheets"), exist_ok=True)
pages = {}
tiles = []
for e in spec:
    p = e["page"]
    if p not in pages:
        pages[p] = Image.open(os.path.join(HERE, "hi", "p%02d.png" % p)).convert("RGB")
    x0, y0, x1, y1 = e["box"]
    c = pages[p].crop((x0, y0, x1, y1))
    c.save(os.path.join(HERE, "crops", e["id"] + ".png"))
    tiles.append((e["id"], c))

only = set(sys.argv[1:])
if only:
    tiles = [t for t in tiles if any(t[0].startswith(o) for o in only)]
# sheets: 2 columns, each tile scaled to height <= 150
per = 12
for s in range(0, len(tiles), per):
    group = tiles[s:s + per]
    cells = []
    for tid, c in group:
        sc = min(1.0, 150 / c.height, 560 / c.width)
        cells.append((tid, c.resize((max(1, int(c.width * sc)), max(1, int(c.height * sc))))))
    rows = [cells[i:i + 2] for i in range(0, len(cells), 2)]
    H = sum(max(c.height for _, c in r) + 30 for r in rows)
    sheet = Image.new("RGB", (1200, H), "white")
    d = ImageDraw.Draw(sheet)
    y = 0
    for r in rows:
        for k, (tid, c) in enumerate(r):
            d.text((k * 600 + 5, y + 2), tid, fill=(200, 0, 0))
            sheet.paste(c, (k * 600 + 5, y + 18))
            d.rectangle((k * 600 + 4, y + 17, k * 600 + 6 + c.width, y + 19 + c.height), outline=(0, 120, 255))
        y += max(c.height for _, c in r) + 30
    sheet.save(os.path.join(HERE, "sheets", "sheet%d.png" % (s // per + 1)))
print(len(spec), "crops")
