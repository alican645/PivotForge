const { test, expect } = require("@playwright/test");

// Subtotal columns: a total column after each group of an outer column field,
// the column axis' half of the subtotal rows. Built into a scratch container so
// the demo's own specs keep the layout they assert on.
const PAGE = "/Home/TagHelpers";

const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Quarter", caption: "Çeyrek", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
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

// Every row, head and body, must be as wide as the others, or the columns after
// the first missing cell slide out from under their headers. A head row's width
// counts the cells that reach down into it from the rows above.
async function expectAlignedRows(page) {
  const widths = await page.locator(scratch("table")).evaluate(table => {
    const occupied = [];
    return [...table.rows]
      .filter(row => !row.classList.contains("pivot-table__virtual-spacer"))
      .map((row, rowIndex) => {
        let width = 0;
        while (occupied[rowIndex]?.[width]) width++;
        for (const cell of row.children) {
          for (let down = 1; down < cell.rowSpan; down++) {
            occupied[rowIndex + down] ??= [];
            for (let across = 0; across < cell.colSpan; across++) occupied[rowIndex + down][width + across] = true;
          }
          width += cell.colSpan;
          while (occupied[rowIndex]?.[width]) width++;
        }
        return width;
      });
  });
  expect(new Set(widths).size).toBe(1);
}

// The label alone: with a single value the header also carries a sort arrow.
const subtotalHeaders = async page =>
  page.locator(scratch(".pivot-table__column-subtotal-header")).evaluateAll(cells =>
    cells.map(cell => (cell.querySelector(".pivot-table__sort-label") ?? cell).textContent));

const years = async page =>
  page.evaluate(() => [...new Set(window.scratchWidget.result.columnHeaders.map(header => header[0]))]);

const number = text => Number(text.replace(/[^\d,-]/g, "").replace(",", "."));

test("each year closes with its own total column", async ({ page }) => {
  await build(page, FIELDS);

  const expected = (await years(page)).map(year => `${year} Total`);
  expect(expected.length).toBeGreaterThan(1);
  expect((await subtotalHeaders(page)).map(text => text.trim())).toEqual(expected);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("a subtotal cell sums its year's quarters in the same row", async ({ page }) => {
  await build(page, FIELDS);

  const sums = await page.locator(scratch("tbody tr.pivot-table__detail-row")).first().evaluate(row => {
    const cells = [...row.querySelectorAll("td")];
    const groups = [];
    let current = [];
    for (const cell of cells) {
      if (cell.classList.contains("pivot-table__row-total")) break;
      if (cell.classList.contains("pivot-table__column-subtotal")) {
        groups.push({ parts: current.map(part => part.textContent), total: cell.textContent });
        current = [];
      } else {
        current.push(cell);
      }
    }
    return groups;
  });

  expect(sums.length).toBeGreaterThan(0);
  for (const { parts, total } of sums) {
    const added = parts.map(number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    expect(number(total)).toBeCloseTo(added, 0);
  }
});

test("the grand total row and the subtotal rows carry the subtotal columns too", async ({ page }) => {
  await build(page, FIELDS);

  const yearCount = (await years(page)).length;
  await expect(page.locator(scratch(".pivot-table__subtotal-row .pivot-table__column-subtotal")).first())
    .not.toHaveText("-");
  await expect(page.locator(scratch(".pivot-table__column-total.pivot-table__column-subtotal")))
    .toHaveCount(yearCount);
});

test("column-subtotals off draws the quarters alone", async ({ page }) => {
  await build(page, FIELDS, { columnSubtotals: false });

  await expect(page.locator(scratch(".pivot-table__column-subtotal-header"))).toHaveCount(0);
  await expect(page.locator(scratch(".pivot-table__column-subtotal"))).toHaveCount(0);
  await expectAlignedRows(page);
});

test("a column field opting out of its totals loses only its own level", async ({ page }) => {
  await build(page, [
    ...FIELDS.slice(0, 2),
    { dataField: "Region", caption: "Bölge", area: "column" },
    ...FIELDS.slice(2)
  ].filter((field, index) => index !== 0).map(field =>
    field.dataField === "Region" ? { ...field, showTotals: false } : field));

  // Region > Year > Quarter: Region opted out, Year still closes each region's years.
  const headers = await subtotalHeaders(page);
  expect(headers.length).toBeGreaterThan(0);
  const regions = await page.evaluate(() =>
    [...new Set(window.scratchWidget.result.columnHeaders.map(header => header[0]))]);
  const labels = new Set(headers.map(header => header.replace(/ Total$/, "").trim()));
  expect(regions.some(region => labels.has(region))).toBe(false);
  // One per year inside each region.
  const yearGroups = await page.evaluate(() =>
    new Set(window.scratchWidget.result.columnHeaders.map(header => `${header[0]}|${header[1]}`)).size);
  expect(headers).toHaveLength(yearGroups);
  await expectAlignedRows(page);
  expect(page.errors).toEqual([]);
});

test("several values each get a cell in the subtotal column", async ({ page }) => {
  await build(page, [...FIELDS, { dataField: "Quantity", caption: "Adet", area: "data", aggregation: "sum" }]);

  const yearCount = (await years(page)).length;
  await expect(page.locator(scratch(".pivot-table__column-subtotal-value-header"))).toHaveCount(yearCount * 2);
  await expectAlignedRows(page);
});

test("double-clicking a subtotal cell drills into the whole year", async ({ page }) => {
  await build(page, FIELDS);

  const selection = await page.evaluate(() => new Promise(resolve => {
    window.scratchWidget.on("cellDoubleClick", resolve);
    const cell = document.querySelector("#scratchPivot tbody .pivot-table__detail-row .pivot-table__column-subtotal:not(.is-empty)");
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }));

  expect(selection.columnKind).toBe("columnSubtotal");
  expect(selection.columnHeader).toHaveLength(1);
});
