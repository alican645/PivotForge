const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-xmla-store.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");
const { createProvider, dataset, M } = require("./helpers/xmla-fixtures.js");

const PivotForge = globalThis.PivotForge;

// A grid declared with an XMLA store: it reads the cube, never the PivotForge
// endpoints, and offers only what a cube can do.
const fields = [
  { caption: "Bölge", dataField: "[Region].[Region].[Region]", area: "row" },
  { caption: "Yıl", dataField: "[Date].[Calendar].[Year]", area: "column" },
  { caption: "Tutar", dataField: "[Measures].[Amount]", area: "data" }
];

const BY_YEAR = dataset({
  columns: [[M.calendarAll, M.amount], [M.y2024, M.amount], [M.y2025, M.amount]],
  rows: [[M.all], [M.ege], [M.marmara]],
  cells: { 0: 600, 1: 250, 2: 350, 3: 300, 4: 100, 5: 200, 6: 300, 7: 150, 8: 150 }
});

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

function createWidget(overrides = {}) {
  const provider = createProvider({ answers: [{ match: /^SELECT NON EMPTY/, response: BY_YEAR }] });
  const rendered = [];
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    store: { type: "xmla", url: "/olap", catalog: "Demo", cube: "Sales" },
    rendererOptions: { culture: "tr-TR" },
    renderImpl: result => rendered.push(result),
    fetchImpl: provider.fetch,
    ...overrides
  });

  return { widget, provider, rendered };
}

test("an XMLA grid reads its cube and draws what the store built", async () => {
  const { widget, provider, rendered } = createWidget();

  await widget.refresh();

  assert.ok(provider.requests.every(request => request.url === "/olap"));
  assert.deepEqual(rendered[0].rowHeaders, [["Ege"], ["Marmara"]]);
  assert.deepEqual(rendered[0].columnHeaders, [["2024"], ["2025"]]);
  assert.deepEqual(rendered[0].grandTotals, { "[Measures].[Amount]_sum": 600 });
  widget.dispose();
});

test("a cube's grid offers no summary to choose and no formula", () => {
  const { widget } = createWidget();

  assert.deepEqual(widget.designerCapabilities(), { allowCalculatedFields: false, aggregations: [] });
  assert.equal(widget.supportsValueFilters, false);
  widget.dispose();
});

test("a grid declaring no fields lists the cube's, named and filed as the schema says", async () => {
  const { widget } = createWidget({ fields: [] });

  await widget.refresh();

  const amount = widget.declaredFields.find(field => field.dataField === "[Measures].[Amount]");
  const year = widget.declaredFields.find(field => field.dataField === "[Date].[Calendar].[Year]");
  assert.deepEqual(
    { caption: amount.caption, role: amount.role, displayFolder: amount.displayFolder, area: amount.area },
    { caption: "Amount", role: "measure", displayFolder: "Internet Sales", area: "available" });
  assert.deepEqual(
    { caption: year.caption, role: year.role, groupName: year.groupName, groupIndex: year.groupIndex },
    { caption: "Year", role: "dimension", groupName: "[Date].[Calendar]", groupIndex: 0 });
  widget.dispose();
});

test("a field the cube cannot carry is refused when the grid is declared", () => {
  assert.throws(() => createWidget({ fields: [fields[0], { dataField: "OrderDate", groupInterval: "year", area: "column" }, fields[2]] }),
    /hierarchy levels/);
  assert.throws(() => createWidget({ fields: [fields[0], { dataField: "Margin", area: "data", expression: "[Amount] * 2" }] }),
    /calculated member of the cube/);
  assert.throws(() => createWidget({ largeData: true }), /an XMLA store builds the whole result/);
  assert.throws(() => createWidget({ topN: [{ field: "[Region].[Region].[Region]", count: 1 }] }), /topN/);
});

test("a failed query is shown as the grid's error", async () => {
  const errors = [];
  // A provider with no answer for the query faults, as a server would on bad MDX.
  const { widget } = createWidget({ fetchImpl: createProvider().fetch });
  widget.on("error", error => errors.push(error.message));

  await widget.refresh();

  assert.equal(errors.length, 1);
  assert.match(errors[0], /No answer registered for SELECT NON EMPTY/);
  widget.dispose();
});
