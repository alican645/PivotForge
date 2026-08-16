// Browser-level tests for the field designer. The node --test suite runs against
// a DOM stub, which cannot express HTML5 drag-and-drop or event bubbling — the
// two things that produced the bugs these tests cover.
const { defineConfig } = require("@playwright/test");

const port = 5111;
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL, headless: true },
  webServer: {
    command: "dotnet run --project samples/PivotForge.MvcDemo --no-launch-profile",
    env: { ASPNETCORE_URLS: baseURL, ASPNETCORE_ENVIRONMENT: "Development" },
    url: `${baseURL}/Home/TagHelpers`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
