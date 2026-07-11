#!/usr/bin/env python3
"""Replace remaining action videos from assets/video sources 2-5."""
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
WORK = os.path.join(tempfile.gettempdir(), "filemonster_replace_rest")

_spec = spec_from_file_location("pv", os.path.join(os.path.dirname(__file__), "process-video.py"))
_pv = module_from_spec(_spec)
_spec.loader.exec_module(_pv)

WIDTH = 512
FPS = 24.0

# Include idle so shared bounds stay consistent with already-replaced idle
SOURCE_MAP = {
    "Idle-1.mp4": ["idle"],
    "Silly Face-2.mp4": ["thinking", "hover", "notify"],
    "Wave-3.mp4": ["success", "wake", "scan"],
    "Dizzy Loop-4.mp4": ["drag", "work", "error", "ingest"],
    "Sleep-5.mp4": ["sleep"],
}
LOOP_ACTIONS = {"idle", "drag", "work", "scan", "sleep"}
SKIP_ENCODE = {"idle"}  # already written


def imwrite(path, image):
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise SystemExit(f"imencode failed: {path}")
    with open(path, "wb") as f:
        f.write(buf.tobytes())


def sample_bounds():
    samples = []
    for name in SOURCE_MAP:
        path = os.path.join(SOURCE_DIR, name)
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or FPS
        stride = max(1, int(round(fps / 6)))
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % stride == 0:
                samples.append(_pv.make_alpha_rgba(frame)[:, :, 3])
            idx += 1
        cap.release()
        print(f"sampled {name}: {len(samples)} cumulative", flush=True)
    bounds = _pv.find_subject_bounds(samples)
    print("shared bounds", bounds, flush=True)
    return bounds


def process_one(source_name, actions, bounds):
    source_path = os.path.join(SOURCE_DIR, source_name)
    clip = os.path.splitext(source_name)[0].replace(" ", "_")
    frames_dir = os.path.join(WORK, "frames", clip)
    if os.path.isdir(frames_dir):
        shutil.rmtree(frames_dir)
    os.makedirs(frames_dir, exist_ok=True)

    cap = cv2.VideoCapture(source_path)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()

    for i, frame in enumerate(frames, 1):
        rgba = _pv.make_alpha_rgba(frame)
        canvas = _pv.place_on_square_canvas(rgba, bounds, WIDTH)
        bgra = cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA)
        imwrite(os.path.join(frames_dir, f"frame_{i:04d}.png"), bgra)

    first = cv2.imdecode(
        np.fromfile(os.path.join(frames_dir, "frame_0001.png"), dtype=np.uint8),
        cv2.IMREAD_UNCHANGED,
    )
    print(
        f"{source_name}: {len(frames)} frames, alpha TL={int(first[0,0,3])} center={int(first[WIDTH//2,WIDTH//2,3])}",
        flush=True,
    )

    results = []
    pattern = os.path.join(frames_dir, "frame_%04d.png")
    for action in actions:
        if action in SKIP_ENCODE:
            results.append({
                "action": action,
                "file": f"filemonster_{action}.webm",
                "frames": len(frames),
                "loop": action in LOOP_ACTIONS,
            })
            continue
        temp_out = os.path.join(WORK, f"{action}.webm")
        final_out = os.path.join(OUT_DIR, f"filemonster_{action}.webm")
        cmd = [
            "ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern,
            "-frames:v", str(len(frames)),
            "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
            "-auto-alt-ref", "0", "-b:v", "2M", temp_out,
        ]
        print("+", " ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)
        shutil.copy2(temp_out, final_out)
        print(f"  wrote {final_out} ({os.path.getsize(final_out)} bytes)", flush=True)
        results.append({
            "action": action,
            "file": f"filemonster_{action}.webm",
            "frames": len(frames),
            "loop": action in LOOP_ACTIONS,
        })
    return results


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK, exist_ok=True)

    bounds = sample_bounds()
    segments = {}
    for source_name, actions in SOURCE_MAP.items():
        print(f"\n=== {source_name} -> {actions} ===", flush=True)
        for r in process_one(source_name, actions, bounds):
            segments[r["action"]] = {
                "file": r["file"],
                "frames": r["frames"],
                "loop": r["loop"],
                "label": r["action"],
            }

    # poster from idle first frame if available
    idle_frame = os.path.join(WORK, "frames", "Idle-1", "frame_0001.png")
    if os.path.isfile(idle_frame):
        img = cv2.imdecode(np.fromfile(idle_frame, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
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
            if "magic" in old.get("segments", {}):
                magic = os.path.join(OUT_DIR, "filemonster_magic.webm")
                if os.path.isfile(magic):
                    segments["magic"] = old["segments"]["magic"]
        except Exception:
            pass

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"fps": FPS, "size": [WIDTH, WIDTH], "segments": segments}, f, ensure_ascii=False, indent=2)
    print("manifest updated", manifest_path, flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
