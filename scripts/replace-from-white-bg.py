#!/usr/bin/env python3
"""Replace pet WebMs from white-background sources 1.mp4..5.mp4."""
import json
import math
import os
import shutil
import subprocess
import tempfile

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE_DIR = os.path.join(ROOT, "assets", "video")
OUT_DIR = os.path.join(ROOT, "assets", "videos")
WORK = tempfile.mkdtemp(prefix="fm_white_key_")

WIDTH = 512
FPS = 24.0

SOURCE_MAP = {
    "1.mp4": ["idle"],
    "2.mp4": ["thinking", "hover", "notify"],
    "3.mp4": ["success", "wake", "scan"],
    "4.mp4": ["drag", "work", "error", "ingest"],
    "5.mp4": ["sleep"],
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


def fill_eye_holes_only(filled: np.ndarray) -> np.ndarray:
    """Fill enclosed holes only in the upper body (eye). Never fill floor pockets."""
    height, width = filled.shape
    hole_mask = cv2.bitwise_not(filled)
    num, hole_labels, stats, centroids = cv2.connectedComponentsWithStats(hole_mask, connectivity=8)
    ys_sub, _ = np.where(filled > 0)
    if len(ys_sub):
        sub_top, sub_bottom = int(ys_sub.min()), int(ys_sub.max())
        eye_limit = sub_top + int((sub_bottom - sub_top) * 0.58)
    else:
        eye_limit = int(height * 0.55)
    out = filled.copy()
    for label in range(1, num):
        ys_h, xs_h = np.where(hole_labels == label)
        if len(ys_h) == 0:
            continue
        if (
            ys_h.min() == 0 or ys_h.max() == height - 1
            or xs_h.min() == 0 or xs_h.max() == width - 1
        ):
            continue
        cy = float(centroids[label][1])
        area = int(stats[label, cv2.CC_STAT_AREA])
        if cy <= eye_limit and 20 < area < int(height * width * 0.08):
            out[hole_labels == label] = 255
    return out


def make_alpha_rgba_white(bgr: np.ndarray) -> np.ndarray:
    """Per-frame white/gray plate key with hard edge + despill (kills frosted halo)."""
    height, width = bgr.shape[:2]
    bgr_f = bgr.astype(np.float32)

    # Per-frame key color from border ring
    border = np.concatenate([
        bgr[0:6, :].reshape(-1, 3),
        bgr[-6:, :].reshape(-1, 3),
        bgr[:, 0:6].reshape(-1, 3),
        bgr[:, -6:].reshape(-1, 3),
    ])
    key = border.mean(axis=0).astype(np.float32)
    dist = np.linalg.norm(bgr_f - key, axis=2)

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1].astype(np.float32)
    value = hsv[:, :, 2].astype(np.float32)

    # Broad plate: near key color, or light low-sat gray
    background_like = (
        ((dist < 48) & (saturation < 60) & (value > 145))
        | ((dist < 38) & (value > 175))
        | ((saturation < 40) & (value > 195))
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
    min_area = max(45, int(height * width * 0.00005))
    cx1, cx2 = int(width * 0.12), int(width * 0.88)
    cy1, cy2 = int(height * 0.02), int(height * 0.99)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if not (x + w < cx1 or x > cx2 or y + h < cy1 or y > cy2):
            cv2.drawContours(filled, [contour], -1, 255, -1)

    # Keep enclosed holes ONLY in upper body (eye). Never fill floor pockets.
    filled = fill_eye_holes_only(filled)

    # Second pass: flood residual plate pixels (feet glow / halo pockets)
    # from true outer background into the subject mask.
    residual = (
        (filled > 0)
        & (dist < 58)
        & (saturation < 62)
        & (value > 140)
    )
    if residual.any():
        grow = (filled == 0).astype(np.uint8) * 255
        residual_u8 = residual.astype(np.uint8) * 255
        grow_k = np.ones((3, 3), np.uint8)
        for _ in range(28):
            grown = cv2.dilate(grow, grow_k, iterations=1)
            grown = cv2.bitwise_and(grown, residual_u8)
            grow = cv2.bitwise_or(grow, grown)
        filled[grow > 0] = 0

    # Erode frosted fringe harder, then tiny close to restore thin limbs
    filled = cv2.erode(filled, np.ones((3, 3), np.uint8), iterations=3)
    filled = cv2.morphologyEx(filled, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=2)

    # Re-fill eye holes after erode
    filled = fill_eye_holes_only(filled)

    # Iteratively peel near-key fringe pixels off the silhouette
    peel_k = np.ones((3, 3), np.uint8)
    for _ in range(10):
        bg = (filled == 0).astype(np.uint8)
        rim = cv2.dilate(bg, peel_k, iterations=1).astype(bool) & (filled > 0)
        # also peel blended fringe: lightened edge pixels
        light_fringe = rim & (value > 155) & (saturation < 90)
        peel = rim & (
            ((dist < 62) & (saturation < 75) & (value > 120))
            | light_fringe
        )
        if not peel.any():
            break
        filled[peel] = 0

    # Feet / floor contact: force-clear near-key plate under subject (no flood needed)
    ys, xs = np.where(filled > 0)
    if len(ys):
        bottom = int(ys.max())
        top_band = max(0, bottom - 70)
        band = np.zeros_like(filled, dtype=bool)
        band[top_band:bottom + 1, :] = True
        floor_like = (
            band
            & (filled > 0)
            & (dist < 70)
            & (saturation < 70)
            & (value > 120)
        )
        filled[floor_like] = 0
        # also flood-connected leftovers
        if floor_like.any():
            grow = (filled == 0).astype(np.uint8) * 255
            # recompute remaining floor candidates after hard clear
            floor_like2 = (
                band
                & (filled > 0)
                & (dist < 75)
                & (saturation < 75)
                & (value > 110)
            )
            floor_u8 = floor_like2.astype(np.uint8) * 255
            for _ in range(50):
                grown = cv2.dilate(grow, peel_k, iterations=1)
                grown = cv2.bitwise_and(grown, floor_u8)
                grow = cv2.bitwise_or(grow, grown)
            filled[grow > 0] = 0

    # Final hard open to drop leftover speckles
    filled = cv2.morphologyEx(filled, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    # Keep eye holes after floor/edge peels
    filled = fill_eye_holes_only(filled)

    # Remove soft ground contact shadow under feet (dark, low-sat, attached from below)
    ys, xs = np.where(filled > 0)
    if len(ys):
        bottom = int(ys.max())
        top_band = max(0, bottom - 70)
        band = np.zeros_like(filled, dtype=bool)
        band[top_band:bottom + 1, :] = True
        shadow_like = (
            band
            & (filled > 0)
            & (saturation < 45)
            & (value > 25)
            & (value < 150)
        )
        if shadow_like.any():
            grow = (filled == 0).astype(np.uint8) * 255
            sh_u8 = shadow_like.astype(np.uint8) * 255
            for _ in range(50):
                grown = cv2.dilate(grow, np.ones((3, 3), np.uint8), iterations=1)
                grown = cv2.bitwise_and(grown, sh_u8)
                grow = cv2.bitwise_or(grow, grown)
            filled[grow > 0] = 0

    # Hard inset: shrink silhouette to kill remaining frosted fringe
    filled = cv2.erode(filled, np.ones((3, 3), np.uint8), iterations=3)
    filled = fill_eye_holes_only(filled)

    # Hard alpha: binary mask (no soft frosted fringe from blur)
    alpha = filled.copy()

    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA).astype(np.float32)
    a = alpha.astype(np.float32) / 255.0

    # Despill: remove residual plate color from soft-edge RGB
    key_rgb = key[::-1]  # BGR -> RGB
    for c in range(3):
        ch = rgba[:, :, c]
        despilled = ch - key_rgb[c] * (1.0 - a)
        rgba[:, :, c] = np.where(a < 0.995, np.clip(despilled, 0, 255), ch)

    # Snap weak frosted leftovers to fully transparent + zero RGB
    rgba[alpha < 64, :3] = 0
    alpha = np.where(alpha < 64, 0, alpha).astype(np.uint8)
    rgba[alpha == 0, :3] = 0

    # Extra despill on remaining silhouette rim
    rim = cv2.dilate((alpha == 0).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool)
    rim &= alpha > 0
    for c in range(3):
        ch = rgba[:, :, c]
        mix = np.clip(ch - key_rgb[c] * 0.95, 0, 255)
        rgba[:, :, c] = np.where(rim, mix, ch)

    # One-pixel anti-alias only (optional tiny soften after hard cut)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.25)
    alpha = np.where(alpha < 80, 0, np.where(alpha > 200, 255, alpha)).astype(np.uint8)
    rgba[:, :, 3] = alpha
    rgba[alpha == 0, :3] = 0
    return rgba.astype(np.uint8)


def find_subject_bounds(alpha_frames, padding_ratio=0.06):
    shape = alpha_frames[0].shape
    presence = np.zeros(shape, dtype=np.uint16)
    for alpha in alpha_frames:
        presence += (alpha >= 128).astype(np.uint16)
    min_presence = max(1, int(math.ceil(len(alpha_frames) * 0.20)))
    ys, xs = np.where(presence >= min_presence)
    if len(xs) == 0:
        raise SystemExit("No opaque subject pixels found")
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


def main():
    print("work", WORK, flush=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    # Extract + sample bounds
    extracted = {}
    samples = []
    for source_name in SOURCE_MAP:
        src = os.path.join(SOURCE_DIR, source_name)
        if not os.path.isfile(src):
            print("SKIP", src, flush=True)
            continue
        clip = os.path.splitext(source_name)[0]
        raw_dir = os.path.join(WORK, "raw", clip)
        os.makedirs(raw_dir, exist_ok=True)
        print(f"\nExtracting {source_name}...", flush=True)
        run([
            "ffmpeg", "-y", "-i", src,
            "-vf", f"fps={FPS}",
            os.path.join(raw_dir, "src_%04d.png"),
        ])
        paths = [
            os.path.join(raw_dir, n)
            for n in sorted(os.listdir(raw_dir))
            if n.startswith("src_") and n.endswith(".png")
        ]
        extracted[source_name] = paths
        stride = max(1, len(paths) // 25)
        for i, path in enumerate(paths):
            if i % stride != 0:
                continue
            bgr = imread(path)
            if bgr.ndim == 3 and bgr.shape[2] == 4:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
            samples.append(make_alpha_rgba_white(bgr)[:, :, 3])
        print(f"  {len(paths)} frames, samples={len(samples)}", flush=True)

    bounds = find_subject_bounds(samples)
    print("shared bounds", bounds, flush=True)

    segments = {}
    idle_out = None
    for source_name, actions in SOURCE_MAP.items():
        if source_name not in extracted:
            continue
        print(f"\n=== {source_name} -> {actions} ===", flush=True)
        clip = os.path.splitext(source_name)[0]
        out_frames = os.path.join(WORK, "out", clip)
        os.makedirs(out_frames, exist_ok=True)
        paths = extracted[source_name]

        for i, path in enumerate(paths, 1):
            bgr = imread(path)
            if bgr.ndim == 3 and bgr.shape[2] == 4:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
            rgba = make_alpha_rgba_white(bgr)
            canvas = place_on_square_canvas(rgba, bounds, WIDTH)
            bgra = cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA)
            imwrite(os.path.join(out_frames, f"frame_{i:04d}.png"), bgra)

        first = imread(os.path.join(out_frames, "frame_0001.png"))
        print(
            f"  frames={len(paths)} alpha TL={int(first[0,0,3])} center={int(first[WIDTH//2,WIDTH//2,3])}",
            flush=True,
        )
        if source_name == "1.mp4":
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
