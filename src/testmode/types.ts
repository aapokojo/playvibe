/* types.ts: the in-memory recording session shape (device saves nothing). */

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
