const { test, expect } = require("@playwright/test");

// A value filter picked in the designer, against the real engine: only the
// regions whose total clears the bound stay, and the grand total counts only
// them.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector("#pivotGrid .pivot-table__table td");
});

// Each region's total, top to bottom: the last cell of its subtotal row.
const regionTotals = page => page.locator("#pivotGrid tbody tr.pivot-table__subtotal-row").evaluateAll(rows =>
  rows.map(row => Number(row.lastElementChild.textContent.replace(/[^\d-]/g, ""))));
const grandTotal = page => page.locator("#pivotGrid tbody tr").last().evaluate(row =>
  Number(row.lastElementChild.textContent.replace(/[^\d-]/g, "")));

test("only the regions over the bound stay, and the grand total follows them", async ({ page }) => {
  const before = await regionTotals(page);
  expect(before.length).toBeGreaterThan(2);
  const sorted = [...before].sort((a, b) => a - b);
  // A bound with some regions on each side of it.
  const bound = sorted[Math.floor(sorted.length / 2) - 1];
  const kept = before.filter(total => total > bound);

  await page.locator('#designerHost [data-field="Region"] [data-action="settings"]').first().click();
  const settings = page.locator(".pivot-value-settings").last();
  await settings.locator('[data-action="value-filter-operator"][data-value="GreaterThan"]').click();
  await settings.locator('[data-action="value-filter-value"]').fill(String(bound));
  await settings.locator('[data-action="value-filter-apply"]').click();

  await expect.poll(async () => (await regionTotals(page)).length).toBe(kept.length);
  expect((await regionTotals(page)).every(total => total > bound)).toBe(true);
  // The cells are rounded to whole liras, so the sum may be off by one per region.
  const sum = kept.reduce((total, value) => total + value, 0);
  expect(Math.abs((await grandTotal(page)) - sum)).toBeLessThanOrEqual(kept.length);

  // The header's funnel shows the field is filtered.
  await expect(page.locator('#pivotGrid .pivot-table__filter-button[data-field="Region"]')).toHaveClass(/is-active/);

  await settings.locator('[data-action="value-filter-clear"]').click();
  await expect.poll(async () => (await regionTotals(page)).length).toBe(before.length);
  expect(page.errors).toEqual([]);
});
