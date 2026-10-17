const { test, expect } = require("@playwright/test");

// A declared dataType reaches the engine with every request that reads the
// column -- the pivot itself and the value picker -- and the server honours it.
test("a declared data type is sent with the pivot and the value list, and the grid draws", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");

  const seen = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      allowFiltering: true,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        // Year is a number in the source; typed as text it lists as text.
        { dataField: "Year", caption: "Yıl", area: "column", dataType: "string" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum", dataType: "number" }
      ]
    });
    await widget.refresh();
    const values = await widget.fieldValues("Year");
    const columns = Array.from(host.querySelectorAll("thead .pivot-table__column-header"))
      .map(cell => cell.textContent.replace(/[↕▲▼]/g, "").trim());
    host.remove();

    return { request: widget.request, values: values.values, columns, error: widget.error?.message ?? null };
  });

  expect(seen.error).toBeNull();
  expect(seen.request.dataTypes).toEqual({ Year: "String", Amount: "Number" });
  expect(seen.values).toEqual(["2024", "2025", "2026"]);
  expect(seen.columns).toContain("2025");
  expect(errors).toEqual([]);
});
