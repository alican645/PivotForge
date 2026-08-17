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
    collapsedGroups: ["Marmara", "Ege", 42]
  }, { rerender: false, notify: false });

  const snapshot = renderer.getViewState();
  snapshot.columnWidths[0][1] = 999;
  snapshot.collapsedGroups.push("Akdeniz");

  assert.deepEqual(renderer.getViewState(), {
    columnWidths: [[0, 144], [3, 220]],
    collapsedGroups: ["Marmara", "Ege"]
  });
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

test("cell context menu exposes enabled actions for an aggregate cell", () => {
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

  assert.deepEqual(items.map(item => item.label), [
    "Detayı aç",
    "Hücreyi kopyala",
    "Satırı kopyala",
    "Bu değere göre sırala",
    "Bu değere göre filtrele",
    "Koşullu biçimlendirme ekle"
  ]);
  assert.equal(items.every(item => item.disabled === false), true);
});

test("cell context menu disables value actions for empty group cells", () => {
  const renderer = new window.PivotForge.PivotTableRenderer({});
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
