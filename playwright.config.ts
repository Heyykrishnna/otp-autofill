import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npm run test:site",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
})
