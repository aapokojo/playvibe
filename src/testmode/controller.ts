/* test-mode controller: the REC/STOP recorder lifecycle, the
   device-saves-nothing outbox with its YRITÄ UUDELLEEN retry, throttled
   snapshot capture, the session-JSON assembly with its sliced idempotent
   upload, and the onstop mp3 transcode + audio upload lane. Only seams:
   the game taps (canvas / engine audio / probe funnel), the
   mode/room/version stamps and the transcribed-sid callback arrive as
   cfg - the version literal arrives as cfg.version from the game. */
import { useEffect, useRef, useState } from "react";

import { wireLog, setWireTap } from "./funnel";
import { uploadAudioParts } from "./upload";
import { kickTranscribe } from "./agent";
import type { TestSess } from "./types";

export interface TestControllerCfg {
  /** screenshot source: the game canvas */
  canvasRef: { current: HTMLCanvasElement | null };
  /** engine handle: audioTap() feeds the sfx bus into the recorder mix */
  engRef: { current: { audioTap?: () => MediaStream | null } | null };
  /** the engine's probe funnel tap (stable no-op outside sessions) */
  probeEvRef: { current: (ev: { t: string; [k: string]: unknown }) => void };
  /** session-meta stamps */
  mode: string;
  room: { code: string; role?: string } | null;
  version: string;
  /** called when transcription succeeds (the ANALYSOI target sid) */
  setKickSid: (sid: string) => void;
}

export function useTestController(cfg: TestControllerCfg) {
  const { canvasRef, engRef, probeEvRef, mode, room, version, setKickSid } = cfg;
  const [testRec, setTestRec] = useState(false);
  const [testInfo, setTestInfo] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [testStatusTs, setTestStatusTs] = useState(0);
  const testStatusFlash = (msg: string) => {
    setTestStatus(msg);
    setTestStatusTs(Date.now());
    window.setTimeout(() => setTestStatus((cur) => (cur === msg ? "" : cur)), 15000);
  };
  const testSess = useRef<TestSess | null>(null);
  /* the device saves nothing, EVER (no local downloads of audio or
     logs). A failed upload parks itself in this in-memory
     outbox instead of a download sheet; the panel shows a YRITÄ UUDELLEEN
     button whose retry re-runs the same idempotent store writes. The
     parked blobs live only until the page dies. */
  const outboxRef = useRef<{ kind: "json" | "audio"; sid: string; parts?: string[]; blob?: Blob; mime?: string }[]>([]);
  const [outboxN, setOutboxN] = useState(0);
  const [outboxErr, setOutboxErr] = useState("");
  const [retryBusy, setRetryBusy] = useState(false);
  const retryBusyRef = useRef(false);
  const retryUploads = async () => {
    if (retryBusyRef.current || !outboxRef.current.length) return;
    retryBusyRef.current = true;
    setRetryBusy(true);
    testStatusFlash(`yritetään uudelleen (${outboxRef.current.length})…`);
    let okN = 0;
    for (const t of outboxRef.current) {
      try {
        if (t.kind === "json" && t.parts) {
          for (let p = 0; p < t.parts.length; p++) {
            let last: Error = new Error("?");
            let got = false;
            for (let att = 0; att < 2 && !got; att++) {
              try {
                const r = await fetch("/api/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sid: t.sid, part: p, total: t.parts.length, data: t.parts[p] }),
                });
                if (r.ok) got = true;
                else last = new Error(`HTTP ${r.status}`);
              } catch (e) {
                last = e instanceof Error ? e : new Error(String(e));
              }
              if (!got) await new Promise((res) => setTimeout(res, 750));
            }
            if (!got) throw new Error(`${last.message} [osa ${p + 1}/${t.parts.length}]`);
          }
        } else if (t.kind === "audio" && t.blob) {
          await uploadAudioParts(t.sid, t.blob, t.mime || "audio/mpeg");
          await kickTranscribe(t.sid, testStatusFlash, (okSid) => setKickSid(okSid));
        }
        okN++;
        outboxRef.current = outboxRef.current.filter((x) => x !== t);
      } catch (e) {
        setOutboxErr(e instanceof Error ? e.message : "?");
      }
    }
    const left = outboxRef.current.length;
    setOutboxN(left);
    retryBusyRef.current = false;
    setRetryBusy(false);
    if (!left) {
      setOutboxErr("");
      testStatusFlash(`uusinta onnistui — kaikki (${okN}) palvelimella ✓`);
    } else {
      testStatusFlash(`uusinta: ${okN} lähti, ${left} jäi — YRITÄ UUDELLEEN alla`);
    }
  };
  const testCapture = (tag: string) => {
    const s = testSess.current;
    const cv = canvasRef.current;
    if (!s || !cv || s.snaps.length >= 25) return;
    const now = performance.now();
    if (now - s.snapAt < 1200) return; // throttle: bursts would bloat the JSON
    s.snapAt = now;
    const oc = document.createElement("canvas");
    oc.width = 960;
    oc.height = 540;
    const cx = oc.getContext("2d");
    if (!cx) return;
    cx.drawImage(cv, 0, 0, oc.width, oc.height);
    s.snaps.push({ ms: Math.round(now - s.startMs), tag, data: oc.toDataURL("image/jpeg", 0.8) });
  };
  const startTest = async () => {
    if (testSess.current) return;
    const s: TestSess = {
      startMs: performance.now(),
      startEpoch: Date.now(),
      sid: `${Date.now()}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`,
      events: [],
      snaps: [],
      chunks: [],
      rec: null,
      stream: null,
      mix: null,
      noAudio: "",
      snapAt: 0,
      timer: 0,
      mime: "",
    };
    testSess.current = s;
    s.events.push({ ms: 0, at: new Date().toISOString(), t: "session-start" });
    // audio: mic + engine's own sfx bus, mixed in a fresh AudioContext so a
    // paused/playing game state never gates the capture. The engine's bus
    // arrives as a MediaStream from its own AudioContext: cross-context
    // MediaStreamSource is valid and keeps the engine code untouched.
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("mediaDevices unavailable");
      s.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      s.mix = new AudioContext();
      const dest = s.mix.createMediaStreamDestination();
      s.mix.createMediaStreamSource(s.stream).connect(dest);
      const engStream = engRef.current?.audioTap();
      if (engStream) s.mix.createMediaStreamSource(engStream).connect(dest);
      else s.noAudio = "engine-audio-off";
      // iOS Safari claims audio/webm;codecs=opus support and records
      // it, but its own decodeAudioData cannot decode opus-in-webm — the
      // whole encode then falls back to a raw webm that the analyzing
      // agent rejects (first real-device Safari run). MP4/AAC is the
      // container combo iOS can always decode in-page (proven by the
      // original recorder), so on iOS
      // WebKit MP4 is preferred; everywhere else webm/opus stays first.
      const isIOSWebKit = /iP(?:hone|ad|od)/.test(navigator.userAgent);
      const mimes = isIOSWebKit
        ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      s.mime = mimes.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      if (s.mime) {
        s.rec = new MediaRecorder(dest.stream, { mimeType: s.mime });
        s.rec.ondataavailable = (e) => {
          if (e.data.size) s.chunks.push(e.data);
        };
        s.rec.onstop = () => {
          if (!s.chunks.length) return;
          // transcode to mp3 in-page (the analyzing agent accepts only
          // mp3 among audio types). decodeAudioData sniffs the REAL
          // container bytes, so Safari's possibly mislabeled blobs and
          // Chrome's opus/webm all decode the same way; lamejs is a lazily
          // imported chunk that never loads outside test mode. On any
          // failure the raw recording walks the same upload path; a
          // failed upload parks in the in-memory outbox for a
          // YRITÄ UUDELLEEN retry - the device saves nothing, ever, but a
          // session is never silently lost either.
          (async () => {
            const raw = new Blob(s.chunks, { type: s.mime });
            let ac: AudioContext | null = null;
            const t0 = performance.now();
            try {
              testStatusFlash("mp3-koodaus…");
              ac = new AudioContext(); // inside the STOP tap's call stack: iOS-safe
              const decoded = await ac.decodeAudioData(await raw.arrayBuffer());
              const rate = 16000; // narration-grade: mono, 16 kHz, 64 kbps ≈ 0.48 MB/min
              const off = new OfflineAudioContext(1, Math.max(1, Math.ceil((decoded.length * rate) / decoded.sampleRate)), rate);
              const src = off.createBufferSource();
              src.buffer = decoded;
              src.connect(off.destination);
              src.start(0);
              const mono = await off.startRendering();
              const f = mono.getChannelData(0);
              const pcm = new Int16Array(f.length);
              for (let i = 0; i < f.length; i++) {
                const v = Math.max(-1, Math.min(1, f[i]));
                pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
              }
              const { Mp3Encoder } = await import("@breezystack/lamejs");
              const enc = new Mp3Encoder(1, rate, 64);
              const parts: Uint8Array[] = [];
              const CH = 1152; // lame's mpeg1 frame granularity; odd tail is fine
              for (let i = 0; i < pcm.length; i += CH) {
                const b = enc.encodeBuffer(pcm.subarray(i, i + CH));
                if (b.length) parts.push(new Uint8Array(b)); // copy: lame reuses its buffer
                // yield every ~9 s of encoded audio so the main thread
                // breathes — a long synchronous encode would freeze the page
                // (and stall the session upload fetches) for its whole run
                if ((i / CH) % 128 === 127) await new Promise((r) => setTimeout(r, 0));
              }
              const tail = enc.flush();
              if (tail.length) parts.push(new Uint8Array(tail));
              const mp3 = new Blob(parts as unknown as BlobPart[], { type: "audio/mpeg" });
              // no device download — the narration rides the same
              // sliced-upload path as the JSON (the store's audio parts)
              testStatusFlash(
                `mp3 ✓ ${(mp3.size / 1e6).toFixed(1)} MB (${((performance.now() - t0) / 1000).toFixed(1)} s koodaus) — lähetetään…`,
              );
              try {
                const n = await uploadAudioParts(s.sid, mp3, "audio/mpeg");
                testStatusFlash(`äänikin palvelimella ✓ (${n} osaa) — ${s.sid}`);
                await kickTranscribe(s.sid, testStatusFlash, (okSid) => setKickSid(okSid));
              } catch (ea) {
                outboxRef.current.push({ kind: "audio", sid: s.sid, blob: mp3, mime: "audio/mpeg" });
                setOutboxN(outboxRef.current.length);
                setOutboxErr(ea instanceof Error ? ea.message : "?");
                testStatusFlash(`audio ei palvelimelle (${ea instanceof Error ? ea.message : "?"}) — YRITÄ UUDELLEEN alla`);
              }
            } catch (e) {
              // encode failed: the raw container still walks the upload path
              try {
                const n = await uploadAudioParts(s.sid, raw, s.mime || "audio/webm");
                testStatusFlash(`raaka ääni palvelimella ✓ (${n} osaa; mp3-koodaus ei onnistunut: ${e instanceof Error ? e.message : "?"})`);
                await kickTranscribe(s.sid, testStatusFlash, (okSid) => setKickSid(okSid));
              } catch (ea2) {
                outboxRef.current.push({ kind: "audio", sid: s.sid, blob: raw, mime: s.mime || "audio/webm" });
                setOutboxN(outboxRef.current.length);
                setOutboxErr(`mp3: ${e instanceof Error ? e.message : "?"} · lähetys: ${ea2 instanceof Error ? ea2.message : "?"}`);
                testStatusFlash(`mp3 ei onnistunut (${e instanceof Error ? e.message : "?"}) — raaka ääni jonossa, YRITÄ UUDELLEEN alla`);
              }
            } finally {
              try {
                await ac?.close();
              } catch {
                /* already closed */
              }
            }
          })();
        };
        s.rec.start(1000);
      } else s.noAudio = "no-supported-mime";
    } catch (e) {
      // Chrome on iOS denies getUserMedia at the platform level (the
      // first real-device run recorded its whole session mic-less from
      // Chrome). Name it in-game and in the JSON meta so the browser —
      // not the code — is the visible explanation.
      const crios = /CriOS\//.test(navigator.userAgent);
      s.noAudio = `mic-failed${crios ? " (Chrome ei voi nauhoittaa micia - avaa peli Safarissa)" : ""}: ${e instanceof Error ? e.message : "unknown"}`;
      if (crios) testStatusFlash("CHROME EI NAURAHOITA - avaa peli Safarissa");
      // no mic: still run the session for events/wire/snapshots, honest in JSON
      try {
        s.stream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* nothing to stop */
      }
      s.stream = null;
    }
    if (s.noAudio) s.events.push({ ms: Math.round(performance.now() - s.startMs), at: new Date().toISOString(), t: "audio-note", reason: s.noAudio });
    // prewarm both STOP-time network deps NOW, minutes before they
    // are needed. The lamejs import is the mp3 encode's ONLY network hop:
    // once resolved it lives in the ES module cache and the encode runs
    // fully offline even if the network died mid-recording. The HEAD
    // request warms DNS+TCP+TLS to the origin: an AI-mode session makes
    // zero requests during play, so the STOP-time upload would otherwise
    // fire on a cold, possibly hours-dormant path — three phone runs in a
    // row failed exactly there ("Load failed") while the server verified
    // healthy from outside the phone every time.
    import("@breezystack/lamejs").catch(() => {});
    fetch("/api/room", { method: "HEAD" }).catch(() => {});
    wireLog.length = 0;
    setWireTap(true);
    probeEvRef.current = (ev) => {
      s.events.push({ ms: Math.round(performance.now() - s.startMs), at: new Date().toISOString(), ...ev });
      if (ev.t === "boom" || ev.t === "turn" || ev.t === "load") testCapture(String(ev.t));
      // boom-instant frames catch the explosion before the stink
      // cloud renders (first recorded session: all at-boom snapshots showed
      // no cloud); +1.5 s later the cloud is bright and citable
      if (ev.t === "boom") setTimeout(() => testCapture("boom+1.5s"), 1500);
    };
    s.timer = window.setInterval(() => {
      const dur = performance.now() - s.startMs;
      setTestInfo(
        `${Math.floor(dur / 60000)}:${String(Math.floor((dur / 1000) % 60)).padStart(2, "0")} · ${s.events.length} ev · ${wireLog.length} wire`,
      );
    }, 1000);
    setTestRec(true);
  };
  const endTest = async () => {
    const s = testSess.current;
    if (!s) return;
    // STOP is one-shot and its state capture is immediate (endTest
    // awaits the server upload below, so a second tap must be a no-op).
    testSess.current = null;
    setTestRec(false);
    setTestInfo("");
    setWireTap(false);
    probeEvRef.current = () => {};
    clearInterval(s.timer);
    s.events.push({ ms: Math.round(performance.now() - s.startMs), at: new Date().toISOString(), t: "session-end" });
    try {
      if (s.rec && s.rec.state !== "inactive") s.rec.stop(); // onstop encodes + uploads the async audio lane
    } catch {
      /* recorder already gone: the JSON below still saves */
    }
    try {
      s.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      s.mix?.close();
    } catch {
      /* ignore */
    }
    const session = {
      v: 1,
      sid: s.sid,
      startedAt: new Date(s.startEpoch).toISOString(),
      durationMs: Math.round(performance.now() - s.startMs),
      version,
      mode,
      room: room ? { code: room.code, role: room.role ?? "" } : null,
      ua: navigator.userAgent,
      screen: `${window.screen.width}x${window.screen.height}`,
      audioMime: s.mime,
      audioMp3: true, // onstop transcodes to mp3 unless it fell back to raw
      noAudioReason: s.noAudio,
      events: s.events,
      wire: wireLog.map((w) => ({ ms: Math.round(w.ms - s.startMs), k: w.k, d: w.d })),
      snapshots: s.snaps,
    };
    // SERVER FIRST - the JSON pushes to the store before anything else
    // happens on the device, and a 45 s wall-clock deadline bounds the
    // wait so a slow or dead network can never hold the session hostage.
    // After the budget (or any per-part failure) nothing is ever
    // saved locally - the slices park in the in-memory outbox, the status
    // names the failed hop, and the YRITÄ UUDELLEEN button re-runs the
    // idempotent writes when the network lets it. (The failing hop's
    // error names itself in the persistent outbox line.)
    const sid = s.sid;
    const json = JSON.stringify(session);
    const SLICE = 40000;
    const list: string[] = [];
    for (let i = 0; i < json.length; i += SLICE) list.push(json.slice(i, i + SLICE));
    try {
      setTestStatus("ladataan palvelimelle…");
      const deadline = Date.now() + 45000;
      for (let p = 0; p < list.length; p++) {
        let last: Error = new Error("?");
        let ok = false;
        let att = 0;
        // per-part retries with backoff; parts are idempotent store
        // writes, so retrying can never corrupt a session.
        for (; att < 4 && !ok; att++) {
          if (Date.now() > deadline) break;
          try {
            const r = await fetch("/api/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sid, part: p, total: list.length, data: list[p] }),
            });
            if (r.ok) ok = true;
            else last = new Error(`HTTP ${r.status}`);
          } catch (e) {
            last = e instanceof Error ? e : new Error(String(e));
          }
          if (!ok && Date.now() < deadline) await new Promise((res) => setTimeout(res, 750 * 2 ** att));
        }
        if (!ok) throw new Error(`${last.message} [osa ${p + 1}/${list.length}]`);
      }
      testStatusFlash(`palvelimella ✓ ${sid}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "?";
      outboxRef.current.push({ kind: "json", sid, parts: list });
      setOutboxN(outboxRef.current.length);
      setOutboxErr(msg);
      testStatusFlash(`ei palvelimelle (${msg}) — YRITÄ UUDELLEEN alla`);
    }
  };
  return {
    testRec,
    testInfo,
    testStatus,
    testStatusTs,
    testStatusFlash,
    outboxN,
    outboxErr,
    retryBusy,
    retryUploads,
    startTest,
    endTest,
  };
}
/* the brain's public work-state doc (unguessable suffix is the gate,
   same exposure class as the QA record). The brain (and the transcribe
   route) mirror their current job here as {sid, stage, note, ts};
   TESTITILA renders the stage live so autonomous work is visible
   in-game while it runs instead of being invisible until a push
   lands. */
const BRAIN_STATE_URL = "/api/state";

/* does the brain's done-note name a version NEWER than the one this
   device already runs? The running version is read from the UI badge
   text (kept current by the game's version literal), so no extra
   hand-synced constant can drift out of date. Semantics: strictly
   newer -> offer the reload; equal (this build already runs it) or
   OLDER (a stale note from an earlier run - the state doc keeps the
   last note until the next kick) -> hide, otherwise the button would
   linger on the very complaint this fixes. The gate used to ALSO
   require a note PREFIX (korjaus live / push ok) — a prefix list that
   missed every other lane: revert notes and chat-lane ship notes
   both went without a reload prompt. The note FORMAT is already the
   contract — a parenthesized version — so the gate only requires the
   note to CONTAIN a (vN.N) version (any lane, no prefix list to
   maintain) and leaves the newer/equal/older logic below to decide. */
const noteOffersNewVersion = (note: string, running: string): boolean => {
  const m = /\((v\d+(?:\.\d+)?)\)/.exec(note);
  if (!running || !m) return true;
  const a = running.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const b = m[1].replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};



export interface TestAgentCfg {
  /** test mode gates the poll loop (the inbox feeds the TESTITILA panel) */
  testMode: boolean;
  /** non-test-mode toast: qa answers name their fate there */
  flash: (msg: string) => void;
}

/* test-agent surface: the question-inbox state + answer handler, the
   live brain work-state with the shadow ref its poll loop reads, the
   LATAA UUSI VERSIO reload gate (the version check above), the
   ANALYSOI NYT kick bookkeeping (sent record, parked-kick ref,
   last-kick stamp), and the self-re-arming agentqa + state poll loop
   with its visibility resume. Seams: the loop gate (testMode) and the
   toast (flash) arrive as cfg. The game keeps the debug-code prompt
   and the parked-kick auto-resume in its code-prompt handler, which
   read these same names through the returned object - so the returned
   field set IS the game seam. */
export function useTestAgent(cfg: TestAgentCfg) {
  const { testMode, flash: pushFlash } = cfg;
  /* ---- agent question inbox ----
     Only the test-recorder panel polls this (test mode on): questions
     arrive via the agentqa route GET, answers POST back anonymously.
     The brain pings the phone with /api/notify so a question is never
     missed. */
  const [qaList, setQaList] = useState<{ id: string; text: string; opts: string[]; ts: number }[]>([]);
  // live brain work-state — rides the same 30 s tick as the QA inbox
  const [agentWork, setAgentWork] = useState<{ sid: string; stage: string; note: string; ts: number } | null>(null);
  /* shadow copies for the poll loop (the loop reads refs, so it
     never re-subscribes to renders) + the version-badge ref behind the
     reload-button gate */
  const agentWorkRef = useRef<{ sid: string; stage: string; note: string; ts: number } | null>(null);
  const lastKickRef = useRef(0);
  const verBadgeRef = useRef<HTMLSpanElement | null>(null);
  /* LATAA UUSI VERSIO renders only when the brain's done-note
     names a version this build is not already running (no lingering
     button after the reload; the poll rewrite below makes it appear
     without a restart) */
  const reloadReady =
    !!agentWork &&
    agentWork.stage === "done" &&
    /\((v\d+(?:\.\d+)?)\)/.test(agentWork.note || "") &&
    noteOffersNewVersion(agentWork.note || "", verBadgeRef.current?.textContent || "");
  // the on-demand brain button needs the sid of the LAST session whose
  // transcription succeeded (kickTranscribe sets it in its success path)
  const [kickSid, setKickSid] = useState("");
  // per-sid sent record — the button hides only while THIS session's
  // analysis is on its way (the old `!agentWork` gate swallowed it
  // entirely because the shared state doc is never empty once anything
  // has run)
  const [kickSent, setKickSent] = useState<Record<string, boolean>>({});
  // sid of a kick parked for the test-mode code (the prompt re-opens
  // when /api/kick answers 401 koodi puuttuu because a PWA restart cleared
  // the cached code; a correct code auto-resumes the parked kick)
  const kickAfterPinRef = useRef("");

  const qaAnswered = useRef<Set<string>>(new Set());
  /* the old bare 30 s setInterval proved unreliable on the iOS
     standalone PWA: while the app is backgrounded/locked during a brain
     run (kick, lock the phone, wait for the push — the main real-world
     flow), Safari can suspend the interval and never fire it again in
     the resumed session, so the panel froze on a stale stage and the
     reload button only appeared after a full app restart. The loop is
     now a self-re-arming setTimeout chain (a suspended timer costs at
     most one gap; the chain re-arms after every poll) plus an immediate
     poll on every visibility resume (visibilitychange + pageshow),
     which also resurrects a chain that died in the background.
     Cadence: 5 s while a run looks in flight (stage analyzing/fixing/
     waiting, or within 10 min of a kick — the brain's live-verify
     keeps going after the state doc's fixing note), otherwise 30 s. */
  useEffect(() => {
    if (!testMode) return;
    let stopped = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const r = await fetch("/api/agentqa", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json().catch(() => null)) as { questions?: { id: string; text: string; opts: string[]; ts: number }[] } | null;
          if (!stopped && j && Array.isArray(j.questions)) {
            setQaList(j.questions.filter((q) => q && typeof q.id === "string" && !qaAnswered.current.has(q.id)).slice(0, 5));
          }
        }
        // brain work-state fetch (stage of the current job)
        const br = await fetch(BRAIN_STATE_URL, { cache: "no-store" }).catch(() => null);
        if (!stopped && br && br.ok) {
          const j2 = (await br.json().catch(() => null)) as
            | { current?: { sid?: unknown; stage?: unknown; note?: unknown; ts?: unknown } }
            | null;
          const c = j2 && j2.current;
          if (c && typeof c.sid === "string" && typeof c.stage === "string") {
            const cur = {
              sid: c.sid,
              stage: c.stage,
              note: typeof c.note === "string" ? c.note : "",
              ts: typeof c.ts === "number" ? c.ts : 0,
            };
            agentWorkRef.current = cur;
            setAgentWork(cur);
          } else {
            agentWorkRef.current = null;
            setAgentWork(null);
          }
        }
      } catch {
        /* offline: the next tick retries */
      }
    };
    const schedule = () => {
      if (stopped) return;
      const aw = agentWorkRef.current;
      const inFlight =
        (!!aw && (aw.stage === "analyzing" || aw.stage === "fixing" || aw.stage === "waiting")) ||
        Date.now() - lastKickRef.current < 600000;
      timer = window.setTimeout(async () => {
        await poll();
        schedule();
      }, inFlight ? 5000 : 30000);
    };
    const onVis = () => {
      if (!document.hidden && !stopped) {
        poll();
        if (timer !== null) window.clearTimeout(timer);
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onVis);
    poll();
    schedule();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, [testMode]);
  const qaAnswer = async (id: string, choice: string) => {
    qaAnswered.current.add(id);
    setQaList((l) => l.filter((q) => q.id !== id));
    try {
      const r = await fetch("/api/agentqa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", id, choice }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pushFlash("vastaus lähetetty agentille");
    } catch {
      qaAnswered.current.delete(id);
      pushFlash("vastaus ei yltänyt palvelimelle - yritä uudelleen");
    }
  };

  return {
    qaList,
    agentWork,
    reloadReady,
    verBadgeRef,
    kickSid,
    setKickSid,
    kickSent,
    setKickSent,
    lastKickRef,
    kickAfterPinRef,
    qaAnswer,
  };
}
