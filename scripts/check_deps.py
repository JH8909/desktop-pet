import sys
try:
    import cv2
    print(f"cv2: {cv2.__version__}")
except ImportError:
    print("cv2: NOT INSTALLED")
    sys.exit(1)

try:
    import numpy as np
    print(f"numpy: {np.__version__}")
except ImportError:
    print("numpy: NOT INSTALLED")
    sys.exit(1)

import subprocess
try:
    r = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    first_line = r.stdout.split("\n")[0] if r.returncode == 0 else "NOT FOUND"
    print(f"ffmpeg: {first_line}")
except FileNotFoundError:
    print("ffmpeg: NOT INSTALLED")
    sys.exit(1)

print("All dependencies OK")
