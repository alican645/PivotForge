const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
const RemoteStore = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-remote-store.js");
const PivotRequestBuilder = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
const ResultAssembler = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
const { createLoader } = require("./helpers/fake-data-source-loader.js");

// DevExtreme's RemoteStore against an in-memory DataSourceLoader: the load
// options it sends, and the pivot it builds from what comes back.
const records = [
  { Region: "Ege", Category: "Beton", OrderDate: "2024-01-15T00:00:00", Amount: 100, Quantity: 2 },
  { Region: "Ege", Category: "Çimento", OrderDate: "2024-04-02T00:00:00", Amount: 50, Quantity: 1 },
  { Region: "Marmara", Category: "Beton", OrderDate: "2025-01-20T00:00:00", Amount: 200, Quantity: 4 },
  { Region: "Marmara", Category: "Beton", OrderDate: "2024-02-10T00:00:00", Amount: 30, Quantity: null }
];

const region = { dataField: "Region", area: "row", dataType: "string" };
const category = { dataField: "Category", area: "row" };
const quarter = { dataField: "OrderDate", groupInterval: "quarter", area: "column" };
const amount = { dataField: "Amount", area: "data", aggregation: "sum" };

function storeOver(data = records) {
  const loader = createLoader(data);
  return { store: RemoteStore.create({ type: "remote", load: loader.load }), calls: loader.calls };
}

async function pivot(fields, extras = {}, data = records) {
  const { store, calls } = storeOver(data);
  const result = await store.pivot(PivotRequestBuilder.buildRequest(fields, extras), { culture: "tr-TR" });
  return { result, calls };
}

test("one load per row depth, each grouping the rows to that depth and then every column level", async () => {
  const { calls } = await pivot([region, category, quarter, amount, { dataField: "Amount", area: "data", aggregation: "average" }]);

  assert.deepEqual(calls.map(call => call.group.map(group => group.selector + (group.groupInterval ? `:${group.groupInterval}` : ""))), [
    ["Region", "Category", "OrderDate:quarter"],
    ["Region", "OrderDate:quarter"],
    ["OrderDate:quarter"]
  ]);
  assert.deepEqual(calls[0].group.map(group => group.isExpanded), [true, true, false]);
  assert.deepEqual(calls[0].groupSummary, [
    { selector: "Amount", summaryType: "sum" },
    { selector: "Amount", summaryType: "avg" }
  ]);
  // The grand totals and the record count ride on the shallowest load only.
  assert.deepEqual(calls.map(call => Boolean(call.totalSummary)), [false, false, true]);
  assert.equal(calls[2].requireTotalCount, true);
});

test("the summaries come back as the engine lays them out: cells, totals, subtotals", async () => {
  const { result } = await pivot([region, category, quarter, amount]);

  assert.deepEqual(result.rowHeaders, [["Ege", "Beton"], ["Ege", "Çimento"], ["Marmara", "Beton"]]);
  assert.deepEqual(result.columnHeaders, [["Q1"], ["Q2"]]);
  assert.deepEqual(result.cells, [
    { row: 0, column: 0, values: { Amount_sum: 100 } },
    { row: 1, column: 1, values: { Amount_sum: 50 } },
    { row: 2, column: 0, values: { Amount_sum: 230 } }
  ]);
  assert.deepEqual(result.rowTotals.map(total => total.values.Amount_sum), [100, 50, 230]);
  assert.deepEqual(result.columnTotals.map(total => total.values.Amount_sum), [330, 50]);
  assert.deepEqual(result.subtotals.map(subtotal => [subtotal.rowHeader, subtotal.totals.Amount_sum]), [
    [["Ege"], 150],
    [["Marmara"], 230]
  ]);
  assert.deepEqual(result.subtotals[0].cells, [
    { row: 0, column: 0, values: { Amount_sum: 100 } },
    { row: 0, column: 1, values: { Amount_sum: 50 } }
  ]);
  assert.deepEqual(result.grandTotals, { Amount_sum: 380 });
  assert.equal(result.metadata.sourceRowCount, 4);
});

test("a nested column axis gives column subtotals and their crossings with the row groups", async () => {
  const year = { dataField: "OrderDate", groupInterval: "year", area: "column" };
  const { result } = await pivot([region, category, year, quarter, amount]);

  assert.deepEqual(result.columnHeaders, [["2024", "Q1"], ["2024", "Q2"], ["2025", "Q1"], ["2025", "Q2"]]);
  assert.deepEqual(result.columnSubtotals.map(subtotal => [subtotal.columnHeader, subtotal.totals.Amount_sum]), [
    [["2024"], 180],
    [["2025"], 200]
  ]);
  const ege = result.subtotals.find(subtotal => subtotal.rowHeader[0] === "Ege");
  assert.deepEqual(ege.columnSubtotals, [{ columnHeader: ["2024"], values: { Amount_sum: 150 } }]);
});

test("an axis without fields is the one empty header, as the engine draws it", async () => {
  const { result, calls } = await pivot([region, amount]);

  assert.equal(calls.length, 1);
  assert.deepEqual(result.columnHeaders, [[]]);
  assert.deepEqual(result.cells.map(cell => [cell.row, cell.column, cell.values.Amount_sum]), [[0, 0, 150], [1, 0, 230]]);

  const { result: totalOnly } = await pivot([amount]);
  assert.deepEqual(totalOnly.rowHeaders, [[]]);
  assert.deepEqual(totalOnly.cells, [{ row: 0, column: 0, values: { Amount_sum: 380 } }]);
});

test("average, count, min and max map onto the protocol's summary types", async () => {
  const { result } = await pivot([region,
    { dataField: "Amount", area: "data", aggregation: "average" },
    { dataField: "Quantity", area: "data", aggregation: "count" },
    { dataField: "Amount", area: "data", aggregation: "min" },
    { dataField: "Amount", area: "data", aggregation: "max" }]);

  assert.deepEqual(result.grandTotals, { Amount_average: 95, Quantity_count: 4, Amount_min: 30, Amount_max: 200 });
});

test("a filter on header labels becomes a condition on the values behind them", async () => {
  const month = { dataField: "OrderDate", groupInterval: "month", area: "column" };
  const { calls } = await pivot([region, month, amount], {
    filters: [
      { field: "OrderDate:month", values: ["Ocak", "Şubat"] },
      { field: "Region", values: ["Ege"], mode: "Exclude" }
    ]
  });

  assert.deepEqual(calls[0].filter, [
    [["OrderDate.Month", "=", 1], "or", ["OrderDate.Month", "=", 2]],
    "and",
    ["!", ["Region", "=", "Ege"]]
  ]);
});

test("a quarter is a range of months, and a range a span of the field's values", async () => {
  const { calls } = await pivot([region, quarter, amount], {
    filters: [{ field: "OrderDate:quarter", values: ["Q2"], mode: "Exclude" }]
  });
  assert.deepEqual(calls[0].filter, ["!", [["OrderDate.Month", ">=", 4], "and", ["OrderDate.Month", "<", 7]]]);

  const range = { dataField: "Amount", groupInterval: "range", groupSize: 100, area: "row" };
  const { calls: rangeCalls, result } = await pivot([range, amount], {
    filters: [{ field: "Amount:range100", values: ["0 – 100"] }]
  });
  assert.deepEqual(rangeCalls[0].filter, [["Amount", ">=", 0], "and", ["Amount", "<", 100]]);
  assert.deepEqual(rangeCalls[0].group[0], { selector: "Amount", groupInterval: 100, isExpanded: false });
  assert.deepEqual(result.rowHeaders, [["0 – 100"]]);
});

test("an operator the protocol cannot say on a label is decided on the field's own labels", async () => {
  const month = { dataField: "OrderDate", groupInterval: "month", area: "column" };
  const { calls, result } = await pivot([region, month, amount], {
    filters: [{ field: "OrderDate:month", values: ["ub"], operator: "Contains" }]
  });

  // One load lists the months there are; only Şubat holds "ub".
  assert.deepEqual(calls[0].group, [{ selector: "OrderDate", groupInterval: "month", isExpanded: false }]);
  assert.deepEqual(calls[1].filter, ["OrderDate.Month", "=", 2]);
  assert.deepEqual(result.grandTotals, { Amount_sum: 30 });
});

test("an untyped field's values are read once, then filtered on directly", async () => {
  const loader = createLoader(records);
  const store = RemoteStore.create({ type: "remote", load: loader.load });
  const request = PivotRequestBuilder.buildRequest([{ dataField: "Category", area: "row" }, amount], {
    filters: [{ field: "Category", values: ["Beton"] }]
  });

  await store.pivot(request, { culture: "tr-TR" });
  assert.deepEqual(loader.calls[0].group, [{ selector: "Category", isExpanded: false }]);
  assert.equal(loader.calls[0].filter, undefined);
  assert.deepEqual(loader.calls[1].filter, ["Category", "=", "Beton"]);

  loader.calls.length = 0;
  await store.pivot(request, { culture: "tr-TR" });
  assert.equal(loader.calls.length, 1);
  assert.deepEqual(loader.calls[0].filter, ["Category", "=", "Beton"]);
});

test("a text operator on a plain text field is the protocol's own", async () => {
  const { calls } = await pivot([region, amount], {
    filters: [{ field: "Region", values: ["mar"], operator: "StartsWith" }]
  });

  assert.deepEqual(calls[0].filter, ["Region", "startswith", "mar"]);
});

test("a filter that keeps nothing sends no load and draws the empty result", async () => {
  const { calls, result } = await pivot([region, quarter, amount, { dataField: "Quantity", area: "data", aggregation: "count" }], {
    filters: [{ field: "OrderDate:quarter", values: ["Q9"] }]
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.rowHeaders, []);
  assert.deepEqual(result.grandTotals, { Amount_sum: null, Quantity_count: 0 });
});

test("labels are the engine's: Qn, the culture's month and day names, range bounds in its numbers", () => {
  const labels = ResultAssembler.createLabels("tr-TR");

  assert.equal(labels.label(3, "quarter"), "Q3");
  assert.equal(labels.label(5, "month"), "Mayıs");
  assert.equal(labels.label(1, "dayOfWeek"), "Pazartesi");
  assert.equal(labels.label(1000, "range", 1000), "1.000 – 2.000");
  assert.equal(labels.label("2024-03-05T14:30:00", null, null, "Date"), "03/05/2024 14:30:00");
  assert.equal(labels.label(true), "True");
  assert.equal(labels.label(null), "");
  assert.equal(ResultAssembler.createLabels("en-US").label(5, "month"), "May");
});

test("the filter picker lists labels in the engine's order, blank first", async () => {
  const { store } = storeOver([...records, { Region: null, Category: "Beton", OrderDate: "2024-01-01T00:00:00", Amount: 1, Quantity: 10 }]);

  assert.deepEqual((await store.fieldValues({ field: "Region" }, { culture: "tr-TR" })).values, ["", "Ege", "Marmara"]);
  assert.deepEqual(
    (await store.fieldValues({ field: "OrderDate", interval: "month" }, { culture: "tr-TR" })).values,
    ["Ocak", "Şubat", "Nisan"]);
  assert.deepEqual((await store.fieldValues({ field: "Quantity" }, { culture: "tr-TR" })).values, ["", "1", "2", "4", "10"]);
  const ege = await store.fieldValues(
    { field: "Category", filters: [{ field: "Region", values: ["Ege"], mode: "Include" }], dataTypes: { Region: "String" } },
    { culture: "tr-TR" });
  assert.deepEqual(ege, { field: "Category", values: ["Beton", "Çimento"], totalCount: 2, truncated: false, limit: 1000 });
});

test("a drill-down loads the records behind a cell, within the limit", async () => {
  const loader = createLoader(records);
  const store = RemoteStore.create({ type: "remote", load: loader.load, limit: 1 });
  const request = PivotRequestBuilder.buildRequest([region, quarter, amount]);

  const response = await store.drillDown({ request, rowPath: ["Marmara"], columnPath: ["Q1"], valueKey: "Amount_sum" }, { culture: "tr-TR" });

  assert.equal(loader.calls.at(-1).take, 1);
  assert.equal(loader.calls.at(-1).requireTotalCount, true);
  assert.equal(response.records.length, 1);
  assert.deepEqual({ ...response, records: undefined }, { records: undefined, totalCount: 2, truncated: true, limit: 1, valueKey: "Amount_sum" });
});

test("discovery reads the first records the way PivotFieldDiscovery reads a type", async () => {
  const { store, calls } = storeOver([{ __id: 1, Region: "Ege", Amount: 5, Sold: true, OrderDate: "2024-01-01T00:00:00", Address: { City: "İzmir" } }]);

  const { fields } = await store.fields();

  assert.deepEqual(calls[0], { skip: 0, take: 20 });
  assert.deepEqual(fields.map(field => `${field.dataField}:${field.dataType}:${field.groupInterval ?? ""}:${field.groupIndex ?? ""}`), [
    "Region:string::", "Amount:number::", "Sold:string::",
    "OrderDate:date:year:0", "OrderDate:date:quarter:1", "OrderDate:date:month:2"
  ]);
});

test("a load URL is asked as DevExtreme.AspNet.Data's client asks it", async () => {
  const requests = [];
  const store = RemoteStore.create({
    type: "remote",
    loadUrl: "/api/sales?tenant=1",
    headers: { "X-Api": "key" },
    onBeforeSend(operation, settings) {
      assert.equal(operation, "load");
      settings.headers.Authorization = "Bearer token";
    }
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: [], totalCount: 0, summary: [null] }) };
    }
  });

  await store.pivot(PivotRequestBuilder.buildRequest([region, amount]), { culture: "tr-TR" });

  const url = new URL(requests[0].url, "http://localhost");
  assert.equal(url.pathname, "/api/sales");
  assert.equal(url.searchParams.get("tenant"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("group")), [{ selector: "Region", isExpanded: false }]);
  assert.equal(url.searchParams.get("requireTotalCount"), "true");
  assert.deepEqual(requests[0].init.headers, { Accept: "application/json", "X-Api": "key", Authorization: "Bearer token" });
});

test("a failed load says so, with the backend's message when it sends one", async () => {
  const store = RemoteStore.create({ type: "remote", loadUrl: "/api/sales" }, {
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ message: "Database is down." }) })
  });

  await assert.rejects(store.pivot(PivotRequestBuilder.buildRequest([region, amount])), /Database is down\./);
});

test("what only the engine can do is refused where it is declared", () => {
  const normalized = fields => PivotRequestBuilder.normalizeFields(fields);

  assert.throws(() => RemoteStore.validateFields(normalized([{ dataField: "Amount", area: "data", aggregation: "median" }])),
    /summarized by "median", which a remote store cannot ask for/);
  assert.throws(() => RemoteStore.validateFields(normalized([{ dataField: "Margin", area: "data", expression: "Sum([Amount]) / 2" }])),
    /is a calculated field/);
  assert.throws(() => RemoteStore.validateFields(normalized([{ dataField: "FiscalYear", area: "row", selector: "fiscalYear" }, amount])),
    /names a selector/);
  assert.throws(() => RemoteStore.validateRequest({ topN: [{ field: "Region", count: 3 }] }), /cannot rank groups/);
  assert.throws(() => RemoteStore.validateRequest({ valueFilters: [{ field: "Region" }] }), /by their values/);
  assert.throws(() => RemoteStore.create({ type: "remote" }), /needs a "loadUrl" or a "load" function/);
});
