#!/usr/bin/env python3
"""Regenerate the five transparent WebP pet animations with a consistent subject height."""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "video"
OUT_DIR = ROOT / "assets" / "videos"
FPS = 30
CANVAS_SIZE = 512
TARGET_SUBJECT_HEIGHT = 250
ACTION_SUBJECT_HEIGHTS = {}
FRAME_DELAY_CS = 3

SOURCES = {
    "dizzy": "Dizzy Loop.mov",
    "idle": "ldle.mov",
    "silly": "Silly Face.mov",
    "sleep": "Sleep.mov",
    "wave": "Wave.mov",
}
LOOP_ACTIONS = {"dizzy", "sleep"}


def run(args, label):
    print("+", label, flush=True)
    subprocess.run([str(arg) for arg in args], check=True)


def extract_frames(source, frames_dir):
    frames_dir.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        source,
        "-vf",
        f"fps={FPS},format=rgba",
        frames_dir / "frame_%04d.png",
    ], f"extract frames from {source.name}")
    frames = sorted(frames_dir.glob("frame_*.png"))
    if not frames:
        raise RuntimeError(f"No frames extracted from {source}")
    return frames


def union_alpha_bbox(frames):
    left = top = None
    right = bottom = None
    for frame in frames:
        with Image.open(frame) as image:
            bbox = image.convert("RGBA").getchannel("A").getbbox()
        if not bbox:
            continue
        l, t, r, b = bbox
        left = l if left is None else min(left, l)
        top = t if top is None else min(top, t)
        right = r if right is None else max(right, r)
        bottom = b if bottom is None else max(bottom, b)
    if left is None:
        raise RuntimeError("Frames contain no non-transparent pixels")
    return left, top, right, bottom


def normalize_frames(input_frames, output_dir, target_subject_height):
    output_dir.mkdir(parents=True, exist_ok=True)
    bbox = union_alpha_bbox(input_frames)
    left, top, right, bottom = bbox
    subject_width = right - left
    subject_height = bottom - top
    scale = target_subject_height / subject_height
    scaled_width = round(subject_width * scale)
    scaled_height = target_subject_height
    if scaled_width > CANVAS_SIZE:
        scale = CANVAS_SIZE / subject_width
        scaled_width = CANVAS_SIZE
        scaled_height = round(subject_height * scale)

    x = (CANVAS_SIZE - scaled_width) // 2
    y = (CANVAS_SIZE - scaled_height) // 2
    output_frames = []
    for index, frame in enumerate(input_frames, 1):
        with Image.open(frame) as image:
            cropped = image.convert("RGBA").crop(bbox)
            resized = cropped.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
            canvas.alpha_composite(resized, (x, y))
            output = output_dir / f"frame_{index:04d}.png"
            canvas.save(output)
            output_frames.append(output)
    return output_frames


def make_webp(frames, output):
    run([
        "magick",
        "-delay",
        str(FRAME_DELAY_CS),
        "-loop",
        "0",
        *frames,
        "-define",
        "webp:lossless=true",
        output,
    ], f"write {output.name} from {len(frames)} normalized frames")


def webp_stats(path):
    delays = subprocess.check_output([
        "magick",
        "identify",
        "-format",
        "%T\n",
        str(path),
    ], text=True).splitlines()
    return len(delays), sum(int(delay) for delay in delays) * 10


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work_root = Path(tempfile.mkdtemp(prefix="filemonster_webp_normalize_"))
    print("work dir", work_root, flush=True)
    segments = {}
    try:
        for action, source_name in SOURCES.items():
            source = SOURCE_DIR / source_name
            if not source.is_file():
                raise FileNotFoundError(source)
            print(f"\n=== {action}: {source_name} ===", flush=True)
            raw_dir = work_root / action / "raw"
            normalized_dir = work_root / action / "normalized"
            raw_frames = extract_frames(source, raw_dir)
            target_subject_height = ACTION_SUBJECT_HEIGHTS.get(action, TARGET_SUBJECT_HEIGHT)
            normalized_frames = normalize_frames(raw_frames, normalized_dir, target_subject_height)
            output = OUT_DIR / f"filemonster_{action}.webp"
            make_webp(normalized_frames, output)
            frames, duration_ms = webp_stats(output)
            segments[action] = {
                "file": output.name,
                "frames": frames,
                "durationMs": duration_ms,
                "loop": action in LOOP_ACTIONS,
                "label": action,
                "subjectHeight": target_subject_height,
            }
            print(f"wrote {output} frames={frames} durationMs={duration_ms}", flush=True)
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    manifest = {
        "fps": FPS,
        "size": [CANVAS_SIZE, CANVAS_SIZE],
        "subjectHeight": TARGET_SUBJECT_HEIGHT,
        "subjectHeights": {
            action: ACTION_SUBJECT_HEIGHTS.get(action, TARGET_SUBJECT_HEIGHT)
            for action in SOURCES
        },
        "segments": segments,
    }
    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("manifest", manifest_path, flush=True)


if __name__ == "__main__":
    main()
