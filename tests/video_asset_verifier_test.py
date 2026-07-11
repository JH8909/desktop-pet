import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).parents[1]
VERIFIER_PATH = ROOT / "scripts" / "verify-video-alpha.py"


def encode_frames(frame_dir, output, pixel_format):
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", "12",
        "-i", str(frame_dir / "frame_%02d.png"), "-frames:v", "3",
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", pixel_format,
        "-auto-alt-ref", "0", str(output),
    ], check=True)


class VideoAssetVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        alpha_frames = self.root / "alpha-frames"
        opaque_frames = self.root / "opaque-frames"
        alpha_frames.mkdir()
        opaque_frames.mkdir()
        for index in range(1, 4):
            rgba = np.zeros((16, 16, 4), dtype=np.uint8)
            rgba[4:12, 4:12, :3] = (60, 190, 120)
            rgba[4:12, 4:12, 3] = 255
            Image.fromarray(rgba).save(alpha_frames / f"frame_{index:02d}.png")
            Image.fromarray(rgba[:, :, :3]).save(opaque_frames / f"frame_{index:02d}.png")
        self.alpha_video = self.root / "alpha.webm"
        self.opaque_video = self.root / "opaque.webm"
        encode_frames(alpha_frames, self.alpha_video, "yuva420p")
        encode_frames(opaque_frames, self.opaque_video, "yuv420p")

    def tearDown(self):
        self.temp.cleanup()

    def load_verifier(self):
        spec = importlib.util.spec_from_file_location("verify_video_alpha", VERIFIER_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_accepts_video_with_real_transparent_and_opaque_pixels(self):
        result = self.load_verifier().verify_video(str(self.alpha_video))
        self.assertEqual(result["alpha_mode"], "1")
        self.assertGreater(result["transparent_fraction"], 0)
        self.assertGreater(result["opaque_fraction"], 0)

    def test_rejects_video_without_alpha_channel(self):
        with self.assertRaises(ValueError):
            self.load_verifier().verify_video(str(self.opaque_video))


if __name__ == "__main__":
    unittest.main()
