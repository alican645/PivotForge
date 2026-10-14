const { test, expect } = require("@playwright/test");

// value-bars against the real engine, built into a scratch container so the
// demo grid keeps its look: every value cell carries a bar, the largest a full
// one, and totals carry none.
const PAGE = "/Home/TagHelpers";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "barsPivot";
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ],
      autoLoad: false,
      rendererOptions: { valueBars: "table" }
    });
    await widget.refresh();
  });
  await page.waitForSelector("#barsPivot .pivot-table__table td");
});

test("each value cell gets a bar measured against the largest value", async ({ page }) => {
  const bars = await page.locator("#barsPivot td.has-value-bar").evaluateAll(cells => cells.map(cell => ({
    end: Number.parseFloat(cell.style.getPropertyValue("--pt-bar-end")),
    image: getComputedStyle(cell).backgroundImage
  })));

  expect(bars.length).toBeGreaterThan(1);
  expect(Math.max(...bars.map(bar => bar.end))).toBe(100);
  expect(bars.every(bar => bar.end > 0 && bar.end <= 100)).toBe(true);
  expect(bars.every(bar => bar.image.includes("linear-gradient"))).toBe(true);

  // Totals and subtotals are not measured.
  await expect(page.locator("#barsPivot td.has-value-bar:not(.pivot-table__value)")).toHaveCount(0);
  expect(page.errors).toEqual([]);
});
