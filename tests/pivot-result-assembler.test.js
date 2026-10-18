const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
const RemoteStore = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-remote-store.js");
const PivotRequestBuilder = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
const { createLoader } = require("./helpers/fake-data-source-loader.js");

// What PivotEngine does after summing, done in the browser: display modes,
// running totals, ordering by value and dropping empty rows, checked on a grid
// small enough to work out by hand.
//
//            Q1    Q2   total
//   Ege      10    30     40
//   Marmara  20     -     20
//   total    30    30     60
const records = [
  { Region: "Ege", OrderDate: "2024-01-10T00:00:00", Amount: 10 },
  { Region: "Ege", OrderDate: "2024-05-10T00:00:00", Amount: 30 },
  { Region: "Marmara", OrderDate: "2024-02-10T00:00:00", Amount: 20 }
];

const region = { dataField: "Region", area: "row", dataType: "string" };
const quarter = { dataField: "OrderDate", groupInterval: "quarter", area: "column" };

async function assemble(amount, extras = {}, rows = region) {
  const store = RemoteStore.create({ type: "remote", load: createLoader(records).load });
  return store.pivot(PivotRequestBuilder.buildRequest([rows, quarter, { dataField: "Amount", area: "data", ...amount }], extras),
    { culture: "tr-TR" });
}

const cellsOf = result => result.cells.map(cell => [cell.row, cell.column, cell.values.Amount_sum]);

test("percentOfRowTotal divides by the row, and a row total is a whole row", async () => {
  const result = await assemble({ showAs: "percentOfRowTotal" });

  assert.deepEqual(cellsOf(result), [[0, 0, 0.25], [0, 1, 0.75], [1, 0, 1]]);
  assert.deepEqual(result.rowTotals.map(total => total.values.Amount_sum), [1, 1]);
  assert.deepEqual(result.columnTotals.map(total => total.values.Amount_sum), [0.5, 0.5]);
  assert.deepEqual(result.grandTotals, { Amount_sum: 1 });
});

test("differenceFromPrevious compares with the column before, and a total has nothing before it", async () => {
  const result = await assemble({ showAs: "differenceFromPrevious" });

  assert.deepEqual(cellsOf(result), [[0, 0, null], [0, 1, 20], [1, 0, null]]);
  assert.deepEqual(result.rowTotals.map(total => total.values.Amount_sum), [null, null]);
  assert.deepEqual(result.columnTotals.map(total => total.values.Amount_sum), [null, 0]);
});

test("a running total along the row carries into the empty cell", async () => {
  const result = await assemble({ runningTotal: "row" });

  assert.deepEqual(cellsOf(result), [[0, 0, 10], [0, 1, 40], [1, 0, 20], [1, 1, 20]]);
  assert.deepEqual(result.columnTotals.map(total => total.values.Amount_sum), [30, 60]);
});

test("rows ordered by a summary, and by a summary where they cross one column", async () => {
  const byTotal = await assemble({}, {}, { ...region, sortByValueKey: "Amount_sum", sortOrder: "Ascending" });
  assert.deepEqual(byTotal.rowHeaders, [["Marmara"], ["Ege"]]);

  const byQ1 = await assemble({}, {}, { ...region, sortByValueKey: "Amount_sum", sortBySummaryPath: ["Q1"], sortOrder: "Descending" });
  assert.deepEqual(byQ1.rowHeaders, [["Marmara"], ["Ege"]]);
  assert.deepEqual(byQ1.rowTotals.map(total => total.values.Amount_sum), [20, 40]);
});

test("hideEmptySummaryCells drops a column no row has a value in", async () => {
  const store = RemoteStore.create({ type: "remote", load: createLoader(records).load });
  const year = { dataField: "OrderDate", groupInterval: "year", area: "column" };
  const request = PivotRequestBuilder.buildRequest([region, year, quarter, { dataField: "Amount", area: "data" }],
    { hideEmptySummaryCells: true });

  const result = await store.pivot(request, { culture: "tr-TR" });

  // Every combination of the levels is a column, until the empty ones go.
  assert.deepEqual(result.columnHeaders, [["2024", "Q1"], ["2024", "Q2"]]);
});

test("a descending level runs backwards inside its parent", async () => {
  const result = await assemble({}, {}, { ...region, sortOrder: "Descending" });

  assert.deepEqual(result.rowHeaders, [["Marmara"], ["Ege"]]);
  assert.deepEqual(cellsOf(result), [[0, 0, 20], [1, 0, 10], [1, 1, 30]]);
});
