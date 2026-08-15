const assert = require("node:assert/strict");
const test = require("node:test");

// A DOM stub sufficient for the designer: element creation, class lists,
// children, and event listeners. The designer must not need more than this.
function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    listeners: new Map(),
    dataset: {},
    attributes: {},
    textContent: "",
    className: "",
    draggable: false,
    disabled: false,
    title: "",
    value: "",
    classList: {
      names: new Set(),
      add(...names) { names.forEach(name => this.names.add(name)); },
      remove(...names) { names.forEach(name => this.names.delete(name)); },
      contains(name) { return this.names.has(name); }
    },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
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

globalThis.document = { createElement };

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
  node.children.forEach(child => chips(child, found));
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

  assert.equal(chip.textContent.includes("Bölge"), true);
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
  const remove = chip.children.find(child => child.dataset?.action === "remove");

  assert.equal(remove.disabled, true);
  assert.equal(remove.title.length > 0, true);
});

test("changing an aggregation updates the state and the widget once", async () => {
  const { host, state, updates } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Amount");
  const select = chip.children.find(child => child.dataset?.action === "aggregation");

  select.value = "average";
  select.dispatch("change", { target: select });
  await Promise.resolve();

  assert.equal(state.getState().values[0].aggregation, "average");
  assert.equal(updates.length, 1);
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
