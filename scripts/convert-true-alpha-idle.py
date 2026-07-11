#!/usr/bin/env python3
"""Convert true-alpha MOV -> idle WebM.

Remove frosted milky fringe (semi-transparent washed plate),
but keep soft white anti-aliased subject edges.
"""
import math
import os
import shutil
import subprocess
import tempfile

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "assets", "video", "ldle.mov")
OUT = os.path.join(ROOT, "assets", "videos", "filemonster_idle.webm")
POSTER = os.path.join(ROOT, "assets", "videos", "filemonster_poster.webp")
WORK = tempfile.mkdtemp(prefix="fm_clean_fringe_")
WIDTH = 512
FPS = 24.0


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


def clean_frosted_keep_soft_edge(bgra: np.ndarray) -> np.ndarray:
    """bgra uint8 -> rgba uint8.

    Frosted layer = semi-transparent + near-plate (washed white/gray) pixels,
    usually outside the solid subject. Remove those.

    Soft white edge = anti-aliased rim on real subject colors; keep alpha falloff.
    """
    bgr = bgra[:, :, :3].astype(np.float32)
    alpha = bgra[:, :, 3].astype(np.float32)
    h, w = alpha.shape

    # Estimate plate color from fully-transparent / near-transparent border ring
    border = np.concatenate([
        bgra[0:8, :, :3].reshape(-1, 3),
        bgra[-8:, :, :3].reshape(-1, 3),
        bgra[:, 0:8, :3].reshape(-1, 3),
        bgra[:, -8:, :3].reshape(-1, 3),
    ]).astype(np.float32)
    # Prefer nearly transparent border pixels for plate estimate; fallback all border
    border_a = np.concatenate([
        bgra[0:8, :, 3].reshape(-1),
        bgra[-8:, :, 3].reshape(-1),
        bgra[:, 0:8, 3].reshape(-1),
        bgra[:, -8:, 3].reshape(-1),
    ]).astype(np.float32)
    plate_samples = border[border_a < 20]
    if len(plate_samples) < 50:
        # use opaque-ish bright low-sat border as plate (export fringe often baked in RGB)
        hsv_b = cv2.cvtColor(border.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV).reshape(-1, 3)
        plate_samples = border[(hsv_b[:, 1] < 40) & (hsv_b[:, 2] > 180)]
    if len(plate_samples) < 10:
        plate = np.array([220.0, 220.0, 220.0], dtype=np.float32)  # BGR-ish light gray
    else:
        plate = plate_samples.mean(axis=0)

    dist = np.linalg.norm(bgr - plate, axis=2)
    hsv = cv2.cvtColor(bgra[:, :, :3], cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float32)
    val = hsv[:, :, 2].astype(np.float32)

    # Solid subject core: high alpha and not plate-like
    core = (alpha >= 240) & ((dist > 28) | (sat > 28))
    core_u8 = core.astype(np.uint8) * 255
    # Protect ~2-3px soft white anti-aliased rim around real subject
    soft_zone = cv2.dilate(core_u8, np.ones((3, 3), np.uint8), iterations=2).astype(bool)

    # Frosted milky veil: washed plate / weak alpha OUTSIDE soft rim zone
    frosted = (
        (alpha > 0)
        & (~soft_zone)
        & (
            (alpha < 220)
            | ((dist < 50) & (sat < 50) & (val > 150))
            | (alpha < 100)
        )
    )
    # Also milky pixels even near rim if they're mostly plate and only weakly opaque
    milky_near = (
        soft_zone
        & (alpha > 0)
        & (alpha < 160)
        & (dist < 45)
        & (sat < 40)
        & (val > 170)
    )
    frosted |= milky_near

    # Flood from true exterior so detached frosted pockets are removed
    exterior = (alpha < 8).astype(np.uint8) * 255
    frost_u8 = frosted.astype(np.uint8) * 255
    grow = exterior.copy()
    k = np.ones((3, 3), np.uint8)
    for _ in range(40):
        grown = cv2.dilate(grow, k, iterations=1)
        grown = cv2.bitwise_and(grown, frost_u8)
        grow = cv2.bitwise_or(grow, grown)
    # Anything outside the protected soft rim is exterior: kill frosted veil completely
    remove = (grow > 0) | ((alpha > 0) & (~soft_zone))

    alpha2 = alpha.copy()
    bgr2 = bgr.copy()
    alpha2[remove] = 0
    bgr2[remove] = 0

    # Keep soft white edge on protected rim: preserve alpha falloff, light despill only
    soft_edge = (alpha2 > 0) & (alpha2 < 250) & soft_zone
    a = np.clip(alpha2 / 255.0, 0, 1)
    for c in range(3):
        ch = bgr2[:, :, c]
        # gentle despill so white soft edge stays visible but less milky haze
        despilled = ch - plate[c] * (1.0 - a) * 0.55
        bgr2[:, :, c] = np.where(soft_edge, np.clip(despilled, 0, 255), ch)

    # Fully transparent => zero RGB
    bgr2[alpha2 == 0] = 0

    rgba = np.dstack([
        bgr2[:, :, 2],  # R
        bgr2[:, :, 1],  # G
        bgr2[:, :, 0],  # B
        alpha2,
    ]).astype(np.uint8)
    return rgba


def main():
    if not os.path.isfile(SRC):
        raise SystemExit(f"missing: {SRC}")
    print("work", WORK, flush=True)

    raw_dir = os.path.join(WORK, "raw")
    out_dir = os.path.join(WORK, "out")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    run([
        "ffmpeg", "-y", "-i", SRC,
        "-vf", f"fps={FPS}",
        "-pix_fmt", "rgba",
        os.path.join(raw_dir, "src_%04d.png"),
    ])
    paths = [
        os.path.join(raw_dir, n)
        for n in sorted(os.listdir(raw_dir))
        if n.startswith("src_") and n.endswith(".png")
    ]
    print(f"frames {len(paths)}", flush=True)

    samples = []
    stride = max(1, len(paths) // 25)
    cleaned_first = None
    for i, path in enumerate(paths):
        bgra = imread(path)
        rgba = clean_frosted_keep_soft_edge(bgra)
        if i == 0:
            cleaned_first = rgba
            print(
                f"clean alpha TL={int(rgba[0,0,3])} center={int(rgba[rgba.shape[0]//2,rgba.shape[1]//2,3])} "
                f"min={int(rgba[:,:,3].min())} max={int(rgba[:,:,3].max())}",
                flush=True,
            )
        if i % stride == 0:
            samples.append(rgba[:, :, 3])
        # stash cleaned for second pass with bounds
        imwrite(os.path.join(raw_dir, f"clean_{i+1:04d}.png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))

    bounds = find_subject_bounds(samples)
    print("bounds", bounds, flush=True)

    clean_paths = [
        os.path.join(raw_dir, n)
        for n in sorted(os.listdir(raw_dir))
        if n.startswith("clean_") and n.endswith(".png")
    ]
    for i, path in enumerate(clean_paths, 1):
        bgra = imread(path)
        rgba = cv2.cvtColor(bgra, cv2.COLOR_BGRA2RGBA)
        canvas = place_on_square_canvas(rgba, bounds, WIDTH)
        imwrite(os.path.join(out_dir, f"frame_{i:04d}.png"), cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA))

    poster = imread(os.path.join(out_dir, "frame_0001.png"))
    ok, buf = cv2.imencode(".webp", poster, [cv2.IMWRITE_WEBP_QUALITY, 100])
    if ok:
        with open(POSTER, "wb") as f:
            f.write(buf.tobytes())

    temp = os.path.join(WORK, "idle.webm")
    run([
        "ffmpeg", "-y", "-framerate", str(FPS),
        "-i", os.path.join(out_dir, "frame_%04d.png"),
        "-frames:v", str(len(clean_paths)),
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-b:v", "2M",
        temp,
    ])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    shutil.copy2(temp, OUT)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)", flush=True)

    # checker preview
    qa = os.path.join(WORK, "qa.png")
    run(["ffmpeg", "-y", "-c:v", "libvpx-vp9", "-i", OUT, "-frames:v", "1", "-update", "1", "-pix_fmt", "rgba", qa])
    q = imread(qa)
    a = q[:, :, 3].astype(np.float32) / 255.0
    yy, xx = np.indices((WIDTH, WIDTH))
    chk = np.zeros((WIDTH, WIDTH, 3), np.uint8)
    chk[((xx // 16) + (yy // 16)) % 2 == 0] = (220, 220, 220)
    chk[((xx // 16) + (yy // 16)) % 2 == 1] = (40, 40, 40)
    comp = chk * (1 - a[..., None]) + q[:, :, :3].astype(np.float32) * a[..., None]
    os.makedirs(os.path.join(ROOT, ".tmp"), exist_ok=True)
    preview = os.path.join(ROOT, ".tmp", "idle_no_frost_checker.png")
    cv2.imencode(".png", comp.astype(np.uint8))[1].tofile(preview)
    print("preview", preview, flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
