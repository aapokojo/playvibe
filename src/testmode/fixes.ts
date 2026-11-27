/* fixes.ts: the TEST MODE player-oversight surface transport:
   FIXES (past fixes + REVERT revert) and QUEUE (the analysis
   queue). The player — not the brain — is the reversal authority:
   an unsatisfactory fix is reverted from HERE (a deterministic,
   player-authorized job; the brain never reverses on narration), and
   several narrated sessions can queue while exactly one brain run is
   in flight at a time.

   Reads (poll every 30 s like the QA inbox) need no credential; the
   mutations reuse the same kick credentials (the kick route's game lane:
   sessionStorage debug pin + localStorage kick token — the HMAC token
   the debug route issues after a correct code; same 401 code re-ask flow
   as kickAnalysis, so the parked pin prompt auto-resumes). */

import { pv, pvRoute } from "../cfg";

export type FixEditPair = { file: string; old: string; new: string };
export type FixEntry = {
  id: string;
  version: string;
  desc: string;
  sid?: string;
  sha?: string;
  ts?: number;
  reverted?: boolean;
  reverts?: string;
  edits?: FixEditPair[];
};
export type QueueItem = {
  id: string;
  kind: "analyze" | "revert";
  sid?: string;
  fixId?: string;
  ts: number;
  status: "waiting" | "processing" | "done" | "failed";
};
export type QueueDoc = { running: { id: string; ts: number } | null; items: QueueItem[] };
export type FixesData = { fixes: FixEntry[]; queue: QueueDoc };

/* the same credential pair the kick route checks: the debug PIN is
   session-scoped, the kick token is durable across PWA restarts */
const creds = () => {
  let pin = "";
  let kick = "";
  try {
    pin = sessionStorage.getItem(pv().storageKeys.debugPin) || "";
  } catch {
    /* private mode: no cached code — the 401 path re-asks */
  }
  try {
    kick = localStorage.getItem(pv().storageKeys.kickTok) || "";
  } catch {
    /* private mode: token lost with storage — the 401 path re-asks */
  }
  return { pin, kick };
};

const postFixes = async (body: Record<string, unknown>) => {
  const r = await fetch(pvRoute("fixes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  const err = j && typeof j.error === "string" && j.error ? j.error : "";
  return { ok: r.ok, status: r.status, err };
};

export const pollFixes = async (): Promise<FixesData | null> => {
  try {
    const r = await fetch(pvRoute("fixes"), { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as Partial<FixesData> | null;
    if (!j || !Array.isArray(j.fixes) || !j.queue || !Array.isArray(j.queue.items)) return null;
    return {
      /* the fixlog is ASCENDING (oldest first): slice(0, N) would keep
         the OLDEST N and the newest ships would fall off the panel's
         list. Keep the NEWEST N instead (slice(-N)); the FIXES
         list reverses for display. */
      fixes: j.fixes.slice(-12),
      queue: { running: j.queue.running ?? null, items: j.queue.items.slice(0, 12) },
    };
  } catch {
    return null;
  }
};

/* ENQUEUE (replaces the direct kick behind the ANALYZE NOW button):
   starts immediately when the brain is idle, waits its turn otherwise.
   The signature matches kickAnalysis exactly, so the button's parked-pin
   flow (kickAfterPinRef/setDebugPin/setDebugAsk) is unchanged. */
export const queueAnalysis = async (
  sid: string,
  flash: (m: string) => void,
  onPinNeeded?: (sid: string) => void,
): Promise<boolean> => {
  try {
    flash("adding the analysis to the queue…");
    const r = await postFixes({ action: "enqueue", sid, ...creds() });
    if (!r.ok) {
      if (r.status === 401) {
        flash(`analysis: ${r.err} — enter the test-mode code`);
        if (onPinNeeded) onPinNeeded(sid);
        return false;
      }
      flash(r.err ? `analysis: ${r.err}` : `queue did not start (HTTP ${r.status})`);
      return false;
    }
    flash("analysis queued — the AGENT and QUEUE sections update");
    return true;
  } catch (e) {
    flash(`queue did not start (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};

/* REVERT: enqueue a player-authorized revert of one shipped fix. The
   brain executes it as a deterministic gated push (no model verdict):
   the stored edits invert, the pipeline bumps + verifies as usual.
   Only entries that carry their recorded edits are revertible — older
   fixes display-only (their exact diffs were never stored). */
export const requestRevert = async (fixId: string, flash: (m: string) => void): Promise<boolean> => {
  try {
    const r = await postFixes({ action: "revert", fixId, ...creds() });
    if (!r.ok) {
      flash(r.err ? `revert: ${r.err}` : `revert did not start (HTTP ${r.status})`);
      return false;
    }
    flash("revert queued — the brain runs it deterministically");
    return true;
  } catch (e) {
    flash(`revert did not start (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};

/* remove a WAITING item from the queue (the running row and the
   finished/failed history rows stay) */
export const dequeueItem = async (id: string, flash: (m: string) => void): Promise<boolean> => {
  try {
    const r = await postFixes({ action: "dequeue", id, ...creds() });
    if (!r.ok) {
      flash(r.err ? `queue: ${r.err}` : `removal failed (HTTP ${r.status})`);
      return false;
    }
    return true;
  } catch (e) {
    flash(`removal failed (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};
