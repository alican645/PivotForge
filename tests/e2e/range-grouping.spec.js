const { test, expect } = require("@playwright/test");

// Amount grouped into ranges of 50,000 against the real engine: the demo's
// amounts run from about 18,000 to 156,000, so four ranges, in order, whose
// quantities add up to the grand total -- and the header funnel lists the
// same ranges the rows show.
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
  expect([...outcome.listed].sort()).toEqual([...outcome.labels].sort());
  expect(errors).toEqual([]);
});
