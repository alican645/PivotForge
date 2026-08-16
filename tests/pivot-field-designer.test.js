const assert = require("node:assert/strict");
const test = require("node:test");

// Real DOM `children` is an HTMLCollection: length and indexed access only, with
// no Array.prototype methods on it. The stub mirrors that contract exactly, so
// production code cannot lean on array methods that do not exist in a browser.
function asChildren(items) {
  const collection = {
    length: items.length,
    item: index => items[index] ?? null,
    // A real HTMLCollection is iterable, so Array.from and spread work on it —
    // it just has no Array.prototype methods of its own.
    [Symbol.iterator]: () => items[Symbol.iterator]()
  };
  items.forEach((item, index) => { collection[index] = item; });
  return collection;
}

// A DOM stub sufficient for the designer: element creation, class lists,
// children, and event listeners. The designer must not need more than this.
function createElement(tagName) {
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
    checked: false,
    title: "",
    value: "",
    classList: {
      names: new Set(),
      add(...names) { names.forEach(name => this.names.add(name)); },
      remove(...names) { names.forEach(name => this.names.delete(name)); },
      contains(name) { return this.names.has(name); },
      toggle(name, on) { on ? this.names.add(name) : this.names.delete(name); }
    },
    // Drop positioning is geometric, so the stub has to carry a box. Tests
    // assign `rect` to lay chips out; anything unplaced reports a zero box.
    rect: null,
    getBoundingClientRect() { return this.rect ?? { top: 0, bottom: 0, height: 0 }; },
    appendChild(child) { this._children.push(child); return child; },
    remove() { this.removed = true; },
    replaceChildren(...nodes) { this._children = nodes; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) {
      const handlers = this.listeners.get(name) ?? [];
      handlers.push(handler);
      this.listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter(entry => entry !== handler));
    },
    dispatch(name, event = {}) {
      (this.listeners.get(name) ?? []).forEach(handler => handler(event));
    }
  };
}

const documentBody = createElement("body");
const documentListeners = new Map();
globalThis.document = {
  createElement,
  body: documentBody,
  addEventListener(name, handler) {
    const handlers = documentListeners.get(name) ?? [];
    handlers.push(handler);
    documentListeners.set(name, handlers);
  },
  removeEventListener(name, handler) {
    documentListeners.set(
      name, (documentListeners.get(name) ?? []).filter(entry => entry !== handler));
  },
  dispatch(name, event = {}) {
    [...(documentListeners.get(name) ?? [])].forEach(handler => handler(event));
  }
};

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js");

const PivotForge = globalThis.PivotForge;

const catalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure" },
  { dataField: "Quarter", caption: "Çeyrek", area: "available", role: "dimension" }
];

function build() {
  const updates = [];
  const widget = { update: async payload => { updates.push(payload); } };
  const state = new PivotForge.PivotLayoutState(catalog);
  const host = createElement("div");
  const designer = new PivotForge.PivotFieldDesigner(host, { state, widget });

  return { designer, state, host, updates };
}

// Finds every rendered element carrying a data-field value, at any depth.
function chips(node, found = []) {
  if (node.dataset?.field) {
    found.push(node);
  }
  Array.from(node.children).forEach(child => chips(child, found));
  return found;
}

function zone(node, area) {
  if (node.dataset?.zone === area) {
    return node;
  }
  for (const child of node.children) {
    const match = zone(child, area);
    if (match) {
      return match;
    }
  }
  return null;
}

// Finds the first rendered element carrying a given data-action, at any depth.
function findByAction(node, action) {
  if (node.dataset?.action === action) {
    return node;
  }
  for (const child of node.children) {
    const match = findByAction(child, action);
    if (match) {
      return match;
    }
  }
  return null;
}

// Simulates a real HTML5 drag: dragstart on the source chip (which records
// the payload on the designer instance, since dataTransfer.getData is
// unreadable during dragover per spec), then the given event on the target.
function dragFieldTo(host, fieldName, target, eventName, extra = {}) {
  const source = chips(host).find(entry => entry.dataset.field === fieldName);
  const dataTransfer = { data: {}, setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type] ?? ""; } };
  source.dispatch("dragstart", { dataTransfer });

  let prevented = false;
  target.dispatch(eventName, {
    preventDefault() { prevented = true; },
    dataTransfer,
    ...extra
  });

  return { prevented };
}

test("renders a zone for each area plus the available list", () => {
  const { host } = build();

  assert.notEqual(zone(host, "row"), null);
  assert.notEqual(zone(host, "column"), null);
  assert.notEqual(zone(host, "data"), null);
  assert.notEqual(zone(host, "filter"), null);
  assert.notEqual(zone(host, "available"), null);
});

test("renders a chip for every catalog field", () => {
  const { host } = build();

  assert.deepEqual(
    chips(host).map(chip => chip.dataset.field).sort(),
    ["Amount", "Quantity", "Quarter", "Region", "Year"]
  );
});

test("a chip carries the field caption, not its name", () => {
  const { host } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Region");
  const label = Array.from(chip.children).find(child => child.className === "pivot-chip__label");

  assert.equal(label.textContent, "Bölge");
});

test("dropping a dimension into the rows zone updates the state and the widget once", async () => {
  const { host, state, updates } = build();

  const target = zone(host, "row");
  dragFieldTo(host, "Quarter", target, "drop");
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Quarter"]);
  assert.equal(updates.length, 1);
});

test("dropping a measure into the rows zone changes nothing", async () => {
  const { host, state, updates } = build();
  const before = state.getState();

  dragFieldTo(host, "Quantity", zone(host, "row"), "drop");
  await Promise.resolve();

  assert.deepEqual(state.getState(), before);
  assert.equal(updates.length, 0);
});

test("dragend clears the tracked dragged field", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");
  const dataTransfer = { data: {}, setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type] ?? ""; } };

  source.dispatch("dragstart", { dataTransfer });
  assert.equal(designer.draggedField, "Quarter");

  source.dispatch("dragend", {});
  assert.equal(designer.draggedField, null);
});

test("drop uses the tracked dragged field, not whatever the event's dataTransfer reports", async () => {
  const { host, state, updates } = build();

  const source = chips(host).find(entry => entry.dataset.field === "Quarter");
  const startDataTransfer = { data: {}, setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type] ?? ""; } };
  source.dispatch("dragstart", { dataTransfer: startDataTransfer });

  // The drop event's own dataTransfer names a field that is already in the
  // target area ("Region" is already a row), so if drop ignored the tracked
  // draggedField ("Quarter") and used only this payload, canDrop would refuse
  // it and nothing would happen.
  const mismatchedDataTransfer = { getData: () => "Region" };
  let prevented = false;
  zone(host, "row").dispatch("drop", {
    preventDefault() { prevented = true; },
    dataTransfer: mismatchedDataTransfer
  });
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Quarter"]);
  assert.equal(updates.length, 1);
  assert.equal(prevented, true);
});

test("apply mutates the state before it calls widget.update", async () => {
  let rowsWhenUpdateWasCalled = null;
  const state = new PivotForge.PivotLayoutState(catalog);
  const widget = {
    update: async () => {
      // async functions run synchronously up to the first await, so this
      // captures the state at the exact moment apply() invokes update() —
      // before apply() itself awaits anything.
      rowsWhenUpdateWasCalled = state.getState().rows;
    }
  };
  const host = createElement("div");
  const designer = new PivotForge.PivotFieldDesigner(host, { state, widget });

  const target = zone(host, "row");
  dragFieldTo(host, "Quarter", target, "drop");
  await Promise.resolve();

  assert.deepEqual(rowsWhenUpdateWasCalled, ["Region", "Quarter"]);
});

test("dragover refuses an invalid target", () => {
  const { host } = build();

  const { prevented } = dragFieldTo(host, "Quantity", zone(host, "row"), "dragover");

  assert.equal(prevented, false);
});

test("dragover accepts a valid target", () => {
  const { host } = build();

  const { prevented } = dragFieldTo(host, "Quarter", zone(host, "row"), "dragover");

  assert.equal(prevented, true);
});

test("the remove control on the last data field is disabled and explains why", () => {
  const { host } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Amount");
  const remove = Array.from(chip.children).find(child => child.dataset?.action === "remove");

  assert.equal(remove.disabled, true);
  assert.equal(remove.title.length > 0, true);
});

test("changing an aggregation updates the state and the widget once", async () => {
  const { host, state, updates } = build();

  findByAction(chips(host).find(entry => entry.dataset.field === "Amount"), "settings")
    .dispatch("click", {});
  const panel = documentBody._children.findLast(
    node => node.className?.includes("pivot-value-settings"));
  const button = allByAction(panel, "aggregation").find(entry => entry.dataset.value === "average");
  button.dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.getState().values[0].aggregation, "average");
  assert.equal(updates.length, 1);
});

test("a search term filters the available list", () => {
  const { host } = build();
  const search = findByAction(host, "search");

  search.value = "eyr";
  search.dispatch("input", { target: search });

  const names = chips(zone(host, "available")).map(chip => chip.dataset.field);
  assert.deepEqual(names, ["Quarter"]);
});

test("search matching is case-insensitive", () => {
  const { host } = build();
  const search = findByAction(host, "search");

  search.value = "ÇEYREK";
  search.dispatch("input", { target: search });

  const names = chips(zone(host, "available")).map(chip => chip.dataset.field);
  assert.deepEqual(names, ["Quarter"]);
});

test("search matches against the caption, not the field name", () => {
  const { host } = build();
  const search = findByAction(host, "search");

  // "Quarter" is the dataField; the caption is "Çeyrek" and does not contain it.
  search.value = "Quarter";
  search.dispatch("input", { target: search });

  const names = chips(zone(host, "available")).map(chip => chip.dataset.field);
  assert.deepEqual(names, []);
});

test("an empty search term shows every available field", () => {
  const { host } = build();
  const search = findByAction(host, "search");

  search.value = "eyr";
  search.dispatch("input", { target: search });
  search.value = "";
  search.dispatch("input", { target: search });

  const names = chips(zone(host, "available")).map(chip => chip.dataset.field).sort();
  assert.deepEqual(names, ["Quantity", "Quarter"]);
});

test("a search term matching nothing renders an empty available list without error", () => {
  const { host } = build();
  const search = findByAction(host, "search");

  assert.doesNotThrow(() => {
    search.value = "does-not-exist-anywhere";
    search.dispatch("input", { target: search });
  });

  const names = chips(zone(host, "available")).map(chip => chip.dataset.field);
  assert.deepEqual(names, []);
});

test("a search term does not affect the placed zones", () => {
  const { host } = build();
  const search = findByAction(host, "search");

  search.value = "does-not-exist-anywhere";
  search.dispatch("input", { target: search });

  assert.deepEqual(chips(zone(host, "row")).map(chip => chip.dataset.field), ["Region"]);
  assert.deepEqual(chips(zone(host, "column")).map(chip => chip.dataset.field), ["Year"]);
  assert.deepEqual(chips(zone(host, "data")).map(chip => chip.dataset.field), ["Amount"]);
});

test("the search term survives a mutation-triggered re-render", async () => {
  const { host } = build();
  let search = findByAction(host, "search");

  search.value = "eyr";
  search.dispatch("input", { target: search });

  // Trigger a mutation elsewhere, which calls render() and rebuilds the panel.
  findByAction(chips(host).find(entry => entry.dataset.field === "Amount"), "settings")
    .dispatch("click", {});
  const panel = documentBody._children.findLast(
    node => node.className?.includes("pivot-value-settings"));
  allByAction(panel, "aggregation")
    .find(entry => entry.dataset.value === "average")
    .dispatch("click", {});
  await Promise.resolve();

  search = findByAction(host, "search");
  assert.equal(search.value, "eyr");
  assert.deepEqual(chips(zone(host, "available")).map(c => c.dataset.field), ["Quarter"]);
});

test("typing in the search box never calls widget.update", () => {
  const { host, state, updates } = build();
  const before = state.getState();
  const search = findByAction(host, "search");

  search.value = "eyr";
  search.dispatch("input", { target: search });
  search.value = "eyre";
  search.dispatch("input", { target: search });
  search.value = "";
  search.dispatch("input", { target: search });

  assert.deepEqual(state.getState(), before);
  assert.equal(updates.length, 0);
});

test("dispose clears the host", () => {
  const { designer, host } = build();

  designer.dispose();

  assert.equal(host.children.length, 0);
});

test("a designer without a widget throws", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  assert.throws(
    () => new PivotForge.PivotFieldDesigner(createElement("div"), { state }),
    /requires a widget/
  );
});

test("a designer without a state throws", () => {
  assert.throws(
    () => new PivotForge.PivotFieldDesigner(createElement("div"), { widget: { update() {} } }),
    /requires a state/
  );
});


// --- Positional drag-and-drop -------------------------------------------
//
// Row and column order is the pivot's grouping hierarchy, so where a chip
// lands inside a zone is meaningful, not cosmetic. These tests lay the chips
// out on a fake vertical axis (each 20px tall, stacked from y=0) and release
// the pointer at a chosen y, exactly as a browser would report it.
//
// Every reorder case uses THREE chips and targets the middle slot. With two
// chips, "move down" and "append to the end" produce the same array, so a
// two-chip test would pass even if the drop index were ignored entirely.

const CHIP_HEIGHT = 20;

function zoneBody(host, area) {
  return Array.from(zone(host, area).children).find(child => child.className === "pivot-zone__body");
}

// Gives every chip in `area` a box, stacked top to bottom in render order.
function layOutZone(host, area) {
  const body = zoneBody(host, area);
  Array.from(body.children).forEach((chip, index) => {
    chip.rect = {
      top: index * CHIP_HEIGHT,
      bottom: (index + 1) * CHIP_HEIGHT,
      height: CHIP_HEIGHT
    };
  });
  return body;
}

// Just above the midpoint of the chip at `index`: "insert before this chip".
const beforeChip = index => index * CHIP_HEIGHT + (CHIP_HEIGHT / 2) - 1;
// Just below it: "insert after this chip".
const afterChip = index => index * CHIP_HEIGHT + (CHIP_HEIGHT / 2) + 1;

// Rows become [Region, Quarter, Year] — three chips, so the middle slot is
// distinguishable from both ends.
function buildWithThreeRows() {
  const built = build();
  built.state.move("Quarter", "row");
  built.state.move("Year", "row");
  built.designer.render();
  assert.deepEqual(built.state.getState().rows, ["Region", "Quarter", "Year"]);
  return built;
}

function markedChips(body) {
  return Array.from(body.children)
    .filter(chip =>
      chip.classList.contains("is-drop-before") || chip.classList.contains("is-drop-after"))
    .map(chip => ({
      field: chip.dataset.field,
      edge: chip.classList.contains("is-drop-before") ? "before" : "after"
    }));
}

test("a field from another zone lands on the released slot, not at the end", async () => {
  const { host, state } = buildWithThreeRows();
  state.move("Amount", "data");
  layOutZone(host, "row");

  dragFieldTo(host, "Quantity", zone(host, "row"), "drop", { clientY: beforeChip(1) });
  await Promise.resolve();

  // Quantity is a measure and must be refused regardless of position.
  assert.deepEqual(state.getState().rows, ["Region", "Quarter", "Year"]);
});

test("a dimension dropped on the middle slot is inserted there", async () => {
  const { host, state } = build();
  state.move("Quarter", "row");
  state.move("Year", "row");
  state.remove("Quarter");
  // Rows are [Region, Year]; Quarter is available again and drops between them.
  const built = { host, state };
  built.state.getState();
  layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "drop", { clientY: beforeChip(1) });
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Quarter", "Year"]);
});

test("dragging the first chip onto the middle slot reorders it, without appending", async () => {
  const { host, state } = buildWithThreeRows();
  layOutZone(host, "row");

  // Release just past Quarter's midpoint: between Quarter and Year.
  dragFieldTo(host, "Region", zone(host, "row"), "drop", { clientY: afterChip(1) });
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Quarter", "Region", "Year"]);
});

test("dragging the last chip onto the middle slot reorders it", async () => {
  const { host, state } = buildWithThreeRows();
  layOutZone(host, "row");

  dragFieldTo(host, "Year", zone(host, "row"), "drop", { clientY: beforeChip(1) });
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Year", "Quarter"]);
});

test("dragging a chip below the last one moves it to the end", async () => {
  const { host, state } = buildWithThreeRows();
  layOutZone(host, "row");

  dragFieldTo(host, "Region", zone(host, "row"), "drop", { clientY: afterChip(2) });
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Quarter", "Year", "Region"]);
});

test("a reorder refreshes the widget exactly once", async () => {
  const { host, updates } = buildWithThreeRows();
  updates.length = 0;
  layOutZone(host, "row");

  dragFieldTo(host, "Region", zone(host, "row"), "drop", { clientY: afterChip(1) });
  await Promise.resolve();

  assert.equal(updates.length, 1);
});

test("a value keeps its aggregation when it is only repositioned", async () => {
  const { host, state, designer } = build();
  state.move("Quantity", "data");
  state.setAggregation("Quantity", "average");
  designer.render();
  layOutZone(host, "data");

  dragFieldTo(host, "Quantity", zone(host, "data"), "drop", { clientY: beforeChip(0) });
  await Promise.resolve();

  assert.deepEqual(state.getState().values, [
    { field: "Quantity", aggregation: "average", showAs: "normal" },
    { field: "Amount", aggregation: "sum", showAs: "normal" }
  ]);
});

test("dragover marks the slot the chip would land in", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: beforeChip(1) });

  assert.deepEqual(markedChips(body), [{ field: "Quarter", edge: "before" }]);
});

test("the marker follows the pointer to a different slot", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: beforeChip(1) });
  zone(host, "row").dispatch("dragover", { preventDefault() {}, clientY: beforeChip(2) });

  assert.deepEqual(markedChips(body), [{ field: "Year", edge: "before" }]);
});

test("dragging past the last chip marks the end of the zone instead", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: afterChip(2) });

  assert.deepEqual(markedChips(body), [{ field: "Year", edge: "after" }]);
});

test("the drop marker is cleared when the pointer leaves the zone", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: beforeChip(1) });
  zone(host, "row").dispatch("dragleave", { preventDefault() {} });

  assert.deepEqual(markedChips(body), []);
});

test("the drop marker is cleared when the drag is abandoned", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: beforeChip(1) });
  source.dispatch("dragend", {});

  assert.deepEqual(markedChips(body), []);
});

test("a target the role rule refuses is not marked", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  // Quantity is a measure; it may not enter the rows zone at any position.
  dragFieldTo(host, "Quantity", zone(host, "row"), "dragover", { clientY: beforeChip(1) });

  assert.deepEqual(markedChips(body), []);
});

// --- Field settings modal ------------------------------------------------
//
// Every placed chip carries a "⋯" button opening a modal with the field's name,
// its position in the zone, and — for a Values chip — aggregation, showAs and
// number format. Two rows and one available field, so position and area-
// dependent sections are both exercisable.

const formatCatalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Quarter", caption: "Çeyrek", area: "available", role: "dimension" },
  {
    dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum",
    format: { type: "currency", decimals: 0, useGrouping: true, currency: "TRY" }
  }
];

function buildWithFormat() {
  const updates = [];
  const widget = { update: async payload => { updates.push(payload); } };
  const state = new PivotForge.PivotLayoutState(formatCatalog);
  const host = createElement("div");
  const designer = new PivotForge.PivotFieldDesigner(host, { state, widget });

  return { designer, state, host, updates };
}

const dataChip = host => chips(host).find(chip => chip.dataset.field === "Amount");

// Field settings moved out of the chip into a modal whose options are buttons
// rather than selects, so a choice is picked by clicking the button carrying
// its value and the current one is marked with data-selected.
function settingsPanel() {
  return documentBody._children.findLast(node => node.className?.includes("pivot-value-settings"));
}

function allByAction(node, action, found = []) {
  if (node.dataset?.action === action) {
    found.push(node);
  }
  Array.from(node.children).forEach(child => allByAction(child, action, found));
  return found;
}

function openSettings(host, field = "Amount") {
  findByAction(chips(host).find(chip => chip.dataset.field === field), "settings")
    .dispatch("click", {});
  return settingsPanel();
}

const choice = (action, value) =>
  allByAction(settingsPanel(), action).find(button => button.dataset.value === String(value));

const selected = action =>
  allByAction(settingsPanel(), action).find(button => button.dataset.selected === "true");

test("every placed chip offers the settings button, available ones do not", () => {
  const { host } = buildWithFormat();

  assert.notEqual(findByAction(dataChip(host), "settings"), null);
  assert.notEqual(
    findByAction(chips(host).find(chip => chip.dataset.field === "Region"), "settings"),
    null);
  assert.equal(
    findByAction(chips(zone(host, "available"))[0], "settings"),
    null);
});

test("the chip holds no inline aggregation or format controls", () => {
  const { host } = buildWithFormat();
  const chip = dataChip(host);

  assert.equal(findByAction(chip, "aggregation"), null);
  assert.equal(findByAction(chip, "format-type"), null);
});

test("the settings modal is not built until it is first opened", () => {
  // The stub body is shared across tests, so this counts what this designer
  // added rather than asserting the body is empty.
  const before = documentBody._children.length;

  buildWithFormat();

  assert.equal(documentBody._children.length, before);
});

test("opening marks the current aggregation, showAs and format", () => {
  const { host } = buildWithFormat();

  openSettings(host);

  assert.equal(selected("aggregation").dataset.value, "sum");
  assert.equal(selected("show-as").dataset.value, "normal");
  assert.equal(selected("format-type").dataset.value, "currency");
  assert.equal(selected("format-decimals").dataset.value, "0");
});

test("the rename box is seeded with the caption and the declared one as placeholder", () => {
  const { host, state } = buildWithFormat();
  state.setCaption("Amount", "Ciro");

  openSettings(host);

  assert.equal(findByAction(settingsPanel(), "caption").value, "Ciro");
  assert.equal(findByAction(settingsPanel(), "caption").attributes.placeholder, "Tutar");
});

test("renaming writes the caption and refreshes once", async () => {
  const { host, state, updates } = buildWithFormat();
  openSettings(host);
  updates.length = 0;

  findByAction(settingsPanel(), "caption").value = "Ciro";
  findByAction(settingsPanel(), "rename").dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.field("Amount").caption, "Ciro");
  assert.equal(updates.length, 1);
});

test("resetting the name restores the declared caption", async () => {
  const { host, state } = buildWithFormat();
  state.setCaption("Amount", "Ciro");
  openSettings(host);

  findByAction(settingsPanel(), "reset-caption").dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.field("Amount").caption, "Tutar");
});

test("move up is disabled for the first chip in its zone", () => {
  const { host } = buildWithFormat();

  openSettings(host, "Region");

  assert.equal(findByAction(settingsPanel(), "move-up").disabled, true);
  assert.equal(findByAction(settingsPanel(), "move-down").disabled, false);
});

test("move down reorders the zone", async () => {
  const { host, state } = buildWithFormat();
  openSettings(host, "Region");

  findByAction(settingsPanel(), "move-down").dispatch("click", {});
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Category", "Region"]);
});

test("move up reorders the zone", async () => {
  const { host, state } = buildWithFormat();
  openSettings(host, "Category");

  findByAction(settingsPanel(), "move-up").dispatch("click", {});
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Category", "Region"]);
});

test("changing the aggregation writes it to the state and refreshes once", async () => {
  const { host, state, updates } = buildWithFormat();
  openSettings(host);
  updates.length = 0;

  choice("aggregation", "average").dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.getState().values[0].aggregation, "average");
  assert.equal(updates.length, 1);
});

test("changing showAs writes it to the state", async () => {
  const { host, state } = buildWithFormat();
  openSettings(host);

  choice("show-as", "percentOfRowTotal").dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.getState().values[0].showAs, "percentOfRowTotal");
});

test("changing the type writes it to the state and refreshes once", async () => {
  const { host, state, updates } = buildWithFormat();
  openSettings(host);
  updates.length = 0;

  choice("format-type", "percent").dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.getState().values[0].format.type, "percent");
  assert.equal(updates.length, 1);
});

test("changing the decimals writes a number, not the raw string", async () => {
  const { host, state } = buildWithFormat();
  openSettings(host);

  choice("format-decimals", 3).dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.getState().values[0].format.decimals, 3);
  assert.equal(typeof state.getState().values[0].format.decimals, "number");
});

test("the grouping button toggles rather than always setting the same value", async () => {
  const { host, state } = buildWithFormat();
  openSettings(host);

  findByAction(settingsPanel(), "format-grouping").dispatch("click", {});
  await Promise.resolve();
  assert.equal(state.getState().values[0].format.useGrouping, false);

  findByAction(settingsPanel(), "format-grouping").dispatch("click", {});
  await Promise.resolve();
  assert.equal(state.getState().values[0].format.useGrouping, true);
});

test("editing one member leaves the others intact", async () => {
  const { host, state } = buildWithFormat();
  openSettings(host);

  choice("format-decimals", 2).dispatch("click", {});
  await Promise.resolve();

  assert.deepEqual(state.getState().values[0].format, {
    type: "currency", decimals: 2, useGrouping: true, currency: "TRY"
  });
});

test("the modal re-marks the new selection after an edit", async () => {
  const { host } = buildWithFormat();
  openSettings(host);

  choice("aggregation", "average").dispatch("click", {});
  await Promise.resolve();

  assert.equal(settingsPanel().classList.contains("is-open"), true);
  assert.equal(selected("aggregation").dataset.value, "average");
});

test("removing from the modal unplaces the field and closes the modal", async () => {
  const { host, state } = buildWithFormat();
  const panel = openSettings(host, "Region");

  findByAction(panel, "remove").dispatch("click", {});
  await Promise.resolve();

  assert.equal(state.getState().rows.includes("Region"), false);
  assert.equal(panel.classList.contains("is-open"), false);
});

test("the last value field cannot be removed from the modal either", () => {
  const { host } = buildWithFormat();

  openSettings(host);

  assert.equal(findByAction(settingsPanel(), "remove").disabled, true);
});

test("a non-data chip offers no aggregation or format sections", () => {
  const { host } = buildWithFormat();

  openSettings(host, "Region");

  assert.equal(allByAction(settingsPanel(), "aggregation").length, 0);
  assert.equal(allByAction(settingsPanel(), "show-as").length, 0);
  assert.equal(allByAction(settingsPanel(), "format-type").length, 0);
  assert.notEqual(findByAction(settingsPanel(), "caption"), null);
});

test("the close button closes the modal", () => {
  const { host } = buildWithFormat();
  const panel = openSettings(host);

  findByAction(panel, "settings-close").dispatch("click", {});

  assert.equal(panel.classList.contains("is-open"), false);
});

test("Escape closes the modal", () => {
  const { host } = buildWithFormat();
  const panel = openSettings(host);

  globalThis.document.dispatch("keydown", { key: "Escape" });

  assert.equal(panel.classList.contains("is-open"), false);
});

test("a click on the backdrop closes, a click inside the dialog does not", () => {
  const { host } = buildWithFormat();
  const panel = openSettings(host);

  panel.dispatch("click", { target: panel._children[0] });
  assert.equal(panel.classList.contains("is-open"), true);

  panel.dispatch("click", { target: panel });
  assert.equal(panel.classList.contains("is-open"), false);
});

test("a value with no declared format opens on the renderer's defaults", () => {
  const { host } = build();

  openSettings(host);

  assert.equal(selected("format-type").dataset.value, "number");
  assert.equal(selected("format-decimals").dataset.value, "2");
});

test("a field unplaced while its modal is open closes the modal", () => {
  // The remove button inside the modal closes it itself. This covers the other
  // route out of the layout — the × on the chip, or a drag back to the field
  // list — where nothing has told the modal its subject is gone.
  const { host, state, designer } = buildWithFormat();
  const panel = openSettings(host, "Region");
  assert.equal(panel.classList.contains("is-open"), true);

  // The × button's path: mutate, then re-render, with nobody telling the modal.
  state.remove("Region");
  designer.render();

  assert.equal(panel.classList.contains("is-open"), false);
});

// --- Filter value picker ----------------------------------------------------
// Loaded here rather than at the top of the file so the tests above run against
// a designer whose host never offered the packaged picker, which is exactly the
// state of an application that has not added the new script tag.
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-filter-picker.js");

function buildWithFilter(options = {}) {
  const updates = [];
  const requested = [];
  const widget = {
    update: async payload => { updates.push(payload); },
    ...(options.withoutFieldValues ? {} : {
      fieldValues: async field => {
        requested.push(field);
        return {
          field,
          values: ["Q1", "Q2", "Q3"],
          totalCount: 3,
          truncated: false,
          limit: 1000
        };
      }
    })
  };
  const state = new PivotForge.PivotLayoutState(catalog);
  const host = createElement("div");
  const designer = new PivotForge.PivotFieldDesigner(host, { state, widget });
  state.move("Quarter", "filter");
  designer.render();

  return { designer, state, host, updates, requested };
}

const filterChip = host => chips(host).find(chip => chip.dataset.field === "Quarter");

const pickerPanel = () =>
  documentBody._children.findLast(node => node.className?.includes("pivot-filter-picker"));

const pickerByAction = action => allByAction(pickerPanel(), action);

test("only a filter chip carries the funnel control", () => {
  const { host } = buildWithFilter();

  assert.ok(findByAction(filterChip(host), "filter"));
  assert.equal(findByAction(chips(host).find(chip => chip.dataset.field === "Region"), "filter"), null);
});

test("a widget that cannot list values gets no funnel rather than a broken one", () => {
  const { host } = buildWithFilter({ withoutFieldValues: true });

  assert.equal(findByAction(filterChip(host), "filter"), null);
});

test("the funnel asks the widget for that field's values", async () => {
  const { host, requested } = buildWithFilter();

  await findByAction(filterChip(host), "filter").dispatch("click", {});

  assert.deepEqual(requested, ["Quarter"]);
});

test("applying a selection writes it to the state and reaches the widget", async () => {
  const { designer, host, state, updates } = buildWithFilter();

  await designer.openFilterPicker("Quarter");
  const boxes = pickerByAction("filter-value");
  boxes[1].checked = false;
  boxes[1].dispatch("change", {});
  pickerByAction("filter-apply")[0].dispatch("click", {});

  assert.deepEqual(state.getState().filters, [{ field: "Quarter", values: ["Q1", "Q3"] }]);
  assert.deepEqual(updates.at(-1).filters, [{ field: "Quarter", values: ["Q1", "Q3"] }]);
});

test("an active filter chip shows how many values it accepts", async () => {
  const { designer, host, state } = buildWithFilter();

  state.setFilterValues("Quarter", ["Q1", "Q3"]);
  designer.render();

  assert.equal(findByClassName(filterChip(host), "pivot-chip__filter-count").textContent, "(2)");
});

test("a filter accepting everything shows no count, because it restricts nothing", async () => {
  const { designer, host, state } = buildWithFilter();
  state.setFilterValues("Quarter", ["Q1"]);
  designer.render();

  state.setFilterValues("Quarter", []);
  designer.render();

  assert.equal(findByClassName(filterChip(host), "pivot-chip__filter-count"), null);
});

test("reopening the picker shows the selection already in force", async () => {
  const { designer, state } = buildWithFilter();
  state.setFilterValues("Quarter", ["Q2"]);

  await designer.openFilterPicker("Quarter");

  assert.deepEqual(pickerByAction("filter-value").map(box => box.checked), [false, true, false]);
});

test("disposing the designer disposes the picker it built", async () => {
  const { designer } = buildWithFilter();
  await designer.openFilterPicker("Quarter");
  const picker = designer.filterPicker;

  designer.dispose();

  assert.equal(picker.disposed, true);
});

function findByClassName(node, name) {
  if (node.className?.split(" ").includes(name)) {
    return node;
  }
  for (const child of node.children) {
    const match = findByClassName(child, name);
    if (match) {
      return match;
    }
  }
  return null;
}
