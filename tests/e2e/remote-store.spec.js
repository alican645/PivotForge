const { test, expect } = require("@playwright/test");

// The same layout loaded twice: once through the PivotForge endpoints, where
// the C# engine builds the result, and once from the demo's DataSourceLoader
// endpoint, where the browser builds it from the groups. Both read the same
// 100 generated sales, so every figure, header and total has to agree.
const PAGE = "/Home/TagHelpers";
const LOAD_URL = "/api/sales/load";

const region = { dataField: "Region", area: "row", dataType: "string" };
const category = { dataField: "Category", area: "row", dataType: "string" };
const year = { dataField: "OrderDate", groupInterval: "year", area: "column" };
const quarter = { dataField: "OrderDate", groupInterval: "quarter", area: "column" };
const month = { dataField: "OrderDate", groupInterval: "month", area: "column" };
const amount = { dataField: "Amount", area: "data", aggregation: "sum" };
const average = { dataField: "Amount", area: "data", aggregation: "average" };

const SCENARIOS = [
  ["two row levels by year and month, summed and averaged", [region, category, year, month, amount, average]],
  ["count, min and max by weekday", [{ dataField: "SalesPerson", area: "row" },
    { dataField: "OrderDate", groupInterval: "dayOfWeek", area: "column" },
    { dataField: "Quantity", area: "data", aggregation: "count" },
    { dataField: "Discount", area: "data", aggregation: "min" },
    { dataField: "Amount", area: "data", aggregation: "max" }]],
  ["range grouping", [{ dataField: "Amount", groupInterval: "range", groupSize: 250000, area: "row" },
    { dataField: "Year", area: "column", sortOrder: "Ascending" }, { dataField: "Quantity", area: "data", aggregation: "sum" }]],
  ["filtered to two months by name", [region, month, amount],
    { filters: [{ field: "OrderDate:month", values: ["Ocak", "Mart"] }] }],
  ["a quarter excluded", [region, quarter, amount],
    { filters: [{ field: "OrderDate:quarter", values: ["Q2"], mode: "Exclude" }] }],
  ["a text filter", [region, quarter, amount],
    { filters: [{ field: "Region", values: ["an"], operator: "Contains" }] }],
  ["a running total", [region, category, year, quarter, { ...amount, runningTotal: "row" }]],
  ["rows by a summary", [{ ...region, sortByValueKey: "Amount_sum", sortOrder: "Descending" }, category, year, amount]],
  ["rows by one column's summary", [{ ...region, sortByValueKey: "Amount_sum", sortBySummaryPath: ["2025"] }, year, amount]],
  ["empty rows and columns dropped", [region, category, quarter, amount], { hideEmptySummaryCells: true }]
];

for (const showAs of ["percentOfRowTotal", "percentOfColumnTotal", "percentOfGrandTotal", "differenceFromPrevious",
  "percentDifferenceFromPrevious", "percentOfParentRowTotal", "percentOfParentColumnTotal"]) {
  SCENARIOS.push([`shown as ${showAs}`, [region, category, year, quarter, { ...amount, showAs }]]);
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.errors = errors;
  await page.goto(PAGE);
  await page.waitForSelector(".pivot-table__table td");
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

// Loads the layout both ways and returns each result in a form that compares
// whole: subtotals in a fixed order, figures to twelve significant digits.
async function loadBoth(page, fields, options = {}) {
  return page.evaluate(async ({ fields, options, loadUrl }) => {
    const canonical = result => {
      const byKey = (list, key) => [...list].sort((a, b) => (JSON.stringify(key(a)) < JSON.stringify(key(b)) ? -1 : 1));
      const round = value => (typeof value === "number" ? Number(value.toPrecision(12)) : value);
      const values = map => Object.fromEntries(Object.entries(map ?? {}).sort().map(([key, value]) => [key, round(value)]));
      return {
        rowHeaders: result.rowHeaders,
        columnHeaders: result.columnHeaders,
        cells: result.cells.map(cell => [cell.row, cell.column, values(cell.values)]),
        rowTotals: result.rowTotals.map(total => [total.index, values(total.values)]),
        columnTotals: result.columnTotals.map(total => [total.index, values(total.values)]),
        subtotals: byKey(result.subtotals, subtotal => subtotal.rowHeader).map(subtotal => [subtotal.rowHeader,
          subtotal.cells.map(cell => [cell.column, values(cell.values)]), values(subtotal.totals),
          byKey(subtotal.columnSubtotals, cell => cell.columnHeader).map(cell => [cell.columnHeader, values(cell.values)])]),
        columnSubtotals: result.columnSubtotals.map(subtotal => [subtotal.columnHeader,
          subtotal.cells.map(cell => [cell.index, values(cell.values)]), values(subtotal.totals)]),
        grandTotals: values(result.grandTotals)
      };
    };

    const load = async store => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const widget = PivotForge.create(host, {
        fields, ...options, ...(store ? { store } : {}), autoLoad: false, rendererOptions: { culture: "tr-TR" }
      });
      try {
        await widget.refresh();
        return canonical(widget.result);
      } finally {
        widget.dispose();
        host.remove();
      }
    };

    return { server: await load(null), remote: await load({ type: "remote", loadUrl }) };
  }, { fields, options, loadUrl: LOAD_URL });
}

for (const [name, fields, options] of SCENARIOS) {
  test(`a remote store builds what the engine builds: ${name}`, async ({ page }) => {
    const { server, remote } = await loadBoth(page, fields, options);

    expect(server.cells.length).toBeGreaterThan(0);
    expect(remote).toEqual(server);
  });
}

test("a remote grid never calls the PivotForge endpoints, and its picker and drill-down agree with its cells", async ({ page }) => {
  const pivotCalls = [];
  page.on("request", request => {
    if (request.url().includes("/pivotforge/")) {
      pivotCalls.push(request.url());
    }
  });

  const answers = await page.evaluate(async loadUrl => {
    const fields = [
      { dataField: "Region", area: "row", dataType: "string" },
      { dataField: "OrderDate", groupInterval: "quarter", area: "column" },
      { dataField: "Amount", area: "data", aggregation: "sum" }
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, { fields, autoLoad: false, store: { type: "remote", loadUrl } });
    try {
      await widget.refresh();
      const row = widget.result.rowHeaders.findIndex(header => header[0] === "Ege");
      const column = widget.result.columnHeaders.findIndex(header => header[0] === "Q1");
      const cell = widget.result.cells.find(candidate => candidate.row === row && candidate.column === column);
      const values = await widget.fieldValues("OrderDate:quarter");
      const drill = await widget.drillDown({ rowPath: ["Ege"], columnPath: ["Q1"], valueKey: "Amount_sum" });
      return {
        columns: widget.result.columnHeaders.map(header => header[0]),
        values: values.values,
        cell: cell.values.Amount_sum,
        records: drill.records.length,
        totalCount: drill.totalCount,
        drilled: drill.records.reduce((sum, record) => sum + (record.Amount ?? record.amount), 0)
      };
    } finally {
      widget.dispose();
      host.remove();
    }
  }, LOAD_URL);

  expect(answers.values).toEqual(answers.columns);
  expect(answers.totalCount).toBeGreaterThan(0);
  expect(answers.records).toBe(answers.totalCount);
  expect(answers.drilled).toBeCloseTo(answers.cell, 6);
  expect(pivotCalls).toEqual([]);
});

test("what the protocol cannot carry is refused with a message naming it", async ({ page }) => {
  const messages = await page.evaluate(loadUrl => {
    const store = { type: "remote", loadUrl };
    const attempt = options => {
      try {
        PivotForge.create(document.createElement("div"), { autoLoad: false, store, ...options });
        return null;
      } catch (error) {
        return error.message;
      }
    };

    return [
      attempt({ fields: [{ dataField: "Amount", area: "data", aggregation: "median" }] }),
      attempt({ fields: [{ dataField: "Amount", area: "data" }], largeData: true }),
      attempt({ fields: [{ dataField: "Margin", area: "data", expression: "[Amount] * 0.1" }] })
    ];
  }, LOAD_URL);

  expect(messages[0]).toContain("median");
  expect(messages[1]).toContain("largeData");
  expect(messages[2]).toMatch(/expression|calculated/i);
});
