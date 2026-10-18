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
    { dataField: "f", area: "data", aggregation: "sum", showAs: "runningTotal" },
    { dataField: "g", area: "data", aggregation: "countDistinct" },
    { dataField: "h", area: "data", aggregation: "median" },
    { dataField: "i", area: "data", aggregation: "variance" },
    { dataField: "j", area: "data", aggregation: "standardDeviation" },
    { dataField: "k", area: "data", aggregation: "variancePopulation" },
    { dataField: "l", area: "data", aggregation: "standardDeviationPopulation" },
    { dataField: "m", area: "data", aggregation: "first" },
    { dataField: "n", area: "data", aggregation: "last" }
  ]);

  assert.deepEqual(request.values.map(value => value.aggregation), [
    "count", "average", "min", "max", "sum", "sum",
    "countDistinct", "median", "variance", "standardDeviation",
    "variancePopulation", "standardDeviationPopulation", "first", "last"
  ]);
  // The server lower-cases the enum name the same way.
  assert.equal(PivotRequestBuilder.valueKey({ dataField: "g", aggregation: "countDistinct" }), "g_countdistinct");
  assert.equal(
    PivotRequestBuilder.valueKey({ dataField: "j", aggregation: "standardDeviation" }), "j_standarddeviation");
  assert.equal(
    PivotRequestBuilder.valueKey({ dataField: "l", aggregation: "standardDeviationPopulation" }),
    "l_standarddeviationpopulation");
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

test("an undeclared caption is the data field titled, as DevExtreme makes it", () => {
  const captions = PivotRequestBuilder.normalizeFields([
    { dataField: "tutar", area: "data" },
    { dataField: "netAmount", area: "data", aggregation: "sum" },
    { dataField: "OrderDate", area: "column", groupInterval: "year" },
    { dataField: "order_date", area: "row", groupInterval: "dayOfWeek" },
    { dataField: "customer.city", area: "row" },
    { dataField: "orderID", area: "row" },
    { dataField: "kdvTutarı", area: "data", aggregation: "countDistinct" },
    { dataField: "marj", area: "data", expression: "[a] - [b]" },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
  ]).map(field => field.caption);

  assert.deepEqual(captions, [
    // No summary type declared, so none is named.
    "Tutar",
    "Net Amount (Sum)",
    "Order Date Year",
    "Order Date Day Of Week",
    "Customer City",
    "Order ID",
    "Kdv Tutarı (CountDistinct)",
    // A formula is no summary type.
    "Marj",
    "Tutar"
  ]);
  assert.equal(PivotRequestBuilder.titleize("XMLHttpRequest"), "XML Http Request");
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
      { dataField: "tutar", area: "data", aggregation: "mode" }
    ]),
    /Unknown aggregation "mode"/
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

test("expanded is refused outside the row and column areas", () => {
  // Collapsible groups are drawn on the two header axes only, so declaring
  // them elsewhere would silently do nothing.
  ["filter", "data"].forEach(area => {
    assert.throws(
      () => PivotForge.PivotRequestBuilder.normalizeFields([
        { dataField: "Amount", area, role: area === "data" ? "measure" : "dimension", expanded: false }
      ]),
      /"expanded" is only valid on a "row" or "column" field/,
      `expanded on ${area}`);
  });
});

test("showTotals is refused where there are no subtotals to leave", () => {
  assert.throws(
    () => PivotForge.PivotRequestBuilder.normalizeFields([
      { dataField: "Region", area: "filter", showTotals: false }
    ]),
    /"showTotals" is only valid on a "row", "column" or "data" field/);
});

test("a measure carries showTotals and showValues, showValues left null when undeclared", () => {
  const [plain, declared, totalsOnly] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Amount", area: "data", aggregation: "sum" },
    { dataField: "Share", area: "data", aggregation: "sum", showValues: false },
    { dataField: "Count", area: "data", aggregation: "count", showTotals: false }
  ]);

  assert.equal(plain.showTotals, true);
  assert.equal(plain.showValues, null);
  assert.equal(declared.showValues, false);
  assert.equal(totalsOnly.showTotals, false);
  assert.throws(
    () => PivotForge.PivotRequestBuilder.normalizeFields([{ dataField: "Region", area: "row", showValues: false }]),
    /"showValues" is only valid on a "data" field/);
});

test("a column field carries showTotals and expanded, defaulting to true", () => {
  const [plain, declared] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Year", area: "column" },
    { dataField: "Quarter", area: "column", showTotals: false, expanded: false }
  ]);

  assert.equal(plain.expanded, true);
  assert.equal(plain.showTotals, true);
  assert.equal(declared.showTotals, false);
  assert.equal(declared.expanded, false);
});

test("a filter field that declares neither is untouched", () => {
  const [field] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Year", area: "filter" }
  ]);

  assert.equal(field.expanded, null);
  assert.equal(field.showTotals, null);
});

test("showGrandTotals defaults to true on a data field and is carried as declared", () => {
  const [plain, declared] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Amount", area: "data" },
    { dataField: "Quantity", area: "data", showGrandTotals: false }
  ]);

  assert.equal(plain.showGrandTotals, true);
  assert.equal(declared.showGrandTotals, false);
});

test("showGrandTotals is refused on a field that is not a measure", () => {
  // A grand total is a measure summed over an axis: a dimension has none.
  ["row", "column", "filter"].forEach(area => {
    assert.throws(
      () => PivotForge.PivotRequestBuilder.normalizeFields([
        { dataField: "Region", area, showGrandTotals: false }
      ]),
      /"showGrandTotals" is only valid on a "data" field/,
      area);
  });

  assert.throws(
    () => PivotForge.PivotRequestBuilder.normalizeFields([
      { dataField: "Region", area: "available", role: "dimension", showGrandTotals: false }
    ]),
    /"showGrandTotals" is only valid on a "data" field/);
});

test("a measure waiting in the field list may declare showGrandTotals", () => {
  const [field] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Amount", area: "available", role: "measure", showGrandTotals: false }
  ]);

  assert.equal(field.showGrandTotals, false);
});

test("a dimension carries no showGrandTotals at all", () => {
  const [field] = PivotForge.PivotRequestBuilder.normalizeFields([
    { dataField: "Region", area: "row" }
  ]);

  assert.equal(field.showGrandTotals, null);
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

test("a declared sortByValueKey reaches the request as a value field sort", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Category", area: "row", sortOrder: "Descending", sortByValueKey: "Amount_sum" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.fieldSorts, [
    { field: "Category", direction: "Descending", valueKey: "Amount_sum" }
  ]);
});

test("a sortByValueKey without a sortOrder sorts ascending", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Category", area: "row", sortByValueKey: "Amount_sum" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.fieldSorts, [
    { field: "Category", direction: "Ascending", valueKey: "Amount_sum" }
  ]);
});

test("sortByValueKey is refused outside the row and column areas", () => {
  ["filter", "data"].forEach(area => {
    assert.throws(
      () => PivotRequestBuilder.normalizeFields([
        { dataField: "Amount", area, role: area === "data" ? "measure" : "dimension",
          sortByValueKey: "Amount_sum" }
      ]),
      /"sortByValueKey" is only valid on a "row" or "column" field/,
      area);
  });
});

test("a column field sorts by value along a row path", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Year", area: "column", sortOrder: "Descending", sortByValueKey: "Amount_sum",
      sortBySummaryPath: ["Ege"] },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.fieldSorts, [
    { field: "Year", direction: "Descending", valueKey: "Amount_sum", summaryPath: ["Ege"] }
  ]);
});

test("a summary path needs a value key", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "Region", area: "row", sortBySummaryPath: ["2025"] }
    ]),
    /requires "sortByValueKey"/);
});

test("a column value sort stands in for every column field's own sort", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row", sortOrder: "Descending" },
    { dataField: "Year", area: "column", sortOrder: "Ascending" },
    { dataField: "Quarter", area: "column" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ], { columnSort: { valueKey: "Amount_sum", rowPath: ["Ege"], direction: "Descending" } });

  assert.deepEqual(request.fieldSorts, [
    { field: "Region", direction: "Descending" },
    { field: "Year", direction: "Descending", valueKey: "Amount_sum", summaryPath: ["Ege"] },
    { field: "Quarter", direction: "Descending", valueKey: "Amount_sum", summaryPath: ["Ege"] }
  ]);
});

test("a column value sort on the grand total row sends no path", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "Year", area: "column" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ], { columnSort: { valueKey: "Amount_sum", rowPath: null, direction: "Ascending" } });

  assert.deepEqual(request.fieldSorts, [
    { field: "Year", direction: "Ascending", valueKey: "Amount_sum" }
  ]);
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

test("hiding empty summary cells is asked for only when it was declared", () => {
  const fields = [
    { dataField: "Region", area: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ];

  // Omitted rather than sent as false, so a request from a page that never
  // declared it is byte-identical to one written before the option existed.
  assert.equal(
    "hideEmptySummaryCells" in PivotForge.PivotRequestBuilder.buildRequest(fields), false);
  assert.equal(
    PivotForge.PivotRequestBuilder.buildRequest(fields, { hideEmptySummaryCells: true })
      .hideEmptySummaryCells,
    true);
});

test("a ranking travels as the two members it declared", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields, { topN: [{ field: "urun", count: 3 }] });

  assert.deepStrictEqual(request.topN, [{ field: "urun", count: 3 }]);
});

test("a ranking that declared more carries more", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields, {
    topN: [{ field: "urun", count: 2, valueKey: "tutar_sum", mode: "Bottom" }]
  });

  assert.deepStrictEqual(request.topN, [
    { field: "urun", count: 2, valueKey: "tutar_sum", mode: "Bottom" }
  ]);
});

test("a request that declared no ranking does not mention one", () => {
  // The same rule the other optional members follow: a page written before
  // rankings existed produces byte-identical bytes.
  const request = PivotRequestBuilder.buildRequest(salesFields, {});

  assert.ok(!("topN" in request));
});

test("an empty ranking list is the same as none", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields, { topN: [] });

  assert.ok(!("topN" in request));
});

test("a ranking without a field is rejected where it was written", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest(salesFields, { topN: [{ count: 3 }] }),
    /requires a "field"/);
});

test("a ranking counting less than one group is rejected", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest(salesFields, { topN: [{ field: "urun", count: 0 }] }),
    /at least 1/);
  assert.throws(
    () => PivotRequestBuilder.buildRequest(salesFields, { topN: [{ field: "urun", count: 2.5 }] }),
    /whole "count"/);
});

test("an unknown ranking mode is rejected", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest(salesFields, { topN: [{ field: "urun", count: 2, mode: "Middle" }] }),
    /Unknown ranking mode/);
});

test("a value is read the way the engine will read it", () => {
  // The engine tries an invariant number first, then an invariant date, then
  // collated text. A picker that decided otherwise would offer a control whose
  // output the comparison ignores.
  const type = PivotRequestBuilder.comparisonType;

  assert.equal(type("06/05/2026 00:00:00"), "date");
  assert.equal(type("2026-06-05"), "date");
  // A year is a number before it is a date, which is the order that matters:
  // Date.parse would happily read "2024" as a year.
  assert.equal(type("2024"), "number");
  assert.equal(type("1,250.50"), "number");
  assert.equal(type("-3"), "number");
  assert.equal(type("Haziran"), "text");
  assert.equal(type("Q1"), "text");
  assert.equal(type(""), "text");
  assert.equal(type(null), "text");
});

test("the comparison operators are the ones that put a value in order", () => {
  assert.deepStrictEqual(
    PivotRequestBuilder.COMPARISON_OPERATORS, ["Between", "GreaterThan", "LessThan"]);
  // The text operators match a value rather than ordering it, so the kind of
  // value it is changes nothing for them.
  for (const operator of ["Equals", "Contains", "StartsWith", "EndsWith", "Blank"]) {
    assert.ok(!PivotRequestBuilder.COMPARISON_OPERATORS.includes(operator));
  }
});

test("presentation options default to the grid's behaviour and are checked when declared", () => {
  const [plain, declared] = PivotRequestBuilder.normalizeFields([
    { dataField: "a", area: "row" },
    { dataField: "b", area: "data", allowSorting: false, allowFiltering: false, width: 140, wordWrap: true }
  ]);

  assert.deepEqual(
    [plain.allowSorting, plain.allowFiltering, plain.width, plain.wordWrap], [true, true, null, null]);
  assert.deepEqual(
    [declared.allowSorting, declared.allowFiltering, declared.width, declared.wordWrap], [false, false, 140, true]);

  assert.throws(() => PivotRequestBuilder.normalizeFields([{ dataField: "a", area: "row", width: 0 }]),
    /"width" on field "a"/);
  assert.throws(() => PivotRequestBuilder.normalizeFields([{ dataField: "a", area: "row", wordWrap: "yes" }]),
    /"wordWrap" on field "a" must be true or false/);
});

test("allowCrossGroupCalculation travels on the value only when switched off", () => {
  const plain = PivotRequestBuilder.buildRequest(salesFields);
  assert.equal("allowCrossGroupCalculation" in plain.values[0], false);

  const withinGroups = PivotRequestBuilder.buildRequest([
    salesFields[0], salesFields[1],
    { ...salesFields[2], showAs: "runningTotal", allowCrossGroupCalculation: false }
  ]);
  assert.equal(withinGroups.values[0].allowCrossGroupCalculation, false);

  const [normalized] = PivotRequestBuilder.normalizeFields([salesFields[2]]);
  assert.equal(normalized.allowCrossGroupCalculation, true);
  assert.equal(PivotRequestBuilder.normalizeFields([salesFields[0]])[0].allowCrossGroupCalculation, null);
});

test("customizeText and allowCrossGroupCalculation belong to measures, displayFolder to any field", () => {
  const { normalizeFields } = PivotRequestBuilder;

  assert.throws(() => normalizeFields([{ dataField: "urun", area: "row", customizeText: "fmt" }]),
    /"customizeText" is only valid on a "data" field/);
  assert.throws(() => normalizeFields([{ dataField: "urun", area: "row", allowCrossGroupCalculation: false }]),
    /"allowCrossGroupCalculation" is only valid on a "data" field/);
  assert.throws(() => normalizeFields([{ dataField: "tutar", allowCrossGroupCalculation: "no" }]),
    /must be true or false/);
  assert.throws(() => normalizeFields([{ dataField: "tutar", customizeText: 42 }]),
    /must be a function or the name of one/);
  assert.throws(() => normalizeFields([{ dataField: "urun", area: "row", displayFolder: " " }]),
    /"displayFolder" on field "urun" must be a non-empty string/);

  const fn = () => "x";
  const [measure, dimension, waiting] = normalizeFields([
    { dataField: "tutar", customizeText: fn, displayFolder: "Satış" },
    { dataField: "urun", area: "row", displayFolder: " Ürün " },
    { dataField: "adet", area: "available", role: "measure", customizeText: "app.adet" }
  ]);
  assert.equal(measure.customizeText, fn);
  assert.equal(measure.displayFolder, "Satış");
  assert.equal(dimension.displayFolder, "Ürün");
  assert.equal(dimension.customizeText, null);
  assert.equal(waiting.customizeText, "app.adet");
  // Null is what normalizing leaves on a field these do not apply to, so it is no declaration.
  assert.doesNotThrow(() => normalizeFields([{ dataField: "urun", area: "row", customizeText: null }]));
});

test("value filters are checked and sent only when there are any", () => {
  const plain = PivotRequestBuilder.buildRequest(salesFields);
  assert.equal("valueFilters" in plain, false);

  const request = PivotRequestBuilder.buildRequest(salesFields, {
    valueFilters: [
      { field: "urun", operator: "GreaterThan", value: "1000" },
      { field: "urun", operator: "Between", value: 10, value2: 20, valueKey: "tutar_sum" }
    ]
  });
  assert.deepEqual(request.valueFilters, [
    { field: "urun", operator: "GreaterThan", value: 1000 },
    { field: "urun", operator: "Between", value: 10, value2: 20, valueKey: "tutar_sum" }
  ]);

  const { normalizeValueFilters } = PivotRequestBuilder;
  assert.equal(normalizeValueFilters([{ field: "urun", value: 5 }])[0].operator, "GreaterThan");
  assert.throws(() => normalizeValueFilters([{ operator: "GreaterThan", value: 1 }]), /requires a "field"/);
  assert.throws(() => normalizeValueFilters([{ field: "urun", operator: "Over", value: 1 }]), /Unknown value filter operator "Over"/);
  assert.throws(() => normalizeValueFilters([{ field: "urun", value: "" }]), /requires a number "value"/);
  assert.throws(() => normalizeValueFilters([{ field: "urun", operator: "Between", value: 1 }]), /requires a number "value2"/);
  assert.throws(() => normalizeValueFilters([{ field: "urun", operator: "Equal", value: 1, value2: 2 }]),
    /compares one value/);
});

// --- data types -----------------------------------------------------------------

test("a declared data type travels per column, and only when declared", () => {
  const plain = PivotForge.PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);
  const typed = PivotForge.PivotRequestBuilder.buildRequest([
    { dataField: "OrderDate", area: "row", groupInterval: "year", dataType: "date" },
    { dataField: "OrderDate", area: "row", groupInterval: "month", dataType: "date" },
    { dataField: "Amount", area: "data", aggregation: "sum", dataType: "number" },
    // Typed though not placed: a formula or a later move may read it.
    { dataField: "Code", area: "available", role: "dimension", dataType: "string" }
  ]);

  assert.equal("dataTypes" in plain, false);
  assert.deepEqual(typed.dataTypes, { OrderDate: "Date", Amount: "Number", Code: "String" });
});

test("a column typed two ways, an unknown type, or a typed formula is refused", () => {
  const build = fields => PivotForge.PivotRequestBuilder.buildRequest(fields);
  const amount = { dataField: "Amount", area: "data", aggregation: "sum" };

  assert.throws(() => build([
    { dataField: "OrderDate", area: "row", groupInterval: "year", dataType: "date" },
    { dataField: "OrderDate", area: "column", dataType: "string" },
    amount
  ]), /one data type/);
  assert.throws(() => build([{ dataField: "Region", area: "row", dataType: "money" }, amount]), /Unknown dataType/);
  assert.throws(() => build([
    amount,
    { dataField: "Margin", area: "data", expression: "[Amount] / 2", dataType: "number" }
  ]), /cannot be combined with "expression"/);
});

test("a value's running total is sent as the engine's direction, and only on a value", () => {
  const request = PivotForge.PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum", runningTotal: "column" },
    { dataField: "Quantity", area: "data", aggregation: "sum" }
  ]);

  assert.equal(request.values[0].runningTotal, "Column");
  assert.equal("runningTotal" in request.values[1], false);
  assert.throws(() => PivotForge.PivotRequestBuilder.buildRequest([
    { dataField: "Region", area: "row", runningTotal: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]), /only valid on a "data" field/);
  assert.throws(() => PivotForge.PivotRequestBuilder.buildRequest([
    { dataField: "Amount", area: "data", aggregation: "sum", runningTotal: "diagonal" }
  ]), /Unknown runningTotal/);
});

test("the formula parser reads the relative functions the engine does", () => {
  const parse = PivotForge.PivotRequestBuilder.parseExpression;

  const growth = parse("([Amount] - Prev([Amount])) / prev([Amount])");
  assert.deepEqual(growth.fields, ["Amount"]);

  const slice = parse("Slice([Amount] - [Cost], [Year], -1)");
  assert.deepEqual(slice.fields, ["Amount", "Cost"]);
  assert.deepEqual(slice.sliceFields, ["Year"]);

  for (const [formula, code] of [
    ["Prev()", "unexpected"],
    ["Slice([Amount], -1)", "sliceField"],
    ["Slice([Amount], [Year], x)", "sliceOffset"],
    ["Slice([Amount], [Year])", "expected"],
    ["GrandTotal([Amount]", "end"]
  ]) {
    assert.throws(() => parse(formula), error => error.code === code, formula);
  }
});

test("sortBy and sortingMethod travel in the level's field sort", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row", sortBy: "displayText" },
    { dataField: "yil", area: "column", sortBy: "none", sortOrder: "Descending" },
    { dataField: "oncelik", area: "row", sortingMethod: "priority" },
    { dataField: "bolge", area: "row", sortBy: "value" },
    salesFields[2]
  ]);

  assert.deepEqual(request.fieldSorts, [
    { field: "urun", direction: "Ascending", sortBy: "DisplayText" },
    { field: "yil", direction: "Descending", sortBy: "None" },
    { field: "oncelik", direction: "Ascending", sortingMethod: "priority" },
    // "value" is the default, so it says nothing of its own.
    { field: "bolge", direction: "Ascending" }
  ]);
});

test("a column value sort keeps the level's criterion as its tie-break", () => {
  const request = PivotRequestBuilder.buildRequest([
    salesFields[0],
    { ...salesFields[1], sortingMethod: "fiscal" },
    salesFields[2]
  ], { columnSort: { valueKey: "tutar_sum", direction: "Descending" } });

  assert.deepEqual(request.fieldSorts, [
    { field: "yil", direction: "Descending", valueKey: "tutar_sum", sortingMethod: "fiscal" }
  ]);
});

test("sortBy and sortingMethod are refused where they mean nothing", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest([salesFields[0], { ...salesFields[2], sortBy: "none" }]),
    /"sortBy" is only valid on a "row" or "column" field/);
  assert.throws(
    () => PivotRequestBuilder.buildRequest([{ ...salesFields[0], sortBy: "text" }, salesFields[2]]),
    /Unknown sortBy "text"/);
  assert.throws(
    () => PivotRequestBuilder.buildRequest([{ ...salesFields[0], sortingMethod: " " }, salesFields[2]]),
    /must be the name of a comparer registered on the server/);
});

test("a selector travels by column, and a column has one", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "FiscalYear", area: "row", selector: "fiscalYear" },
    { dataField: "OrderDate", area: "column", groupInterval: "year", selector: "shipDate" },
    { dataField: "OrderDate", area: "column", groupInterval: "month", selector: "shipDate" },
    { dataField: "Net", area: "data", aggregation: "sum", selector: "net" }
  ]);

  assert.deepEqual(request.selectors, { FiscalYear: "fiscalYear", OrderDate: "shipDate", Net: "net" });
  assert.equal(PivotRequestBuilder.buildRequest(salesFields).selectors, undefined);
  assert.throws(
    () => PivotRequestBuilder.buildRequest([
      { dataField: "OrderDate", area: "row", groupInterval: "year", selector: "a" },
      { dataField: "OrderDate", area: "column", groupInterval: "month", selector: "b" },
      salesFields[2]
    ]),
    /names both selector "a" and "b"/);
});

test("a selector works the value out itself, so it takes no formula and no data type", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest([{ dataField: "x", area: "row", selector: "a", dataType: "number" }, salesFields[2]]),
    /cannot be combined with "dataType"/);
  assert.throws(
    () => PivotRequestBuilder.buildRequest([salesFields[0], { dataField: "y", area: "data", selector: "a", expression: "[tutar]" }]),
    /cannot be combined with "expression"/);
  assert.throws(
    () => PivotRequestBuilder.buildRequest([{ dataField: "x", area: "row", selector: "" }, salesFields[2]]),
    /must be the name of a selector registered on the server/);
});

// DevExtreme's groupName/groupIndex: the group field lends its settings to its
// levels and is no field of its own.
const dateGroup = [
  { dataField: "tutar", area: "data", aggregation: "sum" },
  { groupInterval: "month", groupName: "Date", groupIndex: 2 },
  { groupName: "Date", dataField: "tarih", dataType: "date", area: "column", expanded: false, caption: "Tarih" },
  { dataField: "urun", area: "row" },
  { groupName: "Date", groupIndex: 0, groupInterval: "year" },
  { groupName: "Date", groupInterval: "quarter", groupIndex: 1, area: "row" }
];

test("a group's levels take its settings and stand together in groupIndex order", () => {
  const fields = PivotRequestBuilder.normalizeFields(dateGroup);
  const levels = fields.filter(field => field.groupName === "Date");

  assert.equal(fields.length, 5);
  assert.deepEqual(levels.map(field => field.groupInterval), ["year", "quarter", "month"]);
  // The levels sit together where the first of them was declared.
  assert.deepEqual(fields.map(field => field.groupInterval ?? field.dataField), ["tutar", "year", "quarter", "month", "urun"]);
  assert.deepEqual(levels.map(field => field.dataField), ["tarih", "tarih", "tarih"]);
  assert.deepEqual(levels.map(field => field.groupCaption), ["Tarih", "Tarih", "Tarih"]);
  assert.equal(levels[0].area, "column");
  assert.equal(levels[0].expanded, false);
  // A level's own declaration wins over the group's.
  assert.equal(levels[1].area, "row");
});

test("a level without an index takes the next one, and a group without an area is offered unplaced", () => {
  const fields = PivotRequestBuilder.normalizeFields([
    dateGroup[0],
    { groupName: "When", dataField: "tarih" },
    { groupName: "When", groupInterval: "year" },
    { groupName: "When", groupInterval: "month" }
  ]);
  const levels = fields.filter(field => field.groupName === "When");

  assert.deepEqual(levels.map(field => field.groupIndex), [0, 1]);
  assert.deepEqual(levels.map(field => field.area), ["available", "available"]);
  assert.deepEqual(levels.map(field => field.role), ["dimension", "dimension"]);
  assert.equal(levels[0].groupCaption, "When");
});

test("a group is made of dimensions, with each level's index used once", () => {
  const level = { groupName: "D", dataField: "tarih", groupIndex: 0, groupInterval: "year" };
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ ...level, area: "data" }]),
    /a group's levels are dimensions/);
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([level, { ...level, groupInterval: "month" }, dateGroup[0]]),
    /two levels with groupIndex 0/);
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ ...level, groupIndex: -1 }, dateGroup[0]]),
    /whole number of 0 or more/);
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ groupName: "D", dataField: "tarih" }, dateGroup[0]]),
    /Group "D" has no levels/);
});
