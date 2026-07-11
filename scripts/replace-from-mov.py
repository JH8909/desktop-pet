#!/usr/bin/env python3
"""Replace WebMs from MOV sources. qtrle alpha is not readable by ffmpeg, so use black-key matte on RGB."""
import json
import os
import shutil
import subprocess
import tempfile
from importlib.util import module_from_spec, spec_from_file_location

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE_DIR = os.path.join(ROOT, "assets", "video")
OUT_DIR = os.path.join(ROOT, "assets", "videos")
WORK = tempfile.mkdtemp(prefix="filemonster_mov_matte_")

_spec = spec_from_file_location("pv", os.path.join(os.path.dirname(__file__), "process-video.py"))
_pv = module_from_spec(_spec)
_spec.loader.exec_module(_pv)
make_alpha_rgba = _pv.make_alpha_rgba
find_subject_bounds = _pv.find_subject_bounds
place_on_square_canvas = _pv.place_on_square_canvas

WIDTH = 512
FPS = 24.0

SOURCE_MAP = {
    "Idle-1.mov": ["idle"],
    "Silly Face-2.mov": ["thinking", "hover", "notify"],
    "Wave-3.mov": ["success", "wake", "scan"],
    "Dizzy Loop-4.mov": ["drag", "work", "error", "ingest"],
    "Sleep-5.mov": ["sleep"],
}
LOOP_ACTIONS = {"idle", "drag", "work", "scan", "sleep"}


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def imwrite(path, image):
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise SystemExit(f"imencode failed: {path}")
    with open(path, "wb") as f:
        f.write(buf.tobytes())


def imread(path):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit(f"imdecode failed: {path}")
    return img


def extract_frames(mov_path, frames_dir):
    if os.path.isdir(frames_dir):
        shutil.rmtree(frames_dir)
    os.makedirs(frames_dir, exist_ok=True)
    pattern = os.path.join(frames_dir, "src_%04d.png")
    run([
        "ffmpeg", "-y", "-i", mov_path,
        "-vf", f"fps={FPS}",
        pattern,
    ])
    names = sorted(n for n in os.listdir(frames_dir) if n.startswith("src_") and n.endswith(".png"))
    print(f"  extracted {len(names)} frames", flush=True)
    return [os.path.join(frames_dir, n) for n in names]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("work dir", WORK, flush=True)

    extracted = {}
    for source_name in SOURCE_MAP:
        path = os.path.join(SOURCE_DIR, source_name)
        if not os.path.isfile(path):
            print("SKIP", path, flush=True)
            continue
        print(f"\nExtracting {source_name}...", flush=True)
        clip = os.path.splitext(source_name)[0].replace(" ", "_")
        extracted[source_name] = extract_frames(path, os.path.join(WORK, "src", clip))

    print("\nComputing shared bounds...", flush=True)
    samples = []
    for paths in extracted.values():
        stride = max(1, len(paths) // 25)
        for i, p in enumerate(paths):
            if i % stride != 0:
                continue
            bgr = imread(p)
            if bgr.shape[2] == 4:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
            samples.append(make_alpha_rgba(bgr)[:, :, 3])
    bounds = find_subject_bounds(samples)
    print("shared bounds", bounds, flush=True)

    segments = {}
    idle_out = None
    for source_name, actions in SOURCE_MAP.items():
        if source_name not in extracted:
            continue
        print(f"\n=== {source_name} -> {actions} ===", flush=True)
        clip = os.path.splitext(source_name)[0].replace(" ", "_")
        out_frames = os.path.join(WORK, "out", clip)
        os.makedirs(out_frames, exist_ok=True)

        paths = extracted[source_name]
        for i, p in enumerate(paths, 1):
            bgr = imread(p)
            if bgr.shape[2] == 4:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
            rgba = make_alpha_rgba(bgr)
            canvas = place_on_square_canvas(rgba, bounds, WIDTH)
            bgra = cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA)
            imwrite(os.path.join(out_frames, f"frame_{i:04d}.png"), bgra)

        first = imread(os.path.join(out_frames, "frame_0001.png"))
        print(
            f"  frames={len(paths)} alpha TL={int(first[0,0,3])} center={int(first[WIDTH//2,WIDTH//2,3])}",
            flush=True,
        )
        if source_name.startswith("Idle"):
            idle_out = out_frames

        pattern = os.path.join(out_frames, "frame_%04d.png")
        for action in actions:
            temp_out = os.path.join(WORK, f"{action}.webm")
            final_out = os.path.join(OUT_DIR, f"filemonster_{action}.webm")
            run([
                "ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern,
                "-frames:v", str(len(paths)),
                "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                "-auto-alt-ref", "0", "-b:v", "2M", temp_out,
            ])
            shutil.copy2(temp_out, final_out)
            print(f"  -> {final_out} ({os.path.getsize(final_out)} bytes)", flush=True)
            segments[action] = {
                "file": f"filemonster_{action}.webm",
                "frames": len(paths),
                "loop": action in LOOP_ACTIONS,
                "label": action,
            }

    if idle_out:
        poster_src = os.path.join(idle_out, "frame_0001.png")
        img = imread(poster_src)
        ok, buf = cv2.imencode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, 100])
        if ok:
            poster = os.path.join(OUT_DIR, "filemonster_poster.webp")
            with open(poster, "wb") as f:
                f.write(buf.tobytes())
            print("poster", poster, flush=True)

    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                old = json.load(f)
            magic = os.path.join(OUT_DIR, "filemonster_magic.webm")
            if "magic" in old.get("segments", {}) and os.path.isfile(magic):
                segments["magic"] = old["segments"]["magic"]
        except Exception:
            pass

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"fps": FPS, "size": [WIDTH, WIDTH], "segments": segments}, f, ensure_ascii=False, indent=2)
    print("manifest", manifest_path, flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
