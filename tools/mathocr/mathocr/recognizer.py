# =====================================================================
# SIR Math OCR helper — formula image → LaTeX (Pix2Text MFR 1.5, ONNX)
#
# Runs the model directly with onnxruntime: no PyTorch, no network. The
# pre-processing (resize 384×384 bicubic, scale to [-1, 1]) and greedy
# decoding reproduce pix2text 1.1.7's LatexOCR exactly; the lab checked
# the outputs are identical on the 101 RCC benchmark crops.
#
# read3() reads the same crop three ways (as cut, padded, enlarged 1.5×).
# The caller compares the three readings: if they disagree, or one token
# was read with low probability, the formula is flagged for the reviewer.
# =====================================================================
import os
import time

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps
from tokenizers import Tokenizer

from .postprocess import post_process

BOS, EOS = 1, 2
SIZE = 384
MAX_TOKENS = 160  # longer = a runaway, repeating read (the longest RCC option formula is ~80 tokens)


class FormulaRecognizer:
    def __init__(self, model_dir, threads=None):
        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        prov = ["CPUExecutionProvider"]
        self.encoder = ort.InferenceSession(os.path.join(model_dir, "encoder_model.onnx"), opts, providers=prov)
        self.decoder = ort.InferenceSession(os.path.join(model_dir, "decoder_model.onnx"), opts, providers=prov)
        self.tokenizer = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))

    @staticmethod
    def _pixels(img):
        img = img.convert("RGB").resize((SIZE, SIZE), Image.BICUBIC)
        a = np.asarray(img, dtype=np.float32) / 255.0
        a = (a - 0.5) / 0.5
        return a.transpose(2, 0, 1)[None]

    def read(self, img):
        """One reading: {latex, min, mean, ms}. min/mean = probability of the
        chosen token at each step (the least sure token matters most)."""
        t0 = time.time()
        hidden = self.encoder.run(None, {"pixel_values": self._pixels(img)})[0]
        ids, probs, done = [BOS], [], False
        for _ in range(MAX_TOKENS):
            logits = self.decoder.run(None, {"input_ids": np.array([ids], dtype=np.int64), "encoder_hidden_states": hidden})[0][0, -1]
            e = np.exp(logits - logits.max())
            p = e / e.sum()
            nxt = int(p.argmax())
            probs.append(float(p[nxt]))
            if nxt == EOS:
                done = True
                break
            ids.append(nxt)
        text = post_process(self.tokenizer.decode(ids[1:], skip_special_tokens=True))
        # pix2text's score: geometric mean over the generated tokens incl. </s>.
        mean = float(np.exp(np.mean(np.log(np.array(probs) + 1e-8)))) if probs else 0.0
        return {"latex": text, "min": round(min(probs) if probs else 0.0, 4), "mean": round(mean, 4), "ms": round((time.time() - t0) * 1000), "truncated": not done}

    def read3(self, img):
        img = img.convert("RGB")
        pad = lambda im, f: ImageOps.expand(im, border=int(max(im.size) * f), fill=(255, 255, 255))
        big = img.resize((max(1, int(img.width * 1.5)), max(1, int(img.height * 1.5))), Image.LANCZOS)
        return [self.read(img), self.read(pad(img, 0.12)), self.read(pad(big, 0.06))]
