# =====================================================================
# SIR Math OCR helper — local HTTP service for the coordinator portal
#
#   python server.py [--port 8765] [--model model] [--origin URL ...]
#
# Listens on 127.0.0.1 only (never on the network). The portal page sends
# cropped formula images; nothing else leaves the browser and nothing at
# all leaves this PC. No internet connection is used after installation.
#
#   GET  /health     → {ok, model, version}
#   POST /recognize  ← {"crops": [{"id": "...", "png": "<base64>"}]}
#                    → {"results": [{"id", "reads": [3 × {latex, min, mean, ms, truncated}]}], "ms"}
#
# Only pages served from the allowed origins may call it (CORS); a request
# from any other website is refused by the browser before it is sent.
# =====================================================================
import argparse
import base64
import hashlib
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mathocr.recognizer import FormulaRecognizer  # noqa: E402

VERSION = "2026-10-29.proto1"
ORIGINS = {"https://sir.net.in", "https://www.sir.net.in", "http://127.0.0.1:8766", "http://localhost:8766"}
MAX_BODY = 25 * 1024 * 1024
MAX_CROPS = 64
MAX_SIDE = 4000
Image.MAX_IMAGE_PIXELS = 40_000_000

state = {"rec": None, "lock": threading.Lock(), "model": None}


def model_id(model_dir):
    h = hashlib.sha256()
    with open(os.path.join(model_dir, "decoder_model.onnx"), "rb") as f:
        h.update(f.read(1 << 20))
    return "pix2text-mfr-1.5-onnx/" + h.hexdigest()[:12]


class Handler(BaseHTTPRequestHandler):
    server_version = "SIRMathOCR/" + VERSION

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome: a public https page may call this local service only
            # when the preflight answers this header.
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204 if self.headers.get("Origin") in ORIGINS else 403)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "version": VERSION, "model": state["model"]})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/recognize":
            return self._json(404, {"error": "not found"})
        if self.headers.get("Origin") not in ORIGINS and self.headers.get("Origin") is not None:
            return self._json(403, {"error": "origin not allowed"})
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self._json(415, {"error": "send application/json"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._json(413, {"error": "request too large"})
        try:
            crops = json.loads(self.rfile.read(n))["crops"]
            assert isinstance(crops, list) and 0 < len(crops) <= MAX_CROPS
        except Exception:
            return self._json(400, {"error": f"expected {{crops: [...]}} with 1–{MAX_CROPS} items"})
        t0 = time.time()
        out = []
        for c in crops:
            try:
                img = Image.open(io.BytesIO(base64.b64decode(c["png"])))
                img.load()
                if max(img.size) > MAX_SIDE or min(img.size) < 4:
                    raise ValueError("bad image size")
                with state["lock"]:
                    reads = state["rec"].read3(img)
                out.append({"id": c.get("id"), "reads": reads})
            except Exception as e:  # one bad crop never fails the batch
                out.append({"id": c.get("id"), "error": str(e)[:200]})
        self._json(200, {"results": out, "ms": round((time.time() - t0) * 1000)})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


def main():
    ap = argparse.ArgumentParser(description="SIR Math OCR helper (local only)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--model", default=os.path.join(HERE, "model"))
    ap.add_argument("--origin", action="append", default=[], help="extra allowed page origin")
    ap.add_argument("--threads", type=int, default=None)
    a = ap.parse_args()
    ORIGINS.update(a.origin)
    if not os.path.exists(os.path.join(a.model, "encoder_model.onnx")):
        sys.exit(f"Model files not found in {a.model}. Run: python get_model.py")
    t = time.time()
    state["rec"] = FormulaRecognizer(a.model, threads=a.threads)
    state["model"] = model_id(a.model)
    print(f"SIR Math OCR helper {VERSION} - model {state['model']} loaded in {time.time() - t:.1f}s")
    print(f"Listening on http://127.0.0.1:{a.port}  (allowed pages: {', '.join(sorted(ORIGINS))})")
    print("Keep this window open while importing PDFs. Close it to stop.")
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
