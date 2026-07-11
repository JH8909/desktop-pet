# Transparent File Monster Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate genuinely transparent, tightly framed action videos that show the complete File Monster and display them without clipping.

**Architecture:** `scripts/process-video.py` will create a temporally stable alpha matte, calculate one shared subject crop, place the subject on a square transparent canvas, and write all outputs to a staging directory. A separate verifier must prove that every output contains transparent and opaque pixels before assets are promoted. The Electron renderer will keep the existing `<video>` state machine and align the video, freeze canvas, drop target, and native window to the square canvas.

**Tech Stack:** Python 3, OpenCV, Pillow, FFmpeg/libvpx-vp9, Node.js, Electron, CSS.

## Global Constraints

- Source file: `assets/source/filemonster_source.mp4`.
- Main animation format remains VP9 WebM with a real Alpha channel.
- Generate a transparent static WebP poster for loading fallback.
- Do not modify file organization, recycle, drag/drop decision, or settings business logic.
- Never overwrite current assets until every staged animation passes verification.
- This directory is not a Git repository; replace commit steps with explicit test checkpoints and staged-file promotion.

---

### Task 1: Testable alpha matte and shared subject framing

**Files:**
- Create: `tests/video_alpha_test.py`
- Modify: `scripts/process-video.py`

**Interfaces:**
- Produces: `make_alpha_rgba(bgr: np.ndarray) -> np.ndarray`
- Produces: `find_subject_bounds(alpha_frames: list[np.ndarray], padding_ratio: float = 0.08) -> tuple[int, int, int, int]`
- Produces: `place_on_square_canvas(rgba: np.ndarray, bounds: tuple[int, int, int, int], size: int) -> np.ndarray`

- [ ] **Step 1: Write failing synthetic-frame tests**

Create tests that construct a blue-gray background, a colored body reaching the lower frame area, and a white eye enclosed by the body. Assert that corners are transparent, the body and enclosed eye are opaque, no fixed bottom strip is erased, shared bounds contain all body pixels, and the final RGBA canvas is square.

- [ ] **Step 2: Run the tests and confirm the current hard bottom cut fails**

Run: `python -m unittest tests/video_alpha_test.py -v`

Expected: at least `test_subject_touching_lower_area_is_preserved` fails because current code sets the bottom 11% alpha to zero.

- [ ] **Step 3: Replace the hard cut with a stable matte**

Use HSV background rejection only for border-connected low-saturation blue-gray pixels. Close small gaps, keep the largest center-intersecting subject component plus meaningful connected accessories, fill enclosed holes such as the white eye, then feather only the outer edge. Do not zero any fixed row range.

- [ ] **Step 4: Add one shared square subject crop**

Calculate bounds from the union of strong-alpha subject pixels across sampled frames, add 8% padding, and fit that region into a square RGBA canvas without stretching. Use one crop for every action so the pet does not jump in size or position between clips.

- [ ] **Step 5: Run the alpha unit tests**

Run: `python -m unittest tests/video_alpha_test.py -v`

Expected: all tests pass.

### Task 2: Stage and verify transparent animation assets

**Files:**
- Modify: `scripts/process-video.py`
- Create: `scripts/verify-video-alpha.py`
- Create: `tests/video_asset_verifier_test.py`
- Stage: `.tmp/transparent-video-output/*`

**Interfaces:**
- Produces: `verify_video(path: str) -> dict` with `alpha_mode`, `transparent_fraction`, `opaque_fraction`, `width`, `height`, and `frame_count`.

- [ ] **Step 1: Write verifier tests**

Generate one tiny opaque WebM and one tiny `yuva420p` WebM in a temporary directory. Assert the opaque file is rejected and the Alpha file is accepted only when decoded frames contain both alpha 0 and alpha 255 pixels.

- [ ] **Step 2: Run verifier tests and confirm failure**

Run: `python -m unittest tests/video_asset_verifier_test.py -v`

Expected: fail because `scripts/verify-video-alpha.py` does not exist.

- [ ] **Step 3: Implement staged output and poster generation**

Process the source at 24 fps into a 512×512 RGBA frame sequence. Encode each existing segment and the master clip with `libvpx-vp9`, `-pix_fmt yuva420p`, `-auto-alt-ref 0`, and the existing segment timings. Save a representative fully processed idle frame as `filemonster_poster.webp` with lossless Alpha.

- [ ] **Step 4: Implement true-alpha verification**

Use `ffprobe` to require `alpha_mode=1`. Decode representative beginning, middle, and ending frames to RGBA and require both transparent and opaque pixels. Require every clip to be 512×512 and non-empty. Return nonzero if any clip fails.

- [ ] **Step 5: Generate only into staging**

Run: `python scripts/process-video.py --input assets/source/filemonster_source.mp4 --frames .tmp/transparent-frames --out .tmp/transparent-video-output --width 512 --fps 24`

Expected: all segment WebMs, `filemonster_master.webm`, `filemonster_poster.webp`, and `manifest.json` exist under staging; `assets/videos` remains unchanged.

- [ ] **Step 6: Verify every staged asset**

Run: `python scripts/verify-video-alpha.py .tmp/transparent-video-output`

Expected: exit 0; every WebM reports `alpha_mode=1`, 512×512 dimensions, and both transparent and opaque pixels.

- [ ] **Step 7: Promote verified assets atomically**

Back up current `assets/videos` to `.tmp/videos-before-transparent-promotion`, then copy the complete verified staging set into `assets/videos`. Do not promote individual files.

### Task 3: Display the complete square subject without clipping

**Files:**
- Modify: `src/styles.css`
- Modify: `src/main.js`
- Modify: `src/index.html`
- Modify: `tests/regression.test.js`

**Interfaces:**
- Consumes: 512×512 transparent WebM clips and `filemonster_poster.webp` from Task 2.

- [ ] **Step 1: Add source-level regression assertions**

Assert `.video-wrap`, `#petVideo`, and `.pet-freeze` use the same square dimensions; assert `object-fit: contain`; assert the old `0.89` video-height multiplier is absent from video/window sizing; assert the video has the transparent WebP poster.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test`

Expected: new layout assertions fail against the current 0.89-height wrapper and window sizing.

- [ ] **Step 3: Align all visual layers**

Set the video wrapper to `width: var(--pet-preview-size)` and `height: var(--pet-preview-size)`. Set video and freeze canvas to `width: 100%`, `height: 100%`, and `object-fit: contain`. Align the drop halo with the same square stage, while leaving speech bubble and settings panel positioning unchanged.

- [ ] **Step 4: Align the native window**

Replace collapsed height calculations based on `size * 0.89` with `size + PET_EXTRA_HEIGHT`. Apply the same rule to minimum and expanded heights so Electron cannot clip the bottom of the video stage.

- [ ] **Step 5: Add the poster fallback**

Set `poster="../assets/videos/filemonster_poster.webp"` on `#petVideo`. Keep existing playback, loop, seek, freeze-canvas, and `ended` behavior unchanged.

- [ ] **Step 6: Run application tests and syntax checks**

Run: `npm test`

Expected: all regression tests pass.

Run: `npm run check`

Expected: all JavaScript syntax checks pass.

### Task 4: Final evidence-based acceptance

**Files:**
- Inspect: `assets/videos/*`
- Inspect: `src/styles.css`
- Inspect: `src/main.js`

- [ ] **Step 1: Re-run the complete automated checks**

Run: `python -m unittest tests/video_alpha_test.py tests/video_asset_verifier_test.py -v`

Run: `python scripts/verify-video-alpha.py assets/videos`

Run: `npm test`

Run: `npm run check`

Expected: every command exits 0.

- [ ] **Step 2: Inspect representative decoded frames**

Decode idle, scan, work, and success frames over a checkerboard. Confirm the full horns, hands, feet, carried accessories, and body are visible; confirm there is no blue-gray source background or fixed missing bottom strip.

- [ ] **Step 3: Report truthfully**

Report generated dimensions, verified Alpha metadata and pixel ranges, changed files, and any visible matte limitation. Do not claim visual perfection if checkerboard inspection shows edge residue or temporal flicker.
