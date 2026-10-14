const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-chart.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-locale-tr.js");

const PivotForge = globalThis.PivotForge;
const PivotChart = PivotForge.PivotChart;

// Region on the rows, Year on the columns, one value.
const flat = {
  rowHeaders: [["Ege"], ["Marmara"]],
  columnHeaders: [["2024"], ["2025"]],
  cells: [
    { row: 0, column: 0, values: { amount_sum: 10 } },
    { row: 0, column: 1, values: { amount_sum: 20 } },
    { row: 1, column: 0, values: { amount_sum: 30 } }
  ],
  rowTotals: [{ index: 0, values: { amount_sum: 30 } }, { index: 1, values: { amount_sum: 30 } }],
  grandTotals: { amount_sum: 60 }
};

test("normalize accepts true, a type name in any case, or an object, and refuses the rest", () => {
  assert.deepEqual(PivotChart.normalize(true),
    { type: "column", position: "top", height: 320, valueKey: null, visible: true });
  assert.equal(PivotChart.normalize("StackedColumn").type, "stackedColumn");
  assert.equal(PivotChart.normalize("LINE").type, "line");
  assert.deepEqual(
    PivotChart.normalize({ type: "bar", position: "Bottom", height: 400, valueKey: "amount_sum" }),
    { type: "bar", position: "bottom", height: 400, valueKey: "amount_sum", visible: true });
  assert.equal(PivotChart.normalize({ visible: false }).visible, false);
  assert.throws(() => PivotChart.normalize({ visible: "no" }), /visible must be true or false/);
  assert.equal(PivotChart.normalize(null), null);
  assert.equal(PivotChart.normalize(false), null);
  assert.equal(PivotChart.normalize("None"), null);
  assert.throws(() => PivotChart.normalize("pie"), /Unknown chart type "pie"/);
  assert.throws(() => PivotChart.normalize({ position: "left" }), /Unknown chart position/);
  assert.throws(() => PivotChart.normalize({ height: 50 }), /at least 120/);
});

test("rows become categories and columns series, read from the cells", () => {
  const model = PivotChart.model(flat, { valueKey: "amount_sum" });
  assert.deepEqual(model.categories, ["Ege", "Marmara"]);
  assert.deepEqual(model.series, [
    { label: "2024", values: [10, 30] },
    // A missing cell is a gap, never a zero.
    { label: "2025", values: [20, null] }
  ]);
  assert.equal(model.totalSeries, 2);
});

test("with nothing on the columns the value is the one series, read from the row totals", () => {
  const result = {
    rowHeaders: [["Ege"], ["Marmara"]],
    columnHeaders: [[]],
    cells: [{ row: 0, column: 0, values: { amount_sum: 5 } }, { row: 1, column: 0, values: { amount_sum: 7 } }],
    rowTotals: [{ index: 0, values: { amount_sum: 5 } }, { index: 1, values: { amount_sum: 7 } }]
  };
  const model = PivotChart.model(result, { valueKey: "amount_sum", valueLabel: "Tutar" });
  assert.deepEqual(model.series, [{ label: "Tutar", values: [5, 7] }]);
});

test("with no row field the grid's one row is the total category", () => {
  const result = {
    rowHeaders: [[]],
    columnHeaders: [["2024"]],
    cells: [{ row: 0, column: 0, values: { amount_sum: 9 } }]
  };
  const model = PivotChart.model(result, { valueKey: "amount_sum", totalText: "Toplam" });
  assert.deepEqual(model.categories, ["Toplam"]);
  assert.deepEqual(model.series[0].values, [9]);
});

test("nested rows and columns chart the outer groups, from the engine's own subtotals", () => {
  // Region > Category on the rows, Year > Quarter on the columns, averaged:
  // the subtotals are deliberately not the sums of the cells, so a model that
  // added cells up instead of reading the subtotal would be caught.
  const result = {
    rowHeaders: [["Ege", "Gıda"], ["Ege", "Tekstil"], ["Marmara", "Gıda"]],
    columnHeaders: [["2024", "Q1"], ["2024", "Q2"], ["2025", "Q1"]],
    cells: [],
    subtotals: [
      {
        rowHeader: ["Ege"],
        cells: [],
        totals: { amount_avg: 15 },
        columnSubtotals: [
          { columnHeader: ["2024"], values: { amount_avg: 11 } },
          { columnHeader: ["2025"], values: { amount_avg: 12 } }
        ]
      },
      {
        rowHeader: ["Marmara"],
        cells: [],
        totals: { amount_avg: 25 },
        columnSubtotals: [{ columnHeader: ["2024"], values: { amount_avg: 21 } }]
      }
    ]
  };
  const model = PivotChart.model(result, { valueKey: "amount_avg" });
  assert.deepEqual(model.categories, ["Ege", "Marmara"]);
  assert.deepEqual(model.series, [
    { label: "2024", values: [11, 21] },
    { label: "2025", values: [12, null] }
  ]);
});

test("a single row level with nested columns reads the column subtotals", () => {
  const result = {
    rowHeaders: [["Ege"], ["Marmara"]],
    columnHeaders: [["2024", "Q1"], ["2024", "Q2"]],
    cells: [],
    columnSubtotals: [{
      columnHeader: ["2024"],
      cells: [{ index: 0, values: { amount_sum: 3 } }, { index: 1, values: { amount_sum: 4 } }],
      totals: { amount_sum: 7 }
    }]
  };
  assert.deepEqual(PivotChart.model(result, { valueKey: "amount_sum" }).series, [{ label: "2024", values: [3, 4] }]);
});

test("nested rows over a single column level read each group's subtotal cells", () => {
  const result = {
    rowHeaders: [["Ege", "Gıda"], ["Ege", "Tekstil"]],
    columnHeaders: [["2024"], ["2025"]],
    cells: [],
    subtotals: [{
      rowHeader: ["Ege"],
      cells: [{ row: 0, column: 0, values: { amount_sum: 8 } }, { row: 0, column: 1, values: { amount_sum: 9 } }],
      totals: { amount_sum: 17 }
    }]
  };
  assert.deepEqual(PivotChart.model(result, { valueKey: "amount_sum" }).series.map(series => series.values), [[8], [9]]);
});

test("a blank label is named, and more than eight series are cut to eight", () => {
  const columnHeaders = Array.from({ length: 10 }, (_, index) => [index === 0 ? null : `S${index}`]);
  const result = {
    rowHeaders: [[null]],
    columnHeaders,
    cells: columnHeaders.map((_, column) => ({ row: 0, column, values: { v: column } }))
  };
  const model = PivotChart.model(result, { valueKey: "v", blankText: "(Boş)" });
  assert.deepEqual(model.categories, ["(Boş)"]);
  assert.equal(model.series.length, PivotChart.MAX_SERIES);
  assert.equal(model.series[0].label, "(Boş)");
  assert.equal(model.totalSeries, 10);
});

test("ticks are round, take in zero and reach past both ends of the data", () => {
  assert.deepEqual(PivotChart.niceTicks(0, 584920), [0, 200000, 400000, 600000]);
  assert.deepEqual(PivotChart.niceTicks(-30, 70), [-40, -20, 0, 20, 40, 60, 80]);
  assert.deepEqual(PivotChart.niceTicks(0.1, 0.3), [0, 0.1, 0.2, 0.3]);
  // All values equal to zero still give the axis a range.
  assert.deepEqual(PivotChart.niceTicks(0, 0), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.ok(PivotChart.niceTicks(250, 250).includes(0));
});

test("axis labels are compact, and percentages read as percentages", () => {
  const space = text => text.replace(/\s/g, " ");
  assert.equal(space(PivotChart.axisFormatter({}, "en-US")(1500000)), "1.5M");
  assert.equal(PivotChart.axisFormatter({ showAs: "percentOfGrandTotal" }, "en-US")(0.25), "25%");
  // A percent format without a percent calculation holds whole percents.
  assert.equal(PivotChart.axisFormatter({ format: { type: "percent" } }, "en-US")(25), "25%");
});

test("a series keeps its colour when others come and go", () => {
  const colors = new PivotChart.SeriesColors();
  assert.deepEqual(colors.assign(["2023", "2024", "2025"]), [0, 1, 2]);
  // 2023 filtered away: the survivors keep theirs.
  assert.deepEqual(colors.assign(["2024", "2025"]), [1, 2]);
  // A newcomer takes the first slot nobody has held.
  assert.deepEqual(colors.assign(["2024", "2025", "2026"]), [1, 2, 3]);
  // 2023 comes back to its own colour.
  assert.deepEqual(colors.assign(["2023", "2024"]), [0, 1]);
  colors.reset();
  assert.deepEqual(colors.assign(["Q1"]), [0]);
});

test("once every slot has been held, a newcomer takes one whose series is gone", () => {
  const colors = new PivotChart.SeriesColors();
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
  colors.assign(eight);
  const slots = colors.assign(["b", "c", "d", "e", "f", "g", "h", "i"]);
  assert.equal(slots[7], 0);
  assert.equal(new Set(slots).size, 8);
});

// ---- The widget's side: what it declares, keeps and restores. ---------------

const fields = [
  { caption: "Bölge", dataField: "Region", area: "row" },
  { caption: "Yıl", dataField: "Year", area: "column" },
  { caption: "Tutar", dataField: "Amount", area: "data", aggregation: "sum" },
  { caption: "Adet", dataField: "Quantity", area: "data", aggregation: "sum" }
];

function element(tagName) {
  return {
    tagName,
    dataset: {},
    attributes: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() {},
    addEventListener() {},
    remove() { this.removed = true; }
  };
}

function withChart(run, options = {}, storage = null) {
  const previousDocument = globalThis.document;
  const previousStorage = globalThis.localStorage;
  const Previous = PivotForge.PivotChart;
  const drawn = [];
  globalThis.document = { createElement: element };
  if (storage) {
    globalThis.localStorage = storage;
  }
  // The real chart, with its drawing recorded rather than done: there is no
  // DOM here, and what is drawn is the browser tests' business.
  PivotForge.PivotChart = class extends Previous {
    draw() { drawn.push({ ...this.state }); }
  };
  Object.assign(PivotForge.PivotChart, Previous);

  const container = {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() {},
    appendChild(node) { return node; },
    removeAttribute() {},
    setAttribute() {},
    before(node) { (this.beforeNodes ??= []).push(node); this.beforeNode = node; },
    after(node) { this.afterNode = node; }
  };
  const widget = PivotForge.create(container, {
    fields,
    autoLoad: false,
    loadPanel: false,
    renderImpl: () => {},
    ...options
  });

  const cleanup = () => {
    widget.dispose();
    PivotForge.PivotChart = Previous;
    globalThis.document = previousDocument;
    globalThis.localStorage = previousStorage;
  };

  let result;
  try {
    result = run({ widget, container, drawn });
  } catch (error) {
    cleanup();
    throw error;
  }

  if (typeof result?.then === "function") {
    return result.finally(cleanup);
  }

  cleanup();
  return result;
}

test("no chart unless one is declared", () => {
  withChart(({ widget, container }) => {
    assert.equal(widget.chart, null);
    assert.equal(container.beforeNode, undefined);
    assert.equal(widget.snapshotState().chart, undefined);
  });
});

test("a declared chart sits above the grid by default and below it when asked", () => {
  withChart(({ widget, container }) => {
    assert.ok(widget.chart);
    assert.equal(container.beforeNode, widget.chartNode);
  }, { chart: "column" });

  withChart(({ widget, container }) => {
    assert.equal(container.afterNode, widget.chartNode);
    assert.equal(container.beforeNode, undefined);
  }, { chart: { type: "line", position: "bottom" } });
});

test("a chart without pivot-chart.js loaded is a declaration error", () => {
  const Previous = PivotForge.PivotChart;
  delete PivotForge.PivotChart;
  try {
    assert.throws(
      () => PivotForge.create({ classList: { add() {} } }, { fields, autoLoad: false, renderImpl: () => {}, chart: true }),
      /chart requires pivot-chart\.js/);
  } finally {
    PivotForge.PivotChart = Previous;
  }
});

test("every result is charted with the values on screen, the first one by default", () => {
  withChart(({ widget, drawn }) => {
    widget.render(flat);
    assert.deepEqual(widget.chart.values.map(value => value.key), ["Amount_sum", "Quantity_sum"]);
    assert.deepEqual(drawn.at(-1), { type: "bar", valueKey: "Amount_sum" });
    assert.deepEqual(widget.snapshotState().chart, { type: "bar", valueKey: "Amount_sum", visible: true });
    assert.equal(widget.chart.scope, "Year");
  }, { chart: "Bar" });
});

test("a declared value key is charted, and one no longer on screen falls back to the first", () => {
  withChart(({ widget, drawn }) => {
    widget.render(flat);
    assert.equal(drawn.at(-1).valueKey, "Quantity_sum");
  }, { chart: { valueKey: "Quantity_sum" } });

  withChart(({ widget, drawn }) => {
    widget.render(flat);
    assert.equal(drawn.at(-1).valueKey, "Amount_sum");
  }, { chart: { valueKey: "Gone_sum" } });
});

test("the reader's switch is kept with the view, and a stored one comes back", () => {
  const store = new Map();
  const storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  };
  const options = { chart: "column", stateStoring: "local", stateKey: "chart-test" };

  withChart(({ widget }) => {
    widget.render(flat);
    widget.chart.change({ type: "line", valueKey: "Quantity_sum" });
    assert.deepEqual(widget.chartState, { type: "line", valueKey: "Quantity_sum" });
  }, options, storage);

  assert.deepEqual(JSON.parse([...store.values()][0]).chart, { type: "line", valueKey: "Quantity_sum", visible: true });

  withChart(({ widget, drawn }) => {
    widget.render(flat);
    assert.deepEqual(drawn.at(-1), { type: "line", valueKey: "Quantity_sum" });
  }, options, storage);
});

test("a stored chart type this build does not draw falls back to the declared one", () => {
  withChart(({ widget }) => {
    assert.deepEqual(widget.parseChartState({ type: "pie", valueKey: 4, visible: "yes" }),
      { type: undefined, valueKey: undefined, visible: undefined });
    assert.equal(widget.parseChartState("line"), null);
  }, { chart: true });
});

test("setChart switches the type or the value from code", () => {
  withChart(({ widget, drawn }) => {
    widget.render(flat);
    widget.setChart({ type: "StackedColumn" });
    assert.deepEqual(drawn.at(-1), { type: "stackedColumn", valueKey: "Amount_sum" });
    widget.setChart({ valueKey: "Quantity_sum" });
    assert.deepEqual(widget.chartState, { type: "stackedColumn", valueKey: "Quantity_sum" });
    assert.throws(() => widget.setChart({ type: "pie" }), /Unknown chart type/);
    assert.throws(() => widget.setChart({ type: "none" }), /remove the chart option/);
  }, { chart: true });

  withChart(({ widget }) => {
    assert.throws(() => widget.setChart({ type: "line" }), /has no chart/);
  });
});

test("an opened report brings its chart with it", async () => {
  await withChart(async ({ widget, drawn }) => {
    widget.refresh = async () => {};
    widget.render(flat);
    await widget.loadReport({ format: "pivotforge-report", version: 1, chart: { type: "line", valueKey: "Quantity_sum" } });
    assert.deepEqual(drawn.at(-1), { type: "line", valueKey: "Quantity_sum" });
  }, { chart: "column" });
});

test("the Turkish pack names the chart's controls", () => {
  withChart(({ widget }) => {
    assert.equal(widget.chart.texts.line, "Çizgi");
    assert.equal(widget.chart.texts.stackedColumn, "Yığılmış");
    assert.equal(widget.chart.texts.noData, "Grafikte gösterilecek veri yok");
  }, { chart: true, locale: "tr" });
});

test("dispose takes the chart away with the grid", () => {
  let node;
  withChart(({ widget }) => {
    node = widget.chartNode;
  }, { chart: true });
  assert.equal(node.removed, true);
});

// ---- The toolbar's chart button. --------------------------------------------

function chartButton(container) {
  const toolbar = container.beforeNodes?.find(node => node.attributes.role === "toolbar");
  return toolbar?.children.find(button => button.dataset.toolbarItem === "chart") ?? null;
}

function memoryStorage() {
  const store = new Map();
  return {
    store,
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  };
}

test("the chart button is offered only beside a chart, last with toolbar: true", () => {
  withChart(({ container }) => {
    assert.equal(chartButton(container), null);
  }, { toolbar: ["print", "chart"] });

  withChart(({ container }) => {
    const toolbar = container.beforeNodes[0];
    assert.equal(toolbar.children.at(-1).dataset.toolbarItem, "chart");
    assert.equal(chartButton(container).attributes["aria-pressed"], "true");
  }, { toolbar: true, chart: true });
});

test("the chart button hides the chart and shows it again, drawing the latest result", async () => {
  await withChart(async ({ widget, container, drawn }) => {
    const button = chartButton(container);
    widget.result = flat;
    widget.render(flat);
    const before = drawn.length;

    await widget.runToolbarItem("chart", button);
    assert.equal(widget.chartNode.hidden, true);
    assert.equal(button.attributes["aria-pressed"], "false");
    assert.equal(widget.snapshotState().chart.visible, false);

    // A hidden chart is not drawn on a new result.
    widget.render(flat);
    assert.equal(drawn.length, before);

    await widget.runToolbarItem("chart", button);
    assert.equal(widget.chartNode.hidden, false);
    assert.equal(button.attributes["aria-pressed"], "true");
    assert.equal(drawn.length, before + 1);
  }, { toolbar: ["chart"], chart: true });
});

test("a chart declared hidden starts hidden, and a hidden one stays hidden on the next visit", () => {
  withChart(({ widget, drawn }) => {
    assert.equal(widget.chartNode.hidden, true);
    widget.render(flat);
    assert.equal(drawn.length, 0);
  }, { chart: { visible: false } });

  const storage = memoryStorage();
  const options = { chart: true, stateStoring: "local", stateKey: "chart-visible" };
  withChart(({ widget }) => {
    widget.showChart(false);
  }, options, storage);
  assert.equal(JSON.parse([...storage.store.values()][0]).chart.visible, false);

  withChart(({ widget }) => {
    assert.equal(widget.chartVisible, false);
    assert.equal(widget.chartNode.hidden, true);
  }, options, storage);
});

test("showChart toggles from code, and needs a chart", () => {
  withChart(({ widget }) => {
    widget.showChart();
    assert.equal(widget.chartVisible, false);
    widget.showChart(true);
    assert.equal(widget.chartVisible, true);
  }, { chart: true });

  withChart(({ widget }) => {
    assert.throws(() => widget.showChart(), /has no chart/);
  });
});

test("an opened report shows or hides the chart as it was saved", async () => {
  await withChart(async ({ widget }) => {
    widget.refresh = async () => {};
    await widget.loadReport({ format: "pivotforge-report", version: 1, chart: { visible: false } });
    assert.equal(widget.chartNode.hidden, true);
    assert.equal(widget.chartState.type, "column");
  }, { chart: "column" });
});

test("the Turkish pack names the chart button", () => {
  withChart(({ container }) => {
    assert.equal(chartButton(container).textContent, "Grafik");
  }, { chart: true, toolbar: ["chart"], locale: "tr" });
});
