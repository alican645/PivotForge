const { test, expect } = require("@playwright/test");

// The designer's sort panel: a row field ordered by one of the grid's values,
// in either direction. The page declares a row sort of its own (Tutar,
// descending), so picking "ascending" here also proves the panel takes that
// header sort back rather than losing to it.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector("#pivotGrid .pivot-table__table td");
});

// Each region's grand total, top to bottom: the last cell of its subtotal row.
const regionTotals = page => page.locator("#pivotGrid tbody tr.pivot-table__subtotal-row").evaluateAll(rows =>
  rows.map(row => Number(row.lastElementChild.textContent.replace(/[^\d-]/g, ""))));

const isSorted = (numbers, direction) => numbers.every((value, index) =>
  index === 0 || (direction === "asc" ? numbers[index - 1] <= value : numbers[index - 1] >= value));

test("a row field is ordered by a value, in the direction picked", async ({ page }) => {
  await page.locator('#designerHost [data-field="Region"] [data-action="settings"]').first().click();
  const settings = page.locator(".pivot-value-settings").last();

  await settings.locator('[data-action="sort-by"][data-value="Amount_sum"]').click();
  await settings.locator('[data-action="sort-order"][data-value="Ascending"]').click();
  await expect.poll(async () => isSorted(await regionTotals(page), "asc")).toBe(true);
  expect((await regionTotals(page)).length).toBeGreaterThan(1);

  await settings.locator('[data-action="sort-order"][data-value="Descending"]').click();
  await expect.poll(async () => isSorted(await regionTotals(page), "desc")).toBe(true);

  await expect(settings.locator('[data-action="sort-by"][data-selected="true"]')).toHaveAttribute("data-value", "Amount_sum");
  expect(page.errors).toEqual([]);
});

test("the row field's header arrow shows the order picked in the panel", async ({ page }) => {
  await page.locator('#designerHost [data-field="Region"] [data-action="settings"]').first().click();
  const settings = page.locator(".pivot-value-settings").last();
  const region = page.locator("#pivotGrid .pivot-table__corner:not(.pivot-table__column-field)")
    .filter({ hasText: "Bölge" });

  await settings.locator('[data-action="sort-by"][data-value="Amount_sum"]').click();
  await settings.locator('[data-action="sort-order"][data-value="Descending"]').click();
  await expect(region).toHaveAttribute("aria-sort", "descending");
  await expect(region.locator(".pivot-table__sort-indicator")).toHaveText("▼");

  await settings.locator('[data-action="sort-order"][data-value="Ascending"]').click();
  await expect(region).toHaveAttribute("aria-sort", "ascending");
  await expect(region.locator(".pivot-table__sort-indicator")).toHaveText("▲");
  expect(page.errors).toEqual([]);
});
