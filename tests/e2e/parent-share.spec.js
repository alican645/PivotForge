const { test, expect } = require("@playwright/test");

// Percent of the parent group, against the real engine: within each region the
// categories' shares of a year add up to the whole region.
test.beforeEach(async ({ page }) => {
  await page.goto("/Home/TagHelpers");
  await page.waitForSelector(".pivot-table__table td");
});

test("each region's categories share it out between them, in every column", async ({ page }) => {
  const shares = await page.evaluate(async () => {
    const host = document.createElement("div");
    document.body.prepend(host);
    const widget = PivotForge.create(host, {
      autoLoad: false,
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Category", caption: "Kategori", area: "row" },
        { dataField: "Year", caption: "Yıl", area: "column" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum", showAs: "percentOfParentRowTotal" }
      ]
    });
    await widget.refresh();
    const result = widget.result;
    const sums = {};
    for (const cell of result.cells) {
      const region = result.rowHeaders[cell.row][0];
      const key = `${region}|${cell.column}`;
      sums[key] = (sums[key] ?? 0) + (cell.values.Amount_sum ?? 0);
    }
    // And the region rows themselves are shares of the column's grand total.
    const regionShares = {};
    for (const subtotal of result.subtotals) {
      for (const cell of subtotal.cells) {
        regionShares[cell.column] = (regionShares[cell.column] ?? 0) + (cell.values.Amount_sum ?? 0);
      }
    }
    const firstText = host.querySelector("td.pivot-table__value:not(.is-empty)")?.textContent ?? "";
    host.remove();
    return { sums: Object.values(sums), regionShares: Object.values(regionShares), firstText };
  });

  for (const sum of [...shares.sums, ...shares.regionShares]) {
    expect(sum).toBeCloseTo(1, 6);
  }
  // Drawn as a percentage.
  expect(shares.firstText).toMatch(/%/);
});

test("the designer offers both parent shares", async ({ page }) => {
  const labels = await page.evaluate(async () => {
    for (const id of ["shareDesigner", "sharePivot"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.prepend(host);
    }
    const widget = PivotForge.create("#sharePivot", {
      autoLoad: false,
      fieldDesigner: "#shareDesigner",
      fields: [
        { dataField: "Region", caption: "Bölge", area: "row" },
        { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
      ]
    });
    await widget.refresh();
    widget.designer.openSettings("Amount");
    return [...document.querySelectorAll(".pivot-value-settings [data-action]")].map(node => node.textContent.trim());
  });

  expect(labels).toContain("% of parent row total");
  expect(labels).toContain("% of parent column total");
});
