#!/usr/bin/env python3
import argparse
import json
import os
import subprocess

import numpy as np


def run_json(command):
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


def probe_video(path):
    data = run_json([
        "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_read_frames:stream_tags=alpha_mode",
        "-of", "json", path,
    ])
    if not data.get("streams"):
        raise ValueError(f"No video stream: {path}")
    return data["streams"][0]


def decode_sample_alpha(path, width, height, frame_count):
    indices = sorted({0, max(0, frame_count // 2), max(0, frame_count - 1)})
    expression = "+".join(f"eq(n\\,{index})" for index in indices)
    completed = subprocess.run([
        "ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", path,
        "-vf", f"select={expression}", "-fps_mode", "passthrough",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ], check=True, capture_output=True)
    frame_bytes = width * height * 4
    if not completed.stdout or len(completed.stdout) % frame_bytes:
        raise ValueError(f"Could not decode complete RGBA samples: {path}")
    pixels = np.frombuffer(completed.stdout, dtype=np.uint8).reshape((-1, height, width, 4))
    return pixels[:, :, :, 3]


def verify_video(path):
    stream = probe_video(path)
    alpha_mode = str(stream.get("tags", {}).get("alpha_mode", ""))
    if alpha_mode != "1":
        raise ValueError(f"Missing VP9 Alpha metadata: {path}")

    width = int(stream["width"])
    height = int(stream["height"])
    frame_count = int(stream.get("nb_read_frames") or 0)
    if width <= 0 or height <= 0 or frame_count <= 0:
        raise ValueError(f"Invalid video geometry or frame count: {path}")

    alpha = decode_sample_alpha(path, width, height, frame_count)
    transparent_fraction = float(np.mean(alpha <= 8))
    opaque_fraction = float(np.mean(alpha >= 247))
    if transparent_fraction <= 0:
        raise ValueError(f"Alpha stream has no transparent pixels: {path}")
    if opaque_fraction <= 0:
        raise ValueError(f"Alpha stream has no opaque pixels: {path}")

    return {
        "file": os.path.basename(path),
        "alpha_mode": alpha_mode,
        "transparent_fraction": transparent_fraction,
        "opaque_fraction": opaque_fraction,
        "width": width,
        "height": height,
        "frame_count": frame_count,
    }


def verify_path(path):
    if os.path.isdir(path):
        files = sorted(
            os.path.join(path, filename)
            for filename in os.listdir(path)
            if filename.lower().endswith(".webm")
        )
    else:
        files = [path]
    if not files:
        raise ValueError(f"No WebM files found: {path}")
    return [verify_video(file_path) for file_path in files]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    args = parser.parse_args()
    try:
        print(json.dumps(verify_path(args.path), ensure_ascii=False, indent=2))
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"Alpha verification failed: {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
