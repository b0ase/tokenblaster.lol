/**
 * BSVGun VERSUS, the in-scene half: the other shooters (a booth, a figure, a gun that follows their aim, their tracer
 * fire) with their X avatar billboard over their head, plus the claim book and the message handling.
 * The rules live in versus.ts (pure, tested); the engine owns the targets and calls into this.
 *
 * Everyone shoots from the same spot (the shooter's booth at the origin), so target positions and aim rays are
 * identical for all, which is what makes first-claim-wins fair. The other shooters are drawn on a forward firing line
 * in front of you (z = -6.5, spread across the lane) so they are in view: their tracers run from their muzzle to the
 * point they actually hit in the shared world, whatever their drawn position.
 *
 * Avatar billboards are THREE.Sprites. There is no AO pass in this renderer; if one is ever added, hide the sprites
 * (layer.setTagsVisible(false)) while it renders so the billboards don't get outlined.
 */
import * as THREE from 'three';
import { disposeAvatarTag, fitAvatarTag, makeAvatarTag, tagKey } from '../avatarTag';
import type { Fx } from './fx';
import { halo } from './targets';
import { ClaimBook, planRound, qt, type Claim, type PlanEv } from './versus';
import type { RangeWeapon } from './weapons';

export type VsPlayer = { id: string; name: string; x?: string; color: string; verified: boolean };
export type VsRow = VsPlayer & { score: number; kills: number; me: boolean; rank: number };

export const VS_EVENTS = ['a', 's', 'c', 'cs'];
const LINE_Z = -6.5;
const FWD = new THREE.Vector3(0, 0, -1);

type Peer = {
  p: VsPlayer;
  g: THREE.Group;
  mats: THREE.Material[];
  pivot: THREE.Group;
  tag: THREE.Sprite;
  key: string;
  aim: THREE.Vector3;
  want: THREE.Vector3;
  flash: THREE.Sprite;
  flashT: number;
  seen: number;
  wid: string;
  muzzle: THREE.Vector3;
};

export type VsOpts = {
  scene: THREE.Scene;
  fx: Fx;
  rid: string;
  me: string;
  players: VsPlayer[];
  send: (ev: string, p: unknown) => void;
  weapons: RangeWeapon[];
  /** A claim took (or took over) a target: remove it from the sky and show who got it. */
  onWon: (c: Claim, who: VsPlayer) => void;
  /** Someone's earlier claim beat mine to a target I had already shot. */
  onBeaten: (c: Claim, who: VsPlayer) => void;
};

export class VersusLayer {
  readonly plan: PlanEv[];
  readonly book: ClaimBook;
  private peers = new Map<string, Peer>();
  private by = new Map<string, VsPlayer>();
  private root = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private shared: THREE.Material[] = [];
  private tagsOn = true;
  private timers: ReturnType<typeof setInterval>[] = [];
  private disposed = false;
  /** Debug counters: messages in by type, claims refused. */
  private stats = { a: 0, s: 0, c: 0, cs: 0, rej: 0 };

  constructor(private o: VsOpts) {
    this.plan = planRound(o.rid, o.players.length);
    this.book = new ClaimBook(
      this.plan,
      o.players.map((p) => p.id),
    );
    for (const p of o.players) this.by.set(p.id, p);
    o.scene.add(this.root);
    this.timers.push(setInterval(() => !this.disposed && this.book.mine(o.me).length > 0 && this.syncMine(), 3000));
    const others = o.players.filter((p) => p.id !== o.me);
    const g = <T extends THREE.BufferGeometry>(x: T) => (this.geos.push(x), x);
    const geo = {
      counter: g(new THREE.BoxGeometry(2.5, 0.12, 0.9)),
      front: g(new THREE.BoxGeometry(2.5, 0.9, 0.08)),
      trim: g(new THREE.BoxGeometry(2.5, 0.05, 0.05)),
      legs: g(new THREE.BoxGeometry(0.46, 0.95, 0.26)),
      torso: g(new THREE.BoxGeometry(0.56, 0.62, 0.3)),
      head: g(new THREE.SphereGeometry(0.19, 14, 10)),
      gun: g(new THREE.BoxGeometry(0.09, 0.11, 0.78)),
    };
    const dark = new THREE.MeshStandardMaterial({ color: '#23242c', metalness: 0.7, roughness: 0.5 });
    const skin = new THREE.MeshStandardMaterial({ color: '#d9b99b', roughness: 0.7 });
    const gunMat = new THREE.MeshStandardMaterial({ color: '#15161c', metalness: 0.8, roughness: 0.35 });
    this.shared.push(dark, skin, gunMat);
    others.forEach((p, k) => {
      const grp = new THREE.Group();
      grp.position.set((k - (others.length - 1) / 2) * 3.1, 0, LINE_Z);
      const col = new THREE.Color(p.color);
      const body = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.55), emissive: col, emissiveIntensity: 0.35, roughness: 0.6 });
      const trimMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), toneMapped: false });
      const mats: THREE.Material[] = [body, trimMat];
      const add = (m: THREE.Mesh, x: number, y: number, z: number) => (m.position.set(x, y, z), grp.add(m), m);
      add(new THREE.Mesh(geo.counter, dark), 0, 1.0, -0.35);
      add(new THREE.Mesh(geo.front, dark), 0, 0.55, -0.8);
      add(new THREE.Mesh(geo.trim, trimMat), 0, 1.075, -0.8);
      add(new THREE.Mesh(geo.legs, dark), 0, 0.48, 0.5);
      add(new THREE.Mesh(geo.torso, body), 0, 1.26, 0.5);
      add(new THREE.Mesh(geo.head, skin), 0, 1.78, 0.5);
      const pivot = new THREE.Group();
      pivot.position.set(0.18, 1.34, 0.4);
      const gun = new THREE.Mesh(geo.gun, gunMat);
      gun.position.z = -0.34;
      pivot.add(gun);
      grp.add(pivot);
      const flash = halo(p.color, 0.7, 0);
      flash.position.set(0, 0, -0.8);
      pivot.add(flash);
      const tagOpts = { handle: p.x ?? null, name: p.name, ring: p.color, verified: p.verified };
      const tag = makeAvatarTag(tagOpts, 1.0);
      tag.position.set(0, 2.15, 0.5);
      grp.add(tag);
      this.root.add(grp);
      this.peers.set(p.id, { p, g: grp, mats, pivot, tag, key: tagKey(tagOpts), aim: new THREE.Vector3(0, 0, -1), want: new THREE.Vector3(0, 0, -1), flash, flashT: 0, seen: performance.now(), wid: '', muzzle: new THREE.Vector3() });
    });
  }

  private nowW = () => 0;
  /** The engine tells us its round clock. */
  setClock(f: () => number) {
    this.nowW = f;
  }

  myScore() {
    return this.book.totals().get(this.o.me)?.score ?? 0;
  }

  rows(): VsRow[] {
    const t = this.book.totals();
    return this.book.ranking().map((r, i) => {
      const p = this.by.get(r.id)!;
      return { ...p, score: t.get(r.id)?.score ?? r.score, kills: r.kills, me: r.id === this.o.me, rank: i + 1 };
    });
  }

  /** My kill: record it and tell the room at once. Broadcasts are best-effort, so a digest of all my claims follows every 3 s. */
  claimLocal(n: number, t: number, d: number, bull: boolean, mult: number) {
    const c: Claim = { n, i: this.o.me, t: qt(t), d: Math.round(d * 10) / 10, b: bull ? 1 : 0, m: Math.min(8, Math.max(1, Math.floor(mult))) };
    this.book.add(c);
    this.o.send('c', c);
  }

  /** End of round: say all my claims again so a dropped message can't change the result. */
  syncMine() {
    const a = this.book.mine(this.o.me).map((c) => [c.n, c.t, c.d, c.b, c.m]);
    this.o.send('cs', { i: this.o.me, a });
  }

  setVerified(v: Record<string, boolean>) {
    for (const peer of this.peers.values()) {
      const verified = Boolean(v[peer.p.id]);
      if (verified === peer.p.verified) continue;
      peer.p = { ...peer.p, verified };
      this.by.set(peer.p.id, peer.p);
      const opts = { handle: peer.p.x ?? null, name: peer.p.name, ring: peer.p.color, verified };
      const pos = peer.tag.position.clone();
      disposeAvatarTag(peer.tag);
      peer.tag = makeAvatarTag(opts, 1.0);
      peer.tag.position.copy(pos);
      peer.tag.visible = this.tagsOn;
      peer.key = tagKey(opts);
      peer.g.add(peer.tag);
    }
  }

  setTagsVisible(on: boolean) {
    this.tagsOn = on;
    for (const p of this.peers.values()) p.tag.visible = on;
  }

  /** Incoming gameplay message (already filtered to this race by the session). */
  onMsg(ev: string, raw: unknown) {
    const d = raw as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return;
    if (ev === 'a' || ev === 's' || ev === 'c' || ev === 'cs') this.stats[ev]++;
    if (ev === 'c') this.take(d as Partial<Claim>);
    else if (ev === 'cs') {
      const a = d.a;
      const i = d.i;
      if (!Array.isArray(a) || typeof i !== 'string' || a.length > 400) return;
      for (const row of a) {
        if (!Array.isArray(row)) continue;
        this.take({ n: row[0], t: row[1], d: row[2], b: row[3], m: row[4], i });
      }
    } else if (ev === 'a' || ev === 's') {
      const i = d.i;
      const peer = typeof i === 'string' ? this.peers.get(i) : undefined;
      const dir = d.d;
      if (!peer || !Array.isArray(dir) || dir.length !== 3 || !dir.every((v) => typeof v === 'number' && Number.isFinite(v))) return;
      peer.seen = performance.now();
      peer.want.set(dir[0], dir[1], dir[2]).normalize();
      if (typeof d.w === 'string' && d.w.length < 40) peer.wid = d.w;
      if (ev === 's') this.peerShot(peer, d.e);
    }
  }

  private take(raw: Partial<Claim>) {
    const c = this.book.validate(raw, this.nowW());
    if (!c) this.stats.rej++;
    if (!c || c.i === this.o.me) return;
    const prev = this.book.winners.get(c.n);
    const res = this.book.add(c);
    if (res !== 'new' && res !== 'won') return;
    const who = this.by.get(c.i);
    if (!who) return;
    if (res === 'won' && prev?.i === this.o.me) this.o.onBeaten(c, who);
    this.o.onWon(c, who);
  }

  private peerShot(peer: Peer, end: unknown) {
    const w = this.o.weapons.find((x) => x.id === peer.wid);
    const bolt = w?.bolt ?? peer.p.color;
    peer.pivot.updateWorldMatrix(true, false);
    const mz = peer.muzzle.set(0, 0, -0.78).applyMatrix4(peer.pivot.matrixWorld);
    const e = new THREE.Vector3();
    if (Array.isArray(end) && end.length === 3 && end.every((v) => typeof v === 'number' && Number.isFinite(v))) e.set(end[0], end[1], end[2]);
    else e.copy(mz).addScaledVector(peer.want, 60);
    const width = w?.ammo === 'laser' ? 0.1 : w?.ammo === 'plasma' ? 0.07 : w?.ammo === 'rocket' ? 0.2 : w?.ammo === 'grenade' ? 0.16 : 0.05;
    this.o.fx.tracer(mz, e, bolt, width, w?.ammo === 'laser' ? 0.17 : 0.1);
    peer.flashT = 0.07;
    peer.flash.material.color.set(bolt);
  }

  update(dt: number, camera: THREE.Camera) {
    const k = Math.min(1, dt * 14);
    for (const p of this.peers.values()) {
      p.aim.lerp(p.want, k).normalize();
      p.pivot.quaternion.setFromUnitVectors(FWD, p.aim);
      p.g.rotation.y = Math.atan2(-p.aim.x, -p.aim.z) * 0.45;
      if (p.flashT > 0) {
        p.flashT -= dt;
        p.flash.material.opacity = Math.max(0, p.flashT / 0.07);
      } else p.flash.material.opacity = 0;
      fitAvatarTag(p.tag, camera, 0.05, 3.2);
    }
  }

  /** Test/debug: what the layer is showing. */
  debug() {
    return { peers: [...this.peers.values()].map((p) => ({ id: p.p.id, x: p.p.x, tag: p.key, pos: [p.g.position.x, p.g.position.y, p.g.position.z] })), claims: this.book.winners.size, all: this.book.all.size, stats: { ...this.stats } };
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearInterval(t);
    for (const p of this.peers.values()) {
      disposeAvatarTag(p.tag);
      for (const m of p.mats) m.dispose();
      p.flash.material.dispose();
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.shared) m.dispose();
    this.root.removeFromParent();
    this.peers.clear();
  }
}
