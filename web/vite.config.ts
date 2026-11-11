import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Risk API (../src/server.js) serves the built page from /web/dist/, so asset paths are relative.
// In dev, /api is proxied to it (default port 3001, or API_PROXY).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:3001' } },
  // Unit tests are *.spec.ts, not *.test.ts: Node's built-in runner (Role 2's `npm test`) would pick up *.test.ts.
  test: { include: ['src/**/*.spec.ts'] },
});
