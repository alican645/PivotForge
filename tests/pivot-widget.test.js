const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

// A DOM stub sufficient for the field designer's render() to run: element
// creation, class lists, children, and event listeners. Used only by the
// fieldDesigner integration tests below, which construct a real designer.
function createDesignerElement(tagName) {
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

const PivotForge = globalThis.PivotForge;

const fields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Yıl", dataField: "yil", area: "column" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

function createResult() {
  return {
    rowHeaders: [["Lokum"]],
    columnHeaders: [["2025"]],
    cells: [],
    grandTotals: { tutar_sum: 10000 }
  };
}

// Minimal container stand-in: the widget only needs classList, replaceChildren,
// and textContent from its host element.
function createContainer() {
  return {
    className: "",
    textContent: "",
    children: [],
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      remove(name) { this.names.delete(name); },
      toggle(name, on) { on ? this.names.add(name) : this.names.delete(name); },
      contains(name) { return this.names.has(name); }
    },
    replaceChildren(...nodes) { this.children = nodes; },
    appendChild(node) { this.children.push(node); return node; }
  };
}

function createWidget(overrides = {}) {
  const calls = [];
  const container = createContainer();
  const rendered = [];

  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    renderImpl: result => rendered.push(result),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
      return { ok: true, status: 200, json: async () => createResult() };
    },
    ...overrides
  });

  return { widget, calls, rendered, container };
}

test("create returns a widget without loading when autoLoad is false", () => {
  const { widget, calls } = createWidget();

  assert.equal(calls.length, 0);
  assert.equal(widget.getState().result, null);
  widget.dispose();
});

test("refresh posts the translated request to the pivot endpoint", async () => {
  const { widget, calls } = createWidget();

  await widget.refresh();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/pivotforge/pivot");
  assert.deepEqual(calls[0].body.rows, ["urun"]);
  assert.deepEqual(calls[0].body.columns, ["yil"]);
  assert.deepEqual(calls[0].body.values, [
    { field: "tutar", aggregation: "sum", showAs: "normal" }
  ]);
  widget.dispose();
});

test("refresh renders the returned result and records it in state", async () => {
  const { widget, rendered } = createWidget();

  await widget.refresh();

  assert.equal(rendered.length, 1);
  assert.deepEqual(rendered[0].grandTotals, { tutar_sum: 10000 });
  assert.equal(widget.getState().loading, false);
  assert.notEqual(widget.getState().result, null);
  widget.dispose();
});

test("a custom endpoint prefix is honored", async () => {
  const { widget, calls } = createWidget({ endpointPrefix: "/raporlar/pivot-api" });

  await widget.refresh();

  assert.equal(calls[0].url, "/raporlar/pivot-api/pivot");
  widget.dispose();
});

test("emits dataLoading before dataLoaded", async () => {
  const { widget } = createWidget();
  const events = [];
  widget.on("dataLoading", () => events.push("loading"));
  widget.on("dataLoaded", () => events.push("loaded"));

  await widget.refresh();

  assert.deepEqual(events, ["loading", "loaded"]);
  widget.dispose();
});

test("on returns an unsubscribe function", async () => {
  const { widget } = createWidget();
  const events = [];
  const off = widget.on("dataLoaded", () => events.push("loaded"));

  off();
  await widget.refresh();

  assert.deepEqual(events, []);
  widget.dispose();
});

test("updateFields rebuilds the request", async () => {
  const { widget, calls } = createWidget();

  await widget.updateFields([
    { dataField: "bolge", area: "row" },
    { dataField: "tutar", area: "data", aggregation: "average" }
  ]);

  assert.deepEqual(calls[0].body.rows, ["bolge"]);
  assert.deepEqual(calls[0].body.values, [
    { field: "tutar", aggregation: "average", showAs: "normal" }
  ]);
  widget.dispose();
});

test("an invalid configuration throws from create, at the call site", () => {
  assert.throws(
    () => PivotForge.create(createContainer(), {
      fields: [{ dataField: "urun", area: "row" }],
      autoLoad: false
    }),
    /at least one field with area "data"/
  );
});

test("create rejects a missing target", () => {
  assert.throws(() => PivotForge.create(null, { fields }), /requires a target element/);
});

test("a server error is surfaced and does not blank existing data", async () => {
  let fail = false;
  const { widget, rendered } = createWidget({
    fetchImpl: async () => fail
      ? { ok: false, status: 400, json: async () => ({ message: "Alan bulunamadı: urun" }) }
      : { ok: true, status: 200, json: async () => createResult() }
  });

  await widget.refresh();
  fail = true;
  const errors = [];
  widget.on("error", event => errors.push(event));
  await widget.refresh();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Alan bulunamadı/);
  assert.equal(widget.getState().error.message, "Alan bulunamadı: urun");
  // The previous successful render is still the last one performed.
  assert.equal(rendered.length, 1);
  assert.notEqual(widget.getState().result, null);
  widget.dispose();
});

test("a superseded request is aborted and its late response ignored", async () => {
  const pending = [];
  let firstAborted = false;
  const { widget, rendered } = createWidget({
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      const index = pending.length;
      if (index === 0) {
        init.signal.addEventListener("abort", () => { firstAborted = true; });
      }
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      pending.push(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...createResult(), marker: pending.length })
      }));
    })
  });

  const first = widget.refresh();
  const second = widget.refresh();

  assert.equal(firstAborted, true);

  pending[1]();
  await second;
  pending[0]();
  await first;

  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].marker, 2);
  widget.dispose();
});

test("dispose aborts in-flight requests and clears the container", async () => {
  let aborted = false;
  const { widget, container } = createWidget({
    fetchImpl: (url, init) => new Promise(() => {
      init.signal.addEventListener("abort", () => { aborted = true; });
    })
  });

  widget.refresh();
  widget.dispose();

  assert.equal(aborted, true);
  assert.equal(container.children.length, 0);
});

test("refresh after dispose throws", async () => {
  const { widget } = createWidget();
  widget.dispose();

  await assert.rejects(() => widget.refresh(), /disposed/);
});

test("create dispatches a ready event carrying the widget", () => {
  const container = createContainer();
  const received = [];
  container.dispatchEvent = event => received.push(event);
  globalThis.CustomEvent ??= class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };

  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].type, "pivotforge:ready");
  assert.equal(received[0].detail.widget, widget);
  widget.dispose();
});

test("cancel aborts the in-flight request and clears the loading flag", async () => {
  let aborted = false;
  const { widget } = createWidget({
    fetchImpl: (url, init) => new Promise(() => {
      init.signal.addEventListener("abort", () => { aborted = true; });
    })
  });

  widget.refresh();
  assert.equal(widget.getState().loading, true);

  widget.cancel();

  assert.equal(aborted, true);
  assert.equal(widget.getState().loading, false);
  assert.equal(widget.controller, null);
  widget.dispose();
});

test("exportToExcel reads the file name from the Content-Disposition header", async () => {
  const exportModel = { title: "Pivot Tablo", rows: [] };
  const { widget } = createWidget({
    allowExcelExport: true,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      blob: async () => "xlsx-bytes",
      headers: {
        get: name => name === "Content-Disposition"
          ? "attachment; filename=pivot.xlsx; filename*=UTF-8''pivot%20tablo.xlsx"
          : null
      }
    })
  });
  widget.renderer = { getExcelExportModel: () => exportModel };

  const { fileName } = await widget.exportToExcel();

  assert.equal(fileName, "pivot tablo.xlsx");
  widget.dispose();
});

test("exportToExcel explains itself when nothing has been rendered", async () => {
  const { widget } = createWidget({ allowExcelExport: true });
  widget.renderer = { getExcelExportModel: () => null };

  await assert.rejects(() => widget.exportToExcel(), /no pivot table has been rendered/);
  widget.dispose();
});

test("exportToExcel explains itself when the widget renders through renderImpl", async () => {
  const { widget } = createWidget({ allowExcelExport: true });

  await assert.rejects(() => widget.exportToExcel(), /renderImpl/);
  widget.dispose();
});

test("update applies fields, filters, and sort in a single refresh", async () => {
  const { widget, calls } = createWidget();

  await widget.update({
    fields: [
      { dataField: "bolge", area: "row" },
      { dataField: "tutar", area: "data", aggregation: "average" }
    ],
    filters: [{ field: "bolge", values: ["Kuzey"] }],
    rowSort: { mode: "rowLabel", direction: "descending", field: "bolge" }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.rows, ["bolge"]);
  assert.deepEqual(calls[0].body.values, [
    { field: "tutar", aggregation: "average", showAs: "normal" }
  ]);
  assert.deepEqual(calls[0].body.filters, [{ field: "bolge", values: ["Kuzey"] }]);
  assert.equal(calls[0].body.rowSort.direction, "descending");
  widget.dispose();
});

test("update leaves omitted members untouched", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.update({ rowSort: { mode: "rowLabel", direction: "ascending", field: "urun" } });

  assert.deepEqual(calls[1].body.filters, [{ field: "urun", values: ["Lokum"] }]);
  assert.deepEqual(calls[1].body.rows, ["urun"]);
  widget.dispose();
});

test("update with no arguments still refreshes once", async () => {
  const { widget, calls } = createWidget();

  await widget.update();

  assert.equal(calls.length, 1);
  widget.dispose();
});

test("update reflects new fields in getState", async () => {
  const { widget } = createWidget();

  await widget.update({ fields: [{ dataField: "tutar", area: "data" }] });

  assert.deepEqual(widget.getState().fields.map(field => field.dataField), ["tutar"]);
  widget.dispose();
});

test("create builds a designer when fieldDesigner is supplied", () => {
  const designerHost = createContainer();
  const previousDocument = globalThis.document;
  // The designer's render() needs createElement in addition to the selector
  // lookup, since it builds real chip/zone elements during construction.
  globalThis.document = { querySelector: () => designerHost, createElement: createDesignerElement };

  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    fieldDesigner: "#designerHost",
    renderImpl: () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
  });

  assert.notEqual(widget.designer, null);
  assert.notEqual(widget.layoutState, null);

  widget.dispose();
  globalThis.document = previousDocument;
});

test("no designer is built when fieldDesigner is absent", () => {
  const { widget } = createWidget();

  assert.equal(widget.designer, null);
  widget.dispose();
});
