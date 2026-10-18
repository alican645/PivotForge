const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-remote-store.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");
const { createLoader } = require("./helpers/fake-data-source-loader.js");

const PivotForge = globalThis.PivotForge;

// A grid declared with a remote store: it never calls the PivotForge
// endpoints, and what it draws is built from the backend's groups.
const records = [
  { Region: "Ege", OrderDate: "2024-01-15T00:00:00", Amount: 100 },
  { Region: "Ege", OrderDate: "2024-04-02T00:00:00", Amount: 50 },
  { Region: "Marmara", OrderDate: "2025-01-20T00:00:00", Amount: 200 }
];

const fields = [
  { caption: "Bölge", dataField: "Region", area: "row" },
  { caption: "Çeyrek", dataField: "OrderDate", groupInterval: "quarter", area: "column" },
  { caption: "Tutar", dataField: "Amount", area: "data", aggregation: "sum" }
];

function createContainer() {
  return {
    className: "",
    textContent: "",
    _children: [],
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      remove(name) { this.names.delete(name); },
      toggle(name, on) { on ? this.names.add(name) : this.names.delete(name); },
      contains(name) { return this.names.has(name); }
    },
    replaceChildren(...nodes) { this._children = nodes; },
    appendChild(node) { this._children.push(node); return node; }
  };
}

function createWidget(overrides = {}, data = records) {
  const loader = createLoader(data);
  const posted = [];
  const rendered = [];
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    store: { type: "remote", load: loader.load },
    rendererOptions: { culture: "tr-TR" },
    renderImpl: result => rendered.push(result),
    fetchImpl: async url => {
      posted.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    },
    ...overrides
  });

  return { widget, loader, posted, rendered };
}

test("a remote grid loads from its store and draws what the store built", async () => {
  const { widget, loader, posted, rendered } = createWidget();

  await widget.refresh();

  assert.deepEqual(posted, []);
  assert.equal(loader.calls.length, 2);
  assert.deepEqual(rendered[0].rowHeaders, [["Ege"], ["Marmara"]]);
  assert.deepEqual(rendered[0].columnHeaders, [["Q1"], ["Q2"]]);
  assert.deepEqual(rendered[0].grandTotals, { Amount_sum: 350 });
  widget.dispose();
});

test("the filter picker and the drill-down ask the store too", async () => {
  const { widget, posted } = createWidget();

  const values = await widget.fieldValues("OrderDate:quarter");
  assert.deepEqual(values.values, ["Q1", "Q2"]);

  const drill = await widget.drillDown({ rowPath: ["Ege"], columnPath: ["Q1"], valueKey: "Amount_sum" });
  assert.deepEqual(drill.records, [records[0]]);
  assert.deepEqual(posted, []);
  widget.dispose();
});

test("a remote grid that declares no fields discovers them from the store", async () => {
  const { widget, loader, rendered } = createWidget({ fields: [] });

  await widget.refresh();

  assert.deepEqual(loader.calls[0], { skip: 0, take: 20 });
  assert.deepEqual(widget.declaredFields.map(field => field.dataField + (field.groupInterval ? `:${field.groupInterval}` : "")), [
    "Region", "OrderDate:year", "OrderDate:quarter", "OrderDate:month", "Amount"
  ]);
  // Nothing is placed yet, so nothing is summed.
  assert.deepEqual(rendered.at(-1).rowHeaders, []);
  widget.dispose();
});

test("what only the PivotForge endpoints can do is refused when the grid is declared", () => {
  assert.throws(() => createWidget({ largeData: true }), /largeData pages a result/);
  assert.throws(() => createWidget({ topN: [{ field: "Region", count: 1 }] }), /cannot rank groups/);
  assert.throws(() => createWidget({ fields: [fields[0], { dataField: "Amount", area: "data", aggregation: "median" }] }),
    /summarized by "median"/);
  assert.throws(() => createWidget({ store: { type: "olap" } }), /Unknown store type "olap"\. Expected "remote" or "xmla"/);
});

test("value filters are not offered, and one set from code is refused", async () => {
  const { widget } = createWidget();

  assert.equal(widget.supportsValueFilters, false);
  assert.deepEqual(widget.designerCapabilities(), {
    allowCalculatedFields: false,
    aggregations: ["sum", "count", "average", "min", "max"]
  });
  await assert.rejects(widget.setValueFilter("Region", { operator: "GreaterThan", value: 10 }), /by their values/);
  widget.dispose();
});

test("a load function named on the page is found when the grid first loads", async () => {
  const loader = createLoader(records);
  const { widget, rendered } = createWidget({ store: { type: "remote", load: "app.remote.load" } });
  globalThis.app = { remote: { load: loader.load } };

  try {
    await widget.refresh();
    assert.deepEqual(rendered[0].grandTotals, { Amount_sum: 350 });
  } finally {
    delete globalThis.app;
    widget.dispose();
  }
});

test("a failed load is shown as the grid's error", async () => {
  const errors = [];
  const { widget } = createWidget({
    store: { type: "remote", load: async () => { throw new Error("Backend unavailable."); } }
  });
  widget.on("error", error => errors.push(error.message));

  await widget.refresh();

  assert.deepEqual(errors, ["Backend unavailable."]);
  widget.dispose();
});
