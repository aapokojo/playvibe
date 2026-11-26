/* upload.ts: v43 sliced narration upload transport (device saves nothing) — v45.36: moved verbatim out of src/App.tsx
   (test-mode modularization, step 1 of the playvibe extraction: identical
   behavior, new module home; back-reference: the App.tsx v35/v43/v45
   history comments moved with the code). */

/* v43: Blob → base64 in one string. Only the fromCharCode call is
   chunked — spreading megabytes of byte args overflows the stack */
export const blobB64 = async (b: Blob): Promise<string> => {
  const u = new Uint8Array(await b.arrayBuffer());
  let out = "";
  for (let i = 0; i < u.length; i += 0x8000) {
    out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  }
  return btoa(out);
};

/* v43: the narration's half of the no-download funnel — mirrors the
   JSON part loop exactly (40 KB base64 slices → /api/audio → textdb
   bbaud-<sid>-<n>, index written last server-side). Idempotent textdb
   writes make the 4 retry attempts with backoff safe; a 60 s wall
   clock bounds the wait. Returns the slice count. A 64-part cap
   (≈2.5 MB audio ≈ 5 min) protects the store budget; past it the
   audio uploads truncated, flagged so in the index. */
export const uploadAudioParts = async (sid: string, blob: Blob, mime: string): Promise<number> => {
  const b64 = await blobB64(blob);
  const list: string[] = [];
  for (let i = 0; i < b64.length; i += 40000) list.push(b64.slice(i, i + 40000));
  const trunc = list.length > 64;
  if (trunc) list.length = 64;
  const deadline = Date.now() + 60000;
  for (let p = 0; p < list.length; p++) {
    let last: Error = new Error("?");
    let ok = false;
    for (let att = 0; att < 4 && !ok; att++) {
      if (Date.now() > deadline) break;
      try {
        const r = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid, part: p, total: list.length, data: list[p], mime, bytes: blob.size, trunc }),
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
  return list.length;
};
