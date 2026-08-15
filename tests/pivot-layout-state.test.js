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

test("a field already in the target area cannot be dropped there again", () => {
  assert.equal(create().canDrop("Region", "row"), false);
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
