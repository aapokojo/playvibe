# playvibe

The TEST MODE player-oversight agent surface as a standalone, game-agnostic
package. It gives any game one draggable panel through which the player
records narrated test sessions, watches an autonomous agent analyze and fix
the game live, queues work, answers the agent's questions and reverts
unsatisfactory fixes. Proven end to end in a real production web game;
the package itself carries zero values of any real game.

## What it is

The player-oversight loop for a game that is fixed by an autonomous agent:

1. The player records a narrated test session: gameplay events, wire
   packets, throttled canvas snapshots, mic + engine audio. The device
   saves nothing, ever; everything uploads to the game's store in
   idempotent slices (a failed upload parks in an in-memory outbox with a
   RETRY retry, never a file download).
2. The server transcribes the narration, and the player enqueues the
   session for analysis (ANALYZE NOW). Several sessions can queue; one
   brain run is in flight at a time.
3. The game's brain (a deployed agent, named in the manifest) fetches
   the session JSON + transcript, classifies the session (clean / needs
   a question / fixable), pushes gated fixes and verifies them live.
4. The panel shows it all: AGENT (live stage of the current run), QUEUE
   (waiting queue items), FIXES (the full change ledger, newest on
   top).
5. The player is the reversal authority: REVERT deterministically
   reverts the newest fix (2-tap confirm; it ships a real new version).
   The agent never reverses on its own.

The player-facing surface is in English (the first integration's own
game copy stays Finnish; its test panel now ships this package's
English UI); the contracts below are language-neutral.

## Technology

playvibe is built for WEB games, and the requirements run deep into the
browser:

- React 18+ (hooks + JSX). The panel's classes are Tailwind-style
  utility strings, so Tailwind is the natural host, but any styling
  pipeline that leaves the classNames alone works.
- Browser media APIs: MediaRecorder (mic + engine audio mix, in-page
  mp3 transcode via a lazily imported lamejs chunk), getUserMedia,
  AudioContext. The recorder carries hard-won mobile Safari/Chrome
  quirks (mime fallbacks, mic-denial classes), so a non-browser host
  cannot reuse these files as is.
- PWA-friendly, not PWA-required: safe-area insets for notched phones,
  a self-re-arming poll loop that survives iOS standalone-PWA timer
  suspension, web push for the notification toggle.

A non-web game (Unity, a native app) cannot mount the panel as is. What
it CAN still take from playvibe is everything around the panel: the
manifest contract, the store + route protocol, the session/queue/ledger
model and the brain contract. A native panel would be a
reimplementation of the same server contract, not this package.

## The brain provider

The pipeline is provider-neutral: a brain is a deployed agent that
fetches the session JSON + transcript from the game's store by sid and
follows the game's context file. playvibe is currently configured to
Mistral (the workflow deployment named in the manifest's
`workflowName`, plus server-side transcription). Extending to another
provider (Claude, ChatGPT) means implementing the same contract behind
the same routes; the panel, the queue and the ledger do not change.

## What a game must provide

- **A manifest**: every game-specific value (API routes, storage key
  names, server env var names, store prefixes, workflow name, context
  file name, brain configuration, analysis vocabulary) lives in the
  GAME's repo, not in this package. The game also serves the manifest
  seed at GET /api/manifest for the brain (names and paths only, no
  secret values, so the route needs no credential).
- **Three net taps**: `getRoom`, `getSnap`, `getLive` from the game's own
  net client (typed structurally in `PlayvibeNet`; no adapters needed if
  the shapes match).
- **Recorder seams**: the game canvas (screenshots), the engine's audio
  bus (`audioTap()`), and an engine event probe.
- **The nine server routes** listed below, plus their env vars.
- **A brain**: a deployed agent workflow (name goes in the manifest;
  see The brain provider) and the game's repo-root `AGENT-CONTEXT.md`,
  the context document the brain reads for game rules, conventions and
  lane contracts.

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
  brain: { origin: "https://my-game.example", appPath: "src/App.tsx",
           versionPath: "src/version.ts", readOnlyPaths: [],
           fixlogKey: "myfixlog", notifyTag: "my-analysis",
           versionScheme: "vNN-patch", liveVerify: "bundle-filename" },
  analysis: { keyEvents: ["levelup"], heartbeat: ["push-live"] },
};
```

`env` carries env var NAMES, not values: the game's server sets them.

### 3. Boot the surface when test mode opens

```ts
initPlayvibe({ ...GAME_MANIFEST, net: { getRoom, getSnap, getLive } });
```

`initPlayvibe` validates the manifest and throws if anything required is
missing. If the tapped fetchers also run OUTSIDE test mode (for example
your net client uses them in normal online play), call `initPlayvibe`
at module load instead of at test-mode boot: `pv()` throws until the
manifest is initialized, and the taps must never run uninitialized.
That is how the first integration booted it. The context file is not a
nice-to-have: no context file, no agent, because an agent that fixes a
game without reading that game's documented context is the exact
failure mode this pipeline exists to prevent.

### 4. Wire the hooks and mount the panel

```tsx
const ctl = useTestController({
  canvasRef,   // your game canvas (snapshots)
  engRef,      // engine handle; optional audioTap() feeds the sfx bus into the recording
  probeEvRef,  // set it to feed engine events ({t, ...}) into the session
  mode,        // session-meta stamps
  room,        // { code, role } | null
  version: APP_VERSION,
  setKickSid,  // called when transcription succeeds (the ANALYZE NOW target)
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
| `kick` | POST | `{sid, pin, kick}` | two credential lanes: game lane (session debug pin or durable HMAC kick token) or agent lane (server token); starts ONE brain run; 401 with the server's missing- or wrong-code message |
| `debug` | POST | the test-mode code | verifies against the server's debug-pin env var, issues the durable kick token; the code never ships in the bundle |
| `agentqa` | GET/POST | GET `{questions[]}`; POST `{action:"answer", id, choice}` | player answers are anonymous; ask/consume need the agent token |
| `state` | GET | `{current: {sid, stage, note, ts, pushed?}}` | stages: uploaded, transcribed, analyzing, fixing, reverting, waiting, done; `pushed` (v0.7.0): true/false when a brain run's own fix landed or was gate-refused |
| `fixes` | GET/POST | GET `{fixes[], queue}`; POST `{action: "enqueue"\|"revert"\|"dequeue", ...}` | reads are credential-free; mutations use the kick credentials; fixes arrive ascending |
| `room` | HEAD | - | origin prewarm so the STOP-time upload never fires on a cold, hours-dormant path |

Env vars the server needs (names come from your manifest): the agent
token (gates notify + qa ask/consume), the GitHub token (the brain's
push lane), the signing key (signed writes) and the debug pin.

### 7. Deploy the brain and write your context file

Serve the manifest seed at GET /api/manifest (serialize the same
module you pass to initPlayvibe). Deploy the brain workflow (name
matches `workflowName`; today that is a Mistral workflow deployment,
see The brain provider); it fetches your manifest from that route at
run start, then the session JSON + transcript from your store by sid,
and follows the rules in your `AGENT-CONTEXT.md`. The panel renders its progress from
the `state` doc and its shipped fixes land in FIXES through the
`fixes` route. Keep the ledger rule in your context file: every change,
every lane, no exceptions.

## House rules

- The FIXES ledger records ALL changes irrespective of channel
  (agent, chat, infrastructure; display-only entries when there are no
  stored edits).
- The player, not the agent, is the reversal authority (REVERT).
- The device saves nothing, ever (in-memory outbox + RETRY).
- Honest state lines always; a failed hop names itself.
- Server first: the session JSON is on the server before anything else
  happens, bounded by a wall-clock deadline.

## Current state (0.7.0)

- The player-facing UI is fully English (section names AGENT /
  QUEUE / FIXES, buttons ANALYZE NOW / REVERT / RETRY / LOAD NEW
  VERSION, all state lines, titles and error strings). The one Finnish
  string kept is a legacy FALLBACK for the done-note contract
  ("korjausta ei pushattu"): from v0.7.0 the brain's state doc carries
  a structured `pushed` flag the panel reads instead, and the prefix
  check only covers a pre-v4.10 brain still being deployed.
- The package is game-agnostic through and through: no game name,
  route, storage key or version is hardcoded anywhere. The net taps are
  injected at boot, every fetch URL is built from the manifest
  (`apiBase` + route), the storage keys and the badge version come
  from the manifest, and no file imports anything from the host game.
- `tsconfig.json` ships with the package: in a checkout run
  `npm install typescript react react-dom @types/react @types/react-dom`
  then `npm run typecheck` to verify (strict, no emit).
- The brain's per-game configuration travels IN THE MANIFEST (v0.7.0):
  the `brain` section (origin, editable + version file paths, fixlog
  key, notify tag, version bump scheme, live-verify shape) and the
  `analysis` vocabulary (key events + heartbeat kinds). The game
  serves the manifest seed at GET {origin}/api/manifest and the brain
  fetches it at run start, so a brain deployment carries zero game
  values beyond its one bootstrap origin. A second brain implements
  the same provider-neutral contract against the same route.
