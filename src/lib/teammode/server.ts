import 'server-only';
/** The game server's HTTP base, server side only (env TERRORNODE_TEAM_URL, e.g. http://127.0.0.1:8787 on Hetzner). */
export const TEAM_HTTP = (process.env.TERRORNODE_TEAM_URL || 'http://localhost:8787').replace(/\/$/, '');
