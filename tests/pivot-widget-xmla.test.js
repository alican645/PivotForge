const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-xmla-store.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-remote-store.js");
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
  assert.throws(() => createWidget({ largeData: true, fields: [fields[0], { ...fields[2], runningTotal: "column" }] }),
    /cannot know the rows before it/);
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

test("with largeData the grid reads the cube a page of rows at a time", async () => {
  const COUNT = { h: "[Measures]", u: "[Measures].[PivotForge Row Count]", c: "PivotForge Row Count", l: 0 };
  const page = (member, total) => dataset({
    columns: [[M.calendarAll, M.amount], [M.y2024, M.amount], [M.y2025, M.amount]],
    rows: [[member], [M.all]],
    cells: { 0: total, 1: 100, 2: 200, 3: 600, 4: 250, 5: 350 }
  });
  const provider = createProvider({
    answers: [
      { match: /^WITH MEMBER/, response: dataset({ columns: [[COUNT]], cells: { 0: 2 } }) },
      { match: /^SELECT \{\} ON 0, Subset\(.*, 0, 1\)/, response: dataset({ columns: [], rows: [[M.ege]] }) },
      { match: /^SELECT \{\} ON 0, Subset\(.*, 1, 1\)/, response: dataset({ columns: [], rows: [[M.marmara]] }) },
      { match: /Marmara\], \[Region\]\.\[Region\]\.\[All\]\} DIMENSION/, response: page(M.marmara, 300) },
      { match: /^SELECT NON EMPTY/, response: page(M.ege, 300) }
    ]
  });
  const { widget, rendered } = createWidget({ largeData: true, pageSize: 1, fetchImpl: provider.fetch });

  await widget.refresh();
  assert.deepEqual(rendered.at(-1).rowHeaders, [["Ege"]]);
  assert.equal(widget.totalRowCount, 2);
  assert.equal(widget.currentPage.hasMore, true);

  const next = await widget.loadPage(1);
  assert.deepEqual(next.result.rowHeaders, [["Marmara"]]);
  assert.deepEqual(rendered.at(-1).rowHeaders, [["Marmara"]]);
  assert.equal(next.hasMore, false);
  widget.dispose();
});

test("a remote store still refuses largeData, and a page needs a loaded grid first", async () => {
  assert.throws(() => PivotForge.create(createContainer(), {
    fields: [{ dataField: "Region", area: "row" }, { dataField: "Amount", area: "data" }],
    autoLoad: false,
    largeData: true,
    store: { type: "remote", load: async () => ({ data: [] }) }
  }), /largeData pages a result the PivotForge endpoints keep/);

  const { widget } = createWidget({ largeData: true });
  await assert.rejects(widget.loadPage(0), /no active large-data session/);
  widget.dispose();
});

const QUARTERS_OF_2024 = dataset({
  columns: [[M.q1of2024, M.amount], [M.q2of2024, M.amount]],
  rows: [[M.all], [M.ege], [M.marmara]],
  cells: { 0: 210, 1: 40, 2: 60, 3: 40, 4: 150 }
});
const BY_QUARTER = dataset({
  columns: [[M.calendarAll, M.amount], [M.y2024, M.amount], [M.y2025, M.amount],
    [M.q1of2024, M.amount], [M.q2of2024, M.amount], [M.q1of2025, M.amount]],
  rows: [[M.all], [M.ege], [M.marmara]],
  cells: { 0: 600, 1: 250, 2: 350, 3: 210, 4: 40, 5: 350, 6: 300, 7: 100, 8: 200, 9: 60, 10: 40, 11: 200 }
});

function createBranchWidget(answers) {
  const provider = createProvider({ answers });
  const rendered = [];
  const widget = PivotForge.create(createContainer(), {
    fields: [
      fields[0],
      { caption: "Yıl", dataField: "[Date].[Calendar].[Year]", area: "column", expanded: false },
      { caption: "Çeyrek", dataField: "[Date].[Calendar].[Quarter]", area: "column" },
      fields[2]
    ],
    autoLoad: false,
    store: { type: "xmla", url: "/olap", catalog: "Demo", cube: "Sales" },
    rendererOptions: { culture: "tr-TR" },
    renderImpl: result => rendered.push(result),
    fetchImpl: provider.fetch
  });
  const pivots = () => provider.statements.filter(statement => statement.startsWith("SELECT NON EMPTY"));
  return { widget, provider, rendered, pivots };
}

test("an XMLA grid reads a closed level's groups only when one is opened", async () => {
  const { widget, rendered, pivots } = createBranchWidget([
    { match: /^SELECT NON EMPTY CrossJoin\(Union\(\{\[Date\]\.\[Calendar\]\.\[All\]\}, \[Date\]\.\[Calendar\]\.\[Year\]\.Members\), /, response: BY_YEAR },
    { match: /^SELECT NON EMPTY CrossJoin\(Descendants/, response: QUARTERS_OF_2024 },
    { match: /Quarter\]\.Members\), \{/, response: BY_QUARTER }
  ]);

  await widget.refresh();
  assert.deepEqual(rendered.at(-1).columnHeaders, [["2024"], ["2025"]]);

  await widget.expandBranch({ area: "column", path: ["2024"] });
  assert.equal(pivots().length, 2);
  assert.match(pivots()[1], /^SELECT NON EMPTY CrossJoin\(Descendants/);
  assert.deepEqual(rendered.at(-1).columnHeaders, [["2024", "Q1"], ["2024", "Q2"], ["2025"]]);

  // Expand all opens the level, which the cube reads whole.
  await widget.expandLevels(widget.fields.filter(field => field.area === "column"));
  assert.equal(pivots().length, 3);
  // Whole, the columns are every year crossed with every quarter, as before.
  assert.deepEqual(rendered.at(-1).columnHeaders, [["2024", "Q1"], ["2024", "Q2"], ["2025", "Q1"], ["2025", "Q2"]]);
  assert.equal(rendered.at(-1).metadata.columnDepth, undefined);
  widget.dispose();
});

test("a branch the cube fails to read stays closed", async () => {
  const { widget, rendered } = createBranchWidget([
    { match: /^SELECT NON EMPTY CrossJoin\(Union/, response: BY_YEAR }
  ]);

  await widget.refresh();
  await widget.expandBranch({ area: "column", path: ["2024"] });

  assert.ok(widget.error);
  assert.deepEqual(widget.branchState.columns, []);
  assert.deepEqual(rendered.at(-1).columnHeaders, [["2024"], ["2025"]]);
  widget.dispose();
});
