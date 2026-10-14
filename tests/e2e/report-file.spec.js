const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

// The toolbar's report buttons: the view saved as a file, and opened again in
// a fresh page. Session storage is cleared first so the opened view is the
// file's and not one the page remembered.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.addInitScript(() => {
    document.addEventListener("pivotforge:ready", event => { window.grid = event.detail.widget; }, true);
  });
  await page.goto(PAGE);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector("#pivotGrid .pivot-table__table td");
});

const rowFields = page => page.evaluate(() => window.grid.layoutState.getState().rows);

test("a saved report brings its layout and sort back", async ({ page }, testInfo) => {
  await page.evaluate(async () => {
    window.grid.layoutState.setCaption("Region", "Satış Bölgesi");
    window.grid.layoutState.reorder("row", 0, 1);
    await window.grid.update({ fields: window.grid.layoutState.toFields() });
    await window.grid.sortBy({ mode: "RowLabel", direction: "Descending", field: "Category" });
  });
  const saved = await rowFields(page);

  const download = page.waitForEvent("download");
  await page.locator('.pivot-toolbar [data-toolbar-item="saveReport"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^pivotforge-report-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath("report.json");
  await file.saveAs(path);
  expect(JSON.parse(fs.readFileSync(path, "utf8")).format).toBe("pivotforge-report");

  // A fresh start, then the file.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector("#pivotGrid .pivot-table__table td");
  expect(await rowFields(page)).not.toEqual(saved);

  const chooser = page.waitForEvent("filechooser");
  await page.locator('.pivot-toolbar [data-toolbar-item="openReport"]').click();
  await (await chooser).setFiles(path);

  await expect.poll(() => rowFields(page)).toEqual(saved);
  await expect(page.locator("#pivotGrid .pivot-table__corner").filter({ hasText: "Satış Bölgesi" })).toHaveCount(1);
  expect(await page.evaluate(() => window.grid.rowSort?.direction)).toBe("Descending");
  expect(page.errors).toEqual([]);
});

test("full screen fills the window and Escape leaves it", async ({ page }) => {
  const button = page.locator('.pivot-toolbar [data-toolbar-item="fullscreen"]');
  await button.click();

  const grid = page.locator("#pivotGrid");
  await expect(grid).toHaveClass(/pivot-is-fullscreen/);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const box = await grid.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.y + box.height)).toBe(viewport.height);

  await page.keyboard.press("Escape");
  await expect(grid).not.toHaveClass(/pivot-is-fullscreen/);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(page.errors).toEqual([]);
});
