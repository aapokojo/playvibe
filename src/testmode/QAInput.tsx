import { useState } from "react";

/* QAInput.tsx: v42 free-text answer input for one agent question — v45.36: moved verbatim out of src/App.tsx
   (test-mode modularization, step 1 of the playvibe extraction: identical
   behavior, new module home; back-reference: the App.tsx v35/v43/v45
   history comments moved with the code). */

/* v42: free-text input for one agent question (kept separate so each
   question owns its own tiny input state) */
export const QAInput = ({ onSend }: { onSend: (v: string) => void }) => {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-1">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="vapaa vastaus…"
        className="w-full rounded border border-[#8a3fd9] bg-[#150f2e] px-1.5 py-1 text-[#f2f0ff] outline-none focus:border-[#00f0ff]"
      />
      <button
        onClick={() => {
          if (v.trim()) {
            onSend(v.trim().slice(0, 300));
            setV("");
          }
        }}
        className="rounded border border-[#ff2fd6] px-2 py-1 font-bold text-[#ff2fd6] transition-transform hover:-translate-y-0.5"
        title="lähetä"
      >
        →
      </button>
    </div>
  );
};
