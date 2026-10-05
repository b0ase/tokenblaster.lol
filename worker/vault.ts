/**
 * Runs the launchpad fee vaults (runs on Hetzner under pm2, next to the indexer): calls
 * POST /api/launch/vault every 7 to 13 minutes, at moments nobody can call in advance.
 *
 *   SITE_URL=https://tokenblaster.lol LAUNCH_CRON_SECRET=… node vault.mjs
 */
const SITE = process.env.SITE_URL ?? 'https://tokenblaster.lol';
const SECRET = process.env.LAUNCH_CRON_SECRET;
if (!SECRET) throw new Error('Set LAUNCH_CRON_SECRET.');

async function tick() {
  try {
    const r = await fetch(`${SITE}/api/launch/vault`, { method: 'POST', headers: { 'x-cron-secret': SECRET! } });
    console.log(new Date().toISOString(), r.status, await r.text());
  } catch (e) {
    console.error(new Date().toISOString(), e);
  }
  setTimeout(tick, (7 + Math.random() * 6) * 60_000);
}
tick();
