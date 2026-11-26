/* fixes.ts: v45.50 — the TESTITILA player-oversight surface transport:
   KORJAUKSET (past fixes + PALAUTA revert) and JONO (the analysis
   queue). The player — not the brain — is the reversal authority:
   an unsatisfactory fix is reverted from HERE (a deterministic,
   player-authorized job; the brain never reverses on narration), and
   several narrated sessions can queue while exactly one brain run is
   in flight at a time.

   Reads (poll every 30 s like the QA inbox) need no credential; the
   mutations reuse the v45.16 kick credentials (/api/kick's game lane:
   sessionStorage debug pin + localStorage kick token — the HMAC token
   /api/debug issues after a correct code; same 401 koodi re-ask flow
   as kickAnalysis, so the parked pin prompt auto-resumes). */

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

/* the same credential pair /api/kick checks (v45.16): the debug PIN is
   session-scoped, the kick token is durable across PWA restarts */
const creds = () => {
  let pin = "";
  let kick = "";
  try {
    pin = sessionStorage.getItem("bb-debug-pin") || "";
  } catch {
    /* private mode: no cached code — the 401 path re-asks */
  }
  try {
    kick = localStorage.getItem("bb-kick-tok") || "";
  } catch {
    /* private mode: token lost with storage — the 401 path re-asks */
  }
  return { pin, kick };
};

const postFixes = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/fixes", {
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
    const r = await fetch("/api/fixes", { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as Partial<FixesData> | null;
    if (!j || !Array.isArray(j.fixes) || !j.queue || !Array.isArray(j.queue.items)) return null;
    return {
      /* v45.57: the fixlog is ASCENDING (oldest first), so slice(0, 12)
         kept the OLDEST 12 and the panel's newest visible row was v45.48
         while the game ran v45.56. Keep the NEWEST 12 instead
         (slice(-12)); the KORJAUKSET list reverses for display. */
      fixes: j.fixes.slice(-12),
      queue: { running: j.queue.running ?? null, items: j.queue.items.slice(0, 12) },
    };
  } catch {
    return null;
  }
};

/* LISÄÄ JONOON (replaces the direct kick behind the ANALYSOI button):
   starts immediately when the brain is idle, waits its turn otherwise.
   The signature matches kickAnalysis exactly, so the button's parked-pin
   flow (kickAfterPinRef/setDebugPin/setDebugAsk) is unchanged. */
export const queueAnalysis = async (
  sid: string,
  flash: (m: string) => void,
  onPinNeeded?: (sid: string) => void,
): Promise<boolean> => {
  try {
    flash("analyysi lisätään jonoon…");
    const r = await postFixes({ action: "enqueue", sid, ...creds() });
    if (!r.ok) {
      if (r.status === 401 && r.err.includes("koodi")) {
        flash(`analyysi: ${r.err} — syötä testitilan koodi`);
        if (onPinNeeded) onPinNeeded(sid);
        return false;
      }
      flash(r.err ? `analyysi: ${r.err}` : `jono ei käynnistynyt (HTTP ${r.status})`);
      return false;
    }
    flash("analyysi jonossa — AGENTTI-osio ja JONO päivittyvät");
    return true;
  } catch (e) {
    flash(`jono ei käynnistynyt (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};

/* PALAUTA: enqueue a player-authorized revert of one shipped fix. The
   brain executes it as a deterministic gated push (no model verdict):
   the stored edits invert, the pipeline bumps + verifies as usual.
   Only entries that carry their recorded edits are revertible — older
   chat-era fixes display-only (their exact diffs were never stored). */
export const requestRevert = async (fixId: string, flash: (m: string) => void): Promise<boolean> => {
  try {
    const r = await postFixes({ action: "revert", fixId, ...creds() });
    if (!r.ok) {
      flash(r.err ? `palautus: ${r.err}` : `palautus ei käynnistynyt (HTTP ${r.status})`);
      return false;
    }
    flash("palautus jonossa — aivot suorittavat sen deterministisesti");
    return true;
  } catch (e) {
    flash(`palautus ei käynnistynyt (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};

/* remove a WAITING item from the queue (the running row and the
   finished/failed history rows stay) */
export const dequeueItem = async (id: string, flash: (m: string) => void): Promise<boolean> => {
  try {
    const r = await postFixes({ action: "dequeue", id, ...creds() });
    if (!r.ok) {
      flash(r.err ? `jono: ${r.err}` : `poisto ei onnistunut (HTTP ${r.status})`);
      return false;
    }
    return true;
  } catch (e) {
    flash(`poisto ei onnistunut (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};
