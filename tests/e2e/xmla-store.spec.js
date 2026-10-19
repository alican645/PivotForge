const { test, expect } = require("@playwright/test");

// The same layout read twice: through the PivotForge endpoints, where the C#
// engine builds the result, and from the demo's XMLA endpoint, a cube over the
// same 100 sales, where the browser builds it from the cube's cells. Fields
// name the cube's levels and measures; every figure has to agree.
const PAGE = "/Home/TagHelpers";
const STORE = { type: "xmla", url: "/api/xmla", catalog: "PivotForgeDemo", cube: "Sales" };

const engine = {
  region: { dataField: "Region", area: "row", dataType: "string" },
  category: { dataField: "Category", area: "row", dataType: "string" },
  year: { dataField: "OrderDate", groupInterval: "year", area: "column" },
  quarter: { dataField: "OrderDate", groupInterval: "quarter", area: "column" },
  month: { dataField: "OrderDate", groupInterval: "month", area: "column" },
  amount: { dataField: "Amount", area: "data", aggregation: "sum" },
  average: { dataField: "Amount", area: "data", aggregation: "average" }
};

const cube = {
  region: { dataField: "[Region].[Region].[Region]", area: "row" },
  category: { dataField: "[Product].[Category].[Category]", area: "row" },
  year: { dataField: "[Order Date].[Calendar].[Year]", area: "column" },
  quarter: { dataField: "[Order Date].[Calendar].[Quarter]", area: "column" },
  month: { dataField: "[Order Date].[Calendar].[Month]", area: "column" },
  // Every year's quarter or month, as a cube keeps it: an attribute hierarchy.
  quarterOfYear: { dataField: "[Order Date].[Quarter of Year]", area: "column" },
  monthOfYear: { dataField: "[Order Date].[Month of Year]", area: "column" },
  amount: { dataField: "[Measures].[Amount]", area: "data" },
  average: { dataField: "[Measures].[Average Amount]", area: "data" }
};

// [name, engine fields, cube fields, engine options, cube options]
const SCENARIOS = [
  ["two row levels by year and month, summed and averaged",
    [engine.region, engine.category, engine.year, engine.month, engine.amount, engine.average],
    [cube.region, cube.category, cube.year, cube.month, cube.amount, cube.average]],
  ["every year's quarter", [engine.region, engine.quarter, engine.amount], [cube.region, cube.quarterOfYear, cube.amount]],
  ["filtered to two months by name", [engine.region, engine.month, engine.amount], [cube.region, cube.monthOfYear, cube.amount],
    { filters: [{ field: "OrderDate:month", values: ["Ocak", "Mart"] }] },
    { filters: [{ field: "[Order Date].[Month of Year]", values: ["Ocak", "Mart"] }] }],
  ["a quarter excluded", [engine.region, engine.quarter, engine.amount], [cube.region, cube.quarterOfYear, cube.amount],
    { filters: [{ field: "OrderDate:quarter", values: ["Q2"], mode: "Exclude" }] },
    { filters: [{ field: "[Order Date].[Quarter of Year]", values: ["Q2"], mode: "Exclude" }] }],
  ["a text filter", [engine.region, engine.quarter, engine.amount], [cube.region, cube.quarterOfYear, cube.amount],
    { filters: [{ field: "Region", values: ["an"], operator: "Contains" }] },
    { filters: [{ field: "[Region].[Region].[Region]", values: ["an"], operator: "Contains" }] }],
  ["a running total", [engine.region, engine.category, engine.year, engine.quarter, { ...engine.amount, runningTotal: "row" }],
    [cube.region, cube.category, cube.year, cube.quarter, { ...cube.amount, runningTotal: "row" }]],
  ["rows by a summary",
    [{ ...engine.region, sortByValueKey: "Amount_sum", sortOrder: "Descending" }, engine.category, engine.year, engine.amount],
    [{ ...cube.region, sortByValueKey: "[Measures].[Amount]_sum", sortOrder: "Descending" }, cube.category, cube.year, cube.amount]],
  ["empty rows and columns dropped", [engine.region, engine.category, engine.quarter, engine.amount],
    [cube.region, cube.category, cube.quarterOfYear, cube.amount], { hideEmptySummaryCells: true }, { hideEmptySummaryCells: true }]
];

for (const showAs of ["percentOfRowTotal", "percentOfColumnTotal", "percentOfGrandTotal", "differenceFromPrevious",
  "percentDifferenceFromPrevious", "percentOfParentRowTotal", "percentOfParentColumnTotal"]) {
  SCENARIOS.push([`shown as ${showAs}`,
    [engine.region, engine.category, engine.year, engine.quarter, { ...engine.amount, showAs }],
    [cube.region, cube.category, cube.year, cube.quarter, { ...cube.amount, showAs }]]);
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

// Each result with its values read in the order of its measures, since the
// two grids key them differently, and figures to twelve significant digits.
// paging: both grids with largeData, over a thousand sales (the least the
// engine pages), compared page by page at the start, the second page and the end.
async function loadBoth(page, scenario, paging = false) {
  return page.evaluate(async ({ scenario, store, paging }) => {
    const [, engineFields, cubeFields, engineOptions = {}, cubeOptions = {}] = scenario;
    const canonical = (result, keys) => {
      const byKey = (list, key) => [...list].sort((a, b) => (JSON.stringify(key(a)) < JSON.stringify(key(b)) ? -1 : 1));
      const round = value => (typeof value === "number" ? Number(value.toPrecision(12)) : value);
      const values = map => keys.map(key => round(map?.[key] ?? null));
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

    const PAGE_SIZE = 10;
    const load = async (fields, options, withStore) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const paged = paging
        ? { largeData: true, pageSize: PAGE_SIZE, ...(withStore ? {} : { sourceRowCount: 1000 }) }
        : {};
      const widget = PivotForge.create(host, {
        fields, ...options, ...paged, ...(withStore ? { store: paging ? { ...store, url: `${store.url}?count=1000` } : store } : {}),
        autoLoad: false, rendererOptions: { culture: "tr-TR" }
      });
      try {
        await widget.refresh();
        if (widget.error) {
          throw widget.error;
        }

        const keys = widget.request.values.map(value => `${value.field}_${value.aggregation}`);
        if (!paging) {
          return canonical(widget.result, keys);
        }

        const total = widget.totalRowCount;
        const pages = [];
        for (const offset of [...new Set([0, PAGE_SIZE, Math.max(0, total - 3)])]) {
          const loaded = offset === 0 ? widget.currentPage : await widget.loadPage(offset);
          pages.push({ offset, total: loaded.totalRowCount, hasMore: loaded.hasMore, result: canonical(loaded.result, keys) });
        }

        return pages;
      } finally {
        widget.dispose();
        host.remove();
      }
    };

    return { server: await load(engineFields, engineOptions, false), cube: await load(cubeFields, cubeOptions, true) };
  }, { scenario, store: STORE, paging });
}

for (const scenario of SCENARIOS) {
  test(`an XMLA store builds what the engine builds: ${scenario[0]}`, async ({ page }) => {
    const { server, cube: fromCube } = await loadBoth(page, scenario);

    expect(server.cells.length).toBeGreaterThan(0);
    expect(fromCube).toEqual(server);
  });
}

// With largeData the cube orders and slices the rows itself; each page has to
// be the engine's page. A cube has no record order, so a tie is broken by the
// cube's member order, not by which record came first: an order by one
// level's labels alone (rowSort RowLabel) is left out here.
const salesPerson = { engine: { dataField: "SalesPerson", area: "row", dataType: "string" },
  cube: { dataField: "[Sales Person].[Sales Person].[Sales Person]", area: "row" } };
const PAGED_SCENARIOS = [
  ["three row levels by year and quarter",
    [engine.region, engine.category, salesPerson.engine, engine.year, engine.quarter, engine.amount],
    [cube.region, cube.category, salesPerson.cube, cube.year, cube.quarter, cube.amount]],
  ["an outer level descending, an inner one by its labels",
    [{ ...engine.region, sortOrder: "Descending" }, engine.category, { ...salesPerson.engine, sortBy: "displayText", sortOrder: "Descending" }, engine.year, engine.amount],
    [{ ...cube.region, sortOrder: "Descending" }, cube.category, { ...salesPerson.cube, sortBy: "displayText", sortOrder: "Descending" }, cube.year, cube.amount]],
  ["a level by a summary in one column",
    [engine.region, { ...engine.category, sortByValueKey: "Amount_sum", sortBySummaryPath: ["2024"], sortOrder: "Descending" }, salesPerson.engine, engine.year, engine.amount],
    [cube.region, { ...cube.category, sortByValueKey: "[Measures].[Amount]_sum", sortBySummaryPath: ["2024"], sortOrder: "Descending" }, salesPerson.cube, cube.year, cube.amount]],
  ["rows by their totals",
    [engine.region, engine.category, salesPerson.engine, engine.year, engine.amount],
    [cube.region, cube.category, salesPerson.cube, cube.year, cube.amount],
    { rowSort: { mode: "RowTotalValue", valueKey: "Amount_sum", direction: "Descending" } },
    { rowSort: { mode: "RowTotalValue", valueKey: "[Measures].[Amount]_sum", direction: "Descending" } }],
  ["filtered to two months by name", [engine.region, engine.category, salesPerson.engine, engine.month, engine.amount],
    [cube.region, cube.category, salesPerson.cube, cube.monthOfYear, cube.amount],
    { filters: [{ field: "OrderDate:month", values: ["Ocak", "Mart"] }] },
    { filters: [{ field: "[Order Date].[Month of Year]", values: ["Ocak", "Mart"] }] }],
  ["shown as a share of the parent row",
    [engine.region, engine.category, salesPerson.engine, engine.year, { ...engine.amount, showAs: "percentOfParentRowTotal" }],
    [cube.region, cube.category, salesPerson.cube, cube.year, { ...cube.amount, showAs: "percentOfParentRowTotal" }]],
  ["empty columns dropped", [engine.region, engine.category, salesPerson.engine, engine.year, engine.quarter, engine.amount],
    [cube.region, cube.category, salesPerson.cube, cube.year, cube.quarter, cube.amount],
    { hideEmptySummaryCells: true }, { hideEmptySummaryCells: true }]
];

for (const scenario of PAGED_SCENARIOS) {
  test(`a paged XMLA grid reads the engine's pages: ${scenario[0]}`, async ({ page }) => {
    const { server, cube: fromCube } = await loadBoth(page, scenario, true);

    expect(server[0].total).toBeGreaterThan(10);
    expect(fromCube).toEqual(server);
  });
}

test("an XMLA grid never calls the PivotForge endpoints, and its picker and drill-down agree with its cells", async ({ page }) => {
  const pivotCalls = [];
  page.on("request", request => {
    if (request.url().includes("/pivotforge/")) {
      pivotCalls.push(request.url());
    }
  });

  const answers = await page.evaluate(async store => {
    const fields = [
      { dataField: "[Region].[Region].[Region]", area: "row" },
      { dataField: "[Order Date].[Calendar].[Year]", area: "column" },
      { dataField: "[Order Date].[Calendar].[Quarter]", area: "column" },
      { dataField: "[Measures].[Amount]", area: "data" }
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, { fields, autoLoad: false, store, rendererOptions: { culture: "tr-TR" } });
    try {
      await widget.refresh();
      const key = "[Measures].[Amount]_sum";
      const row = widget.result.rowHeaders.findIndex(header => header[0] === "Ege");
      const column = widget.result.columnHeaders.findIndex(header => header[0] === "2024" && header[1] === "Q1");
      const cell = widget.result.cells.find(candidate => candidate.row === row && candidate.column === column);
      const quarters = await widget.fieldValues("[Order Date].[Calendar].[Quarter]");
      const regions = await widget.fieldValues("[Region].[Region].[Region]");
      const drill = await widget.drillDown({ rowPath: ["Ege"], columnPath: ["2024", "Q1"], valueKey: key });
      return {
        rows: widget.result.rowHeaders.map(header => header[0]),
        regions: regions.values,
        quarters: quarters.values.slice(0, 2),
        cell: cell.values[key],
        records: drill.records.length,
        totalCount: drill.totalCount,
        drilled: drill.records.reduce((sum, record) => sum + record.Amount, 0)
      };
    } finally {
      widget.dispose();
      host.remove();
    }
  }, STORE);

  expect(answers.regions).toEqual(answers.rows);
  // Alone in the picker, a quarter is named with its year.
  expect(answers.quarters).toEqual(["Q1 2024", "Q2 2024"]);
  expect(answers.totalCount).toBeGreaterThan(0);
  expect(answers.records).toBe(answers.totalCount);
  expect(answers.drilled).toBeCloseTo(answers.cell, 6);
  expect(pivotCalls).toEqual([]);
});

test("a grid declaring no fields lists the cube's, and what a cube cannot carry is refused", async ({ page }) => {
  const outcome = await page.evaluate(async store => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = PivotForge.create(host, { fields: [], autoLoad: false, store });
    await widget.refresh();
    const discovered = widget.declaredFields.map(field => [field.dataField, field.role, field.groupName ?? null]);
    widget.dispose();
    host.remove();

    const attempt = fields => {
      try {
        PivotForge.create(document.createElement("div"), { autoLoad: false, store, fields });
        return null;
      } catch (error) {
        return error.message;
      }
    };

    return {
      discovered,
      refusals: [
        attempt([{ dataField: "OrderDate", groupInterval: "year", area: "column" }, { dataField: "[Measures].[Amount]", area: "data" }]),
        attempt([{ dataField: "Margin", area: "data", expression: "[Amount] * 0.1" }])
      ]
    };
  }, STORE);

  expect(outcome.discovered).toContainEqual(["[Measures].[Average Amount]", "measure", null]);
  expect(outcome.discovered).toContainEqual(["[Order Date].[Calendar].[Month]", "dimension", "[Order Date].[Calendar]"]);
  expect(outcome.discovered).toContainEqual(["[Region].[Region]", "dimension", null]);
  expect(outcome.refusals[0]).toContain("hierarchy levels");
  expect(outcome.refusals[1]).toContain("calculated member");
});
