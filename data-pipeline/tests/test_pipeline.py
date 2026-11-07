import json

from chartpredict_data import config
from chartpredict_data.client import CachedSource
from chartpredict_data.pipeline import build, summarize
from chartpredict_data.synthetic import SyntheticSource


def test_end_to_end_synthetic(tmp_path):
    out1, out2 = tmp_path / "a", tmp_path / "b"
    res = build(SyntheticSource(missing_rate=0.002), out1, log=lambda *_: None)
    build(SyntheticSource(missing_rate=0.002), out2, log=lambda *_: None)

    index = json.loads((out1 / "index.json").read_text())
    assert index["count"] == sum(config.QUOTAS.values()) == 1000
    counts = {}
    for e in index["scenarios"]:
        counts[e["symbol"]] = counts.get(e["symbol"], 0) + 1
    assert counts == config.QUOTAS

    # reproducible: identical files from two independent runs
    files = sorted(p.name for p in out1.iterdir())
    assert files == sorted(p.name for p in out2.iterdir()) and len(files) == 1001
    for f in files[:50]:
        assert (out1 / f).read_bytes() == (out2 / f).read_bytes()

    # every scenario file is complete
    for e in index["scenarios"][:100]:
        s = json.loads((out1 / f"{e['id']}.json").read_text())
        assert len(s["window"]) == 30 and len(s["warmup"]) == 90 and len(s["daily"]) == 5
        assert 0 <= len(s["reveal"]) <= 60
        ts = [b[0] for b in s["warmup"] + s["window"] + s["reveal"]]
        assert ts == sorted(ts)

    text = summarize(res)
    assert "quotas matched exactly: YES" in text


def test_cache_prevents_refetch(tmp_path):
    inner = SyntheticSource()
    quotas = {"QQQ": 5}
    build(CachedSource(inner, tmp_path / "raw"), tmp_path / "o", quotas=quotas, log=lambda *_: None)
    first = inner.calls
    assert first > 300
    build(CachedSource(inner, tmp_path / "raw"), tmp_path / "o", quotas=quotas, log=lambda *_: None)
    assert inner.calls == first                       # second run: all from raw/ cache
    build(CachedSource(None, tmp_path / "raw", offline=True), tmp_path / "o", quotas=quotas,
          log=lambda *_: None)
