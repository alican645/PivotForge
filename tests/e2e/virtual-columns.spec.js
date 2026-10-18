const { test, expect } = require("@playwright/test");

// Virtual columns: a pivot with a column per order date draws only a window
// of them, a spacer either side keeping the table its full width.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "OrderDate", caption: "Tarih", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

async function build(page, rendererOptions = {}, extra = {}) {
  await page.evaluate(async ({ fields, rendererOptions, extra }) => {
    document.querySelector("#virtualHost")?.remove();
    const host = document.createElement("div");
    host.id = "virtualHost";
    host.style.width = "800px";
    document.body.prepend(host);
    window.virtualWidget = PivotForge.create(host, { fields, rendererOptions, autoLoad: false, allowExcelExport: true, ...extra });
    await window.virtualWidget.refresh();
  }, { fields: FIELDS, rendererOptions, extra });
  await page.waitForSelector("#virtualHost .pivot-table__table td");
}

const cellsInFirstRow = page => page.locator("#virtualHost tbody tr").first().locator("td[data-selection-target='cell']").count();
const columnCount = page => page.evaluate(() => window.virtualWidget.result.columnHeaders.length);

test("only a window of the columns is drawn, and the table keeps its full width", async ({ page }) => {
  await build(page);
  const total = await columnCount(page);
  const full = await cellsInFirstRow(page);
  const firstValues = await page.locator("#virtualHost tbody tr").first().locator("td.pivot-table__value").evaluateAll(
    cells => cells.slice(0, 3).map(cell => cell.textContent));
  expect(total).toBeGreaterThanOrEqual(100);

  await build(page, { virtualColumns: true });
  const drawn = await cellsInFirstRow(page);
  expect(drawn).toBeLessThan(full / 4);

  // As wide as the whole table, within a column's width: the spacers stand in
  // for the columns at the width the drawn ones came out.
  const fullWidth = await page.evaluate(async fields => {
    const host = document.createElement("div");
    host.style.width = "800px";
    document.body.prepend(host);
    const widget = PivotForge.create(host, { fields, autoLoad: false });
    await widget.refresh();
    const width = host.scrollWidth;
    widget.dispose();
    host.remove();
    return width;
  }, FIELDS);
  const scrollWidth = await page.evaluate(() => document.querySelector("#virtualHost").scrollWidth);
  expect(Math.abs(scrollWidth - fullWidth) / fullWidth).toBeLessThan(0.05);

  // The first columns read the same as the whole table does.
  expect(await page.locator("#virtualHost tbody tr").first().locator("td.pivot-table__value").evaluateAll(
    cells => cells.slice(0, 3).map(cell => cell.textContent))).toEqual(firstValues);
  expect(page.errors).toEqual([]);
});

test("scrolling to the far end draws the last column", async ({ page }) => {
  await build(page);
  const lastHeader = await page.locator("#virtualHost thead .pivot-table__column-header").last().textContent();

  await build(page, { virtualColumns: true });
  await page.evaluate(() => {
    const host = document.querySelector("#virtualHost");
    host.scrollLeft = host.scrollWidth;
  });
  await expect(page.locator("#virtualHost thead .pivot-table__column-header").last()).toHaveText(lastHeader);
  // Every row is as wide as the head: the spacers line up.
  const widths = await page.locator("#virtualHost table").evaluate(table => [...table.tBodies[0].rows]
    .map(row => [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0)));
  expect(new Set(widths).size).toBe(1);
  expect(page.errors).toEqual([]);
});

test("the arrow key walks past the window's edge", async ({ page }) => {
  await build(page, { virtualColumns: true });
  const first = page.locator("#virtualHost tbody tr").first().locator("td.pivot-table__value").first();
  const start = Number(await first.getAttribute("data-column-index"));
  const drawn = await cellsInFirstRow(page);

  await first.click();
  // Far enough to cross the window's edge more than once.
  for (let step = 0; step < drawn + 10; step++) {
    await page.keyboard.press("ArrowRight");
  }

  await expect.poll(() => page.evaluate(() => Number(document.activeElement.dataset.columnIndex)))
    .toBe(start + drawn + 10);
  // The cell reached is the selected one, and it is in view.
  const focused = await page.evaluate(() => {
    const host = document.querySelector("#virtualHost").getBoundingClientRect();
    const cell = document.activeElement.getBoundingClientRect();
    return { selected: document.activeElement.classList.contains("is-cell-selected"), inView: cell.left >= host.left && cell.right <= host.right };
  });
  expect(focused).toEqual({ selected: true, inView: true });
  expect(page.errors).toEqual([]);
});

test("an export holds every column, and the values-on-rows layout stays aligned", async ({ page }) => {
  await build(page, { virtualColumns: true });
  const total = await columnCount(page);
  const model = await page.evaluate(() => window.virtualWidget.renderer.getExcelExportModel({}));
  const dataCells = model.rows[model.headerRowCount].cells.filter(cell => cell.role === "Value");
  expect(dataCells.length).toBe(total);

  await page.evaluate(async fields => {
    document.querySelector("#virtualHost")?.remove();
    const host = document.createElement("div");
    host.id = "virtualHost";
    host.style.width = "800px";
    document.body.prepend(host);
    window.virtualWidget = PivotForge.create(host, {
      autoLoad: false,
      rendererOptions: { virtualColumns: true, valuesPosition: "rows" },
      fields: [...fields, { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }]
    });
    await window.virtualWidget.refresh();
  }, FIELDS);
  await page.waitForSelector("#virtualHost .pivot-table__measure-row-header");
  const occupied = await page.locator("#virtualHost table").evaluate(table => {
    const taken = [];
    return [...table.tBodies[0].rows].map((row, rowIndex) => {
      let width = 0;
      while (taken[rowIndex]?.[width]) width++;
      for (const cell of row.cells) {
        for (let down = 1; down < cell.rowSpan; down++) {
          taken[rowIndex + down] ??= [];
          for (let across = 0; across < cell.colSpan; across++) taken[rowIndex + down][width + across] = true;
        }
        width += cell.colSpan;
        while (taken[rowIndex]?.[width]) width++;
      }
      return width;
    });
  });
  expect(new Set(occupied).size).toBe(1);
  expect(page.errors).toEqual([]);
});

test("undeclared, every column is drawn as before", async ({ page }) => {
  await build(page);
  const total = await columnCount(page);
  expect(await cellsInFirstRow(page)).toBe(total + 1);
  await expect(page.locator("#virtualHost .pivot-table__virtual-column")).toHaveCount(0);
});
