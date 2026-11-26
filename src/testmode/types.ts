/* types.ts: the in-memory recording session shape (device saves nothing) — v45.36: moved verbatim out of src/App.tsx
   (test-mode modularization, step 1 of the playvibe extraction: identical
   behavior, new module home; back-reference: the App.tsx v35/v43/v45
   history comments moved with the code). */

export type TestSess = {
  startMs: number;
  startEpoch: number;
  sid: string;
  events: { ms: number; at: string; [k: string]: unknown }[];
  snaps: { ms: number; tag: string; data: string }[];
  chunks: Blob[];
  rec: MediaRecorder | null;
  stream: MediaStream | null;
  mix: AudioContext | null;
  noAudio: string;
  snapAt: number;
  timer: number;
  mime: string;
};
