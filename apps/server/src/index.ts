import os from 'node:os';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';

const { app } = createApp(config);

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ port }) => {
  console.log(`Agora listening on http://localhost:${port}`);
  if (config.host === '0.0.0.0') {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${port}`);
      }
    }
  }
  if (config.mock) console.log('  mock provider enabled');
});
