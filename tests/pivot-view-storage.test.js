const assert = require("node:assert/strict");
const test = require("node:test");
const PivotViewStore = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-view-storage.js");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

function createStore(storage = new MemoryStorage()) {
  return new PivotViewStore(storage, {
    fields: ["Region", "Category", "Year", "Amount"]
  });
}

function createState() {
  return {
    version: 1,
    layout: {
      rows: ["Region", "Unknown"],
      columns: ["Year"],
      values: [{ field: "Amount", aggregation: "sum", showAs: "percentOfGrandTotal", format: { type: "currency", decimals: 0, currency: "TRY" } }],
      filters: [{ field: "Category", values: ["Beton"] }]
    },
    viewSettings: { layoutMode: "compact", repeatRowLabels: true, subtotals: false, largeData: true },
    sort: { mode: "RowLabel", direction: "Ascending", field: "Region" },
    fieldAliases: { Region: "Bölge", Unknown: "Bilinmeyen" },
    conditionalRules: [
      { id: "high-sales", valueKey: "Amount_sum", operator: "greaterThanOrEqual", threshold: 1000, color: "green" },
      { id: "broken", valueKey: "Amount_sum", operator: "unknown", threshold: 0, color: "purple" }
    ],
    columnWidths: [[0, 150], [2, 999]],
    collapsedGroups: ["Marmara", "Marmara", 42]
  };
}

test("last state is normalized and restored", () => {
  const store = createStore();

  assert.equal(store.saveLastState(createState()), true);
  assert.deepEqual(store.loadLastState(), {
    version: 1,
    layout: {
      rows: ["Region"],
      columns: ["Year"],
      values: [{ field: "Amount", aggregation: "sum", showAs: "percentOfGrandTotal", format: { type: "currency", decimals: 0, useGrouping: true, currency: "TRY" } }],
      filters: [{ field: "Category", values: ["Beton"] }]
    },
    viewSettings: { layoutMode: "compact", repeatRowLabels: true, subtotals: false, largeData: true },
    sort: { mode: "RowLabel", direction: "Ascending", field: "Region" },
    fieldAliases: { Region: "Bölge" },
    conditionalRules: [
      { id: "high-sales", valueKey: "Amount_sum", operator: "greaterThanOrEqual", threshold: 1000, color: "green" }
    ],
    columnWidths: [[0, 150], [2, 420]],
    collapsedGroups: ["Marmara"]
  });
});

test("malformed and unknown-version payloads fall back safely", () => {
  const storage = new MemoryStorage();
  const store = createStore(storage);

  storage.setItem(store.lastStateKey, "{broken");
  assert.equal(store.loadLastState(), null);

  storage.setItem(store.lastStateKey, JSON.stringify({ ...createState(), version: 2 }));
  assert.equal(store.loadLastState(), null);
});

test("missing and unknown show-as modes normalize to normal", () => {
  const store = createStore();
  const state = createState();

  delete state.layout.values[0].showAs;
  assert.equal(store.normalizeState(state).layout.values[0].showAs, "normal");

  state.layout.values[0].showAs = "unsupported";
  assert.equal(store.normalizeState(state).layout.values[0].showAs, "normal");
});

test("conditional formatting rules reject malformed operators and ranges", () => {
  const store = createStore();
  const state = createState();
  state.conditionalRules = [
    { id: "range", valueKey: "Amount_sum", operator: "between", threshold: 10, threshold2: 20, color: "amber" },
    { id: "missing-end", valueKey: "Amount_sum", operator: "between", threshold: 10, color: "amber" },
    { id: "bad-color", valueKey: "Amount_sum", operator: "equal", threshold: 10, color: "purple" }
  ];

  assert.deepEqual(store.normalizeState(state).conditionalRules, [
    { id: "range", valueKey: "Amount_sum", operator: "between", threshold: 10, threshold2: 20, color: "amber" }
  ]);
});

test("named views can be created, overwritten, loaded, and deleted", () => {
  const store = createStore();
  const first = store.saveView("Satış Özeti", createState());
  const overwritten = store.saveView("satış özeti", {
    ...createState(),
    viewSettings: { layoutMode: "tabular", repeatRowLabels: false, subtotals: true, largeData: false }
  });

  assert.equal(store.listViews().length, 1);
  assert.equal(overwritten.id, first.id);
  assert.equal(store.getView(first.id).state.viewSettings.layoutMode, "tabular");
  assert.equal(store.deleteView(first.id), true);
  assert.deepEqual(store.listViews(), []);
});

test("renaming a view cannot create a duplicate name", () => {
  const store = createStore();
  const first = store.saveView("Birinci", createState());
  store.saveView("İkinci", createState());

  assert.equal(store.saveView("İkinci", createState(), first.id), null);
  assert.deepEqual(store.listViews().map(view => view.name), ["Birinci", "İkinci"]);
});
