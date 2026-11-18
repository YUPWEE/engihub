import { defineConfig, devices } from '@playwright/test';

const argv = process.argv;
const requested = argv.flatMap((a, i) =>
  a.startsWith('--project=') ? [a.slice('--project='.length)] : a === '--project' ? [argv[i + 1]] : [],
);
process.env.PW_PROJECTS ??= (requested.length ? requested : [process.env.PW_MOBILE === '1' ? 'mobile' : 'desktop']).join(',');
const run = process.env.PW_PROJECTS.split(',').map(
  (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'),
);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: './test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'on',
    trace: 'on-first-retry',
    headless: true,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ].filter((p) => run.some((re) => re.test(p.name))),
});
