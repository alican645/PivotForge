const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-locale-tr.js");

const PivotForge = globalThis.PivotForge;

const fields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

// Just enough DOM for the toolbar: elements with attributes, children and click
// listeners, and a container that can put a sibling before itself.
function element(tagName) {
  const listeners = {};
  return {
    tagName,
    dataset: {},
    attributes: {},
    children: [],
    textContent: "",
    disabled: false,
    removed: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, handler) { listeners[type] = handler; },
    click() { return listeners.click?.(); },
    remove() { this.removed = true; }
  };
}

globalThis.document = { createElement: element };

// The renderer the widget builds, recorded rather than drawn.
const rendererCalls = [];
PivotForge.PivotTableRenderer = class {
  constructor() { this.options = {}; }
  render() {}
  expandAll() { rendererCalls.push("expandAll"); }
  collapseAll() { rendererCalls.push("collapseAll"); }
  getExcelExportModel(options) { return { rows: [], ...options }; }
  closeContextMenu() {}
};

function createContainer() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() {},
    appendChild(node) { return node; },
    removeAttribute() {},
    setAttribute() {},
    // The real Element.before inserts a sibling; here it is remembered.
    before(node) { this.inserted = node; }
  };
}

function createWidget(options = {}) {
  const container = createContainer();
  const widget = PivotForge.create(container, { fields, autoLoad: false, loadPanel: false, ...options });
  const toolbar = container.inserted ?? null;
  const buttons = toolbar ? Object.fromEntries(toolbar.children.map(button => [button.dataset.toolbarItem, button])) : {};
  return { widget, container, toolbar, buttons };
}

test("no toolbar unless one is asked for", () => {
  const { widget, toolbar } = createWidget();
  assert.equal(toolbar, null);
  widget.dispose();
});

test("toolbar: true offers every button the grid can honour, Excel only when export is allowed", () => {
  const without = createWidget({ toolbar: true });
  assert.deepEqual(Object.keys(without.buttons), ["csv", "print", "expandAll", "collapseAll"]);
  assert.equal(without.toolbar.attributes.role, "toolbar");
  without.widget.dispose();

  const withExcel = createWidget({ toolbar: true, allowExcelExport: true });
  assert.deepEqual(Object.keys(withExcel.buttons), ["excel", "csv", "print", "expandAll", "collapseAll"]);
  withExcel.widget.dispose();
});

test("a list picks the buttons and their order, and an unknown name is an error", () => {
  const { widget, buttons } = createWidget({ toolbar: ["print", "csv", "print"] });
  assert.deepEqual(Object.keys(buttons), ["print", "csv"]);
  widget.dispose();

  assert.throws(() => createWidget({ toolbar: ["pdf"] }), /Unknown toolbar item "pdf"/);
});

test("the buttons speak the locale, and a declared text wins over it", () => {
  const { widget, buttons, toolbar } = createWidget({
    toolbar: true,
    locale: "tr",
    rendererOptions: { texts: { toolbarCsv: "Metin dosyası" } }
  });

  assert.equal(buttons.print.textContent, "Yazdır");
  assert.equal(buttons.expandAll.textContent, "Tümünü aç");
  assert.equal(buttons.csv.textContent, "Metin dosyası");
  assert.equal(toolbar.attributes["aria-label"], "Pivot tablo araçları");
  widget.dispose();
});

test("expand and collapse go to the renderer", async () => {
  rendererCalls.length = 0;
  const { widget, buttons } = createWidget({ toolbar: ["expandAll", "collapseAll"] });

  await buttons.collapseAll.click();
  await buttons.expandAll.click();

  assert.deepEqual(rendererCalls, ["collapseAll", "expandAll"]);
  widget.dispose();
});

test("print is titled with the grid's name, and a failure becomes the error event", async () => {
  const original = PivotForge.print;
  const printed = [];
  PivotForge.print = (element, options) => printed.push(options);

  try {
    const { widget, buttons } = createWidget({ toolbar: ["print"], rendererOptions: { ariaLabel: "Satışlar" } });
    const errors = [];
    widget.on("error", error => errors.push(error.message));

    // Nothing rendered yet: print refuses, and the page hears about it.
    await buttons.print.click();
    assert.deepEqual(printed, []);
    assert.match(errors[0], /no pivot table has been rendered/);

    widget.result = { rowHeaders: [] };
    await buttons.print.click();
    assert.deepEqual(printed, [{ title: "Satışlar" }]);
    widget.dispose();
  } finally {
    PivotForge.print = original;
  }
});

test("dispose takes the toolbar away with the grid", () => {
  const { widget, toolbar } = createWidget({ toolbar: true });
  widget.dispose();
  assert.equal(toolbar.removed, true);
});
