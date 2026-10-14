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
  assert.deepEqual(Object.keys(without.buttons),
    ["csv", "print", "expandAll", "collapseAll", "saveReport", "openReport", "fullscreen"]);
  assert.equal(without.toolbar.attributes.role, "toolbar");
  without.widget.dispose();

  const withExcel = createWidget({ toolbar: true, allowExcelExport: true });
  assert.deepEqual(Object.keys(withExcel.buttons),
    ["excel", "csv", "print", "expandAll", "collapseAll", "saveReport", "openReport", "fullscreen"]);
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

test("save report downloads the view as a JSON file", async () => {
  const original = PivotForge.download;
  const downloads = [];
  PivotForge.download = file => downloads.push(file);

  try {
    const { widget, buttons } = createWidget({ toolbar: ["saveReport"], locale: "tr" });
    assert.equal(buttons.saveReport.textContent, "Raporu kaydet");

    await buttons.saveReport.click();
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].fileName, /\.json$/);
    const report = JSON.parse(await downloads[0].blob.text());
    assert.equal(report.format, "pivotforge-report");
    widget.dispose();
  } finally {
    PivotForge.download = original;
  }
});

test("full screen switches on and off, from the button or with Escape", async () => {
  const keyHandlers = [];
  const classes = new Set();
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: element,
    documentElement: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
    addEventListener: (type, handler) => keyHandlers.push(handler),
    removeEventListener: (type, handler) => keyHandlers.splice(keyHandlers.indexOf(handler), 1)
  };

  try {
    const container = createContainer();
    const toggled = [];
    container.classList.toggle = (name, on) => toggled.push([name, on]);
    const widget = PivotForge.create(container, { fields, autoLoad: false, loadPanel: false, toolbar: ["fullscreen"], locale: "tr" });
    const button = container.inserted.children[0];
    assert.equal(button.textContent, "Tam ekran");

    await button.click();
    assert.deepEqual(toggled.at(-1), ["pivot-is-fullscreen", true]);
    assert.equal(classes.has("pivot-has-fullscreen"), true);
    assert.equal(button.textContent, "Tam ekrandan çık");
    assert.equal(button.attributes["aria-pressed"], "true");

    keyHandlers[0]({ key: "Escape" });
    assert.deepEqual(toggled.at(-1), ["pivot-is-fullscreen", false]);
    assert.equal(classes.has("pivot-has-fullscreen"), false);
    assert.equal(button.textContent, "Tam ekran");
    assert.equal(keyHandlers.length, 0);

    // Disposing in full screen gives the page its scrolling back.
    await button.click();
    widget.dispose();
    assert.equal(classes.has("pivot-has-fullscreen"), false);
  } finally {
    globalThis.document = originalDocument;
  }
});
