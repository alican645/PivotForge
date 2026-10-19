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

test("a page keeps its rows as they came and the columns the whole result has", () => {
  const Assembler = globalThis.PivotForge.ResultAssembler;
  const request = PivotRequestBuilder.buildRequest([
    { ...region, sortOrder: "Ascending" },
    { dataField: "Quarter", area: "column" },
    { dataField: "Amount", area: "data" }
  ], { hideEmptySummaryCells: true });
  const builder = Assembler.createScan(1, 1, ["Amount_sum"]);
  // Q3 holds values only in rows on other pages; Q2 holds none anywhere.
  builder.observeColumn(["Q1"]);
  builder.observeColumn(["Q3"]);
  builder.place(["Marmara"], ["Q1"], { Amount_sum: 20 });
  builder.place(["Ege"], ["Q1"], { Amount_sum: 10 });
  builder.place(["Marmara"], [], { Amount_sum: 20 });
  builder.place(["Ege"], [], { Amount_sum: 10 });
  builder.place([], ["Q1"], { Amount_sum: 30 });
  builder.place([], ["Q3"], { Amount_sum: 5 });
  builder.place([], [], { Amount_sum: 35 });
  builder.scan.sourceRowCount = 2;
  const scan = builder.finish();

  const page = Assembler.assemble(scan, request, { culture: "tr-TR", paged: true });

  assert.deepEqual(page.rowHeaders, [["Marmara"], ["Ege"]]);
  assert.deepEqual(page.columnHeaders, [["Q1"], ["Q3"]]);
  assert.deepEqual(page.rowTotals.map(total => total.values.Amount_sum), [20, 10]);
  assert.deepEqual(page.columnTotals.map(total => total.values.Amount_sum), [30, 5]);

  // Unpaged, the same buckets are ordered, and Q3 empties out on these rows.
  const whole = Assembler.assemble(scan, request, { culture: "tr-TR" });
  assert.deepEqual(whole.rowHeaders, [["Ege"], ["Marmara"]]);
  assert.deepEqual(whole.columnHeaders, [["Q1"]]);
});

test("a row group whose children were not loaded is a stub ordered among its siblings", () => {
  const Assembler = globalThis.PivotForge.ResultAssembler;
  const request = PivotRequestBuilder.buildRequest([
    { ...region, sortOrder: "Descending", expanded: false },
    { dataField: "City", area: "row", sortOrder: "Ascending" },
    { dataField: "Quarter", area: "column" },
    { dataField: "Amount", area: "data" }
  ], { hideEmptySummaryCells: true });
  const builder = Assembler.createScan(2, 1, ["Amount_sum"]);
  // Ege was opened; Marmara was not, so only its totals arrived.
  builder.observeColumn(["Q1"]);
  builder.observeColumn(["Q2"]);
  builder.place(["Ege", "Izmir"], ["Q1"], { Amount_sum: 10 });
  builder.place(["Ege", "Aydin"], ["Q2"], { Amount_sum: 30 });
  builder.place(["Ege", "Izmir"], [], { Amount_sum: 10 });
  builder.place(["Ege", "Aydin"], [], { Amount_sum: 30 });
  builder.place(["Ege"], ["Q1"], { Amount_sum: 10 });
  builder.place(["Ege"], ["Q2"], { Amount_sum: 30 });
  builder.place(["Ege"], [], { Amount_sum: 40 });
  builder.place(["Marmara"], ["Q1"], { Amount_sum: 20 });
  builder.place(["Marmara"], [], { Amount_sum: 20 });
  builder.place([], ["Q1"], { Amount_sum: 30 });
  builder.place([], ["Q2"], { Amount_sum: 30 });
  builder.place([], [], { Amount_sum: 60 });
  builder.scan.sourceRowCount = 9;
  const scan = builder.finish();

  const result = Assembler.assemble(scan, request, { culture: "tr-TR", branches: true });

  assert.deepEqual(result.rowHeaders, [["Marmara"], ["Ege", "Aydin"], ["Ege", "Izmir"]]);
  assert.deepEqual(result.columnHeaders, [["Q1"], ["Q2"]]);
  assert.deepEqual(result.rowTotals.map(total => total.values.Amount_sum), [20, 30, 10]);
  assert.deepEqual(cellsOf(result), [[1, 1, 30], [2, 0, 10]]);
  const marmara = result.subtotals.find(subtotal => subtotal.rowHeader[0] === "Marmara");
  assert.deepEqual(marmara.cells.map(cell => [cell.column, cell.values.Amount_sum]), [[0, 20]]);
  assert.equal(result.metadata.rowDepth, 2);
  assert.equal(result.metadata.columnDepth, 1);

  // By the summary, the stub's total is its group's.
  const bySum = PivotRequestBuilder.buildRequest([
    { ...region, sortByValueKey: "Amount_sum", sortOrder: "Ascending", expanded: false },
    { dataField: "City", area: "row" },
    { dataField: "Quarter", area: "column" },
    { dataField: "Amount", area: "data" }
  ]);
  assert.deepEqual(Assembler.assemble(scan, bySum, { culture: "tr-TR", branches: true }).rowHeaders.map(header => header[0]),
    ["Marmara", "Ege", "Ege"]);
});

test("a column group whose children were not loaded is a stub, and nothing is crossed below it", () => {
  const Assembler = globalThis.PivotForge.ResultAssembler;
  const request = PivotRequestBuilder.buildRequest([
    region,
    { dataField: "Year", area: "column", sortOrder: "Ascending", expanded: false },
    { dataField: "Quarter", area: "column" },
    { dataField: "Amount", area: "data" }
  ]);
  const builder = Assembler.createScan(1, 2, ["Amount_sum"]);
  builder.observeRow(["Ege"]);
  builder.observeRow(["Marmara"]);
  builder.place(["Ege"], ["2024", "Q1"], { Amount_sum: 10 });
  builder.place(["Marmara"], ["2024", "Q2"], { Amount_sum: 30 });
  builder.place(["Ege"], ["2023"], { Amount_sum: 5 });
  builder.place(["Ege"], ["2024"], { Amount_sum: 10 });
  builder.place(["Marmara"], ["2024"], { Amount_sum: 30 });
  builder.place(["Ege"], [], { Amount_sum: 15 });
  builder.place(["Marmara"], [], { Amount_sum: 30 });
  builder.place([], ["2024", "Q1"], { Amount_sum: 10 });
  builder.place([], ["2024", "Q2"], { Amount_sum: 30 });
  builder.place([], ["2023"], { Amount_sum: 5 });
  builder.place([], ["2024"], { Amount_sum: 40 });
  builder.place([], [], { Amount_sum: 45 });
  builder.scan.sourceRowCount = 12;
  const scan = builder.finish();

  for (const hideEmptySummaryCells of [false, true]) {
    const result = Assembler.assemble(scan, { ...request, hideEmptySummaryCells }, { culture: "tr-TR", branches: true });

    assert.deepEqual(result.columnHeaders, [["2023"], ["2024", "Q1"], ["2024", "Q2"]]);
    const stub = result.columnSubtotals.find(subtotal => subtotal.columnHeader[0] === "2023");
    assert.deepEqual(stub.cells.map(cell => [cell.index, cell.values.Amount_sum]), [[0, 5]]);
    assert.deepEqual(stub.totals, { Amount_sum: 5 });
  }

  // Unloaded, the same buckets cannot tell a stub from a group.
  assert.deepEqual(Assembler.assemble(scan, request, { culture: "tr-TR" }).columnHeaders,
    [["2024", "Q1"], ["2024", "Q2"]]);
  assert.throws(() => Assembler.assemble(scan, request, { paged: true, branches: true }), /full depth/);
});
