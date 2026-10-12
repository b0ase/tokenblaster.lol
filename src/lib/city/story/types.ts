/**
 * Satoshi City story model (docs/satoshi-city-vision.md). Pure data: acts → chapters → missions, cutscenes as
 * camera shots + dialogue lines. The engine (SatoshiCity.tsx) reads this; nothing here touches three.js.
 */

export type DistrictId = 'genesis' | 'silk-row' | 'orphan-alley' | 'interchange' | 'docks' | 'small-block' | 'exchange';
export type FactionId = 'professor' | 'keepers' | 'dpr' | 'suits' | 'miners';
export type CharacterId = 'anon' | 'professor' | 'keeper' | 'dpr' | 'hashcat' | 'uncle' | 'suit' | 'miner' | 'grox' | 'narrator';

export type District = { id: DistrictId; name: string; tagline: string; act: number; mood: 'neon-night' | 'market' | 'rain' | 'motorway' | 'industrial' | 'gated' | 'glass' };

export type Character = { id: CharacterId; name: string; role: string; faction?: FactionId; colour: string };

/** One camera setup. Positions are metres relative to Genesis Square's centre; dayT is the city clock (0–1, 0.5 = noon). */
export type Shot = { dayT: number; x: number; z: number; yaw: number; pitch?: number; dist?: number; hold: number };

export type Line = { who: CharacterId; text: string; shot?: number };

export type Cutscene = { id: string; title?: string; shots: Shot[]; lines: Line[] };

export type Objective =
  | { kind: 'goto'; where: DistrictId | [number, number]; label: string }
  | { kind: 'deliver'; label: string }
  | { kind: 'checkpoints'; count: number; label: string }
  | { kind: 'escape'; heat: number; label: string }
  | { kind: 'steal'; what: string; label: string }
  | { kind: 'survive'; blocks: number; label: string }
  | { kind: 'talk'; who: CharacterId; label: string };

export type Mission = {
  id: string;
  title: string;
  giver: CharacterId;
  district: DistrictId;
  intro?: string; // cutscene id
  outro?: string;
  objectives: Objective[];
  /** Faction standing changes when completed (Part 5). */
  standing?: Partial<Record<FactionId, number>>;
  /** Evidence collected for the Professor mystery (Part 5). */
  evidence?: { genius?: number; conman?: number; spook?: number };
  /** Not built yet: shows in the journal as "coming soon". */
  planned?: boolean;
};

export type Chapter = { id: string; title: string; missions: Mission[] };
export type Act = { n: number; title: string; district: DistrictId; opener?: string; chapters: Chapter[] };
