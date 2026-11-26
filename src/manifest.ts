/* manifest.ts — the playvibe context manifest contract (step 6 seed;
   GENERALIZATION STEP 1 landed: the net cfg taps below).
   The extracted TESTITILA agent surface is game-agnostic EXCEPT for the
   values typed here. A game integration MUST provide a manifest, and the
   manifest MUST name the game's agent-facing context file — initPlayvibe
   refuses to boot the agent surface without it. No context file, no
   agent: the whole point of playvibe is that the agent that fixes a game
   also READS that game's own documented context.
   Provenance: typed from the blastbugs seam — the grep of src/testmode
   at source sha 8116fd28cb (app v45.65) found 3 game imports, 10 api
   routes, 2 storage keys, 1 workflow name, 4 env var names; every one
   maps to exactly one field below.
   Step 1 (funnel.ts imports -> cfg taps): the first game import pair
   (../net + ../engine) is consumed. The funnel's three relay fetchers
   now arrive through `net` — BLASTBUGS_MANIFEST ships as a seed WITHOUT
   net (this repo has no game modules to point at); the game adds its
   own net client at boot: initPlayvibe({ ...BLASTBUGS_MANIFEST, net:
   { getRoom, getSnap, getLive } }). initPlayvibe stores the validated
   manifest in src/cfg.ts, and package modules read their cfg through
   pv() — no module in this package imports the consuming game. */

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
  /** brain work-state doc (GET) — feeds the AGENTTI line + reload gate */
  state: string;
  /** KORJAUKSET + JONO transport (GET; POST enqueue|revert|dequeue) */
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
  /** human game name, e.g. "Blast Bugs" */
  game: string;
  /** owner/repo of the GAME repo the agent fixes */
  repo: string;
  /** the Mistral workflow deployment name that runs the brain */
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
      KORJAUKSET conventions and lane contracts. initPlayvibe throws
      without it — no context file, no agent. */
  contextFile: string;
  /** running app version (badge + reload gate); at integration this
      value comes from the game's own version module */
  version: string;
}

/* The manifest minus the net taps: this repo cannot point at game
   modules, so the shipped game values are a SEED — the consuming game
   adds its own net client at boot:
   initPlayvibe({ ...BLASTBUGS_MANIFEST, net: { getRoom, getSnap, getLive } }). */
export type PlayvibeManifestSeed = Omit<PlayvibeManifest, "net">;

/* blastbugs' own values — the first consumer and the proof the seam is
   complete: every hardcoded string the snapshot grep found maps to
   exactly one field here. */
export const BLASTBUGS_MANIFEST: PlayvibeManifestSeed = {
  game: "Blast Bugs",
  repo: "aapokojo/blastbugs",
  workflowName: "blastbugs-brain",
  apiBase: "",
  routes: {
    session: "/api/session",
    audio: "/api/audio",
    transcribe: "/api/transcribe",
    kick: "/api/kick",
    agentqa: "/api/agentqa",
    state: "/api/state",
    fixes: "/api/fixes",
    room: "/api/room",
    debug: "/api/debug",
  },
  storageKeys: { debugPin: "bb-debug-pin", kickTok: "bb-kick-tok" },
  env: { agentToken: "BB_AGENT_TOKEN", githubToken: "BB_GITHUB_TOKEN", signKey: "BB_SIGN_KEY", debugPin: "BB_DEBUG_PIN" },
  storePrefixes: { session: "bbsess-", audio: "bbaud-", report: "bbreport-", brainState: "bbbrain-state-9a71f40c3dd2" },
  contextFile: "AGENT-CONTEXT.md",
  version: "v45.71",
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
  if (!m.routes.session || !m.routes.audio || !m.routes.transcribe || !m.routes.kick || !m.routes.agentqa || !m.routes.state || !m.routes.fixes) {
    missing.push("routes");
  }
  if (!m.storageKeys.debugPin || !m.storageKeys.kickTok) missing.push("storageKeys");
  if (!m.env.agentToken || !m.env.signKey) missing.push("env");
  if (!m.storePrefixes.session || !m.storePrefixes.audio || !m.storePrefixes.brainState) missing.push("storePrefixes");
  if (!m.net || typeof m.net.getRoom !== "function" || typeof m.net.getSnap !== "function" || typeof m.net.getLive !== "function") missing.push("net");
  if (missing.length) {
    throw new Error(
      `playvibe: manifest puuttuu kentät (${missing.join(", ")}) — kontekstitiedosto on pakollinen, agentti ei käynnisty ilman sitä`,
    );
  }
  /* step 1: store the validated manifest as the package-wide cfg —
     every game-specific read in the package goes through pv() */
  setActiveManifest(m);
  return m;
};
