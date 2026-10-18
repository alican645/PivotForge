const { test, expect } = require("@playwright/test");

// DevExtreme's bindChart, on a grid built into a scratch container of the demo
// page. The chart is a stand-in with dxChart's option() method: what it is
// given is the contract, how it draws is the chart library's business.
const FIELDS = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
  await page.evaluate(async fields => {
    const host = document.createElement("div");
    host.id = "chartHost";
    document.body.prepend(host);
    window.boundChart = { written: [], option(config) { this.written.push(config); } };
    window.chartWidget = PivotForge.create(host, { fields, autoLoad: false });
    window.unbindChart = window.chartWidget.bindChart(window.boundChart);
    await window.chartWidget.refresh();
  }, FIELDS);
  await page.waitForSelector("#chartHost .pivot-table__table td");
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

const lastWrite = page => page.evaluate(() => {
  const config = window.boundChart.written.at(-1);
  return {
    count: window.boundChart.written.length,
    series: [...new Set(config.dataSource.map(item => item.series))],
    args: [...new Set(config.dataSource.map(item => item.arg))],
    items: config.dataSource.length,
    nameField: config.seriesTemplate.nameField
  };
});

test("the bound chart is given the deepest rows and columns the grid shows", async ({ page }) => {
  const written = await lastWrite(page);
  expect(written.count).toBeGreaterThan(0);
  expect(written.nameField).toBe("series");
  // Region - Category on the series, the years on the arguments.
  expect(written.series.length).toBeGreaterThan(1);
  expect(written.series.every(name => name.includes(" - "))).toBe(true);
  expect(written.args.every(arg => /^\d{4}$/.test(arg))).toBe(true);

  // The values are the grid's: the first item matches its cell.
  const firstItem = await page.evaluate(() => window.boundChart.written.at(-1).dataSource[0]);
  expect(typeof firstItem.val).toBe("number");
});

test("folding a region rewrites the chart without that region's categories", async ({ page }) => {
  const before = await lastWrite(page);
  const region = before.series[0].split(" - ")[0];

  await page.locator(`#chartHost .pivot-table__toggle[data-subtotal-key="${region}"]`).click();

  await expect.poll(async () => (await lastWrite(page)).count).toBeGreaterThan(before.count);
  const after = await lastWrite(page);
  expect(after.series.some(name => name.startsWith(`${region} - `))).toBe(false);
  expect(after.series.length).toBeGreaterThan(0);
});

test("a filter redraws the grid and the chart with it; unbinding stops the writes", async ({ page }) => {
  const before = await lastWrite(page);
  const region = before.series[0].split(" - ")[0];

  await page.evaluate(region => window.chartWidget.setFilter("Region", [region]), region);
  await expect.poll(async () => (await lastWrite(page)).series.every(name => name.startsWith(`${region} - `)))
    .toBe(true);

  const count = (await lastWrite(page)).count;
  await page.evaluate(async () => {
    window.unbindChart();
    await window.chartWidget.refresh();
  });
  expect((await lastWrite(page)).count).toBe(count);
});
