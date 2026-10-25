// pm2 on Hetzner: pm2 start server/terrornode-team/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'terrornode-team',
      script: 'server/terrornode-team/dist/server.mjs',
      instances: 1, // matches live in memory: one process (scale by running more on other ports + routing by code)
      max_memory_restart: '400M',
      env: { PORT: 8787, PUBLIC_SITE: 'https://tokenblaster.lol', ALLOW_ORIGINS: 'https://tokenblaster.lol,https://www.tokenblaster.lol,https://chat.bwalletx.com' },
    },
  ],
};
