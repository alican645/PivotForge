const { test, expect } = require("@playwright/test");

// DevExtreme's selector through the real endpoints: fields worked out on the
// server from the whole record by selectors registered in Program.cs, read the
// same way by the headers, the header filter's value list and drill-down.
test("a registered selector groups, lists and drills down by the value it works out", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  const seen = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      fields: [
        { dataField: "FiscalYear", caption: "Mali yıl", area: "row", selector: "fiscalYear" },
        { dataField: "Size", caption: "Sipariş", area: "column", selector: "orderSize" },
        { dataField: "Year", caption: "Yıl", area: "filter" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();
    const result = widget.result;
    const picker = await widget.fieldValues("Size");
    const fiscal = result.rowHeaders.map(header => header[0]);
    const drill = await widget.drillDown({ rowPath: [fiscal.at(-1)], columnPath: [] });
    const records = drill.records ?? drill;

    return {
      fiscal,
      sizes: result.columnHeaders.map(header => header[0]).sort(),
      picker: picker.values,
      drilled: records.length,
      // October onward belongs to the next fiscal year.
      fiscalOfDrilled: records.every(record => {
        const date = new Date(record.orderDate ?? record.OrderDate);
        return (date.getMonth() >= 9 ? date.getFullYear() + 1 : date.getFullYear()) === Number(fiscal.at(-1));
      })
    };
  });

  // The sample's calendar years are 2024 to 2026, so fiscal years run to 2027.
  expect(seen.fiscal).toEqual(["2024", "2025", "2026", "2027"]);
  expect(seen.sizes).toEqual(["Büyük", "Küçük"]);
  expect([...seen.picker].sort()).toEqual(["Büyük", "Küçük"]);
  expect(seen.drilled).toBeGreaterThan(0);
  expect(seen.fiscalOfDrilled).toBe(true);
  expect(errors).toEqual([]);
});
