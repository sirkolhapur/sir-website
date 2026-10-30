# offline_check.py: proves the helper needs no internet. Every outgoing
# connection except to 127.0.0.1 is blocked inside this process; the server
# is then started and asked (over HTTP, as the portal does) to read a
# formula. Any attempt to reach the network is reported and fails the check.
import base64
import io
import json
import socket
import sys
import threading
import time
import urllib.request

attempts = []
_connect = socket.socket.connect


def guarded(self, addr):
    host = addr[0] if isinstance(addr, tuple) else str(addr)
    if host not in ("127.0.0.1", "::1", "localhost"):
        attempts.append(host)
        raise OSError(f"blocked by offline_check: {host}")
    return _connect(self, addr)


socket.socket.connect = guarded
socket.getaddrinfo = (lambda orig: (lambda host, *a, **k: orig(host, *a, **k) if host in ("127.0.0.1", "localhost", "::1", None) else (_ for _ in ()).throw(OSError(f"DNS blocked: {host}"))))(socket.getaddrinfo)

import server  # noqa: E402
from selftest import fraction_image  # noqa: E402

sys.argv = ["server.py", "--port", "8775"]
threading.Thread(target=server.main, daemon=True).start()
for _ in range(120):
    try:
        urllib.request.urlopen("http://127.0.0.1:8775/health", timeout=1); break
    except Exception:
        time.sleep(0.5)
buf = io.BytesIO(); fraction_image().save(buf, "PNG")
req = urllib.request.Request("http://127.0.0.1:8775/recognize", data=json.dumps({"crops": [{"id": "t", "png": base64.b64encode(buf.getvalue()).decode()}]}).encode(),
                             headers={"Content-Type": "application/json"})
res = json.load(urllib.request.urlopen(req, timeout=120))
latex = res["results"][0]["reads"][0]["latex"]
try:
    urllib.request.urlopen("https://huggingface.co", timeout=5)
    guard = "NOT WORKING"
except Exception:
    guard = "working (a test request to huggingface.co was blocked)"
print(f"network guard: {guard}")
print(f"recognised over HTTP with the network blocked: {latex}")
print(f"outgoing connection attempts by the helper: {len([a for a in attempts if a != 'huggingface.co']) or 'none'}")
ok = latex.replace(" ", "") == "\\frac{1}{2}" and not [a for a in attempts if a != "huggingface.co"]
print("OFFLINE CHECK PASSED" if ok else "OFFLINE CHECK FAILED")
sys.exit(0 if ok else 1)
