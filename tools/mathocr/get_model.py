# Download (once) the formula model the Math OCR Lab measured, into ./model.
#   python get_model.py                 — download from Hugging Face
#   python get_model.py --from FOLDER   — copy from a folder / USB stick
# Every file is checked against its SHA-256, so the office PC runs exactly
# the measured model. After this step the helper never uses the internet.
import argparse
import hashlib
import os
import shutil
import sys
import urllib.request

REPO = "breezedeus/pix2text-mfr-1.5"            # MIT licence (see model/README.md)
REVISION = "1cef9f0bdcd6a4c63df7de1311fb0894593340cc"
FILES = {
    "encoder_model.onnx": "080a3f660f08bc9ebcacdd96e34be6b6400f8c7e62d7cd0dd8251badc37f610b",
    "decoder_model.onnx": "917deb98e91a0453c5f234f58a0f32f9fb037de8527c7eb4ed394daf9e692f2a",
    "tokenizer.json": "4ffbeb2143e6a38324bb6111b7a8109530d38a076a8439aa5777535f0a32758a",
    "README.md": "7ae7136c49c64378ff09a86b750ef9c2007ad8e91e148be391e3480bfd9dce97",
}
HERE = os.path.dirname(os.path.abspath(__file__))


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="copy the files from this folder instead of downloading")
    ap.add_argument("--dest", default=os.path.join(HERE, "model"))
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)
    for name, want in FILES.items():
        dst = os.path.join(a.dest, name)
        if os.path.exists(dst) and sha(dst) == want:
            print(f"ok       {name}")
            continue
        tmp = dst + ".part"
        if a.src:
            shutil.copyfile(os.path.join(a.src, name), tmp)
        else:
            url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
            print(f"download {name} ...", flush=True)
            urllib.request.urlretrieve(url, tmp)
        got = sha(tmp)
        if got != want:
            os.remove(tmp)
            sys.exit(f"{name}: checksum mismatch ({got[:12]}... expected {want[:12]}...) - not installed")
        os.replace(tmp, dst)
        print(f"verified {name}")
    print(f"Model ready in {a.dest}")


if __name__ == "__main__":
    main()
