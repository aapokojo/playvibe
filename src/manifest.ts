/* manifest.ts — the playvibe context manifest contract.
   THE CLEAN CUT (the ownership rule): this package ships the CONTRACT,
   the init validation and ONE neutral example — it deliberately carries
   ZERO values of any real game. Every game-specific value lives in the
   GAME's own repo (for the first integration: the game keeps its own
   manifest module and passes it to initPlayvibe at test-mode boot).
   The manifest MUST name the game's agent-facing context file —
   initPlayvibe refuses to boot the agent surface without it. No
   context file, no agent: the whole point of playvibe is that the
   agent that fixes a game also READS that game's own documented
   context. The field set was proven on the first real extraction (one
   game's test surface had 3 module imports, 10 api routes, 2 storage
   keys, 1 workflow name, 4 env var names — every hardcoded game
   string mapped to exactly one field below). initPlayvibe stores the
   validated manifest in src/cfg.ts, and package modules read their cfg
   through pv() — no module in this package imports the consuming game.
   v0.7.0: the manifest is ALSO the brain's per-game configuration.
   The game serves its static seed at GET {origin}/api/manifest (the
   net taps are runtime objects and never serialize); the brain fetches
   that route at run start, so a brain deployment carries zero game
   values beyond its one bootstrap origin. The done-note contract is
   structured from this version on: the brain writes `pushed`
   (true/false) into its state doc's current job and the panel reads
   the flag; the legacy Finnish note prefix is only a fallback while a
   pre-v4.10 brain is still deployed.
   v0.8.0: routes.broker + routes.notify. Two lanes the PANEL does not
   consume but the brain does: the broker (the agent's only store
   access: session/report/state/ledger reads and writes behind the
   agent token) and notify (the agent's result-push endpoint).
   Declaring them here means the brain builds EVERY URL it calls from
   the served manifest — no game route is hardcoded in the brain.
   v0.8.1: panel behavior only, no field change — the agent work-state
   poll gained a stale-state guard. Between a kick and the new run's
   first stage note the shared state doc still describes the PREVIOUS
   run, so the panel briefly rendered the old run's completed state
   (first seen live on a phone). The poll now replaces any doc whose
   sid is not the kicked sid (within the 10-minute kick window) with
   a neutral "analysis starting" placeholder; sid equality is immune
   to phone/server clock skew, which a ts comparison is not. */

import { setActiveManifest } from "./cfg";

export interface PlayvibeRoutes {
  /** session JSON slices, idempotent store writes (POST {sid, part, total, data}) */
  session: string;
  /** audio base64 slices, 40 KB parts (POST {sid, part, total, data, mime, bytes, trunc}) */
  audio: string;
  /** store-side transcription kick (POST {sid}) */
  transcribe: string;
  /** brain kick credential lane (POST {sid, pin, kick}) */
  kick: string;
  /** agent question inbox (GET; POST {action:"answer", id, choice}) */
  agentqa: string;
  /** brain work-state doc (GET) — feeds the AGENT line + reload gate */
  state: string;
  /** FIXES + QUEUE transport (GET; POST enqueue|revert|dequeue) */
  fixes: string;
  /** origin prewarm HEAD (STOP-time upload must not fire on a cold path) */
  room: string;
  /** test-mode code verification, HMAC kick token issuer (POST) */
  debug: string;
  /** v0.8.0: the agent-token-guarded store broker — the brain's ONLY
      store access (session/report/state/ledger docs). Brain-facing;
      the panel never calls it */
  broker: string;
  /** v0.8.0: the brain's result-push endpoint (POST {token, title,
      body, url, tag}). Brain-facing; the panel never calls it */
  notify: string;
}

export interface PlayvibeStorageKeys {
  /** session-scoped debug pin (cleared on PWA restart by design) */
  debugPin: string;
  /** durable HMAC kick token (survives PWA restarts) */
  kickTok: string;
}

export interface PlayvibeEnv {
  /** server env var NAMES (not values) the game must set */
  agentToken: string;
  githubToken: string;
  signKey: string;
  debugPin: string;
}

export interface PlayvibeStorePrefixes {
  /** session JSON docs: <prefix><sid> */
  session: string;
  /** narration audio parts: <prefix><sid>-<n> */
  audio: string;
  /** per-session brain reports: <prefix><sid> */
  report: string;
  /** brain public work-state doc (unguessable suffix = the gate) */
  brainState: string;
}

/* ---- v0.7.0: the brain section + the analysis vocabulary ---- */
export interface PlayvibeBrain {
  /** absolute origin the brain reaches the game's API at (the brain
      runs in the cloud; same-origin "" is meaningless there) */
  origin: string;
  /** the brain's ONLY editable file (the game's app lane); its BASENAME
      is the label the whole pipeline speaks (gates, prompts, commits) */
  appPath: string;
  /** the file holding the single version literal the pipeline bumps */
  versionPath: string;
  /** extra read-only files fetched for prompt context (may be empty) */
  readOnlyPaths: readonly string[];
  /** the change-ledger store key (broker) */
  fixlogKey: string;
  /** push-notification tag for the notify lane */
  notifyTag: string;
  /** version bump convention the pipeline applies; "vNN-patch":
      v45 -> v45.1 -> v45.2 (the only scheme the brain implements
      today — it validates the declared value and fails named on
      anything else rather than bumping wrong) */
  versionScheme: "vNN-patch";
  /** live-verify convention; "bundle-filename": the hashed bundle
      filename change on the origin (the only shape the brain
      implements today — the Vite/Vercel asset pattern; validated,
      fails named on anything else) */
  liveVerify: "bundle-filename";
}

export interface PlayvibeAnalysis {
  /** the game's key events: counted, and each is expected to pair
      with a +1.5 s snapshot frame (the first game: ["boom"]).
      readonly: games type their seed with `as const` */
  keyEvents: readonly string[];
  /** wire packet kinds whose cadence is stall-checked (the owning
      client's live-state stream; gaps > 2 s = relay stall). readonly:
      games type their seed with `as const` */
  heartbeat: readonly string[];
}

/* ---- GENERALIZATION STEP 1: the funnel's relay-fetcher cfg taps ----
   Typed STRUCTURALLY from exactly what funnel.ts reads (nothing more):
   a game's own net client satisfies these without adapters as long as
   its room doc / snapshot / live envelope carry these fields — the
   live packet's `lv` stays unknown (the wire's own contract; funnel
   casts it to PlayvibeLivePacket at the read, the same cast pattern
   the game-side funnel always used for getSnap). */
export interface PlayvibeRoomDoc {
  status?: string;
  turnCount?: number;
  w?: string;
  st?: number;
  rs?: number;
  rem?: string;
}
export interface PlayvibeSnap {
  turnCount: number;
  phase: string | number;
  timer?: number;
  rs?: number;
  activeBug?: unknown;
}
export interface PlayvibeLivePacket {
  tc: number;
  tf: number;
  es?: number;
  evs?: unknown[];
}
export interface PlayvibeLiveDoc {
  pid: string;
  lv: unknown;
}
export interface PlayvibeNet {
  getRoom(code: string): Promise<PlayvibeRoomDoc | null>;
  getSnap(code: string): Promise<unknown | null>;
  getLive(code: string): Promise<PlayvibeLiveDoc | null>;
}

export interface PlayvibeManifest {
  /** human game name */
  game: string;
  /** owner/repo of the GAME repo the agent fixes */
  repo: string;
  /** the deployed brain workflow's name (today a Mistral workflow
      deployment; the contract itself is provider-neutral) */
  workflowName: string;
  /** API base; "" = same-origin (routes are appended to it) */
  apiBase: string;
  routes: PlayvibeRoutes;
  storageKeys: PlayvibeStorageKeys;
  env: PlayvibeEnv;
  storePrefixes: PlayvibeStorePrefixes;
  /** REQUIRED (step 1): the funnel's relay-fetcher taps — the game's own
      net client functions; funnel.ts reads them through pv().net */
  net: PlayvibeNet;
  /** REQUIRED: repo-root context file the brain reads for game rules,
      FIXES conventions and lane contracts. initPlayvibe throws
      without it — no context file, no agent. */
  contextFile: string;
  /** running app version (badge + reload gate); at integration this
      value comes from the game's own version module */
  version: string;
  /** v0.7.0: the brain's per-game configuration — everything the
      analysis pipeline needs except its one bootstrap origin */
  brain: PlayvibeBrain;
  /** v0.7.0: the game's event/wire vocabulary for the deterministic
      session analysis (key events + heartbeat kinds) */
  analysis: PlayvibeAnalysis;
}

/* The manifest minus the net taps: a game's STATIC values can be
   typed with this in the game's own repo and combined with its net
   client at boot:
   initPlayvibe({ ...GAME_MANIFEST, net: { getRoom, getSnap, getLive } }). */
export type PlayvibeManifestSeed = Omit<PlayvibeManifest, "net">;

/* EXAMPLE_MANIFEST: a neutral template — a plausible shape for a
   FICTIONAL integration, wired to nothing. Games do not import this:
   copy it into your game repo, replace every value, add your net taps
   and pass the result to initPlayvibe at test-mode boot. If a real
   game's values ever appear here, the clean cut is broken. */
export const EXAMPLE_MANIFEST: PlayvibeManifestSeed = {
  game: "Example Game",
  repo: "you/example-game",
  workflowName: "example-game-brain",
  apiBase: "",
  routes: {
    session: "/api/pv-session",
    audio: "/api/pv-audio",
    transcribe: "/api/pv-transcribe",
    kick: "/api/pv-kick",
    agentqa: "/api/pv-agentqa",
    state: "/api/pv-state",
    fixes: "/api/pv-fixes",
    room: "/api/pv-room",
    debug: "/api/pv-debug",
    broker: "/api/pv-broker",
    notify: "/api/pv-notify",
  },
  storageKeys: { debugPin: "pv-debug-pin", kickTok: "pv-kick-tok" },
  env: { agentToken: "PV_AGENT_TOKEN", githubToken: "PV_GITHUB_TOKEN", signKey: "PV_SIGN_KEY", debugPin: "PV_DEBUG_PIN" },
  storePrefixes: { session: "pvsess-", audio: "pvaud-", report: "pvreport-", brainState: "pvbrain-state-<unguessable-suffix>" },
  contextFile: "AGENT-CONTEXT.md",
  version: "v0.0.0",
  brain: {
    origin: "https://example-game.vercel.app",
    appPath: "src/App.tsx",
    versionPath: "src/version.ts",
    readOnlyPaths: [],
    fixlogKey: "pvfixlog",
    notifyTag: "pv-analysis",
    versionScheme: "vNN-patch",
    liveVerify: "bundle-filename",
  },
  analysis: { keyEvents: ["levelup"], heartbeat: ["push-live"] },
};

/* init: the context file is not a nice-to-have. A game that ships the
   testmode surface without its context file gets an agent that guesses
   — the exact failure mode this whole pipeline exists to prevent. */
export const initPlayvibe = (m: PlayvibeManifest): PlayvibeManifest => {
  const missing: string[] = [];
  if (!m.game) missing.push("game");
  if (!m.repo) missing.push("repo");
  if (!m.workflowName) missing.push("workflowName");
  if (!m.contextFile) missing.push("contextFile");
  if (!m.routes.session || !m.routes.audio || !m.routes.transcribe || !m.routes.kick || !m.routes.agentqa || !m.routes.state || !m.routes.fixes || !m.routes.room || !m.routes.debug || !m.routes.broker || !m.routes.notify) {
    missing.push("routes");
  }
  if (!m.storageKeys.debugPin || !m.storageKeys.kickTok) missing.push("storageKeys");
  if (!m.env.agentToken || !m.env.signKey) missing.push("env");
  if (!m.storePrefixes.session || !m.storePrefixes.audio || !m.storePrefixes.brainState) missing.push("storePrefixes");
  if (!m.brain || !m.brain.origin || !m.brain.appPath || !m.brain.versionPath || !m.brain.fixlogKey || !m.brain.notifyTag || !m.brain.versionScheme || !m.brain.liveVerify) missing.push("brain");
  if (!m.analysis || !Array.isArray(m.analysis.keyEvents) || !m.analysis.keyEvents.length || !Array.isArray(m.analysis.heartbeat) || !m.analysis.heartbeat.length) missing.push("analysis");
  if (!m.net || typeof m.net.getRoom !== "function" || typeof m.net.getSnap !== "function" || typeof m.net.getLive !== "function") missing.push("net");
  if (missing.length) {
    throw new Error(
      `playvibe: manifest is missing fields (${missing.join(", ")}) — the context file is mandatory, the agent will not boot without it`,
    );
  }
  /* step 1: store the validated manifest as the package-wide cfg —
     every game-specific read in the package goes through pv() */
  setActiveManifest(m);
  return m;
};
