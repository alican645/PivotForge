const { test, expect } = require("@playwright/test");

// The "Yükleniyor..." panel over the grid while a request is out. Responses are
// held back with page.route so the panel has time to appear; built into a
// scratch container so the demo's own grid keeps the state other specs expect.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

const scratch = selector => `#scratchPivot ${selector}`;
const panel = scratch(".pivot-load-panel");
// The panel itself is a zero-height sticky strip; the pane is what is seen.
const pane = scratch(".pivot-load-panel__pane");

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

// Holds every /pivot response until release() is called.
async function holdResponses(page) {
  const waiting = [];
  await page.route("**/pivotforge/pivot", async route => {
    const response = await route.fetch();
    await new Promise(resolve => waiting.push(resolve));
    await route.fulfill({ response });
  });
  return () => waiting.splice(0).forEach(resolve => resolve());
}

// Builds a widget and records whether the panel was ever attached, so a test
// can tell "never shown" from "shown and already gone".
async function build(page, options = {}) {
  await page.evaluate(({ fields, options }) => {
    document.querySelector("#scratchPivot")?.remove();
    const host = document.createElement("div");
    host.id = "scratchPivot";
    document.body.appendChild(host);

    window.panelSeen = false;
    new MutationObserver(() => {
      window.panelSeen ||= Boolean(host.querySelector(".pivot-load-panel"));
    }).observe(host, { childList: true });

    window.scratchWidget = PivotForge.create(host, { fields, locale: "tr", autoLoad: false, ...options });
  }, { fields: FIELDS, options });
}

const refresh = page => page.evaluate(() => { window.scratchLoad = window.scratchWidget.refresh(); });
const settled = page => page.evaluate(() => window.scratchLoad);

test("a slow first load shows the panel and clears it when the table arrives", async ({ page }) => {
  const release = await holdResponses(page);
  await build(page);
  await refresh(page);

  await expect(page.locator(pane)).toBeVisible();
  await expect(page.locator(pane)).toHaveText("Yükleniyor...");
  await expect(page.locator("#scratchPivot")).toHaveAttribute("aria-busy", "true");

  release();
  await settled(page);

  await expect(page.locator(panel)).toHaveCount(0);
  await expect(page.locator(scratch(".pivot-table__table td")).first()).toBeVisible();
  await expect(page.locator("#scratchPivot")).not.toHaveAttribute("aria-busy", "true");
  expect(page.errors).toEqual([]);
});

test("a reload keeps the previous table on screen, dimmed under the panel", async ({ page }) => {
  await build(page);
  await refresh(page);
  await settled(page);

  const release = await holdResponses(page);
  await page.evaluate(() => { window.scratchLoad = window.scratchWidget.sortBy({ mode: "RowLabel", field: "Region", direction: "Descending" }); });

  await expect(page.locator(pane)).toBeVisible();
  const table = page.locator(scratch(".pivot-table__table"));
  await expect(table).toBeVisible();
  expect(Number(await table.evaluate(node => getComputedStyle(node).opacity))).toBeLessThan(1);

  release();
  await settled(page);

  await expect(page.locator(panel)).toHaveCount(0);
  expect(Number(await table.evaluate(node => getComputedStyle(node).opacity))).toBe(1);
});

test("a fast answer never flashes the panel", async ({ page }) => {
  await build(page, { loadPanelDelay: 5000 });
  await refresh(page);
  await settled(page);

  await expect(page.locator(scratch(".pivot-table__table td")).first()).toBeVisible();
  expect(await page.evaluate(() => window.panelSeen)).toBe(false);
});

test("loadPanel: false turns it off", async ({ page }) => {
  const release = await holdResponses(page);
  await build(page, { loadPanel: false, loadPanelDelay: 0 });
  await refresh(page);
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.panelSeen)).toBe(false);
  release();
  await settled(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test("the panel fits the screen", async ({ page }) => {
    await build(page);
    await refresh(page);
    await settled(page);

    const release = await holdResponses(page);
    await refresh(page);
    await expect(page.locator(pane)).toBeVisible();

    const box = await page.locator(pane).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);

    release();
    await settled(page);
  });
});
