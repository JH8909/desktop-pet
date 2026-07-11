#!/usr/bin/env python3
"""Extract MOV clips to transparent PNG sequences (black-key alpha; qtrle alpha is empty)."""
import os
import shutil
import subprocess
import tempfile
from importlib.util import module_from_spec, spec_from_file_location

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE_DIR = os.path.join(ROOT, "assets", "video")
OUT_ROOT = os.path.join(SOURCE_DIR, "png_sequences")
WORK = tempfile.mkdtemp(prefix="fm_pngseq_")

_spec = spec_from_file_location("pv", os.path.join(os.path.dirname(__file__), "process-video.py"))
_pv = module_from_spec(_spec)
_spec.loader.exec_module(_pv)
make_alpha_rgba = _pv.make_alpha_rgba

FPS = 24.0
SOURCES = [
    "Idle-1.mov",
    "Silly Face-2.mov",
    "Wave-3.mov",
    "Dizzy Loop-4.mov",
    "Sleep-5.mov",
]


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def imwrite(path, image):
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise SystemExit(f"imencode failed: {path}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(buf.tobytes())


def imread(path):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit(f"imdecode failed: {path}")
    return img


def main():
    print("work", WORK, flush=True)
    os.makedirs(OUT_ROOT, exist_ok=True)

    for name in SOURCES:
        src = os.path.join(SOURCE_DIR, name)
        if not os.path.isfile(src):
            print("SKIP missing", src, flush=True)
            continue

        clip = os.path.splitext(name)[0].replace(" ", "_")
        raw_dir = os.path.join(WORK, "raw", clip)
        out_dir = os.path.join(OUT_ROOT, clip)
        if os.path.isdir(out_dir):
            shutil.rmtree(out_dir)
        os.makedirs(raw_dir, exist_ok=True)
        os.makedirs(out_dir, exist_ok=True)

        print(f"\n=== {name} -> {out_dir} ===", flush=True)
        pattern = os.path.join(raw_dir, "src_%04d.png")
        run(["ffmpeg", "-y", "-i", src, "-vf", f"fps={FPS}", pattern])

        frames = sorted(n for n in os.listdir(raw_dir) if n.startswith("src_") and n.endswith(".png"))
        for i, fname in enumerate(frames, 1):
            bgr = imread(os.path.join(raw_dir, fname))
            if bgr.ndim == 3 and bgr.shape[2] == 4:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
            rgba = make_alpha_rgba(bgr)
            bgra = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
            imwrite(os.path.join(out_dir, f"frame_{i:04d}.png"), bgra)

        first = imread(os.path.join(out_dir, "frame_0001.png"))
        print(
            f"  wrote {len(frames)} PNGs, alpha TL={int(first[0,0,3])} center={int(first[first.shape[0]//2, first.shape[1]//2, 3])}",
            flush=True,
        )

    print("\nDONE ->", OUT_ROOT, flush=True)
    for d in sorted(os.listdir(OUT_ROOT)):
        p = os.path.join(OUT_ROOT, d)
        if os.path.isdir(p):
            n = len([x for x in os.listdir(p) if x.endswith(".png")])
            print(f"  {d}: {n} frames", flush=True)


if __name__ == "__main__":
    main()
