#!/usr/bin/env python3
import os
import cv2
import numpy as np

SOURCE = os.path.join(os.path.dirname(__file__), "..", "assets", "video", "Idle-1.mp4")
OUT = os.path.join(os.path.dirname(__file__), "..", ".tmp", "diag")
os.makedirs(OUT, exist_ok=True)

cap = cv2.VideoCapture(SOURCE)
ok, frame = cap.read()
print("opened", ok, "shape", None if frame is None else frame.shape)
if not ok:
    raise SystemExit(1)

h, w = frame.shape[:2]
print("corner TL", frame[0, 0].tolist())
print("corner TR", frame[0, w - 1].tolist())
print("corner BL", frame[h - 1, 0].tolist())
print("corner BR", frame[h - 1, w - 1].tolist())
print("center", frame[h // 2, w // 2].tolist())

hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
print("corner HSV", hsv[0, 0].tolist(), "center HSV", hsv[h // 2, w // 2].tolist())

# Sample border pixels for background color
border = np.concatenate([
    frame[0, :], frame[-1, :], frame[:, 0], frame[:, -1]
])
mean_bgr = border.mean(axis=0)
print("border mean BGR", mean_bgr.tolist())

cv2.imwrite(os.path.join(OUT, "idle_first_bgr.png"), frame)

# Test write path used by replace script
frames_dir = os.path.join(os.path.dirname(__file__), "..", ".tmp", "replace_frames", "Idle-1")
os.makedirs(frames_dir, exist_ok=True)
test_path = os.path.join(frames_dir, "frame_0001.png")
ok_write = cv2.imwrite(test_path, frame)
print("imwrite test", ok_write, "exists", os.path.isfile(test_path), "path", os.path.abspath(test_path))
print("abs frames_dir", os.path.abspath(frames_dir))
print("listdir", os.listdir(frames_dir)[:5])
cap.release()
