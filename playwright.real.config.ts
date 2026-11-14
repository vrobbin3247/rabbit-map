import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/** Manual only: drives the app with a REAL provider and spends a little plan quota. `npm run test:real` */
const port = 8789;
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'real.manual.ts',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 90_000 },
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 860 } },
  webServer: {
    command: 'npm start',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: { MINDMAPPER_PORT: String(port), MINDMAPPER_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'mm-real-')) },
  },
});
