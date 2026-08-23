const { test, expect } = require("@playwright/test");

// The grouping demo puts quarter and weekday on the column axis — twenty-eight
// combinations that this many records do not all land in — and declares
// hide-empty-summary-cells, so it is where the option is visible end to end.
const PAGE = "/Home/Grouping";

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table tbody tr");
});

// Runs the page's own pivot twice, once with the option and once without, so the
// comparison is against the same data rather than against a number written down.
async function columnCounts(page) {
  return page.evaluate(async () => {
    const declared = [
      { dataField: "OrderDate", caption: "Yıl", area: "row", groupInterval: "year" },
      { dataField: "OrderDate", caption: "Çeyrek", area: "column", groupInterval: "quarter" },
      { dataField: "OrderDate", caption: "Gün", area: "column", groupInterval: "dayOfWeek" },
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
    ];

    // The same slice the page declares: a column product only outgrows its data
    // once something narrows the data, which is when empty columns appear at all.
    const filters = [{ field: "Region", values: ["Ege"] }];

    const run = async extras => {
      const request = PivotForge.PivotRequestBuilder.buildRequest(declared, { filters, ...extras });
      const response = await fetch("/pivotforge/pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, sourceRowCount: 100 })
      });
      const result = await response.json();
      const empty = result.columnHeaders.filter((_, column) =>
        !result.cells.some(cell => cell.column === column &&
          Object.values(cell.values).some(value => value !== null)));

      return { columns: result.columnHeaders.length, empty: empty.length };
    };

    return {
      shown: await run({}),
      hidden: await run({ hideEmptySummaryCells: true })
    };
  });
}

test("the empty combinations of a sparse column product are dropped", async ({ page }) => {
  const { shown, hidden } = await columnCounts(page);

  // The premise: the column axis is a product, so some of its combinations never
  // occurred. Without that this test would prove nothing.
  expect(shown.empty).toBeGreaterThan(0);
  expect(hidden.columns).toBe(shown.columns - shown.empty);
  expect(hidden.empty).toBe(0);
});

test("the drawn table has no column that is empty all the way down", async ({ page }) => {
  const emptyColumns = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".pivot-table tbody tr"));
    const dataCells = rows.map(row => Array.from(row.querySelectorAll("td")));
    const width = Math.max(...dataCells.map(cells => cells.length));
    const empty = [];

    for (let column = 0; column < width; column++) {
      const filled = dataCells.some(cells =>
        cells[column] && cells[column].textContent.trim() !== "" &&
        cells[column].textContent.trim() !== "-");

      if (!filled) {
        empty.push(column);
      }
    }

    return empty;
  });

  expect(emptyColumns).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("the totals still add up to what the grand total says", async ({ page }) => {
  // Dropping columns must not drop values: an empty column contributed nothing,
  // so the grand total is the one number that cannot move.
  const { shown, hidden } = await page.evaluate(async () => {
    const declared = [
      { dataField: "OrderDate", caption: "Yıl", area: "row", groupInterval: "year" },
      { dataField: "OrderDate", caption: "Çeyrek", area: "column", groupInterval: "quarter" },
      { dataField: "OrderDate", caption: "Gün", area: "column", groupInterval: "dayOfWeek" },
      { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
    ];

    const filters = [{ field: "Region", values: ["Ege"] }];

    const total = async extras => {
      const request = PivotForge.PivotRequestBuilder.buildRequest(declared, { filters, ...extras });
      const response = await fetch("/pivotforge/pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, sourceRowCount: 100 })
      });
      return (await response.json()).grandTotals["Amount_sum"];
    };

    return { shown: await total({}), hidden: await total({ hideEmptySummaryCells: true }) };
  });

  expect(hidden).toBe(shown);
  expect(hidden).toBeGreaterThan(0);
});
