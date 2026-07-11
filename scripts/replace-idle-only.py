#!/usr/bin/env python3
"""Process only Idle-1 into filemonster_idle.webm for path/alpha validation."""
import os
import shutil
import subprocess
import tempfile
from importlib.util import module_from_spec, spec_from_file_location

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = os.path.join(ROOT, "assets", "video", "Idle-1.mp4")
OUT = os.path.join(ROOT, "assets", "videos", "filemonster_idle.webm")
WORK = os.path.join(tempfile.gettempdir(), "filemonster_idle_only")

_spec = spec_from_file_location("pv", os.path.join(os.path.dirname(__file__), "process-video.py"))
_pv = module_from_spec(_spec)
_spec.loader.exec_module(_pv)

WIDTH = 512
FPS = 24.0


def imwrite(path, image):
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise SystemExit(f"imencode failed: {path}")
    with open(path, "wb") as f:
        f.write(buf.tobytes())


def main():
    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    frames = os.path.join(WORK, "frames")
    os.makedirs(frames, exist_ok=True)

    cap = cv2.VideoCapture(SOURCE)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {SOURCE}")

    samples = []
    all_frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        all_frames.append(frame)
        if idx % 4 == 0:
            samples.append(_pv.make_alpha_rgba(frame)[:, :, 3])
        idx += 1
    cap.release()

    bounds = _pv.find_subject_bounds(samples)
    print("frames", len(all_frames), "bounds", bounds, flush=True)

    for i, frame in enumerate(all_frames, 1):
        rgba = _pv.make_alpha_rgba(frame)
        canvas = _pv.place_on_square_canvas(rgba, bounds, WIDTH)
        bgra = cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA)
        imwrite(os.path.join(frames, f"frame_{i:04d}.png"), bgra)

    # Quick alpha sanity: corner transparent, center opaque on first canvas
    first = cv2.imdecode(np.fromfile(os.path.join(frames, "frame_0001.png"), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    print("alpha TL", int(first[0, 0, 3]), "center", int(first[WIDTH // 2, WIDTH // 2, 3]), flush=True)

    pattern = os.path.join(frames, "frame_%04d.png")
    temp_out = os.path.join(WORK, "idle.webm")
    cmd = [
        "ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern,
        "-frames:v", str(len(all_frames)),
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-b:v", "2M", temp_out,
    ]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    shutil.copy2(temp_out, OUT)
    print("wrote", OUT, "size", os.path.getsize(OUT), flush=True)


if __name__ == "__main__":
    main()
