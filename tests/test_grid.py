import numpy as np
import pytest

from ml.config import DEFAULT_RINGS, NUM_CLASSES
from ml.grid.varres_grid import EMPTY_CM, VarResGrid


@pytest.fixture
def grid():
    return VarResGrid(DEFAULT_RINGS)


def test_spec_geometry(grid):
    assert grid.size == 400
    assert list(grid.inner_hole) == [0, 200, 200, 160]
    assert grid.total_cells() == 160_000 + 120_000 + 120_000 + 134_400
    assert grid.uniform_2d_cells(0.05) == 16_000_000


def test_invalid_spec_rejected():
    with pytest.raises(AssertionError):
        VarResGrid([(10.0, 0.05), (25.0, 0.10)])  # 25 not a multiple that keeps size == 400


def test_ring_boundaries_half_open(grid):
    xy = np.array([[9.999, 0.0], [10.0, 0.0], [19.999, 0.0], [20.0, 0.0], [39.99, 0.0], [40.0, 0.0], [99.99, 0.0], [100.0, 0.0]])
    ring, i, j = grid.world_to_cell(xy)
    assert ring.tolist() == [0, 1, 1, 2, 2, 3, 3, 4]


def test_chebyshev_not_euclidean(grid):
    # (9, 9) has Euclidean dist 12.7 but Chebyshev 9 -> ring 0
    ring, _, _ = grid.world_to_cell(np.array([[9.0, 9.0]]))
    assert ring[0] == 0


def test_roundtrip_index_center(grid):
    rng = np.random.default_rng(0)
    xy = rng.uniform(-99.9, 99.9, size=(50_000, 2))
    ring, i, j = grid.world_to_cell(xy)
    valid = ring < grid.n_rings
    centers = grid.cell_center(ring[valid], i[valid], j[valid])
    ring2, i2, j2 = grid.world_to_cell(centers)
    assert np.array_equal(ring[valid], ring2)
    assert np.array_equal(i[valid], i2)
    assert np.array_equal(j[valid], j2)
    # centre must be within half a cell of the original point
    half = grid.cell[ring[valid]] / 2 + 1e-6
    assert np.all(np.abs(centers - xy[valid]) <= half[:, None])


def test_every_point_lands_once(grid):
    rng = np.random.default_rng(1)
    n = 40_000
    xyz = np.column_stack([rng.uniform(-120, 120, n), rng.uniform(-120, 120, n), rng.uniform(-2, 5, n)]).astype(np.float32)
    label = rng.integers(0, NUM_CLASSES, n).astype(np.uint8)
    frame = grid.project(xyz, label)
    in_range = np.max(np.abs(xyz[:, :2]), axis=1) < 100.0
    assert frame.points_dropped == int((~in_range).sum())
    counted = sum(int(r.count.sum()) for r in frame.rings)
    assert counted == int(in_range.sum())
    # hole cells must be empty
    for r in frame.rings:
        assert r.count[~r.annulus_mask()].sum() == 0


def test_height_and_label_semantics(grid):
    xyz = np.array([[1.0, 1.0, 0.0], [1.0, 1.0, 1.5], [1.0, 1.0, -0.2], [1.01, 1.02, 0.3]], dtype=np.float32)
    label = np.array([1, 3, 3, 0], dtype=np.uint8)  # two static votes, one drivable, one ignore
    frame = grid.project(xyz, label)
    ring, i, j = grid.world_to_cell(xyz[:1, :2])
    r0 = frame.rings[0]
    assert r0.count[i[0], j[0]] == 4
    assert r0.z_max_cm[i[0], j[0]] == 150
    assert r0.z_min_cm[i[0], j[0]] == -20
    assert r0.label[i[0], j[0]] == 3
    assert r0.confidence[i[0], j[0]] == round(255 * 2 / 3)
    # empty cell
    assert r0.z_max_cm[0, 0] == EMPTY_CM
    assert r0.label[0, 0] == 0


def test_only_ignore_points_keep_label_zero(grid):
    xyz = np.array([[0.5, 0.5, 0.0]], dtype=np.float32)
    frame = grid.project(xyz, np.array([0], dtype=np.uint8))
    _, i, j = grid.world_to_cell(xyz[:, :2])
    assert frame.rings[0].label[i[0], j[0]] == 0
    assert frame.rings[0].count[i[0], j[0]] == 1


def test_to_uniform_matches_lookup(grid):
    rng = np.random.default_rng(2)
    n = 20_000
    xyz = np.column_stack([rng.uniform(-90, 90, n), rng.uniform(-90, 90, n), rng.uniform(0, 1, n)]).astype(np.float32)
    label = rng.integers(1, NUM_CLASSES, n).astype(np.uint8)
    frame = grid.project(xyz, label)
    lab, zmax = grid.to_uniform(frame, 0.5)
    assert lab.shape == (400, 400)
    # spot-check a few uniform cells against direct lookup
    c = -100 + (np.arange(400) + 0.5) * 0.5
    for ui, uj in [(200, 200), (10, 390), (300, 50)]:
        ring, i, j = grid.world_to_cell(np.array([[c[ui], c[uj]]]))
        assert lab[ui, uj] == frame.rings[ring[0]].label[i[0], j[0]]


def test_memory_reduction_headline(grid):
    xyz = np.zeros((1, 3), dtype=np.float32)
    frame = grid.project(xyz, np.array([1], dtype=np.uint8))
    reduction_2d = grid.uniform_2d_bytes() / frame.storage_bytes()
    assert 25 < reduction_2d < 35
    assert grid.uniform_3d_bytes() / frame.storage_bytes() > 400
