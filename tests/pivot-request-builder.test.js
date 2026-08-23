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

  assert.deepEqual(request.filters, [{ field: "bolge", values: ["Kuzey"], mode: "Include" }]);
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

test("available fields stay out of the request", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "tutar", area: "data", aggregation: "sum" },
    { dataField: "miktar", area: "available", role: "measure" },
    { dataField: "bolge", area: "available", role: "dimension" }
  ]);

  assert.deepEqual(request.rows, ["urun"]);
  assert.deepEqual(request.columns, []);
  assert.equal(request.values.length, 1);
  assert.deepEqual(request.filters, []);
});

test("role is inferred from the declared area", () => {
  const fields = PivotRequestBuilder.normalizeFields([
    { dataField: "urun", area: "row" },
    { dataField: "yil", area: "column" },
    { dataField: "bolge", area: "filter" },
    { dataField: "tutar", area: "data" }
  ]);

  assert.deepEqual(fields.map(field => field.role), [
    "dimension", "dimension", "dimension", "measure"
  ]);
});

test("an explicit role is honored", () => {
  const [field] = PivotRequestBuilder.normalizeFields([
    { dataField: "miktar", area: "available", role: "measure" }
  ]);

  assert.equal(field.role, "measure");
});

test("an available field requires a role", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ dataField: "miktar", area: "available" }]),
    /requires an explicit "role"/
  );
});

test("a role contradicting the declared area is rejected", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "tutar", area: "data", role: "dimension" }
    ]),
    /cannot be "dimension"/
  );
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "urun", area: "row", role: "measure" }
    ]),
    /cannot be "measure"/
  );
});

test("an unknown role is rejected", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "miktar", area: "available", role: "metric" }
    ]),
    /Unknown role "metric"/
  );
});

test("aggregation is still rejected outside the data area, including available", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "miktar", area: "available", role: "measure", aggregation: "sum" }
    ]),
    /only valid on a "data" field/
  );
});

test("a list with no available fields and no roles builds the same request as before", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "yil", area: "column" },
    { dataField: "tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request, {
    rows: ["urun"],
    columns: ["yil"],
    values: [{ field: "tutar", aggregation: "sum", showAs: "normal" }],
    filters: [],
    rowSort: null,
    fieldSorts: []
  });
});

test("expanded and showTotals default to true on a row field", () => {
  const [field] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Region", area: "row" }
  ]);

  assert.equal(field.expanded, true);
  assert.equal(field.showTotals, true);
});

test("expanded and showTotals are carried through as declared", () => {
  const [field] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Region", area: "row", expanded: false, showTotals: false }
  ]);

  assert.equal(field.expanded, false);
  assert.equal(field.showTotals, false);
});

test("expanded and showTotals are refused outside the row area", () => {
  // Subtotals and collapsible groups are drawn on the row axis only, so
  // declaring either elsewhere would silently do nothing.
  ["column", "filter", "data"].forEach(area => {
    ["expanded", "showTotals"].forEach(member => {
      assert.throws(
        () => PivotForge.PivotRequestBuilder.normalizeFields([
          { dataField: "Amount", area, role: area === "data" ? "measure" : "dimension",
            [member]: false }
        ]),
        new RegExp(`"${member}" is only valid on a "row" field`),
        `${member} on ${area}`);
    });
  });
});

test("a non-row field that declares neither is untouched", () => {
  const [field] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Year", area: "column" }
  ]);

  assert.equal(field.expanded, null);
  assert.equal(field.showTotals, null);
});

test("areaIndex decides the order of the fields sharing an area", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Category", area: "row", areaIndex: 1 },
    { dataField: "Region", area: "row", areaIndex: 0 },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["Region", "Category"]);
});

test("a field without an areaIndex follows the ones that have one", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "City", area: "row" },
    { dataField: "Category", area: "row", areaIndex: 1 },
    { dataField: "Country", area: "row" },
    { dataField: "Region", area: "row", areaIndex: 0 },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  // Declared first, in their own order; then the undeclared ones, keeping the
  // order they were written in.
  assert.deepEqual(request.rows, ["Region", "Category", "City", "Country"]);
});

test("areaIndex orders each area independently", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Category", area: "row", areaIndex: 1 },
    { dataField: "Quarter", area: "column", areaIndex: 1 },
    { dataField: "Region", area: "row", areaIndex: 0 },
    { dataField: "Year", area: "column", areaIndex: 0 },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["Region", "Category"]);
  assert.deepEqual(request.columns, ["Year", "Quarter"]);
});

test("a list declaring no areaIndex comes back in the order it was written", () => {
  const [first, second] = PivotRequestBuilder.normalizeFields([
    { dataField: "Category", area: "row" },
    { dataField: "Region", area: "row" }
  ]);

  assert.equal(first.dataField, "Category");
  assert.equal(second.dataField, "Region");
});

test("areaIndex must be a non-negative integer", () => {
  [-1, 1.5, "0", null].forEach(areaIndex => {
    assert.throws(
      () => PivotRequestBuilder.normalizeFields([
        { dataField: "Region", area: "row", areaIndex }
      ]),
      /"areaIndex" on field "Region" must be a non-negative integer/,
      String(areaIndex));
  });
});

test("a declared sortOrder reaches the request as a named field sort", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row", sortOrder: "Descending" },
    { dataField: "Year", area: "column", sortOrder: "Ascending" },
    { dataField: "Category", area: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  // Named rather than positional, so it still points at the right field after
  // the field moves to another area.
  assert.deepEqual(request.fieldSorts, [
    { field: "Region", direction: "Descending" },
    { field: "Year", direction: "Ascending" }
  ]);
});

test("an undeclared level contributes no field sort at all", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields);

  // Not "Ascending": the engine treats undeclared and ascending differently on
  // the column axis, where undeclared means the order the data arrived in.
  assert.deepEqual(request.fieldSorts, []);
});

test("sortOrder is refused outside the row and column areas", () => {
  ["filter", "data"].forEach(area => {
    assert.throws(
      () => PivotRequestBuilder.normalizeFields([
        { dataField: "Amount", area, role: area === "data" ? "measure" : "dimension",
          sortOrder: "Ascending" }
      ]),
      /"sortOrder" is only valid on a "row" or "column" field/,
      area);
  });
});

test("an unknown sortOrder is refused rather than passed through", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "Region", area: "row", sortOrder: "descending" }
    ]),
    /Unknown sortOrder "descending"/);
});

test("a filter with no declared mode is sent as including", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields, {
    filters: [{ field: "bolge", values: ["Kuzey"] }]
  });

  assert.deepEqual(request.filters, [{ field: "bolge", values: ["Kuzey"], mode: "Include" }]);
});

test("an excluding filter is carried through as declared", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields, {
    filters: [{ field: "bolge", values: ["Kuzey"], mode: "Exclude" }]
  });

  assert.deepEqual(request.filters, [{ field: "bolge", values: ["Kuzey"], mode: "Exclude" }]);
});

test("an unknown filter mode is refused rather than sent", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest(salesFields, {
      filters: [{ field: "bolge", values: ["Kuzey"], mode: "exclude" }]
    }),
    /Unknown filter mode "exclude" on field "bolge"/);
});

test("a filter without a values array is refused", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest(salesFields, {
      filters: [{ field: "bolge" }]
    }),
    /requires a "values" array/);
});

test("filter values are stringified, with blank standing in for null", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields, {
    filters: [{ field: "bolge", values: [2025, null, "Ege"] }]
  });

  assert.deepEqual(request.filters[0].values, ["2025", "", "Ege"]);
});

// --- operators --------------------------------------------------------------

test("an unknown filter operator is refused rather than passed through", () => {
  // Passing it on would produce a request the engine rejects, blaming the server
  // for a spelling mistake made in the page.
  assert.throws(
    () => PivotForge.PivotRequestBuilder.normalizeFilter(
      { field: "Region", values: ["x"], operator: "Sometimes" }, 0),
    /Unknown filter operator/);
});

test("a condition restricts once it has the arguments its operator reads", () => {
  const { restricts } = PivotForge.PivotRequestBuilder;

  // Blank carries no values and still restricts; counting values would leave its
  // funnel and its chip looking inactive.
  assert.equal(restricts({ field: "Note", values: [], operator: "Blank" }), true);
  assert.equal(restricts({ field: "Amount", values: ["100"], operator: "Between" }), false);
  assert.equal(restricts({ field: "Amount", values: ["100", "500"], operator: "Between" }), true);
  assert.equal(restricts({ field: "Region", values: [] }), false);
  assert.equal(restricts({ field: "Region", values: ["Ege"] }), true);
});
