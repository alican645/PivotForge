const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

const PivotForge = globalThis.PivotForge;

const fields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

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

function createContainer() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() { this._children = []; },
    appendChild(node) { (this._children ??= []).push(node); return node; },
    _children: [],
    get children() { return asChildren(this._children); }
  };
}

function createWidget(overrides = {}) {
  const calls = [];
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ cells: [], grandTotals: {} }) };
    },
    ...overrides
  });
  return { widget, calls };
}

test("sortBy sends the sort with the next request", async () => {
  const { widget, calls } = createWidget();

  await widget.sortBy({ mode: "rowLabel", direction: "descending", field: "urun" });

  assert.deepEqual(calls[0].rowSort, {
    mode: "rowLabel",
    direction: "descending",
    field: "urun"
  });
  assert.equal(widget.getState().rowSort.direction, "descending");
  widget.dispose();
});

test("sortBy is rejected when sorting is disabled", async () => {
  const { widget } = createWidget({ allowSorting: false });

  await assert.rejects(
    () => widget.sortBy({ mode: "rowLabel", direction: "ascending", field: "urun" }),
    /allowSorting is disabled/
  );
  widget.dispose();
});

test("setFilter adds a filter to the request", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum", "Helva"]);

  assert.deepEqual(
    calls[0].filters, [{ field: "urun", values: ["Lokum", "Helva"], mode: "Include" }]);
  widget.dispose();
});

test("setFilter replaces an existing filter on the same field", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.setFilter("urun", ["Helva"]);

  assert.deepEqual(calls[1].filters, [{ field: "urun", values: ["Helva"], mode: "Include" }]);
  widget.dispose();
});

test("setFilter with an empty list clears that field", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.setFilter("urun", []);

  assert.deepEqual(calls[1].filters, []);
  widget.dispose();
});

test("clearFilters removes every filter", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.clearFilters();

  assert.deepEqual(calls[1].filters, []);
  assert.deepEqual(widget.getState().filters, []);
  widget.dispose();
});

test("setFilter is rejected when filtering is disabled", async () => {
  const { widget } = createWidget({ allowFiltering: false });

  await assert.rejects(
    () => widget.setFilter("urun", ["Lokum"]),
    /allowFiltering is disabled/
  );
  widget.dispose();
});

// Captures what the widget hands its renderer, at construction and per render.
async function withFakeRenderer(run, options = {}, { picker = true } = {}) {
  const captured = { renders: [] };
  class FakeRenderer {
    constructor(container, rendererOptions) { Object.assign(captured, rendererOptions); }
    render(result, perRender) { captured.renders.push(perRender ?? {}); }
  }
  const previousRenderer = PivotForge.PivotTableRenderer;
  const previousPicker = PivotForge.PivotFilterPicker;
  PivotForge.PivotTableRenderer = FakeRenderer;

  // The funnel is only offered where there is something to show values in, so
  // a picker has to be in place for the enabled cases.
  const opened = [];
  PivotForge.PivotFilterPicker = picker
    ? class {
      open(request) { opened.push(request); return request; }
      dispose() {}
    }
    : undefined;

  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ cells: [], grandTotals: {} }) }),
    ...options
  });

  try {
    return await run(widget, captured, opened);
  } finally {
    widget.dispose();
    PivotForge.PivotTableRenderer = previousRenderer;
    PivotForge.PivotFilterPicker = previousPicker;
  }
}

test("the renderer receives a filter callback when filtering is enabled", async () => {
  await withFakeRenderer((widget, captured) => {
    assert.equal(typeof captured.onFilterRequested, "function");
  });
});

test("a widget that cannot filter offers no header funnel", async () => {
  await withFakeRenderer((widget, captured) => {
    assert.equal(captured.onFilterRequested, null);
  }, { allowFiltering: false });
});

test("a page without the filter picker gets no funnel rather than a broken one", async () => {
  await withFakeRenderer((widget, captured) => {
    assert.equal(captured.onFilterRequested, null);
  }, {}, { picker: false });
});

test("the header funnel opens the picker over the field's current filter", async () => {
  await withFakeRenderer(async (widget, captured, opened) => {
    await widget.setFilter("urun", ["Lokum"], "Exclude");

    captured.onFilterRequested("urun");

    assert.equal(opened.length, 1);
    assert.equal(opened[0].field, "urun");
    assert.equal(opened[0].caption, "Ürün");
    assert.deepEqual(opened[0].selected, ["Lokum"]);
    assert.equal(opened[0].mode, "Exclude");
  });
});

test("applying the header picker filters the widget", async () => {
  await withFakeRenderer(async (widget, captured, opened) => {
    captured.onFilterRequested("urun");
    await opened[0].onApply(["Lokum"], "Exclude");

    assert.deepEqual(widget.getState().filters,
      [{ field: "urun", values: ["Lokum"], mode: "Exclude" }]);
  });
});

test("each draw tells the renderer which fields are restricted", async () => {
  await withFakeRenderer(async (widget, captured) => {
    await widget.refresh();
    assert.deepEqual(captured.renders.at(-1).filteredFields, []);

    await widget.setFilter("urun", ["Lokum"]);

    assert.deepEqual(captured.renders.at(-1).filteredFields, ["urun"]);
  });
});

test("a declared filter with nothing excluded is no restriction", async () => {
  // An empty value list restricts nothing in either mode, so a funnel that
  // marked itself active for one would be lying about the table on screen.
  await withFakeRenderer((widget, captured) => {
    assert.deepEqual(captured.filteredFields, []);
  }, { filters: [{ field: "urun", values: [], mode: "Include" }] });
});

test("the header funnel defers to an attached designer", async () => {
  // One picker per page: with a designer present the funnel borrows its picker
  // rather than building a second one that would show a stale selection.
  await withFakeRenderer((widget, captured) => {
    const asked = [];
    widget.designer = { openFilterPicker: field => asked.push(field), dispose() {} };

    captured.onFilterRequested("urun");

    assert.deepEqual(asked, ["urun"]);
    assert.equal(widget.headerFilterPicker, null);
  });
});

test("the renderer receives a sort callback when sorting is enabled", () => {
  const captured = {};
  class FakeRenderer {
    constructor(container, options) { Object.assign(captured, options); }
    render() {}
  }
  const previous = PivotForge.PivotTableRenderer;
  PivotForge.PivotTableRenderer = FakeRenderer;

  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });

  assert.equal(typeof captured.onSortRequested, "function");
  assert.deepEqual(captured.rowFields, ["urun"]);
  assert.deepEqual(captured.rowFieldLabels, ["Ürün"]);

  widget.dispose();
  PivotForge.PivotTableRenderer = previous;
});
