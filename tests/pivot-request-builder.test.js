const assert = require("node:assert/strict");
const test = require("node:test");
const PivotRequestBuilder = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");

const salesFields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Yıl", dataField: "yil", area: "column" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

test("builds rows, columns, and values from areas", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields);

  assert.deepEqual(request.rows, ["urun"]);
  assert.deepEqual(request.columns, ["yil"]);
  assert.deepEqual(request.values, [
    { field: "tutar", aggregation: "sum", showAs: "normal" }
  ]);
  assert.deepEqual(request.filters, []);
  assert.equal(request.rowSort, null);
});

test("preserves declaration order across multiple row and column fields", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "bolge", area: "row" },
    { dataField: "urun", area: "row" },
    { dataField: "yil", area: "column" },
    { dataField: "ay", area: "column" },
    { dataField: "tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["bolge", "urun"]);
  assert.deepEqual(request.columns, ["yil", "ay"]);
});

test("defaults data field aggregation to sum and showAs to normal", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "tutar", area: "data" }
  ]);

  assert.deepEqual(request.values, [
    { field: "tutar", aggregation: "sum", showAs: "normal" }
  ]);
});

test("supports every aggregation and showAs value", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "a", area: "data", aggregation: "count" },
    { dataField: "b", area: "data", aggregation: "average" },
    { dataField: "c", area: "data", aggregation: "min" },
    { dataField: "d", area: "data", aggregation: "max" },
    { dataField: "e", area: "data", aggregation: "sum", showAs: "percentOfRowTotal" },
    { dataField: "f", area: "data", aggregation: "sum", showAs: "runningTotal" }
  ]);

  assert.deepEqual(request.values.map(value => value.aggregation), [
    "count", "average", "min", "max", "sum", "sum"
  ]);
  assert.equal(request.values[4].showAs, "percentOfRowTotal");
  assert.equal(request.values[5].showAs, "runningTotal");
});

test("filter fields do not enter rows, columns, or values", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "tutar", area: "data", aggregation: "sum" },
    { dataField: "bolge", area: "filter" }
  ]);

  assert.deepEqual(request.rows, ["urun"]);
  assert.deepEqual(request.columns, []);
  assert.equal(request.values.length, 1);
});

test("passes through supplied filters and row sort", () => {
  const rowSort = { mode: "rowLabel", direction: "ascending", field: "urun" };
  const request = PivotRequestBuilder.buildRequest(salesFields, {
    filters: [{ field: "bolge", values: ["Kuzey"] }],
    rowSort
  });

  assert.deepEqual(request.filters, [{ field: "bolge", values: ["Kuzey"] }]);
  assert.deepEqual(request.rowSort, rowSort);
});

test("excludes invisible fields from the request", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "gizli", area: "row", visible: false },
    { dataField: "tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["urun"]);
});

test("value key matches the server key format", () => {
  const [field] = PivotRequestBuilder.normalizeFields([
    { dataField: "tutar", area: "data", aggregation: "average" }
  ]);

  assert.equal(PivotRequestBuilder.valueKey(field), "tutar_average");
});

test("normalize defaults caption to the data field name", () => {
  const [field] = PivotRequestBuilder.normalizeFields([
    { dataField: "tutar", area: "data" }
  ]);

  assert.equal(field.caption, "tutar");
});

test("rejects a configuration without a data field", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest([{ dataField: "urun", area: "row" }]),
    /at least one field with area "data"/
  );
});

test("rejects an unknown area", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ dataField: "urun", area: "rows" }]),
    /Unknown area "rows"/
  );
});

test("rejects an aggregation on a non-data field", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "urun", area: "row", aggregation: "sum" }
    ]),
    /only valid on a "data" field/
  );
});

test("rejects an unknown aggregation", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "tutar", area: "data", aggregation: "median" }
    ]),
    /Unknown aggregation "median"/
  );
});

test("rejects a field without a data field name", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ area: "row" }]),
    /requires a non-empty "dataField"/
  );
});

test("rejects a non-array field list", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields("urun"),
    /"fields" must be an array/
  );
});
