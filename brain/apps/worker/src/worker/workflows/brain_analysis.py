"""Deterministic session analysis — the Vibe ritual, ported.

Pure functions only: no SDK imports, no I/O, no time/random, so it runs both
inside the deployed workflow (workflow code must stay deterministic) and in
plain local tests. The output is a compact metrics dict that the verdict
prompt and the brain-state notes are built from.

v4.10: the per-game counting vocabulary (which probe events are the game's
KEY EVENTS, which wire kinds are its HEARTBEAT) arrives as parameters from
the game's playvibe manifest (analysis.keyEvents / analysis.heartbeat); the
defaults preserve the original Blast Bugs behavior.
"""

SID_RE = r"^\d{12,14}-[0-9a-z]{4}$"
MAX_TRANSCRIPT_CHARS = 4000


def _hist(items, key):
    out: dict = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        k = str(it.get(key, "?"))
        out[k] = out.get(k, 0) + 1
    return out


def _top(hist, n=24):
    return dict(sorted(hist.items(), key=lambda kv: (-kv[1], kv[0]))[:n])


def analyze_session(
    session: dict,
    transcript: str,
    key_events=("boom",),
    heartbeat=("push-live", "push-final-live"),
) -> dict:
    """Metrics from one test-session JSON + its narration transcript.
    v4.10: key_events are the game's manifest-declared probe events
    (counted with their snapshot tags and +1.5s late pairs); heartbeat
    are the wire kinds whose gaps signal relay stalls."""
    events = session.get("events") if isinstance(session, dict) else None
    events = events if isinstance(events, list) else []
    wire = session.get("wire") if isinstance(session, dict) else None
    wire = wire if isinstance(wire, list) else []
    snaps = session.get("snapshots") if isinstance(session, dict) else None
    snaps = snaps if isinstance(snaps, list) else []

    ev_hist = _hist(events, "t")
    wire_hist = _hist(wire, "k")

    # pump cadence: gaps > 2 s between consecutive heartbeat taps (relay stall)
    hb = set(heartbeat)
    pump_stalls = []
    last_ms = None
    for w in wire:
        if not isinstance(w, dict) or w.get("k") not in hb:
            continue
        ms = w.get("ms")
        if not isinstance(ms, (int, float)):
            continue
        if last_ms is not None and ms - last_ms > 2000:
            pump_stalls.append({"atMs": int(last_ms), "gapMs": int(ms - last_ms)})
        last_ms = ms

    snap_tags = _hist(snaps, "tag") if all(isinstance(s, dict) for s in snaps) else {}
    booms = sum(ev_hist.get(k, 0) for k in key_events)
    boom_snaps = sum(snap_tags.get(k, 0) for k in key_events)
    boom_late_snaps = sum(snap_tags.get(k + "+1.5s", 0) for k in key_events)

    # freeze/starve counts: engine probe names that mark replay starvation
    starves = sum(v for k, v in ev_hist.items() if "starve" in k)
    stalls = sum(v for k, v in ev_hist.items() if "stall" in k or "freeze" in k)

    # boundary-load hunt: v36+ expects ZERO mid-turn load() adoptions; a load()
    # probe event marks a snapshot adoption (fresh join/heal is fine, mid-turn
    # is the v35 regression signature). Turn crossings bound the check.
    loads = [e for e in events if isinstance(e, dict) and e.get("t") == "load"]
    turns = [e for e in events if isinstance(e, dict) and e.get("t") == "turn"]
    first_turn_ms = turns[0].get("ms") if turns and isinstance(turns[0].get("ms"), (int, float)) else None
    mid_turn_loads = []
    for ln in loads:
        ms = ln.get("ms")
        if not isinstance(ms, (int, float)):
            continue
        if first_turn_ms is not None and ms > first_turn_ms:
            # a load while any turn is in progress is suspicious only when it
            # is not the LAST event window (final heuristics stay to the model)
            mid_turn_loads.append({"ms": int(ms)})

    ua = str(session.get("ua", ""))[:140]
    room = session.get("room")
    return {
        "sid": session.get("sid", ""),
        "version": str(session.get("version", "?")),
        "mode": str(session.get("mode", "?")),
        "room": room if isinstance(room, dict) else None,
        "startedAt": session.get("startedAt"),
        "durationMs": session.get("durationMs"),
        "screen": session.get("screen"),
        "noAudioReason": session.get("noAudioReason") or None,
        "audioMime": session.get("audioMime"),
        "events": len(events),
        "wire": len(wire),
        "snapshots": len(snaps),
        "eventHistogram": _top(ev_hist),
        "wireHistogram": _top(wire_hist),
        "turns": ev_hist.get("turn", 0),
        "booms": booms,
        "boomSnapshots": boom_snaps,
        "boomLateSnapshots": boom_late_snaps,
        "starves": starves,
        "stalls": stalls,
        "snapshotTags": _top(snap_tags),
        "loads": len(loads),
        "midTurnLoads": mid_turn_loads[:8],
        "pumpStalls": pump_stalls[:8],
        "transcript": (transcript or "")[:MAX_TRANSCRIPT_CHARS],
    }


def context_last_verified(game_context: str | None) -> str | None:
    """v4.9.5: the lastVerifiedAt version stamped in AGENT-CONTEXT.md
    (None when the context or the stamp is absent). Pure — the caller
    compares it against the live version literal and flags staleness."""
    if not game_context:
        return None
    import re

    m = re.search(r"lastVerifiedAt:\s*(v\d+(?:\.\d+)?)", game_context)
    return m.group(1) if m else None


def tag_balance_delta(old: str, new: str) -> int:
    """v4.9.6 (fk6n): JSX structural gate primitive. net(snippet) =
    opening tags (<name ...) minus self-closing tags (/> minus... counted
    as open+immediate close) minus closing tags (</name>); returns
    net(new) - net(old). A structurally valid edit set keeps the FILE's
    total balance unchanged (sum of deltas 0 over the whole proposal):
    splits add open+close in pairs, move pairs net zero across their two
    edits, text edits carry no tags at all. fk6n's build-break (one lone
    inserted </div>) had delta -1 and no partner edit. Pure, deliberately
    heuristic — a necessary condition for the pushed file to compile,
    false-positive-safe on this lane (narrated UI text carries no tags)."""
    import re

    def net(s: str) -> int:
        opens = len(re.findall(r"<[A-Za-z][\w.-]*", s))
        selfc = len(re.findall(r"/>", s))
        closes = len(re.findall(r"</[A-Za-z][\w.-]*>", s))
        return opens - selfc - closes

    return net(new) - net(old)


def game_context_block(game_context: str | None) -> str:
    """v4.9.5: render AGENT-CONTEXT.md as the prompt's GAME CONTEXT block.
    Fail-open: a missing context degrades to an honest one-line note, the
    generic edit mechanics below still apply."""
    if not game_context:
        return (
            "GAME CONTEXT: the game repo's AGENT-CONTEXT.md was NOT available\n"
            "(fetch failed). Rely on the generic rules and the source blocks\n"
            "below, and prefer game_logic when unsure.\n\n"
        )
    return (
        "--- GAME CONTEXT (the game repo's AGENT-CONTEXT.md — GROUND TRUTH:\n"
        "identity, agent lanes, hard boundaries, UI conventions, game-logic\n"
        "index, known pitfalls. Obey it; where it and anything else in this\n"
        "prompt disagree, the GAME CONTEXT wins) ---\n"
        "```markdown\n"
        + game_context
        + "\n```\n\n"
    )


def verdict_prompt(
    metrics: dict,
    app_src: str | None,
    panel_src: str | None = None,
    ctl_src: str | None = None,
    qa_src: str | None = None,
    recent: list[str] | None = None,
    game_context: str | None = None,
    app_label: str = "App.tsx",
) -> str:
    """The classification prompt: metrics + narration + the v4.4 multi-file
    context (editable lane + read-only reference files). v4.9.5: the
    game's own context file (AGENT-CONTEXT.md) renders as the GAME
    CONTEXT block and carries the game-specific rules, examples and
    conventions; what remains here is game-agnostic edit mechanics."""
    import json

    def _block(label: str, src: str | None) -> str:
        return "--- " + label + " ---\n```tsx\n" + (src or "") + "\n```\n"

    if app_src:
        context = (
            "LANE (hard — matches the GAME CONTEXT above): your edits may ONLY\n"
            f"target the editable file the context names ({app_label} in this\n"
            "game), as exact-string replacements that each appear EXACTLY ONCE\n"
            "in that file. Keep the total footprint under ~40 changed lines.\n"
            "Every module the GAME CONTEXT marks READ-ONLY is never edited —\n"
            "never change game physics, turn logic or netcode. The test tooling\n"
            "tree below is READ-ONLY context: consult it when an identifier, prop\n"
            "or state line is unclear; a narration about the test tooling\n"
            "itself classifies game_logic and says so in findings. The version\n"
            "file holds the single version constant; the pipeline bumps it\n"
            "deterministically — never propose edits to it.\n\n"
            + _block(f"{app_label} (EDITABLE — the only editable file)", app_src)
        )
        if panel_src:
            context += _block("TestPanel.tsx = src/testmode/TestPanel.tsx (READ-ONLY — NEVER EDIT)", panel_src)
        if ctl_src:
            context += _block("controller.ts = src/testmode/controller.ts (READ-ONLY — NEVER EDIT)", ctl_src)
        if qa_src:
            context += _block("QAInput.tsx = src/testmode/QAInput.tsx (READ-ONLY — NEVER EDIT)", qa_src)
    else:
        context = (
            f"{app_label} is NOT available (no GitHub token bound): classify and\n"
            "describe the fix in fix_description, but leave edits EMPTY.\n"
        )
    recent_block = ""
    if recent:
        listed = "\n".join(f"- {str(s)[:120]}" for s in list(recent)[:10])
        recent_block = (
            "RECENT AUTONOMOUS COMMITS (newest first; these are your own recent\n"
            "fixes, requested by the player in earlier sessions and already\n"
            "live):\n"
            + listed
            + "\n\nANTI-OSCILLATION RULE (v4.8: applies to REVERSALS ONLY): if\n"
            "the narration asks to UNDO or REVERSE a recent fix — restore\n"
            "pre-commit wording, revert a capitalization, put back what a\n"
            "commit removed — do NOT push that reversal autonomously; classify\n"
            "\"game_logic\" and confirm with the player via `question` (one\n"
            "concrete question in plain English) and 2-4 short `options`.\n"
            "Touching the SAME AREA, or even the SAME LINE, a recent commit\n"
            "touched with a NEW, genuinely additional improvement (splitting a\n"
            "line, rewording for clarity, a different label nearby) is NOT a\n"
            "reversal: locate it and propose the edits normally. When truly in\n"
            "doubt ask via game_logic — but NEVER return app_fix with an empty\n"
            "`edits` list.\n\n"
            "v45.50: the player has a PALAUTA (revert) list in TESTITILA for\n"
            "unsatisfactory fixes — every shipped fix is reversible BY THE\n"
            "PLAYER, so a small, honest, on-target fix is never a dead end:\n"
            "propose one confidently.\n\n"
        )
    return (
        "You are the autonomous dev-agent brain for the game described in the\n"
        "GAME CONTEXT block below. A test session was recorded on the player's\n"
        "phone: game probe events, relay wire packets, canvas snapshots, and a\n"
        "narration transcript (the player describes what they saw).\n\n"
        "DETERMINISTIC METRICS (ground truth for timings):\n"
        + json.dumps(metrics, ensure_ascii=False, default=str)
        + "\n\n"
        + game_context_block(game_context)
        + recent_block
        + context
        + "\n"
        "Classify the session into exactly one verdict:\n"
        "- \"clean\": the session is healthy, the narration confirms things work\n"
        "  as planned. Everything works: no findings worth a code change.\n"
        "- \"app_fix\": a clear, small, surgical bug in the editable game UI\n"
        "  file ONLY (UI, HUD overlays, toasts, on-screen controls). You are\n"
        "  confident, each edit's `old` string is copied verbatim from\n"
        "  the editable file above and appears exactly once there, and the\n"
        "  fix cannot change game behavior. The test panel and all test\n"
        "  tooling are NOT editable — narration about them is game_logic.\n"
        "  Do NOT bump version strings yourself — the pipeline does that\n"
        "  deterministically in the game's version file.\n"
        "\n"
        "TARGET RULES (a wrong-target fix is worse than no fix; see the GAME\n"
        "CONTEXT's known-pitfalls section for this game's past incidents):\n"
        "- LOCATE before you edit: find the exact source site of the label or\n"
        "  button the narration mentions, and copy a short VERBATIM snippet\n"
        "  of its text into `target_evidence` exactly as it appears in the\n"
        "  source you were shown.\n"
        "- `target_evidence` is ONE short CONTIGUOUS snippet, copy-pasted\n"
        "  from the source blocks above — a single label/button text. Do not\n"
        "  re-type it from the narration (spoken words differ from rendered\n"
        "  UI text), do not join quotes across several JSX lines or spans,\n"
        "  do not re-type markup. The GAME CONTEXT's UI conventions section\n"
        "  describes how this game's narrations map onto its UI.\n"
        "- READ-ONLY-DEFINED DISPLAY TEXT: if the narrated text is DEFINED in\n"
        "  a read-only module but RENDERED in the editable file, the fix is\n"
        "  STILL app_fix: copy the RENDER EXPRESSION verbatim into\n"
        '  `target_evidence` and override the display at the editable site\n'
        "  (a small local map or an inline conditional). A read-only\n"
        "  definition NEVER makes the fix impossible — the display layer\n"
        "  can always override what it renders. NEVER edit the read-only\n"
        "  module.\n"
        "- Label dictionary tables are source-mapped: touch them ONLY if\n"
        "  the narration names the label they render, and only with keys\n"
        "  that actually exist in the sources shown.\n"
        "- `fix_description` must name the target exactly as it appears in\n"
        "  the source, not a vague summary.\n"
        "\n"
        "OUTPUT RULE (hard — v4.7): for an app_fix verdict `edits` MUST be\n"
        "non-empty — an app_fix with an empty `edits` list is an AUTOMATIC\n"
        "FAILURE and the gate will retry it. Emit the fields in schema\n"
        "order: first fix_description, then target_evidence (copy-paste the\n"
        "located snippet verbatim), then edits built from that snippet, and\n"
        "only AFTER that the findings/reasoning prose.\n"
        "\n"
        "EDIT CONTRACT (hard gates — every violation aborts the whole fix):\n"
        "- Each edit is one old -> new replacement and names its target file\n"
        f'  in `file`: ONLY "{app_label}" is ever editable (leave it empty for the default);\n'
        "  `old` must appear EXACTLY ONCE in THAT file. `old` and `new` must BOTH be\n"
        "  non-empty, and they must DIFFER (old == new is a forbidden no-op;\n"
        "  new == \"\" is a forbidden deletion — the gate rejects both).\n"
        "- To SPLIT one element (e.g. one instruction line holding two\n"
        "  actions) into two of its own, use exactly ONE edit: old = the\n"
        "  whole current element VERBATIM from the source (special characters\n"
        "  like ·/←/→ included), new = the two resulting elements side by side.\n"
        "  NEVER a bare deletion, NEVER two edits for a split.\n"
        "- To MOVE a block (relocate UI), use exactly TWO edits: a removal edit\n"
        "  (old = unique surrounding context + the block, new = the SAME context\n"
        "  WITHOUT the block — the context carries the edit, new is never empty)\n"
        "  and an insertion edit (old = unique destination context, new = that\n"
        "  destination context + the relocated block). NEVER express a move as\n"
        "  old -> \"\" plus a bare insert.\n"
        "- LEXICAL SCOPE (hard gate; the v45.28 page-crash class): every\n"
        "  identifier used in `new` (ti, hud, e, ...) must resolve in the\n"
        "  exact lexical scope of the `old` site. NEVER close or move a JSX\n"
        "  map/array callback boundary (`))}` / `})`) to relocate UI: the\n"
        "  relocated block must stay INSIDE the callback that defines the\n"
        "  identifiers it uses. Moving something outside a box NEVER means\n"
        "  outside the map. If a move cannot be expressed without crossing a\n"
        "  scope boundary, classify game_logic and ask the player instead.\n"
        "- CLOSING-TAG MOVES (hard gate, the fk6n class): moving a block\n"
        "  boundary (closing an element early, pulling content out of a\n"
        "  box) is exactly TWO edits — the inserted closing tag in one,\n"
        "  the removal of the original closing tag in the other — or ONE\n"
        "  whole-element replacement. NEVER insert a lone closing or\n"
        "  opening tag: every tag an edit's `new` adds must be balanced\n"
        "  by the same edit or by its partner edit in the list; the gate\n"
        "  sums tag balance across the whole proposal and refuses\n"
        "  unbalanced sets (a lone </div> breaks the build).\n"
        "- Edits apply top to bottom; propose them so each `old` still appears\n"
        "  exactly once at its turn.\n"
        "- \"game_logic\": anything that would SIGNIFICANTLY change game logic\n"
        "  (mechanics, physics, balance, netcode), anything ambiguous or unclear,\n"
        "  multi-file needs, or missing information. Then write `question` (one\n"
        "  concrete question in plain English for the player) and 2-4 short\n"
        "  `options` for the in-game answer box.\n\n"
        "Rules: findings are short and concrete. If the narration and metrics\n"
        "disagree, trust the metrics. If in doubt between app_fix and game_logic,\n"
        "choose game_logic. fix_description is one short English sentence\n"
        "naming the fix.\n"
    )


def edits_prompt(
    fix_description: str,
    target_evidence: str,
    app_src: str | None,
    feedback: str | None = None,
    game_context: str | None = None,
    transcript: str = "",
    app_label: str = "App.tsx",
) -> str:
    """v4.9.3 phase 2: the diagnosis is already committed; this prompt asks
    ONLY for the edits that implement it.

    The six empty-edits sessions (imyf, 47wl, felf, b7zz, 5fbq, vjmn) all
    SOLVED the fix inside their reasoning but emitted edits=[] in the
    guided-JSON verdict: v4.7 put the action fields FIRST in the schema,
    so the model had to commit `edits` BEFORE the reasoning field where it
    actually worked the anchors out. Splitting the emission gives the
    model a dedicated, edits-only output AFTER the diagnosis is done.

    v4.9.7 (bqiv): `transcript` rides along. Phase 2 used to see only the
    one-line fix_description — bqiv narrated "the boxes should be equal
    width, contents fill them suitably" and the blind emission round read
    "fill" as flex-1 min-w-0, collapsing the HP bars to slivers. The
    narration is the ground truth for HOW the fix must look; the prompt
    also teaches the SMALLEST VISUAL DELTA rule: satisfy the narration
    while preserving every size and behavior it does not ask to change."""
    if not app_src:
        return f"{app_label} is not available: return an empty edits list."
    lines = [
        "You are the autonomous dev-agent brain for this game. An earlier",
        "diagnosis round already COMMITTED to this fix. Do NOT re-classify or",
        "re-diagnose — implement exactly this:",
        f"fix_description: {str(fix_description or '?')[:300]}",
        f"target_evidence (the located {app_label} site): {str(target_evidence or '?')[:300]}",
        "",
        "--- PLAYER NARRATION (ground truth for INTENT — how the fix must ---",
        "--- look and feel; read it before proposing edits) ---------------",
        str(transcript or "").strip()[:2000] or "(no transcript)",
        "",
        "Output ONLY the exact-string edits that implement this committed fix",
        f'in {app_label} (the ONLY editable file; leave `file` empty for the default):',
        "- SMALLEST VISUAL DELTA (v4.9.7, hard): satisfy the narration while",
        "  PRESERVING every existing size, spacing, position and behavior",
        "  the narration does NOT ask to change. 'Make the boxes equal'",
        "  does NOT shrink, restyle or reflow the elements inside them;",
        "  'make X fill the box' does NOT collapse X's current size. When",
        "  the narration is vague ('sopivasti', 'paremmin'), keep the",
        "  current look and change ONLY what is explicitly asked; when the",
        "  narration says something became too small or broken, RESTORE",
        "  the previous size rather than inventing a new layout.",
        f"- `old` copied VERBATIM from the {app_label} block below,",
        "  character-for-character INCLUDING WHITESPACE AND INDENTATION",
        "  (special characters like ·/←/→ included): never RE-TYPE an",
        "  anchor, copy the exact bytes (a re-typed anchor is the known",
        "  0x trap); it must appear EXACTLY ONCE in the file; `new`",
        "  non-empty and different.",
        "- SIBLING MARKUP (v4.12): when several sibling elements share",
        "  the SAME line (identical classNames on a group of buttons or",
        "  list items), a class-only anchor is NOT unique. Extend it with",
        "  a distinguishing line copied verbatim — the attribute line",
        "  ABOVE (id / data-* / aria-*) or the child/content line BELOW",
        "  — the shortest form that still appears exactly once.",
        "- keep the total footprint under ~40 changed lines; NEVER touch",
        "  imports or code from the READ-ONLY modules the game context",
        "  names; never change game physics, turn logic or netcode.",
        "- READ-ONLY-DEFINED DISPLAY TEXT: if the narrated text is DEFINED in",
        f"  a read-only module but RENDERED in {app_label}, the fix happens at the",
        f"  {app_label} DISPLAY site — replace the rendering expression with a",
        "  local override (a small local map or an inline conditional). A",
        "  read-only definition NEVER makes the fix impossible; NEVER edit",
        "  the read-only module.",
        "- to MOVE a block: exactly TWO edits (removal: old = unique context",
        "  + block, new = the SAME context WITHOUT the block; insertion:",
        "  old = unique destination context, new = context + block). NEVER a",
        '  bare deletion (new == "" is forbidden).',
        "- to REMOVE something (a class, an effect, a word): exactly ONE",
        "  edit — old = the SMALLEST containing string (e.g. the element's",
        "  one className line, or just the className value if unique),",
        "  new = the SAME string WITHOUT the removed part. A removal is a",
        '  REPLACEMENT, never an empty `new`.',
        "- MINIMAL ANCHORS (hard): each `old`/`new` is the SHORTEST snippet",
        "  that still appears exactly once — usually ONE line or part of a",
        "  line. NEVER paste whole JSX blocks or long multi-line sections",
        "  when a shorter unique anchor exists; long anchors overflow the",
        "  output budget and the whole answer dies truncated.",
        "- to SPLIT one element into two: exactly ONE edit (old = the whole",
        "  current element verbatim, new = the two resulting elements).",
        "- CLOSING-TAG MOVES (hard gate, the fk6n class): closing an",
        "  element early / pulling content out of a box is exactly TWO",
        "  edits — inserted closing tag in one, removal of the original",
        "  closing tag in the other — or ONE whole-element replacement.",
        "  NEVER insert a lone closing or opening tag: the gate sums tag",
        "  balance across the whole proposal and refuses unbalanced sets",
        "  (a lone </div> breaks the build).",
        "- edits apply top to bottom; propose them so each `old` still",
        "  appears exactly once at its turn.",
        "",
        "If you truly cannot implement the committed fix under these rules,",
        "return an empty edits list — the run reports that honestly. Never",
        "invent anchors: copy them from the source block below.",
    ]
    # v4.9.5: the game's own context file rides along in this round too —
    # its lanes and conventions apply to the emission as well
    lines.extend(game_context_block(game_context).splitlines())
    lines.append("")
    lines += [
        f"--- {app_label} (EDITABLE — the only editable file) ---",
        "```tsx",
        app_src,
        "```",
    ]
    if feedback:
        lines.append(feedback)
    return "\n".join(lines)


def bump_version(cur: str) -> str:
    """v44 -> v44.1, v44.1 -> v44.2 (patch-only bump, repo convention)."""
    import re

    m = re.fullmatch(r"v(\d+)(?:\.(\d+))?", str(cur).strip())
    if not m:
        return ""
    if m.group(2) is None:
        return f"v{m.group(1)}.1"
    return f"v{m.group(1)}.{int(m.group(2)) + 1}"
