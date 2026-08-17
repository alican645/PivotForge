const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

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

// A DOM stub sufficient for the field designer's render() to run: element
// creation, class lists, children, and event listeners. Used only by the
// fieldDesigner integration tests below, which construct a real designer.
function createDesignerElement(tagName) {
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
    title: "",
    value: "",
    classList: {
      names: new Set(),
      add(...names) { names.forEach(name => this.names.add(name)); },
      remove(...names) { names.forEach(name => this.names.delete(name)); },
      contains(name) { return this.names.has(name); }
    },
    appendChild(child) { this._children.push(child); return child; },
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
    _children: [],
    get children() { return asChildren(this._children); },
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      remove(name) { this.names.delete(name); },
      toggle(name, on) { on ? this.names.add(name) : this.names.delete(name); },
      contains(name) { return this.names.has(name); }
    },
    replaceChildren(...nodes) { this._children = nodes; },
    appendChild(node) { this._children.push(node); return node; }
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
  assert.deepEqual(
    calls[0].body.filters, [{ field: "bolge", values: ["Kuzey"], mode: "Include" }]);
  assert.equal(calls[0].body.rowSort.direction, "descending");
  widget.dispose();
});

test("update leaves omitted members untouched", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.update({ rowSort: { mode: "rowLabel", direction: "ascending", field: "urun" } });

  assert.deepEqual(
    calls[1].body.filters, [{ field: "urun", values: ["Lokum"], mode: "Include" }]);
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

test("update rebuilds the renderer when the widget owns one, instead of renderImpl", async () => {
  // Every other test in this file supplies renderImpl, so this.renderer is
  // always null there and the rebuild branch inside update() never runs.
  // Exercise it directly with a widget that builds its own renderer.
  let rendererBuildCount = 0;
  let lastRenderedResult = null;
  class FakeRenderer {
    constructor() {
      rendererBuildCount++;
    }
    render(result) {
      lastRenderedResult = result;
    }
  }
  const previousRenderer = PivotForge.PivotTableRenderer;
  PivotForge.PivotTableRenderer = FakeRenderer;

  try {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    assert.equal(rendererBuildCount, 1);

    await widget.update({ fields: [{ dataField: "tutar", area: "data" }] });

    assert.equal(rendererBuildCount, 2);
    assert.notEqual(lastRenderedResult, null);

    widget.dispose();
  } finally {
    PivotForge.PivotTableRenderer = previousRenderer;
  }
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

// The renderer re-sorts rows itself whenever settings.sortState is falsy
// (pivot-table.js createRowPlan), which silently undoes
// the server's ordering. So a widget that sorts must tell its renderer what the
// active sort is, or header-click sorting appears to do nothing.
function createSortSpyRenderer() {
  const constructed = [];
  const renders = [];

  class SpyRenderer {
    constructor(container, options) {
      this.options = options;
      constructed.push(options);
    }
    render(result, options = {}) {
      renders.push({ ...this.options, ...options });
    }
  }

  return { SpyRenderer, constructed, renders };
}

async function withSpyRenderer(run) {
  const spy = createSortSpyRenderer();
  const previous = PivotForge.PivotTableRenderer;
  PivotForge.PivotTableRenderer = spy.SpyRenderer;

  try {
    await run(spy);
  } finally {
    PivotForge.PivotTableRenderer = previous;
  }
}

test("the renderer is told the active sort, so it does not re-sort the server's rows", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      allowSorting: true,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    const sort = { mode: "RowTotalValue", valueKey: "tutar_sum", direction: "Descending" };
    await widget.sortBy(sort);

    assert.equal(renders.length, 1);
    assert.deepEqual(renders[0].sortState, sort);

    widget.dispose();
  });
});

test("clearing the sort tells the renderer to resume its own row ordering", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      allowSorting: true,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.sortBy({ mode: "RowLabel", field: "urun", direction: "Ascending" });
    await widget.update({ rowSort: null });

    assert.equal(renders.at(-1).sortState, null);

    widget.dispose();
  });
});

// The MVC demo drives sorting itself: it never calls widget.sortBy, and passes
// its own sortState through rendererOptions. The widget must not overwrite that
// with its own (permanently null) rowSort.
test("a consumer-supplied sortState survives, because the widget never sorted", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const consumerSort = { mode: "RowLabel", field: "urun", direction: "Descending" };
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      allowSorting: true,
      rendererOptions: { sortState: consumerSort },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.deepEqual(renders.at(-1).sortState, consumerSort);

    widget.dispose();
  });
});

test("an initial rowSort reaches the renderer on the very first render", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const sort = { mode: "RowLabel", field: "urun", direction: "Ascending" };
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      allowSorting: true,
      rowSort: sort,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.deepEqual(renders.at(-1).sortState, sort);

    widget.dispose();
  });
});

test("the active sort survives the renderer rebuild that update({ fields }) performs", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      allowSorting: true,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    const sort = { mode: "RowTotalValue", valueKey: "tutar_sum", direction: "Descending" };
    await widget.sortBy(sort);
    // Changing fields rebuilds the renderer; the rebuilt one must still know
    // the sort, or reordering the designer silently unsorts the table.
    await widget.update({ fields });

    assert.deepEqual(renders.at(-1).sortState, sort);

    widget.dispose();
  });
});

// --- Value definitions ---------------------------------------------------
//
// Without a `values` list the renderer falls back to auto-detecting a single
// key from the payload, labelling it with that raw key ("tutar_sum") and
// applying no format. The widget already knows the captions, aggregations and
// formats, so it must hand them over.

test("each data field reaches the renderer as a value definition", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.deepEqual(renders.at(-1).values, [
      { key: "tutar_sum", label: "Tutar", aggregation: "sum", showAs: "normal", format: null }
    ]);

    widget.dispose();
  });
});

test("a second data field is not dropped, as the renderer's own fallback would drop it", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields: [
        { caption: "Ürün", dataField: "urun", area: "row" },
        { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" },
        { caption: "Adet", dataField: "adet", area: "data", aggregation: "average" }
      ],
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.deepEqual(renders.at(-1).values.map(value => value.key), ["tutar_sum", "adet_average"]);
    assert.deepEqual(renders.at(-1).values.map(value => value.label), ["Tutar", "Adet"]);

    widget.dispose();
  });
});

test("a declared format travels to the renderer", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const format = { type: "currency", decimals: 0, useGrouping: true, currency: "TRY" };
    const widget = PivotForge.create(createContainer(), {
      fields: [
        { caption: "Ürün", dataField: "urun", area: "row" },
        { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum", format }
      ],
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.deepEqual(renders.at(-1).values[0].format, format);

    widget.dispose();
  });
});

test("only data fields become value definitions", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.equal(renders.at(-1).values.length, 1);

    widget.dispose();
  });
});

test("changing the fields rebuilds the value definitions", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.update({
      fields: [
        { caption: "Ürün", dataField: "urun", area: "row" },
        { caption: "Adet", dataField: "adet", area: "data", aggregation: "max" }
      ]
    });

    assert.deepEqual(renders.at(-1).values.map(value => value.key), ["adet_max"]);

    widget.dispose();
  });
});

// The MVC demo builds richer value definitions of its own (display labels,
// show-as suffixes, per-value formats) and passes them through rendererOptions.
test("a consumer-supplied values list survives", async () => {
  await withSpyRenderer(async ({ renders }) => {
    const consumerValues = [{ key: "tutar_sum", label: "Ciro (₺)", format: { type: "currency" } }];
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      rendererOptions: { values: consumerValues },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.deepEqual(renders.at(-1).values, consumerValues);

    widget.dispose();
  });
});

// The package ships a drill-down endpoint, a widget.drillDown() call and the
// detail-modal component, but nothing joins them: a declarative page that never
// writes JS got no detail modal at all. The widget supplies that wiring, while
// leaving a consumer that brought its own handler untouched.
function withStubModal(run) {
  const opened = [];
  const disposed = [];
  const previous = PivotForge.PivotDrillDownModal;

  PivotForge.PivotDrillDownModal = class StubModal {
    constructor(options) { this.options = options; }
    open(selection) { opened.push(selection); }
    dispose() { disposed.push(this); }
  };

  try {
    return run({ opened, disposed });
  } finally {
    PivotForge.PivotDrillDownModal = previous;
  }
}

test("double-clicking a cell opens the packaged detail modal", async () => {
  await withStubModal(async ({ opened }) => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), { fields, autoLoad: false });

      const selection = { type: "cell", rowHeader: ["Ege"], valueKey: "tutar_sum" };
      constructed[0].onCellDoubleClick(selection);

      assert.deepEqual(opened, [selection]);
      widget.dispose();
    });
  });
});

test("the detail modal formats in the same culture as the grid it came from", async () => {
  await withStubModal(async () => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), {
        fields, autoLoad: false, rendererOptions: { culture: "de-DE" }
      });

      constructed[0].onCellDoubleClick({ type: "cell" });

      // Otherwise the modal contradicts the cell that opened it.
      assert.equal(widget.drillDownModal.options.culture, "de-DE");
      widget.dispose();
    });
  });
});

test("a modal culture declared on purpose beats the renderer's", async () => {
  await withStubModal(async () => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), {
        fields,
        autoLoad: false,
        rendererOptions: { culture: "de-DE" },
        drillDownModalOptions: { culture: "en-US" }
      });

      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(widget.drillDownModal.options.culture, "en-US");
      widget.dispose();
    });
  });
});

test("the modal is built once and reused across cells", async () => {
  await withStubModal(async () => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), { fields, autoLoad: false });

      constructed[0].onCellDoubleClick({ type: "cell" });
      const first = widget.drillDownModal;
      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(widget.drillDownModal, first);
      widget.dispose();
    });
  });
});

test("a consumer's own onCellDoubleClick keeps ownership", async () => {
  await withStubModal(async ({ opened }) => {
    await withSpyRenderer(async ({ constructed }) => {
      const seen = [];
      const widget = PivotForge.create(createContainer(), {
        fields,
        autoLoad: false,
        rendererOptions: { onCellDoubleClick: selection => seen.push(selection) }
      });

      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(seen.length, 1);
      assert.equal(opened.length, 0);
      widget.dispose();
    });
  });
});

test("no detail handler is wired when drill-down is disabled", async () => {
  await withStubModal(async () => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), {
        fields,
        autoLoad: false,
        allowDrillDown: false
      });

      // The handler still exists, because cell activation always emits its
      // event; what drill-down being off removes is the modal.
      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(widget.drillDownModal, null);
      widget.dispose();
    });
  });
});

test("the packaged modal can be declined while drill-down stays available", async () => {
  await withStubModal(async () => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), {
        fields,
        autoLoad: false,
        drillDownModal: false
      });

      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(widget.drillDownModal, null);
      assert.equal(widget.options.allowDrillDown, true);
      widget.dispose();
    });
  });
});

test("a page that never loaded the modal script still builds a widget", async () => {
  const previous = PivotForge.PivotDrillDownModal;
  PivotForge.PivotDrillDownModal = undefined;

  try {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), { fields, autoLoad: false });

      // No modal script, so activation must degrade to emitting only.
      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(widget.drillDownModal, null);
      widget.dispose();
    });
  } finally {
    PivotForge.PivotDrillDownModal = previous;
  }
});

test("disposing the widget disposes the modal it built", async () => {
  await withStubModal(async ({ disposed }) => {
    await withSpyRenderer(async ({ constructed }) => {
      const widget = PivotForge.create(createContainer(), { fields, autoLoad: false });
      constructed[0].onCellDoubleClick({ type: "cell" });

      widget.dispose();

      assert.equal(disposed.length, 1);
    });
  });
});

// --- Declarative events ----------------------------------------------------
//
// A page that names a handler writes no wiring code; a page that prefers to
// listen gets a CustomEvent on the container. Both fire for the same emit, so
// neither choice switches the other off.

function createEventContainer() {
  const container = createContainer();
  container.events = [];
  container.dispatchEvent = event => { container.events.push(event); return true; };
  return container;
}

test("every emitted event is mirrored onto the container as a CustomEvent", async () => {
  const container = createEventContainer();
  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
  });

  await widget.refresh();

  const names = container.events.map(event => event.type);
  assert.equal(names.includes("pivotforge:dataloading"), true);
  assert.equal(names.includes("pivotforge:dataloaded"), true);
});

test("the DOM event carries the same payload the subscriber receives", async () => {
  const container = createEventContainer();
  const seen = [];
  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
  });
  widget.on("dataLoaded", payload => seen.push(payload));

  await widget.refresh();

  const dispatched = container.events.find(event => event.type === "pivotforge:dataloaded");
  assert.equal(dispatched.detail, seen[0]);
  assert.equal(dispatched.bubbles, true);
});

test("a declared handler name is resolved and subscribed", async () => {
  const seen = [];
  globalThis.pivotTestHandler = payload => seen.push(payload);

  try {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      renderImpl: () => {},
      events: { dataLoaded: "pivotTestHandler" },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.equal(seen.length, 1);
    widget.dispose();
  } finally {
    delete globalThis.pivotTestHandler;
  }
});

test("a dotted handler path is walked, so handlers can live on a namespace", async () => {
  const seen = [];
  globalThis.pivotTestApp = { handlers: { loaded: payload => seen.push(payload) } };

  try {
    const widget = PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      renderImpl: () => {},
      events: { dataLoaded: "pivotTestApp.handlers.loaded" },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
    });

    await widget.refresh();

    assert.equal(seen.length, 1);
    widget.dispose();
  } finally {
    delete globalThis.pivotTestApp;
  }
});

test("a handler name that resolves to nothing fails when its event fires", () => {
  // Resolution is deferred because a Razor helper starts the grid inline, before
  // a script block further down the page has defined anything. Construction
  // therefore has to accept a name it cannot resolve yet.
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    events: { dataLoaded: "thereIsNoSuchFunction" }
  });

  assert.throws(() => widget.emit("dataLoaded", {}), /is not a function on the page/);
  widget.dispose();
});

test("a handler defined after the grid is created is still found", async () => {
  const seen = [];
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    events: { dataLoaded: "pivotLateHandler" },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() })
  });

  // Defined only now, the way a script block below the grid markup would.
  globalThis.pivotLateHandler = payload => seen.push(payload);

  try {
    await widget.refresh();
    assert.equal(seen.length, 1);
  } finally {
    delete globalThis.pivotLateHandler;
    widget.dispose();
  }
});

test("an unknown event name is refused rather than silently ignored", () => {
  assert.throws(
    () => PivotForge.create(createContainer(), {
      fields,
      autoLoad: false,
      renderImpl: () => {},
      events: { notAnEvent: "whatever" }
    }),
    /Unknown PivotForge event/);
});

test("selection and copy callbacks reach both the event and the consumer", async () => {
  await withSpyRenderer(async ({ constructed }) => {
    const container = createEventContainer();
    const consumerSaw = [];
    const eventSaw = [];

    const widget = PivotForge.create(container, {
      fields,
      autoLoad: false,
      rendererOptions: {
        onSelectionChanged: selection => consumerSaw.push(selection),
        onCellCopied: (text, copied, kind) => consumerSaw.push({ text, copied, kind })
      }
    });
    widget.on("selectionChanged", payload => eventSaw.push(payload));
    widget.on("cellCopied", payload => eventSaw.push(payload));

    constructed[0].onSelectionChanged({ type: "cell" });
    constructed[0].onCellCopied("42", true, "cell");

    assert.equal(consumerSaw.length, 2);
    assert.equal(eventSaw.length, 2);
    // The three positional arguments arrive as one object.
    assert.deepEqual(eventSaw[1], { text: "42", copied: true, kind: "cell" });

    widget.dispose();
  });
});

test("cell activation emits even when the consumer supplies its own detail UI", async () => {
  await withStubModal(async ({ opened }) => {
    await withSpyRenderer(async ({ constructed }) => {
      const seen = [];
      const consumerSaw = [];
      const widget = PivotForge.create(createContainer(), {
        fields,
        autoLoad: false,
        rendererOptions: { onCellDoubleClick: selection => consumerSaw.push(selection) }
      });
      widget.on("cellDoubleClick", payload => seen.push(payload));

      constructed[0].onCellDoubleClick({ type: "cell" });

      assert.equal(seen.length, 1);
      assert.equal(consumerSaw.length, 1);
      // The consumer brought its own detail UI, so the packaged modal stays out.
      assert.equal(opened.length, 0);

      widget.dispose();
    });
  });
});

test("row fields' expansion and totals reach the renderer, in row order", async () => {
  await withSpyRenderer(async ({ constructed }) => {
    const widget = PivotForge.create(createContainer(), {
      autoLoad: false,
      fields: [
        { dataField: "Bolge", area: "row" },
        { dataField: "Kategori", area: "row", expanded: false, showTotals: false },
        { dataField: "Yil", area: "column" },
        { dataField: "Tutar", area: "data", aggregation: "sum" }
      ]
    });

    // Parallel to rowFields, and covering only row fields — a column field has
    // no level for the renderer to collapse or total.
    assert.deepEqual(constructed[0].rowFields, ["Bolge", "Kategori"]);
    assert.deepEqual(constructed[0].rowFieldExpanded, [true, false]);
    assert.deepEqual(constructed[0].rowFieldSubtotals, [true, false]);

    widget.dispose();
  });
});

test("moving a field rebuilds the renderer with the new levels", async () => {
  await withSpyRenderer(async ({ constructed }) => {
    const widget = PivotForge.create(createContainer(), {
      autoLoad: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => createResult() }),
      fields: [
        { dataField: "Bolge", area: "row", expanded: false },
        { dataField: "Tutar", area: "data", aggregation: "sum" }
      ]
    });

    await widget.update({
      fields: [
        { dataField: "Bolge", area: "row", expanded: false },
        { dataField: "Kategori", area: "row", expanded: false },
        { dataField: "Tutar", area: "data", aggregation: "sum" }
      ]
    });

    // A new hierarchy is a new declaration, so the fresh renderer honours it
    // again rather than inheriting the previous one's collapse decisions.
    assert.deepEqual(constructed.at(-1).rowFieldExpanded, [false, false]);
    widget.dispose();
  });
});
