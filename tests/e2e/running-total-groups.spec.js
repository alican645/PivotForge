const { test, expect } = require("@playwright/test");

// allowCrossGroupCalculation on a running total, against the real engine: on,
// the total carries from one year into the next; off, it starts again with
// each year's first quarter.
const PAGE = "/Home/TagHelpers";

async function runningTotals(page, allowCrossGroupCalculation) {
  return page.evaluate(async allow => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const field = showAs => ({
      dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum", showAs,
      ...(showAs === "runningTotal" ? { allowCrossGroupCalculation: allow } : {})
    });
    const run = async showAs => {
      const widget = PivotForge.create(host, {
        fields: [
          { dataField: "Region", caption: "Bölge", area: "row" },
          { dataField: "Year", caption: "Yıl", area: "column" },
          { dataField: "Quarter", caption: "Çeyrek", area: "column" },
          field(showAs)
        ],
        autoLoad: false
      });
      await widget.refresh();
      const result = widget.renderer.lastResult;
      widget.dispose?.();
      return result;
    };

    return { raw: await run("normal"), running: await run("runningTotal") };
  }, allowCrossGroupCalculation);
}

// The cell of the first row at the first column of the second year.
function secondYearStart(result) {
  const headers = result.columnHeaders;
  const column = headers.findIndex((header, index) => index > 0 && header[0] !== headers[index - 1][0]);
  const cell = result.cells.find(entry => entry.row === 0 && entry.column === column);
  return { column, value: cell?.values.Amount_sum ?? null };
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

test("off, the running total starts afresh in each year; on, it carries over", async ({ page }) => {
  const within = await runningTotals(page, false);
  const across = await runningTotals(page, true);

  const raw = secondYearStart(within.raw);
  expect(raw.column).toBeGreaterThan(0);

  // Starting afresh, the year's first quarter is that quarter alone.
  expect(secondYearStart(within.running).value).toBe(raw.value);
  // Carried over, it also holds every quarter before it.
  const before = within.raw.cells
    .filter(entry => entry.row === 0 && entry.column < raw.column)
    .reduce((sum, entry) => sum + (entry.values.Amount_sum ?? 0), 0);
  expect(before).toBeGreaterThan(0);
  expect(secondYearStart(across.running).value).toBeCloseTo((raw.value ?? 0) + before, 2);
});
