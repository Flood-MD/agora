import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.AGORA_API ?? `http://localhost:${process.env.PORT ?? 8080}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // reachable from other devices on the LAN during development
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
});
