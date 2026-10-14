const { test, expect } = require("@playwright/test");

// Per-field allowSorting, allowFiltering, width and wordWrap, built into a
// scratch container so the demo's own specs keep the controls they click.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row", allowSorting: false, width: 220, wordWrap: true },
  { dataField: "Category", caption: "Kategori", area: "row", allowFiltering: false },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum", allowSorting: false, width: 160, wordWrap: true },
  { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async fields => {
    const host = document.createElement("div");
    host.id = "scratchPivot";
    document.body.appendChild(host);
    window.scratchWidget = PivotForge.create(host, { fields, autoLoad: false });
    await window.scratchWidget.refresh();
  }, FIELDS);
  await page.waitForSelector("#scratchPivot .pivot-table__table td");
});

const rowCorner = (page, text) =>
  page.locator("#scratchPivot .pivot-table__corner:not(.pivot-table__column-field)").filter({ hasText: text });

test("a field's own allowSorting and allowFiltering take only its own controls away", async ({ page }) => {
  const region = rowCorner(page, "Bölge");
  const category = rowCorner(page, "Kategori");

  await expect(region.locator(".pivot-table__sort-button")).toHaveCount(0);
  await expect(region.locator(".pivot-table__filter-button")).toHaveCount(1);
  await expect(category.locator(".pivot-table__sort-button")).toHaveCount(1);
  await expect(category.locator(".pivot-table__filter-button")).toHaveCount(0);

  // The measure that opted out has no value-header sort; the other keeps it.
  const amountHeader = page.locator('#scratchPivot .pivot-table__value-header[data-value-key="Amount_sum"]').first();
  const quantityHeader = page.locator('#scratchPivot .pivot-table__value-header[data-value-key="Quantity_sum"]').first();
  await expect(amountHeader.locator(".pivot-table__sort-button")).toHaveCount(0);
  await expect(quantityHeader.locator(".pivot-table__sort-button")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("a declared width sizes the field's columns and word-wrap lets its labels wrap", async ({ page }) => {
  const regionWidth = await rowCorner(page, "Bölge").evaluate(cell => cell.style.width);
  expect(regionWidth).toBe("220px");

  const amountHeader = page.locator('#scratchPivot .pivot-table__value-header[data-value-key="Amount_sum"]').first();
  expect(await amountHeader.evaluate(cell => cell.style.width)).toBe("160px");
  await expect(amountHeader).toHaveClass(/is-wrapping/);
  expect(await amountHeader.evaluate(cell => getComputedStyle(cell).whiteSpace)).toBe("normal");

  // Every value cell of the measure takes the width, not only its header.
  const amountColumn = await amountHeader.evaluate(cell => cell.dataset.columnIndex);
  const bodyWidth = await page.locator(`#scratchPivot tbody td[data-column-index="${amountColumn}"]`).first()
    .evaluate(cell => cell.style.width);
  expect(bodyWidth).toBe("160px");

  await expect(page.locator('#scratchPivot tbody th[data-row-level="0"]').first()).toHaveClass(/is-wrapping/);
  expect(page.errors).toEqual([]);
});
