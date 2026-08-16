const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

const PivotForge = globalThis.PivotForge;

const fields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

// Real DOM `children` is an HTMLCollection: length, indexed access and iteration,
// but no Array.prototype methods. The stub mirrors that contract so production
// code cannot lean on array methods that do not exist in a browser.
function asChildren(items) {
  const collection = {
    length: items.length,
    item: index => items[index] ?? null,
    [Symbol.iterator]: () => items[Symbol.iterator]()
  };
  items.forEach((item, index) => { collection[index] = item; });
  return collection;
}

function createContainer() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() { this._children = []; },
    appendChild(node) { (this._children ??= []).push(node); return node; },
    _children: [],
    get children() { return asChildren(this._children); }
  };
}

function createWidget(overrides = {}) {
  const calls = [];
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ cells: [], grandTotals: {} }) };
    },
    ...overrides
  });
  return { widget, calls };
}

test("sortBy sends the sort with the next request", async () => {
  const { widget, calls } = createWidget();

  await widget.sortBy({ mode: "rowLabel", direction: "descending", field: "urun" });

  assert.deepEqual(calls[0].rowSort, {
    mode: "rowLabel",
    direction: "descending",
    field: "urun"
  });
  assert.equal(widget.getState().rowSort.direction, "descending");
  widget.dispose();
});

test("sortBy is rejected when sorting is disabled", async () => {
  const { widget } = createWidget({ allowSorting: false });

  await assert.rejects(
    () => widget.sortBy({ mode: "rowLabel", direction: "ascending", field: "urun" }),
    /allowSorting is disabled/
  );
  widget.dispose();
});

test("setFilter adds a filter to the request", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum", "Helva"]);

  assert.deepEqual(calls[0].filters, [{ field: "urun", values: ["Lokum", "Helva"] }]);
  widget.dispose();
});

test("setFilter replaces an existing filter on the same field", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.setFilter("urun", ["Helva"]);

  assert.deepEqual(calls[1].filters, [{ field: "urun", values: ["Helva"] }]);
  widget.dispose();
});

test("setFilter with an empty list clears that field", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.setFilter("urun", []);

  assert.deepEqual(calls[1].filters, []);
  widget.dispose();
});

test("clearFilters removes every filter", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.clearFilters();

  assert.deepEqual(calls[1].filters, []);
  assert.deepEqual(widget.getState().filters, []);
  widget.dispose();
});

test("setFilter is rejected when filtering is disabled", async () => {
  const { widget } = createWidget({ allowFiltering: false });

  await assert.rejects(
    () => widget.setFilter("urun", ["Lokum"]),
    /allowFiltering is disabled/
  );
  widget.dispose();
});

test("the renderer receives a sort callback when sorting is enabled", () => {
  const captured = {};
  class FakeRenderer {
    constructor(container, options) { Object.assign(captured, options); }
    render() {}
  }
  const previous = PivotForge.PivotTableRenderer;
  PivotForge.PivotTableRenderer = FakeRenderer;

  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  assert.equal(typeof captured.onSortRequested, "function");
  assert.deepEqual(captured.rowFields, ["urun"]);
  assert.deepEqual(captured.rowFieldLabels, ["Ürün"]);

  widget.dispose();
  PivotForge.PivotTableRenderer = previous;
});
