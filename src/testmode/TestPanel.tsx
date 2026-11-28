/* TestPanel.tsx — the TEST MODE debug panel: one panel, the whole agent
   surface. The host game keeps every piece of state the panel reads
   (controller surface, inbox/work-state slices, the reload/kick seams
   and the collapse/drag layout state — collapse state stays in the game
   so it survives a testMode flip, and the version-badge ref stays there
   so noteOffersNewVersion keeps reading its own badge) and passes it all
   as props. The agent-surface state itself comes from ./controller's
   useTestAgent; FIXES (past fixes + REVERT) and QUEUE (analysis
   queue) are LOCAL panel state via ./fixes with their own 30 s poll.
   Player-spec design notes:
   - AGENT + its contextual action band (ANALYZE NOW & co) on top
     with the task at hand (the AGENT question inbox renders inside
     the AGENT band, under its status line); QUEUE under it with the
     NEXT-UP row first;
     FIXES last, NEWEST ON TOP inside its own ~2-3-row scrollable
     viewport.
   - QUEUE shows WAITING items only — AGENT is the single surface for
     ongoing brain work (processing row and done/failed history removed
     from the queue).
   - FIXES is the full change ledger — every change to the game
     lists here, not just brain fixes (chat-lane and infrastructure
     ships are ledgered too, even without stored edits — those
     display-only); REVERT is offered ONLY on the newest revertable
     change, because older fixes may have other changes built on top of
     them and reverting under those would clobber their baseline (a
     clean revert of an older change would need bisecting what depends
     on it).
   - ANALYZE NOW never hides for a busy brain: enqueue is QUEUE-BASED —
     adding a session while a run is in flight is exactly what QUEUE
     exists for (the API defers the start). The button hides only
     per-sid after a successful send (kickSent).
   - REC (mic + engine audio + wire log + frames), STOP &
     upload-to-agent status, the notification toggle (it serves only the
     agent loop, so it lives here, not on the home screen), and the
     agent question inbox (the questions render INSIDE the AGENT band,
     in context with the status line, not at the bottom of the panel).
     Toggled by the host game (the reference game
     uses 5 taps on the version number in the info screen; ?test=1 also
     works).
   - Anchored with safe-area insets — a phone answer reported the notch
     clipping the window's top-left corner in landscape
     (viewport-fit=cover is set, so env() returns real insets;
     non-notched devices fall back to +8px). The vector bell and vector
     +/- collapse glyphs are for deterministic alignment in the 20x20
     header boxes; STAGE_EN maps the brain's stage names into the
     AGENT state line. */
import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/* the player-oversight surface (FIXES + QUEUE) transport — a
   sibling of ./agent in the test lane; all of it stays local to the
   panel, so the host game's prop surface is untouched. */
import { dequeueItem, pollFixes, queueAnalysis, requestRevert, type FixesData } from "./fixes";
import { pv } from "../cfg";
import { pollDeploys, newestFirst, type DeploysDoc } from "./deploys";
import { QAInput } from "./QAInput";

/* the emoji bell glyph overflows a tiny button on the phone
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
/* vector +/- glyphs for the collapse toggle. Text glyphs ride
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
const STAGE_EN: Record<string, string> = {
  uploaded: "session received",
  transcribed: "transcription ready",
  starting: "analysis starting",
  analyzing: "analysis running",
  fixing: "fix in progress",
  reverting: "revert in progress",
  waiting: "waiting for your answer",
  answered: "answer received",
  done: "done",
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
  /* agent work-state + question inbox (the poll loop lives in
     ./controller's useTestAgent; the game only forwards these) */
  agentWork: { sid: string; stage: string; note: string; ts: number; pushed?: boolean | null } | null;
  qaList: { id: string; text: string; opts: string[]; ts: number }[];
  qaAnswer: (id: string, choice: string) => Promise<void>;
  /* v0.9.3: optional per-ask dismiss (the player retires an obsolete
     ask); when absent the panel simply renders no dismiss control */
  qaDismiss?: (id: string) => Promise<void>;
  /* LOAD NEW VERSION gate; verBadgeRef spans the badge below */
  reloadReady: boolean;
  verBadgeRef: MutableRefObject<HTMLSpanElement | null>;
  /* notification toggle (it serves the agent loop only) */
  pushOn: boolean;
  togglePush: () => Promise<void>;
  /* ANALYZE NOW + parked-kick seams (setDebugPin/setDebugAsk are game
     state because submitDebugPin's code path also drives them) */
  kickSid: string;
  kickSent: Record<string, boolean>;
  setKickSent: Dispatch<SetStateAction<Record<string, boolean>>>;
  lastKickRef: MutableRefObject<number>;
  kickAfterPinRef: MutableRefObject<string>;
  setDebugPin: Dispatch<SetStateAction<string>>;
  setDebugAsk: Dispatch<SetStateAction<boolean>>;
  /* collapse/drag layout state (stays in the game: survives testMode flips,
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
  qaDismiss,
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
  /* badge version: pv().version — the game's single version source
     flows in through the manifest at init, no package-level import */
  const APP_VERSION = pv().version;
  /* FIXES + QUEUE — local panel state with its own 30 s poll
     (the controller's agent work-state/QA pipeline stays untouched, and
     so does the game's prop surface: everything below reads ./fixes).
     One queue, one brain run at a time; REVERT is a 2-tap confirm
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

  /* DEPLOY — the Vercel deployment-status lane (v0.9.2): when the
     manifest declares routes.deploys, poll it every 30 s like FIXES
     and render one line with the latest deploy of THIS game. No
     route, no poll, no band (older games change nothing). */
  const [dp, setDp] = useState<DeploysDoc | null>(null);
  useEffect(() => {
    if (!pv().routes.deploys) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const d = await pollDeploys();
      if (alive && d) setDp(d);
      busy = false;
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
              title="drag to move the panel"
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
              <span>TEST MODE</span>
              <span className="flex items-center gap-1">
                <span ref={verBadgeRef} className="text-[#b08cd8]">{APP_VERSION}</span>
                {/* the notification toggle is a header icon
                    (extended panel only) — a full-width text band would
                    eat a whole row of the top band for one boolean.
                    hover:-translate-y-0.5 is on NEITHER header button —
                    iOS keeps the :hover state after a tap, so the touched
                    button would stay shifted 2px up for good and the pair
                    would read as misaligned after every minimize/maximize
                    (pixel measurement on a phone screenshot: box tops 2px
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
                    title="agent notifications: new version + questions (iOS: add to home screen)"
                  >
                    <BellIcon off={!pushOn} />
                  </button>
                )}
                <button
                  onClick={() => setTestCollapsed((c) => !c)}
                  className="flex h-5 w-5 items-center justify-center rounded border border-[#00f0ff]/50 text-[#00f0ff] transition-transform active:scale-95 active:bg-[#00f0ff] active:text-[#0a0718]"
                  title={testCollapsed ? "open the test-mode panel" : "hide the panel (the game shows)"}
                >
                  {testCollapsed ? <PlusIcon /> : <MinusIcon />}
                </button>
              </span>
            </div>
            {/* REC lives in the collapsed pill too — recording
                must not need the full panel (the panel hides gameplay).
                The pill stays compact: ● REC idle / ■ STOP while
                recording, with the magenta REC marker so mid-game it is
                obvious the mic is live. Stopping from the pill expands
                the panel so the upload/transcribe/ANALYZE NOW funnel is
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
                  title={testRec ? "stop recording and open the panel" : "start recording without opening the panel"}
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
                  STOP &amp; SEND TO AGENT
                </button>
              </div>
            )}
            {/* panel layout per the player's spec — three bands:
                static controls on top (REC/STOP; notification toggle in
                the header),
                live state in the middle (upload/transcribe/kick flashes, the
                brain's stage), transient actions at the bottom that appear
                only when relevant */}
            {/* the notification toggle lives in the header as a
                🔔/🔕 icon — see the header row above */}
            {/* ONE state at a time in the agent band. The flash
                line wins whenever it is the newest thing that happened
                (it already self-clears after 15 s); otherwise the brain's
                last known stage shows; otherwise the idle placeholder. The
                old layout stacked the flash ABOVE the previous brain
                state, which read as two contradictory states at once. */}
            <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
              <div className="font-bold text-[#00f0ff]">AGENT</div>
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
                        /* the brain's done-note contract (v0.7.0): the structured
                           `pushed` flag in the state doc says whether its own fix
                           landed (false = gate-refused); the legacy Finnish prefix
                           stays as the fallback while a pre-v4.10 brain is still
                           deployed. The note text says why either way, and the
                           chat lane handles the fix. */
                        if (
                          agentWork.stage === "done" &&
                          (agentWork.pushed === false ||
                            (agentWork.pushed == null && note.startsWith("korjausta ei pushattu")))
                        ) {
                          const why = agentWork.pushed === false ? note.trim() : note.slice("korjausta ei pushattu:".length).trim();
                          return `analysis done — the brain's own fix did not land (${why}); the chat lane will handle it`;
                        }
                        return `${STAGE_EN[agentWork.stage] ?? agentWork.stage}${note ? ` — ${note}` : ""}`;
                      })()}
                      <span className="opacity-60"> ({agentWork.sid})</span>
                    </div>
                  );
                }
                return <div className="mt-1 leading-snug text-[#b08cd8] opacity-60">no active analysis</div>;
              })()}
              {/* agent question inbox: renders INSIDE the AGENT band — the
                  questions read in context with the status they belong to
                  (the task at hand), not stranded at the bottom of the
                  panel behind QUEUE and FIXES. Fixed options + free text,
                  anonymous. */}
              {qaList.length > 0 && (
                <div className="mt-1.5 border-t border-[#8a3fd9]/40 pt-1">
                  <div className="mb-1 font-bold text-[#00f0ff]">AGENT ASKS</div>
                  {qaList.map((q) => (
                    <div key={q.id} className="mb-2">
                      <div className="mb-1 flex items-start justify-between gap-1 leading-snug text-[#f2f0ff]">
                        {q.text}
                        {qaDismiss && (
                          <button
                            onClick={() => {
                              qaDismiss(q.id).catch(() => {});
                            }}
                            className="shrink-0 rounded border border-[#8a3fd9] px-1 leading-none text-[#8a3fd9] transition-transform hover:-translate-y-0.5"
                            title="remove this ask (obsolete or already resolved)"
                          >
                            ✕
                          </button>
                        )}
                      </div>
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
            </div>
            {/* transient actions, contextual only — at the TOP next to the
                AGENT state per the player spec (the task at hand reads
                with its state line). ANALYZE NOW while the transcript is
                ready but un-sent (hidden right after a successful send);
                LOAD NEW VERSION only when the brain reports a version
                actually on the server, and reloadReady additionally
                requires the note to name a version this build is not
                already running (a gated or clean run leaves nothing to
                reload); RETRY while failed uploads wait in the
                outbox (the device saves nothing, ever). Enqueue queues
                even mid-run — the pre-queue busy gate is gone; the
                button hides only per-sid after a send. */}
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
                      title="upload unfinished — retry; nothing is saved on the device"
                    >
                      ↻ RETRY {retryBusy ? "…" : `(${outboxN})`}
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
                    title="the brain shipped a new version — reload it here, no manual browsing needed"
                  >
                    ↻ LOAD NEW VERSION
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
                title="start the analysis: the agent fetches the session + transcript from the server and fixes or asks"
              >
                ANALYZE NOW
              </button>
                )}
              </div>
            ) : null}
            {/* DEPLOY — the latest Vercel deployment of THIS game, one
                line: state, short sha, target, relative age. A failed
                deploy renders magenta so a broken ship reads instantly
                (the same color the REC lane reserves for failure).
                Renders only when the manifest declares routes.deploys
                and at least one deploy has landed. */}
            {dp && (() => {
              const list = newestFirst(dp);
              const d = list[0];
              if (!d) return null;
              const bad = /ERROR|FAILED|CANCELED/i.test(d.state) || /error|failed|canceled|cancelled/i.test(d.event || "");
              const age = Math.max(0, Math.round((Date.now() - (d.ts || 0)) / 60000));
              return (
              <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
                <div className="mb-1 font-bold text-[#00f0ff]">DEPLOY</div>
                <div className={`break-words leading-snug ${bad ? "text-[#ff2fd6]" : "text-[#b08cd8]"}`}>
                  {bad ? "✗" : "✓"} {d.state}
                  {d.sha ? ` · ${d.sha}` : ""}
                  {d.target ? ` · ${d.target}` : ""} · {age < 1 ? "just now" : `${age} min ago`}
                </div>
              </div>
              );
            })()}
            {/* QUEUE — the analysis queue: queue several narrated
                sessions; exactly one brain run is ever in flight.
                Player spec: ONLY WAITING ROWS render here — live
                brain-work updates belong to the AGENT line alone (it
                reads the same state doc), and the queue must not echo
                status in multiple places: no PROCESSING row (AGENT
                already carries the stage) and no done/failed history
                (FIXES below is the record). */}
            {fx && fx.queue.items.some((it) => it.status === "waiting") && (
              <div className="mt-1.5 border-t border-[#8a3fd9]/50 pt-1">
                <div className="mb-1 font-bold text-[#00f0ff]">QUEUE</div>
                {fx.queue.items
                  .filter((it) => it.status === "waiting")
                  .map((it) => (
                    <div key={it.id} className="mb-1 flex items-start gap-1 leading-snug">
                      <div className="grow">
                        {it.kind === "analyze" ? "analysis " + (it.sid ?? "") : "revert " + (it.fixId ?? "")}
                      </div>
                      <button
                        onClick={() => {
                          dequeueItem(it.id, testStatusFlash).then((ok) => {
                            if (ok) fxRefreshRef.current();
                          });
                        }}
                        className="shrink-0 rounded border border-[#8a3fd9] px-1 py-0.5 text-[#b08cd8] active:scale-95"
                        title="remove from the queue"
                      >
                        REMOVE
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {/* FIXES — the player-oversight list of past fixes
                shipped by the brain/chat lanes. REVERT enqueues a
                deterministic revert (2-tap confirm; it ships a real new
                version). Entries without stored edits (older chat-era
                ships) display only.
                NEWEST ON TOP (the freshest ships + their REVERT
                buttons are what the player acts on), and the list
                scrolls inside its own ~2-3-row viewport so it never
                pushes AGENT/QUEUE off the panel.
                Player spec: REVERT is offered ONLY on the newest
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
              /* REVERT only on the newest revertable change. The
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
                <div className="mb-1 font-bold text-[#00f0ff]">FIXES</div>
                <div className="max-h-[84px] overflow-y-auto pr-0.5">
                  {rev.map((f, i) => (
                    <div key={f.id} className="mb-1 flex items-start gap-1 leading-snug">
                      <div className="grow">
                        <span className="text-[#b08cd8]">[{f.version}]</span> {f.desc}
                        {f.reverted && <span className="opacity-60"> — reverted</span>}
                        {/* revert ENTRIES carry a marker naming the fix
                            they reversed — a plain "revert: …" desc
                            reads like the original change and made the
                            player think REVERT sat on the wrong
                            row. */}
                        {f.reverts && <span className="opacity-60"> ↩ reverted {f.reverts}</span>}
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
                          title="revert the newest fix — the brain undoes it deterministically and ships a new version (older ones untouched: changes may be built on them)"
                        >
                          {rvConfirm && rvConfirm.id === f.id ? "CONFIRM" : "REVERT"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              );
            })()}
            {/* the live work-state lives in the AGENT section (one agent surface) */}
              </>
            )}
          </div>
  );
}
