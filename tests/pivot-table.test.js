const assert = require("node:assert/strict");
const test = require("node:test");

global.window = {};
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-table.js");

test("renderer is exposed only through the PivotForge browser namespace", () => {
  assert.equal(typeof window.PivotForge.PivotTableRenderer, "function");
  assert.equal(window.PivotTableRenderer, undefined);
});

test("group collapse state survives subtotal mode changes", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const rowHeaders = [
    ["Marmara", "Teknoloji", "Alican"],
    ["Marmara", "Mobilya", "Ece"],
    ["Ege", "Teknoloji", "Deniz"]
  ];

  const subtotalPlan = renderer.createRowPlan(rowHeaders, 3, { subtotals: true, sortState: null });
  const groupPlan = renderer.createRowPlan(rowHeaders, 3, { subtotals: false, sortState: null });
  const subtotalKey = subtotalPlan.find(row => row.level === 0 && row.rowHeader[0] === "Marmara").key;
  const groupKey = groupPlan.find(row => row.level === 0 && row.rowHeader[0] === "Marmara").key;

  assert.equal(groupKey, subtotalKey);

  renderer.collapsedRows = new Set([subtotalKey]);
  assert.equal(renderer.isRowHidden(rowHeaders[0], "detail"), true);

  renderer.collapsedRows.delete(groupKey);
  assert.equal(renderer.isRowHidden(rowHeaders[0], "detail"), false);
});

test("single selection replaces the previous selection and emits defensive snapshots", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const changes = [];
  const settings = {
    selectionMode: "single",
    onSelectionChanged: selection => changes.push(selection)
  };
  const rowSelection = renderer.createRowSelection({
    type: "detail",
    rowHeader: ["Marmara", "Teknoloji", "Alican"],
    rowIndexes: [0]
  });
  const cellSelection = renderer.createCellSelection(rowSelection, {
    kind: "column",
    columnIndex: 0,
    columnHeader: ["2026"],
    valueKey: "sales",
    value: 125
  });

  renderer.applySelectionState = () => {};
  renderer.lastSettings = settings;
  renderer.setSelection(rowSelection, settings);
  renderer.setSelection(cellSelection, settings);

  const snapshot = renderer.getSelection();
  snapshot.rowHeader[0] = "changed";

  assert.equal(renderer.getSelection().type, "cell");
  assert.equal(renderer.getSelection().rowHeader[0], "Marmara");
  assert.deepEqual(changes.map(selection => selection.type), ["row", "cell"]);

  renderer.clearSelection();
  assert.equal(renderer.getSelection(), null);
  assert.equal(changes.at(-1), null);
});

test("selection keys remain stable across rerenders", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const rowHeader = ["Ege", "Mobilya", "Deniz"];

  assert.equal(
    renderer.createSelectionRowKey(rowHeader),
    renderer.createSelectionRowKey([...rowHeader])
  );
  assert.notEqual(
    renderer.createSelectionCellKey("column", ["2025"], "sales"),
    renderer.createSelectionCellKey("column", ["2026"], "sales")
  );
  assert.notEqual(
    renderer.createSelectionCellKey("column", ["2026"], "sales"),
    renderer.createSelectionCellKey("rowTotal", [], "sales")
  );
});

test("renderer view state restores widths and collapsed groups defensively", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  renderer.applyViewState({
    columnWidths: [[0, 144], [3, 220], ["bad", 100]],
    collapsedGroups: ["Marmara", "Ege", 42],
    collapsedColumnGroups: ["2025", null]
  }, { rerender: false, notify: false });

  const snapshot = renderer.getViewState();
  snapshot.columnWidths[0][1] = 999;
  snapshot.collapsedGroups.push("Akdeniz");
  snapshot.collapsedColumnGroups.push("2026");

  assert.deepEqual(renderer.getViewState(), {
    columnWidths: [[0, 144], [3, 220]],
    collapsedGroups: ["Marmara", "Ege"],
    collapsedColumnGroups: ["2025"]
  });
});

test("a collapsed column group is one total column in place of its columns", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const columnHeaders = [["2025", "Q1"], ["2025", "Q2"], ["2026", "Q1"], ["2026", "Q2"]];
  renderer.collapsedColumns = new Set([renderer.createSubtotalKey(["2025"])]);

  const plan = renderer.createColumnPlan(columnHeaders, { columnSubtotals: true });

  assert.deepEqual(plan.map(entry => [entry.type, entry.columnHeader.join("/"), entry.collapsed === true]), [
    ["subtotal", "2025", true],
    ["detail", "2026/Q1", false],
    ["detail", "2026/Q2", false],
    ["subtotal", "2026", false]
  ]);
  assert.deepEqual(plan[0].columnIndexes, [0, 1]);

  const head = renderer.createColumnHeaderGroups(plan, 0);
  assert.deepEqual(head[0], { value: "2025", span: 1, start: 0, subtotal: true, collapsed: true });
});

test("a collapsed column group keeps its total column with column subtotals off", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const columnHeaders = [["2025", "Q1"], ["2025", "Q2"], ["2026", "Q1"]];
  renderer.collapsedColumns = new Set([renderer.createSubtotalKey(["2026"])]);

  const plan = renderer.createColumnPlan(columnHeaders, { columnSubtotals: false });

  assert.deepEqual(plan.map(entry => entry.type), ["detail", "detail", "subtotal"]);
  assert.equal(plan[2].collapsed, true);
});

test("expanded: false on a column field collapses that level's groups once", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  renderer.collapsedColumns = new Set();
  const columnHeaders = [["2025", "Ankara", "Q1"], ["2025", "İzmir", "Q1"], ["2026", "Ankara", "Q1"]];

  renderer.applyInitialColumnCollapse(columnHeaders, { columnFieldExpanded: [true, false, false] });

  // The innermost level has no groups to fold.
  assert.deepEqual([...renderer.collapsedColumns], [
    renderer.createSubtotalKey(["2025", "Ankara"]),
    renderer.createSubtotalKey(["2025", "İzmir"]),
    renderer.createSubtotalKey(["2026", "Ankara"])
  ]);

  renderer.collapsedColumns.clear();
  renderer.applyInitialColumnCollapse(columnHeaders, { columnFieldExpanded: [false, false, false] });
  assert.equal(renderer.collapsedColumns.size, 0);
});

test("cell activation selects before firing the drill-down callback", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const events = [];
  const settings = {
    onSelectionChanged: selection => events.push(`selected:${selection.type}`),
    onCellDoubleClick: selection => events.push(`opened:${selection.type}`)
  };
  const row = renderer.createRowSelection({
    type: "detail",
    rowHeader: ["Marmara", "Beton"],
    rowIndexes: [0]
  });
  const cell = renderer.createCellSelection(row, {
    kind: "column",
    columnIndex: 0,
    columnHeader: ["2026"],
    valueKey: "Amount_sum",
    value: 100
  });
  renderer.applySelectionState = () => {};

  renderer.activateCellSelection(cell, settings);

  assert.deepEqual(events, ["selected:cell", "opened:cell"]);
});

test("cell activation ignores non-aggregate group cells", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  let opened = false;
  const row = renderer.createRowSelection({
    type: "group",
    rowHeader: ["Marmara"],
    rowIndexes: [0, 1]
  });
  const cell = renderer.createCellSelection(row, {
    kind: "column",
    columnIndex: 0,
    columnHeader: ["2026"],
    valueKey: "Amount_sum",
    value: null,
    drillDownEnabled: false
  });

  renderer.activateCellSelection(cell, { onCellDoubleClick: () => { opened = true; } });

  assert.equal(opened, false);
  assert.equal(renderer.getSelection(), null);
});

test("renderer consumes server totals and subtotal paths", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const totals = renderer.createTotalLookup([
    { index: 0, values: { Amount_sum: 0.4 } },
    { index: 1, values: { Amount_sum: 0.6 } }
  ]);
  const subtotals = renderer.createSubtotalLookup([
    { rowHeader: ["Marmara"], cells: [], totals: { Amount_sum: 1 } }
  ]);

  assert.equal(totals.get(1).Amount_sum, 0.6);
  assert.equal(subtotals.get(renderer.createSubtotalKey(["Marmara"])).totals.Amount_sum, 1);
});

test("show-as percentage formatting treats core values as ratios", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const formatted = renderer.formatValue(0.25, { emptyText: "-" }, {
    showAs: "percentOfGrandTotal",
    format: { type: "percent", decimals: 0, useGrouping: true }
  });
  const manualPercent = renderer.formatValue(25, { emptyText: "-" }, {
    showAs: "normal",
    format: { type: "percent", decimals: 0, useGrouping: true }
  });

  assert.match(formatted, /25/);
  assert.equal(formatted, manualPercent);
});

test("resolved values retain show-as configuration", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const values = renderer.resolveValues({
    aggregation: "sum",
    values: [{ key: "Amount_sum", showAs: "runningTotal" }]
  }, [], {});

  assert.equal(values[0].showAs, "runningTotal");
});

test("arrow navigation follows rows and skips missing vertical targets", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const rows = [
    [1, 2, 3],
    [1, 3],
    [1, 2, 3]
  ];

  assert.deepEqual(renderer.resolveNavigationPosition(rows, 0, 1, 2, "ArrowRight"), { row: 0, index: 2 });
  assert.deepEqual(renderer.resolveNavigationPosition(rows, 0, 1, 2, "ArrowDown"), { row: 2, index: 1 });
  assert.deepEqual(renderer.resolveNavigationPosition(rows, 2, 1, 2, "ArrowUp"), { row: 0, index: 1 });
  assert.equal(renderer.resolveNavigationPosition(rows, 0, 0, 1, "ArrowLeft"), null);
  assert.equal(renderer.resolveNavigationPosition(rows, 2, 1, 2, "ArrowDown"), null);
});

test("rerender restores focus to the selected cell", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const focusCalls = [];
  const cell = {
    focus: options => focusCalls.push(options)
  };
  const table = {
    querySelector: selector => selector === "td.is-cell-selected" ? cell : null
  };
  let visibleTarget = null;
  renderer.selection = { type: "cell" };
  renderer.ensureCellVisible = (target, owner) => {
    visibleTarget = { target, owner };
  };

  const restored = renderer.restoreSelectedCellFocus(table);

  assert.equal(restored, cell);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(visibleTarget, { target: cell, owner: table });
});

test("rerender does not move focus for a row selection", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  renderer.selection = { type: "row" };

  assert.equal(renderer.restoreSelectedCellFocus({ querySelector: () => assert.fail() }), null);
});

const wiredActions = {
  onSortRequested() {},
  onCellFilterRequested() {},
  onConditionalFormatRequested() {}
};

test("cell context menu exposes enabled actions for an aggregate cell", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({}, wiredActions);
  const items = renderer.createContextMenuItems({
    type: "cell",
    value: 1250,
    valueKey: "Amount_sum",
    rowType: "detail",
    rowHeader: ["Marmara"],
    columnHeader: ["2026"],
    drillDownEnabled: true
  });

  assert.deepEqual(items.map(item => item.label), [
    "Show details",
    "Copy cell",
    "Copy row",
    "Sort rows by this column",
    "Filter by this value",
    "Add conditional formatting"
  ]);
  assert.equal(items.every(item => item.disabled === false), true);
});

test("cell context menu disables value actions for empty group cells", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({}, wiredActions);
  const items = renderer.createContextMenuItems({
    type: "cell",
    value: null,
    valueKey: "Amount_sum",
    rowType: "group",
    rowHeader: ["Marmara"],
    columnHeader: [],
    drillDownEnabled: false
  });

  assert.equal(items.find(item => item.action === "details").disabled, true);
  assert.equal(items.find(item => item.action === "sort").disabled, true);
  assert.equal(items.find(item => item.action === "filter").disabled, false);
  assert.equal(items.find(item => item.action === "conditional").disabled, true);
});

test("context sort targets the selected measure and column path", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  assert.deepEqual(renderer.createCellSortRequest({
    columnKind: "column",
    valueKey: "Amount_sum",
    columnHeader: ["2026", "Q1"]
  }), {
    mode: "RowTotalValue",
    valueKey: "Amount_sum",
    columnPath: ["2026", "Q1"]
  });
  assert.equal(renderer.createCellSortRequest({
    columnKind: "rowTotal",
    valueKey: "Amount_sum",
    columnHeader: []
  }).columnPath, null);
});

test("row copy joins visible cells with tabs", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const row = { children: [{ textContent: " Marmara " }, { textContent: " ₺1.250 " }] };

  assert.equal(renderer.getRowCopyText(row), "Marmara\t₺1.250");
});

test("conditional rules support comparisons and inclusive ranges", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  assert.equal(renderer.matchesConditionalRule(10, { operator: "greaterThan", threshold: 9 }), true);
  assert.equal(renderer.matchesConditionalRule(10, { operator: "greaterThanOrEqual", threshold: 10 }), true);
  assert.equal(renderer.matchesConditionalRule(10, { operator: "lessThan", threshold: 11 }), true);
  assert.equal(renderer.matchesConditionalRule(10, { operator: "lessThanOrEqual", threshold: 10 }), true);
  assert.equal(renderer.matchesConditionalRule(10, { operator: "equal", threshold: 10 }), true);
  assert.equal(renderer.matchesConditionalRule(10, { operator: "between", threshold: 12, threshold2: 8 }), true);
  assert.equal(renderer.matchesConditionalRule(null, { operator: "equal", threshold: 0 }), false);
});

test("excel formats preserve number, currency and percent display settings", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  assert.equal(renderer.getExcelNumberFormat({ format: { type: "number", decimals: 2, useGrouping: true } }), "#,##0.00");
  assert.equal(renderer.getExcelNumberFormat({ format: { type: "currency", currency: "TRY", decimals: 0, useGrouping: true } }), "₺#,##0");
  assert.equal(renderer.getExcelNumberFormat({ format: { type: "percent", decimals: 1, useGrouping: false } }), "0.0%");
});

test("cell copy uses displayed text and reports success", async () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  let copiedText = null;
  let callback = null;
  const classes = new Set();
  const cell = {
    textContent: "  ₺1.250  ",
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name)
    }
  };
  renderer.copyTextFallback = text => {
    copiedText = text;
    return true;
  };

  const copied = await renderer.copyCell(cell, {
    onCellCopied: (text, succeeded) => { callback = { text, succeeded }; }
  });

  assert.equal(copied, true);
  assert.equal(copiedText, "₺1.250");
  assert.deepEqual(callback, { text: "₺1.250", succeeded: true });
  assert.equal(classes.has("is-cell-copied"), true);
});

// --- Grid row indexing -------------------------------------------------------

// applyGridIndexes only reads a table's shape, so it can be exercised without a
// DOM — which matters, because the arithmetic it does is precisely the part a
// browser test cannot reach: the demo page is not virtualized.
function fakeRow({ spacer = false, key = null } = {}) {
  return {
    attributes: {},
    dataset: key ? { selectionRowKey: key } : {},
    classList: { contains: name => spacer && name === "pivot-table__virtual-spacer" },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function fakeTable(headRows, bodyRows) {
  return {
    attributes: {},
    tHead: { rows: headRows },
    tBodies: [{ rows: bodyRows }],
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

test("a virtual page states its real position and the table's real size", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const head = [fakeRow(), fakeRow()];
  const top = fakeRow({ spacer: true });
  const data = [fakeRow(), fakeRow(), fakeRow()];
  const bottom = fakeRow({ spacer: true });
  const grandTotal = fakeRow({ key: "grand-total" });

  const table = fakeTable(head, [top, ...data, bottom, grandTotal]);
  renderer.applyGridIndexes(table, { offset: 40, totalRowCount: 5000 });

  // Otherwise a screen reader announces "row 3 of 12" for a 5000-row pivot.
  assert.equal(table.attributes["aria-rowcount"], "5002");
  // The window starts at offset 40, so its first row is the 41st data row —
  // the 43rd row of the grid once the two header rows are counted.
  assert.deepEqual(data.map(row => row.attributes["aria-rowindex"]), ["43", "44", "45"]);
  // Spacers stand in for rows that are not there; they must claim no position.
  assert.equal(top.attributes["aria-rowindex"], undefined);
  assert.equal(bottom.attributes["aria-rowindex"], undefined);
  // The grand total follows the whole table, not the page it happens to trail.
  assert.equal(grandTotal.attributes["aria-rowindex"], "5002");
});

test("without virtualization the indexes are simply the rows that are there", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const head = [fakeRow()];
  const data = [fakeRow(), fakeRow()];

  const table = fakeTable(head, data);
  renderer.applyGridIndexes(table, null);

  assert.equal(table.attributes["aria-rowcount"], "3");
  assert.equal(head[0].attributes["aria-rowindex"], "1");
  assert.deepEqual(data.map(row => row.attributes["aria-rowindex"]), ["2", "3"]);
});

// --- Culture and texts -------------------------------------------------------

test("numbers are formatted in the reader's own locale unless a culture is pinned", () => {
  const value = { key: "amount", format: { type: "number", decimals: 2, useGrouping: true } };
  const settings = culture => ({ culture, formatter: null });

  assert.equal(
    new window.PivotForge.PivotTableRenderer({}).formatValue(1234.5, settings("tr-TR"), value),
    "1.234,50");
  assert.equal(
    new window.PivotForge.PivotTableRenderer({}).formatValue(1234.5, settings("en-US"), value),
    "1,234.50");

  // No culture hands the decision to Intl, which is the reader's own locale —
  // a package that hard-codes one gives everyone else the wrong separator.
  assert.equal(
    new window.PivotForge.PivotTableRenderer({}).formatValue(1234.5, settings(null), value),
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true
    }).format(1234.5));
});

test("a declared culture reaches the default formatter too", () => {
  const german = new window.PivotForge.PivotTableRenderer({}, { culture: "de-DE" });

  assert.equal(german.options.formatter.format(1234.5), "1.234,5");
});

test("a declared currency is rendered in the declared culture", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const value = { key: "amount", format: { type: "currency", decimals: 0, currency: "EUR" } };

  // Currency takes its own branch through formatValue, and carried its own
  // hard-coded tr-TR: a German page showed euros with Turkish separators.
  assert.match(renderer.formatValue(1500, { culture: "de-DE" }, value), /1\.500/);
  assert.match(renderer.formatValue(1500, { culture: "en-US" }, value), /1,500/);
});

test("a percent is rendered in the declared culture too", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const value = { key: "share", format: { type: "percent", decimals: 1 } };

  assert.match(renderer.formatValue(12.5, { culture: "tr-TR" }, value), /12,5/);
  assert.match(renderer.formatValue(12.5, { culture: "en-US" }, value), /12\.5/);
});

test("overriding one text keeps every other default", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({}, { texts: { noData: "Veri yok" } });

  const resolved = renderer.resolveTexts();

  // Spreading the override over the whole map instead of merging would leave
  // every key the caller did not think to repeat rendering as undefined.
  assert.equal(resolved.noData, "Veri yok");
  assert.equal(resolved.cellActions, "Cell actions");
  assert.equal(resolved.sortByValue, "Sort rows by this column");
});

test("a per-render text override layers over the constructor's, not under it", () => {
  const renderer = new window.PivotForge.PivotTableRenderer(
    {}, { texts: { noData: "Veri yok", copyCell: "Hücreyi kopyala" } });

  const resolved = renderer.resolveTexts({ texts: { noData: "Keine Daten" } });

  assert.equal(resolved.noData, "Keine Daten");
  assert.equal(resolved.copyCell, "Hücreyi kopyala");
  assert.equal(resolved.cellActions, "Cell actions");
});

test("context menu labels come from the supplied text map", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const english = {
    openDetails: "Open details",
    copyCell: "Copy cell",
    copyRow: "Copy row",
    sortByValue: "Sort by this value",
    filterByValue: "Filter by this value",
    addConditionalFormat: "Add conditional format"
  };

  const items = renderer.createContextMenuItems(
    { value: 1, rowHeader: ["x"], columnHeader: [], valueKey: "amount" },
    english,
    wiredActions);

  assert.deepEqual(items.map(item => item.label), Object.values(english));
});

// An action the page cannot perform is left out rather than shown greyed: a
// disabled entry says "not for this cell", which would be a lie about a whole
// feature the host never wired.
test("cell menu leaves out the actions the host did not wire", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  const items = renderer.createContextMenuItems({
    type: "cell",
    value: 1250,
    valueKey: "Amount_sum",
    rowType: "detail",
    rowHeader: ["Marmara"],
    columnHeader: ["2026"],
    drillDownEnabled: true
  });

  assert.deepEqual(items.map(item => item.action), ["details", "copy-cell", "copy-row"]);
});

test("each wired action brings back only its own entry", () => {
  const selection = {
    type: "cell",
    value: 1250,
    valueKey: "Amount_sum",
    rowType: "detail",
    rowHeader: ["Marmara"],
    columnHeader: ["2026"],
    drillDownEnabled: true
  };
  const actionsFor = options =>
    new window.PivotForge.PivotTableRenderer({}, options)
      .createContextMenuItems(selection)
      .map(item => item.action);

  assert.equal(actionsFor({ onSortRequested() {} }).includes("sort"), true);
  assert.equal(actionsFor({ onSortRequested() {} }).includes("conditional"), false);
  assert.equal(actionsFor({ onCellFilterRequested() {} }).includes("filter"), true);
  assert.equal(actionsFor({ onConditionalFormatRequested() {} }).includes("conditional"), true);
  assert.equal(actionsFor({ onConditionalFormatRequested() {} }).includes("sort"), false);
});

// --- Per-field expansion and totals ------------------------------------------

const threeLevelHeaders = [
  ["Marmara", "Teknoloji", "Alican"],
  ["Marmara", "Teknoloji", "Ece"],
  ["Marmara", "Mobilya", "Deniz"],
  ["Ege", "Teknoloji", "Kaan"]
];

const planOf = (renderer, settings) =>
  renderer.createRowPlan(threeLevelHeaders, 3, { subtotals: true, sortState: null, ...settings });

const typesAtLevel = (plan, level) =>
  [...new Set(plan.filter(row => row.level === level).map(row => row.type))];

test("a row field opting out of totals leaves a group header instead", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  const plan = planOf(renderer, { rowFieldSubtotals: [true, false, true] });

  // The header stays -- the hierarchy would lose its label otherwise -- but it
  // stops carrying sums, which is exactly the shape subtotals: false produces.
  assert.deepEqual(typesAtLevel(plan, 0), ["subtotal"]);
  assert.deepEqual(typesAtLevel(plan, 1), ["group"]);
  assert.deepEqual(typesAtLevel(plan, 2), ["detail"]);
});

test("a level's key is the same whether it totals or not, so collapse survives", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  const withTotals = planOf(renderer, {});
  const without = planOf(renderer, { rowFieldSubtotals: [false, false, false] });

  assert.deepEqual(withTotals.map(row => row.key), without.map(row => row.key));
});

test("the grid-wide subtotals switch still wins over a field asking for totals", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  const plan = planOf(renderer, { subtotals: false, rowFieldSubtotals: [true, true, true] });

  assert.deepEqual(typesAtLevel(plan, 0), ["group"]);
  assert.deepEqual(typesAtLevel(plan, 1), ["group"]);
});

test("an undeclared rowFieldSubtotals leaves every level totalling", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  const plan = planOf(renderer, { rowFieldSubtotals: null });

  assert.deepEqual(typesAtLevel(plan, 0), ["subtotal"]);
  assert.deepEqual(typesAtLevel(plan, 1), ["subtotal"]);
});

test("a row field declared collapsed seeds the collapse set once", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const settings = { subtotals: true, sortState: null, rowFieldExpanded: [true, false, true] };
  renderer.collapsedRows = new Set();

  renderer.applyInitialCollapse(threeLevelHeaders, 3, settings);
  const seeded = [...renderer.collapsedRows];

  // Only the declared level, and only its groups.
  assert.equal(seeded.length, planOf(renderer, {}).filter(row => row.level === 1).length);
  assert.ok(seeded.length > 0);

  // Opening one and rendering again must not undo the user's decision.
  renderer.collapsedRows.delete(seeded[0]);
  renderer.applyInitialCollapse(threeLevelHeaders, 3, settings);
  assert.equal(renderer.collapsedRows.has(seeded[0]), false);
});

test("declaring nothing collapsed leaves the grid fully expanded", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  renderer.collapsedRows = new Set();

  renderer.applyInitialCollapse(
    threeLevelHeaders, 3, { subtotals: true, sortState: null, rowFieldExpanded: null });

  assert.equal(renderer.collapsedRows.size, 0);
});

test("a restored view state is not overwritten by the declared initial state", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  renderer.rerenderLast = () => {};
  renderer.notifyViewStateChanged = () => {};

  renderer.applyViewState({ collapsedGroups: [], columnWidths: [] });
  renderer.applyInitialCollapse(
    threeLevelHeaders, 3, { subtotals: true, sortState: null, rowFieldExpanded: [false, false, false] });

  // The user already decided everything was open; a reload must not re-collapse.
  assert.equal(renderer.collapsedRows.size, 0);
});

test("only an explicit false collapses, and only where there are groups to collapse", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const seed = rowFieldExpanded => {
    renderer.collapsedRows = new Set();
    renderer.initialCollapseApplied = false;
    renderer.applyInitialCollapse(
      threeLevelHeaders, 3, { subtotals: true, sortState: null, rowFieldExpanded });
    return [...renderer.collapsedRows];
  };

  // The deepest row field has no groups — its rows are the detail rows. Adding
  // their keys would put junk into getViewState().collapsedGroups, which is
  // what state-storing persists.
  assert.deepEqual(seed([true, true, false]), []);

  // A short array means the remaining levels were never declared, and an
  // undeclared level is expanded — not collapsed by omission. A gap in the
  // middle is the same thing: the renderer is a public entry point, so a
  // consumer building this array by hand can leave holes in it.
  assert.deepEqual(seed([true]), []);
  assert.deepEqual(seed([]), []);
  assert.deepEqual(seed([undefined, true, true]), []);
});

test("the row plan keeps the order the engine sent", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  // Descending, and in a collation no browser would produce for "tr" -- the
  // renderer used to re-sort these locally, which threw away both the culture
  // the request was executed with and any per-field order it declared.
  const rowHeaders = [["Marmara"], ["Ege"], ["Akdeniz"]];

  const plan = renderer.createRowPlan(rowHeaders, 1, { sortState: null });

  assert.deepEqual(plan.map(row => row.rowHeader[0]), ["Marmara", "Ege", "Akdeniz"]);
});

test("grouping follows the sent order rather than re-sorting into it", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const rowHeaders = [
    ["Marmara", "Teknoloji"],
    ["Marmara", "Mobilya"],
    ["Ege", "Teknoloji"]
  ];

  const plan = renderer.createRowPlan(rowHeaders, 2, { subtotals: true, sortState: null });

  assert.deepEqual(
    plan.filter(row => row.type === "subtotal").map(row => row.rowHeader[0]),
    ["Marmara", "Ege"]);
  assert.deepEqual(
    plan.filter(row => row.type === "detail").map(row => row.rowHeader[1]),
    ["Teknoloji", "Mobilya", "Teknoloji"]);
});

test("a value opting out of grand totals loses only its column on the right", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const values = renderer.resolveValues({
    values: [
      { key: "Amount_sum" },
      { key: "Quantity_sum", showGrandTotals: false }
    ]
  }, [], {});

  assert.deepEqual(renderer.totalColumnValues(values, {}).map(value => value.key), ["Amount_sum"]);
  // The bottom row totals the grid's columns, so it stays for the others.
  assert.equal(renderer.showsGrandTotalRow(values, {}), true);
  // Two column headers of two values each, plus the one total column left.
  assert.equal(renderer.columnCount(1, [["2025"], ["2026"]], values, {}), 1 + 4 + 1);
});

test("the grand total row goes only once every value has opted out", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const values = renderer.resolveValues({
    values: [
      { key: "Amount_sum", showGrandTotals: false },
      { key: "Quantity_sum", showGrandTotals: false }
    ]
  }, [], {});

  assert.deepEqual(renderer.totalColumnValues(values, {}), []);
  assert.equal(renderer.showsGrandTotalRow(values, {}), false);
});

test("the grid-wide switches win over a value asking for its grand totals", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const values = renderer.resolveValues({ values: [{ key: "Amount_sum" }] }, [], {});

  assert.deepEqual(renderer.totalColumnValues(values, { showColumnGrandTotals: false }), []);
  assert.equal(renderer.showsGrandTotalRow(values, { showGrandTotal: false }), false);
  assert.equal(renderer.columnCount(2, [["2025"]], values, { showColumnGrandTotals: false }), 3);
  // Each switch governs its own direction only.
  assert.equal(renderer.showsGrandTotalRow(values, { showColumnGrandTotals: false }), true);
  assert.equal(renderer.totalColumnValues(values, { showGrandTotal: false }).length, 1);
});

test("a column field header reads its sort from the column levels, not the row sort", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const settings = {
    columnFields: ["Year", "Quarter"],
    columnFieldSorts: [null, "Descending"],
    sortState: { mode: "RowLabel", field: "Year", direction: "Ascending" }
  };

  assert.equal(renderer.activeSortDirection({ mode: "ColumnLabel", field: "Year" }, settings), null);
  assert.equal(
    renderer.activeSortDirection({ mode: "ColumnLabel", field: "Quarter" }, settings),
    "Descending");
  assert.equal(
    renderer.activeSortDirection({ mode: "RowLabel", field: "Year" }, settings),
    "Ascending");
});

test("a row field header shows the field's own order until a row sort takes over", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const settings = { rowFields: ["Region", "City"], rowFieldSorts: ["Descending", null] };

  assert.equal(renderer.activeSortDirection({ mode: "RowLabel", field: "Region" }, settings), "Descending");
  assert.equal(renderer.activeSortDirection({ mode: "RowLabel", field: "City" }, settings), null);

  // A row sort replaces every field's own order, so only its own header is marked.
  const sorted = { ...settings, sortState: { mode: "RowTotalValue", valueKey: "Amount_sum", direction: "Ascending" } };
  assert.equal(renderer.activeSortDirection({ mode: "RowLabel", field: "Region" }, sorted), null);
});

test("the column plan closes each outer column group with a subtotal", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const headers = [["2025", "Q1"], ["2025", "Q2"], ["2026", "Q1"]];

  const plan = renderer.createColumnPlan(headers, {});

  assert.deepEqual(plan.map(entry => entry.type === "subtotal"
    ? `total:${entry.columnHeader.join("/")}`
    : entry.columnHeader.join("/")), ["2025/Q1", "2025/Q2", "total:2025", "2026/Q1", "total:2026"]);
  assert.deepEqual(plan[2].columnIndexes, [0, 1]);
});

test("column subtotals are switched off grid-wide or per column level", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const headers = [["Ege", "2025", "Q1"], ["Ege", "2025", "Q2"], ["Ege", "2026", "Q1"]];
  const totals = settings => renderer.createColumnPlan(headers, settings)
    .filter(entry => entry.type === "subtotal")
    .map(entry => entry.columnHeader.join("/"));

  assert.deepEqual(totals({}), ["Ege/2025", "Ege/2026", "Ege"]);
  assert.deepEqual(totals({ columnSubtotals: false }), []);
  assert.deepEqual(totals({ columnFieldSubtotals: [false, true, true] }), ["Ege/2025", "Ege/2026"]);
  assert.deepEqual(totals({ columnFieldSubtotals: [true, false, true] }), ["Ege"]);
});

test("a single column level has no subtotal columns", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  assert.equal(renderer.createColumnPlan([["2025"], ["2026"]], {}).length, 2);
  assert.equal(renderer.createColumnPlan([], {}).length, 0);
});

test("the head gives a subtotal its own cell at its level and none below", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const plan = renderer.createColumnPlan([["2025", "Q1"], ["2025", "Q2"], ["2026", "Q1"]], {});

  assert.deepEqual(renderer.createColumnHeaderGroups(plan, 0), [
    { value: "2025", span: 2, start: 0 },
    { value: "2025", span: 1, start: 2, subtotal: true },
    { value: "2026", span: 1, start: 3 },
    { value: "2026", span: 1, start: 4, subtotal: true }
  ]);
  assert.deepEqual(renderer.createColumnHeaderGroups(plan, 1).map(group => group.value), ["Q1", "Q2", "Q1"]);
});

test("the column count includes subtotal columns", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const values = [{ key: "a" }];
  const headers = [["2025", "Q1"], ["2025", "Q2"], ["2026", "Q1"]];

  assert.equal(renderer.columnCount(1, headers, values, {}), 1 + 5 + 1);
  assert.equal(renderer.columnCount(1, headers, values, { columnSubtotals: false }), 1 + 3 + 1);
});

test("a subtotal cell sorts rows by its subtotal column", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const selection = {
    value: 5, rowType: "detail", columnKind: "columnSubtotal", columnHeader: ["2025"], rowHeader: ["Ege"], valueKey: "a"
  };
  const items = renderer.createContextMenuItems(selection, undefined, { onSortRequested: () => {} });

  assert.equal(items.find(item => item.action === "sort").disabled, false);
  assert.deepEqual(renderer.createCellSortRequest(selection), {
    mode: "RowTotalValue", valueKey: "a", columnPath: ["2025"]
  });
});

test("sort columns by this row is offered only with column fields", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const selection = { value: 5, rowType: "detail", columnHeader: ["2025"], rowHeader: ["Ege"], valueKey: "a" };

  const without = renderer.createContextMenuItems(selection, undefined, { onSortRequested: () => {} });
  const withColumns = renderer.createContextMenuItems(
    selection, undefined, { onSortRequested: () => {}, columnFields: ["Year"] });

  assert.equal(without.some(item => item.action === "sort-columns"), false);
  assert.equal(withColumns.find(item => item.action === "sort-columns").disabled, false);
});

test("a column sort request reads the cell's row, and the grand total row as no path", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});

  assert.deepEqual(
    renderer.createColumnSortRequest({ rowType: "subtotal", rowHeader: ["Ege"], valueKey: "a" }),
    { mode: "ColumnTotalValue", valueKey: "a", rowPath: ["Ege"] });
  assert.deepEqual(
    renderer.createColumnSortRequest({ rowType: "grandTotal", rowHeader: [], valueKey: "a" }),
    { mode: "ColumnTotalValue", valueKey: "a", rowPath: null });
});

test("heatmap levels scale each measure on its own and split by row or column", () => {
  const { heatmapLevels } = window.PivotForge;
  const entries = [
    { valueKey: "amount", rowKey: "r1", columnIndex: 0, value: 10 },
    { valueKey: "amount", rowKey: "r1", columnIndex: 1, value: 30 },
    { valueKey: "amount", rowKey: "r2", columnIndex: 0, value: 20 },
    { valueKey: "amount", rowKey: "r2", columnIndex: 1, value: null },
    { valueKey: "count", rowKey: "r1", columnIndex: 0, value: 1 },
    { valueKey: "count", rowKey: "r2", columnIndex: 0, value: 3 }
  ];

  assert.deepEqual(heatmapLevels(entries, "table"), [0, 1, 0.5, null, 0, 1]);
  // r2 has a single amount, so there is nothing to compare it with.
  assert.deepEqual(heatmapLevels(entries, "rows"), [0, 1, null, null, null, null]);
  assert.deepEqual(heatmapLevels(entries, "columns"), [0, null, 1, null, 0, 1]);
  assert.deepEqual(heatmapLevels(entries, "none"), entries.map(() => null));
  assert.deepEqual(heatmapLevels(entries, "bogus"), entries.map(() => null));
});

test("heatmap shades value cells and clears the shading when switched off", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const makeCell = () => {
    const classes = new Set();
    const style = new Map();
    return {
      classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), has: name => classes.has(name) },
      style: { setProperty: (name, value) => style.set(name, value), removeProperty: name => style.delete(name) },
      heat: () => style.get("--pt-heat")
    };
  };
  const cells = [makeCell(), makeCell(), makeCell()];
  const table = {
    querySelectorAll(selector) {
      assert.equal(selector, "td.pivot-table__value:not(.pivot-table__column-subtotal)");
      return cells;
    }
  };
  [5, 15, 10].forEach((value, index) =>
    renderer.selectionMetadata.set(cells[index], { valueKey: "amount", rowKey: "r", columnIndex: index, value }));

  renderer.applyHeatmap(table, { heatmap: "table" });
  assert.deepEqual(cells.map(cell => cell.heat()), ["0", "1", "0.5"]);
  assert.equal(cells.every(cell => cell.classList.has("is-heat")), true);

  renderer.applyHeatmap(table, { heatmap: "none" });
  assert.deepEqual(cells.map(cell => cell.heat()), [undefined, undefined, undefined]);
  assert.equal(cells.some(cell => cell.classList.has("is-heat")), false);
});

test("heatmap levels follow the server's value ranges on a large-data page", () => {
  const { heatmapLevels } = window.PivotForge;
  // A page holding one row of a result whose amounts run from 0 to 100.
  const entries = [
    { valueKey: "amount", rowKey: "r5", columnIndex: 0, value: 25 },
    { valueKey: "amount", rowKey: "r5", columnIndex: 1, value: 50 }
  ];
  const ranges = [
    { valueKey: "amount", column: null, min: 0, max: 100 },
    { valueKey: "amount", column: 0, min: 0, max: 50 },
    { valueKey: "amount", column: 1, min: 50, max: 150 }
  ];

  assert.deepEqual(heatmapLevels(entries, "table", ranges), [0.25, 0.5]);
  assert.deepEqual(heatmapLevels(entries, "columns", ranges), [0.5, 0]);
  // A row is always whole on a page, so its own values decide.
  assert.deepEqual(heatmapLevels(entries, "rows", ranges), [0, 1]);
});

test("excel export carries the heatmap shade unless a conditional rule highlights the cell", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const cellWith = (classes, heat) => ({
    classList: { contains: name => classes.includes(name) },
    style: { getPropertyValue: name => (name === "--pt-heat" ? heat : "") }
  });

  assert.equal(renderer.getExcelCellFillColor(cellWith(["is-heat"], "1")), "#FCB27F");
  assert.equal(renderer.getExcelCellFillColor(cellWith(["is-heat"], "0")), "#FFFFFF");
  assert.equal(renderer.getExcelCellFillColor(cellWith(["is-heat", "is-conditional-red"], "1")), null);
  assert.equal(renderer.getExcelCellFillColor(cellWith([], "1")), null);
});

// Just enough of a DOM for PivotForge.print: a tree with attributes and classes.
function printDom() {
  const listeners = {};
  const view = {
    onafterprint: null,
    printed: null,
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    print() { this.printed = snapshot(); },
    fire(type) { listeners[type]?.(); }
  };
  const document = { defaultView: view, createElement: tag => node(tag) };
  const all = [];

  function node(tag, id, classes = []) {
    const element = {
      tag, id, textContent: "", children: [], parentElement: null, ownerDocument: document,
      attributes: new Set(), classes: new Set(classes),
      classList: {
        add: name => element.classes.add(name),
        remove: name => element.classes.delete(name),
        contains: name => element.classes.has(name)
      },
      setAttribute: name => element.attributes.add(name),
      removeAttribute: name => element.attributes.delete(name),
      hasAttribute: name => element.attributes.has(name),
      appendChild(child) { child.parentElement = element; element.children.push(child); return child; },
      prepend(child) { child.parentElement = element; element.children.unshift(child); },
      remove() {
        const siblings = element.parentElement.children;
        siblings.splice(siblings.indexOf(element), 1);
        element.parentElement = null;
      },
      querySelectorAll(selector) {
        const name = selector.slice(1);
        const found = [];
        const walk = parent => parent.children.forEach(child => {
          if (child.classes.has(name)) found.push(child);
          walk(child);
        });
        walk(element);
        return found;
      }
    };
    all.push(element);
    return element;
  }

  function snapshot() {
    return {
      hidden: all.filter(element => element.attributes.has("data-pivot-print-hidden")).map(element => element.id),
      selected: all.filter(element => element.classes.has("is-cell-selected")).length,
      header: grid.children[0]?.className === "pivot-print-header"
        ? grid.children[0].children.map(line => line.textContent)
        : null
    };
  }

  const body = node("body", "body");
  const top = body.appendChild(node("header", "top"));
  const main = body.appendChild(node("main", "main"));
  const side = main.appendChild(node("aside", "side"));
  const grid = main.appendChild(node("div", "grid"));
  const cell = grid.appendChild(node("td", "cell", ["is-cell-selected"]));
  const footer = body.appendChild(node("footer", "footer"));

  return { view, grid, snapshot, top, side, cell, footer };
}

test("print hides everything but the grid, and puts it all back after printing", () => {
  const { view, grid, snapshot } = printDom();

  window.PivotForge.print(grid, { title: "Satış raporu", subtitle: "Filtre yok" });

  assert.deepEqual(view.printed.hidden.sort(), ["footer", "side", "top"]);
  assert.equal(view.printed.selected, 0);
  assert.deepEqual(view.printed.header, ["Satış raporu", "Filtre yok"]);

  // Still hidden until the browser says the print is over.
  assert.equal(snapshot().hidden.length, 3);
  view.fire("afterprint");
  assert.deepEqual(snapshot(), { hidden: [], selected: 1, header: null });
});

test("print adds no header without a title and refuses an element that cannot print", () => {
  const { view, grid } = printDom();

  window.PivotForge.print(grid);
  assert.equal(view.printed.header, null);
  view.fire("afterprint");

  assert.throws(() => window.PivotForge.print(null), /requires an element/);
});

test("totals after the rows: a heading opens each group and its total closes it, unless collapsed", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  renderer.collapsedRows = new Set();
  const rowHeaders = [["Ege", "İzmir"], ["Ege", "Manisa"], ["Marmara", "Bursa"]];
  const shape = plan => plan.map(row =>
    `${row.type}${row.trailing ? "↓" : ""}${row.opensTotal ? "↑" : ""}:${row.rowHeader.join("/")}`);
  const settings = { subtotals: true, totalsPosition: "after" };

  assert.deepEqual(shape(renderer.createRowPlan(rowHeaders, 2, settings)), [
    "group↑:Ege", "detail:Ege/İzmir", "detail:Ege/Manisa", "subtotal↓:Ege",
    "group↑:Marmara", "detail:Marmara/Bursa", "subtotal↓:Marmara"
  ]);

  // Heading and total share the group's key: the toggle and the sums both find it.
  const plan = renderer.createRowPlan(rowHeaders, 2, settings);
  assert.equal(plan[0].key, plan[3].key);

  // A collapsed group is its total row alone, the toggle on it.
  renderer.collapsedRows.add(plan[0].key);
  assert.deepEqual(shape(renderer.createRowPlan(rowHeaders, 2, settings)).slice(0, 2), [
    "subtotal:Ege", "detail:Ege/İzmir"
  ]);

  // Before is unchanged, and so is a grid without totals.
  renderer.collapsedRows.clear();
  assert.deepEqual(shape(renderer.createRowPlan(rowHeaders, 2, { subtotals: true })).slice(0, 2), [
    "subtotal:Ege", "detail:Ege/İzmir"
  ]);
  assert.deepEqual(shape(renderer.createRowPlan(rowHeaders, 2, { subtotals: false, totalsPosition: "after" })).slice(0, 4), [
    "group:Ege", "detail:Ege/İzmir", "detail:Ege/Manisa", "group:Marmara"
  ]);
});

test("a trailing total is selected apart from the heading of its group", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const heading = renderer.createRowSelection({ type: "group", rowHeader: ["Ege"], rowIndexes: [0, 1] });
  const total = renderer.createRowSelection({ type: "subtotal", trailing: true, rowHeader: ["Ege"], rowIndexes: [0, 1] });

  assert.notEqual(heading.rowKey, total.rowKey);
});

test("a field's own allowSorting and allowFiltering decide its header controls", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const settings = {
    rowFields: ["Region", "Category"],
    rowFieldAllowSorting: [false, true],
    rowFieldAllowFiltering: [true, false],
    columnFields: ["Year"],
    columnFieldAllowSorting: [false],
    values: [{ key: "amount", allowSorting: false }, { key: "qty" }]
  };

  assert.equal(renderer.fieldAllowsSorting({ mode: "RowLabel", field: "Region" }, settings), false);
  assert.equal(renderer.fieldAllowsSorting({ mode: "RowLabel", field: "Category" }, settings), true);
  assert.equal(renderer.fieldAllowsSorting({ mode: "ColumnLabel", field: "Year" }, settings), false);
  assert.equal(renderer.fieldAllowsSorting({ mode: "RowTotalValue", valueKey: "amount" }, settings), false);
  assert.equal(renderer.fieldAllowsSorting({ mode: "RowTotalValue", valueKey: "qty" }, settings), true);
  assert.equal(renderer.fieldOption(settings, "Region", "AllowFiltering"), true);
  assert.equal(renderer.fieldOption(settings, "Category", "AllowFiltering"), false);
  // A field on neither axis has no say, so the grid's own setting stands.
  assert.equal(renderer.fieldOption(settings, "Other", "AllowFiltering"), undefined);
});

test("a format can write zero as text, negatives in parentheses and numbers in short form", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({}, { culture: "tr-TR" });
  const settings = { ...renderer.options, emptyText: "-" };
  const value = format => ({ key: "Amount_sum", format });

  assert.equal(renderer.formatValue(0, settings, value({ zeroText: "—" })), "—");
  // The zero text stands in for zero only; other numbers keep the grid's default.
  assert.equal(renderer.formatValue(1234.5, settings, value({ zeroText: "—" })),
    renderer.options.formatter.format(1234.5));

  assert.equal(renderer.formatValue(-1250, settings, value({ decimals: 0, negative: "parentheses" })), "(1.250)");
  assert.equal(renderer.formatValue(1250, settings, value({ decimals: 0, negative: "parentheses" })), "1.250");
  assert.equal(renderer.formatValue(-1250, settings, value({ decimals: 0, negative: "minus" })), "-1.250");

  // Intl puts a no-break space before the suffix.
  const plain = text => text.replace(/\s/g, " ");
  assert.equal(plain(renderer.formatValue(1250000, settings, value({ compact: true }))), "1,25 Mn");
  assert.equal(plain(renderer.formatValue(3000, settings, value({ compact: true }))), "3 B");
  assert.equal(plain(renderer.formatValue(-1250000, settings, value({ compact: true, negative: "parentheses" }))),
    "(1,25 Mn)");
  // An empty cell is still the grid's empty text, never the zero text.
  assert.equal(renderer.formatValue(null, settings, value({ zeroText: "—" })), "-");
});

test("customizeText has the last word, by function or by the name of one on the page", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({}, { culture: "tr-TR" });
  const settings = { ...renderer.options, emptyText: "-" };
  const seen = [];
  const definition = customizeText => ({ key: "Amount_sum", format: { decimals: 0 }, customizeText });

  const text = renderer.formatValue(1500, settings, definition(info => {
    seen.push(info);
    return info.value > 1000 ? `${info.valueText} ▲` : null;
  }));
  assert.equal(text, "1.500 ▲");
  assert.deepEqual(seen, [{ value: 1500, valueText: "1.500", valueKey: "Amount_sum" }]);

  // Null keeps the formatted text.
  assert.equal(renderer.formatValue(20, settings, definition(() => null)), "20");

  globalThis.pivotTexts = { amount: ({ valueText }) => `${valueText} TL` };
  try {
    assert.equal(renderer.formatValue(20, settings, definition("pivotTexts.amount")), "20 TL");
    assert.throws(() => renderer.formatValue(20, settings, definition("pivotTexts.missing")),
      /customizeText "pivotTexts.missing" for "Amount_sum" is not a function/);
  } finally {
    delete globalThis.pivotTexts;
  }
});

test("the Excel number format carries parentheses and the zero text as format sections", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const excel = format => renderer.getExcelNumberFormat({ format });

  assert.equal(excel({ decimals: 0 }), "#,##0");
  assert.equal(excel({ decimals: 0, negative: "parentheses" }), "#,##0;(#,##0)");
  assert.equal(excel({ decimals: 0, zeroText: "—" }), '#,##0;-#,##0;"—"');
  assert.equal(excel({ type: "currency", currency: "TRY", decimals: 0, negative: "parentheses", zeroText: 'a"b' }),
    '₺#,##0;(₺#,##0);"a""b"');
  // No locale-neutral Excel spelling for a short form, so the full figure stays.
  assert.equal(excel({ decimals: 0, compact: true }), "#,##0");
});

test("value bars share an axis at zero, per measure and per row or column", () => {
  const { valueBarExtents } = window.PivotForge;
  const round = bars => bars.map(bar => bar && {
    start: Math.round(bar.start * 100) / 100,
    width: Math.round(bar.width * 100) / 100,
    negative: bar.negative
  });
  const entries = [
    { valueKey: "amount", rowKey: "r1", columnIndex: 0, value: 50 },
    { valueKey: "amount", rowKey: "r1", columnIndex: 1, value: 100 },
    { valueKey: "amount", rowKey: "r2", columnIndex: 0, value: null },
    { valueKey: "change", rowKey: "r1", columnIndex: 0, value: -25 },
    { valueKey: "change", rowKey: "r2", columnIndex: 0, value: 75 }
  ];

  assert.deepEqual(round(valueBarExtents(entries, "table")), [
    // All positive: from the left edge, the largest filling the cell.
    { start: 0, width: 0.5, negative: false },
    { start: 0, width: 1, negative: false },
    null,
    // -25 .. 75: zero sits a quarter of the way in, the negative bar to its left.
    { start: 0, width: 0.25, negative: true },
    { start: 0.25, width: 0.75, negative: false }
  ]);

  // Per column: column 1 holds 100 alone, which is still a full bar.
  assert.deepEqual(round(valueBarExtents(entries, "columns"))[1], { start: 0, width: 1, negative: false });
  assert.deepEqual(valueBarExtents(entries, "none"), entries.map(() => null));

  // All negative: the bars grow from the right edge.
  assert.deepEqual(round(valueBarExtents([
    { valueKey: "a", value: -10 }, { valueKey: "a", value: -40 }
  ], "table")), [
    { start: 0.75, width: 0.25, negative: true },
    { start: 0, width: 1, negative: true }
  ]);

  // Zeros have nothing to measure; a large-data page measures against the whole result.
  assert.deepEqual(valueBarExtents([{ valueKey: "a", value: 0 }], "table"), [null]);
  assert.deepEqual(
    round(valueBarExtents([{ valueKey: "a", value: 25 }], "table", [{ valueKey: "a", column: null, min: 0, max: 100 }])),
    [{ start: 0, width: 0.25, negative: false }]);
});

test("value bars are set on the value cells and cleared when switched off", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const makeCell = () => {
    const classes = new Set();
    const style = new Map();
    return {
      classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), has: name => classes.has(name) },
      style: { setProperty: (name, value) => style.set(name, value), removeProperty: name => style.delete(name) },
      bar: () => [style.get("--pt-bar-start"), style.get("--pt-bar-end")]
    };
  };
  const cells = [makeCell(), makeCell()];
  const table = { querySelectorAll: () => cells };
  [-10, 30].forEach((value, index) =>
    renderer.selectionMetadata.set(cells[index], { valueKey: "amount", rowKey: "r", columnIndex: index, value }));

  renderer.applyValueBars(table, { valueBars: "table" });
  assert.deepEqual(cells.map(cell => cell.bar()), [["0%", "25%"], ["25%", "100%"]]);
  assert.equal(cells[0].classList.has("is-negative-bar"), true);
  assert.equal(cells[1].classList.has("is-negative-bar"), false);
  assert.equal(cells.every(cell => cell.classList.has("has-value-bar")), true);

  renderer.applyValueBars(table, { valueBars: "none" });
  assert.deepEqual(cells.map(cell => cell.bar()), [[undefined, undefined], [undefined, undefined]]);
  assert.equal(cells.some(cell => cell.classList.has("has-value-bar")), false);
});

test("a rows layout counts its values column before the data columns", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const values = [{ key: "a", showGrandTotals: false }, { key: "b" }];
  const columnHeaders = [["2025"], ["2026"]];

  renderer.measureColumns = 0;
  assert.equal(renderer.dataStart(2), 2);
  // Two row levels, two columns of two values, and one total: "a" gave its own up.
  assert.equal(renderer.columnCount(2, columnHeaders, values, {}), 7);

  renderer.measureColumns = 1;
  const slot = renderer.createValueSlot(values);
  assert.equal(renderer.dataStart(2), 3);
  // The values column, then one slot per column and one total.
  assert.equal(renderer.columnCount(2, columnHeaders, [slot], {}), 6);
  // The slot keeps the total column while any value keeps its total, and names no value.
  assert.equal(slot.showGrandTotals, true);
  assert.equal(slot.label, "");
  assert.equal(slot.allowSorting, false);
});

test("the horizontal arrows trade places right to left, and only there", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
  const rtl = { dir: "rtl" };
  const ltr = { dir: "ltr" };
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = element => ({ direction: element.dir });

  try {
    assert.equal(window.PivotForge.isRtl(rtl), true);
    assert.equal(window.PivotForge.isRtl(null), false);
    assert.equal(renderer.visualArrow("ArrowLeft", rtl), "ArrowRight");
    assert.equal(renderer.visualArrow("ArrowRight", rtl), "ArrowLeft");
    assert.equal(renderer.visualArrow("ArrowUp", rtl), "ArrowUp");
    assert.equal(renderer.visualArrow("ArrowLeft", ltr), "ArrowLeft");

    const menu = {};
    window.PivotForge.matchDirection(menu, rtl);
    assert.equal(menu.dir, "rtl");
  } finally {
    globalThis.getComputedStyle = previous;
  }
});

test("virtual columns draw a window of pages around the view, with absolute positions", () => {
  const plan = Array.from({ length: 50 }, (_, columnIndex) => ({ type: "detail", columnIndex, columnHeader: [String(columnIndex)] }));
  const container = { scrollLeft: 0, clientWidth: 500 };
  const renderer = new window.PivotForge.PivotTableRenderer(container);
  const settings = { virtualColumns: true, virtualColumnWidth: 100 };

  // Off: no window at all.
  assert.equal(renderer.resolveColumnWindow(plan, 1, { virtualColumns: false }), null);

  // At the start: the view (5 columns) and one page after it.
  let slice = renderer.resolveColumnWindow(plan, 1, settings);
  assert.deepEqual([slice.offset, slice.plan.length, slice.after], [0, 10, 40]);
  assert.equal(slice.plan[3].position, 3);

  // In the middle: a page either side of the view, 5 + 5 + 5.
  container.scrollLeft = 2000;
  slice = renderer.resolveColumnWindow(plan, 1, settings);
  assert.deepEqual([slice.before, slice.plan[0].position, slice.plan.length], [15, 15, 15]);

  // RTL scrolls negative; the same distance gives the same window.
  container.scrollLeft = -2000;
  assert.equal(renderer.resolveColumnWindow(plan, 1, settings).before, 15);

  // At the end: the window stops at the last column.
  container.scrollLeft = 4800;
  slice = renderer.resolveColumnWindow(plan, 1, settings);
  assert.equal(slice.after, 0);
  assert.equal(slice.plan.at(-1).position, 49);

  // Two values per column: a position is twice as wide.
  container.scrollLeft = 2000;
  assert.equal(renderer.resolveColumnWindow(plan, 2, settings).before, 7);
});

test("a percent display mode without a declared format reads as a percentage, on screen and in the sheet", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({}, { culture: "en-US" });
  const settings = { ...renderer.options };

  for (const showAs of ["percentOfGrandTotal", "percentOfParentRowTotal", "percentOfParentColumnTotal"]) {
    assert.equal(renderer.formatNumber(0.1825, settings, { showAs }), "18.25%");
    assert.equal(renderer.getExcelNumberFormat({ showAs }), "0.00%");
  }

  // A plain value keeps the grid's number, and a declared format still wins.
  assert.equal(renderer.formatNumber(0.5, settings, { showAs: "normal" }), "0.5");
  assert.equal(renderer.getExcelNumberFormat({ showAs: "normal" }), "#,##0.00");
  assert.equal(renderer.formatNumber(0.5, settings, { showAs: "percentOfGrandTotal", format: { type: "number", decimals: 1 } }), "0.5");
});
