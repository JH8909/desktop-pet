#!/usr/bin/env python3
"""Process 5 source MP4 clips into transparent WebM action videos."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from importlib.util import module_from_spec, spec_from_file_location

import cv2
import numpy as np

_spec = spec_from_file_location("pv", os.path.join(os.path.dirname(__file__), "process-video.py"))
_pv = module_from_spec(_spec)
_spec.loader.exec_module(_pv)
make_alpha_rgba = _pv.make_alpha_rgba
find_subject_bounds = _pv.find_subject_bounds
place_on_square_canvas = _pv.place_on_square_canvas

SOURCE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "video"))
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "videos"))

# ASCII-only temp root: OpenCV/ffmpeg fail on Chinese path segments
WORK_ROOT = os.path.join(tempfile.gettempdir(), "filemonster_replace")
FRAMES_DIR = os.path.join(WORK_ROOT, "frames")
ENCODE_DIR = os.path.join(WORK_ROOT, "encode")

WIDTH = 512
FPS = 24.0

SOURCE_MAP = {
    "Idle-1.mp4": ["idle"],
    "Silly Face-2.mp4": ["thinking", "hover", "notify"],
    "Wave-3.mp4": ["success", "wake", "scan"],
    "Dizzy Loop-4.mp4": ["drag", "work", "error", "ingest"],
    "Sleep-5.mp4": ["sleep"],
}

LOOP_ACTIONS = {"idle", "drag", "work", "scan", "sleep"}


def run(command):
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def imwrite_unicode(path, image):
    """Write image even when path contains non-ASCII characters."""
    ok, buf = cv2.imencode(os.path.splitext(path)[1] or ".png", image)
    if not ok:
        return False
    with open(path, "wb") as handle:
        handle.write(buf.tobytes())
    return True


def process_source(source_path, actions, shared_bounds):
    cap = cv2.VideoCapture(source_path)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open: {source_path}")

    basename = os.path.basename(source_path)
    clip_name = os.path.splitext(basename)[0].replace(" ", "_")
    clip_frames_dir = os.path.join(FRAMES_DIR, clip_name)
    if os.path.isdir(clip_frames_dir):
        shutil.rmtree(clip_frames_dir)
    os.makedirs(clip_frames_dir, exist_ok=True)

    frame_index = 1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgba = make_alpha_rgba(frame)
        canvas = place_on_square_canvas(rgba, shared_bounds, WIDTH)
        bgra = cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA)
        out_path = os.path.join(clip_frames_dir, f"frame_{frame_index:04d}.png")
        if not imwrite_unicode(out_path, bgra):
            raise SystemExit(f"Failed to write frame: {out_path}")
        frame_index += 1
    cap.release()

    total = frame_index - 1
    if total == 0:
        print(f"  WARNING: no frames in {source_path}")
        return []

    written = len([n for n in os.listdir(clip_frames_dir) if n.startswith("frame_")])
    print(f"  wrote {written}/{total} frames to {clip_frames_dir}", flush=True)

    input_pattern = os.path.join(clip_frames_dir, "frame_%04d.png")
    encode_common = [
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-b:v", "2M",
    ]

    results = []
    for action in actions:
        temp_out = os.path.join(ENCODE_DIR, f"filemonster_{action}.webm")
        final_out = os.path.join(OUT_DIR, f"filemonster_{action}.webm")
        run([
            "ffmpeg", "-y", "-framerate", str(FPS), "-i", input_pattern,
            "-frames:v", str(total), *encode_common, temp_out,
        ])
        shutil.copy2(temp_out, final_out)
        results.append({
            "action": action,
            "file": f"filemonster_{action}.webm",
            "frames": total,
            "loop": action in LOOP_ACTIONS,
        })
        print(f"  -> {final_out} ({total} frames)", flush=True)

    return results, clip_frames_dir


def compute_shared_bounds(source_dir):
    print("Computing shared subject bounds across all clips...", flush=True)
    all_alpha_samples = []

    for source_file in SOURCE_MAP.keys():
        source_path = os.path.join(source_dir, source_file)
        if not os.path.isfile(source_path):
            print(f"  WARNING: {source_path} not found, skipping", flush=True)
            continue

        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            continue

        source_fps = cap.get(cv2.CAP_PROP_FPS) or FPS
        stride = max(1, int(round(source_fps / 6)))
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % stride == 0:
                all_alpha_samples.append(make_alpha_rgba(frame)[:, :, 3])
            idx += 1
        cap.release()
        print(f"  Sampled {source_file}: {len(all_alpha_samples)} total frames", flush=True)

    if not all_alpha_samples:
        raise SystemExit("No frames sampled from any source")

    bounds = find_subject_bounds(all_alpha_samples)
    print(f"  Shared bounds: {bounds}", flush=True)
    return bounds


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.isdir(WORK_ROOT):
        shutil.rmtree(WORK_ROOT)
    os.makedirs(FRAMES_DIR, exist_ok=True)
    os.makedirs(ENCODE_DIR, exist_ok=True)

    bounds = compute_shared_bounds(SOURCE_DIR)

    manifest_segments = {}
    idle_frames_dir = None
    for source_file, actions in SOURCE_MAP.items():
        source_path = os.path.join(SOURCE_DIR, source_file)
        if not os.path.isfile(source_path):
            print(f"SKIP: {source_path} not found", flush=True)
            continue

        print(f"\nProcessing: {source_file} -> {actions}", flush=True)
        results, clip_frames_dir = process_source(source_path, actions, bounds)
        if source_file.startswith("Idle"):
            idle_frames_dir = clip_frames_dir
        for r in results:
            manifest_segments[r["action"]] = {
                "file": r["file"],
                "frames": r["frames"],
                "loop": r["loop"],
                "label": r["action"],
            }

    if idle_frames_dir:
        idle_frame = os.path.join(idle_frames_dir, "frame_0001.png")
        if os.path.isfile(idle_frame):
            poster_path = os.path.join(OUT_DIR, "filemonster_poster.webp")
            img = cv2.imdecode(np.fromfile(idle_frame, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
            ok, buf = cv2.imencode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, 100])
            if ok:
                with open(poster_path, "wb") as handle:
                    handle.write(buf.tobytes())
                print(f"\nPoster: {poster_path}", flush=True)

    # Keep magic if it already exists; otherwise leave untouched
    existing_manifest_path = os.path.join(OUT_DIR, "manifest.json")
    if os.path.isfile(existing_manifest_path):
        try:
            with open(existing_manifest_path, "r", encoding="utf-8") as handle:
                old = json.load(handle)
            if "magic" in old.get("segments", {}) and "magic" not in manifest_segments:
                magic_file = os.path.join(OUT_DIR, "filemonster_magic.webm")
                if os.path.isfile(magic_file):
                    manifest_segments["magic"] = old["segments"]["magic"]
        except Exception:
            pass

    manifest = {"fps": FPS, "size": [WIDTH, WIDTH], "segments": manifest_segments}
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    print(f"\nManifest: {manifest_path}", flush=True)
    print("\nDone! All videos replaced.", flush=True)


if __name__ == "__main__":
    main()
