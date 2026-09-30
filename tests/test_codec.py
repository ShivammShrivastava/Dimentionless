import numpy as np

from avr_lidar.config import NUM_CLASSES
from avr_lidar.data.nuscenes_loader import Frame
from avr_lidar.grid.varres_grid import VarResGrid
from avr_lidar.pipeline.infer import PipelineOutput
from avr_lidar.server.codec import decode, encode, encode_points


def _synthetic_output(n=30_000, seed=0):
    rng = np.random.default_rng(seed)
    xyz = np.column_stack([rng.uniform(-90, 90, n), rng.uniform(-90, 90, n), rng.uniform(-1, 4, n)]).astype(np.float32)
    label = rng.integers(0, NUM_CLASSES, n).astype(np.uint8)
    frame = Frame(
        scene="scene-test", idx=3, token="t", timestamp_us=123, xyz=xyz, intensity=np.zeros(n, np.float32),
        ring=np.zeros(n, np.int32), label=label, raw_label=label, ego_xy_yaw=(1.0, 2.0, 0.5),
    )
    grid = VarResGrid().project(xyz, label)
    return PipelineOutput(frame=frame, pred_label=label, grid=grid, latency_ms={"inference": 5.0, "projection": 3.0, "total": 8.0})


def _assert_roundtrip(buf, out):
    d = decode(buf)
    for r_dec, r_src in zip(d["rings"], out.grid.rings):
        assert r_dec["n"] == int((r_src.count > 0).sum())
        assert r_dec["idx"].dtype == np.dtype("<u4") and np.all(np.diff(r_dec["idx"]) > 0)
    assert d["scene"] == "scene-test" and d["idx"] == 3
    assert d["ego_pose"] == {"x": 1.0, "y": 2.0, "yaw": 0.5}
    assert len(d["rings"]) == 4
    for r_dec, r_src in zip(d["rings"], out.grid.rings):
        assert r_dec["cell_m"] == r_src.cell_m and r_dec["inner_hole"] == r_src.inner_hole
        assert np.array_equal(r_dec["label"], r_src.label)
        assert np.array_equal(r_dec["z_max_cm"], r_src.z_max_cm)
        assert np.array_equal(r_dec["z_min_cm"], r_src.z_min_cm)
        assert np.array_equal(r_dec["confidence"], r_src.confidence)
        assert np.array_equal(r_dec["count"], r_src.count)
    s = d["stats"]
    assert s["num_points"] == out.grid.num_points
    assert s["occupied_cells"] == out.grid.occupied_cells()
    assert s["memory_bytes"] == out.grid.storage_bytes()
    assert s["latency_ms"]["encode"] > 0
    assert len(s["class_counts"]) == NUM_CLASSES


def test_roundtrip_compressed():
    out = _synthetic_output()
    buf = encode(out, compress=True)
    assert buf[0] == 0x78  # zlib header
    _assert_roundtrip(buf, out)
    assert decode(buf)["stats"]["compressed"] is True


def test_roundtrip_raw():
    out = _synthetic_output()
    buf = encode(out, compress=False)
    assert buf[0] != 0x78
    _assert_roundtrip(buf, out)
    assert decode(buf)["stats"]["compressed"] is False


def test_sparse_payload_is_small_and_fast():
    import time

    out = _synthetic_output()
    t = time.perf_counter()
    raw = encode(out)  # default: sparse, uncompressed
    ms = (time.perf_counter() - t) * 1000
    dense_bytes = sum(r.size * r.size * 8 for r in out.grid.rings)
    assert len(raw) < dense_bytes / 10
    assert ms < 50
    assert raw[0] != 0x78
    assert len(encode(out, compress=True)) < len(raw)


def test_decode_sparse_mode():
    out = _synthetic_output()
    d = decode(encode(out), densify=False)
    r0 = d["rings"][0]
    assert r0["label"].shape == (r0["n"],)
    assert np.array_equal(out.grid.rings[0].label.ravel()[r0["idx"]], r0["label"])


def test_points_payload_subsamples():
    out = _synthetic_output()
    import msgpack

    d = msgpack.unpackb(encode_points(out.frame.xyz, out.pred_label, 5000), raw=False)
    assert d["n"] == 5000
    assert len(d["xyz"]) == 5000 * 3 * 4
    assert len(d["label"]) == 5000
