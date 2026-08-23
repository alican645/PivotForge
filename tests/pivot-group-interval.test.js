const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

const PivotForge = globalThis.PivotForge;
const { normalizeFields, buildRequest } = PivotForge.PivotRequestBuilder;

// One date column carrying two levels, which is what a field name alone cannot
// express and the whole reason a level has a key of its own.
const dateHierarchy = [
  { dataField: "OrderDate", caption: "Yıl", area: "row", groupInterval: "year" },
  { dataField: "OrderDate", caption: "Ay", area: "row", groupInterval: "month" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" }
];

test("a plain field is its own key", () => {
  const [field] = normalizeFields([{ dataField: "Region", area: "row" }]);

  assert.equal(field.key, "Region");
  assert.equal(field.groupInterval, null);
});

test("a grouped level is keyed by its field and its interval", () => {
  const [year, month] = normalizeFields(dateHierarchy);

  assert.equal(year.key, "OrderDate:year");
  assert.equal(month.key, "OrderDate:month");
  assert.equal(month.dataField, "OrderDate");
});

test("a measure cannot be grouped, because there would be nothing left to sum", () => {
  assert.throws(
    () => normalizeFields([{ dataField: "Amount", area: "data", groupInterval: "month" }]),
    /only valid on a dimension field/);
});

test("an unknown interval is refused rather than ignored", () => {
  assert.throws(
    () => normalizeFields([{ dataField: "OrderDate", area: "row", groupInterval: "fortnight" }]),
    /Unknown groupInterval/);
});

test("a plain level goes on the wire as the field name it always was", () => {
  const request = buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["Region"]);
});

test("a grouped level names its interval on the wire", () => {
  const request = buildRequest(dateHierarchy);

  assert.deepEqual(request.rows, [
    { field: "OrderDate", interval: "year" },
    { field: "OrderDate", interval: "month" }
  ]);
});

test("a declared sort names the level rather than the column", () => {
  // Both levels are the same column: a sort naming "OrderDate" could not say
  // which of them it meant.
  const request = buildRequest([
    { dataField: "OrderDate", area: "row", groupInterval: "month", sortOrder: "Descending" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.fieldSorts, [{ field: "OrderDate:month", direction: "Descending" }]);
});

test("a filter on a grouped level travels as the column plus its interval", () => {
  // The values are month names; the engine has to collapse each record the same
  // way before comparing, or the filter would match nothing at all.
  const request = buildRequest(dateHierarchy, {
    filters: [{ field: "OrderDate:month", values: ["Nisan"], mode: "Include" }]
  });

  assert.deepEqual(request.filters, [
    { field: "OrderDate", values: ["Nisan"], mode: "Include", interval: "month" }
  ]);
});

test("a filter on a plain field is untouched", () => {
  const request = buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Amount", area: "data", aggregation: "sum" }
  ], { filters: [{ field: "Region", values: ["Ege"] }] });

  assert.deepEqual(request.filters, [{ field: "Region", values: ["Ege"], mode: "Include" }]);
});

test("the layout state seats both levels of one column at once", () => {
  const state = new PivotForge.PivotLayoutState(dateHierarchy);

  assert.deepEqual(state.getState().rows, ["OrderDate:year", "OrderDate:month"]);
  assert.equal(state.areaOf("OrderDate:month"), "row");
});

test("the layout state hands back the column and the interval it came from", () => {
  // toFields feeds the next request: emitting the key as a dataField would ask
  // the server for a column called "OrderDate:month".
  const state = new PivotForge.PivotLayoutState(dateHierarchy);

  const month = state.toFields().find(field => field.groupInterval === "month");

  assert.equal(month.dataField, "OrderDate");
  assert.equal(month.caption, "Ay");
  assert.equal(month.area, "row");
});

test("a grouped level survives being moved, with its interval", () => {
  const state = new PivotForge.PivotLayoutState(dateHierarchy);

  state.move("OrderDate:month", "column", 0);

  assert.equal(state.areaOf("OrderDate:month"), "column");
  assert.equal(state.areaOf("OrderDate:year"), "row");
  assert.deepEqual(
    buildRequest(state.toFields()).columns,
    [{ field: "OrderDate", interval: "month" }]);
});

test("a caption override follows the level, not the column", () => {
  const state = new PivotForge.PivotLayoutState(dateHierarchy);

  state.setCaption("OrderDate:month", "Sipariş Ayı");

  assert.equal(state.field("OrderDate:month").caption, "Sipariş Ayı");
  assert.equal(state.field("OrderDate:year").caption, "Yıl");
});

// --- what the widget sends and draws ----------------------------------------

function createContainer() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() {},
    appendChild(node) { return node; },
    children: []
  };
}

function createWidget() {
  const calls = [];
  const captured = {};
  class FakeRenderer {
    constructor(container, options) { Object.assign(captured, options); }
    render() {}
  }
  const previous = PivotForge.PivotTableRenderer;
  PivotForge.PivotTableRenderer = FakeRenderer;

  const widget = PivotForge.create(createContainer(), {
    fields: dateHierarchy,
    autoLoad: false,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ values: [], totalCount: 0 }) };
    }
  });

  PivotForge.PivotTableRenderer = previous;
  return { widget, calls, captured };
}

test("the renderer is told the levels, not the column twice", () => {
  // Both row headers come from OrderDate; naming them by column would give the
  // header funnel and the sort button the same field twice.
  const { widget, captured } = createWidget();

  assert.deepEqual(captured.rowFields, ["OrderDate:year", "OrderDate:month"]);
  assert.deepEqual(captured.rowFieldLabels, ["Yıl", "Ay"]);
  widget.dispose();
});

test("listing a grouped level's values asks for groups, not timestamps", () => {
  const { widget, calls } = createWidget();

  return widget.fieldValues("OrderDate:month").then(() => {
    assert.equal(calls[0].body.field, "OrderDate");
    assert.equal(calls[0].body.interval, "month");
    widget.dispose();
  });
});

test("listing a plain field's values says nothing about intervals", () => {
  const { widget, calls } = createWidget();

  return widget.fieldValues("Amount").then(() => {
    assert.equal(calls[0].body.field, "Amount");
    assert.equal("interval" in calls[0].body, false);
    widget.dispose();
  });
});
