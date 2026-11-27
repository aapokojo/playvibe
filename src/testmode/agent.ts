/* agent.ts: store-side transcription kick + on-demand brain kick. */

import { pv, pvRoute } from "../cfg";

/* kick the store-side transcription (the audio never comes back to
   the device). Non-blocking by design: the transcript docs are the
   brain's inputs; TEST MODE just names the stage, or the honest reason
   it did not start (missing key = 503 = a server env var, not a
   broken game — everything else about the session already succeeded). */
export const kickTranscribe = async (
  sid: string,
  flash: (m: string) => void,
  onReady?: (sid: string) => void,
): Promise<void> => {
  try {
    flash("transcription running…");
    const r = await fetch(pvRoute("transcribe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid }),
    });
    if (!r.ok) {
      flash(
        r.status === 503
          ? "transcription: the server's transcription key is not set (server being configured - the rest of the pipeline is ok)"
          : `transcription failed (HTTP ${r.status}) — session still ok`,
      );
      return;
    }
    const j = (await r.json().catch(() => null)) as { words?: number; seconds?: number } | null;
    flash(`transcription ✓ ${j?.words ?? "?"} words — the agent gets the text`);
    if (onReady) onReady(sid);
  } catch (e) {
    flash(`transcription did not start (${e instanceof Error ? e.message : "?"}) — session still ok`);
  }
};

/* on-demand brain kick — the ANALYZE NOW button. POST to the kick route
   {sid} starts ONE execution of the game's brain workflow (the name
   lives in the manifest's workflowName; the workflow fetches the session
   JSON + transcript from the store by the sid, so nothing but the sid
   crosses this call). Non-blocking by design:
   progress lands in the brain-state doc, which the 30 s TEST MODE poll
   already renders as the AGENT line — analyzing → fixing → waiting →
   done. Honest failures are named in the status line, always in Finnish,
   and never block the session pipeline that already succeeded. */
export const kickAnalysis = async (sid: string, flash: (m: string) => void, onPinNeeded?: (sid: string) => void): Promise<boolean> => {
  /* returns whether the kick actually started, so the button can
     reappear on failure (the old gate hid it for good). The kick carries
     the cached test-mode code (sessionStorage); the kick route refuses without
     it, so a flipped localStorage alone can no longer start the agent. */
  try {
    flash("analysis starting…");
    let pin = "";
    try {
      pin = sessionStorage.getItem(pv().storageKeys.debugPin) || "";
    } catch {
      /* private mode: no cached code — the server asks via 401 */
    }
    /* the durable kick credential. The debug route issues this
       server-signed token after a correct code (HMAC over AGENT_TOKEN,
       fixed domain tag); localStorage keeps it across PWA restarts so
       ANALYZE NOW never asks for the code again. The code itself still
       never persists on the device — the token unlocks only the
       kick route's game lane, not the debug route. */
    let kick = "";
    try {
      kick = localStorage.getItem(pv().storageKeys.kickTok) || "";
    } catch {
      /* private mode: token lost with storage — the 401 path re-asks */
    }
    const r = await fetch(pvRoute("kick"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid, pin, kick }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      const err = j && typeof j.error === "string" && j.error ? j.error : "";
      /* a missing or stale cached code no longer dead-ends the
         funnel. A full PWA restart clears sessionStorage (where the code
         is cached) while test mode stays on from localStorage, which
         surfaced on the phone as a dead-end. Now the kick
         re-opens the TEST MODE CODE prompt and auto-resumes after a
         correct code. */
      if (r.status === 401) {
        flash(`analysis: ${err} — enter the test-mode code`);
        if (onPinNeeded) onPinNeeded(sid);
        return false;
      }
      flash(
        err
          ? `analysis: ${err}`
          : r.status === 404
          ? "analysis: the brain workflow is not running (registration in progress)"
          : `analysis did not start (HTTP ${r.status})`,
      );
      return false;
    }
    flash("analysis running — the AGENT section updates");
    return true;
  } catch (e) {
    flash(`analysis did not start (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};
