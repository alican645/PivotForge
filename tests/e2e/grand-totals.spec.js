const { test, expect } = require("@playwright/test");

// The grand totals in both directions: the row along the bottom and the column
// block on the right, switched grid-wide and per data field. Built into a
// scratch container so the demo's own specs keep the layout they assert on.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Adet", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

async function build(page, fields, rendererOptions = null) {
  await page.evaluate(async ({ fields, rendererOptions }) => {
    document.querySelector("#scratchPivot")?.remove();
    const host = document.createElement("div");
    host.id = "scratchPivot";
    document.body.appendChild(host);

    window.scratchWidget = PivotForge.create(host, { fields, rendererOptions, autoLoad: false });
    await window.scratchWidget.refresh();
  }, { fields, rendererOptions });

  await page.waitForSelector("#scratchPivot .pivot-table__table td");
}

const scratch = selector => `#scratchPivot ${selector}`;

// Every body row, the grand total row included, must be as wide as the head,
// or the columns after the first missing cell slide out from under their
// headers.
async function rowWidths(page) {
  return page.locator(scratch("tr")).evaluateAll(rows => rows
    .filter(row => !row.classList.contains("pivot-table__virtual-spacer"))
    .map(row => [...row.children].reduce((width, cell) => width + cell.colSpan, 0)));
}

async function expectAlignedRows(page) {
  const widths = await rowWidths(page);
  const bodyWidths = await page.locator(scratch("tbody tr")).evaluateAll(rows =>
    rows.map(row => [...row.children].reduce((width, cell) => width + cell.colSpan, 0)));
  expect(new Set(bodyWidths).size).toBe(1);
  expect(Math.max(...widths)).toBe(bodyWidths[0]);
}

// The label only: a sortable header also carries its sort glyph.
const totalHeaders = async page =>
  (await page.locator(scratch(".pivot-table__total-value-header")).allTextContents())
    .map(text => text.replace(/[^\p{L}]/gu, ""));

test("both grand totals are drawn when nothing is declared", async ({ page }) => {
  await build(page, FIELDS);

  expect(await totalHeaders(page)).toEqual(["Tutar", "Adet"]);
  await expect(page.locator(scratch(".pivot-table__grand-total"))).toHaveCount(2);
  await expect(page.locator(scratch(".pivot-table__column-total")).first()).toBeVisible();
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("a data field opting out loses its column on the right and nothing else", async ({ page }) => {
  await build(page, FIELDS.map(field =>
    field.dataField === "Quantity" ? { ...field, showGrandTotals: false } : field));

  expect(await totalHeaders(page)).toEqual(["Tutar"]);
  await expect(page.locator(scratch(".pivot-table__grand-total"))).toHaveCount(1);
  // The bottom row totals the grid's columns, so both values keep their cells in it.
  const columnTotals = await page.locator(scratch(".pivot-table__column-total")).count();
  const yearColumns = await page.locator(scratch("thead .pivot-table__column-header")).count();
  expect(columnTotals).toBe(yearColumns * 2);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("every data field opting out takes the bottom row and the right block away", async ({ page }) => {
  await build(page, FIELDS.map(field =>
    field.area === "data" ? { ...field, showGrandTotals: false } : field));

  await expect(page.locator(scratch(".pivot-table__row-total-label"))).toHaveCount(0);
  await expect(page.locator(scratch(".pivot-table__measure-header"))).toHaveCount(0);
  await expect(page.locator(scratch(".pivot-table__row-total"))).toHaveCount(0);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("the column grand totals can be switched off grid-wide", async ({ page }) => {
  await build(page, FIELDS, { showColumnGrandTotals: false });

  await expect(page.locator(scratch(".pivot-table__measure-header"))).toHaveCount(0);
  await expect(page.locator(scratch(".pivot-table__row-total"))).toHaveCount(0);
  await expect(page.locator(scratch(".pivot-table__grand-total"))).toHaveCount(0);
  // The row along the bottom is the other direction and stays.
  await expect(page.locator(scratch(".pivot-table__row-total-label"))).toHaveCount(1);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("the row grand totals can be switched off grid-wide", async ({ page }) => {
  await build(page, FIELDS, { showGrandTotal: false });

  await expect(page.locator(scratch(".pivot-table__row-total-label"))).toHaveCount(0);
  expect(await totalHeaders(page)).toEqual(["Tutar", "Adet"]);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("a single value's total column goes with its sort header", async ({ page }) => {
  await build(page, [FIELDS[0], FIELDS[1], FIELDS[2]], { showColumnGrandTotals: false });

  await expect(page.locator(scratch(".pivot-table__measure-header"))).toHaveCount(0);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});
