# playvibe

The TESTITILA player-oversight agent surface as a standalone, game-agnostic
component, extracted from Blast Bugs (`aapokojo/blastbugs`). One panel on the
player's screen — REC/STOP narration recorder, the wire funnel, the AGENTTI
state line, JONO (analysis queue), KORJAUKSET (the full change ledger with
PALAUTA), the agent question inbox and the reload gate — plus the manifest
contract that binds it to any game.

## Status (step 1 landed, 2026-11-26)

`src/testmode/` is a VERBATIM snapshot of blastbugs at sha `8116fd28cb`
(app v45.65), minus STEP 1: `funnel.ts` no longer imports the game
(`../net`, `../engine` are gone) — its three relay fetchers arrive as
cfg taps (`pv().net`, typed `PlayvibeNet` in `src/manifest.ts`), and
`initPlayvibe` stores the validated manifest in the package-wide cfg
holder (`src/cfg.ts`). The remaining game imports (`../version` in
`TestPanel.tsx`) and the hardcoded `/api/*` routes + storage keys are
steps 2-4. blastbugs keeps running its own copy until playvibe is
proven, then consumes it as a package.

Files: `types.ts` (session shape), `funnel.ts` (wire relay taps),
`upload.ts` (sliced idempotent audio transport), `agent.ts`
(transcribe/analysis kicks), `fixes.ts` (KORJAUKSET + JONO transport),
`QAInput.tsx`, `DebugPinPrompt.tsx`, `controller.ts` (useTestController +
useTestAgent), `TestPanel.tsx`.

## The manifest contract (`src/manifest.ts`)

The grep of the snapshot found the entire game-specific surface, and it is
small: 3 game imports, 10 api routes, 2 storage keys, 1 workflow name,
4 env var names. `PlayvibeManifest` types all of it;
`BLASTBUGS_MANIFEST` carries the live blastbugs values as the first
consumer and the fixture for tests.

The contract with teeth: `initPlayvibe(m)` throws unless the manifest is
complete, and `contextFile` (the game's repo-root context document the
brain reads for rules, conventions and lane contracts — blastbugs:
`AGENT-CONTEXT.md`) is required. **No context file, no agent** — an agent
that fixes a game without reading that game's documented context is the
exact failure mode this pipeline exists to prevent.

## Generalization plan (in order, each step proven live before the next)

1. DONE (2026-11-26): `funnel.ts`'s `../net` / `../engine` imports are
   cfg taps — `pv().net` (`PlayvibeNet`), exactly like
   `useTestController`'s canvasRef/engRef/probeEvRef seams (the proven
   pattern — controller already takes every game touch as cfg).
   `BLASTBUGS_MANIFEST` ships as a seed without `net` (this repo has no
   game modules to point at); the game adds its own net client at boot.
2. `TestPanel.tsx`: the `../version` import becomes a prop or manifest
   read (controller already receives `version` via cfg — one seam left).
3. The 10 fetch routes, 2 storage keys and the workflow name migrate to
   manifest fields; the storage-key reads (`fixes.ts`, `agent.ts`) and
   fetch sites switch to manifest values. `BLASTBUGS_MANIFEST` stays as
   the fixture.
4. Server side: the `/api/*` handlers (in blastbugs' `api/`) become a
   documented contract — each route's request shape is already in the
   `PlayvibeRoutes` comments.

## Integration plan

blastbugs consumes playvibe as a package: `src/testmode` is deleted,
imports point here, `initPlayvibe({ ...BLASTBUGS_MANIFEST, net: {
getRoom, getSnap, getLive } })` runs at test-mode boot (step 1 made
`net` a required manifest field — the funnel's relay fetchers come from
the game). The context file is the non-negotiable init requirement.

## House rules (from blastbugs, unchanged)

- The KORJAUKSET ledger records ALL changes irrespective of channel.
- The player, not the agent, is the reversal authority (PALAUTA).
- The device saves nothing, ever (in-memory outbox + YRITÄ UUDELLEEN).
- Honest state lines always; a failed hop names itself.
