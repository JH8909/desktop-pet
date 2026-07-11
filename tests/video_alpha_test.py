import importlib.util
import unittest
from pathlib import Path

import cv2
import numpy as np


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "process-video.py"
SPEC = importlib.util.spec_from_file_location("process_video", MODULE_PATH)
process_video = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(process_video)


def synthetic_frame(offset_x=0):
    frame = np.full((100, 120, 3), (190, 180, 170), dtype=np.uint8)
    cv2.rectangle(frame, (28 + offset_x, 28), (88 + offset_x, 96), (40, 190, 120), -1)
    cv2.circle(frame, (58 + offset_x, 52), 14, (245, 245, 245), -1)
    return frame


class AlphaMatteTests(unittest.TestCase):
    def test_background_is_transparent_and_enclosed_eye_is_opaque(self):
        rgba = process_video.make_alpha_rgba(synthetic_frame())
        self.assertLess(rgba[0, 0, 3], 10)
        self.assertGreater(rgba[52, 58, 3], 240)

    def test_subject_touching_lower_area_is_preserved(self):
        rgba = process_video.make_alpha_rgba(synthetic_frame())
        self.assertGreater(rgba[92, 58, 3], 240)

    def test_shared_bounds_include_subject_motion(self):
        alpha_frames = [
            process_video.make_alpha_rgba(synthetic_frame(0))[:, :, 3],
            process_video.make_alpha_rgba(synthetic_frame(12))[:, :, 3],
        ]
        left, top, right, bottom = process_video.find_subject_bounds(alpha_frames, padding_ratio=0)
        self.assertLessEqual(left, 28)
        self.assertGreaterEqual(right, 100)
        self.assertGreaterEqual(bottom, 97)

    def test_subject_is_placed_on_square_canvas_without_stretching(self):
        rgba = process_video.make_alpha_rgba(synthetic_frame())
        canvas = process_video.place_on_square_canvas(rgba, (28, 28, 89, 97), 64)
        self.assertEqual(canvas.shape, (64, 64, 4))
        self.assertEqual(canvas.dtype, np.uint8)
        self.assertGreater(np.count_nonzero(canvas[:, :, 3]), 0)


if __name__ == "__main__":
    unittest.main()
