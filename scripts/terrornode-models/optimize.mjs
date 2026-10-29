/**
 * Packs a game GLB for the wire (TERRORNODE load time, 29 Oct 2026): drops clips the game never plays, removes
 * animation tracks that never leave the rest pose, resamples, optionally decimates, cuts textures to WebP at
 * <texSize>, and meshopt-compresses (every loader of these files sets three's MeshoptDecoder).
 *
 * Needs @gltf-transform/{core,extensions,functions}@4, meshoptimizer and sharp: run it from a scratch folder that
 * has them installed (not a dependency of the site). Used for the horde monsters:
 *   node optimize.mjs helldemon.glb out.glb 512 0.5 'Armature|await x 2,Armature|WALKING,Armature|atack,Armature|dying'
 *   node optimize.mjs skeleton_minion.glb out.glb 512 0 'Idle,Walking_D_Skeletons,Running_C,Unarmed_Melee_Attack_Punch_A,Death_A,Hit_A'
 *   node optimize.mjs <zombiewarrior|hazmat|raptor|zombie|eyebeast>.glb out.glb 512 0 '*'
 * Keep every clip a MonsterDef (src/lib/arenaHD.ts) or Frogger3D names.
 *
 * usage: node optimize.mjs <in.glb> <out.glb> <texSize> <simplifyRatio|0> <keepClip,...|*>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup, meshopt, textureCompress, weld, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [inp, out, tex = '512', ratio = '0', keep = '*'] = process.argv.slice(2);
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
if (keep !== '*') { const k = new Set(keep.split(',')); for (const a of doc.getRoot().listAnimations()) if (!k.has(a.getName())) a.dispose(); }
// drop channels that never leave the node's rest value (constant scale/translation tracks)
for (const a of doc.getRoot().listAnimations()) for (const c of a.listChannels()) {
  const n = c.getTargetNode(), smp = c.getSampler(), path = c.getTargetPath();
  if (!n || !smp || path === 'weights') continue;
  const rest = path === 'translation' ? n.getTranslation() : path === 'rotation' ? n.getRotation() : n.getScale();
  const out = smp.getOutput().getArray(), k = rest.length; let same = true;
  for (let i = 0; i < out.length && same; i++) if (Math.abs(out[i] - rest[i % k]) > 1e-4) same = false;
  if (same) { c.dispose(); }
}
const steps = [dedup(), resample({ tolerance: +(process.env.TOL || 1e-3) })];
if (+ratio > 0) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: 0.002, lockBorder: true }));
steps.push(prune({ keepSolidTextures: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+tex, +tex], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await doc.transform(...steps);
await io.write(out, doc);
