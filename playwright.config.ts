import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const port = 8788;
const dataDir = mkdtempSync(path.join(tmpdir(), 'mm-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm start',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      MINDMAPPER_PROVIDER: 'fake',
      MINDMAPPER_FAKE_DELAY_MS: '5',
      MINDMAPPER_PORT: String(port),
      MINDMAPPER_DATA_DIR: dataDir,
    },
  },
});
