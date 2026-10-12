/** Story progress, kept in this browser for now (later: tied to the wallet identity so it follows the player). */
const KEY = 'tokenblaster:city-story';

export type Progress = { seen: string[]; done: string[]; standing: Record<string, number>; evidence: { genius: number; conman: number; spook: number } };
const EMPTY: Progress = { seen: [], done: [], standing: {}, evidence: { genius: 0, conman: 0, spook: 0 } };

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Progress>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: progress just won't persist */
  }
}

export function markSeen(cutsceneId: string) {
  const p = loadProgress();
  if (!p.seen.includes(cutsceneId)) p.seen.push(cutsceneId);
  saveProgress(p);
}
