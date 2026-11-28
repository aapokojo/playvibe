/* deploys.ts — the TEST MODE deployment-status transport (v0.9.2).
   The game's own Vercel deployment-webhook receiver (routes.deploys,
   POST) writes a small deploy-history doc into its store and serves
   the SAME route as a GET; this module is the panel's read side.
   Fully optional by manifest: a game that does not declare
   routes.deploys gets no DEPLOY band and no polling at all. */

import { pv } from "../cfg";

export type DeployEntry = {
  id: string;
  /** honest passthrough of Vercel's deployment state (READY, ERROR,
      BUILDING, CANCELED, ...) — the receiver never invents one */
  state: string;
  /** webhook event type (deployment.succeeded / deployment.error / ...) */
  event?: string;
  url?: string;
  target?: string;
  /** short commit sha when Vercel's meta carries one */
  sha?: string;
  ts: number;
};

export type DeploysDoc = { v: 1; deploys: DeployEntry[] };

export const pollDeploys = async (): Promise<DeploysDoc | null> => {
  if (!pv().routes.deploys) return null;
  try {
    const r = await fetch(pv().routes.deploys, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as Partial<DeploysDoc> | null;
    if (!j || !Array.isArray(j.deploys)) return null;
    return { v: 1, deploys: j.deploys.slice(0, 12) };
  } catch {
    return null;
  }
};

/* the receiver appends (oldest first) — display wants NEWEST first */
export const newestFirst = (d: DeploysDoc): DeployEntry[] => [...d.deploys].reverse();
