const { test, expect } = require("@playwright/test");

// DevExtreme's sortBy and sortingMethod through the real endpoint: arrival
// order, alphabetical month names, and a comparer registered in Program.cs.
test("sortBy and a registered sortingMethod order the headers on the server", async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  const headers = await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "sortByPivot";
    document.body.prepend(host);

    const run = async fields => {
      const widget = PivotForge.create(`#${host.id}`, {
        autoLoad: false,
        fields: [...fields, { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }]
      });
      await widget.refresh();
      const result = widget.result;
      widget.destroy?.();
      return { rows: result.rowHeaders.map(header => header[0]), columns: result.columnHeaders.map(header => header[0]) };
    };

    return {
      arrival: (await run([{ dataField: "Region", area: "row", sortBy: "none" }])).rows,
      method: (await run([{ dataField: "Region", area: "column", sortingMethod: "coastalFirst", sortOrder: "Descending" }])).columns,
      months: (await run([{ dataField: "OrderDate", area: "row", groupInterval: "month", sortBy: "displayText" }])).rows
    };
  });

  // The order the sample source yields its regions in, not alphabetical.
  expect(headers.arrival).toEqual(["Marmara", "Ege", "Akdeniz", "İç Anadolu", "Karadeniz", "Doğu Anadolu"]);
  expect(headers.method).toEqual(["Doğu Anadolu", "İç Anadolu", "Akdeniz", "Ege", "Marmara", "Karadeniz"]);
  expect(headers.months).toEqual([...headers.months].sort((a, b) => a.localeCompare(b, "tr")));
  expect(headers.months[0]).not.toBe("Ocak");
});
