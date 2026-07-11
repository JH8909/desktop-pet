#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess

import cv2
import numpy as np


SEGMENTS = {
    "idle": {"start": 0.00, "end": 0.95, "loop": True, "label": "待机"},
    "drag": {"start": 0.95, "end": 2.10, "loop": True, "label": "拖拽"},
    "work": {"start": 2.45, "end": 3.85, "loop": True, "label": "整理文件"},
    "success": {"start": 3.90, "end": 4.95, "loop": False, "label": "整理成功"},
    "error": {"start": 5.45, "end": 6.25, "loop": False, "label": "整理失败"},
    "sleep": {"start": 6.45, "end": 8.20, "loop": True, "label": "睡觉"},
    "wake": {"start": 8.35, "end": 9.55, "loop": False, "label": "唤醒"},
    "scan": {"start": 9.80, "end": 10.30, "loop": True, "label": "扫描"},
    "magic": {"start": 10.45, "end": 11.25, "loop": False, "label": "AI命名"},
    "hover": {"start": 11.40, "end": 12.10, "loop": False, "label": "悬停"},
    "notify": {"start": 12.35, "end": 13.25, "loop": False, "label": "提醒"},
    "thinking": {"start": 13.35, "end": 14.70, "loop": False, "label": "思考"},
    "ingest": {"start": 2.45, "end": 3.25, "loop": False, "label": "吞入文件"},
}


def make_alpha_rgba(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    _, saturation, value = cv2.split(hsv)

    # Remove only background-like pixels connected to an outer edge. This
    # preserves enclosed low-saturation details such as the monster's eye.
    # Supports both blue-gray studio backgrounds and pure black screen plates.
    background_like = (
        (value < 28) | ((saturation < 55) & (value > 95))
    ).astype(np.uint8)
    _, labels = cv2.connectedComponents(background_like, connectivity=8)
    border_labels = np.unique(
        np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1]))
    )
    border_labels = border_labels[border_labels != 0]
    background = np.isin(labels, border_labels)
    mask = (~background).astype(np.uint8) * 255

    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    height, width = mask.shape
    min_area = max(45, int(height * width * 0.00005))
    center_x1, center_x2 = int(width * 0.14), int(width * 0.86)
    center_y1, center_y2 = int(height * 0.02), int(height * 0.99)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        intersects_main_zone = not (
            x + w < center_x1 or x > center_x2 or y + h < center_y1 or y > center_y2
        )
        if intersects_main_zone:
            cv2.drawContours(filled, [contour], -1, 255, -1)

    # Fill enclosed holes (e.g. white eye region incorrectly marked transparent)
    hole_mask = cv2.bitwise_not(filled)
    _, hole_labels = cv2.connectedComponents(hole_mask, connectivity=8)
    edge_labels = set(np.unique(np.concatenate((
        hole_labels[0], hole_labels[-1], hole_labels[:, 0], hole_labels[:, -1]
    ))).tolist())
    edge_labels.discard(0)
    outer_bg = np.isin(hole_labels, list(edge_labels))
    filled[(~outer_bg) & (hole_mask > 0)] = 255

    alpha = cv2.GaussianBlur(filled, (0, 0), 1.4)
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
    rgba[:, :, 3] = alpha
    return rgba


def find_subject_bounds(alpha_frames, padding_ratio=0.10):
    if not alpha_frames:
        raise ValueError("At least one alpha frame is required")
    shape = alpha_frames[0].shape
    presence = np.zeros(shape, dtype=np.uint16)
    for alpha in alpha_frames:
        if alpha.shape != shape:
            raise ValueError("All alpha frames must have the same dimensions")
        presence += (alpha >= 128).astype(np.uint16)

    # Persistent pixels define the body. Short-lived wide action effects do not
    # shrink the monster in every other action clip.
    min_presence = max(1, int(math.ceil(len(alpha_frames) * 0.20)))
    ys, xs = np.where(presence >= min_presence)
    if len(xs) == 0:
        raise ValueError("No opaque subject pixels found")

    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    pad = int(round(max(right - left, bottom - top) * padding_ratio))
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(shape[1], right + pad),
        min(shape[0], bottom + pad),
    )


def place_on_square_canvas(rgba, bounds, size):
    left, top, right, bottom = bounds
    crop = rgba[top:bottom, left:right]
    if crop.size == 0:
        raise ValueError("Subject bounds produced an empty crop")

    scale = min(size / crop.shape[1], size / crop.shape[0])
    width = max(1, int(round(crop.shape[1] * scale)))
    height = max(1, int(round(crop.shape[0] * scale)))
    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    resized = cv2.resize(crop, (width, height), interpolation=interpolation)
    canvas = np.zeros((size, size, 4), dtype=np.uint8)
    x = (size - width) // 2
    y = (size - height) // 2
    canvas[y:y + height, x:x + width] = resized
    return canvas


def run(command):
    print("+", " ".join(command))
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--frames", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--fps", type=float, default=24.0)
    args = parser.parse_args()

    os.makedirs(args.frames, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    for filename in os.listdir(args.frames):
        if filename.startswith("frame_") and filename.endswith(".png"):
            os.remove(os.path.join(args.frames, filename))

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open input video: {args.input}")

    source_fps = cap.get(cv2.CAP_PROP_FPS) or args.fps
    source_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sample_stride = max(1, int(round(source_fps / 8)))
    sampled_alpha = []
    source_index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if source_index % sample_stride == 0:
            sampled_alpha.append(make_alpha_rgba(frame)[:, :, 3])
        source_index += 1

    bounds = find_subject_bounds(sampled_alpha)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    print(json.dumps({
        "source_fps": source_fps,
        "source_size": [source_width, source_height],
        "output_size": [args.width, args.width],
        "subject_bounds": bounds,
    }, ensure_ascii=False))

    frame_index = 1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgba = make_alpha_rgba(frame)
        canvas = place_on_square_canvas(rgba, bounds, args.width)
        bgra = cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA)
        cv2.imwrite(os.path.join(args.frames, f"frame_{frame_index:04d}.png"), bgra)
        if frame_index == 1:
            cv2.imwrite(
                os.path.join(args.out, "filemonster_poster.webp"),
                bgra,
                [cv2.IMWRITE_WEBP_QUALITY, 100],
            )
        frame_index += 1
    cap.release()

    total = frame_index - 1
    manifest = {"fps": args.fps, "size": [args.width, args.width], "segments": {}}
    input_pattern = os.path.join(args.frames, "frame_%04d.png")
    encode_common = [
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-b:v", "2M",
    ]
    run([
        "ffmpeg", "-y", "-framerate", str(args.fps), "-i", input_pattern,
        "-frames:v", str(total), *encode_common,
        os.path.join(args.out, "filemonster_master.webm"),
    ])

    for name, segment in SEGMENTS.items():
        start_frame = max(1, int(math.floor(segment["start"] * args.fps)) + 1)
        end_frame = min(total, int(math.ceil(segment["end"] * args.fps)))
        count = max(1, end_frame - start_frame + 1)
        output_file = os.path.join(args.out, f"filemonster_{name}.webm")
        run([
            "ffmpeg", "-y", "-framerate", str(args.fps),
            "-start_number", str(start_frame), "-i", input_pattern,
            "-frames:v", str(count), *encode_common, output_file,
        ])
        manifest["segments"][name] = {
            **segment,
            "file": f"filemonster_{name}.webm",
            "frames": count,
        }

    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
