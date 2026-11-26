/* TestPanel.tsx: v45.42 — the TESTITILA debug panel, modularization
   step 3 of the playvibe extraction. The whole panel JSX moved VERBATIM
   out of src/App.tsx into this file: App keeps every piece of state the
   panel reads (controller surface, inbox/work-state slices, the
   reload/kick seams and the collapse/drag layout state — collapse state
   stays in App so it survives a testMode flip, and the version-badge
   ref stays there so noteOffersNewVersion keeps reading its own badge)
   and passes it all as props; behavior is identical, no JSX text,
   class or handler changed. The version-badge literal lives here now
   (third brain-bump spot moved with the JSX).
   v45.43 note: the agent-surface state this panel reads (question
   inbox, live brain work-state, reload gate, kick bookkeeping) moved
   into ./controller's useTestAgent; App forwards it through the same
   props, so nothing below changed except the badge literal.
   v45.50 note: KORJAUKSET (past fixes + PALAUTA) and JONO (analysis
   queue) are LOCAL panel state via ./fixes with their own 30 s poll —
   the controller poll and the App props stay byte-identical.
   v45.51 note: player layout spec — AGENTTI + its contextual action
   band (ANALYSOI NYT & co) on top with the task at hand; JONO under it
   with the NEXT-UP row first; KORJAUKSET last, NEWEST ON TOP inside its
   own ~2-3-row scrollable viewport. Also KÄSITELLÄÄN (v45.50 typo)
   corrected to KÄSITTELLÄÄN.   v45.53 note: JONO shows WAITING items only — AGENTTI is the single
   surface for ongoing brain work (processing row and done/failed
   history removed from the queue).
   v45.55 note (player spec): KORJAUKSET is the full change ledger —
   every change to the app lists here, not just audio-loop brain fixes
   (chat-lane and infrastructure ships are ledgered too, even without
   stored edits — those display-only); PALAUTA is offered ONLY on the
   newest revertable change, because older fixes may have other changes
   built on top of them and reverting under those would clobber their
   baseline (a clean revert of an older change would need bisecting
   what depends on it).
   v45.63 note (player report: a session recorded during a live fix
   could not be added to JONO): ANALYSOI NYT used to hide while a brain
   run was in flight (agentWork analyzing/fixing). That gate was a
   leftover of the pre-queue direct-kick era, when a second kick would
   collide with the running analysis. Since v45.50 enqueue is
   QUEUE-BASED — adding a session while a run is in flight is exactly
   what JONO exists for (the API defers the start). The busy gate made
   a transcript recorded during a fix unreachable: the button never
   appeared, so the session could not join the queue. The gate is gone;
   the button still hides per-sid after a successful send (kickSent).
   Moved with the code from App.tsx, still true:
   v42.1: TESTITILA debug window — one panel, the whole agent surface:
   REC (mic + engine audio + wire log + frames), STOP & upload-to-agent
   status, the notification toggle (it serves only the agent loop, so it
   lives here, not on the home screen), and the agent question inbox.
   Toggled by 5 taps on the version number in the info screen; ?test=1
   still works.
   v42.2: anchored with safe-area insets — the first phone answer
   reported the notch clipping the window's top-left corner in landscape
   (viewport-fit=cover is set, so env() returns real insets; non-notched
   devices fall back to +8px). v45.21: the vector bell, v45.22: the
   vector +/- collapse glyphs, both for deterministic alignment in the
   20x20 header boxes; STAGE_FI maps the brain's stage names into the
   AGENTTI state line. Comments inside the JSX below are the original
   ones from App.tsx. */
import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/* v45.50: the player-oversight surface (KORJAUKSET + JONO) transport —
   a sibling of ./agent in the test lane; all of it stays local to the
   panel, so the App prop surface is untouched. */
import { dequeueItem, pollFixes, queueAnalysis, requestRevert, type FixesData } from "./fixes";
/* v45.46: badge reads the single APP_VERSION constant (../version) —
   the third brain-bump spot becomes an import, so it cannot go stale */
import { APP_VERSION } from "../version";
import { QAInput } from "./QAInput";

/* v45.21: the emoji bell glyph overflows a tiny button on the phone
   (clipped at the top, baseline off-center; emoji fonts differ per OS).
   A small vector bell scales deterministically inside a fixed-size
   button box, so the notification icon gets the SAME 20x20 flex box as
   the +/- collapse toggle and the two header buttons line up exactly. */
const BellIcon = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
    <path
      d="M8 1.6a.55.55 0 0 1 .55.55v.67A3.9 3.9 0 0 1 12.4 6.7v2.9l1.35 2.1a.55.55 0 0 1-.46.85H2.71a.55.55 0 0 1-.46-.85L3.6 9.6V6.7a3.9 3.9 0 0 1 3.85-3.88V2.15A.55.55 0 0 1 8 1.6Z"
      fill="currentColor"
    />
    <path d="M6.3 13.2a1.75 1.75 0 0 0 3.4 0H6.3Z" fill="currentColor" />
    {off && <path d="M2.6 2.4 13.4 13.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>
);
/* v45.22: vector +/- glyphs for the collapse toggle. Text glyphs ride
   on font baselines, and the en-dash sat oddly in its box on iOS; a
   pair of strokes matching the bell keeps the header visually even. */
const PlusIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
);
const MinusIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
);
const STAGE_FI: Record<string, string> = {
  uploaded: "sessio vastaanotettu",
  transcribed: "transkriptio valmis",
  analyzing: "analyysi käynnissä",
  fixing: "korjaus työn alla",
  reverting: "palautus työn alla",
  waiting: "odottaa sinun vastaustasi",
  done: "valmis",
};


export interface TestPanelProps {
  /* controller surface (useTestController / src/testmode/controller.ts) */
  testRec: boolean;
  testInfo: string;
  testStatus: string;
  testStatusTs: number;
  testStatusFlash: (msg: string) => void;
  outboxN: number;
  outboxErr: string;
  retryBusy: boolean;
  retryUploads: () => Promise<void>;
  startTest: () => Promise<void>;
  endTest: () => Promise<void>;
  /* agent work-state + question inbox (v45.43: the poll loop lives in
     ./controller's useTestAgent; App only forwards these) */
  agentWork: { sid: string; stage: string; note: string; ts: number } | null;
  qaList: { id: string; text: string; opts: string[]; ts: number }[];
  qaAnswer: (id: string, choice: string) => Promise<void>;
  /* LATAA UUSI VERSIO gate; verBadgeRef spans the badge below */
  reloadReady: boolean;
  verBadgeRef: MutableRefObject<HTMLSpanElement | null>;
  /* notification toggle (it serves the agent loop only) */
  pushOn: boolean;
  togglePush: () => Promise<void>;
  /* ANALYSOI NYT + parked-kick seams (setDebugPin/setDebugAsk are App
     state because submitDebugPin's code path also drives them) */
  kickSid: string;
  kickSent: Record<string, boolean>;
  setKickSent: Dispatch<SetStateAction<Record<string, boolean>>>;
  lastKickRef: MutableRefObject<number>;
  kickAfterPinRef: MutableRefObject<string>;
  setDebugPin: Dispatch<SetStateAction<string>>;
  setDebugAsk: Dispatch<SetStateAction<boolean>>;
  /* collapse/drag layout state (stays in App: survives testMode flips,
     and the drag handlers below write it through setTestPos) */
  testCollapsed: boolean;
  setTestCollapsed: Dispatch<SetStateAction<boolean>>;
  testPos: { x: number | null; y: number | null };
  setTestPos: Dispatch<SetStateAction<{ x: number | null; y: number | null }>>;
  testPanelRef: MutableRefObject<HTMLDivElement | null>;
  testDrag: MutableRefObject<{ px: number; py: number; ox: number; oy: number } | null>;
}

export function TestPanel({
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
  agentWork,
  qaList,
  qaAnswer,
  reloadReady,
  verBadgeRef,
  pushOn,
  togglePush,
  kickSid,
  kickSent,
  setKickSent,
  lastKickRef,
  kickAfterPinRef,
  setDebugPin,
  setDebugAsk,
  testCollapsed,
  setTestCollapsed,
  testPos,
  setTestPos,
  testPanelRef,
  testDrag,
}: TestPanelProps) {
  /* v45.50: KORJAUKSET + JONO — local panel state with its own 30 s poll
     (the controller's agent work-state/QA pipeline stays untouched, and
     so does the App prop surface: everything below reads ./fixes).
     One queue, one brain run at a time; PALAUTA is a 2-tap confirm
     because a revert ships a real new version. */
  const [fx, setFx] = useState<FixesData | null>(null);
  const [rvConfirm, setRvConfirm] = useState<{ id: string; ts: number } | null>(null);
  const fxRefreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const d = await pollFixes();
      if (alive) setFx(d);
      busy = false;
    };
    fxRefreshRef.current = () => {
      tick();
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
          <div
            ref={testPanelRef}
            className={`fixed z-30 overflow-auto rounded-lg border border-[#00f0ff]/60 bg-[#0a0718]/95 p-2 font-mono text-[10px] text-[#00f0ff] ${testCollapsed ? "w-[150px]" : "max-h-[80dvh] w-[min(80vw,320px)]"}`}
            style={
              testPos.x === null
                ? { left: "50%", top: "calc(env(safe-area-inset-top, 0px) + 8px)", transform: "translateX(-50%)" }
                : { left: testPos.x, top: testPos.y }
            }
          >
            <div
              className="mb-1.5 flex cursor-move touch-none select-none items-center justify-between gap-1 border-b border-[#00f0ff]/30 pb-1 font-bold"
              title="raahaa siirtääksesi paneelia"
              onPointerDown={(e) => {
                const r = testPanelRef.current?.getBoundingClientRect();
                if (!r) return;
                testDrag.current = { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top };
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = testDrag.current;
                if (!d) return;
                setTestPos({ x: d.ox + e.clientX - d.px, y: d.oy + e.clientY - d.py });
              }}
              onPointerUp={() => {
                testDrag.current = null;
              }}
              onPointerCancel={() => {
                testDrag.current = null;
              }}
            >
              <span>TESTITILA</span>
              <span className="flex items-center gap-1">
                <span ref={verBadgeRef} className="text-[#b08cd8]">{APP_VERSION}</span>
                {/* v45.20: the notification toggle is a header icon
                    (extended panel only) — the old full-width text band
                    ate a whole row of the top band for one boolean
                    v45.22: hover:-translate-y-0.5 removed from BOTH header
                    buttons — iOS keeps the :hover state after a tap, so the
                    touched button stayed shifted 2px up for good and the pair
                    read as misaligned after every minimize/maximize (pixel
                    measurement on the phone screenshot: box tops 2px
                    apart). active:scale-95 feeds back the press without
                    persisting; the +/- toggle glyphs are vectors now so
                    font baselines cannot offset them either. */}
                {!testCollapsed && (
                  <button
                    onClick={() => {
                      togglePush().catch(() => {});
                    }}
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-transform active:scale-95 ${
                      pushOn ? "border-[#00f0ff] text-[#00f0ff]" : "border-[#8a3fd9] text-[#b08cd8]"
                    }`}
                    title="agentin ilmoitukset: uusi versio + kysymykset (iOS: asenna kotivalikkoon)"
                  >
                    <BellIcon off={!pushOn} />
                  </button>
                )}
                <button
                  onClick={() => setTestCollapsed((c) => !c)}
                  className="flex h-5 w-5 items-center justify-center rounded border border-[#00f0ff]/50 text-[#00f0ff] transition-transform active:scale-95 active:bg-[#00f0ff] active:text-[#0a0718]"
                  title={testCollapsed ? "avaa testitilan paneeli" : "piilota paneeli (peli näkyy)"}
                >
                  {testCollapsed ? <PlusIcon /> : <MinusIcon />}
                </button>
              </span>
            </div>
            {/* v45.20: REC lives in the collapsed pill too — recording
                must not need the full panel (the panel hides gameplay).
                The pill stays compact: ● REC idle / ■ STOP while
                recording, with the magenta REC marker so mid-game it is
                obvious the mic is live. Stopping from the pill expands
                the panel so the upload/transcribe/ANALYSOI funnel is
                visible right where it continues. */}
            {testCollapsed && (
              <div className="mt-1">
                {testRec && <div className="mb-1 font-bold text-[#ff2fd6]">● REC</div>}
                <button
                  onClick={() => {
                    if (!testRec) {
                      startTest().catch(() => {});
                    } else {
                      endTest().catch(() => {});
                      setTestCollapsed(false);
                    }
                  }}
                  className={`w-full rounded border px-2 py-1 font-bold transition-transform hover:-translate-y-0.5 ${
                    testRec ? "border-[#ff2fd6] text-[#ff2fd6] active:bg-[#ff2fd6] active:text-[#0a0718]" : "border-[#00f0ff] text-[#00f0ff] active:bg-[#00f0ff] active:text-[#0a0718]"
                  }`}
                  title={testRec ? "lopeta tallennus ja avaa paneeli" : "käynnistä tallennus ilman paneelin avaamista"}
                >
                  {testRec ? "■ STOP" : "● REC"}
                </button>
              </div>
            )}
            {!testCollapsed && (
              <>
            {!testRec ? (
              <button
                onClick={() => {
                  startTest().catch(() => {});
                }}
                className="w-full rounded border border-[#00f0ff] bg-[#0a0718] px-2 py-1 font-bold text-[#00f0ff] transition-transform hover:-translate-y-0.5 active:bg-[#00f0ff] active:text-[#0a0718]"
              >
                ● REC TEST SESSION
              </button>
            ) : (
              <div className="space-y-1">
                <div className="font-bold text-[#ff2fd6]">● REC {testInfo}</div>
                <button
                  onClick={endTest}
                  className="w-full rounded border border-[#ff2fd6] bg-[#0a0718] px-2 py-1 font-bold text-[#ff2fd6] transition-transform hover:-translate-y-0.5 active:bg-[#ff2fd6] active:text-[#0a0718]"
                >
                  STOP &amp; LÄHETÄ AGENTILLE
                </button>
              </div>
            )}
            {/* v45.14: panel layout per the player's spec — three bands:
                static controls on top (REC/STOP; notification toggle in
                the header since v45.20),
                live state in the middle (upload/transcribe/kick flashes, the
                brain's stage, agent questions), transient actions at the
                bottom that appear only when relevant */}
            {/* v45.20: the notification toggle moved into the header as a
                🔔/🔕 icon — see the header row above */}
            {/* v45.16: ONE state at a time in the agent band. The flash
                line wins whenever it is the newest thing that happened
                (it already self-clears after 15 s); otherwise the brain's
                last known stage shows; otherwise the idle placeholder. The
                old layout stacked the flash ABOVE the previous brain
                state, which read as two contradictory states at once. */}
            <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
              <div className="font-bold text-[#00f0ff]">AGENTTI</div>
              {(() => {
                if (testStatus && (!agentWork || testStatusTs >= agentWork.ts)) {
                  return (
                    <div className="mt-1 break-words leading-snug text-[#f2f0ff] opacity-80">{testStatus}</div>
                  );
                }
                if (agentWork) {
                  return (
                    <div className="mt-1 break-words leading-snug text-[#b08cd8]">
                      {(() => {
                        const note = agentWork.note || "";
                        if (agentWork.stage === "done" && note.startsWith("korjausta ei pushattu")) {
                          return `analyysi valmis — aivojen oma korjaus jäi väliin (${note.slice("korjausta ei pushattu:".length).trim()}); chat-agentti hoitaa korjauksen`;
                        }
                        return `${STAGE_FI[agentWork.stage] ?? agentWork.stage}${note ? ` — ${note}` : ""}`;
                      })()}
                      <span className="opacity-60"> ({agentWork.sid})</span>
                    </div>
                  );
                }
                return <div className="mt-1 leading-snug text-[#b08cd8] opacity-60">ei aktiivista analyysiä</div>;
              })()}
            </div>
            {/* v45.14: transient actions, contextual only — moved to the
                TOP next to the AGENTTI state in v45.51 per the player
                spec (the task at hand reads with its state line).
                Original note:
                ANALYSOI NYT while the transcript is ready but un-sent
                (hidden right after a successful send and while a brain run
                is in flight, the state line above carries the progress
                instead); LATAA UUSI VERSIO only when the brain reports a
                version actually on the server ("korjaus live"/"push ok"
                notes; a gated or clean run leaves nothing to reload); v45.18: reloadReady additionally requires the note to name a version this build is not already running; v45.25: YRITÄ UUDELLEEN while failed uploads wait in the outbox (the device saves nothing, ever) v45.63 (player report): the pre-queue "hide while a brain run is in flight" gate is GONE — enqueue queues, it does not collide; the button hides only per-sid after a send. */}
            {reloadReady || outboxN > 0 || (kickSid && !kickSent[kickSid]) ? (
              <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
                {outboxN > 0 && (
                  <div className="mb-1">
                    <button
                      onClick={() => {
                        retryUploads().catch(() => {});
                      }}
                      disabled={retryBusy}
                      className="w-full rounded border border-[#ff2fd6] bg-[#0a0718] px-2 py-1 font-bold text-[#ff2fd6] transition-transform hover:-translate-y-0.5 active:bg-[#ff2fd6] active:text-[#0a0718] disabled:opacity-50"
                      title="lähetys jäi kesken — yritä uudelleen; mitään ei tallenneta laitteelle"
                    >
                      ↻ YRITÄ UUDELLEEN {retryBusy ? "…" : `(${outboxN})`}
                    </button>
                    {outboxErr && (
                      <div className="mt-0.5 break-words text-[10px] leading-snug text-[#ff2fd6] opacity-70">{outboxErr}</div>
                    )}
                  </div>
                )}
                {reloadReady && (
                  <button
                    onClick={() => location.reload()}
                    className="mb-1 w-full rounded border border-[#00f0ff] bg-[#0a0718] px-2 py-1 font-bold text-[#00f0ff] transition-transform hover:-translate-y-0.5 active:bg-[#00f0ff] active:text-[#0a0718]"
                    title="aivot julkaisivat uuden version — lataa se tähän ilman manuaalista selaamista"
                  >
                    ↻ LATAA UUSI VERSIO
                  </button>
                )}
                {kickSid && !kickSent[kickSid] && (
              <button
                onClick={() => {
                  lastKickRef.current = Date.now();
                  setKickSent((m) => ({ ...m, [kickSid]: true }));
                  queueAnalysis(kickSid, testStatusFlash, () => {
                    kickAfterPinRef.current = kickSid;
                    setDebugPin("");
                    setDebugAsk(true);
                  }).then((ok) => {
                    if (!ok) setKickSent((m) => ({ ...m, [kickSid]: false }));
                  });
                }}
                className="mt-0.5 w-full rounded border border-[#ff2fd6] bg-[#0a0718] px-2 py-1 font-bold text-[#ff2fd6] transition-transform hover:-translate-y-0.5 active:bg-[#ff2fd6] active:text-[#0a0718]"
                title="käynnistä analyysi: agentti hakee session + transkription palvelimelta ja korjaa tai kysyy"
              >
                ANALYSOI NYT
              </button>
                )}
              </div>
            ) : null}
            {/* v45.50: JONO — the analysis queue: queue several narrated
                sessions; exactly one brain run is ever in flight.
                v45.53 (player spec, after the 5fbq run): ONLY WAITING
                ROWS render here — live brain-work updates belong to the
                AGENTTI line alone (it reads the same state doc), and
                the queue must not echo status in multiple places: no
                KÄSITTELLÄÄN row (AGENTTI already carries the stage) and
                no done/failed history (KORJAUKSET below is the record). */}
            {fx && fx.queue.items.some((it) => it.status === "waiting") && (
              <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
                <div className="mb-1 font-bold text-[#00f0ff]">JONO</div>
                {fx.queue.items
                  .filter((it) => it.status === "waiting")
                  .map((it) => (
                    <div key={it.id} className="mb-1 flex items-start gap-1 leading-snug">
                      <div className="grow">
                        {it.kind === "analyze" ? "analyysi " + (it.sid ?? "") : "palautus " + (it.fixId ?? "")}
                      </div>
                      <button
                        onClick={() => {
                          dequeueItem(it.id, testStatusFlash).then((ok) => {
                            if (ok) fxRefreshRef.current();
                          });
                        }}
                        className="shrink-0 rounded border border-[#8a3fd9] px-1 py-0.5 text-[#b08cd8] active:scale-95"
                        title="poista jonosta"
                      >
                        POISTA
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {/* v45.50: KORJAUKSET — the player-oversight list of past fixes
                shipped by the brain/chat lanes. PALAUTA enqueues a
                deterministic revert (2-tap confirm; it ships a real new
                version). Entries without stored edits (older chat-era
                ships) display only.
                v45.51: NEWEST ON TOP (the freshest ships + their PALAUTA
                buttons are what the player acts on), and the list
                scrolls inside its own ~2-3-row viewport so it never
                pushes AGENTTI/JONO off the panel.
                v45.55 (player spec): PALAUTA is offered ONLY on the newest
                revertable change. An older fix may have other changes
                built on top of it (brain fixes, chat fixes, panel/queue
                work), and inverting its stored edits blindly could revert
                their baseline — a clean revert of an older fix would need
                bisecting what depended on it. The brain's anchor gate
                already refuses a revert whose `new` text drifted (found
                != 1), but the player should not be offered the dead end
                in the first place. Reverting the newest change is always
                safe: nothing is built on it yet. Every entry still lists;
                older ones display only. */}
            {fx && fx.fixes.length > 0 && (() => {
              /* v45.55: PALAUTA only on the newest revertable change. The
                 fixes arrive ascending, so reversed = newest first; the
                 FIRST entry that is not reverted and has stored edits is
                 the only one a clean deterministic revert can target
                 (an older fix may have other changes built on top of it,
                 and reverting under them would clobber their baseline).
                 Older entries still list, display-only. */
              const rev = [...fx.fixes].reverse();
              const newestRvIdx = rev.findIndex((g) => !g.reverted && g.edits && g.edits.length > 0);
              return (
              <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
                <div className="mb-1 font-bold text-[#00f0ff]">KORJAUKSET</div>
                <div className="max-h-[84px] overflow-y-auto pr-0.5">
                  {rev.map((f, i) => (
                    <div key={f.id} className="mb-1 flex items-start gap-1 leading-snug">
                      <div className="grow">
                        <span className="text-[#b08cd8]">[{f.version}]</span> {f.desc}
                        {f.reverted && <span className="opacity-60"> — palautettu</span>}
                        {/* v45.59: revert ENTRIES carry a marker naming the
                            fix they reversed — v45.54's desc ("palautus:
                            Tiiminimet…") reads like the original v45.53
                            change and made the player think PALAUTA sat on
                            the wrong row. */}
                        {f.reverts && <span className="opacity-60"> ↩ kumosi {f.reverts}:n</span>}
                      </div>
                      {!f.reverted && i === newestRvIdx && (
                        <button
                          onClick={() => {
                            const c = rvConfirm;
                            if (c && c.id === f.id && Date.now() - c.ts < 6000) {
                              setRvConfirm(null);
                              requestRevert(f.id, testStatusFlash).then((ok) => {
                                if (ok) fxRefreshRef.current();
                              });
                            } else {
                              setRvConfirm({ id: f.id, ts: Date.now() });
                            }
                          }}
                          className={`shrink-0 rounded border px-1 py-0.5 active:scale-95 ${rvConfirm && rvConfirm.id === f.id ? "border-[#ff2fd6] text-[#ff2fd6]" : "border-[#8a3fd9] text-[#b08cd8]"}`}
                          title="palauta uusin korjaus — aivot kumoavat sen deterministisesti ja julkaisevat uuden version (vanhempiin ei kajota: niiden päälle on voitu rakentaa)"
                        >
                          {rvConfirm && rvConfirm.id === f.id ? "VAHVISTA" : "PALAUTA"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              );
            })()}
            {/* agent question inbox: fixed options + free text, anonymous */}
            {qaList.length > 0 && (
              <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
                <div className="mb-1 font-bold text-[#00f0ff]">AGENTTI KYSELEE</div>
                {qaList.map((q) => (
                  <div key={q.id} className="mb-2">
                    <div className="mb-1 leading-snug text-[#f2f0ff]">{q.text}</div>
                    <div className="flex flex-col gap-1">
                      {q.opts.map((o) => (
                        <button
                          key={o}
                          onClick={() => {
                            qaAnswer(q.id, o).catch(() => {});
                          }}
                          className="rounded border border-[#00f0ff] bg-[#0a0718] px-2 py-1 text-left text-[#00f0ff] transition-transform hover:-translate-y-0.5 active:bg-[#00f0ff] active:text-[#0a0718]"
                        >
                          {o}
                        </button>
                      ))}
                      <QAInput
                        onSend={(v) => {
                          qaAnswer(q.id, v).catch(() => {});
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* v45.12: the live work-state moved up into the AGENTTI section (one agent surface) */}
              </>
            )}
          </div>
  );
}
