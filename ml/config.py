"""Project-wide constants: paths, ring specification, class definitions."""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = PROJECT_ROOT / "data" / "nuscenes"
NUSC_VERSION = "v1.0-mini"
RESULTS_DIR = PROJECT_ROOT / "results"
CHECKPOINT_PATH = RESULTS_DIR / "salsanext_lite.pt"
METRICS_PATH = RESULTS_DIR / "metrics.json"

# ---------------------------------------------------------------------------
# Variable-resolution ring specification.
# (outer boundary in metres, cell size in metres). Rings are SQUARE annuli
# keyed on Chebyshev distance max(|x|, |y|) so cells never straddle a boundary.
# ---------------------------------------------------------------------------
DEFAULT_RINGS: list[tuple[float, float]] = [
    (10.0, 0.05),
    (20.0, 0.10),
    (40.0, 0.20),
    (100.0, 0.50),
]
MAX_RANGE_M = DEFAULT_RINGS[-1][0]

# Height-range assumptions used only for the uniform 3D baseline comparison.
UNIFORM_BASELINE_CELL_M = 0.05
UNIFORM_BASELINE_HEIGHT_M = 6.0

# ---------------------------------------------------------------------------
# Output semantic classes.
# ---------------------------------------------------------------------------
CLASS_NAMES: list[str] = [
    "ignore",
    "drivable",
    "terrain_nondrivable",
    "static_obstacle",
    "dynamic_object",
]
NUM_CLASSES = len(CLASS_NAMES)
IGNORE_INDEX = 0

CLASS_COLORS_HEX: list[str] = ["#1a1a1a", "#3b82f6", "#22c55e", "#a3a3a3", "#ef4444"]

# Distance bins (metres, Euclidean xy) used for accuracy-vs-distance reporting.
DISTANCE_BINS: list[tuple[float, float]] = [(0, 10), (10, 20), (20, 40), (40, 100)]

# nuScenes mini official split.
MINI_TRAIN_SCENES = [
    "scene-0061", "scene-0553", "scene-0655", "scene-0757",
    "scene-0796", "scene-1077", "scene-1094", "scene-1100",
]
MINI_VAL_SCENES = ["scene-0103", "scene-0916"]

# Range image geometry (nuScenes LIDAR_TOP has 32 beams).
RANGE_IMAGE_H = 32
RANGE_IMAGE_W = 1024
