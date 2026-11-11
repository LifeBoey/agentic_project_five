import { defineConfig } from '@playwright/test';

// Default: the page runs against fixture data, with /api answered in the browser by Role 2's engine (see tests/e2e/helpers.ts).
// E2E_API=real: starts the real Risk API (../src/server.js, with the repo-root .env) and runs the same page against data/links.json.
const real = process.env.E2E_API === 'real';
const WEB_PORT = 5174;
const API_PORT = 3101;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/artifacts',
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The 3D view needs WebGL; headless Chromium has no GPU, so use the software renderer.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    ...(real ? [{
      command: 'node src/server.js',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/models`,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT) },
    }] : []),
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
