/* DebugPinPrompt.tsx: the test-mode code prompt overlay. The game keeps
   the debugAsk/debugPin state and submitDebugPin — they are the seam
   between the game UI's 5-tap version toggle, the testmode agent
   bookkeeping and the recorder status line, so they stay in the game
   and arrive here as props, exactly like TestPanel's other seams.

   The 5th tap does not flip test mode on directly; it asks for the
   test-mode code first (the debug route verifies it against the server's
   debug-pin env var, so the code never ships in the bundle). The
   accepted code is cached in sessionStorage and rides along every
   ANALYSOI NYT kick; localStorage keeps only the on/off flag. */

export const DebugPinPrompt = ({
  pin,
  onPin,
  onOk,
  onCancel,
}: {
  pin: string;
  onPin: (v: string) => void;
  onOk: () => void;
  onCancel: () => void;
}) => (
  <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0718]/85 p-4">
    <div className="w-[min(92%,320px)] rounded-xl border-2 border-[#ff2fd6] bg-[#150f2e] p-4 text-xs text-[#f2f0ff] shadow-[0_0_26px_rgba(255,47,214,0.35)]">
      <div className="mb-2 font-bold text-[#00f0ff]" style={{ textShadow: "0 0 12px rgba(0,240,255,0.8)" }}>
        TESTITILAN KOODI
      </div>
      <input
        type="password"
        autoFocus
        value={pin}
        onChange={(e) => onPin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOk();
        }}
        placeholder="koodi…"
        className="w-full rounded border border-[#8a3fd9] bg-[#0a0718] px-2 py-1.5 text-[#f2f0ff] outline-none focus:border-[#00f0ff]"
      />
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onOk()}
          className="flex-1 rounded-md border-2 border-[#00f0ff] px-3 py-1.5 font-bold text-[#00f0ff] transition-transform hover:-translate-y-0.5 active:bg-[#00f0ff] active:text-[#0a0718]"
        >
          OK
        </button>
        <button
          onClick={() => onCancel()}
          className="flex-1 rounded-md border-2 border-[#8a3fd9] px-3 py-1.5 font-bold text-[#b08cd8] transition-transform hover:-translate-y-0.5"
        >
          peruuta
        </button>
      </div>
    </div>
  </div>
);
