const { test, expect } = require("@playwright/test");

// Calculated fields end to end: one declared in the markup, one typed into the
// designer by the reader, and a custom aggregate the demo registers on the
// server. The numbers are checked against the plain sums the same endpoint
// returns, so the test knows nothing about the sample data.
const PAGE = "/Home/TagHelpers";

const zoneBody = area => `[data-zone="${area}"] .pivot-zone__body`;
const chipIn = (area, field) => `${zoneBody(area)} .pivot-chip[data-field="${field}"]`;
const availableChip = field => `.pivot-field-list .pivot-chip[data-field="${field}"]`;
const editor = selector => `.pivot-value-settings.is-open ${selector}`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;

  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
  await page.evaluate(() => {
    window.loads = [];
    document.getElementById("pivotGrid").addEventListener(
      "pivotforge:dataloaded", event => window.loads.push(event.detail.result));
  });
});

// The next result the grid draws after `action`.
async function nextResult(page, action) {
  const before = await page.evaluate(() => window.loads.length);
  await action();
  await expect.poll(() => page.evaluate(() => window.loads.length)).toBeGreaterThan(before);
  return page.evaluate(() => window.loads.at(-1));
}

const plainSums = page => page.evaluate(async () => {
  const response = await fetch("/pivotforge/pivot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: [], columns: [],
      values: [
        { field: "Amount", aggregation: "sum" },
        { field: "Quantity", aggregation: "sum" }
      ]
    })
  });
  return (await response.json()).grandTotals;
});

test("a declared calculated field computes a ratio of sums", async ({ page }) => {
  const result = await nextResult(page, () =>
    page.dragAndDrop(availableChip("UnitPrice"), zoneBody("data")));

  const sums = await plainSums(page);
  expect(result.grandTotals.UnitPrice_calculated)
    .toBeCloseTo(sums.Amount_sum / sums.Quantity_sum, 6);
  await expect(page.locator(`${chipIn("data", "UnitPrice")}.is-calculated`)).toHaveCount(1);
  await expect(page.locator(".pivot-table__table thead")).toContainText("Ortalama Birim Fiyat");
  expect(page.errors).toEqual([]);
});

test("a field the reader defines is computed and survives a reload", async ({ page }) => {
  await page.locator('[data-action="add-calculated"]').click();
  await page.fill(editor('[data-action="formula-caption"]'), "Adet Başına Tutar");
  await page.locator(editor('[data-action="formula-field"][data-value="Amount"]')).click();
  await page.locator(editor('[data-action="formula-operator"][data-value="/"]')).click();
  await page.locator(editor('[data-action="formula-field"][data-value="Quantity"]')).click();
  await expect(page.locator(editor('[data-role="formula-token"]'))).toHaveCount(3);
  await expect(page.locator(editor('[data-action="formula"]'))).toBeHidden();

  const result = await nextResult(page, () =>
    page.locator(editor('[data-action="formula-save"]')).click());

  const sums = await plainSums(page);
  expect(result.grandTotals.calculated1_calculated)
    .toBeCloseTo(sums.Amount_sum / sums.Quantity_sum, 6);
  await expect(page.locator(chipIn("data", "calculated1"))).toContainText("Adet Başına Tutar");
  await expect(page.locator(".pivot-value-settings.is-open")).toHaveCount(0);

  await page.reload();
  await page.waitForSelector(".pivot-table__table td");
  await expect(page.locator(chipIn("data", "calculated1"))).toContainText("Adet Başına Tutar");
  await expect(page.locator(".pivot-table__table thead")).toContainText("Adet Başına Tutar");
  expect(page.errors).toEqual([]);
});

test("a formula naming a field that does not exist is refused in the editor", async ({ page }) => {
  await page.locator('[data-action="add-calculated"]').click();
  await page.fill(editor('[data-action="formula-caption"]'), "Kâr");
  await page.locator(editor('[data-action="formula-advanced"]')).click();
  await page.fill(editor('[data-action="formula"]'), "[Amount] - [Maliyet]");
  await page.locator(editor('[data-action="formula-save"]')).click();

  await expect(page.locator(editor('[data-role="formula-error"]')))
    .toHaveText("[Maliyet] adında bir alan yok.");
  await expect(page.locator(chipIn("data", "calculated1"))).toHaveCount(0);
});

test("a custom aggregate registered on the server can be called", async ({ page }) => {
  await page.locator('[data-action="add-calculated"]').click();
  await page.fill(editor('[data-action="formula-caption"]'), "Medyan Tutar");
  await page.locator(editor('[data-action="formula-advanced"]')).click();
  await page.fill(editor('[data-action="formula"]'), "Median([Amount])");

  const result = await nextResult(page, () =>
    page.locator(editor('[data-action="formula-save"]')).click());

  expect(typeof result.grandTotals.calculated1_calculated).toBe("number");
  await expect(page.locator(".pivot-error")).toHaveCount(0);
});

test("a function the server does not know is reported with its name", async ({ page }) => {
  await page.locator('[data-action="add-calculated"]').click();
  await page.fill(editor('[data-action="formula-caption"]'), "X");
  await page.locator(editor('[data-action="formula-advanced"]')).click();
  await page.fill(editor('[data-action="formula"]'), "Medain([Amount])");
  await page.locator(editor('[data-action="formula-save"]')).click();

  await expect(page.locator(".pivot-error")).toContainText("Medain");
});

test("a field dragged into the formula lands between the pieces already there", async ({ page }) => {
  await page.locator('[data-action="add-calculated"]').click();
  await page.fill(editor('[data-action="formula-caption"]'), "Kâr Payı");
  await page.locator(editor('[data-action="formula-field"][data-value="Amount"]')).click();
  await page.locator(editor('[data-action="formula-operator"][data-value="/"]')).click();

  // Dropped on the division sign's left half: between the amount and the sign.
  const sign = page.locator(editor('[data-role="formula-token"]')).nth(1);
  const box = await sign.boundingBox();
  await page.locator(editor('[data-action="formula-field"][data-value="Quantity"]'))
    .dragTo(page.locator(editor('[data-role="formula-strip"]')), {
      targetPosition: await page.locator(editor('[data-role="formula-strip"]')).evaluate(
        (strip, point) => {
          const own = strip.getBoundingClientRect();
          return { x: point.x - own.left, y: point.y - own.top };
        },
        { x: box.x + 4, y: box.y + box.height / 2 })
    });

  await expect(page.locator(editor('[data-role="formula-token"]'))).toHaveCount(3);
  await expect(page.locator(editor('[data-role="formula-token"]')).nth(1)).toContainText("Miktar");
  await expect(page.locator(".pivot-formula__ghost")).toHaveCount(0);

  await page.locator(editor('[data-action="formula-advanced"]')).click();
  await expect(page.locator(editor('[data-action="formula"]'))).toHaveValue("[Amount] [Quantity] /");
  expect(page.errors).toEqual([]);
});
