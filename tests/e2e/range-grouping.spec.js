const { test, expect } = require("@playwright/test");

// Amount grouped into ranges of 50,000 against the real engine: the demo's
// amounts run from about 18,000 to 156,000, so four ranges, in order, whose
// quantities add up to the grand total -- and the header funnel lists the
// ranges the rows show, spelled the same way.
const PAGE = "/Home/TagHelpers";

test("a numeric field grouped into ranges reads as ordered ranges that add up", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  const outcome = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      fields: [
        { dataField: "Amount", caption: "Tutar aralığı", area: "row", groupInterval: "range", groupSize: 50000 },
        { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }
      ],
      autoLoad: false,
      allowFiltering: true
    });
    await widget.refresh();
    const result = widget.renderer.lastResult;
    const listed = await widget.fieldValues("Amount:range50000");

    return {
      labels: result.rowHeaders.map(header => header[0]),
      totals: result.rowTotals.map(total => total.values.Quantity_sum),
      grandTotal: result.grandTotals.Quantity_sum,
      listed: listed.values
    };
  });

  // Whatever the server culture writes as a thousands separator, the bounds
  // are whole numbers: keep the digits and the sign.
  const bounds = label => label.split(" – ").map(bound => Number(bound.replace(/[^\d-]/g, "")));

  expect(outcome.labels).toHaveLength(4);
  outcome.labels.forEach((label, index) => {
    const [start, end] = bounds(label);
    expect(start).toBe(index * 50000);
    expect(end).toBe(start + 50000);
  });
  expect(outcome.totals.reduce((sum, value) => sum + value, 0)).toBe(outcome.grandTotal);
  // The value list reads the whole source, which can hold more ranges than the
  // grid's page of records; every range the rows show has to be among them,
  // spelled the same way, or a filter picked from the funnel would match nothing.
  for (const label of outcome.labels) {
    expect(outcome.listed).toContain(label);
  }
  expect(errors).toEqual([]);
});

// The designer changes the width: the grid regroups into ranges of the new
// width against the real engine, and the totals still add up.
test("the designer's range width regroups the grid", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async () => {
    const designer = document.createElement("div");
    designer.id = "rangeDesigner";
    const host = document.createElement("div");
    host.id = "rangePivot";
    document.body.append(designer, host);
    window.rangeWidget = PivotForge.create(host, {
      fields: [
        { dataField: "Amount", caption: "Tutar aralığı", area: "row", groupInterval: "range", groupSize: 50000 },
        { dataField: "Quantity", caption: "Miktar", area: "data", aggregation: "sum" }
      ],
      fieldDesigner: "#rangeDesigner",
      autoLoad: false,
      locale: "tr"
    });
    await window.rangeWidget.refresh();
  });
  await page.waitForSelector("#rangePivot .pivot-table__table td");

  await page.locator('#rangeDesigner [data-field="Amount:range50000"] [data-action="settings"]').click();
  await page.locator('[data-action="group-size"]').fill("25000");
  await page.locator('[data-action="group-size-apply"]').click();
  await expect(page.locator('[data-action="group-size-reset"]')).toHaveText("50000 değerine dön");

  await expect.poll(() => page.evaluate(() => window.rangeWidget.result?.rowHeaders.length)).toBeGreaterThan(4);
  const outcome = await page.evaluate(() => {
    const result = window.rangeWidget.result;
    return {
      labels: result.rowHeaders.map(header => header[0]),
      totals: result.rowTotals.map(total => total.values.Quantity_sum),
      grandTotal: result.grandTotals.Quantity_sum,
      binSize: window.rangeWidget.buildRequest().rows[0].binSize
    };
  });

  expect(outcome.binSize).toBe(25000);
  const bounds = label => label.split(" – ").map(bound => Number(bound.replace(/[^\d-]/g, "")));
  for (const label of outcome.labels) {
    const [start, end] = bounds(label);
    expect(end - start).toBe(25000);
    expect(start % 25000).toBe(0);
  }
  expect(outcome.totals.reduce((sum, value) => sum + value, 0)).toBe(outcome.grandTotal);
  expect(errors).toEqual([]);
});
