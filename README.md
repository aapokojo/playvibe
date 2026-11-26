# playvibe

The TESTITILA player-oversight agent surface as a standalone, game-agnostic
package. It gives any game one draggable panel through which the player
records narrated test sessions, watches an autonomous agent analyze and fix
the game live, queues work, answers the agent's questions and reverts
unsatisfactory fixes. Extracted from a real production game (Blast Bugs,
the first integration); the package itself carries zero values of any real
game.

## What it is

The player-oversight loop for a game that is fixed by an autonomous agent:

1. The player records a narrated test session: gameplay events, wire
   packets, throttled canvas snapshots, mic + engine audio. The device
   saves nothing, ever; everything uploads to the game's store in
   idempotent slices (a failed upload parks in an in-memory outbox with a
   YRITÄ UUDELLEEN retry, never a file download).
2. The server transcribes the narration, and the player enqueues the
   session for analysis (ANALYSOI NYT). Several sessions can queue; one
   brain run is in flight at a time.
3. The game's brain workflow (a deployed Mistral agent, named in the
   manifest) fetches the session JSON + transcript, classifies the
   session (clean / needs a question / fixable), pushes gated fixes and
   verifies them live.
4. The panel shows it all: AGENTTI (live stage of the current run), JONO
   (waiting queue items), KORJAUKSET (the full change ledger, newest on
   top).
5. The player is the reversal authority: PALAUTA deterministically
   reverts the newest fix (2-tap confirm; it ships a real new version).
   The agent never reverses on its own.

The player-facing surface is in Finnish by design (the reference game's
player is Finnish); the contracts below are language-neutral.

## What a game must provide

- **A manifest**: every game-specific value (API routes, storage key
  names, server env var names, store prefixes, workflow name, context
  file name) lives in the GAME's repo, not in this package.
- **Three net taps**: `getRoom`, `getSnap`, `getLive` from the game's own
  net client (typed structurally in `PlayvibeNet`; no adapters needed if
  the shapes match).
- **Recorder seams**: the game canvas (screenshots), the engine's audio
  bus (`audioTap()`), and an engine event probe.
- **The nine server routes** listed below, plus their env vars.
- **A brain**: a deployed Mistral workflow (name goes in the manifest)
  and the game's repo-root `AGENT-CONTEXT.md`, the context document the
  brain reads for game rules, conventions and lane contracts.

## Taking it into use

### 1. Bring the package in

Not on npm yet (private repo). Copy `src/` into your game repo or add it
as a git dependency. React >= 18 is a peer dependency. Imports are by
file path (no barrel index yet):

```ts
import { initPlayvibe } from "<playvibe>/src/manifest";
import { useTestController, useTestAgent } from "<playvibe>/src/testmode/controller";
import { TestPanel } from "<playvibe>/src/testmode/TestPanel";
import { DebugPinPrompt } from "<playvibe>/src/testmode/DebugPinPrompt";
import { getRoomT, getSnapT, getLiveT, TEST_URL } from "<playvibe>/src/testmode/funnel";
```

### 2. Write your manifest (in YOUR repo)

Copy `EXAMPLE_MANIFEST` from `src/manifest.ts`, replace every value, and
type it with `PlayvibeManifestSeed` so your net client is the only thing
added at boot:

```ts
// src/pv-manifest.ts (your repo)
import type { PlayvibeManifestSeed } from "<playvibe>/src/manifest";
import { APP_VERSION } from "./version";

export const GAME_MANIFEST: PlayvibeManifestSeed = {
  game: "My Game",
  repo: "me/my-game",
  workflowName: "my-game-brain",
  apiBase: "",                 // "" = same-origin
  routes: { session: "/api/session", audio: "/api/audio", /* ... 9 total */ },
  storageKeys: { debugPin: "mygame-debug-pin", kickTok: "mygame-kick-tok" },
  env: { agentToken: "MYGAME_AGENT_TOKEN", githubToken: "MYGAME_GITHUB_TOKEN",
         signKey: "MYGAME_SIGN_KEY", debugPin: "MYGAME_DEBUG_PIN" },
  storePrefixes: { session: "mysess-", audio: "myaud-", report: "myreport-",
                   brainState: "mybrain-state-<unguessable-suffix>" },
  contextFile: "AGENT-CONTEXT.md",
  version: APP_VERSION,
};
```

`env` carries env var NAMES, not values: the game's server sets them.

### 3. Boot the surface when test mode opens

```ts
initPlayvibe({ ...GAME_MANIFEST, net: { getRoom, getSnap, getLive } });
```

`initPlayvibe` validates the manifest and throws if anything required is
missing. The context file is not a nice-to-have: no context file, no
agent, because an agent that fixes a game without reading that game's
documented context is the exact failure mode this pipeline exists to
prevent.

### 4. Wire the hooks and mount the panel

```tsx
const ctl = useTestController({
  canvasRef,   // your game canvas (snapshots)
  engRef,      // engine handle; optional audioTap() feeds the sfx bus into the recording
  probeEvRef,  // set it to feed engine events ({t, ...}) into the session
  mode,        // session-meta stamps
  room,        // { code, role } | null
  version: APP_VERSION,
  setKickSid,  // called when transcription succeeds (the ANALYSOI target)
});

const agent = useTestAgent({ testMode, flash: toast }); // toast used outside test mode

<TestPanel
  {...ctl}                                   // the controller surface
  agentWork={agent.agentWork} qaList={agent.qaList} qaAnswer={agent.qaAnswer}
  reloadReady={agent.reloadReady} verBadgeRef={agent.verBadgeRef}
  kickSid={agent.kickSid} kickSent={agent.kickSent} setKickSent={agent.setKickSent}
  lastKickRef={agent.lastKickRef} kickAfterPinRef={agent.kickAfterPinRef}
  setDebugPin={setDebugPin} setDebugAsk={setDebugAsk}
  pushOn={pushOn} togglePush={togglePush}     // notification toggle state
  testCollapsed={...} setTestCollapsed={...} // collapse/drag layout state stays in the game
  testPos={...} setTestPos={...} testPanelRef={...} testDrag={...}
/>
```

The full prop list in `TestPanelProps` is the contract: every piece of
state the panel reads stays in the game and arrives as props, so a
testMode flip never loses it. `DebugPinPrompt` renders the test-mode code
prompt; the game keeps the `debugPin`/`debugAsk` state and the
`submitDebugPin` code path (5 taps on the version badge, or `?test=1`,
is the reference game's toggle; the toggle itself is game-owned).

### 5. Wrap your net client in test mode

During a session the funnel records summaries of every relay packet the
client observes. Wrap the three fetchers with `getRoomT`/`getSnapT`/
`getLiveT` (identical signatures; zero cost when no session is running)
and route engine events through the `probeEvRef` tap. `TEST_URL` is a
`?test=1` helper; `tapWire(k, d)` is the seam for the game's own pushes.

### 6. Implement the server routes

| Route | Method | Request / Response | Notes |
| --- | --- | --- | --- |
| `session` | POST | `{sid, part, total, data}` | session JSON in ~40 KB slices; idempotent store writes, index written last |
| `audio` | POST | `{sid, part, total, data, mime, bytes, trunc}` | base64 audio slices, 40 KB each, 64-part cap (about 5 min); index last |
| `transcribe` | POST | `{sid}` | server reassembles the audio, transcribes it, stores the transcript, mirrors the stage; 503 if the transcription API key is unset |
| `kick` | POST | `{sid, pin, kick}` | two credential lanes: game lane (session debug pin or durable HMAC kick token) or agent lane (server token); starts ONE brain run; 401 `koodi puuttuu` / `väärä koodi` |
| `debug` | POST | the test-mode code | verifies against the server's debug-pin env var, issues the durable kick token; the code never ships in the bundle |
| `agentqa` | GET/POST | GET `{questions[]}`; POST `{action:"answer", id, choice}` | player answers are anonymous; ask/consume need the agent token |
| `state` | GET | `{current: {sid, stage, note, ts}}` | stages: uploaded, transcribed, analyzing, fixing, reverting, waiting, done |
| `fixes` | GET/POST | GET `{fixes[], queue}`; POST `{action: "enqueue"\|"revert"\|"dequeue", ...}` | reads are credential-free; mutations use the kick credentials; fixes arrive ascending |
| `room` | HEAD | - | origin prewarm so the STOP-time upload never fires on a cold, hours-dormant path |

Env vars the server needs (names come from your manifest): the agent
token (gates notify + qa ask/consume), the GitHub token (the brain's
push lane), the signing key (signed writes) and the debug pin.

### 7. Deploy the brain and write your context file

Deploy a Mistral workflow whose name matches `workflowName`; it fetches
the session JSON + transcript from your store by sid and follows the
rules in your `AGENT-CONTEXT.md`. The panel renders its progress from
the `state` doc and its shipped fixes land in KORJAUKSET through the
`fixes` route. Keep the ledger rule in your context file: every change,
every lane, no exceptions.

## House rules

- The KORJAUKSET ledger records ALL changes irrespective of channel
  (agent, chat, infrastructure; display-only entries when there are no
  stored edits).
- The player, not the agent, is the reversal authority (PALAUTA).
- The device saves nothing, ever (in-memory outbox + YRITÄ UUDELLEEN).
- Honest state lines always; a failed hop names itself.
- Server first: the session JSON is on the server before anything else
  happens, bounded by a wall-clock deadline.

## Current state (0.4.0)

Honest limits of the package today, all queued as mechanical migration
steps:

- The client fetches still read the fixed `/api/*` paths and the two
  storage key literals from the first integration's snapshot; the
  manifest's `routes` and `storageKeys` fields are validated at init and
  become the read source in the pending migration steps. Until then,
  implement the routes at the paths above.
- `TestPanel.tsx` imports `../version` (a single `APP_VERSION`
  constant); provide that module next to the package until the seam
  moves to the manifest.
- The brain's own per-game configuration (repo, tokens, version bump
  scheme, live verify) is blastbugs-specific today; its generalization is
  separate queued work.
- Comments are neutralized (no first-game version tags or references);
  the code is the proven snapshot of the first real integration.
