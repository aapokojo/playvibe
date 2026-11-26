/* cfg.ts — the playvibe cfg-tap holder (generalization step 1).
   Every game-specific VALUE the package needs travels through the
   manifest (src/manifest.ts); this module holds the ACTIVE manifest so
   package modules can read their cfg without importing the consuming
   game. initPlayvibe stores the validated manifest here once, at
   test-mode boot — the same single-injection pattern useTestController
   already uses for its canvasRef/engRef/probeEvRef seams. */

import type { PlayvibeManifest } from "./manifest";

let active: PlayvibeManifest | null = null;

/** initPlayvibe (src/manifest.ts) calls this after validation. */
export const setActiveManifest = (m: PlayvibeManifest): void => {
  active = m;
};

/** The one accessor every cfg tap goes through. An uninitialized read
    names the cure, not just the symptom — the same honesty rule the
    in-game funnel statuses follow (a failed hop always names itself). */
export const pv = (): PlayvibeManifest => {
  if (!active) {
    throw new Error(
      "playvibe: initPlayvibe(manifest) ei ole ajettu — testitilan pinta ei käynnisty ilman manifestia. Kutsu initPlayvibe({ ...oman pelin manifest, net }) testitilan avauksessa.",
    );
  }
  return active;
};
