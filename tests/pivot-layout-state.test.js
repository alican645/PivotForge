const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");

const PivotForge = globalThis.PivotForge;

const catalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure" },
  { dataField: "Quarter", caption: "Çeyrek", area: "available", role: "dimension" }
];

const create = () => new PivotForge.PivotLayoutState(catalog);

test("the initial layout comes from the declared areas", () => {
  const state = create().getState();

  assert.deepEqual(state.rows, ["Region", "Category"]);
  assert.deepEqual(state.columns, ["Year"]);
  assert.deepEqual(state.values, [{ field: "Amount", aggregation: "sum", showAs: "normal" }]);
  assert.deepEqual(state.filters, []);
});

test("available is derived from what is not placed", () => {
  assert.deepEqual(create().getState().available, ["Quantity", "Quarter"]);
});

test("a dimension may drop into row, column, and filter but not data", () => {
  const state = create();

  assert.equal(state.canDrop("Quarter", "row"), true);
  assert.equal(state.canDrop("Quarter", "column"), true);
  assert.equal(state.canDrop("Quarter", "filter"), true);
  assert.equal(state.canDrop("Quarter", "data"), false);
});

test("a measure may drop into data only", () => {
  const state = create();

  assert.equal(state.canDrop("Quantity", "data"), true);
  assert.equal(state.canDrop("Quantity", "row"), false);
  assert.equal(state.canDrop("Quantity", "column"), false);
  assert.equal(state.canDrop("Quantity", "filter"), false);
});

// Dropping a field into the area it already occupies is how reordering is
// expressed: the drop carries the position it landed on.
test("a field may be dropped into the area it already occupies, to reposition it", () => {
  assert.equal(create().canDrop("Region", "row"), true);
});

test("the role rule still applies to a field dropped into its own area", () => {
  const state = create();

  state.move("Quantity", "data");
  assert.equal(state.canDrop("Quantity", "data"), true);
  assert.equal(state.canDrop("Quantity", "row"), false);
});

// move() detaches before inserting, so for a same-area move every index after
// the field's own position shifts down by one. Without compensation the field
// lands one slot too far right.
test("moving a field later within its own area lands it exactly where it was dropped", () => {
  const state = create();
  state.move("Quarter", "row", 2);
  assert.deepEqual(state.getState().rows, ["Region", "Category", "Quarter"]);

  // Drop "Region" onto the slot before "Quarter".
  state.move("Region", "row", 2);
  assert.deepEqual(state.getState().rows, ["Category", "Region", "Quarter"]);
});

test("moving a field earlier within its own area needs no compensation", () => {
  const state = create();
  state.move("Quarter", "row", 2);

  state.move("Quarter", "row", 0);
  assert.deepEqual(state.getState().rows, ["Quarter", "Region", "Category"]);
});

test("moving a field to the end of its own area appends it last", () => {
  const state = create();

  state.move("Region", "row", 2);
  assert.deepEqual(state.getState().rows, ["Category", "Region"]);
});

test("a same-area move keeps the value entry's aggregation instead of resetting it", () => {
  const state = create();
  state.move("Quantity", "data", 1);
  state.setAggregation("Quantity", "average");

  state.move("Quantity", "data", 0);

  assert.deepEqual(state.getState().values, [
    { field: "Quantity", aggregation: "average", showAs: "normal" },
    { field: "Amount", aggregation: "sum", showAs: "normal" }
  ]);
});

test("move places a field at the requested index", () => {
  const state = create();

  state.move("Quarter", "row", 1);

  assert.deepEqual(state.getState().rows, ["Region", "Quarter", "Category"]);
});

test("move without an index appends", () => {
  const state = create();

  state.move("Quarter", "row");

  assert.deepEqual(state.getState().rows, ["Region", "Category", "Quarter"]);
});

test("move removes the field from its previous area", () => {
  const state = create();

  state.move("Year", "row", 0);

  assert.deepEqual(state.getState().columns, []);
  assert.deepEqual(state.getState().rows, ["Year", "Region", "Category"]);
});

test("moving a measure into data gives it the default sum aggregation", () => {
  const state = create();

  state.move("Quantity", "data");

  assert.deepEqual(state.getState().values, [
    { field: "Amount", aggregation: "sum", showAs: "normal" },
    { field: "Quantity", aggregation: "sum", showAs: "normal" }
  ]);
});

test("an invalid move throws and leaves the state untouched", () => {
  const state = create();
  const before = state.getState();

  assert.throws(() => state.move("Quantity", "row"), /cannot be placed in area "row"/);
  assert.deepEqual(state.getState(), before);
});

test("remove returns a field to available", () => {
  const state = create();

  state.remove("Year");

  assert.deepEqual(state.getState().columns, []);
  assert.equal(state.getState().available.includes("Year"), true);
});

test("removing the last data field is refused", () => {
  const state = create();

  assert.throws(() => state.remove("Amount"), /last field in the data area/);
  assert.deepEqual(state.getState().values.length, 1);
});

test("removing a data field is allowed once another one exists", () => {
  const state = create();

  state.move("Quantity", "data");
  state.remove("Amount");

  assert.deepEqual(state.getState().values, [
    { field: "Quantity", aggregation: "sum", showAs: "normal" }
  ]);
});

test("reorder moves a field within its area", () => {
  const state = create();

  state.reorder("row", 0, 1);

  assert.deepEqual(state.getState().rows, ["Category", "Region"]);
});

test("reorder moves a field to a middle index, distinguishable from an append", () => {
  const state = create();
  state.move("Quarter", "row"); // rows: ["Region", "Category", "Quarter"]

  state.reorder("row", 0, 1);

  // An append (ignoring toIndex) would give ["Category", "Quarter", "Region"].
  assert.deepEqual(state.getState().rows, ["Category", "Region", "Quarter"]);
});

// Object-array areas (values, filters) go through the same reorder() path as the
// plain-name areas (rows, columns), but hold {field, ...} objects instead of bare
// names — worth covering separately since a slice/splice mistake could behave
// differently against objects.
const reorderCatalog = [
  { dataField: "A", caption: "A", area: "data", aggregation: "sum" },
  { dataField: "B", caption: "B", area: "data", aggregation: "sum" },
  { dataField: "C", caption: "C", area: "data", aggregation: "sum" },
  { dataField: "X", caption: "X", area: "filter" },
  { dataField: "Y", caption: "Y", area: "filter" },
  { dataField: "Z", caption: "Z", area: "filter" }
];

test("reorder moves a value entry to a middle index", () => {
  const state = new PivotForge.PivotLayoutState(reorderCatalog);

  state.reorder("data", 0, 1);

  assert.deepEqual(state.getState().values.map(value => value.field), ["B", "A", "C"]);
});

test("reorder moves a filter entry to a middle index", () => {
  const state = new PivotForge.PivotLayoutState(reorderCatalog);

  state.reorder("filter", 0, 1);

  assert.deepEqual(state.getState().filters.map(filter => filter.field), ["Y", "X", "Z"]);
});

test("reorder rejects a fromIndex outside the area's bounds, including negative", () => {
  const state = create();

  assert.throws(() => state.reorder("row", -1, 0), /index -1 in area "row"/);
  assert.throws(() => state.reorder("row", 5, 0), /index 5 in area "row"/);
});

test("reorder rejects a toIndex outside the area's bounds, including negative", () => {
  const state = create();

  assert.throws(() => state.reorder("row", 0, -1), /area "row"/);
  assert.throws(() => state.reorder("row", 0, 5), /area "row"/);
});

test("an out-of-bounds reorder leaves the state untouched and emits no change", () => {
  const state = create();
  const before = state.getState();
  let changes = 0;
  state.on("change", () => changes++);

  assert.throws(() => state.reorder("row", -1, 0));

  assert.deepEqual(state.getState(), before);
  assert.equal(changes, 0);
});

test("setAggregation changes a data field", () => {
  const state = create();

  state.setAggregation("Amount", "average");

  assert.equal(state.getState().values[0].aggregation, "average");
});

test("setAggregation on a field outside the data area throws", () => {
  assert.throws(() => create().setAggregation("Region", "sum"), /not in the data area/);
});

test("setAggregation rejects an unknown aggregation", () => {
  assert.throws(() => create().setAggregation("Amount", "median"), /Unknown aggregation/);
});

test("getState returns a copy that cannot mutate the state", () => {
  const state = create();
  const snapshot = state.getState();

  snapshot.rows.push("Quarter");

  assert.deepEqual(state.getState().rows, ["Region", "Category"]);
});

test("getState returns value entries that cannot mutate the state", () => {
  const state = create();
  const snapshot = state.getState();

  snapshot.values[0].aggregation = "count";

  assert.equal(state.getState().values[0].aggregation, "sum");
});

test("getState returns filter entries that cannot mutate the state", () => {
  const state = create();
  state.move("Quarter", "filter");
  const snapshot = state.getState();

  snapshot.filters[0].values.push("Q1");

  assert.deepEqual(state.getState().filters[0].values, []);
});

test("toFields produces a list buildRequest accepts", () => {
  const state = create();
  state.move("Quarter", "filter");

  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  assert.deepEqual(request.rows, ["Region", "Category"]);
  assert.deepEqual(request.columns, ["Year"]);
  assert.equal(request.values.length, 1);
});

test("toRequestState carries fields and filters but never rowSort", () => {
  const requestState = create().toRequestState();

  assert.equal(Array.isArray(requestState.fields), true);
  assert.deepEqual(requestState.filters, []);
  assert.equal("rowSort" in requestState, false);
});

test("toRequestState keeps a filter with selected values but drops one with none", () => {
  // docs/aspnetcore-integration.md documents filters as pre-filtered to entries
  // that actually have a selection; construct one of each kind via adoptLayout,
  // since PivotLayoutState has no interactive way to populate filter values.
  const state = new PivotForge.PivotLayoutState(catalog, {
    rows: [],
    columns: [],
    values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
    filters: [
      { field: "Quarter", values: ["Q1"] },
      { field: "Region", values: [] }
    ]
  });

  assert.deepEqual(
    state.toRequestState().filters, [{ field: "Quarter", values: ["Q1"], mode: "Include" }]);
});

test("each mutation emits exactly one change event", () => {
  const state = create();
  let changes = 0;
  state.on("change", () => changes++);

  state.move("Quarter", "row");
  state.reorder("row", 0, 1);
  state.setAggregation("Amount", "min");
  state.remove("Quarter");

  assert.equal(changes, 4);
});

test("a refused mutation emits no change event", () => {
  const state = create();
  let changes = 0;
  state.on("change", () => changes++);

  assert.throws(() => state.move("Quantity", "row"));
  assert.throws(() => state.remove("Amount"));

  assert.equal(changes, 0);
});

test("on returns an unsubscribe function", () => {
  const state = create();
  let changes = 0;
  const off = state.on("change", () => changes++);

  off();
  state.move("Quarter", "row");

  assert.equal(changes, 0);
});

test("a layout naming a field absent from the catalog throws", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(catalog, {
      rows: ["Bilinmeyen"],
      columns: [],
      values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
      filters: []
    }),
    /"Bilinmeyen" is not in the catalog/
  );
});

test("an explicit layout overrides the declared areas", () => {
  const state = new PivotForge.PivotLayoutState(catalog, {
    rows: ["Quarter"],
    columns: [],
    values: [{ field: "Quantity", aggregation: "average", showAs: "normal" }],
    filters: []
  });

  assert.deepEqual(state.getState().rows, ["Quarter"]);
  assert.deepEqual(state.getState().values, [
    { field: "Quantity", aggregation: "average", showAs: "normal" }
  ]);
  assert.equal(state.getState().available.includes("Region"), true);
});

test("a catalog without a data field throws", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState([{ dataField: "Region", area: "row" }]),
    /at least one field in the data area/
  );
});

test("an explicit layout with an unknown aggregation is rejected at construction, not later", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(catalog, {
      rows: [],
      columns: [],
      values: [{ field: "Amount", aggregation: "median", showAs: "normal" }],
      filters: []
    }),
    /unknown aggregation "median"/
  );
});

test("an explicit layout with an unknown showAs is rejected at construction", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(catalog, {
      rows: [],
      columns: [],
      values: [{ field: "Amount", aggregation: "sum", showAs: "medianOfPrevious" }],
      filters: []
    }),
    /unknown showAs "medianOfPrevious"/
  );
});

test("an explicit layout seating a measure outside the data area is rejected", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(catalog, {
      rows: ["Quantity"],
      columns: [],
      values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
      filters: []
    }),
    /Layout field "Quantity" cannot be placed in area "row"/
  );
});

test("an explicit layout seating a dimension in the data area is rejected", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(catalog, {
      rows: [],
      columns: [],
      values: [{ field: "Quarter", aggregation: "sum", showAs: "normal" }],
      filters: []
    }),
    /Layout field "Quarter" cannot be placed in area "data"/
  );
});

test("an invisible declared field stays out of the initial layout", () => {
  const state = new PivotForge.PivotLayoutState([
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Hidden", caption: "Gizli", area: "row", visible: false },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(state.getState().rows, ["Region"]);
  assert.equal(state.getState().available.includes("Hidden"), true);
});

test("toFields carries visible, so a hidden field stays out of the request even after it is dragged into a zone", () => {
  const state = new PivotForge.PivotLayoutState([
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Hidden", caption: "Gizli", area: "row", visible: false },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
  ]);

  // "Hidden" starts available (previous test); place it, simulating a user
  // dragging it into the row zone from the designer's available list.
  state.move("Hidden", "row");

  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  assert.deepEqual(request.rows, ["Region"]);
});

test("toFields round-trips through buildRequest unaffected by an invisible field, after a mutation elsewhere", () => {
  const state = new PivotForge.PivotLayoutState([
    { dataField: "Region", caption: "Bölge", area: "row" },
    { dataField: "Hidden", caption: "Gizli", area: "row", visible: false },
    { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
    { dataField: "Category", caption: "Kategori", area: "available", role: "dimension" }
  ]);

  state.move("Category", "row");

  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  assert.deepEqual(request.rows, ["Region", "Category"]);
});

// --- Value formats -------------------------------------------------------
//
// A format is layout state, not catalog config: the user changes it at runtime
// through the designer, and a saved layout has to carry it back.

const formatCatalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  {
    dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum",
    format: { type: "currency", decimals: 0, useGrouping: true, currency: "TRY" }
  },
  { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure" }
];

const withFormats = () => new PivotForge.PivotLayoutState(formatCatalog);

test("a declared format is carried into the value entry", () => {
  assert.deepEqual(withFormats().getState().values[0].format, {
    type: "currency", decimals: 0, useGrouping: true, currency: "TRY"
  });
});

test("a value with no declared format carries none, keeping the entry clean", () => {
  const state = create();

  assert.equal("format" in state.getState().values[0], false);
});

test("setFormat replaces a value's format and emits one change", () => {
  const state = withFormats();
  let changes = 0;
  state.on("change", () => { changes += 1; });

  state.setFormat("Amount", { type: "number", decimals: 2 });

  assert.deepEqual(state.getState().values[0].format, { type: "number", decimals: 2 });
  assert.equal(changes, 1);
});

test("setFormat(null) clears the format so no formatting is applied", () => {
  const state = withFormats();

  state.setFormat("Amount", null);

  assert.equal("format" in state.getState().values[0], false);
});

test("setFormat refuses a field that is not in the data area", () => {
  const state = withFormats();

  assert.throws(() => state.setFormat("Region", { decimals: 2 }), /data area/);
});

test("setFormat rejects an unknown format type", () => {
  assert.throws(() => withFormats().setFormat("Amount", { type: "scientific" }), /scientific/);
});

test("setFormat rejects a decimals value the Excel export could not render", () => {
  assert.throws(() => withFormats().setFormat("Amount", { decimals: 7 }), /decimals/);
  assert.throws(() => withFormats().setFormat("Amount", { decimals: -1 }), /decimals/);
  assert.throws(() => withFormats().setFormat("Amount", { decimals: 1.5 }), /decimals/);
});

test("setFormat rejects a non-boolean useGrouping", () => {
  assert.throws(() => withFormats().setFormat("Amount", { useGrouping: "yes" }), /useGrouping/);
});

test("a rejected setFormat leaves the format untouched and emits no change", () => {
  const state = withFormats();
  let changes = 0;
  state.on("change", () => { changes += 1; });

  assert.throws(() => state.setFormat("Amount", { decimals: 99 }));

  assert.deepEqual(state.getState().values[0].format, {
    type: "currency", decimals: 0, useGrouping: true, currency: "TRY"
  });
  assert.equal(changes, 0);
});

test("toFields reports the layout's format, not the catalog's", () => {
  const state = withFormats();
  state.setFormat("Amount", { type: "number", decimals: 3 });

  const value = state.toFields().find(field => field.dataField === "Amount");

  assert.deepEqual(value.format, { type: "number", decimals: 3 });
});

test("toFields reports no format once it has been cleared", () => {
  const state = withFormats();
  state.setFormat("Amount", null);

  assert.equal(state.toFields().find(field => field.dataField === "Amount").format, null);
});

test("repositioning a value keeps its format", () => {
  const state = withFormats();
  state.move("Quantity", "data");
  state.move("Amount", "data", 2);

  assert.deepEqual(state.getState().values.at(-1).format, {
    type: "currency", decimals: 0, useGrouping: true, currency: "TRY"
  });
});

test("a value moved into the data area picks up its declared format", () => {
  const state = withFormats();
  // A pivot needs at least one value, so seat another before freeing Amount.
  state.move("Quantity", "data");
  state.remove("Amount");
  state.move("Amount", "data");

  assert.deepEqual(state.getState().values.at(-1).format, {
    type: "currency", decimals: 0, useGrouping: true, currency: "TRY"
  });
});

test("adoptLayout rejects a stored layout carrying an invalid format", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(formatCatalog, {
      rows: ["Region"],
      columns: [],
      values: [{ field: "Amount", aggregation: "sum", format: { decimals: 99 } }],
      filters: []
    }),
    /decimals/);
});

test("adoptLayout keeps a stored format", () => {
  const state = new PivotForge.PivotLayoutState(formatCatalog, {
    rows: ["Region"],
    columns: [],
    values: [{ field: "Amount", aggregation: "sum", format: { type: "percent", decimals: 1 } }],
    filters: []
  });

  assert.deepEqual(state.getState().values[0].format, { type: "percent", decimals: 1 });
});

test("a caption override reaches every consumer of field()", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  state.setCaption("Region", "Satış Bölgesi");

  assert.equal(state.field("Region").caption, "Satış Bölgesi");
  assert.equal(
    state.toFields().find(field => field.dataField === "Region").caption,
    "Satış Bölgesi");
});

test("the declared caption stays recoverable behind an override", () => {
  const state = new PivotForge.PivotLayoutState(catalog);
  state.setCaption("Region", "Satış Bölgesi");

  assert.equal(state.declaredCaption("Region"), "Bölge");
});

test("clearing a caption restores the declared one", () => {
  const state = new PivotForge.PivotLayoutState(catalog);
  state.setCaption("Region", "Satış Bölgesi");

  state.setCaption("Region", "");

  assert.equal(state.field("Region").caption, "Bölge");
  assert.deepEqual(state.getState().captions, {});
});

test("a caption equal to the declared one is not stored as an override", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  state.setCaption("Region", "Bölge");

  assert.deepEqual(state.getState().captions, {});
});

test("a caption is trimmed before it is stored", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  state.setCaption("Region", "  Satış Bölgesi  ");

  assert.equal(state.field("Region").caption, "Satış Bölgesi");
});

test("setting a caption emits a change", () => {
  const state = new PivotForge.PivotLayoutState(catalog);
  let changes = 0;
  state.on("change", () => { changes++; });

  state.setCaption("Region", "Satış Bölgesi");

  assert.equal(changes, 1);
});

test("an unknown field cannot be renamed", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  assert.throws(() => state.setCaption("Nope", "x"), /catalog/);
});

test("showAs is written to the value entry and carried into the fields", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  state.setShowAs("Amount", "percentOfRowTotal");

  assert.equal(state.getState().values[0].showAs, "percentOfRowTotal");
  assert.equal(
    state.toFields().find(field => field.dataField === "Amount").showAs,
    "percentOfRowTotal");
});

test("an unknown showAs is refused rather than coerced", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  assert.throws(() => state.setShowAs("Amount", "nonsense"), /Unknown showAs/);
});

test("showAs cannot be set on a field outside the data area", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  assert.throws(() => state.setShowAs("Region", "normal"), /not in the data area/);
});

test("filter values are written to the filter entry and reach the request", () => {
  const state = create();
  state.move("Quarter", "filter");

  state.setFilterValues("Quarter", ["Q1", "Q3"]);

  assert.deepEqual(
    state.getState().filters, [{ field: "Quarter", values: ["Q1", "Q3"], mode: "Include" }]);
  assert.deepEqual(
    state.toRequestState().filters, [{ field: "Quarter", values: ["Q1", "Q3"], mode: "Include" }]);
});

test("an empty filter selection is dropped from the request rather than sent", () => {
  const state = create();
  state.move("Quarter", "filter");
  state.setFilterValues("Quarter", ["Q1"]);

  state.setFilterValues("Quarter", []);

  assert.deepEqual(state.getState().filters, [{ field: "Quarter", values: [], mode: "Include" }]);
  assert.deepEqual(state.toRequestState().filters, []);
});

test("filter values are stringified, with blank standing in for null", () => {
  const state = create();
  state.move("Year", "filter");

  state.setFilterValues("Year", [2025, null, "2026"]);

  assert.deepEqual(state.getState().filters[0].values, ["2025", "", "2026"]);
});

test("a row field can be filtered where it stands, without moving zones", () => {
  const state = create();

  state.setFilterValues("Region", ["East"]);

  const view = state.getState();
  assert.deepEqual(view.filters, [{ field: "Region", values: ["East"], mode: "Include" }]);
  // The filter is the field's, not the Filters zone's: Region stays a row field
  // and must not be emitted as a filter-area one on top of that.
  assert.equal(state.areaOf("Region"), "row");
  assert.deepEqual(
    state.toFields().filter(field => field.dataField === "Region").map(field => field.area),
    ["row"]);
});

test("a measure has nothing to filter", () => {
  const state = create();

  assert.throws(() => state.setFilterValues("Amount", ["1"]), /cannot be filtered/);
});

test("a refused filter selection leaves no entry behind", () => {
  const state = create();

  assert.throws(() => state.setFilterValues("Region", "East"), /must be an array/);
  assert.deepEqual(state.getState().filters, []);
});

test("a non-array filter selection is refused rather than coerced", () => {
  const state = create();
  state.move("Quarter", "filter");

  assert.throws(() => state.setFilterValues("Quarter", "Q1"), /must be an array/);
});

test("setting filter values notifies change subscribers", () => {
  const state = create();
  state.move("Quarter", "filter");
  let seen = null;
  state.on("change", next => { seen = next; });

  state.setFilterValues("Quarter", ["Q1"]);

  assert.deepEqual(seen.filters, [{ field: "Quarter", values: ["Q1"], mode: "Include" }]);
});

// --- Caption round-trip -----------------------------------------------------
// getState() has always emitted captions; adoptLayout never read them back, so
// a saved view silently lost every rename.

const savedLayout = extra => ({
  rows: ["Region", "Category"],
  columns: ["Year"],
  values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
  filters: [],
  ...extra
});

test("a renamed caption survives a save and restore round trip", () => {
  const source = create();
  source.setCaption("Region", "Satış Bölgesi");

  const restored = new PivotForge.PivotLayoutState(catalog, source.getState());

  assert.equal(restored.field("Region").caption, "Satış Bölgesi");
  assert.deepEqual(restored.getState().captions, { Region: "Satış Bölgesi" });
});

test("a restored caption is still resettable to the declared one", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog, savedLayout({ captions: { Region: "Satış Bölgesi" } }));

  state.setCaption("Region", "");

  assert.equal(state.field("Region").caption, "Bölge");
  assert.deepEqual(state.getState().captions, {});
});

test("a caption for a field the catalog no longer has is ignored, not fatal", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog, savedLayout({ captions: { Gone: "Eski Alan", Region: "Satış Bölgesi" } }));

  assert.equal(state.field("Region").caption, "Satış Bölgesi");
  assert.deepEqual(state.getState().captions, { Region: "Satış Bölgesi" });
});

test("a restored caption equal to the declared one is not kept as an override", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog, savedLayout({ captions: { Region: "Bölge" } }));

  assert.deepEqual(state.getState().captions, {});
});

test("a blank or non-string restored caption is dropped rather than applied", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog, savedLayout({ captions: { Region: "   ", Category: 42, Year: null } }));

  assert.equal(state.field("Region").caption, "Bölge");
  assert.equal(state.field("Category").caption, "Kategori");
  assert.deepEqual(state.getState().captions, {});
});

test("a layout with no captions at all restores exactly as before", () => {
  const state = new PivotForge.PivotLayoutState(catalog, savedLayout());

  assert.deepEqual(state.getState().captions, {});
  assert.equal(state.field("Region").caption, "Bölge");
});

test("a restored caption is trimmed the same way setCaption trims one", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog, savedLayout({ captions: { Region: "  Satış Bölgesi  " } }));

  assert.equal(state.field("Region").caption, "Satış Bölgesi");
});

test("a declared showTotals survives a layout mutation", () => {
  // Without this, dragging any chip anywhere silently restored the subtotals a
  // field had opted out of: toFields() rebuilds the field list from the layout,
  // and whatever it forgets to carry reverts to the normalizeField default.
  const state = new PivotForge.PivotLayoutState([
    ...catalog.map(field =>
      field.dataField === "Category" ? { ...field, showTotals: false, expanded: false } : field)
  ]);

  state.reorder("row", 0, 1);
  const [carried] = PivotForge.PivotRequestBuilder
    .normalizeFields(state.toFields())
    .filter(field => field.dataField === "Category");

  assert.equal(carried.showTotals, false);
  assert.equal(carried.expanded, false);
});

test("a declared sortOrder survives a layout mutation", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Year" ? { ...field, sortOrder: "Descending" } : field));

  state.move("Quarter", "column", 0);
  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  assert.deepEqual(request.fieldSorts, [{ field: "Year", direction: "Descending" }]);
});

test("a row-only declaration is dropped when the field moves to another area", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Category" ? { ...field, showTotals: false } : field));

  // showTotals means nothing on the column axis and normalizeField refuses it
  // there, so carrying it along would turn a legal drag into an exception.
  state.move("Category", "column", 0);
  const emitted = state.toFields().find(field => field.dataField === "Category");

  assert.equal(emitted.showTotals, undefined);
  assert.doesNotThrow(() => PivotForge.PivotRequestBuilder.buildRequest(state.toFields()));
});

test("areaIndex is not re-emitted, so a move is not undone by the declaration", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Region" ? { ...field, areaIndex: 0 }
        : field.dataField === "Category" ? { ...field, areaIndex: 1 } : field));

  state.reorder("row", 0, 1);
  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  // areaIndex declares the opening order; once the user has moved a chip the
  // layout owns the order, and re-applying the declaration would undo the move.
  assert.deepEqual(request.rows, ["Category", "Region"]);
});

test("areaIndex decides the opening layout", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Region" ? { ...field, areaIndex: 1 }
        : field.dataField === "Category" ? { ...field, areaIndex: 0 } : field));

  assert.deepEqual(state.getState().rows, ["Category", "Region"]);
});

test("a filter placed in the designer starts out including", () => {
  const state = create();
  state.move("Quarter", "filter");

  assert.equal(state.getState().filters[0].mode, "Include");
});

test("a field declared in the filter area starts out including", () => {
  const state = new PivotForge.PivotLayoutState(
    catalog.map(field =>
      field.dataField === "Quarter" ? { ...field, area: "filter" } : field));

  assert.deepEqual(
    state.getState().filters, [{ field: "Quarter", values: [], mode: "Include" }]);
});

test("setFilterMode switches which side of the list is stored", () => {
  const state = create();
  state.move("Quarter", "filter");
  state.setFilterValues("Quarter", ["Q1"]);

  state.setFilterMode("Quarter", "Exclude");

  assert.deepEqual(
    state.toRequestState().filters,
    [{ field: "Quarter", values: ["Q1"], mode: "Exclude" }]);
});

test("setFilterMode refuses a mode the engine has never heard of", () => {
  const state = create();
  state.move("Quarter", "filter");

  assert.throws(() => state.setFilterMode("Quarter", "exclude"), /Unknown filter mode/);
});

test("a row field's filter can exclude just as a filter-zone one can", () => {
  const state = create();

  state.setFilterMode("Region", "Exclude");
  state.setFilterValues("Region", ["East"]);

  assert.deepEqual(
    state.getState().filters, [{ field: "Region", values: ["East"], mode: "Exclude" }]);
});

test("a refused mode leaves no entry behind", () => {
  const state = create();

  assert.throws(() => state.setFilterMode("Region", "Sadece"), /Unknown filter mode/);
  assert.deepEqual(state.getState().filters, []);
});

test("a filter follows its field from one area to another", () => {
  const state = create();
  state.setFilterValues("Region", ["East"]);

  state.move("Region", "column", 0);

  // Only removing the field drops the restriction; rearranging the layout is
  // not a way of clearing a filter by accident.
  assert.deepEqual(
    state.getState().filters, [{ field: "Region", values: ["East"], mode: "Include" }]);
  assert.equal(state.areaOf("Region"), "column");
});

test("a filtered field dragged into the filter zone keeps its selection", () => {
  const state = create();
  state.setFilterMode("Region", "Exclude");
  state.setFilterValues("Region", ["East"]);

  state.move("Region", "filter", 0);

  assert.deepEqual(
    state.getState().filters, [{ field: "Region", values: ["East"], mode: "Exclude" }]);
  assert.equal(state.areaOf("Region"), "filter");
  assert.deepEqual(
    state.toFields().filter(field => field.dataField === "Region").map(field => field.area),
    ["filter"]);
});

test("removing a field does drop its filter", () => {
  const state = create();
  state.setFilterValues("Region", ["East"]);

  state.remove("Region");

  assert.deepEqual(state.getState().filters, []);
  assert.equal(state.areaOf("Region"), "available");
});

test("a filter's mode survives a reorder of the filter zone", () => {
  const state = create();
  state.move("Quarter", "filter");
  state.move("Year", "filter");
  state.setFilterMode("Quarter", "Exclude");

  state.move("Quarter", "filter", 1);

  assert.equal(
    state.getState().filters.find(filter => filter.field === "Quarter").mode, "Exclude");
});

test("an adopted layout carrying an excluding filter keeps it", () => {
  const state = new PivotForge.PivotLayoutState(catalog, {
    rows: ["Region"],
    columns: [],
    values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
    filters: [{ field: "Quarter", values: ["Q1"], mode: "Exclude" }]
  });

  assert.equal(state.getState().filters[0].mode, "Exclude");
});

test("an adopted layout carrying an unknown filter mode is refused at construction", () => {
  assert.throws(() => new PivotForge.PivotLayoutState(catalog, {
    rows: ["Region"],
    columns: [],
    values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
    filters: [{ field: "Quarter", values: ["Q1"], mode: "exclude" }]
  }), /Unknown filter mode/);
});
