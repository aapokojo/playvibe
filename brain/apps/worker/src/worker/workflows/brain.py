"""Playvibe brain — on-demand session analysis + autonomous App-lane fixes.

Started by the game's test panel analyze button: the game's kick route
calls POST /v1/workflows/playvibe-brain/execute with
{"input": {"sid": ..., "origin": ...}, "deployment_name": the game's own
deployment}. Pipeline per session sid:

  1. take the game origin from the run input, load the game's playvibe
     manifest (GET {origin}/api/manifest) and reassign every per-game
     constant from it — a missing or invalid manifest fails the run
     named (v4.10)
  2. mirror stage "analyzing" into the brain-state doc (the test panel
     polls it every 30 s and renders the stages live)
  3. fetch the session JSON (session store prefix + sid index/parts,
     reassembled in order), the transcript (transcript store prefix +
     sid, written by the game's transcription route) and, when the
     githubToken env is bound, the current app source file from GitHub
     plus the game's context file from the repo root (the game's ONE
     context keeper — lanes, boundaries, UI conventions, known pitfalls —
     rendered as the verdict/edit prompts' GAME CONTEXT block; with it
     the prompts carry only game-agnostic edit mechanics. Fail-open: a
     missing context file degrades the prompt, never kills the run.
     Its lastVerifiedAt stamp is compared against the live version
     literal and a mismatch is reported as a stale-context advisory,
     never a gate) — and, when the manifest declares brain.fullContext
     (v4.15), ONE tarball of main: every text source file in the repo
     enters the same read-only prompt lane (noise + secrets filtered,
     60 KB per file, brain.contextMaxKB total; the apply gate is
     untouched — only the app file stays editable)
  4. deterministic analysis (the session ritual, ported to
     brain_analysis.analyze_session: event/wire histograms, pump
     cadence, freezes, boundary-load hunt, key-event snapshot pairing)
  5. Mistral model verdict (structured): clean | app_fix | game_logic
     - clean   -> stage done "no changes: everything as designed"
     - game_logic -> stage waiting + push + ONE in-game question (the
                  game's agent-qa route); the next brain run or
                  on-demand agent flow consumes the player's answer
     - app_fix -> gate-check the model's edits (target evidence, unique
                  anchors, per-file lane), bump the single version
                  constant in the game's version file, push ONE atomic
                  commit to main, live-verify the game origin serves
                  the new bundle and target-check the fix against the
                  narration, only then stage done + push the new version
  6. write a session report (report store prefix + sid) that the
     on-demand agent flow mirrors into the project notes

Store: the session/transcript/report/state lane lives in the game's
store, reached ONLY through the AGENT_TOKEN-guarded store broker the
manifest declares (Redis first, textdb fallback for pre-migration
sessions). The workflow holds no store credentials. There is no
scheduled poll: every run is on demand (the game's kick or queue).

HARD RULES (fail-safe by construction):
  - the manifest's editable app file is the ONLY editable file; the
    installed test-mode package sources are READ-ONLY context and the
    version file is bumped ONLY by the pipeline; every other path is
    untouchable. Narration about the test panel itself classifies
    game_logic (the panel is maintained by the dev agents, not the brain)
  - every gate failure aborts BEFORE the push and names the reason
    honestly in the brain-state note and the notify push
  - a STRUCTURAL BALANCE GATE guards the push — the sum of tag-balance
    deltas over the whole edit proposal must be zero (a lone inserted
    closing tag once passed every gate and broke the build); the fixlog
    and report store edit pairs UNTRUNCATED (a revert inverts exactly
    what is stored — a length cap once cut the pair mid-span and would
    have left the build-breaking tail in place); a push whose bundle
    never confirms is named as a probable build failure (note, notify,
    and the fixlog entry's live:false) so the player knows main needs
    healing instead of just a reload
  - dry_run=true suppresses all external side effects (push/notify/agent-qa)
    so smoke tests exercise the whole pipeline without shipping anything
  - signing: when the signKey env is bound, every session/transcript doc
    must carry the game's HMAC-SHA256 tag and every part must match its
    signed digest; unsigned or edited input is rejected BEFORE any model
    call or push — an anonymous store write can no longer steer the
    brain. Without the key verification is skipped (fail-open cutover:
    the doc must already exist in the game's env first).

v4.10 (manifest-driven + English notes + structured pushed flag):
  - ALL per-game configuration travels in the game's playvibe manifest,
    served at GET {origin}/api/manifest. Every run loads the manifest
    FIRST (activity pv-load-manifest) and reassigns the module
    constants via _apply_manifest: repo, source paths, store
    prefixes/keys, queue route, env var names, notify tag/title, and the
    analysis vocabulary (analysis.keyEvents / analysis.heartbeat drive
    analyze_session). A missing or invalid manifest fails the run NAMED;
    the brain never silently runs on another game's defaults.
  - the brain writes ENGLISH everywhere it hardcodes text (state notes,
    notify pushes, gate reasons, ledger descs, and the prompts' language
    rules for model-written player-facing content). Narration transcripts
    stay in the player's own language.
  - pv_stage takes an optional `pushed` flag: the brain-state doc's
    `current` row carries pushed:true/false on done stages so the panel
    renders "did not land" from structured data instead of a note
    prefix. Gate-refused fixes and refused reverts carry pushed:false;
    verified fixes/reverts carry pushed:true.

v4.11 (full manifest routing + derived file labels):
  - the store broker (routes.broker), result pushes (routes.notify) and
    the question lane (routes.agentqa) are built from the manifest like
    the queue route already was.
  - the editable/version FILE LABELS are derived from the manifest's
    brain.appPath / brain.versionPath basenames (APP_LABEL / VER_LABEL):
    gates, prompts, commit messages and stored edit rows all speak the
    game's own file names; FixEdit.file defaults to "" (= the manifest's
    app file).
  - brain.versionScheme and brain.liveVerify are validated against the
    implemented set ("vNN-patch", "bundle-filename"): a game declaring
    anything else fails the run named at manifest load.

v4.12 (non-unique anchor teaching): the edit gate's >1x refusal carries
  the match LINE NUMBERS and each occurrence EXTENDED VERBATIM with its
  neighboring lines (the raw bytes), and the retry prompt teaches
  building a unique anchor from them: sibling elements that share
  identical markup need a distinguishing attribute line (id / data-* /
  aria-*) from ABOVE or the child/content line from BELOW, copied
  byte-for-byte. Both live failure shapes taught this: re-proposing the
  same shared class-only anchor, and re-typing indentation instead of
  copying the fetched bytes. The phase-2 edits prompt states the
  whitespace rule and the sibling disambiguation up front, not only in
  retry feedback.

v4.13 (installed-package panel): the test-mode sources are an INSTALLED
  package (node_modules), not part of the game repo, so the panel
  context fetch is OPTIONAL everywhere, fail-open like the context
  keeper: a present panel gets its sanity check, an absent one degrades
  the prompt and never kills the run or blocks the push. pv_apply and
  pv-fetch-sources require only the editable app file and the version
  bump spot. The editable-file lane is enforced structurally: the brain
  cannot edit panel files that are not in the game repo at all.

v4.14 (generic template — zero game values in this file): the game
  origin arrives IN THE RUN INPUT ({sid, dry_run, origin}); the
  deployment itself carries no per-game value. The workflow routing
  identifier is the package constant "playvibe-brain" (per-game
  deployments are distinguished by deployment_name in the execute body).
  The transcript store prefix joins the manifest contract
  (storePrefixes.transcript). The import-time constants below are
  neutral placeholders; every real value comes from the manifest.

v4.15 (full-codebase read context): a game may declare
  brain.fullContext: true in its manifest — the brain then fetches ONE
  tarball of the repo's main branch and renders EVERY text source file
  into the same read-only prompt lane as v4.14's readOnlyPaths: noise
  (binaries, lockfiles, build output, vendor dirs) and secret-bearing
  files (.env*) are filtered out (_ctx_skip), each file caps at 60 KB
  and the whole fetch at brain.contextMaxKB (default 350 KB;
  brain.contextExclude adds game-specific files/directory prefixes).
  The fetch is fail-open: a tarball problem degrades the prompt, never
  the run, and the report's full_context flag says which happened. The
  apply gate is UNTOUCHED: full sight, unchanged edit rights — only the
  manifest's appPath stays editable and target_evidence still must
  quote it alone.
"""

import json
import os
import re
from datetime import timedelta
from typing import Any, Literal

import mistralai.workflows as workflows
from pydantic import BaseModel, Field

from .brain_analysis import (
    analyze_session,
    bump_version,
    context_last_verified,
    edits_prompt,
    tag_balance_delta,
    verdict_prompt,
)

# v4.14: manifest-driven configuration. Every per-game value comes from
# the game's playvibe manifest, fetched at run start from the origin the
# game's kick passes in the run input. The import-time constants below
# are NEUTRAL placeholders — they keep module import resolvable and give
# the pre-manifest error path something honest to write to — but no real
# run ever uses them: a missing or invalid manifest fails the run named
# (pv-load-manifest). A second game needs only its own deployment and
# its own kick origin; zero code changes.
ORIGIN = ""  # the game origin, set by pv_load_manifest from the run-input arg

KV = "https://textdb.online"  # legacy reference only; reads go through the manifest's broker route
SESS_PREFIX = "sess-"
TRANS_PREFIX = "trans-"
REPORT_PREFIX = "report-"
STATE_KEY = "brain-state"
GAME = ""
BROKER = ""  # AGENT_TOKEN-guarded store broker URL (Redis + textdb fallback)
GITHUB = "https://api.github.com"
REPO = "repos/example-owner/example-game"
APP_PATH = "src/App.tsx"
PANEL_PATH = "src/testmode/TestPanel.tsx"
CTL_PATH = "src/testmode/controller.ts"
QA_PATH = "src/testmode/QAInput.tsx"
VER_PATH = "src/version.ts"
# the editable/version FILE LABELS are derived (basenames of the
# manifest's paths) — the whole pipeline speaks the game's own file names.
APP_LABEL = "App.tsx"
VER_LABEL = "version.ts"
NOTIFY_URL = ""  # manifest routes.notify
QA_URL = ""  # manifest routes.agentqa
# the game's context keeper (repo root) — the game's ONE context file,
# rendered as the verdict/edit prompts' GAME CONTEXT block
CONTEXT_PATH = "AGENT-CONTEXT.md"
# v4.14: the manifest's brain.readOnlyPaths beyond the standard
# test-tooling slots — fetched READ-ONLY each run so the model can SEE
# (and honestly name) mechanisms it may never edit (engine.ts & co).
RO_PATHS: list[str] = []
# v4.15: FULL CODEBASE CONTEXT (manifest brain.fullContext) — the game
# opts in and the brain fetches ONE tarball of main, rendering every
# text source file into the same read-only lane (filters + caps in
# _ctx_skip / pv_fetch). Off by default; the apply gate is untouched.
FULL_CONTEXT = False
CTX_MAX_KB = 350  # total budget across all full-context files
CTX_EXCLUDE: list[str] = []  # extra repo paths (file or dir prefix) to skip
FILE_PATHS = {"App.tsx": APP_PATH, "TestPanel.tsx": PANEL_PATH, "version.ts": VER_PATH}
VERDICT_MODEL = "mistral-medium-latest"
MAX_PARTS = 64
FIXLOG_KEY = "fixlog"  # the player-visible fix log (broker)
QUEUE_ADVANCE = ""  # the analysis-queue advance route (manifest routes.fixes)
_PV_UA = {"User-Agent": "playvibe-brain/1.0"}

SID_PATTERN = r"^\d{12,14}-[0-9a-z]{4}$"
NOTIFY_TAG = "brain-analysis"
NOTIFY_TITLE = ""

_M: dict[str, Any] = {}
_ENV_DEFAULTS = {
    "agentToken": "PV_AGENT_TOKEN",
    "githubToken": "PV_GITHUB_TOKEN",
    "signKey": "PV_SIGN_KEY",
}


def _m(path: str = "", default: Any = None) -> Any:
    """Dotted lookup into the loaded manifest ({} before load — callers'
    `or` fallbacks keep pre-manifest paths honest)."""
    cur: Any = _M
    for part in path.split("."):
        if not isinstance(cur, dict):
            return default
        cur = cur.get(part)
    return cur if cur is not None else default


def _env(name_key: str) -> str:
    """os.environ read whose VARIABLE NAME comes from the manifest's env
    section; the import-time defaults cover the pre-manifest error path."""
    name = str(_m("env." + name_key) or _ENV_DEFAULTS.get(name_key) or "")
    return os.environ.get(name, "")


def _apply_manifest(manifest: dict[str, Any]) -> None:
    """v4.10: reassign the module constants from the game's playvibe
    manifest (one deployment serves one game, so globals are safe and
    every existing call-site name stays unchanged)."""
    global GAME, BROKER, REPO, APP_PATH, PANEL_PATH, CTL_PATH, QA_PATH, VER_PATH
    global CONTEXT_PATH, SESS_PREFIX, TRANS_PREFIX, REPORT_PREFIX, STATE_KEY, FIXLOG_KEY
    global QUEUE_ADVANCE, FILE_PATHS, NOTIFY_TAG, NOTIFY_TITLE
    global APP_LABEL, VER_LABEL, NOTIFY_URL, QA_URL, RO_PATHS
    global FULL_CONTEXT, CTX_MAX_KB, CTX_EXCLUDE
    brain = manifest.get("brain") or {}
    origin = str(brain.get("origin") or GAME).rstrip("/")
    GAME = origin
    REPO = "repos/" + str(manifest.get("repo") or REPO[len("repos/"):])
    APP_PATH = str(brain.get("appPath") or APP_PATH)
    VER_PATH = str(brain.get("versionPath") or VER_PATH)
    by_name = {str(p).rsplit("/", 1)[-1]: str(p) for p in (brain.get("readOnlyPaths") or [])}
    PANEL_PATH = by_name.get("TestPanel.tsx", PANEL_PATH)
    CTL_PATH = by_name.get("controller.ts", CTL_PATH)
    QA_PATH = by_name.get("QAInput.tsx", QA_PATH)
    # v4.14: readOnlyPaths double as READ-ONLY CONTEXT fetches — files the
    # model may see and quote but never edit. The standard slots (app,
    # panel, controller, QA, version, context file) fetch by their own
    # paths, so they are excluded here to avoid double fetches.
    RO_PATHS = [
        str(p)
        for p in (brain.get("readOnlyPaths") or [])
        if isinstance(p, str) and p and p not in (APP_PATH, PANEL_PATH, CTL_PATH, QA_PATH, VER_PATH, CONTEXT_PATH)
    ]
    # v4.15: full-codebase read context — the game opts in via
    # brain.fullContext; brain.contextMaxKB (default 350) caps the
    # total prompt budget and brain.contextExclude adds game-specific
    # files/directory prefixes to the built-in noise filters.
    FULL_CONTEXT = bool(brain.get("fullContext"))
    try:
        CTX_MAX_KB = max(50, int(brain.get("contextMaxKB") or 350))
    except (TypeError, ValueError):
        CTX_MAX_KB = 350
    CTX_EXCLUDE = [str(x) for x in (brain.get("contextExclude") or []) if str(x)]
    CONTEXT_PATH = str(manifest.get("contextFile") or CONTEXT_PATH)
    prefixes = manifest.get("storePrefixes") or {}
    SESS_PREFIX = str(prefixes.get("session") or SESS_PREFIX)
    TRANS_PREFIX = str(prefixes.get("transcript") or TRANS_PREFIX)
    REPORT_PREFIX = str(prefixes.get("report") or REPORT_PREFIX)
    STATE_KEY = str(prefixes.get("brainState") or STATE_KEY)
    FIXLOG_KEY = str(brain.get("fixlogKey") or FIXLOG_KEY)
    routes = manifest.get("routes") or {}
    BROKER = GAME + str(routes.get("broker") or "/api/broker")
    QUEUE_ADVANCE = GAME + str(routes.get("fixes") or "/api/fixes")
    NOTIFY_URL = GAME + str(routes.get("notify") or "/api/notify")
    QA_URL = GAME + str(routes.get("agentqa") or "/api/agentqa")
    NOTIFY_TAG = str(brain.get("notifyTag") or NOTIFY_TAG)
    NOTIFY_TITLE = re.sub(r"^www\.", "", GAME.split("//")[-1].split("/")[0])
    APP_LABEL = APP_PATH.rsplit("/", 1)[-1]
    VER_LABEL = VER_PATH.rsplit("/", 1)[-1]
    FILE_PATHS = {APP_LABEL: APP_PATH, "TestPanel.tsx": PANEL_PATH, VER_LABEL: VER_PATH}


@workflows.activity(
    name="pv-load-manifest",
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def pv_load_manifest(origin: str = "") -> str:
    """v4.10: fetch the game's playvibe manifest (GET
    {ORIGIN}/api/manifest — the origin passed in the run input) and apply it. The route must serve
    {v: 1, manifest: {...}} with every required per-game field; a
    missing or invalid manifest fails the run NAMED here, before any
    store read, model call or push — the brain must never silently
    run on another game's import-time defaults."""
    import httpx

    # v4.14: the workflow body runs in the orchestrator, activities in
    # worker processes — the origin arrives as an ARGUMENT and is set on
    # THIS module (the worker's own globals) exactly like _apply_manifest
    # does, so every later activity reads it.
    global ORIGIN
    origin = (origin or "").strip().rstrip("/")
    if not origin.startswith(("http://", "https://")):
        raise workflows.WorkflowError(
            "origin_missing: pass the game origin in the run input",
            non_retryable=True,
        )
    ORIGIN = origin
    async with httpx.AsyncClient(timeout=30, headers=_PV_UA, follow_redirects=True) as c:
        r = await c.get(f"{ORIGIN}/api/manifest")
        if r.status_code != 200:
            raise workflows.WorkflowError(f"manifest_fetch_{r.status_code}", non_retryable=True)
        try:
            d = r.json()
        except ValueError:
            raise workflows.WorkflowError("manifest_not_json", non_retryable=True) from None
    m = d.get("manifest") if isinstance(d, dict) else None
    missing: list[str] = []
    brain = m.get("brain") if isinstance(m, dict) else None
    if not isinstance(brain, dict):
        missing.append("brain")
    else:
        missing += [f"brain.{k}" for k in ("origin", "appPath", "versionPath", "fixlogKey", "notifyTag", "readOnlyPaths") if not brain.get(k)]
        # v4.11: honest enum gates — the pipeline implements exactly one bump
        # scheme and one live-verify shape; a game declaring anything else
        # fails the run NAMED here instead of bumping or verifying wrong.
        if str(brain.get("versionScheme") or "") != "vNN-patch":
            missing.append(f"brain.versionScheme={brain.get('versionScheme')!r} unsupported (vNN-patch only)")
        if str(brain.get("liveVerify") or "") != "bundle-filename":
            missing.append(f"brain.liveVerify={brain.get('liveVerify')!r} unsupported (bundle-filename only)")
    analysis = m.get("analysis") if isinstance(m, dict) else None
    if not isinstance(analysis, dict) or not analysis.get("keyEvents") or not analysis.get("heartbeat"):
        missing.append("analysis.keyEvents/heartbeat")
    if isinstance(m, dict):
        missing += [k for k in ("repo", "contextFile") if not m.get(k)]
        prefixes = m.get("storePrefixes")
        if not isinstance(prefixes, dict) or not prefixes.get("brainState") or not prefixes.get("transcript"):
            missing.append("storePrefixes.brainState/transcript")
        routes = m.get("routes")
        if not isinstance(routes, dict):
            missing.append("routes")
        else:
            missing += [f"routes.{k}" for k in ("broker", "fixes", "notify", "agentqa") if not routes.get(k)]
    else:
        missing.append("manifest")
    if missing:
        raise workflows.WorkflowError(f"manifest_invalid: {', '.join(missing)[:120]}", non_retryable=True)
    _M.update(m)
    _apply_manifest(m)
    return f"manifest ok: {m.get('repo')} {m.get('version')}"


class BrainInput(BaseModel):
    sid: str = Field(pattern=SID_PATTERN)
    dry_run: bool = False
    # v4.14: the game origin arrives IN THE RUN INPUT — the deployment
    # itself carries zero per-game values (the kick/execute body sets it)
    origin: str = ""
    # reversals arrive from the player's panel queue (deterministic,
    # no model call); sid stays the fix entry's original session sid
    # (display + report only)
    action: str = "analyze"
    fix_id: str = ""


# v4.9.2: no EditableFile Literal — a strict Literal would make a
# TestPanel-proposing verdict UNPARSEABLE and crash the run; `file` is a
# free string and the pv_apply gate refuses non-App.tsx edits honestly.


class FixEdit(BaseModel):
    old: str = Field(
        description="verbatim snippet of the target file, appears exactly once, copy-pasted including special characters like the middle dot and arrow keys"
    )
    new: str = Field(
        description="the replacement text, non-empty, different from old"
    )
    # v4.9.2: `file` is a free string on purpose (a strict Literal would
    # make a TestPanel-proposing verdict UNPARSEABLE and crash the run) —
    # the pv_apply gate refuses edits outside the manifest's app file
    # with an honest reason
    file: str = Field(
        default="",
        description="the file this edit applies to; empty = the editable app file named by the game manifest, the only file the brain may edit (the test panel files are read-only for the brain)",
    )


class Verdict(BaseModel):
    # ACTION FIELDS FIRST. Guided JSON emits fields in
    # declaration order; when findings/reasoning came first the model
    # spent its output on prose and left edits/fix_description/
    # target_evidence empty in 4/4 rounds of a past run's second attempt. The action
    # fields are now emitted before the prose can consume the budget.
    classification: Literal["clean", "app_fix", "game_logic"]
    fix_description: str = Field(
        default="",
        description="one short English sentence naming the fix AND the source label it touches",
    )
    edits: list[FixEdit] = []
    # v4.4: verbatim snippet of the narrated label/button exactly as it
    # appears in the editable sources - the target-evidence gate requires
    # it to be findable in App.tsx before edits may apply
    # (v4.9.2: the editable lane is App.tsx ONLY)
    target_evidence: str = Field(
        default="",
        description="ONE short contiguous snippet copy-pasted verbatim from the editable app file: the exact text of the label/button/element the narration mentions",
    )
    findings: list[str] = []
    reasoning: str = ""
    question: str = ""
    options: list[str] = []


class EditList(BaseModel):
    """v4.9.3 phase 2: an edits-only emission round. The six empty-edits
    past sessions all solved the fix inside
    the verdict's reasoning field but committed `edits` BEFORE it (guided
    JSON emits schema fields in order; v4.7 put the action fields first),
    so tricky fixes arrived with edits=[]. Phase 1 commits the diagnosis
    (classification + target_evidence + fix_description); THIS round, run
    after it, emits nothing but the edits implementing that diagnosis."""
    edits: list[FixEdit] = []


class TargetCheck(BaseModel):
    """v4.4 second opinion: did the applied edits target what the narration
    actually asked for? Both false-verified rounds (one invented a
    nonexistent theme-label key via a transcription artifact, the other
    rewrote the wrong label)
    would have been flagged here."""
    on_target: bool
    why: str = ""


class BrainResult(BaseModel):
    sid: str
    stage: str
    note: str
    classification: str
    findings: list[str]
    pushed: bool = False
    verified: bool = False
    new_version: str | None = None
    on_target: bool | None = None


# ---------------------------------------------------------------- helpers
# (plain functions, called from inside activities only — all I/O is theirs)


def _qa_block(qa_ctx: dict[str, Any]) -> str:
    """v4.14: render the consumed player answers as a prompt block. Each
    answer is paired with its asked question (the consume response
    carries both docs); an empty inbox renders no block at all."""
    answers = qa_ctx.get("answers") or []
    questions = qa_ctx.get("questions") or []
    by_id = {str(q.get("id")): q for q in questions if isinstance(q, dict)}
    lines: list[str] = []
    for a in answers:
        q = by_id.get(str(a.get("id"))) or {}
        text = str(q.get("text") or "")
        opts = " / ".join(str(o) for o in (q.get("opts") or []))
        choice = str(a.get("choice") or "")
        lines.append(
            "- Q: " + (text[:300] or "(question text unavailable)")
            + (f" [options: {opts[:200]}]" if opts else "")
            + " -> A: " + (choice[:200] or "(empty)")
        )
    if not lines:
        return ""
    return (
        "PLAYER ANSWERS (answers the player gave in the test panel to the\n"
        "agent's earlier questions about this game — the player's own words,\n"
        "ground truth for intent: weight them BEFORE the narration and say\n"
        "in `findings` how they shaped this verdict):\n"
        + "\n".join(lines)
        + "\n\n"
    )


def _ro_block(ro_srcs: dict[str, str] | None) -> str:
    """v4.14: render the manifest's extra read-only sources as READ-ONLY
    context. Seeing them lets the model NAME the real mechanism behind a
    narration (and classify engine-side defects honestly as game_logic)
    instead of fabricating anchors in code it never saw; the apply gate
    still requires every edit and target_evidence to live in the
    editable file alone.
    v4.15: with brain.fullContext the same lane carries the WHOLE
    codebase (one tarball of main, filtered + capped) and the header
    says so — full sight, unchanged edit rights."""
    if not ro_srcs:
        return ""
    if FULL_CONTEXT:
        head = (
            "FULL CODEBASE below (brain.fullContext): every text source\n"
            "file in the repo, READ-ONLY. Quote ANY of them to NAME the\n"
            "mechanism a narration describes, and classify a defect that\n"
            f"lives outside {APP_LABEL} as game_logic (an honest question\n"
            "or findings entry — never an edit targeting them). Your edits\n"
            f"and target_evidence still come from {APP_LABEL} = {APP_PATH}\n"
            "ALONE.\n"
        )
    else:
        head = (
            "READ-ONLY SOURCES below: quote them to NAME the mechanism a\n"
            "narration describes, and classify a defect that lives in them as\n"
            "game_logic (an honest question or findings entry — never an\n"
            "app_fix targeting them). Your edits and target_evidence still\n"
            "come from the editable file ONLY.\n"
        )
    out: list[str] = [head]
    for fpath in sorted(ro_srcs):
        name = fpath.rsplit("/", 1)[-1]
        out.append(f"--- {name} = {fpath} (READ-ONLY — NEVER EDIT) ---\n```tsx\n{ro_srcs[fpath]}\n```\n")
    return "\n".join(out) + "\n"


def _pv_token() -> str:
    """The game's AGENT_TOKEN (bound via the manifest's env agentToken
    name): the same credential pv_notify/pv_ask already use. The broker resolves
    Redis-first with a textdb fallback, so pre-migration sessions and
    transcripts stay readable."""
    return _env("agentToken")


async def _pv_call(client, payload: dict) -> dict | None:
    r = await client.post(BROKER, json=payload)
    if r.status_code != 200:
        raise workflows.WorkflowError(f"pv_http_{r.status_code}")
    try:
        d = r.json() if r.text else {}
        return d if isinstance(d, dict) else None
    except ValueError:
        raise workflows.WorkflowError("pv_bad_response") from None


async def _kv_get_raw(client, key: str) -> str | None:
    d = await _pv_call(client, {"token": _pv_token(), "action": "get", "key": key})
    v = (d or {}).get("value")
    return v if isinstance(v, str) and v else None


async def _kv_get_json(client, key: str) -> dict | None:
    v = await _kv_get_raw(client, key)
    if v is None:
        return None
    try:
        d = json.loads(v)
        return d if isinstance(d, dict) else None
    except ValueError:
        return None


async def _kv_put(client, key: str, value: str) -> None:
    d = await _pv_call(client, {"token": _pv_token(), "action": "put", "key": key, "value": value})
    if not (d or {}).get("ok"):
        raise workflows.WorkflowError("pv_rejected", non_retryable=True)


def _sign_key() -> str:
    """v4.2 (signing C): the session-doc signing key. Bound via the
    workspace secret pv_sign_key (the manifest's env signKey name); empty = fail-open
    (verification skipped, the pre-v4.2 behavior) until the cutover
    completes."""
    return _env("signKey")


def _doc_sig(kv_key: str, doc: dict) -> str:
    """v4.2: HMAC-SHA256 over kv_key + U+241F + the canonical compact JSON
    of the doc. The api writers build the same bytes with JSON.stringify
    (no spaces, sig placed LAST, non-ASCII left unescaped) — the reader
    pops `sig` first and re-serializes with json.dumps(ensure_ascii=False,
    separators=(",", ":")); insertion order preserves the writer's order."""
    import hashlib
    import hmac

    body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    msg = f"{kv_key}\u241f{body}".encode("utf-8")
    return hmac.new(_sign_key().encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _gh_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "playvibe-brain/1.0",
    }


def _retryable_gate(reason: str) -> bool:
    """v4: which pv_apply failures deserve feedback retries (up to two).

    Only model-quality failures (bad/empty/identical anchors or contract
    violations). Policy and size gates (engine/net lane, version spots,
    size delta) stay final: a retry must never argue its way past a
    safety gate."""
    r = reason.strip()
    return (
        r.startswith("old string not unique")
        or r == "no edits"
        or r.startswith("empty or identical edit")
        or r.startswith("target evidence")
        # an unbalanced tag proposal is a model-quality
        # failure — the retry round teaches the closing-tag move contract
        or r.startswith("tag balance broken")
    )


def _anchor_excerpt(app_src: str, old: str, width: int = 400) -> str:
    """v3: closest source region around a rejected anchor (fuzzy match)."""
    import difflib

    sm = difflib.SequenceMatcher(None, old, app_src, autojunk=False)
    blocks = [b for b in sm.get_matching_blocks() if b.size >= 12]
    if not blocks:
        return ""
    best = max(blocks, key=lambda b: b.size)
    start = max(0, best.b - width // 2)
    end = min(len(app_src), best.b + best.size + width // 2)
    return app_src[start:end]


def _anchor_feedback(outcome: dict[str, Any], app_src: str | None, panel_src: str | None = None) -> str:
    """v3: second-chance prompt block after a rejected anchor (v4.4: the
    verbatim excerpt is taken from the file the rejected edit named)."""
    old = str(outcome.get("failed_old") or "")
    n = outcome.get("failed_count", "?")
    reason = str(outcome.get("reason") or "?")
    tgt = panel_src if str(outcome.get("file") or "") == "TestPanel.tsx" else app_src
    tgt = tgt or app_src
    lines = [
        "",
        "--- RETRY: THE GATE REJECTED YOUR PREVIOUS EDITS ---",
        f"Gate failure: {reason}",
        f"The old string below was found {n} time(s) in {str(outcome.get('file') or APP_PATH)}, so the edit was NOT applied.",
        "Re-propose the FULL edits list with the SAME schema (classification stays app_fix).",
        "The `old` anchor must appear EXACTLY ONCE, copied verbatim character-for-character",
        f"from {APP_PATH}. Do not invent anchors: copy them from the source excerpt below",
        "or from the source you were given.",
        "Rejected old string (truncated):",
        old[:600] if old else "(empty)",
        "",
    ]
    excerpt = _anchor_excerpt(tgt, old) if (old and tgt) else ""
    if excerpt:
        lines += ["Closest matching source region (use verbatim):", excerpt, ""]
    exts = outcome.get("extensions") or []
    mlines = outcome.get("lines") or []
    # a >1x anchor means SIBLINGS share the markup. Name
    # the match line numbers and hand back each occurrence extended
    # verbatim with its neighbors, then teach HOW to make the anchor
    # unique from those real bytes (attribute line above / content
    # line below). Never truncates the extension lines: the model must
    # be able to copy them exactly.
    if isinstance(exts, list) and exts:
        where = ", ".join(str(x) for x in mlines[:8]) if isinstance(mlines, list) and mlines else "?"
        lines += [
            f"Your anchor matched {n} sibling elements that share the SAME markup",
            f"(their line numbers: {where}). A class-only or single-line anchor",
            "can NEVER be unique here. Re-propose with an anchor that matches",
            "EXACTLY ONE occurrence:",
            "- EXTEND it with REAL source lines copied verbatim from the",
            "  occurrences below: a distinguishing attribute (id / data-* /",
            "  aria-*) usually sits on the line ABOVE the shared line; the",
            "  child/content line sits BELOW it.",
            "- NEVER re-type whitespace or indentation: copy the bytes",
            "  exactly (a re-typed anchor is the known 0x trap).",
            "The occurrences, extended verbatim (build your `old` from ONE):",
        ]
        for t in exts[:4]:
            lines += ["  --- occurrence ---"]
            for l in str(t).split("\n"):
                lines.append("  " + l)
        lines += [""]
    near = outcome.get("near") or []
    if isinstance(near, list) and near:
        lines += [
            "These REAL source lines match your anchor's words — copy ONE",
            "character-for-character as `old` (markup and ·/←/→ included):",
        ]
        for t in near[:4]:
            lines += ["  " + str(t)[:220]]
        lines += [""]
    return "\n".join(lines)


def _contract_feedback(outcome: dict[str, Any], app_src: str | None) -> str:
    """v4: feedback for empty/identical-edit rejections.

    A past session taught this: the v3 retry fixed its anchors but expressed the
    player's UI move as delete+insert pairs (edit with new==\"\"), which
    the gate forbids. Teach the edit contract, name the offending edit,
    and offer the closest source region verbatim."""
    reason = str(outcome.get("reason") or "?")
    old = str(outcome.get("failed_old") or "")
    new = str(outcome.get("failed_new") or "")
    lines = [
        "",
        "--- RETRY: THE GATE REJECTED YOUR PREVIOUS EDITS ---",
        f"Gate failure: {reason}",
        "The edits must follow the EDIT CONTRACT, no exceptions:",
        "- every edit is old -> new, both NON-EMPTY and DIFFERENT",
        '  (old == new is a forbidden no-op; new == "" is a forbidden deletion)',
        "- to MOVE a block use exactly TWO edits, never a bare deletion:",
        "  1) removal edit: old = unique surrounding context + the block,",
        "     new = the SAME context WITHOUT the block (context carries it)",
        "  2) insertion edit: old = unique destination context,",
        "     new = destination context + the relocated block",
        "Re-propose the FULL edits list with the SAME schema (classification stays app_fix).",
    ]
    if old or new:
        lines += [
            "The edit that broke the contract (truncated):",
            "old: " + (old[:600] or "(empty)"),
            "new: " + (new[:600] or "(empty)"),
            "",
        ]
    hist = outcome.get("gate_history") or []
    if isinstance(hist, list) and hist:
        lines += ["Your earlier proposals were refused by the gate for:"]
        for h in hist[:-1]:
            if isinstance(h, dict):
                lines += (f"- (round {h.get('n')}): {str(h.get('reason') or '?')}")[:180]
        lines += [
            "Do NOT abandon the fix or send an empty edits list. Re-propose the",
            "FULL edits list: copy each `old` anchor VERBATIM from the source",
            "blocks in this prompt (a near-miss line or the excerpt shown is",
            "exactly what to copy), never re-type it. If you truly cannot",
            "express the fix under the contract, classify game_logic and ask",
            "the player.",
            "",
        ]
    if old and app_src:
        excerpt = _anchor_excerpt(app_src, old)
        if excerpt:
            lines += [
                "Closest matching source region (copy anchors verbatim):",
                excerpt,
                "",
            ]
    return "\n".join(lines)


def _norm(s: str) -> str:
    """v4.5: collapse whitespace + casefold — an evidence quote whose case or
    spacing drifted from the source still proves the site was located."""
    return re.sub(r"\s+", " ", s).casefold().strip()


def _near_misses(evidence: str, app_src: str | None, panel_src: str | None = None) -> list[str]:
    """v4.5: when the evidence gate still refuses a quote, collect REAL
    source lines sharing >=2 distinctive words with it (up to 4), so the
    retry prompt can show the model exactly what to copy verbatim.
    v4.9.4.1: panel_src is optional — the v4.9.2 lane change left two
    two-argument call sites (evidence gate + the anchor 0x branch) and
    the missing-arg TypeError crashed pv_apply on the first anchor miss
    (a past round 2). A default keeps every call site honest."""
    words = list({w for w in re.split(r"\W+", evidence.casefold()) if len(w) >= 5})
    near: list[str] = []
    if not words:
        return near
    for src in (app_src, panel_src):
        if not src:
            continue
        for line in src.splitlines():
            ls = line.casefold()
            hits = sum(1 for w in words if w in ls)
            if hits >= 2:
                t = line.strip()
                if t and t not in near:
                    near.append(t)
                    if len(near) >= 4:
                        return near
    return near


def _match_lines(content: str, old: str, limit: int = 8) -> list[int]:
    """v4.12: 1-based line numbers of every occurrence of `old`, so a
    non-unique refusal can tell the model WHERE its N matches sit (a past
    4 identical sibling buttons; the model re-proposed the same shared
    string twice because it could not see where the matches were)."""
    import bisect

    offs: list[int] = []
    pos = 0
    for line in content.split("\n"):
        offs.append(pos)
        pos += len(line) + 1
    out: list[int] = []
    start = 0
    while len(out) < limit:
        i = content.find(old, start)
        if i < 0:
            break
        out.append(bisect.bisect_right(offs, i))
        start = i + 1
    return out


def _match_extensions(content: str, old: str, k: int = 3, limit: int = 4, max_chars: int = 700) -> list[str]:
    """v4.12: for a non-unique anchor, the first `limit` occurrences each
    shown as COMPLETE source lines: the 1 preceding line (where a
    distinguishing attribute usually sits), the whole match line(s) and
    k following lines (the child/content line). The anchor may start
    mid-line, so the snippet is cut at LINE boundaries — the retry gets
    whole lines it can copy byte-for-byte to BUILD a unique anchor,
    never re-typed ones (a past round failed 0x exactly because the
    whitespace was re-typed)."""
    import bisect

    lines = content.split("\n")
    offs: list[int] = []
    pos = 0
    for line in lines:
        offs.append(pos)
        pos += len(line) + 1
    out: list[str] = []
    start = 0
    while len(out) < limit:
        i = content.find(old, start)
        if i < 0:
            break
        j = max(0, bisect.bisect_right(offs, i) - 1)  # 0-based match line
        # span the anchor's own lines: find the last line the anchor touches
        end_j = max(0, bisect.bisect_right(offs, i + len(old) - 1) - 1)
        out.append("\n".join(lines[max(0, j - 1) : end_j + 1 + k])[:max_chars])
        start = i + len(old)
    return out


def _evidence_feedback(outcome: dict[str, Any], app_src: str | None, panel_src: str | None) -> str:
    """v4.5: the v4.4 gate refused the model's own on-site quotes
    twice and the model degenerated to an empty proposal. Teach the exact
    quoting discipline (ONE contiguous snippet copy-pasted from the source,
    never re-typed from the narration) and SHOW the real near-miss lines
    to copy verbatim."""
    ev = str(outcome.get("failed_old") or "")
    near = outcome.get("near") or []
    lines = [
        "",
        "--- RETRY: THE TARGET-EVIDENCE GATE REJECTED YOUR QUOTE ---",
        f"Gate failure: {str(outcome.get('reason') or '?')}",
        "target_evidence must be ONE SHORT CONTIGUOUS snippet COPY-PASTED",
        f"verbatim from the {APP_LABEL} block in this prompt —",
        "a single label or button text. NEVER re-type it from the narration",
        '(the spoken narration may PARAPHRASE the UI: a source label can be',
        'narrated loosely), NEVER join quotes across several JSX lines or spans —',
        "such joins are not contiguous in the source, so the gate cannot",
        "find them.",
        "Re-propose the FULL edits list with the SAME schema (classification stays app_fix).",
    ]
    if ev:
        lines += ["Your target_evidence was (truncated):", ev[:600], ""]
    if isinstance(near, list) and near:
        lines += [
            "These REAL source lines look close to what you meant — copy ONE",
            "of them VERBATIM into target_evidence:",
        ]
        for t in near[:4]:
            lines += ["  " + str(t)[:220]]
        lines += [""]
    return "\n".join(lines)


def _retry_feedback(outcome: dict[str, Any], app_src: str | None, panel_src: str | None = None) -> str:
    """v4: route the retry prompt by failure type - anchor misses keep the
    battle-tested _anchor_feedback; empty/identical edits and empty edit
    lists get the move/edit contract; v4.4 target-evidence failures are
    re-taught the locate-first rule."""
    r = str(outcome.get("reason") or "")
    if r.startswith("empty or identical edit") or r == "no edits":
        return _contract_feedback(outcome, app_src)
    if r.startswith("target evidence"):
        return _evidence_feedback(outcome, app_src, panel_src)
    return _anchor_feedback(outcome, app_src, panel_src)


# --------------------------------------------------------------- activities


@workflows.activity(
    name="pv-stage",
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def pv_stage(sid: str, stage: str, note: str, pushed: bool | None = None) -> str:
    """Mirror the current job into the brain-state doc (display-only lane).
    v4.10: `pushed` rides the done stages as structured data — true
    (fix verified live), false (gate-refused / refused revert) — so the
    panel renders the did-not-land state without parsing the note."""
    import httpx

    async with httpx.AsyncClient(timeout=20, headers=_PV_UA, follow_redirects=True) as c:
        base: dict[str, Any] = {"v": 1, "current": None, "history": []}
        d = await _kv_get_json(c, STATE_KEY)
        if d and isinstance(d.get("history"), list):
            base = d
        proto = base.get("current")
        history = list(base.get("history") or [])
        if isinstance(proto, dict) and isinstance(proto.get("sid"), str):
            history.append(proto)
        current: dict[str, Any] = {"sid": sid, "stage": stage, "note": note[:200], "ts": int(1000 * _now())}
        if pushed is not None:
            current["pushed"] = bool(pushed)
        await _kv_put(c, STATE_KEY, json.dumps({"v": 1, "current": current, "history": history[-5:]}))
    return stage


def _now() -> float:
    import time

    return time.time()


# v4.15: full-context filters — binaries, lockfiles, build output and
# anything that could carry secrets (.env*) never enter the prompt.
_CTX_SKIP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".svg",
    ".bmp", ".tiff", ".tif",
    ".b64", ".aseprite", ".kra", ".glb", ".gltf", ".fbx", ".obj",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".opus",
    ".mp4", ".webm", ".mov", ".zip", ".gz", ".tgz", ".tar", ".br", ".zst",
    ".bin", ".wasm", ".pdf", ".tsbuildinfo", ".webmanifest",
    ".db", ".sqlite", ".md5", ".sha256",
}
_CTX_SKIP_NAMES = {
    "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
    "uv.lock", "poetry.lock", "pipfile.lock", "cargo.lock",
    "composer.lock", "gemfile.lock",
}
_CTX_SKIP_DIRS = (
    ".git/", ".github/", ".husky/", "node_modules/", "dist/", "build/",
    ".vercel/", "coverage/", ".nx/", ".cache/", ".idea/", ".vscode/",
)


def _ctx_relpath(member_name: str) -> str:
    """Strip the tarball's "<owner>-<repo>-<sha>/" root component."""
    return member_name.split("/", 1)[1] if "/" in member_name else ""


def _ctx_skip(path: str, extra: list[str] | tuple[str, ...] = ()) -> bool:
    """v4.15: should this repo file be excluded from the full-context
    fetch? Noise and secret-bearing files never enter the model's
    prompt; the manifest's brain.contextExclude adds game-specific
    files or directory prefixes on top."""
    p = path.lower()
    name = p.rsplit("/", 1)[-1]
    if name.startswith(".env"):
        return True
    if name in _CTX_SKIP_NAMES:
        return True
    if p.startswith(_CTX_SKIP_DIRS):
        return True
    for x in extra:
        xl = str(x).lower().rstrip("/")
        if p == xl or p.startswith(xl + "/"):
            return True
    if "." in name:
        return ("." + name.rsplit(".", 1)[-1]) in _CTX_SKIP_EXT
    return False


@workflows.activity(
    name="pv-fetch",
    start_to_close_timeout=timedelta(seconds=180),
    retry_policy_max_attempts=3,
    retry_policy_backoff_coefficient=2.0,
)
async def pv_fetch(sid: str) -> dict[str, Any]:
    """Session JSON + transcript (+ the editable sources when the token is bound)."""
    import base64

    import httpx

    async with httpx.AsyncClient(timeout=60, headers=_PV_UA, follow_redirects=True) as c:
        idx = await _kv_get_json(c, f"{SESS_PREFIX}{sid}")
        if not idx:
            raise workflows.WorkflowError("session_not_found", non_retryable=True)
        parts = idx.get("parts")
        if not isinstance(parts, int) or not 1 <= parts <= MAX_PARTS:
            raise workflows.WorkflowError("session_index_invalid", non_retryable=True)
        # v4.2 (signing C): under the sign key the index must carry this
        # handler family's HMAC plus a digest per part — forged sessions
        # and edited parts die HERE, before any model call or push. The
        # sig is popped FIRST so the remaining dict re-serializes to the
        # writer's canonical bytes. Unsigned = written before the key
        # existed or by a stranger: both are rejected honestly.
        pd = None
        sk = _sign_key()
        if sk:
            import hashlib as _hashlib
            import hmac as _hmac

            pd = idx.get("pd")
            sig = idx.pop("sig", None)
            if (
                not isinstance(sig, str)
                or not isinstance(pd, list)
                or len(pd) != parts
            ):
                raise workflows.WorkflowError("session_unsigned", non_retryable=True)
            if not _hmac.compare_digest(sig, _doc_sig(f"{SESS_PREFIX}{sid}", idx)):
                raise workflows.WorkflowError("session_sig_mismatch", non_retryable=True)
        raw = ""
        for p in range(parts):
            t = await _kv_get_raw(c, f"{SESS_PREFIX}{sid}-{p}")
            if t is None:
                raise workflows.WorkflowError(f"part_missing_{p}", non_retryable=True)
            raw += t
            if sk and pd is not None:
                # digest the PART TEXT (`t`), not `r` — the
                # v4.2 line read `r.text`, an httpx response that never
                # exists in this scope (UnboundLocalError on every part,
                # which killed all three activity attempts and stranded
                # the panel state line stays stranded on its fetching placeholder).
                d = _hashlib.sha256(t.encode("utf-8")).hexdigest()
                if d != str(pd[p]):
                    raise workflows.WorkflowError(
                        f"session_part_mismatch_{p}", non_retryable=True
                    )
        try:
            session = json.loads(raw)
            if not isinstance(session, dict) or session.get("sid") != sid:
                raise workflows.WorkflowError("session_malformed", non_retryable=True)
        except json.JSONDecodeError:
            raise workflows.WorkflowError("session_unparseable", non_retryable=True) from None
        trans = await _kv_get_json(c, f"{TRANS_PREFIX}{sid}")
        # v4.2 (signing C): the transcript is the model's steering input —
        # under the sign key it must originate from /api/transcribe (signed),
        # never from an anonymous write.
        if sk:
            tsig = (trans or {}).pop("sig", None)
            if not isinstance(trans, dict) or not isinstance(tsig, str):
                raise workflows.WorkflowError("transcript_unsigned", non_retryable=True)
            if not _hmac.compare_digest(tsig, _doc_sig(f"{TRANS_PREFIX}{sid}", trans)):
                raise workflows.WorkflowError("transcript_sig_mismatch", non_retryable=True)
        transcript = str((trans or {}).get("text") or "")
        # v4.4 multi-file context: App.tsx + TestPanel.tsx (editable lane),
        # controller.ts + QAInput.tsx (read-only scope context) and
        # version.ts (the pipeline's single bump spot) - all when the
        # workspace secret is bound (private repo)
        srcs: dict[str, str] = {}
        shas: dict[str, str] = {}
        tok = _env("githubToken")
        if tok:
            for name, fpath in (
                (APP_LABEL, APP_PATH),
                ("TestPanel.tsx", PANEL_PATH),
                ("controller.ts", CTL_PATH),
                ("QAInput.tsx", QA_PATH),
                (VER_LABEL, VER_PATH),
                # v4.9.5: fail-open — a missing context file degrades the
                # prompt to its generic rules; it must never kill the run
                ("context_md", CONTEXT_PATH),
            ):
                r = await c.get(
                    f"{GITHUB}/{REPO}/contents/{fpath}?ref=main",
                    headers=_gh_headers(tok),
                )
                if r.status_code == 200:
                    d = r.json()
                    srcs[name] = base64.b64decode(d.get("content", "")).decode("utf-8")
                    shas[name] = str(d.get("sha") or "") or None
        # v4.14: the manifest's extra read-only sources (engine.ts & co).
        # Fail-open per file like every context fetch: a missing file
        # degrades the prompt, never the run. A huge file truncates
        # instead of blowing the verdict prompt apart.
        for fpath in RO_PATHS:
            try:
                r = await c.get(
                    f"{GITHUB}/{REPO}/contents/{fpath}?ref=main",
                    headers=_gh_headers(tok),
                )
                if r.status_code == 200:
                    d = r.json()
                    txt = base64.b64decode(d.get("content", "")).decode("utf-8")
                    if len(txt) > 60000:
                        txt = txt[:60000] + "\n/* … playvibe: read-only context truncated … */"
                    srcs[f"ro:{fpath}"] = txt
            except Exception:
                continue
        # v4.15: FULL CODEBASE CONTEXT (manifest brain.fullContext) — one
        # tarball of main, every text source file into the same ro_srcs
        # lane, filtered (_ctx_skip + a NUL-bytes binary guard) and
        # capped (60 KB per file, brain.contextMaxKB total). The budget
        # spends CODE directories first (src/, api/, app/, game/,
        # public/), everything else second, so asset noise can never
        # starve real code. Fail-open like every context fetch: a
        # tarball problem degrades the prompt, never the run.
        full_ctx = False
        if FULL_CONTEXT and tok:
            try:
                r = await c.get(f"{GITHUB}/{REPO}/tarball/main", headers=_gh_headers(tok))
                if r.status_code == 200 and len(r.content) < 64 * 1024 * 1024:
                    import io
                    import tarfile

                    taken = {
                        APP_PATH, PANEL_PATH, CTL_PATH, QA_PATH, VER_PATH,
                        CONTEXT_PATH, *RO_PATHS,
                    }
                    code_first = ("src/", "api/", "app/", "game/", "public/")
                    candidates: list[tuple[int, str, str]] = []
                    tf = tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz")
                    for m in tf.getmembers():
                        if not m.isfile():
                            continue
                        fpath = _ctx_relpath(m.name)
                        if not fpath or fpath in taken or _ctx_skip(fpath, CTX_EXCLUDE):
                            continue
                        f = tf.extractfile(m)
                        if f is None:
                            continue
                        raw = f.read()
                        if b"\x00" in raw[:4000]:
                            continue  # binary content, whatever the extension claims
                        txt = raw.decode("utf-8", errors="replace")
                        if len(txt) > 60000:
                            txt = txt[:60000] + "\n/* … playvibe: read-only context truncated … */"
                        prio = 0 if fpath.startswith(code_first) else 1
                        candidates.append((prio, fpath, txt))
                    budget = CTX_MAX_KB * 1000
                    for prio, fpath, txt in sorted(candidates):
                        if budget <= 0:
                            break
                        srcs[f"ro:{fpath}"] = txt
                        taken.add(fpath)
                        budget -= len(txt)
                        full_ctx = True
            except Exception:
                full_ctx = False
        app_src = srcs.get(APP_LABEL) or None
        app_sha = shas.get(APP_LABEL) or None
        panel_src = srcs.get("TestPanel.tsx") or None
        panel_sha = shas.get("TestPanel.tsx") or None
        ver_src = srcs.get(VER_LABEL) or None
        ver_sha = shas.get(VER_LABEL) or None
        # v2.3 anti-oscillation guard: recent commit subjects, so the
        # verdict model can see (and refuse to blindly narratively
        # reverse) its own recent fixes (an early
        # weapon-description flip-flop made this necessary).
        # v2.4: the guard itself must be fail-open — a commits fetch
        # problem may never kill the whole run (learned from f0uw,
        # whose first run died on a NameError here).
        recent: list[str] = []
        if tok:
            try:
                r = await c.get(
                    f"{GITHUB}/{REPO}/commits?per_page=10", headers=_gh_headers(tok)
                )
                if r.status_code == 200:
                    for cm in r.json()[:10]:
                        msg = str((cm.get("commit") or {}).get("message") or "")
                        subj = next((ln.strip() for ln in msg.splitlines() if ln.strip()), "")
                        if subj:
                            recent.append(subj[:120])
            except Exception:
                recent = []
        return {
            "session": session,
            "transcript": transcript,
            "app_src": app_src,
            "app_sha": app_sha,
            "panel_src": panel_src,
            "panel_sha": panel_sha,
            "ctl_src": srcs.get("controller.ts") or None,
            "qa_src": srcs.get("QAInput.tsx") or None,
            "ver_src": ver_src,
            "ver_sha": ver_sha,
            "context_md": srcs.get("context_md") or None,
            "ro_srcs": {k[3:]: v for k, v in srcs.items() if k.startswith("ro:")},
            "full_context": full_ctx,
            "has_token": bool(tok),
            "recent_commits": recent,
        }


@workflows.activity(
    name="pv-verdict",
    start_to_close_timeout=timedelta(seconds=180),
    retry_policy_max_attempts=2,
    retry_policy_backoff_coefficient=2.0,
)
async def pv_verdict(
    metrics: dict[str, Any],
    app_src: str | None,
    panel_src: str | None,
    ctl_src: str | None,
    qa_src: str | None,
    recent: list[str] | None = None,
    feedback: str | None = None,
    context_md: str | None = None,
    qa_block: str | None = None,
    ro_block: str | None = None,
) -> Verdict:
    """The model call: classify + (for app_fix) propose gated exact edits.

    v3: `feedback` carries the gate's rejection details (rejected anchor +
    a verbatim excerpt of the closest source region) so a second pass can
    repair its own anchors instead of failing blindly (both refusal shapes).
    v4.9.5: `context_md` is the repo's AGENT-CONTEXT.md, rendered as the
    prompt's GAME CONTEXT block (the context-keeper directive)."""
    from mistralai.workflows.plugins.mistralai import (
        ChatCompletionRequest,
        UserMessage,
        chat_parse_to_model,
    )

    content = verdict_prompt(
        metrics, app_src, panel_src, ctl_src, qa_src, recent, game_context=context_md,
        app_label=APP_LABEL,
    )
    # v4.14: the consumed player answers + the manifest's extra read-only
    # sources ride between the assembled context and any gate feedback.
    if qa_block:
        content += "\n" + qa_block
    if ro_block:
        content += "\n" + ro_block
    if feedback:
        content += "\n" + feedback
    req = ChatCompletionRequest(
        model=VERDICT_MODEL,
        messages=[UserMessage(content=content)],
        temperature=0,
        max_tokens=4000,
    )
    return await chat_parse_to_model(Verdict, req)


@workflows.activity(
    name="pv-edits",
    start_to_close_timeout=timedelta(seconds=120),
    retry_policy_max_attempts=2,
    retry_policy_backoff_coefficient=2.0,
)
async def pv_edits(
    fix_description: str,
    target_evidence: str,
    app_src: str | None,
    feedback: str | None = None,
    context_md: str | None = None,
    transcript: str = "",
) -> EditList:
    """v4.9.3 phase 2: given the committed diagnosis, emit ONLY the edits
    that implement it (see EditList for why the emission was split).
    v4.9.5: `context_md` renders AGENT-CONTEXT.md in this round too.
    v4.9.7: `transcript` rides along. The one-line fix_description
    is a lossy summary — a past session narrated "boxes equal width, contents fill
    them suitably" and the emission round, blind to the narration,
    implemented "fill" as flex-1 min-w-0 and collapsed the HP bars to
    slivers. The narration is the ground truth for intent; the prompt
    also teaches the smallest-visual-delta rule (satisfy the narration,
    preserve everything it does not ask to change)."""
    from mistralai.workflows.plugins.mistralai import (
        ChatCompletionRequest,
        UserMessage,
        chat_parse_to_model,
    )

    req = ChatCompletionRequest(
        model=VERDICT_MODEL,
        messages=[UserMessage(content=edits_prompt(
            fix_description, target_evidence, app_src, feedback, game_context=context_md,
            transcript=transcript, app_label=APP_LABEL,
        ))],
        temperature=0,
        # 3000 tokens once truncated a giant-verbatim-anchor
        # emission mid-JSON (EOF at column 9660) and the pydantic failure
        # crashed the activity; doubles the budget for the anchors round
        max_tokens=6000,
    )
    try:
        return await chat_parse_to_model(EditList, req)
    except Exception as e:
        # a truncated/invalid guided-JSON emission used to
        # crash the whole run (EOF while parsing at column 9660 — the
        # model pasted a huge verbatim block as `old`). ONE salvage retry
        # with tightened rules; if that fails too, return empty honestly —
        # the gate reports "no edits" and the normal retry loop
        # handles it instead of the run dying.
        note = (
            "YOUR PREVIOUS ANSWER WAS TRUNCATED or was not valid JSON ("
            + str(e)[:160]
            + "). The usual cause is an anchor that is TOO LONG. Answer "
            "again: use the SHORTEST UNIQUE anchor (one line or part of a "
            "line, NOT whole JSX blocks or long className strings). "
            "REMOVAL is REPLACEMENT: old = the shortest containing string, "
            "new = the same WITHOUT the removed part (new is never empty)."
        )
        req2 = ChatCompletionRequest(
            model=VERDICT_MODEL,
            messages=[UserMessage(content=edits_prompt(
                fix_description, target_evidence, app_src,
                ((feedback + "\n\n") if feedback else "") + note,
                game_context=context_md,
                transcript=transcript, app_label=APP_LABEL,
            ))],
            temperature=0,
            max_tokens=6000,
        )
        try:
            return await chat_parse_to_model(EditList, req2)
        except Exception:
            return EditList(edits=[])


@workflows.activity(
    name="pv-apply",
    start_to_close_timeout=timedelta(seconds=120),
    retry_policy_max_attempts=1,
)
async def pv_apply(
    sid: str,
    fetched: dict[str, Any],
    verdict: dict[str, Any],
    metrics: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    """v4.8: gate-check the edits across the editable lane (unique anchors
    per file with 0x near-miss teaching; target evidence with paraphrase
    tolerance), bump the single APP_VERSION constant in src/version.ts,
    push ONE atomic commit (git data API, fast-forward)."""
    import base64

    import httpx

    if dry_run:
        return {"ok": False, "reason": "dry run — push skipped"}
    tok = _env("githubToken")
    if not tok:
        return {"ok": False, "reason": "github token missing — fix left to the agents"}
    app_src = fetched.get("app_src")
    app_sha = fetched.get("app_sha")
    panel_src = fetched.get("panel_src")
    panel_sha = fetched.get("panel_sha")
    ver_src = fetched.get("ver_src")
    ver_sha = fetched.get("ver_sha")
    if not app_src or not app_sha:
        return {"ok": False, "reason": f"{APP_LABEL} unavailable"}
    if not 5000 < len(app_src) < 200000:
        return {"ok": False, "reason": f"{APP_LABEL} size odd ({len(app_src)})"}
    # v4.13: the panel context is OPTIONAL - since the playvibe package
    # swap the game installs the test-mode sources from aapokojo/playvibe
    # (node_modules), so its repo may carry no src/testmode/TestPanel.tsx.
    # A present panel gets the sanity check; an absent one is expected.
    if panel_src and panel_sha and not 2000 < len(panel_src) < 200000:
        return {"ok": False, "reason": f"TestPanel.tsx size odd ({len(panel_src)})"}
    if not ver_src or not ver_sha:
        return {"ok": False, "reason": f"version file missing ({VER_PATH})"}

    # v4.5: a worn-down retry round can hand back classification app_fix
    # with an EMPTY edits list (a past session did exactly that after two gate
    # refusals) - report that honestly instead of letting the evidence
    # gate claim a mismatch it never checked
    edits = [ed for ed in (verdict.get("edits") or []) if isinstance(ed, dict)]
