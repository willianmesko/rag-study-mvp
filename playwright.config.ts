import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/ux",
  snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: { toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.004 } },
  use: {
    baseURL,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined
  },
  projects: [
    {
      name: "desktop-en",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 950 }, locale: "en-US", timezoneId: "UTC" }
    },
    {
      name: "tablet-en",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true, locale: "en-US", timezoneId: "UTC" }
    },
    {
      name: "mobile-pt",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo" }
    }
  ],
  webServer: {
    command: "npm run build:web && npm --workspace @rag-study/web run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: baseURL,
    timeout: 120_000,
    env: {
      VITE_API_BASE_URL: baseURL,
      VITE_SUPABASE_URL: "https://fixture.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_DEMO_MODE: "true"
    }
  }
});
