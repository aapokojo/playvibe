# playvibe

The TESTITILA player-oversight agent surface as a standalone, game-agnostic
component, extracted from Blast Bugs (`aapokojo/blastbugs`). One panel on the
player's screen — REC/STOP narration recorder, the wire funnel, the AGENTTI
state line, JONO (analysis queue), KORJAUKSET (the full change ledger with
PALAUTA), the agent question inbox and the reload gate — plus the manifest
contract that binds it to any game.

## Status (step 1 + clean cut + comment pass landed, 2026-11-26)

`src/testmode/` is a snapshot of blastbugs at sha `8116fd28cb`
(app v45.65), minus STEP 1: `funnel.ts` no longer imports the game
(`../net`, `../engine` are gone) — its three relay fetchers arrive as
cfg taps (`pv().net`, typed `PlayvibeNet` in `src/manifest.ts`), and
`initPlayvibe` stores the validated manifest in the package-wide cfg
holder (`src/cfg.ts`). Since 0.4.0 the comments are neutralized too:
every blastbugs version tag (vNN / v45.NN) and game-specific reference
was rewritten to product-neutral wording — the technical rationale
stays, the code is unchanged. The remaining game imports
(`../version` in `TestPanel.tsx`) and the hardcoded `/api/*` routes +
storage keys are steps 2-4 — they are the snapshot's OWN leftovers and
will be migrated to manifest reads; the package ships no real-game
values (`EXAMPLE_MANIFEST` is fictional). blastbugs keeps running its
own copy until playvibe is proven, then consumes it as a package.

Files: `types.ts` (session shape), `funnel.ts` (wire relay taps),
`upload.ts` (sliced idempotent audio transport), `agent.ts`
(transcribe/analysis kicks), `fixes.ts` (KORJAUKSET + JONO transport),
`QAInput.tsx`, `DebugPinPrompt.tsx`, `controller.ts` (useTestController +
useTestAgent), `TestPanel.tsx`.

## The manifest contract (`src/manifest.ts`)

The field set was proven on the first real extraction (3 game module
imports, 10 api routes, 2 storage keys, 1 workflow name, 4 env var
names). `PlayvibeManifest` types all of it. **The clean cut: this
package ships ZERO values of any real game.** `EXAMPLE_MANIFEST` is a
neutral, fictional template; every real game owns its manifest values
in its own repo and passes them to `initPlayvibe` at test-mode boot.

The contract with teeth: `initPlayvibe(m)` throws unless the manifest is
complete, and `contextFile` (the game's repo-root context document the
brain reads for rules, conventions and lane contracts — e.g.
`AGENT-CONTEXT.md`) is required. **No context file, no agent** — an agent
that fixes a game without reading that game's documented context is the
exact failure mode this pipeline exists to prevent.

## Generalization plan (in order, each step proven live before the next)

1. DONE (2026-11-26): `funnel.ts`'s `../net` / `../engine` imports are
   cfg taps — `pv().net` (`PlayvibeNet`), exactly like
   `useTestController`'s canvasRef/engRef/probeEvRef seams (the proven
   pattern — controller already takes every game touch as cfg).
   The game's static values are typed with `PlayvibeManifestSeed` in
   the GAME's repo and combined with its net client at boot — this
   package ships only the contract and `EXAMPLE_MANIFEST`.
2. `TestPanel.tsx`: the `../version` import becomes a prop or manifest
   read (controller already receives `version` via cfg — one seam left).
3. The 10 fetch routes, 2 storage keys and the workflow name migrate to
   manifest fields; the storage-key reads (`fixes.ts`, `agent.ts`) and
   fetch sites switch to manifest values; the game's own manifest module
   (in the game repo) is the fixture, not this package.
4. Server side: the `/api/*` handlers (in blastbugs' `api/`) become a
   documented contract — each route's request shape is already in the
   `PlayvibeRoutes` comments.

## Integration plan

blastbugs consumes playvibe as a package: `src/testmode` is deleted,
imports point here, and the game's OWN manifest (blastbugs keeps its
values at `src/pv-manifest.ts` in the game repo — the clean cut: this
package never carried them) feeds `initPlayvibe({ ...GAME_MANIFEST,
net: { getRoom, getSnap, getLive } })` at test-mode boot (step 1 made
`net` a required manifest field — the funnel's relay fetchers come from
the game). The context file is the non-negotiable init requirement.

## House rules (from blastbugs, unchanged)

- The KORJAUKSET ledger records ALL changes irrespective of channel.
- The player, not the agent, is the reversal authority (PALAUTA).
- The device saves nothing, ever (in-memory outbox + YRITÄ UUDELLEEN).
- Honest state lines always; a failed hop names itself.
