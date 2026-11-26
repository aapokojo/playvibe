/* agent.ts: store-side transcription kick + on-demand brain kick. */

/* kick the store-side transcription (the audio never comes back to
   the device). Non-blocking by design: the transcript docs are the
   brain's inputs; TESTITILA just names the stage, or the honest reason
   it did not start (missing key = 503 = a server env var, not a
   broken game — everything else about the session already succeeded). */
export const kickTranscribe = async (
  sid: string,
  flash: (m: string) => void,
  onReady?: (sid: string) => void,
): Promise<void> => {
  try {
    flash("transkriptio käynnissä…");
    const r = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid }),
    });
    if (!r.ok) {
      flash(
        r.status === 503
          ? "transkriptio: MISTRAL_API_KEY puuttuu (palvelinta asetetaan — muu putki ok)"
          : `transkriptio ei onnistunut (HTTP ${r.status}) — sessio ok silti`,
      );
      return;
    }
    const j = (await r.json().catch(() => null)) as { words?: number; seconds?: number } | null;
    flash(`transkriptio ✓ ${j?.words ?? "?"} sanaa — agentti saa tekstin`);
    if (onReady) onReady(sid);
  } catch (e) {
    flash(`transkriptio ei käynnistynyt (${e instanceof Error ? e.message : "?"}) — sessio ok silti`);
  }
};

/* on-demand brain kick — the ANALYSOI NYT button. POST /api/kick
   {sid} starts ONE execution of the game's brain workflow (the name
   lives in the manifest's workflowName; the workflow fetches the session
   JSON + transcript from the store by the sid, so nothing but the sid
   crosses this call). Non-blocking by design:
   progress lands in the brain-state doc, which the 30 s TESTITILA poll
   already renders as the AGENTTI line — analyzing → fixing → waiting →
   done. Honest failures are named in the status line, always in Finnish,
   and never block the session pipeline that already succeeded. */
export const kickAnalysis = async (sid: string, flash: (m: string) => void, onPinNeeded?: (sid: string) => void): Promise<boolean> => {
  /* returns whether the kick actually started, so the button can
     reappear on failure (the old gate hid it for good). The kick carries
     the cached test-mode code (sessionStorage); /api/kick refuses without
     it, so a flipped localStorage alone can no longer start the agent. */
  try {
    flash("analyysi käynnistyy…");
    let pin = "";
    try {
      pin = sessionStorage.getItem("bb-debug-pin") || "";
    } catch {
      /* private mode: no cached code — the server asks via 401 */
    }
    /* the durable kick credential. /api/debug issues this
       server-signed token after a correct code (HMAC over AGENT_TOKEN,
       fixed domain tag); localStorage keeps it across PWA restarts so
       ANALYSOI never asks for the code again. The code itself still
       never persists on the device — the token unlocks only the
       /api/kick game lane, not /api/debug. */
    let kick = "";
    try {
      kick = localStorage.getItem("bb-kick-tok") || "";
    } catch {
      /* private mode: token lost with storage — the 401 path re-asks */
    }
    const r = await fetch("/api/kick", {
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
         surfaced on the phone as "analyysi: koodi puuttuu". Now the kick
         re-opens the TESTITILAN KOODI prompt and auto-resumes after a
         correct code. */
      if (r.status === 401 && err.includes("koodi")) {
        flash(`analyysi: ${err} — syötä testitilan koodi`);
        if (onPinNeeded) onPinNeeded(sid);
        return false;
      }
      flash(
        err
          ? `analyysi: ${err}`
          : r.status === 404
          ? "analyysi: workflow ei ole pystyssä (rekisteröinti kesken)"
          : `analyysi ei käynnistynyt (HTTP ${r.status})`,
      );
      return false;
    }
    flash("analyysi käynnissä — AGENTTI-osio päivittyy");
    return true;
  } catch (e) {
    flash(`analyysi ei käynnistynyt (${e instanceof Error ? e.message : "?"})`);
    return false;
  }
};
