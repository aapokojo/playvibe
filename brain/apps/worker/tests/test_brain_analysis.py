"""Pure unit tests for the brain's analysis + version-bump helpers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]) + "/src")

from worker.workflows.brain_analysis import analyze_session, bump_version  # noqa: E402


def _session():
    return {
        "v": 1, "sid": "1795288800000-zzzz", "version": "v45", "mode": "ai",
        "durationMs": 44600, "ua": "ua", "screen": "390x844", "events": [
            {"ms": 0, "t": "session-start"},
            {"ms": 1000, "t": "turn"},
            {"ms": 9000, "t": "boom"},
            {"ms": 9200, "t": "load"},
            {"ms": 12000, "t": "stall"},
        ],
        "wire": [
            {"ms": 500, "k": "push-live", "d": {}},
            {"ms": 1000, "k": "push-live", "d": {}},
            {"ms": 4500, "k": "push-live", "d": {}},
        ],
        "snapshots": [{"ms": 9000, "tag": "boom", "data": "x"}, {"ms": 10500, "tag": "boom+1.5s", "data": "x"}],
    }


def test_analyze_counts():
    m = analyze_session(_session(), "Peli toimi hyvin.")
    assert m["booms"] == 1
    assert m["stalls"] == 1
    assert m["loads"] == 1
    assert len(m["midTurnLoads"]) == 1
    assert len(m["pumpStalls"]) == 1
    assert m["boomLateSnapshots"] == 1


def test_bump_version():
    assert bump_version("v45") == "v45.1"
    assert bump_version("v45.1") == "v45.2"
    assert bump_version("bogus") == ""


def test_analyze_custom_vocab():
    s = _session()
    s["events"] = [
        {"ms": 0, "t": "session-start"},
        {"ms": 1000, "t": "turn"},
        {"ms": 9000, "t": "boom"},  # not in the custom vocab: ignored
    ]
    s["wire"] = [
        {"ms": 0, "k": "push-live", "d": {}},
        {"ms": 5000, "k": "hb", "d": {}},
        {"ms": 7500, "k": "hb", "d": {}},
    ]
    s["snapshots"] = [{"ms": 1000, "tag": "blast", "data": "x"}]
    m = analyze_session(s, "", key_events=("blast",), heartbeat=("hb",))
    assert m["booms"] == 0
    assert m["boomSnapshots"] == 1
    assert m["boomLateSnapshots"] == 0
    assert len(m["pumpStalls"]) == 1  # 2500 ms gap between the two hb taps
    assert m["turns"] == 1
