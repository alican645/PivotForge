const { test, expect } = require("@playwright/test");

// Collapsing column groups: the ▾ on a year folds its quarters into one column
// holding the year's total, the column axis' half of the row groups' toggle.
// Built into a scratch container, as column-subtotals.spec.js is.
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
    document.body.prepend(host);

    window.scratchWidget = PivotForge.create(host, { fields, rendererOptions, autoLoad: false });
    await window.scratchWidget.refresh();
  }, { fields, rendererOptions });

  await page.waitForSelector("#scratchPivot .pivot-table__table td");
}

const scratch = selector => `#scratchPivot ${selector}`;

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

const years = async page =>
  page.evaluate(() => [...new Set(window.scratchWidget.result.columnHeaders.map(header => header[0]))]);

const yearToggle = (page, year) =>
  page.locator(scratch(`.pivot-table__toggle.is-column[aria-label="${year}"]`));

// The text of one column's cells, top to bottom, read by the header that
// starts it: every body row has one cell at that position.
const columnTexts = (page, columnStart) =>
  page.locator(scratch("tbody tr")).evaluateAll((rows, start) =>
    rows.map(row => row.querySelector(`[data-column-index="${start}"]`)?.textContent ?? null), columnStart);

test("every year header carries a column toggle and the quarters none", async ({ page }) => {
  await build(page, FIELDS);

  const yearList = await years(page);
  await expect(page.locator(scratch(".pivot-table__toggle.is-column"))).toHaveCount(yearList.length);
  await expect(yearToggle(page, yearList[0])).toHaveAttribute("aria-expanded", "true");
});

test("collapsing a year leaves one column holding its total", async ({ page }) => {
  await build(page, FIELDS);
  const [year] = await years(page);

  const totalHeader = page.locator(scratch(".pivot-table__column-subtotal-header")).first();
  const totalStart = await totalHeader.getAttribute("data-column-start");
  const totalsBefore = await columnTexts(page, totalStart);
  const columnsBefore = await page.locator(scratch("tbody tr")).first().locator("td").count();
  const quarters = await page.evaluate(year =>
    window.scratchWidget.result.columnHeaders.filter(header => header[0] === year).length, year);

  await yearToggle(page, year).click();

  const folded = page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed"));
  await expect(folded).toHaveCount(1);
  await expect(folded.locator(".pivot-table__sort-label")).toHaveText(year);
  await expect(yearToggle(page, year)).toHaveAttribute("aria-expanded", "false");
  // The quarters and the separate total column became one column.
  expect(await page.locator(scratch("tbody tr")).first().locator("td").count()).toBe(columnsBefore - quarters);
  expect(await columnTexts(page, await folded.getAttribute("data-column-start"))).toEqual(totalsBefore);
  await expectAlignedRows(page);

  await yearToggle(page, year).click();
  await expect(folded).toHaveCount(0);
  expect(await page.locator(scratch("tbody tr")).first().locator("td").count()).toBe(columnsBefore);
  expect(page.errors).toEqual([]);
});

test("a collapsed year keeps its total with column subtotals off", async ({ page }) => {
  await build(page, FIELDS, { columnSubtotals: false });
  const [year] = await years(page);

  await expect(page.locator(scratch(".pivot-table__column-subtotal"))).toHaveCount(0);
  await yearToggle(page, year).click();

  const folded = page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed"));
  await expect(folded).toHaveCount(1);
  await expect(page.locator(scratch(".pivot-table__column-total.pivot-table__column-subtotal"))).not.toHaveText("-");
  await expectAlignedRows(page);
});

test("expanded false on the year field starts every year collapsed", async ({ page }) => {
  await build(page, FIELDS.map(field => field.dataField === "Year" ? { ...field, expanded: false } : field));

  const yearList = await years(page);
  await expect(page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed")))
    .toHaveCount(yearList.length);
  await expectAlignedRows(page);
});

test("the collapsed years are part of the view state", async ({ page }) => {
  await build(page, FIELDS);
  const [year] = await years(page);

  await yearToggle(page, year).click();
  const state = await page.evaluate(() => window.scratchWidget.renderer.getViewState());
  expect(state.collapsedColumnGroups).toEqual([year]);

  await page.evaluate(() => window.scratchWidget.renderer.expandAll({ axis: "column" }));
  await expect(page.locator(scratch(".is-collapsed"))).toHaveCount(0);

  await page.evaluate(state => window.scratchWidget.renderer.applyViewState(state), state);
  await expect(page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed"))).toHaveCount(1);
});

test("collapseAll reaches the columns only when asked", async ({ page }) => {
  await build(page, FIELDS);

  await page.evaluate(() => window.scratchWidget.renderer.collapseAll());
  await expect(page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed"))).toHaveCount(0);

  await page.evaluate(() => window.scratchWidget.renderer.collapseAll({ axis: "all" }));
  await expect(page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed")))
    .toHaveCount((await years(page)).length);
});

test("the collapsed column's arrow sorts the rows by the year's total", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    ...FIELDS.slice(2)
  ]);
  const [year] = await years(page);
  await yearToggle(page, year).click();

  const folded = page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed"));
  await folded.locator(".pivot-table__sort-button").click();
  await page.waitForFunction(() => window.scratchWidget.rowSort?.mode === "RowTotalValue");
  await expect(folded).toHaveCount(1);
  await expect(folded).toHaveAttribute("aria-sort", /ascending|descending/);

  const start = await folded.getAttribute("data-column-start");
  const direction = await folded.getAttribute("aria-sort");
  const numbers = (await columnTexts(page, start))
    .slice(0, -1)
    .map(text => Number(text.replace(/[^\d,-]/g, "").replace(",", ".")));
  const sorted = [...numbers].sort((a, b) => direction === "ascending" ? a - b : b - a);
  expect(numbers).toEqual(sorted);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test("the column toggle folds a year with a tap", async ({ page }) => {
    await build(page, FIELDS);
    const [year] = await years(page);

    await yearToggle(page, year).tap();
    await expect(page.locator(scratch(".pivot-table__column-subtotal-header.is-collapsed"))).toHaveCount(1);
    await expectAlignedRows(page);
  });
});
