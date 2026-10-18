const { test, expect } = require("@playwright/test");

// Formulas that read another cell, through the real endpoint: the growth on
// the previous year and the same cell last year agree with the plain amounts.
test("Prev and Slice read the previous year, and the designer accepts them", async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  const seen = await page.evaluate(async () => {
    for (const id of ["relDesigner", "relPivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.prepend(host);
    }
    const widget = PivotForge.create("#relPivot", {
      autoLoad: false,
      fieldDesigner: "#relDesigner",
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
        { dataField: "Growth", caption: "Büyüme", area: "data", expression: "([Amount] - Prev([Amount])) / Prev([Amount])" },
        { dataField: "LastYear", caption: "Geçen yıl", area: "data", expression: "Slice([Amount], [Year], -1)" }
      ]
    });
    await widget.refresh();
    const result = widget.result;
    const amount = (row, column) => result.cells.find(cell => cell.row === row && cell.column === column)?.values;

    // The designer's check: a formula moving along [Year], a dimension.
    let accepted = true;
    try {
      widget.layoutState.checkFormula("Slice([Amount], [Year], -1) / GrandTotal([Amount])");
    } catch {
      accepted = false;
    }

    return { columns: result.columnHeaders.map(header => header[0]), first: amount(0, 0), second: amount(0, 1), accepted };
  });

  expect(seen.columns.length).toBeGreaterThan(1);
  // The first year has no previous one.
  expect(seen.first.Growth_calculated).toBeNull();
  expect(seen.first.LastYear_calculated).toBeNull();
  // The second year reads the first.
  expect(seen.second.LastYear_calculated).toBeCloseTo(seen.first.Amount_sum, 6);
  expect(seen.second.Growth_calculated)
    .toBeCloseTo((seen.second.Amount_sum - seen.first.Amount_sum) / seen.first.Amount_sum, 6);
  expect(seen.accepted).toBe(true);
});
