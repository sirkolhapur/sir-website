# Self-test for the office PC: checks Python, memory, the model files, that
# a formula image is read correctly, how fast this PC is — and, with
# --server, that the running helper answers on 127.0.0.1.
#   python selftest.py            python selftest.py --server
import json
import os
import platform
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def fraction_image():
    """A clean '1 over 2' fraction drawn with a system font (no book content)."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGB", (120, 140), "white")
    d = ImageDraw.Draw(im)
    font = None
    for f in ("C:/Windows/Fonts/times.ttf", "C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Times.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"):
        if os.path.exists(f):
            font = ImageFont.truetype(f, 48)
            break
    font = font or ImageFont.load_default()
    d.text((45, 8), "1", fill="black", font=font)
    d.line((25, 70, 95, 70), fill="black", width=3)
    d.text((45, 76), "2", fill="black", font=font)
    # Cut tight around the ink, as the portal cuts formula regions.
    from PIL import ImageOps
    box = ImageOps.invert(im.convert("L")).getbbox()
    return im.crop((box[0] - 6, box[1] - 6, box[2] + 6, box[3] + 6))


def main():
    ok = True
    print(f"Python {platform.python_version()} {platform.architecture()[0]} on {platform.system()} {platform.release()} ({platform.machine()})")
    if sys.version_info < (3, 10):
        print("FAIL  Python 3.10 or newer is needed"); ok = False
    try:
        import ctypes
        class M(ctypes.Structure):
            _fields_ = [("l", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong), ("avail", ctypes.c_ulonglong)] + [("x%d" % i, ctypes.c_ulonglong) for i in range(5)]
        m = M(); m.l = ctypes.sizeof(M)
        if hasattr(ctypes, "windll") and ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
            print(f"RAM {m.total / 2**30:.1f} GB total, {m.avail / 2**30:.1f} GB free; CPU threads {os.cpu_count()}")
            if m.avail < 1.0 * 2**30:
                print("WARN  less than 1 GB free memory - close other programs before importing")
    except Exception:
        pass
    if "--server" in sys.argv:
        try:
            h = json.load(urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=5))
            print(f"PASS  helper running: version {h['version']}, model {h['model']}")
        except Exception as e:
            print(f"FAIL  helper not reachable on 127.0.0.1:8765 ({e}) - start it with start_helper.bat"); ok = False
        return ok
    from mathocr.recognizer import FormulaRecognizer
    model = os.path.join(HERE, "model")
    t = time.time()
    try:
        rec = FormulaRecognizer(model)
    except Exception as e:
        print(f"FAIL  model did not load from {model}: {e}"); return False
    print(f"PASS  model loaded in {time.time() - t:.1f}s")
    reads = rec.read3(fraction_image())
    got = [r["latex"].replace(" ", "") for r in reads]
    if got[0] == "\\frac{1}{2}":
        print(f"PASS  test fraction read as \\frac{{1}}{{2}} ({sum(r['ms'] for r in reads)} ms for 3 readings)")
        if len(set(got)) > 1:
            print(f"INFO  the two extra readings differ ({got[1:]}) - in the portal such a formula is flagged for the reviewer")
    else:
        print(f"FAIL  test fraction read as {got[0]}"); ok = False
    print(f"Speed: about {sum(r['ms'] for r in reads) / 1000:.1f} s per formula (3 readings). A 28-page chapter with ~300 formula options takes roughly {sum(r['ms'] for r in reads) * 300 / 60000:.0f} min.")
    return ok


if __name__ == "__main__":
    good = main()
    print("ALL CHECKS PASSED" if good else "SOME CHECKS FAILED")
    sys.exit(0 if good else 1)
