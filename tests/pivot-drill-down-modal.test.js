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

// A DOM stub sufficient for the modal: element creation, class lists, children,
// attributes and event listeners. The modal must not need more than this.
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
    disabled: false,
    hidden: false,
    href: "",
    download: "",
    value: "",
    clicked: 0,
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
    click() { this.clicked++; },
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

const documentListeners = new Map();
globalThis.document = {
  createElement,
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

const downloads = [];
globalThis.Blob = class Blob {
  constructor(parts) { this.parts = parts; }
};
globalThis.URL = {
  createObjectURL(blob) { downloads.push(blob.parts.join("")); return "blob:test"; },
  revokeObjectURL() {}
};

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-drill-down.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-drill-down-modal.js");

const PivotForge = globalThis.PivotForge;

const records = [
  { region: "Marmara", category: "Beton", amount: 1500, quantity: 3 },
  { region: "Marmara", category: "Çimento", amount: 2500, quantity: 5 },
  { region: "Ege", category: "Beton", amount: 3500, quantity: 7 }
];

const fields = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data", format: { type: "currency", decimals: 0, currency: "TRY" } },
  { dataField: "Quantity", caption: "Miktar", area: "data", format: { type: "number", decimals: 0 } }
];

const selection = {
  type: "cell",
  rowHeader: ["Marmara"],
  columnHeader: ["2024"],
  valueKey: "Amount_sum",
  drillDownEnabled: true
};

// A widget stub whose drillDown() resolution the test controls.
function createWidget(options = {}) {
  const calls = [];
  return {
    calls,
    fields: options.fields ?? fields,
    valueDefinitions: () => [{ key: "Amount_sum", label: "Tutar" }],
    drillDown(request) {
      calls.push(request);
      return options.respond
        ? options.respond(request, calls.length)
        : Promise.resolve({ records, totalCount: records.length, truncated: false, limit: 100 });
    }
  };
}

function build(options = {}) {
  const host = createElement("div");
  const widget = options.widget ?? createWidget(options);
  const modal = new PivotForge.PivotDrillDownModal({ widget, host, ...options.modal });
  return { modal, widget, host };
}

function find(node, predicate, found = []) {
  if (predicate(node)) {
    found.push(node);
  }
  Array.from(node.children).forEach(child => find(child, predicate, found));
  return found;
}

const byClass = (node, name) => find(node, entry => entry.className?.split(" ").includes(name));
const byTag = (node, name) => find(node, entry => entry.tagName === name.toUpperCase());

function rowsOf(host) {
  const tbody = byTag(host, "tbody")[0];
  return Array.from(tbody.children).map(row => Array.from(row.children).map(cell => cell.textContent));
}

test("the modal builds nothing until it is first opened", () => {
  const { host } = build();

  assert.equal(host.children.length, 0);
});

test("opening renders one row per record, with declared captions as headers", async () => {
  const { modal, host } = build();

  await modal.open(selection);

  const headerRow = byTag(host, "thead")[0].children[0];
  assert.deepEqual(Array.from(headerRow.children).map(cell => cell.textContent),
    ["Bölge", "Kategori", "Tutar", "Miktar"]);
  assert.equal(rowsOf(host).length, 3);
});

test("declared formats are applied to the detail cells", async () => {
  const { modal, host } = build();

  await modal.open(selection);

  const firstRow = rowsOf(host)[0];
  assert.equal(firstRow[0], "Marmara");
  assert.match(firstRow[2], /₺/);
  assert.match(firstRow[2], /1\.500/);
});

test("columns match record keys case-insensitively", async () => {
  // The field is declared PascalCase; the serializer emitted camelCase.
  const widget = createWidget({
    fields: [{ dataField: "Region", caption: "Bölge" }]
  });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  assert.deepEqual(rowsOf(host), [["Marmara"], ["Marmara"], ["Ege"]]);
});

test("a record shape sharing no key with the catalog falls back to raw keys", async () => {
  const widget = createWidget({ fields: [{ dataField: "Unrelated", caption: "Yok" }] });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  const headerRow = byTag(host, "thead")[0].children[0];
  assert.deepEqual(Array.from(headerRow.children).map(cell => cell.textContent),
    ["region", "category", "amount", "quantity"]);
});

test("an explicit column list overrides the catalog", async () => {
  const { modal, host } = build({
    modal: { columns: [{ key: "category", label: "Yalnızca kategori" }] }
  });

  await modal.open(selection);

  const headerRow = byTag(host, "thead")[0].children[0];
  assert.deepEqual(Array.from(headerRow.children).map(cell => cell.textContent), ["Yalnızca kategori"]);
});

test("numeric columns are marked so they can be right-aligned", async () => {
  const { modal, host } = build();

  await modal.open(selection);

  const firstRow = byTag(host, "tbody")[0].children[0];
  assert.equal(firstRow.children[0].className, "");
  assert.equal(firstRow.children[2].className, "is-numeric");
});

test("the request carries the selection's paths and value key", async () => {
  const { modal, widget } = build();

  await modal.open(selection);

  assert.deepEqual(widget.calls[0],
    { rowPath: ["Marmara"], columnPath: ["2024"], valueKey: "Amount_sum" });
});

test("the title names the row path, column path and value label", async () => {
  const { modal, host } = build();

  await modal.open(selection);

  assert.equal(byTag(host, "h2")[0].textContent, "Marmara · 2024 · Tutar");
});

test("an empty path is titled as covering everything", async () => {
  const { modal, host } = build();

  await modal.open({ ...selection, rowHeader: [], columnHeader: [] });

  assert.equal(byTag(host, "h2")[0].textContent, "Tüm satırlar · Tüm sütunlar · Tutar");
});

test("the search box filters the rendered rows", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const search = byTag(host, "input")[0];
  search.value = "çimento";
  search.dispatch("input");

  assert.equal(rowsOf(host).length, 1);
  assert.equal(rowsOf(host)[0][1], "Çimento");
});

test("a column filter narrows the rows and combines with the search", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const regionFilter = byTag(host, "select")[0];
  regionFilter.value = "Marmara";
  regionFilter.dispatch("change", { target: regionFilter });
  assert.equal(rowsOf(host).length, 2);

  const search = byTag(host, "input")[0];
  search.value = "beton";
  search.dispatch("input");
  assert.equal(rowsOf(host).length, 1);
});

test("the summary counts visible records against the server's total", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const summary = byClass(host, "pivot-drill-down-heading")[0].children[1];
  assert.equal(summary.textContent, "3 / 3 kayıt");

  const search = byTag(host, "input")[0];
  search.value = "ege";
  search.dispatch("input");
  assert.equal(summary.textContent, "1 / 3 kayıt");
});

test("a truncated response shows the server's limit", async () => {
  const widget = createWidget({
    respond: () => Promise.resolve({ records, totalCount: 900, truncated: true, limit: 100 })
  });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  const notice = byClass(host, "pivot-drill-down-notice")[0];
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, "İlk 100 kayıt gösteriliyor.");
});

test("an untruncated response hides the notice", async () => {
  const { modal, host } = build();

  await modal.open(selection);

  assert.equal(byClass(host, "pivot-drill-down-notice")[0].hidden, true);
});

test("a cell with no source records says so instead of showing an empty table", async () => {
  const widget = createWidget({
    respond: () => Promise.resolve({ records: [], totalCount: 0, truncated: false, limit: 100 })
  });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  const state = byClass(host, "pivot-drill-down-state")[0];
  assert.equal(state.textContent, "Bu hücre için kaynak kayıt bulunamadı");
  assert.equal(state.hidden, false);
});

test("filters that match nothing are reported differently from an empty cell", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const search = byTag(host, "input")[0];
  search.value = "yokböylebirşey";
  search.dispatch("input");

  assert.equal(byClass(host, "pivot-drill-down-state")[0].textContent, "Filtrelerle eşleşen kayıt yok");
});

test("a failed drill-down surfaces the error", async () => {
  const widget = createWidget({ respond: () => Promise.reject(new Error("Sunucu hatası")) });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  const state = byClass(host, "pivot-drill-down-state")[0];
  assert.equal(state.textContent, "Sunucu hatası");
  assert.equal(state.classList.contains("error"), true);
});

test("an aborted drill-down is not reported as a failure", async () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  const widget = createWidget({ respond: () => Promise.reject(abort) });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  assert.equal(byClass(host, "pivot-drill-down-state")[0].textContent, "Kayıtlar yükleniyor...");
});

test("a stale response never overwrites the records of a newer open", async () => {
  const resolvers = [];
  const widget = createWidget({
    respond: () => new Promise(resolve => resolvers.push(resolve))
  });
  const { modal, host } = build({ widget });

  const first = modal.open(selection);
  const second = modal.open({ ...selection, rowHeader: ["Ege"] });

  // The first cell's response arrives last, after the user moved on.
  resolvers[1]({ records: [records[2]], totalCount: 1, truncated: false, limit: 100 });
  resolvers[0]({ records, totalCount: 3, truncated: false, limit: 100 });
  await Promise.all([first, second]);

  assert.equal(rowsOf(host).length, 1);
  assert.equal(rowsOf(host)[0][0], "Ege");
});

test("a response arriving after close does not repopulate the modal", async () => {
  const resolvers = [];
  const widget = createWidget({
    respond: () => new Promise(resolve => resolvers.push(resolve))
  });
  const { modal, host } = build({ widget });

  const opening = modal.open(selection);
  modal.close();
  resolvers[0]({ records, totalCount: 3, truncated: false, limit: 100 });
  await opening;

  assert.equal(rowsOf(host).length, 0);
  assert.equal(modal.isOpen, false);
});

test("opening marks the overlay open and closing marks it closed", async () => {
  const { modal, host } = build();

  await modal.open(selection);
  const overlay = host.children[0];
  assert.equal(overlay.classList.contains("is-open"), true);
  assert.equal(overlay.attributes["aria-hidden"], "false");

  modal.close();
  assert.equal(overlay.classList.contains("is-open"), false);
  assert.equal(overlay.attributes["aria-hidden"], "true");
});

test("Escape closes an open modal", async () => {
  const { modal } = build();
  await modal.open(selection);

  globalThis.document.dispatch("keydown", { key: "Escape" });

  assert.equal(modal.isOpen, false);
});

test("a key other than Escape leaves the modal open", async () => {
  const { modal } = build();
  await modal.open(selection);

  globalThis.document.dispatch("keydown", { key: "Enter" });

  assert.equal(modal.isOpen, true);
});

test("clicking the backdrop closes, clicking inside the dialog does not", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const overlay = host.children[0];
  overlay.dispatch("click", { target: overlay.children[0] });
  assert.equal(modal.isOpen, true);

  overlay.dispatch("click", { target: overlay });
  assert.equal(modal.isOpen, false);
});

test("a non-cell selection is ignored", async () => {
  const { modal, widget, host } = build();

  await modal.open({ type: "row", rowHeader: ["Marmara"] });

  assert.equal(widget.calls.length, 0);
  assert.equal(host.children.length, 0);
});

test("a cell with drill-down disabled is ignored", async () => {
  const { modal, widget } = build();

  await modal.open({ ...selection, drillDownEnabled: false });

  assert.equal(widget.calls.length, 0);
});

test("CSV export writes the visible records with formatted values", async () => {
  downloads.length = 0;
  const { modal, host } = build();
  await modal.open(selection);

  const search = byTag(host, "input")[0];
  search.value = "ege";
  search.dispatch("input");

  const csvButton = byClass(host, "pivot-button")
    .find(button => button.textContent === "CSV");
  csvButton.dispatch("click");

  assert.equal(downloads.length, 1);
  const lines = downloads[0].replace("﻿", "").split("\n");
  assert.equal(lines[0], "Bölge,Kategori,Tutar,Miktar");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^Ege,Beton,/);
});

test("the CSV button is disabled while nothing is visible", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const csvButton = byClass(host, "pivot-button").find(b => b.textContent === "CSV");
  assert.equal(csvButton.disabled, false);

  const search = byTag(host, "input")[0];
  search.value = "yokböylebirşey";
  search.dispatch("input");
  assert.equal(csvButton.disabled, true);
});

test("reopening clears the previous search and filters", async () => {
  const { modal, host } = build();
  await modal.open(selection);

  const search = byTag(host, "input")[0];
  search.value = "ege";
  search.dispatch("input");
  assert.equal(rowsOf(host).length, 1);

  await modal.open(selection);

  assert.equal(search.value, "");
  assert.equal(rowsOf(host).length, 3);
});

test("the modal reuses its DOM instead of stacking overlays", async () => {
  const { modal, host } = build();

  await modal.open(selection);
  modal.close();
  await modal.open(selection);

  assert.equal(host.children.length, 1);
});

test("dispose removes the overlay and unhooks the key listener", async () => {
  const { modal, host } = build();
  await modal.open(selection);
  const overlay = host.children[0];

  modal.dispose();

  assert.equal(overlay.removed, true);
  assert.equal(modal.isOpen, false);
  globalThis.document.dispatch("keydown", { key: "Escape" });
});

test("a disposed modal refuses to open", async () => {
  const { modal, widget } = build();
  modal.dispose();

  await modal.open(selection);

  assert.equal(widget.calls.length, 0);
});

test("a widget without drillDown is rejected at construction", () => {
  assert.throws(
    () => new PivotForge.PivotDrillDownModal({ widget: {}, host: createElement("div") }),
    /drillDown/);
});

test("a numeric column with no declared format is still right-aligned", async () => {
  // Quantity carries no format, but its values are numbers; left-aligning them
  // beside the formatted currency column reads as a mistake.
  const widget = createWidget({
    fields: [
      { dataField: "Region", caption: "Bölge" },
      { dataField: "Quantity", caption: "Miktar" }
    ]
  });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  const firstRow = byTag(host, "tbody")[0].children[0];
  assert.equal(firstRow.children[0].className, "");
  assert.equal(firstRow.children[1].className, "is-numeric");
});

test("a declared numeric format aligns the column even when the first value is null", async () => {
  // Alignment is a property of the column, not of whichever record happens to
  // be first, so a leading null must not turn a currency column into text.
  const widget = createWidget({
    fields: [{ dataField: "Amount", caption: "Tutar", format: { type: "currency", decimals: 0 } }],
    respond: () => Promise.resolve({
      records: [{ amount: null }, { amount: 1500 }],
      totalCount: 2,
      truncated: false,
      limit: 100
    })
  });
  const { modal, host } = build({ widget });

  await modal.open(selection);

  const firstRow = byTag(host, "tbody")[0].children[0];
  assert.equal(firstRow.children[0].className, "is-numeric");
  assert.equal(firstRow.children[0].textContent, "");
});
