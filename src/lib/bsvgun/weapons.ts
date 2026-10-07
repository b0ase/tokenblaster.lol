/**
 * BSVGun range weapons: the four stock guns every player has, plus every 1Sat Ordnance weapon
 * (locked unless the wallet holds the ordinal, same ownership check as the Arena and Double-O).
 * Each profile decides how the gun feels on the range: rate, spread, zoom, splash, damage.
 */
import { GUNS, type GunDef } from '../arenaHD';
import { ORDNANCE, ammoOf, type Ammo, type Ordnance } from '../ordnance';
import { gunDefFor } from '../ordnanceModels';

export type RangeWeapon = {
  id: string;
  name: string;
  blurb: string;
  ordnance?: Ordnance;
  def: GunDef;
  ammo: Ammo;
  /** ms between shots. */
  fireMs: number;
  /** Hold to keep firing. */
  auto: boolean;
  /** Rays per trigger pull (one on-chain transaction per pull in LIVE). */
  pellets: number;
  /** Cone half-angle in radians. */
  spread: number;
  /** Scope magnification while aiming down sights. */
  zoom: number;
  /** Hits dealt to a target. */
  damage: number;
  /** Splash radius in metres (rockets, grenades). */
  splash: number;
  bolt: string;
  kick: number;
  /** 0..1 bars for the weapon card. */
  bars: { rate: number; spread: number; zoom: number; power: number };
};

const ZOOM: Record<Ammo, number> = { bullet: 1.9, pellet: 1.2, laser: 3.6, plasma: 2.1, rocket: 1.35, grenade: 1.2 };
const SPLASH: Partial<Record<Ammo, number>> = { rocket: 7, grenade: 5.5 };

function bars(w: Pick<RangeWeapon, 'fireMs' | 'pellets' | 'spread' | 'zoom' | 'damage' | 'splash'>) {
  return {
    rate: Math.min(1, 140 / Math.max(40, w.fireMs)),
    spread: Math.min(1, 1 - Math.min(1, w.spread / 0.09)),
    zoom: Math.min(1, (w.zoom - 1) / 3),
    power: Math.min(1, (w.damage * 0.22 + w.pellets * 0.05 + w.splash * 0.07) / 1.1),
  };
}

type Stock = { name: string; blurb: string; fireMs: number; auto: boolean; pellets: number; spread: number; zoom: number; ammo: Ammo };
const STOCK: Record<string, Stock> = {
  minigun: { name: 'Minigun', blurb: 'Belt-fed. Hold the trigger and let the chain sort it out.', fireMs: 70, auto: true, pellets: 1, spread: 0.02, zoom: 1.5, ammo: 'bullet' },
  plasmarifle: { name: 'Plasma MG', blurb: 'Tight, hot, accurate. Your all-rounder.', fireMs: 115, auto: true, pellets: 1, spread: 0.007, zoom: 2.2, ammo: 'plasma' },
  quadplasma: { name: 'Quad Plasma', blurb: 'Four bolts in a diamond. Great on flocks.', fireMs: 330, auto: false, pellets: 4, spread: 0.032, zoom: 1.35, ammo: 'plasma' },
  sawedoff: { name: 'Sawed-off', blurb: 'Nine pellets, one pull. Skeet specialist.', fireMs: 720, auto: false, pellets: 9, spread: 0.075, zoom: 1.1, ammo: 'pellet' },
};

export function buildWeapons(): RangeWeapon[] {
  const out: RangeWeapon[] = [];
  for (const g of GUNS) {
    const s = STOCK[g.id];
    if (!s) continue;
    const w: Omit<RangeWeapon, 'bars'> = { ...s, id: g.id, def: g, bolt: g.bolt, kick: g.kick, damage: 1, splash: 0 };
    out.push({ ...w, bars: bars(w) });
  }
  for (const o of ORDNANCE) {
    const ammo = ammoOf(o);
    const w: Omit<RangeWeapon, 'bars'> = {
      id: o.id,
      name: o.name,
      blurb: o.tagline,
      ordnance: o,
      def: gunDefFor(o),
      ammo,
      fireMs: Math.max(60, o.stats.fireMs * (ammo === 'rocket' || ammo === 'grenade' ? 1.4 : 1)),
      auto: o.stats.fireMs <= 200,
      pellets: o.stats.pellets,
      spread: Math.max(0.002, o.stats.spread * 0.85),
      zoom: ZOOM[ammo],
      damage: ammo === 'rocket' ? 3 : ammo === 'laser' ? 2 : 1,
      splash: SPLASH[ammo] ?? 0,
      bolt: o.stats.bolt,
      kick: o.stats.kick,
    };
    out.push({ ...w, bars: bars(w) });
  }
  return out;
}

export const STOCK_IDS = GUNS.map((g) => g.id);
