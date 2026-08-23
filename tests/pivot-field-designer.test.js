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
function matchesSelector(node, selector) {
  if (selector.startsWith(".")) {
    return Boolean(node.className?.split(" ").includes(selector.slice(1)));
  }

  if (selector.startsWith("[") && selector.endsWith("]")) {
    const attribute = selector.slice(1, -1);
    const key = attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return node.dataset?.[key] !== undefined;
  }

  return node.tagName === selector.toUpperCase();
}

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
    appendChild(child) {
      child.parentNode = this;
      this._children.push(child);
      return child;
    },
    remove() { this.removed = true; },
    // Focus is real state in a keyboard-operable panel: the designer both reads
    // it (to decide whether it may take focus back after a re-render) and
    // moves it, so the stub has to model it rather than swallow the calls.
    tabIndex: -1,
    focus() {
      globalThis.document.activeElement = this;
      this.dispatch("focus", { target: this });
    },
    contains(node) {
      for (let entry = node; entry; entry = entry.parentNode) {
        if (entry === this) {
          return true;
        }
      }
      return false;
    },
    replaceChildren(...nodes) {
      nodes.forEach(node => { node.parentNode = this; });
      this._children = nodes;
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    // Real elements walk up the tree; the designer's hit testing depends on it,
    // so the stub keeps parent links and matches the three selector shapes the
    // production code actually uses.
    closest(selector) {
      for (let node = this; node; node = node.parentNode) {
        if (matchesSelector(node, selector)) {
          return node;
        }
      }
      return null;
    },
    // Chromium throws NotFoundError here when the id names no live pointer,
    // which is a state the designer has to survive rather than a state it can
    // assume away. `captureThrows` lets a test put the stub in it.
    setPointerCapture() {
      if (this.captureThrows) {
        throw new Error("No active pointer with the given id is found.");
      }
      this.captured = true;
    },
    releasePointerCapture() { this.captured = false; },
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
  activeElement: null,
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

// Drag runs on pointer events, and pointer capture retargets every move and
// the release to the chip being dragged — so the target zone is not the event
// target, it is whatever hit testing finds. `elementFromPoint` is what the
// designer asks, so that is what a test controls.
let elementUnderPointer = null;
globalThis.document.elementFromPoint = () => elementUnderPointer;

// Simulates a drag of `fieldName` released over `target`. `eventName` is kept
// from the drag-and-drop era: "drop" completes the gesture, anything else
// stops after the move, which is how hover feedback is tested.
function dragFieldTo(host, fieldName, target, eventName, extra = {}) {
  const source = chips(host).find(entry => entry.dataset.field === fieldName);
  const grip = findByAction(source, "grip");
  const clientY = extra.clientY ?? 0;
  let prevented = false;
  const preventDefault = () => { prevented = true; };

  elementUnderPointer = target;
  // Pressing at a point far from the move guarantees the drag threshold is
  // crossed by the first move, whatever coordinates the test asked for.
  source.dispatch("pointerdown", {
    target: grip, pointerId: 1, button: 0, pointerType: "mouse",
    clientX: -1000, clientY: -1000, preventDefault
  });
  source.dispatch("pointermove", { pointerId: 1, clientX: 0, clientY, preventDefault });

  if (eventName === "drop") {
    source.dispatch("pointerup", { pointerId: 1, clientX: 0, clientY, preventDefault });
  }

  return { prevented };
}

// Continues a drag already in flight, over a (possibly different) target.
function continueDrag(host, fieldName, target, clientY = 0) {
  const source = chips(host).find(entry => entry.dataset.field === fieldName);
  elementUnderPointer = target;
  source.dispatch("pointermove", { pointerId: 1, clientX: 0, clientY, preventDefault() {} });
}

// Ends a drag in flight: "pointerup" releases, "pointercancel" is what the
// platform sends when it takes the gesture away.
function finishDrag(host, fieldName, eventName, clientY = 0) {
  const source = chips(host).find(entry => entry.dataset.field === fieldName);
  source.dispatch(eventName, { pointerId: 1, clientX: 0, clientY, preventDefault() {} });
}

// A press-and-release that never travels: a click, not a drag.
function tapChip(host, fieldName, onTarget) {
  const source = chips(host).find(entry => entry.dataset.field === fieldName);
  source.dispatch("pointerdown", {
    target: onTarget ?? source, pointerId: 1, button: 0, pointerType: "mouse",
    clientX: 0, clientY: 0
  });
  source.dispatch("pointerup", { pointerId: 1, clientX: 0, clientY: 0 });
}

// Starts a drag with a finger rather than a mouse.
function touchDown(host, fieldName, { onGrip }) {
  const source = chips(host).find(entry => entry.dataset.field === fieldName);
  const grip = findByAction(source, "grip");
  source.dispatch("pointerdown", {
    target: onGrip ? grip : source, pointerId: 7, button: 0, pointerType: "touch",
    clientX: 0, clientY: 0
  });
  return source;
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

test("releasing clears the drag session", () => {
  const { host, designer } = build();

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover");
  assert.equal(designer.draggedField, "Quarter");

  finishDrag(host, "Quarter", "pointerup");
  assert.equal(designer.draggedField, null);
  assert.equal(designer.drag, null);
});

test("a press that never travels is a click, not a drag", async () => {
  const { host, designer, state, updates } = build();

  // Released squarely over a zone that would accept the field: only the
  // absence of travel keeps this from being a move.
  elementUnderPointer = zone(host, "row");
  tapChip(host, "Quarter");
  await Promise.resolve();

  assert.equal(designer.draggedField, null);
  assert.equal(designer.drag, null);
  assert.equal(state.areaOf("Quarter"), "available");
  assert.equal(updates.length, 0);
});

test("the release moves the field the drag began on, not whatever it landed over", async () => {
  const { host, state, updates } = build();

  // Pointer capture means every move and the release are delivered to the
  // dragged chip, so the field can only come from the session -- but the hit
  // test lands on the Region chip, which is already a row. Reading the field
  // from the element under the pointer would move nothing.
  const regionChip = chips(host).find(entry => entry.dataset.field === "Region");
  dragFieldTo(host, "Quarter", regionChip, "drop");
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Quarter"]);
  assert.equal(updates.length, 1);
});

test("a release outside every zone cancels rather than removing the field", async () => {
  const { host, state, updates } = build();
  state.move("Quarter", "row");
  build().designer.render();

  dragFieldTo(host, "Region", null, "drop");
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Quarter"]);
  assert.equal(updates.length, 0);
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

// preventDefault is now called on every move to stop text selection, so it is
// no longer the accept/refuse signal -- the zone's own class is.
test("dragging over an invalid target marks the zone refused", () => {
  const { host } = build();

  dragFieldTo(host, "Quantity", zone(host, "row"), "dragover");

  assert.equal(zone(host, "row").classList.contains("is-drop-refused"), true);
});

test("dragging over a valid target does not mark it refused", () => {
  const { host } = build();

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover");

  assert.equal(zone(host, "row").classList.contains("is-drop-refused"), false);
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
  continueDrag(host, "Quarter", zone(host, "row"), beforeChip(2));

  assert.deepEqual(markedChips(body), [{ field: "Year", edge: "before" }]);
});

test("dragging past the last chip marks the end of the zone instead", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: afterChip(2) });

  assert.deepEqual(markedChips(body), [{ field: "Year", edge: "after" }]);
});

test("the drop marker is cleared when the pointer leaves every zone", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: beforeChip(1) });
  continueDrag(host, "Quarter", null, beforeChip(1));

  assert.deepEqual(markedChips(body), []);
});

test("the drop marker is cleared when the platform takes the gesture away", () => {
  const { host } = buildWithThreeRows();
  const body = layOutZone(host, "row");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover", { clientY: beforeChip(1) });
  finishDrag(host, "Quarter", "pointercancel");

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

  assert.deepEqual(
    state.getState().filters, [{ field: "Quarter", values: ["Q1", "Q3"], mode: "Include" }]);
  assert.deepEqual(
    updates.at(-1).filters, [{ field: "Quarter", values: ["Q1", "Q3"], mode: "Include" }]);
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

// --- Touch and pointer mechanics --------------------------------------------
// HTML5 drag-and-drop never fires on a touch device, so the designer was
// unusable on a tablet or a phone. Pointer events cover mouse, touch and pen
// with one mechanism; what differs is where a touch is allowed to start one.

test("every chip carries a grip, including available ones", () => {
  const { host } = build();

  chips(host).forEach(chip => {
    assert.notEqual(findByAction(chip, "grip"), null, chip.dataset.field);
  });
});

test("the grip trails the chip and is hidden from screen readers", () => {
  const { host } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Region");
  const children = Array.from(chip.children);

  assert.equal(children.at(-1).className, "pivot-chip__grip");
  // It is a redundant handle for a gesture, not content: announcing it would
  // add noise to every field a screen-reader user walks past.
  assert.equal(children.at(-1).attributes["aria-hidden"], "true");
});

test("a finger on the grip starts a drag", () => {
  const { host, designer } = build();

  const source = touchDown(host, "Quarter", { onGrip: true });
  elementUnderPointer = zone(host, "row");
  source.dispatch("pointermove", { pointerId: 7, clientX: 0, clientY: 40, preventDefault() {} });

  assert.equal(designer.draggedField, "Quarter");
});

test("a finger on the chip body does not, so the list can still be scrolled", () => {
  const { host, designer } = build();

  const source = touchDown(host, "Quarter", { onGrip: false });
  source.dispatch("pointermove", { pointerId: 7, clientX: 0, clientY: 40, preventDefault() {} });

  assert.equal(designer.drag, null);
  assert.equal(designer.draggedField, null);
});

test("a mouse drags from the chip body, no grip needed", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });
  elementUnderPointer = zone(host, "row");
  source.dispatch("pointermove", { pointerId: 1, clientX: 0, clientY: 40, preventDefault() {} });

  assert.equal(designer.draggedField, "Quarter");
});

test("a press on a chip control never becomes a drag", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Region");
  const remove = findByAction(source, "remove");

  source.dispatch("pointerdown", {
    target: remove, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });
  source.dispatch("pointermove", { pointerId: 1, clientX: 0, clientY: 40, preventDefault() {} });

  assert.equal(designer.drag, null);
});

test("a right-click does not start a drag", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 2, pointerType: "mouse", clientX: 0, clientY: 0
  });

  assert.equal(designer.drag, null);
});

test("a move under the threshold is not yet a drag", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });
  source.dispatch("pointermove", { pointerId: 1, clientX: 2, clientY: 2, preventDefault() {} });

  assert.equal(designer.drag.started, false);
  assert.equal(source.classList.contains("is-dragging"), false);
});

test("a drag survives a browser that refuses pointer capture", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");
  source.captureThrows = true;

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });
  elementUnderPointer = zone(host, "row");
  source.dispatch("pointermove", { pointerId: 1, clientX: 0, clientY: 40, preventDefault() {} });

  // Capture only keeps events arriving once the pointer leaves the chip; losing
  // it must not cost the drag itself.
  assert.equal(designer.draggedField, "Quarter");
});

test("the dragged chip is marked in flight, and unmarked on release", () => {
  const { host } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  dragFieldTo(host, "Quarter", zone(host, "row"), "dragover");
  assert.equal(source.classList.contains("is-dragging"), true);

  finishDrag(host, "Quarter", "pointercancel");
  assert.equal(source.classList.contains("is-dragging"), false);
});

test("the drag takes pointer capture, so moves keep arriving off the chip", () => {
  const { host } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });

  assert.equal(source.captured, true);

  finishDrag(host, "Quarter", "pointerup");
  assert.equal(source.captured, false);
});

test("a second pointer's events are ignored while one drag is in flight", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });

  // A second finger travelling far enough to be a drag must not promote the
  // first one's session, and must not end it either.
  elementUnderPointer = zone(host, "row");
  source.dispatch("pointermove", { pointerId: 99, clientX: 0, clientY: 400, preventDefault() {} });
  assert.equal(designer.drag.started, false);
  assert.equal(designer.draggedField, null);

  source.dispatch("pointerup", { pointerId: 99, clientX: 0, clientY: 0 });
  assert.notEqual(designer.drag, null);
});

test("a drag released on the available list unplaces the field", async () => {
  const { host, state, designer, updates } = build();
  state.move("Quarter", "row");
  designer.render();

  dragFieldTo(host, "Quarter", zone(host, "available"), "drop");
  await Promise.resolve();

  assert.equal(state.areaOf("Quarter"), "available");
  assert.equal(updates.length, 1);
});

test("the last value field cannot be dragged out to the available list", async () => {
  const { host, state, updates } = build();

  dragFieldTo(host, "Amount", zone(host, "available"), "drop");
  await Promise.resolve();

  assert.equal(state.areaOf("Amount"), "data");
  assert.equal(updates.length, 0);
  assert.equal(zone(host, "available").classList.contains("is-drop-refused"), false);
});

test("disposing during a drag releases the capture it took", () => {
  const { host, designer } = build();
  const source = chips(host).find(entry => entry.dataset.field === "Quarter");

  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });
  designer.dispose();

  assert.equal(source.captured, false);
  assert.equal(designer.drag, null);
});

test("HTML5 drag-and-drop is gone: no chip is draggable and no drag listeners remain", () => {
  const { host } = build();

  chips(host).forEach(chip => {
    assert.equal(chip.draggable, false, chip.dataset.field);
    assert.equal(chip.listeners.has("dragstart"), false);
  });

  ["row", "column", "data", "filter", "available"].forEach(area => {
    const target = zone(host, area);
    assert.equal(target.listeners.has("dragover"), false, area);
    assert.equal(target.listeners.has("drop"), false, area);
  });
});

// --- Keyboard field movement -------------------------------------------------

// Presses a key on a field's chip, as a keyboard user would after tabbing to
// it. The chip is looked up fresh every time because every mutation rebuilds it.
function pressOn(host, fieldName, key) {
  const chip = chips(host).find(entry => entry.dataset.field === fieldName);
  let prevented = false;
  chip.dispatch("keydown", { key, target: chip, preventDefault() { prevented = true; } });
  return { chip, prevented };
}

test("chips are focusable, with exactly one tab stop per zone", () => {
  const { host } = build();

  const all = chips(host);
  assert.ok(all.length > 0);
  all.forEach(chip => {
    assert.ok(chip.tabIndex === 0 || chip.tabIndex === -1, chip.dataset.field);
  });

  ["row", "column", "data", "filter", "available"].forEach(area => {
    const inZone = chips(zone(host, area));
    if (inZone.length > 0) {
      assert.equal(
        inZone.filter(chip => chip.tabIndex === 0).length, 1,
        `${area} should have exactly one tab stop`);
    }
  });
});

test("chip controls are out of the tab sequence, so a field costs one stop not four", () => {
  const { host } = build();

  chips(host).forEach(chip => {
    Array.from(chip.children)
      .filter(child => child.tagName === "BUTTON")
      .forEach(button => {
        assert.equal(button.tabIndex, -1, `${chip.dataset.field}/${button.dataset.action}`);
      });
  });
});

test("arrow keys move focus between the chips of a zone, and stop at its ends", () => {
  const { host, designer } = build();
  const [first, second] = chips(zone(host, "available"));
  first.focus();

  pressOn(host, first.dataset.field, "ArrowDown");
  assert.equal(designer.focusField, second.dataset.field);
  assert.equal(globalThis.document.activeElement, second);

  pressOn(host, second.dataset.field, "ArrowUp");
  assert.equal(globalThis.document.activeElement, first);

  // Nothing above the first chip, so the key is left to the page.
  const { prevented } = pressOn(host, first.dataset.field, "ArrowUp");
  assert.equal(prevented, false);
  assert.equal(globalThis.document.activeElement, first);
});

test("focusing a chip moves its zone's tab stop onto it", () => {
  const { host } = build();
  const inZone = chips(zone(host, "available"));
  assert.equal(inZone[0].tabIndex, 0);

  inZone[1].focus();

  assert.equal(inZone[0].tabIndex, -1);
  assert.equal(inZone[1].tabIndex, 0);
});

test("Space picks a field up and marks it, without touching the state", () => {
  const { host, state, updates, designer } = build();

  const { chip, prevented } = pressOn(host, "Region", " ");

  assert.equal(prevented, true, "Space must not scroll the page");
  assert.equal(chip.classList.contains("is-keyboard-moving"), true);
  assert.equal(chip.attributes["aria-grabbed"], "true");
  assert.deepEqual(designer.grab, { name: "Region", area: "row", index: 0 });
  assert.equal(state.areaOf("Region"), "row");
  assert.equal(updates.length, 0);
});

test("Escape cancels a pick-up and leaves the layout exactly as it was", async () => {
  const { host, state, updates, designer } = build();
  const before = state.getState().rows.join();

  pressOn(host, "Region", " ");
  pressOn(host, "Region", "ArrowDown");
  pressOn(host, "Region", "Escape");
  await Promise.resolve();

  assert.equal(designer.grab, null);
  assert.equal(state.getState().rows.join(), before);
  assert.equal(updates.length, 0);
  const chip = chips(host).find(entry => entry.dataset.field === "Region");
  assert.equal(chip.classList.contains("is-keyboard-moving"), false);
  assert.equal(chip.attributes["aria-grabbed"], "false");
});

test("Space, ArrowDown, Space reorders a field within its own zone", async () => {
  const { host, state, updates, designer } = build();
  state.move("Quarter", "row", 1);
  designer.render();
  assert.deepEqual(state.getState().rows, ["Region", "Quarter"]);

  pressOn(host, "Region", " ");
  pressOn(host, "Region", "ArrowDown");
  pressOn(host, "Region", " ");
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Quarter", "Region"]);
  assert.equal(updates.length, 1);
});

test("dropping a field back on its own slot costs no request", async () => {
  const { host, updates } = build();

  pressOn(host, "Region", " ");
  pressOn(host, "Region", " ");
  await Promise.resolve();

  assert.equal(updates.length, 0);
});

test("ArrowRight carries a pick-up into the next zone and Space places it there", async () => {
  const { host, state, updates } = build();
  assert.equal(state.areaOf("Quarter"), "available");

  // available -> filter -> column
  pressOn(host, "Quarter", " ");
  pressOn(host, "Quarter", "ArrowRight");
  pressOn(host, "Quarter", "ArrowRight");
  pressOn(host, "Quarter", " ");
  await Promise.resolve();

  assert.equal(state.areaOf("Quarter"), "column");
  assert.equal(updates.length, 1);
});

test("a keyboard move into a zone the field's role forbids is refused, as a drag is", async () => {
  const { host, state, updates } = build();

  // Quantity is a measure: it belongs in the data zone and nowhere else.
  pressOn(host, "Quantity", " ");
  pressOn(host, "Quantity", "ArrowRight");
  assert.equal(zone(host, "filter").classList.contains("is-drop-refused"), true);

  pressOn(host, "Quantity", " ");
  await Promise.resolve();

  assert.equal(state.areaOf("Quantity"), "available");
  assert.equal(updates.length, 0);
});

test("ArrowLeft out of the first zone is refused rather than wrapping around", () => {
  const { host, designer } = build();

  pressOn(host, "Quarter", " ");
  const { prevented } = pressOn(host, "Quarter", "ArrowLeft");

  assert.equal(prevented, false);
  assert.equal(designer.grab.area, "available");
});

test("carrying a placed field to the available list removes it", async () => {
  const { host, state, updates } = build();
  assert.equal(state.areaOf("Region"), "row");

  // row -> column -> filter -> available
  pressOn(host, "Region", " ");
  pressOn(host, "Region", "ArrowLeft");
  pressOn(host, "Region", "ArrowLeft");
  pressOn(host, "Region", "ArrowLeft");
  pressOn(host, "Region", " ");
  await Promise.resolve();

  assert.equal(state.areaOf("Region"), "available");
  assert.equal(updates.length, 1);
});

test("the last value field cannot be carried out with the keyboard either", async () => {
  const { host, state, updates } = build();

  pressOn(host, "Amount", " ");
  ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft"].forEach(
    key => pressOn(host, "Amount", key));
  assert.equal(zone(host, "available").classList.contains("is-drop-refused"), true);

  pressOn(host, "Amount", " ");
  await Promise.resolve();

  assert.equal(state.areaOf("Amount"), "data");
  assert.equal(updates.length, 0);
});

test("Delete removes a placed field, and refuses the last value field", async () => {
  const { host, state, updates } = build();

  pressOn(host, "Region", "Delete");
  await Promise.resolve();
  assert.equal(state.areaOf("Region"), "available");

  const taken = updates.length;
  pressOn(host, "Amount", "Delete");
  await Promise.resolve();
  assert.equal(state.areaOf("Amount"), "data");
  assert.equal(updates.length, taken);
});

test("Enter opens the settings modal for a placed field and does nothing for an available one", () => {
  const { host, designer } = build();

  pressOn(host, "Region", "Enter");
  assert.equal(designer.settingsFor, "Region");

  designer.closeSettings();
  const { prevented } = pressOn(host, "Quarter", "Enter");
  assert.equal(prevented, false);
  assert.equal(designer.settingsFor, null);
});

test("a field keeps focus across the re-render its own move triggers", async () => {
  const { host, designer } = build();
  chips(host).find(entry => entry.dataset.field === "Quarter").focus();

  pressOn(host, "Quarter", " ");
  pressOn(host, "Quarter", "ArrowRight");
  pressOn(host, "Quarter", " ");
  await Promise.resolve();

  assert.equal(designer.focusField, "Quarter");
  assert.equal(globalThis.document.activeElement.dataset.field, "Quarter");
  assert.equal(globalThis.document.activeElement.tabIndex, 0);
});

test("a render nobody in the panel asked for does not steal focus", async () => {
  const { host, designer } = build();
  const outside = createElement("input");
  documentBody.appendChild(outside);
  outside.focus();

  designer.focusField = "Region";
  designer.render();
  await Promise.resolve();

  assert.equal(globalThis.document.activeElement, outside);
  void host;
});

test("reaching for the mouse abandons a keyboard move in flight", () => {
  const { host, designer } = build();

  pressOn(host, "Quarter", " ");
  assert.notEqual(designer.grab, null);

  const source = chips(host).find(entry => entry.dataset.field === "Quarter");
  source.dispatch("pointerdown", {
    target: source, pointerId: 1, button: 0, pointerType: "mouse", clientX: 0, clientY: 0
  });

  assert.equal(designer.grab, null);
  assert.equal(source.classList.contains("is-keyboard-moving"), false);
});

test("disposing during a keyboard move clears it", () => {
  const { host, designer } = build();

  pressOn(host, "Region", " ");
  designer.dispose();

  assert.equal(designer.grab, null);
});

test("a filter field can reach its value picker without a pointer", () => {
  const { host, designer } = build();
  const opened = [];
  designer.filterPicker = { open: request => opened.push(request.field), dispose() {} };
  designer.widget.fieldValues = async () => ({ values: [] });

  designer.state.move("Quarter", "filter", 0);
  designer.render();
  pressOn(host, "Quarter", "Enter");
  findByAction(designer.settings.body, "filter-values").dispatch("click", {});

  assert.deepEqual(opened, ["Quarter"]);
});

// Which chip currently carries the insertion marker, and on which edge.
function dropMark(host, area) {
  const marked = chips(zone(host, area)).find(chip =>
    chip.classList.contains("is-drop-before") || chip.classList.contains("is-drop-after"));

  return marked
    ? {
      field: marked.dataset.field,
      edge: marked.classList.contains("is-drop-before") ? "before" : "after"
    }
    : null;
}

// Puts two fields in the row zone, which a reorder needs and the catalog's
// declared layout does not have.
function buildWithTwoRows() {
  const panel = build();
  panel.state.move("Quarter", "row", 1);
  panel.designer.render();
  assert.deepEqual(panel.state.getState().rows, ["Region", "Quarter"]);
  return panel;
}

test("the drop marker tracks where a keyboard move would land in its own zone", () => {
  const { host } = buildWithTwoRows();

  pressOn(host, "Region", " ");
  // Not moved yet: it would land back exactly where it already is.
  assert.deepEqual(dropMark(host, "row"), { field: "Region", edge: "before" });

  pressOn(host, "Region", "ArrowDown");
  // Past Quarter now — which on screen is the far edge of the last chip, not
  // the near edge of it.
  assert.deepEqual(dropMark(host, "row"), { field: "Quarter", edge: "after" });
});

test("a pick-up cannot be pushed past the last slot of its own zone", async () => {
  const { host, state, updates } = buildWithTwoRows();

  pressOn(host, "Region", " ");
  ["ArrowDown", "ArrowDown", "ArrowDown"].forEach(key => pressOn(host, "Region", key));
  pressOn(host, "Region", " ");
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Quarter", "Region"]);
  assert.equal(updates.length, 1);
});

test("leaving a zone and coming back lands on its last slot, not past it", async () => {
  const { host, state, updates } = buildWithTwoRows();

  pressOn(host, "Region", " ");
  pressOn(host, "Region", "ArrowRight");
  pressOn(host, "Region", "ArrowLeft");
  pressOn(host, "Region", " ");
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Quarter", "Region"]);
  assert.equal(updates.length, 1);
});

test("a key pressed on a chip control belongs to that control, not to the chip", () => {
  const { host, designer } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Region");
  const remove = findByAction(chip, "remove");

  chip.dispatch("keydown", { key: " ", target: remove, preventDefault() {} });

  assert.equal(designer.grab, null);
});

test("two designers on one page do not claim the same heading ids", () => {
  const first = build();
  const second = build();

  const ids = area => [first.designer.zoneHeadingId(area), second.designer.zoneHeadingId(area)];

  ["available", "row", "column", "data", "filter"].forEach(area => {
    const [left, right] = ids(area);
    assert.notEqual(left, right, area);
  });

  // Stable across calls, or aria-labelledby would point at a heading that has
  // since been renamed out from under it.
  assert.equal(first.designer.zoneHeadingId("row"), ids("row")[0]);
});

test("an excluding filter chip counts what it drops, not what it accepts", async () => {
  const { designer, host, state } = buildWithFilter();

  state.setFilterValues("Quarter", ["Q1", "Q3"]);
  state.setFilterMode("Quarter", "Exclude");
  designer.render();

  // "(2)" under an excluding filter would read as two values accepted, which is
  // the opposite of what it does.
  const count = findByClassName(filterChip(host), "pivot-chip__filter-count");
  assert.equal(count.textContent, "(2 hariç)");
  assert.equal(count.classList.contains("is-excluding"), true);
});

test("a chip reads its own filter entry, not the first one in the zone", async () => {
  const { designer, host, state } = buildWithFilter();
  // Year lands ahead of Quarter, so a chip that read the zone's first entry
  // would show Year's filter on Quarter's chip.
  state.move("Year", "filter", 0);
  state.setFilterValues("Year", ["Q2"]);
  state.setFilterValues("Quarter", ["Q1", "Q3"]);
  state.setFilterMode("Quarter", "Exclude");
  designer.render();

  const count = findByClassName(filterChip(host), "pivot-chip__filter-count");
  assert.equal(count.textContent, "(2 hariç)");

  await designer.openFilterPicker("Quarter");
  assert.deepEqual(pickerByAction("filter-value").map(box => box.checked), [false, true, false]);
});

test("the picker opens on the mode the filter already carries", async () => {
  const { designer, state } = buildWithFilter();
  state.setFilterValues("Quarter", ["Q2"]);
  state.setFilterMode("Quarter", "Exclude");

  await designer.openFilterPicker("Quarter");

  const active = pickerByAction("filter-mode")
    .find(button => button.classList.contains("is-active"));
  assert.equal(active.dataset.mode, "Exclude");
  // Excluded values arrive unchecked; everything else is shown.
  assert.deepEqual(pickerByAction("filter-value").map(box => box.checked), [true, false, true]);
});

test("applying writes the mode and the values in one widget update", async () => {
  const { designer, state, updates } = buildWithFilter();

  await designer.openFilterPicker("Quarter");
  pickerByAction("filter-mode").find(button => button.dataset.mode === "Exclude")
    .dispatch("click", {});
  const boxes = pickerByAction("filter-value");
  boxes[1].checked = false;
  boxes[1].dispatch("change", {});
  const before = updates.length;
  pickerByAction("filter-apply")[0].dispatch("click", {});

  assert.deepEqual(
    state.getState().filters, [{ field: "Quarter", values: ["Q2"], mode: "Exclude" }]);
  // Two state mutations, one refresh: a picker that changed both must not cost
  // the page two requests.
  assert.equal(updates.length, before + 1);
});

test("a row field filtered from its header gets no second chip in the Filters zone", async () => {
  const { designer, state, host } = buildWithFilter();

  // What a row header's funnel does, seen from the designer's side.
  state.setFilterValues("Region", ["Ege"]);
  designer.render();

  assert.deepEqual(
    chips(zone(host, "filter")).map(chip => chip.dataset.field), ["Quarter"]);
  assert.deepEqual(
    chips(zone(host, "row")).map(chip => chip.dataset.field), ["Region"]);
});

test("the picker opens for a field that has no filter entry yet", async () => {
  const { designer, state } = buildWithFilter();

  // Region sits in the rows zone and has never been filtered, which is exactly
  // the state a row header's funnel is first clicked in.
  await designer.openFilterPicker("Region");

  assert.deepEqual(pickerByAction("filter-value").map(box => box.checked), [true, true, true]);

  const boxes = pickerByAction("filter-value");
  boxes[0].checked = false;
  boxes[0].dispatch("change", {});
  pickerByAction("filter-apply")[0].dispatch("click", {});

  assert.deepEqual(
    state.getState().filters.find(filter => filter.field === "Region"),
    { field: "Region", values: ["Q2", "Q3"], mode: "Include" });
  assert.equal(state.areaOf("Region"), "row");
});
