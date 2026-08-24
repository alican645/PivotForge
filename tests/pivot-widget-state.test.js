const assert = require("node:assert/strict");
const test = require("node:test");

// Loaded because it defines the conditional-rule vocabulary a stored view is
// checked against, even though these widgets render through renderImpl.
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-table.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

const PivotForge = globalThis.PivotForge;

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

function createElement(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    _children: [],
    get children() { return asChildren(this._children); },
    listeners: new Map(),
    dataset: {},
    attributes: {},
    textContent: "",
    className: "",
    draggable: false,
    disabled: false,
    hidden: false,
    title: "",
    value: "",
    classList: {
      names: new Set(),
      add(...names) { names.forEach(name => this.names.add(name)); },
      remove(...names) { names.forEach(name => this.names.delete(name)); },
      contains(name) { return this.names.has(name); },
      toggle(name, on) { on ? this.names.add(name) : this.names.delete(name); }
    },
    appendChild(child) { this._children.push(child); return child; },
    replaceChildren(...nodes) { this._children = nodes; },
    remove() { this.removed = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) {
      const handlers = this.listeners.get(name) ?? [];
      handlers.push(handler);
      this.listeners.set(name, handlers);
    },
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, height: 20 })
  };
}

globalThis.document = {
  createElement,
  querySelector: () => designerHost,
  addEventListener() {},
  removeEventListener() {}
};

let designerHost = createElement();

// A storage stub with the Web Storage surface the widget is allowed to use.
function createStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: key => { entries.delete(key); }
  };
}

const fields = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quarter", caption: "Çeyrek", area: "available", role: "dimension" }
];

const STATE_KEY = "pivotforge:state:satis";

function build({ storage, seed, options = {}, designer = false } = {}) {
  const store = storage ?? createStorage(seed ?? {});
  globalThis.localStorage = store;
  globalThis.sessionStorage = createStorage();
  designerHost = createElement();

  const container = createElement();
  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ rowHeaders: [], columnHeaders: [], cells: [] }) }),
    stateStoring: "local",
    stateKey: "satis",
    ...(designer ? { fieldDesigner: "#designerHost" } : {}),
    ...options
  });

  return { widget, store, container };
}

const saved = store => JSON.parse(store.getItem(STATE_KEY));

const seedWith = state => ({ [STATE_KEY]: JSON.stringify({ version: 1, ...state }) });

// --- Key and storage resolution ---------------------------------------------

test("state-key names the storage entry", () => {
  const { widget, store } = build();

  widget.saveState();

  assert.ok(store.getItem(STATE_KEY));
  widget.dispose();
});

test("the container id stands in for a missing state key", () => {
  const container = createElement();
  container.id = "raporGrid";
  globalThis.localStorage = createStorage();
  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    stateStoring: "local"
  });

  widget.saveState();

  assert.ok(globalThis.localStorage.getItem("pivotforge:state:raporGrid"));
  widget.dispose();
});

test("with neither a key nor an id the widget still works, it just does not persist", () => {
  const store = createStorage();
  globalThis.localStorage = store;
  const widget = PivotForge.create(createElement(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    stateStoring: "local"
  });

  widget.saveState();

  assert.equal(store.entries.size, 0);
  assert.equal(widget.stateKey, null);
  widget.dispose();
});

test("session storage is used when asked for", () => {
  const { widget } = build({ options: { stateStoring: "session" } });

  widget.saveState();

  assert.ok(globalThis.sessionStorage.getItem(STATE_KEY));
  assert.equal(globalThis.localStorage.getItem(STATE_KEY), null);
  widget.dispose();
});

test("persistence is off unless it is asked for", () => {
  const { widget, store } = build({ options: { stateStoring: null } });

  widget.saveState();

  assert.equal(store.entries.size, 0);
  widget.dispose();
});

test("an unknown storage name is refused at the call site rather than ignored", () => {
  globalThis.localStorage = createStorage();

  assert.throws(
    () => PivotForge.create(createElement(), {
      fields,
      autoLoad: false,
      renderImpl: () => {},
      stateStoring: "cookie",
      stateKey: "satis"
    }),
    /stateStoring/);
});

// --- What is written --------------------------------------------------------

test("the payload carries the layout, captions, filters and sort", async () => {
  const { widget, store } = build({ designer: true });

  widget.layoutState.setCaption("Region", "Satış Bölgesi");
  widget.layoutState.move("Quarter", "filter");
  widget.layoutState.setFilterValues("Quarter", ["Ç1"]);
  await widget.sortBy({ mode: "RowLabel", direction: "Ascending", field: "Region" });

  const payload = saved(store);
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.layout.rows, ["Region"]);
  assert.deepEqual(
    payload.layout.filters, [{ field: "Quarter", values: ["Ç1"], mode: "Include" }]);
  assert.deepEqual(payload.captions, { Region: "Satış Bölgesi" });
  assert.equal(payload.rowSort.field, "Region");
  // available is derived from the catalog, so storing it would only let a stale
  // copy contradict the catalog on restore.
  assert.equal(payload.layout.available, undefined);
  widget.dispose();
});

// The restored filters come from the payload's top-level `filters`, not from
// the layout, so a designer's selection has to reach that key — otherwise a
// reloaded page would show unfiltered data until the next designer edit.
test("a filter picked in the designer round-trips through the payload", () => {
  const { widget, store } = build({ designer: true });
  widget.layoutState.move("Quarter", "filter");
  widget.layoutState.setFilterValues("Quarter", ["Ç1", "Ç3"]);

  assert.deepEqual(
    saved(store).filters, [{ field: "Quarter", values: ["Ç1", "Ç3"], mode: "Include" }]);
  widget.dispose();

  const reopened = build({ designer: true, storage: store }).widget;
  assert.deepEqual(
    reopened.getState().filters, [{ field: "Quarter", values: ["Ç1", "Ç3"], mode: "Include" }]);
  reopened.dispose();
});

test("a filter accepting everything is not written as a restriction", () => {
  const { widget, store } = build({ designer: true });

  widget.layoutState.move("Quarter", "filter");

  assert.deepEqual(saved(store).filters, []);
  assert.deepEqual(
    saved(store).layout.filters, [{ field: "Quarter", values: [], mode: "Include" }]);
  widget.dispose();
});

// What a row header's funnel does. The designer's next update() sends the
// layout state's filters, so a header filter that never reached the layout
// state would be wiped by the next drag.
test("a filter set on a row field survives the next designer edit", async () => {
  const { widget, store } = build({ designer: true });

  await widget.setFilter("Region", ["Ege"], "Exclude");

  assert.deepEqual(
    widget.layoutState.getState().filters,
    [{ field: "Region", values: ["Ege"], mode: "Exclude" }]);
  assert.deepEqual(
    saved(store).filters, [{ field: "Region", values: ["Ege"], mode: "Exclude" }]);
  // The field is filtered where it stands: it must not be re-seated in the
  // Filters zone, nor sent to the server twice.
  assert.equal(widget.layoutState.areaOf("Region"), "row");
  assert.deepEqual(
    widget.getState().fields.filter(field => field.dataField === "Region")
      .map(field => field.area),
    ["row"]);

  await widget.designer.apply(() => widget.layoutState.move("Quarter", "row", 1));

  assert.deepEqual(
    widget.getState().filters, [{ field: "Region", values: ["Ege"], mode: "Exclude" }]);
  widget.dispose();
});

// Finds the text of a chip's filter count, at any depth, or null when the chip
// carries none.
function filterCountText(node, field) {
  if (node.dataset?.field === field) {
    const count = Array.from(node.children)
      .find(child => child.className === "pivot-chip__filter-count");
    return count?.textContent ?? null;
  }

  for (const child of node.children) {
    const found = filterCountText(child, field);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

test("a filter applied through the widget redraws the designer's chip", async () => {
  // The chip is where a Filters-zone selection is visible at all, so a widget
  // that wrote the layout state without redrawing would leave it showing the
  // previous selection.
  const { widget } = build({ designer: true });
  await widget.designer.apply(() => widget.layoutState.move("Region", "filter", 0));
  assert.equal(filterCountText(designerHost, "Region"), null);

  await widget.setFilter("Region", ["Ege", "Marmara"]);

  assert.equal(filterCountText(designerHost, "Region"), "(2)");
  widget.dispose();
});

test("clearing a row field's filter through setFilter reaches the layout state", async () => {
  const { widget } = build({ designer: true });

  await widget.setFilter("Region", ["Ege"]);
  await widget.setFilter("Region", []);

  assert.deepEqual(widget.getState().filters, []);
  assert.deepEqual(
    widget.layoutState.getState().filters,
    [{ field: "Region", values: [], mode: "Include" }]);
  widget.dispose();
});

test("a widget without a designer persists only what it owns", async () => {
  const { widget, store } = build();

  await widget.setFilter("Region", ["Ege"]);

  const payload = saved(store);
  assert.deepEqual(payload.filters, [{ field: "Region", values: ["Ege"], mode: "Include" }]);
  assert.equal(payload.layout, undefined);
  assert.equal(payload.captions, undefined);
  widget.dispose();
});

test("every mutating path writes, not just the first", async () => {
  const { widget, store } = build();

  await widget.setFilter("Region", ["Ege"]);
  assert.deepEqual(saved(store).filters, [{ field: "Region", values: ["Ege"], mode: "Include" }]);

  await widget.sortBy({ mode: "RowLabel", direction: "Descending", field: "Region" });
  assert.equal(saved(store).rowSort.direction, "Descending");

  await widget.clearFilters();
  assert.deepEqual(saved(store).filters, []);

  await widget.update({ filters: [{ field: "Year", values: ["2024"] }] });
  assert.deepEqual(saved(store).filters, [{ field: "Year", values: ["2024"] }]);
  widget.dispose();
});

test("a designer mutation is persisted without waiting for a widget call", () => {
  const { widget, store } = build({ designer: true });

  widget.layoutState.move("Quarter", "row");

  assert.deepEqual(saved(store).layout.rows, ["Region", "Quarter"]);
  widget.dispose();
});

// --- What is read back ------------------------------------------------------

test("a stored layout is adopted instead of the declared one", () => {
  const { widget } = build({
    designer: true,
    seed: seedWith({
      layout: {
        rows: ["Quarter"],
        columns: ["Year"],
        values: [{ field: "Amount", aggregation: "average", showAs: "normal" }],
        filters: []
      },
      captions: { Quarter: "Dönem" }
    })
  });

  const state = widget.layoutState.getState();
  assert.deepEqual(state.rows, ["Quarter"]);
  assert.equal(state.values[0].aggregation, "average");
  assert.equal(widget.layoutState.field("Quarter").caption, "Dönem");
  widget.dispose();
});

test("stored filters and sort are adopted with no designer in play", () => {
  const { widget } = build({
    seed: seedWith({
      filters: [{ field: "Region", values: ["Ege"] }],
      rowSort: { mode: "RowLabel", direction: "Descending", field: "Region" }
    })
  });

  // Stored before modes existed, so it is adopted as the including filter it
  // was when it was saved.
  assert.deepEqual(
    widget.getState().filters, [{ field: "Region", values: ["Ege"], mode: "Include" }]);
  assert.equal(widget.getState().rowSort.direction, "Descending");
  widget.dispose();
});

test("a stored filter on a field the catalog no longer has is dropped", () => {
  const { widget } = build({
    seed: seedWith({ filters: [{ field: "Gone", values: ["x"] }, { field: "Region", values: ["Ege"] }] })
  });

  assert.deepEqual(
    widget.getState().filters, [{ field: "Region", values: ["Ege"], mode: "Include" }]);
  widget.dispose();
});

test("a stored filter carrying a mode the vocabulary does not know is dropped", () => {
  const { widget } = build({
    seed: seedWith({
      filters: [{ field: "Region", values: ["Ege"], mode: "exclude" }]
    })
  });

  // Dropped rather than thrown on, like every other unusable stored entry: a
  // view saved by a tampered-with or newer client must still open the page.
  assert.deepEqual(widget.getState().filters, []);
  widget.dispose();
});

// --- Nothing stored may break the page --------------------------------------

test("unparseable storage falls back to the declared layout", () => {
  const { widget } = build({ designer: true, seed: { [STATE_KEY]: "{ this is not json" } });

  assert.deepEqual(widget.layoutState.getState().rows, ["Region"]);
  widget.dispose();
});

test("a payload from another version is ignored", () => {
  const { widget } = build({
    designer: true,
    seed: { [STATE_KEY]: JSON.stringify({ version: 99, layout: { rows: ["Quarter"] } }) }
  });

  assert.deepEqual(widget.layoutState.getState().rows, ["Region"]);
  widget.dispose();
});

test("a layout the catalog can no longer honour falls back rather than throwing", () => {
  // Amount is a measure; a stored layout putting it in rows is exactly what a
  // catalog change can leave behind, and adoptLayout refuses it.
  const { widget } = build({
    designer: true,
    seed: seedWith({
      layout: {
        rows: ["Amount"],
        columns: [],
        values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
        filters: [{ field: "Region", values: ["Ege"] }]
      },
      filters: [{ field: "Region", values: ["Ege"] }]
    })
  });

  assert.deepEqual(widget.layoutState.getState().rows, ["Region"]);
  // The filters were part of the same rejected layout, so keeping them would
  // leave the widget filtering by a layout it just refused to adopt.
  assert.deepEqual(widget.getState().filters, []);
  widget.dispose();
});

test("a stored layout with no value field falls back, because a pivot needs one", () => {
  const { widget } = build({
    designer: true,
    seed: seedWith({ layout: { rows: ["Region"], columns: [], values: [], filters: [] } })
  });

  assert.deepEqual(widget.layoutState.getState().values.map(value => value.field), ["Amount"]);
  widget.dispose();
});

test("storage that throws on read leaves the widget usable", () => {
  const hostile = {
    getItem() { throw new Error("access denied"); },
    setItem() { throw new Error("access denied"); },
    removeItem() {}
  };
  globalThis.localStorage = hostile;
  designerHost = createElement();

  const widget = PivotForge.create(createElement(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fieldDesigner: "#designerHost",
    stateStoring: "local",
    stateKey: "satis"
  });

  assert.deepEqual(widget.layoutState.getState().rows, ["Region"]);
  widget.saveState();
  widget.dispose();
});

test("a browser with no storage at all is not a crash", () => {
  globalThis.localStorage = undefined;

  const widget = PivotForge.create(createElement(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    stateStoring: "local",
    stateKey: "satis"
  });

  widget.saveState();
  assert.deepEqual(widget.getState().filters, []);
  widget.dispose();
});

// --- Clearing ---------------------------------------------------------------

test("clearState forgets the entry so the next load starts from the declaration", () => {
  const { widget, store } = build();
  widget.saveState();
  assert.equal(store.entries.size, 1);

  widget.clearState();

  assert.equal(store.entries.size, 0);
  widget.dispose();
});

test("disposing keeps what was stored, because persistence outlives the page", () => {
  const { widget, store } = build();
  widget.saveState();

  widget.dispose();

  assert.equal(store.entries.size, 1);
});

// --- Conditional formatting rules --------------------------------------------

const rule = (overrides = {}) => ({
  id: "r1",
  valueKey: "Amount_sum",
  operator: "greaterThan",
  threshold: 100,
  color: "green",
  ...overrides
});

test("a rule the reader added is written to storage", () => {
  const { widget, store } = build();

  widget.addConditionalRule(rule());

  assert.deepEqual(saved(store).conditionalRules, [rule()]);
  widget.dispose();
});

test("a stored rule comes back on the next page load", () => {
  const { widget } = build({ seed: seedWith({ conditionalRules: [rule()] }) });

  assert.deepEqual(widget.conditionalRules, [rule()]);
  assert.deepEqual(widget.getState().conditionalRules, [rule()]);
  widget.dispose();
});

// The stored list already contains whatever the markup declared when it was
// saved, so adding to it would duplicate every declared rule on every reload.
test("a stored list replaces the declared rules rather than joining them", () => {
  const declared = rule({ id: "declared", color: "amber" });
  const { widget } = build({
    seed: seedWith({ conditionalRules: [rule({ id: "stored" })] }),
    options: { rendererOptions: { conditionalRules: [declared] } }
  });

  assert.deepEqual(widget.conditionalRules.map(entry => entry.id), ["stored"]);
  widget.dispose();
});

test("with nothing stored the declared rules stand", () => {
  const declared = rule({ id: "declared" });
  const { widget } = build({
    options: { rendererOptions: { conditionalRules: [declared] } }
  });

  assert.deepEqual(widget.conditionalRules.map(entry => entry.id), ["declared"]);
  widget.dispose();
});

test("clearing rules is written too, so they do not come back", () => {
  const { widget, store } = build({ seed: seedWith({ conditionalRules: [rule()] }) });

  widget.clearConditionalRules();

  assert.deepEqual(saved(store).conditionalRules, []);
  widget.dispose();
});

test("clearing one measure leaves the other measure's rule in storage", () => {
  const { widget, store } = build();
  widget.setConditionalRules([rule(), rule({ id: "r2", valueKey: "Quantity_sum" })]);

  widget.clearConditionalRules("Amount_sum");

  assert.deepEqual(saved(store).conditionalRules.map(entry => entry.id), ["r2"]);
  widget.dispose();
});

test("setConditionalRules is written as the whole list", () => {
  const { widget, store } = build({ seed: seedWith({ conditionalRules: [rule()] }) });

  widget.setConditionalRules([rule({ id: "r2", color: "blue" })]);

  assert.deepEqual(saved(store).conditionalRules.map(entry => entry.id), ["r2"]);
  widget.dispose();
});

// A stored view must open even when part of it can no longer be honoured --
// the same bargain the stored filters make.
test("a stored rule the renderer could not act on is dropped, not thrown on", () => {
  const cases = [
    rule({ id: "bad-operator", operator: "roughly" }),
    rule({ id: "bad-color", color: "purple" }),
    rule({ id: "no-threshold", threshold: null }),
    rule({ id: "no-measure", valueKey: "" }),
    rule({ id: "between-without-bound", operator: "between", threshold2: undefined }),
    null
  ];

  const { widget } = build({
    seed: seedWith({ conditionalRules: [...cases, rule({ id: "good" })] })
  });

  assert.deepEqual(widget.conditionalRules.map(entry => entry.id), ["good"]);
  widget.dispose();
});

test("a stored between rule keeps both of its bounds", () => {
  const between = rule({ id: "b", operator: "between", threshold: 10, threshold2: 90 });
  const { widget } = build({ seed: seedWith({ conditionalRules: [between] }) });

  assert.deepEqual(widget.conditionalRules, [between]);
  widget.dispose();
});

// A rule naming a measure that is not on screen right now paints nothing and
// becomes live again when the reader brings that measure back -- which is the
// behaviour they saved, so it must survive the round trip.
test("a rule on a measure that is not currently displayed survives", () => {
  const hidden = rule({ id: "hidden", valueKey: "Quantity_sum" });
  const { widget } = build({ seed: seedWith({ conditionalRules: [hidden] }) });

  assert.deepEqual(widget.conditionalRules, [hidden]);
  widget.dispose();
});

test("a stored entry that is not a list leaves the declared rules alone", () => {
  const declared = rule({ id: "declared" });
  const { widget } = build({
    seed: seedWith({ conditionalRules: "hepsi" }),
    options: { rendererOptions: { conditionalRules: [declared] } }
  });

  assert.deepEqual(widget.conditionalRules.map(entry => entry.id), ["declared"]);
  widget.dispose();
});

test("a view stored before rules existed opens with none", () => {
  const { widget } = build({ seed: seedWith({ rowSort: null }) });

  assert.deepEqual(widget.conditionalRules, []);
  widget.dispose();
});

test("a rule the renderer could not act on is refused at the call", () => {
  const { widget, store } = build();

  assert.throws(() => widget.addConditionalRule(rule({ operator: "roughly" })), /operator/);
  assert.throws(() => widget.addConditionalRule(rule({ color: "purple" })), /color/);
  assert.throws(() => widget.addConditionalRule(rule({ threshold: "çok" })), /threshold/);
  assert.deepEqual(widget.conditionalRules, []);
  assert.equal(store.getItem(STATE_KEY), null);
  widget.dispose();
});

// setConditionalRules is what restores a saved view, so one unreadable rule
// must not cost the reader the rest of them.
test("setConditionalRules drops what it cannot use instead of refusing", () => {
  const { widget } = build();

  widget.setConditionalRules([rule({ id: "bad", color: "purple" }), rule({ id: "good" })]);

  assert.deepEqual(widget.conditionalRules.map(entry => entry.id), ["good"]);
  widget.dispose();
});

test("rules are not persisted when persistence is off", () => {
  const { widget, store } = build({ options: { stateStoring: null } });

  widget.addConditionalRule(rule());

  assert.equal(store.getItem(STATE_KEY), null);
  assert.deepEqual(widget.conditionalRules, [rule()]);
  widget.dispose();
});

test("clearState forgets the rules along with the rest", () => {
  const { widget, store } = build();
  widget.addConditionalRule(rule());

  widget.clearState();

  assert.equal(store.getItem(STATE_KEY), null);
  widget.dispose();
});
