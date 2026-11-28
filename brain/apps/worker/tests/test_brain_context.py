"""v4.15 unit tests: the full-codebase read-context filters and the
read-only prompt block. Skips (rather than fails) where the mistral
workflows SDK is not installed in the test environment."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]) + "/src")

try:
    from worker.workflows.brain import _ctx_relpath, _ctx_skip, _ro_block
except Exception:  # pragma: no cover - SDK not installed in this env
    _ctx_relpath = _ctx_skip = _ro_block = None

pytest = None
try:
    import pytest
except Exception:  # pragma: no cover
    pass

if _ctx_skip is None and pytest is not None:
    pytest.skip("mistral workflows SDK unavailable", allow_module_level=True)


def test_ctx_relpath_strips_tarball_root():
    assert _ctx_relpath("owner-repo-abc123/src/engine.ts") == "src/engine.ts"
    assert _ctx_relpath("owner-repo-abc123/AGENT-CONTEXT.md") == "AGENT-CONTEXT.md"
    # no root component at all: nothing to strip, nothing to include
    assert _ctx_relpath("dangling") == ""


def test_ctx_skip_keeps_sources():
    for keep in (
        "src/engine.ts",
        "api/state.ts",
        "AGENT-CONTEXT.md",
        "public/map/level.json",
        "public/editor.html",
        "scripts/prebuild.mjs",
        "vercel.json",
        "README.md",
    ):
        assert not _ctx_skip(keep), keep


def test_ctx_skip_blocks_noise_and_secrets():
    for drop in (
        ".env",
        ".env.example",
        ".env.production",
        "package-lock.json",
        "uv.lock",
        "pnpm-lock.yaml",
        "public/favicon.svg",
        "assets-src/logo.png",
        "assets-src/sprites/idle_e.png.b64",
        "src/sprite.tiny.png",
        "dist/bundle.js",
        ".github/workflows/ci.yml",
        "audio/boom.mp3",
        "public/manifest.webmanifest",
        "db/cache.db",
    ):
        assert _ctx_skip(drop), drop


def test_ctx_skip_manifest_excludes():
    assert _ctx_skip("api/debug.ts", ["api/debug.ts"])
    assert _ctx_skip("src/private/mod.ts", ["src/private"])
    assert _ctx_skip("src/private/deep/x.ts", ["src/private"])
    assert not _ctx_skip("api/state.ts", ["api/debug.ts"])


def test_ro_block_full_context_header():
    from worker.workflows import brain

    saved = brain.FULL_CONTEXT
    brain.FULL_CONTEXT = True
    try:
        block = _ro_block({"src/engine.ts": "export const X = 1;"})
        assert "FULL CODEBASE" in block
        assert "(READ-ONLY" in block
        assert "src/engine.ts" in block
        assert "export const X = 1;" in block
    finally:
        brain.FULL_CONTEXT = saved
    # empty inbox renders no block at all
    assert _ro_block({}) == ""
