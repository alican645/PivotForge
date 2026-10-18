const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-result-assembler.js");
const XmlaStore = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-xmla-store.js");
const PivotRequestBuilder = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
const { createProvider, dataset, executeRowset, M } = require("./helpers/xmla-fixtures.js");

// DevExtreme's XmlaStore against a provider answering from tables: the SOAP it
// sends, the MDX it writes, and the grid it builds from the cells that come
// back.

const REGION = "[Region].[Region].[Region]";
const YEAR = "[Date].[Calendar].[Year]";
const QUARTER = "[Date].[Calendar].[Quarter]";
const AMOUNT = "[Measures].[Amount]";

const region = { dataField: REGION, area: "row" };
const year = { dataField: YEAR, area: "column" };
const amount = { dataField: AMOUNT, area: "data" };

// Region by year: Ege 100 + 200, Marmara 150 + 150.
const BY_YEAR = dataset({
  columns: [[M.calendarAll, M.amount], [M.y2024, M.amount], [M.y2025, M.amount]],
  rows: [[M.all], [M.ege], [M.marmara]],
  cells: { 0: 600, 1: 250, 2: 350, 3: 300, 4: 100, 5: 200, 6: 300, 7: 150, 8: 150 }
});

function createStore(answers = [], options = {}) {
  const provider = createProvider({ answers });
  const store = XmlaStore.create({ type: "xmla", url: "/olap", catalog: "Demo", cube: "Sales", ...options },
    { fetchImpl: provider.fetch });
  return { store, provider };
}

const request = (fields, extras) => PivotRequestBuilder.buildRequest(fields, extras);
const pivotStatements = provider => provider.statements.filter(statement => !statement.startsWith("SELECT {} ON 0"));

test("one MDX query asks for every member down to each depth, measures crossed on the columns", async () => {
  const { store, provider } = createStore([{ match: /^SELECT NON EMPTY/, response: BY_YEAR }]);

  await store.pivot(request([region, year, amount]), { culture: "tr-TR" });

  assert.deepEqual(pivotStatements(provider), [
    "SELECT NON EMPTY CrossJoin(Union({[Date].[Calendar].[All]}, [Date].[Calendar].[Year].Members), {[Measures].[Amount]}) " +
    "DIMENSION PROPERTIES PARENT_UNIQUE_NAME, HIERARCHY_UNIQUE_NAME ON COLUMNS, " +
    "NON EMPTY Union({[Region].[Region].[All]}, [Region].[Region].[Region].Members) " +
    "DIMENSION PROPERTIES PARENT_UNIQUE_NAME, HIERARCHY_UNIQUE_NAME ON ROWS FROM [Sales] CELL PROPERTIES VALUE"
  ]);
});

test("the cells, totals and grand total are the cube's, laid out as the engine lays them", async () => {
  const { store } = createStore([{ match: /^SELECT NON EMPTY/, response: BY_YEAR }]);

  const result = await store.pivot(request([region, year, amount]), { culture: "tr-TR" });
  const key = `${AMOUNT}_sum`;

  assert.deepEqual(result.rowHeaders, [["Ege"], ["Marmara"]]);
  assert.deepEqual(result.columnHeaders, [["2024"], ["2025"]]);
  assert.deepEqual(result.cells.map(cell => [cell.row, cell.column, cell.values[key]]),
    [[0, 0, 100], [0, 1, 200], [1, 0, 150], [1, 1, 150]]);
  assert.deepEqual(result.rowTotals.map(total => total.values[key]), [300, 300]);
  assert.deepEqual(result.columnTotals.map(total => total.values[key]), [250, 350]);
  assert.deepEqual(result.grandTotals, { [key]: 600 });
});

test("the cube's member order is the default, and a descending level runs it backwards", async () => {
  const { store } = createStore([{ match: /^SELECT NON EMPTY/, response: BY_YEAR }]);

  const result = await store.pivot(request([{ ...region, sortOrder: "Descending" }, year, amount]), { culture: "tr-TR" });

  assert.deepEqual(result.rowHeaders, [["Marmara"], ["Ege"]]);
});

test("a level whose captions repeat is labelled by its ancestors, unless the axis shows them", async () => {
  const quarters = dataset({
    columns: [[M.calendarAll, M.amount], [M.q1of2024, M.amount], [M.q2of2024, M.amount], [M.q1of2025, M.amount]],
    cells: { 0: 60, 1: 10, 2: 20, 3: 30 }
  });
  const { store } = createStore([{ match: /^SELECT NON EMPTY/, response: quarters }]);

  const alone = await store.pivot(request([{ dataField: QUARTER, area: "column" }, amount]), { culture: "tr-TR" });
  assert.deepEqual(alone.columnHeaders, [["Q1 2024"], ["Q2 2024"], ["Q1 2025"]]);

  const values = await store.fieldValues({ field: QUARTER }, { culture: "tr-TR" });
  assert.deepEqual(values.values, ["Q1 2024", "Q2 2024", "Q1 2025"]);
});

test("levels of one hierarchy on an axis are one member per depth, never the hierarchy twice", () => {
  const statement = XmlaStore.pivotStatement({
    cube: "Sales",
    rows: [],
    columns: [
      { name: YEAR, number: 1, hierarchy: { name: "[Date].[Calendar]", allMember: "[Date].[Calendar].[All]" } },
      { name: QUARTER, number: 2, hierarchy: { name: "[Date].[Calendar]", allMember: "[Date].[Calendar].[All]" } }
    ],
    measures: [AMOUNT],
    slices: []
  });

  // One hierarchy, so each depth is its deepest reached level and no CrossJoin of its own.
  assert.match(statement, /^SELECT NON EMPTY CrossJoin\(Union\(\{\[Date\]\.\[Calendar\]\.\[All\]\}, \[Date\]\.\[Calendar\]\.\[Year\]\.Members, \[Date\]\.\[Calendar\]\.\[Quarter\]\.Members\), \{\[Measures\]\.\[Amount\]\}\)/);
  assert.ok(!statement.includes("ON ROWS"));
});

test("a filter is the members it keeps, in a subselect; one that keeps none sends no query", async () => {
  const { store, provider } = createStore([{ match: /^SELECT NON EMPTY/, response: BY_YEAR }]);

  await store.pivot(request([region, year, amount], { filters: [{ field: REGION, values: ["Ege"] }] }), { culture: "tr-TR" });
  await store.pivot(request([region, year, amount], { filters: [{ field: REGION, values: ["Ege"], mode: "Exclude" }] }), { culture: "tr-TR" });
  await store.pivot(request([region, year, amount], { filters: [{ field: REGION, values: ["ar"], operator: "Contains" }] }), { culture: "tr-TR" });
  const none = await store.pivot(request([region, year, amount], { filters: [{ field: REGION, values: ["zz"], operator: "Contains" }] }), { culture: "tr-TR" });

  const froms = pivotStatements(provider).map(statement => / FROM (.+) CELL PROPERTIES/.exec(statement)[1]);
  assert.deepEqual(froms, [
    "(SELECT {[Region].[Region].&[Ege]} ON 0 FROM [Sales])",
    "(SELECT {[Region].[Region].&[Marmara]} ON 0 FROM [Sales])",
    "(SELECT {[Region].[Region].&[Marmara]} ON 0 FROM [Sales])"
  ]);
  assert.deepEqual(none.rowHeaders, []);
});

test("an empty crossing is no cell, and a cell the cube failed is shown empty with one warning", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const failing = dataset({
      columns: [[M.calendarAll, M.amount], [M.y2024, M.amount], [M.y2025, M.amount]],
      rows: [[M.all], [M.ege], [M.marmara]],
      cells: { 0: 600, 1: 250, 2: 350, 3: 300, 4: { error: "#N/A" }, 5: 200, 6: 300, 7: 150 }
    });
    const { store } = createStore([{ match: /^SELECT NON EMPTY/, response: failing }]);

    const result = await store.pivot(request([region, year, amount]), { culture: "tr-TR" });

    assert.deepEqual(result.cells.map(cell => [cell.row, cell.column]), [[0, 1], [1, 0]]);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
  }
});

test("a fault from the provider is the error the grid reports", async () => {
  const { store } = createStore();

  await assert.rejects(store.pivot(request([region, year, amount]), { culture: "tr-TR" }), /No answer registered/);
});

test("a drill-down slices the cube by the cell's members and reads the rowset's columns by name", async () => {
  const { store, provider } = createStore([{
    match: /^DRILLTHROUGH/,
    response: executeRowset([
      { "_x005B__x0024_Region_x005D_._x005B_Region_x005D_": "Ege", "_x005B_Sales_x005D_._x005B_Amount_x005D_": "40" },
      { "_x005B__x0024_Region_x005D_._x005B_Region_x005D_": "Ege", "_x005B_Sales_x005D_._x005B_Amount_x005D_": "60" }
    ])
  }]);

  const drill = await store.drillDown({
    request: request([region, year, amount]),
    rowPath: ["Ege"],
    columnPath: ["2024"],
    valueKey: `${AMOUNT}_sum`
  }, { culture: "tr-TR" });

  assert.equal(pivotStatements(provider).at(-1),
    "DRILLTHROUGH MAXROWS 1001 SELECT {[Measures].[Amount]} ON 0 FROM [Sales] " +
    "WHERE ([Region].[Region].&[Ege], [Date].[Calendar].[Year].&[2024])");
  assert.deepEqual(drill.records, [{ Region: "Ege", Amount: 40 }, { Region: "Ege", Amount: 60 }]);
  assert.equal(drill.totalCount, 2);
  assert.equal(drill.truncated, false);
});

test("the filter picker lists a level's labels, narrowed by the other fields' filters", async () => {
  const { store, provider } = createStore([{
    match: /^SELECT NON EMPTY \[Region\]/,
    response: dataset({ columns: [[M.marmara]] })
  }]);

  const all = await store.fieldValues({ field: REGION }, { culture: "tr-TR" });
  const narrowed = await store.fieldValues({ field: REGION, filters: [{ field: YEAR, values: ["2025"] }] }, { culture: "tr-TR" });

  assert.deepEqual(all.values, ["Ege", "Marmara"]);
  assert.deepEqual(narrowed.values, ["Marmara"]);
  assert.match(pivotStatements(provider).at(-1), /FROM \(SELECT \{\[Date\]\.\[Calendar\]\.\[Year\]\.&\[2025\]\} ON 0 FROM \[Sales\]\)$/);
});

test("the schema offers measures by group or folder and hierarchies as fields or groups of levels", async () => {
  const { store } = createStore();

  const { fields } = await store.fields({ culture: "tr-TR" });

  assert.deepEqual(fields, [
    { dataField: AMOUNT, caption: "Amount", dataType: "number", role: "measure", displayFolder: "Internet Sales" },
    { dataField: "[Measures].[Order Count]", caption: "Order Count", dataType: "number", role: "measure", displayFolder: "Counts" },
    { dataField: "[Region].[Region]", caption: "Region", dataType: "string", role: "dimension", displayFolder: "Region" },
    { dataField: YEAR, caption: "Year", groupName: "[Date].[Calendar]", groupIndex: 0, dataType: "string", role: "dimension", displayFolder: "Date" },
    { dataField: QUARTER, caption: "Quarter", groupName: "[Date].[Calendar]", groupIndex: 1, dataType: "string", role: "dimension", displayFolder: "Date" }
  ]);
});

test("an attribute hierarchy may stand for its one level", async () => {
  const { store, provider } = createStore([{ match: /^SELECT NON EMPTY/, response: BY_YEAR }]);

  await store.pivot(request([{ dataField: "[Region].[Region]", area: "row" }, year, amount]), { culture: "tr-TR" });

  assert.match(pivotStatements(provider)[0], /\[Region\]\.\[Region\]\.\[Region\]\.Members/);
});

test("the SOAP carries the catalog, the cube, the culture's locale and the page's headers", async () => {
  const sent = [];
  const { store, provider } = createStore([{ match: /^SELECT NON EMPTY/, response: BY_YEAR }], {
    headers: { Authorization: "Bearer token" },
    beforeSend: settings => {
      sent.push(settings.url);
      settings.url = "/olap?audited";
    }
  });

  await store.pivot(request([region, year, amount]), { culture: "tr-TR" });

  const discover = provider.requests.find(entry => entry.body.includes("MDSCHEMA_HIERARCHIES"));
  assert.equal(discover.method, "POST");
  assert.equal(discover.headers["Content-Type"], "text/xml");
  assert.equal(discover.headers.Authorization, "Bearer token");
  assert.match(discover.body, /<CATALOG_NAME>Demo<\/CATALOG_NAME><CUBE_NAME>Sales<\/CUBE_NAME>/);
  const execute = provider.requests.find(entry => entry.body.includes("<Execute "));
  assert.match(execute.body, /<Catalog>Demo<\/Catalog>/);
  assert.match(execute.body, /<LocaleIdentifier>1055<\/LocaleIdentifier>/);
  assert.ok(provider.requests.every(entry => entry.url === "/olap?audited"));
  assert.ok(sent.every(url => url === "/olap"));
});

test("an unknown level and a hierarchy on both axes are refused by name", async () => {
  const { store } = createStore();

  await assert.rejects(store.pivot(request([{ dataField: "[Nope].[Nope]", area: "row" }, amount]), {}),
    /"\[Nope\]\.\[Nope\]" is neither a level nor a hierarchy of the cube \[Sales\]/);
  await assert.rejects(store.pivot(request([{ dataField: YEAR, area: "row" }, { dataField: QUARTER, area: "column" }, amount]), {}),
    /\[Date\]\.\[Calendar\] has levels on both the rows and the columns/);
});

test("what a cube cannot carry is refused where the grid is declared", () => {
  const fields = extra => PivotRequestBuilder.normalizeFields([region, { ...amount, ...extra }]);

  assert.throws(() => XmlaStore.validateFields(PivotRequestBuilder.normalizeFields([
    region, { dataField: "Margin", area: "data", expression: "[Amount] * 2" }])), /calculated member of the cube/);
  assert.throws(() => XmlaStore.validateFields(PivotRequestBuilder.normalizeFields([
    { dataField: "OrderDate", groupInterval: "year", area: "column" }, amount])), /hierarchy levels/);
  assert.doesNotThrow(() => XmlaStore.validateFields(fields({})));
  assert.throws(() => XmlaStore.validateRequest({ topN: [{ field: REGION, count: 1 }] }), /topN/);
  assert.throws(() => XmlaStore.validateRequest({ valueFilters: [{ field: REGION }] }), /valueFilters/);
  assert.throws(() => XmlaStore.create({ type: "xmla", url: "/olap" }), /catalog and the cube/);
});

test("the XML reader decodes entities, CDATA and prefixes, and refuses what is not well formed", () => {
  const document = XmlaStore.parseXml(
    `<?xml version="1.0"?><a:root xmlns:a="x"><a:item name="&quot;A&amp;B&quot;">x &lt; y &#x41;</a:item><b/><c><![CDATA[<raw>]]></c></a:root>`);

  assert.equal(document.name, "root");
  assert.equal(document.children[0].attributes.name, "\"A&B\"");
  assert.equal(document.children[0].text, "x < y A");
  assert.equal(document.children[1].name, "b");
  assert.equal(document.children[2].text, "<raw>");
  assert.throws(() => XmlaStore.parseXml("<a><b></a>"), /not well-formed/);
});
