/**
 * "The game is playable" as a tiny external store: the start screen's extras (the 3D CHOOSE YOUR GIRL row and its
 * ~3MB of models) wait for it, so the first screen's downloads and main thread go to the game first. The 2D card
 * art shows until then.
 */
let ready = false;
const subs = new Set<() => void>();
export const engineReady = {
  get: () => ready,
  set(v: boolean) {
    if (ready === v) return;
    ready = v;
    for (const f of subs) f();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
