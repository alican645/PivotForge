const { test, expect } = require("@playwright/test");

// The pivot chart against the real engine's payload. Built into a scratch
// container on the TagHelpers page so the demo grid keeps its look; the
// Grouping page declares one in its markup.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
});

async function build(page, fields, chart, extra = {}) {
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
  await page.evaluate(async ({ fields, chart, extra }) => {
    const host = document.createElement("div");
    host.id = "chartPivot";
    document.body.appendChild(host);
    window.chartWidget = PivotForge.create(host, { fields, chart, autoLoad: false, locale: "tr", ...extra });
    await window.chartWidget.refresh();
  }, { fields, chart, extra });
  await page.waitForSelector("#chartPivot .pivot-table__table td");
}

const AMOUNT = { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" };
const QUANTITY = { dataField: "Quantity", caption: "Adet", area: "data", aggregation: "sum" };

test("one bar per region and year, each the grid's own cell", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Year", caption: "Yıl", area: "column" },
    AMOUNT,
    QUANTITY
  ], "column");

  const expected = await page.evaluate(() => {
    const result = window.chartWidget.result;
    return {
      categories: result.rowHeaders.map(header => header[0]),
      series: result.columnHeaders.map(header => header[0]),
      bars: result.cells.filter(cell => typeof cell.values.Amount_sum === "number").length
    };
  });

  // The chart sits between whatever is above the grid and the grid itself.
  expect(await page.locator("#chartPivot").evaluate(host => host.previousElementSibling.classList.contains("pivot-chart")))
    .toBe(true);
  await expect(page.locator(".pivot-chart__categories text")).toHaveText(expected.categories);
  await expect(page.locator(".pivot-chart__legend-item")).toHaveText(expected.series);
  await expect(page.locator(".pivot-chart__bar")).toHaveCount(expected.bars);
  expect(page.errors).toEqual([]);
});

test("the tooltip shows the grid's text for the focused category", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Year", caption: "Yıl", area: "column" },
    { ...AMOUNT, format: { type: "currency", currency: "TRY", decimals: 0 } }
  ], "column");

  await page.locator(".pivot-chart__scroller").focus();
  await page.keyboard.press("ArrowRight");

  const tooltip = page.locator(".pivot-chart__tooltip");
  await expect(tooltip).toBeVisible();
  const expected = await page.evaluate(() => {
    const widget = window.chartWidget;
    const result = widget.result;
    const definition = widget.valueDefinitions()[0];
    return {
      title: result.rowHeaders[0][0],
      values: result.columnHeaders.map((_, column) => {
        const value = result.cells.find(cell => cell.row === 0 && cell.column === column)?.values.Amount_sum;
        return typeof value === "number"
          ? widget.renderer.formatValue(value, widget.renderer.lastSettings, definition)
          : "–";
      })
    };
  });
  await expect(tooltip.locator(".pivot-chart__tooltip-title")).toHaveText(expected.title);
  await expect(tooltip.locator(".pivot-chart__tooltip-value")).toHaveText(expected.values);

  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  expect(page.errors).toEqual([]);
});

test("nested rows and columns chart the outer groups from the engine's subtotals", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Category", caption: "Kategori", area: "row" },
    { dataField: "Year", caption: "Yıl", area: "column" },
    { dataField: "Quarter", caption: "Çeyrek", area: "column" },
    { ...AMOUNT, aggregation: "average" }
  ], { type: "line" });

  const expected = await page.evaluate(() => {
    const widget = window.chartWidget;
    const result = widget.result;
    const key = widget.valueDefinitions()[0].key;
    const regions = [...new Set(result.rowHeaders.map(header => header[0]))];
    const years = [...new Set(result.columnHeaders.map(header => header[0]))];
    const subtotal = result.subtotals.find(item => item.rowHeader.length === 1 && item.rowHeader[0] === regions[0]);
    const value = subtotal.columnSubtotals.find(item => item.columnHeader.length === 1 && item.columnHeader[0] === years[0]).values[key];
    return {
      regions,
      years,
      first: widget.renderer.formatValue(value, widget.renderer.lastSettings, widget.valueDefinitions()[0])
    };
  });

  await expect(page.locator(".pivot-chart__categories text")).toHaveText(expected.regions);
  await expect(page.locator(".pivot-chart__legend-item")).toHaveText(expected.years);
  await expect(page.locator(".pivot-chart__line")).toHaveCount(expected.years.length);

  await page.locator(".pivot-chart__scroller").focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".pivot-chart__tooltip-value").first()).toHaveText(expected.first);
  expect(page.errors).toEqual([]);
});

test("the reader switches type and value, and the choice is kept with the view", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    AMOUNT,
    QUANTITY
  ], "column");

  await expect(page.locator(".pivot-chart__legend")).toHaveCount(0);
  await page.locator(".pivot-chart__measure").selectOption({ label: "Adet" });
  await page.getByRole("button", { name: "Çubuk" }).click();

  await expect(page.getByRole("button", { name: "Çubuk" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pivot-chart__svg")).toHaveAttribute("aria-label", "Grafik: Adet (Çubuk)");
  expect(await page.evaluate(() => window.chartWidget.snapshotState().chart))
    .toEqual({ type: "bar", valueKey: "Quantity_sum", visible: true });
  expect(page.errors).toEqual([]);
});

test("the Grouping page charts its years by quarter", async ({ page }) => {
  await page.goto("/Home/Grouping");
  await page.waitForSelector(".pivot-chart .pivot-chart__svg");

  // Above the grid it charts.
  expect(await page.locator("#groupingGrid").evaluate(grid => grid.previousElementSibling.classList.contains("pivot-chart")))
    .toBe(true);

  // Years on the outer row level, quarters on the outer column level.
  const categories = await page.locator(".pivot-chart__categories text").allTextContents();
  expect(categories.length).toBeGreaterThan(0);
  expect(categories.every(text => /^\d{4}$/.test(text))).toBe(true);
  await expect(page.locator(".pivot-chart__legend-item")).not.toHaveCount(0);
  await expect(page.locator(".pivot-chart__bar")).not.toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("the toolbar's chart button hides the chart and brings it back, drawn", async ({ page }) => {
  await build(page, [
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Year", caption: "Yıl", area: "column" },
    AMOUNT
  ], { type: "column", visible: false }, { toolbar: ["chart"] });

  const chart = page.locator(".pivot-chart");
  const button = page.locator('[data-toolbar-item="chart"]');
  await expect(chart).toBeHidden();
  await expect(button).toHaveText("Grafik");
  await expect(button).toHaveAttribute("aria-pressed", "false");

  await button.click();
  await expect(chart).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pivot-chart__bar")).not.toHaveCount(0);
  // Drawn at the width it has now, not the width a hidden box reports. Polled:
  // showing the chart resizes its box, and the redraw that follows replaces the
  // svg, so a read that lands in between measures a detached one.
  await expect.poll(() => page.evaluate(() =>
    document.querySelector(".pivot-chart__svg")?.getBoundingClientRect().width ?? 0)).toBeGreaterThan(300);

  await button.click();
  await expect(chart).toBeHidden();
  expect(await page.evaluate(() => window.chartWidget.snapshotState().chart.visible)).toBe(false);
  expect(page.errors).toEqual([]);
});
