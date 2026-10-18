const { test, expect } = require("@playwright/test");

// DevExtreme's runningTotal: "column", set from the designer and computed by
// the engine. Down a column, the last row's running total is the column's total.
test("picking Down columns in the designer makes each column cumulative", async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  await page.evaluate(async () => {
    for (const id of ["runDesigner", "runPivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.prepend(host);
    }
    window.runWidget = PivotForge.create("#runPivot", {
      autoLoad: false,
      fieldDesigner: "#runDesigner",
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await window.runWidget.refresh();
    window.runWidget.designer.openSettings("Amount");
  });

  await page.locator('.pivot-value-settings [data-action="running-total"]', { hasText: "Down columns" }).click();
  await expect.poll(() => page.evaluate(() => window.runWidget.request.values[0].runningTotal)).toBe("Column");

  const check = await page.evaluate(() => {
    const result = window.runWidget.result;
    const last = result.rowHeaders.length - 1;
    return result.columnTotals.map(total => ({
      total: total.values.Amount_sum,
      last: result.cells.find(cell => cell.row === last && cell.column === total.index)?.values.Amount_sum
    }));
  });

  expect(check.length).toBeGreaterThan(0);
  for (const { total, last } of check) {
    expect(last).toBeCloseTo(total, 6);
  }
});
