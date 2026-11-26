/* funnel.ts: the v35 test-session relay funnel — v45.36: moved verbatim out of src/App.tsx
   (test-mode modularization, step 1 of the playvibe extraction: identical
   behavior, new module home; back-reference: the App.tsx v35/v43/v45
   history comments moved with the code). */

import { getLive, getRoom, getSnap } from "../net";
import type { Snap } from "../engine";

/* ---- v35 test session (?test=1): wire funnel + wrapped relay lanes ----
   The recorder needs summaries of every relay packet this client observes
   (room docs, published snapshots, live batches, our own pushes). The
   funnel is a guarded array: zero cost in production builds, and these
   wrappers are the ONLY net-surface change (net.ts itself stays untouched). */
export const TEST_URL = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("test");
export const wireLog: { ms: number; k: string; d: Record<string, unknown> }[] = [];
let wireTapOn = false;
/* v45.36 export seam: ES module bindings are read-only to importers, so the
   REC/STOP flips go through this setter (App.tsx used to assign the module
   binding directly when everything lived in one file). */
export const setWireTap = (on: boolean) => {
  wireTapOn = on;
};
export const tapWire = (k: string, d: Record<string, unknown>) => {
  if (wireTapOn) wireLog.push({ ms: performance.now(), k, d });
};
export const getRoomT = async (code: string) => {
  const r = await getRoom(code);
  tapWire("room", r ? { status: r.status, tc: r.turnCount ?? 0, w: r.w ?? "", st: r.st ?? 0, rs: r.rs ?? 0, rem: r.rem ?? "" } : { absent: true });
  return r;
};
export const getSnapT = async (code: string) => {
  const s = (await getSnap(code)) as Snap | null;
  if (s) tapWire("snap", { tc: s.turnCount, ph: s.phase, tm: s.timer, rs: s.rs ?? 0, ab: s.activeBug });
  else tapWire("snap", { absent: true });
  return s;
};
export const getLiveT = async (code: string) => {
  const lv = await getLive(code);
  if (lv && lv.lv) tapWire("live", { pid: lv.pid, tc: lv.lv.tc, tf: lv.lv.tf, es: lv.lv.es ?? 0, n: (lv.lv.evs ?? []).length });
  else tapWire("live", { absent: true });
  return lv;
};
