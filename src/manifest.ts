/* manifest.ts — the playvibe context manifest contract.
   THE CLEAN CUT (the ownership rule): this package ships the CONTRACT,
   the init validation and ONE neutral example — it deliberately carries
   ZERO values of any real game. Every game-specific value lives in the
   GAME's own repo (for the first integration: the game keeps its own
   manifest module and passes it to initPlayvibe at test-mode boot).
   The manifest MUST name the game's agent-facing context file —
   initPlayvibe refuses to boot the agent surface without it. No
   context file, no agent: the whole point of playvibe is that the agent
   that fixes a game also READS that game's own documented context.
   The field set was proven on the first real extraction (one game's
   test surface had 3 module imports, 10 api routes, 2 storage keys,
   1 workflow name, 4 env var names — every hardcoded game string
   mapped to exactly one field below). initPlayvibe stores the
   validated manifest in src/cfg.ts, and package modules read their cfg
   through pv() — no module in this package imports the consuming game. */

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
  },
  storageKeys: { debugPin: "pv-debug-pin", kickTok: "pv-kick-tok" },
  env: { agentToken: "PV_AGENT_TOKEN", githubToken: "PV_GITHUB_TOKEN", signKey: "PV_SIGN_KEY", debugPin: "PV_DEBUG_PIN" },
  storePrefixes: { session: "pvsess-", audio: "pvaud-", report: "pvreport-", brainState: "pvbrain-state-<unguessable-suffix>" },
  contextFile: "AGENT-CONTEXT.md",
  version: "v0.0.0",
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
  if (!m.routes.session || !m.routes.audio || !m.routes.transcribe || !m.routes.kick || !m.routes.agentqa || !m.routes.state || !m.routes.fixes || !m.routes.room || !m.routes.debug) {
    missing.push("routes");
  }
  if (!m.storageKeys.debugPin || !m.storageKeys.kickTok) missing.push("storageKeys");
  if (!m.env.agentToken || !m.env.signKey) missing.push("env");
  if (!m.storePrefixes.session || !m.storePrefixes.audio || !m.storePrefixes.brainState) missing.push("storePrefixes");
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
