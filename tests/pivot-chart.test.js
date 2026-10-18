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

// Region > City on the rows, Year > Quarter on the columns, with every total
// the engine sends: what bindChart reads.
const grouped = {
  rowHeaders: [["Ege", "İzmir"], ["Ege", "Aydın"], ["Marmara", "Bursa"]],
  columnHeaders: [["2024", "Q1"], ["2024", "Q2"]],
  cells: [
    { row: 0, column: 0, values: { a: 1, b: 10 } },
    { row: 0, column: 1, values: { a: 2, b: 20 } },
    { row: 1, column: 0, values: { a: 3, b: 30 } },
    { row: 1, column: 1, values: { a: 4, b: 40 } },
    { row: 2, column: 0, values: { a: 5, b: 50 } },
    { row: 2, column: 1, values: { a: 6, b: 60 } }
  ],
  rowTotals: [{ index: 0, values: { a: 3 } }, { index: 1, values: { a: 7 } }, { index: 2, values: { a: 11 } }],
  columnTotals: [{ index: 0, values: { a: 9 } }, { index: 1, values: { a: 12 } }],
  subtotals: [
    {
      rowHeader: ["Ege"],
      cells: [{ column: 0, values: { a: 4 } }, { column: 1, values: { a: 6 } }],
      totals: { a: 10 },
      columnSubtotals: [{ columnHeader: ["2024"], values: { a: 10 } }]
    },
    {
      rowHeader: ["Marmara"],
      cells: [{ column: 0, values: { a: 5 } }, { column: 1, values: { a: 6 } }],
      totals: { a: 11 },
      columnSubtotals: [{ columnHeader: ["2024"], values: { a: 11 } }]
    }
  ],
  columnSubtotals: [{
    columnHeader: ["2024"],
    cells: [{ index: 0, values: { a: 3 } }, { index: 1, values: { a: 7 } }, { index: 2, values: { a: 11 } }],
    totals: { a: 21 }
  }],
  grandTotals: { a: 21 }
};
const amount = [{ key: "a", label: "Amount" }];
const twoMeasures = [{ key: "a", label: "Amount" }, { key: "b", label: "Count" }];

test("binding reads every crossing of a leaf, a group and the grand total", () => {
  const seen = new Map();
  PivotChart.binding(grouped, { values: amount }, {
    processCell: cell => {
      seen.set(`${cell.rowPath.join("/")}|${cell.columnPath.join("/")}`, cell.chartDataItem.val);
    }
  });

  assert.equal(seen.get("Ege/İzmir|2024/Q1"), 1);
  assert.equal(seen.get("Ege/İzmir|2024"), 3);
  assert.equal(seen.get("Ege/İzmir|"), 3);
  assert.equal(seen.get("Ege|2024/Q1"), 4);
  assert.equal(seen.get("Ege|2024"), 10);
  assert.equal(seen.get("Ege|"), 10);
  assert.equal(seen.get("|2024/Q1"), 9);
  assert.equal(seen.get("|2024"), 21);
  assert.equal(seen.get("|"), 21);
  // Three row paths of each depth plus the total, the same for the columns.
  assert.equal(seen.size, 6 * 4);
});

test("binding charts the deepest level showing on each axis, as series and arguments", () => {
  const config = PivotChart.binding(grouped, { values: amount, grandTotalText: "Grand Total" });

  assert.deepEqual(config.dataSource.slice(0, 2), [
    { series: "Ege - İzmir", arg: "2024/Q1", val: 1 },
    { series: "Ege - İzmir", arg: "2024/Q2", val: 2 }
  ]);
  assert.equal(config.dataSource.length, 6);
  assert.equal(config.seriesTemplate.nameField, "series");
  assert.equal(config.panes, undefined);
});

test("a collapsed group leaves its rows out, and the level shown is the deepest one left", () => {
  const oneFolded = PivotChart.binding(grouped, { values: amount, collapsedRows: new Set(["Ege"]) });
  assert.deepEqual([...new Set(oneFolded.dataSource.map(item => item.series))], ["Marmara - Bursa"]);

  const allFolded = PivotChart.binding(grouped, {
    values: amount,
    collapsedRows: new Set(["Ege", "Marmara"]),
    collapsedColumns: new Set(["2024"])
  });
  assert.deepEqual(allFolded.dataSource, [
    { series: "Ege", arg: "2024", val: 10 },
    { series: "Marmara", arg: "2024", val: 11 }
  ]);
});

test("inverted makes the columns the series and the rows the arguments", () => {
  const config = PivotChart.binding(grouped, { values: amount }, { inverted: true });
  assert.deepEqual(config.dataSource[0], { series: "2024 - Q1", arg: "Ege/İzmir", val: 1 });
});

test("several measures name the series by default, or the arguments, or both", () => {
  const series = PivotChart.binding(grouped, { values: twoMeasures });
  assert.deepEqual(series.dataSource.slice(0, 2), [
    { series: "Ege - İzmir | Amount", arg: "2024/Q1", val: 1 },
    { series: "Ege - İzmir | Count", arg: "2024/Q1", val: 10 }
  ]);

  const args = PivotChart.binding(grouped, { values: twoMeasures }, { putDataFieldsInto: "Args" });
  assert.deepEqual(args.dataSource[1], { series: "Ege - İzmir", arg: "2024/Q1 | Count", val: 10 });

  const both = PivotChart.binding(grouped, { values: twoMeasures }, { putDataFieldsInto: "both" });
  assert.deepEqual(both.dataSource[0], { series: "Ege - İzmir | Amount", arg: "2024/Q1 | Amount", val: 1 });

  // One axis for all: nothing to tell the measures apart by unless asked.
  const single = PivotChart.binding(grouped, { values: twoMeasures }, { dataFieldsDisplayMode: "singleAxis" });
  assert.equal(single.dataSource[0].series, "Ege - İzmir");
  assert.throws(() => PivotChart.binding(grouped, {}, { putDataFieldsInto: "legend" }),
    /Unknown putDataFieldsInto "legend"/);
});

test("alternateDataFields false runs through every cell once per measure", () => {
  const config = PivotChart.binding(grouped, { values: twoMeasures }, { alternateDataFields: false });
  assert.deepEqual(config.dataSource.slice(0, 7).map(item => item.val), [1, 2, 3, 4, 5, 6, 10]);
});

test("processCell can chart a total and change what an item says", () => {
  const config = PivotChart.binding(grouped, { values: amount }, {
    processCell: cell => (cell.rowPath.length === 0 && cell.columnPath.length === 2
      ? { visible: true, chartDataItem: { series: "All regions" } }
      : null)
  });

  assert.deepEqual(config.dataSource.filter(item => item.series === "All regions"), [
    { series: "All regions", arg: "2024/Q1", val: 9 },
    { series: "All regions", arg: "2024/Q2", val: 12 }
  ]);
});

test("each display mode lays out its value axes, panes and series axes", () => {
  const formatValue = (value, definition) => `${definition.key}:${value}`;

  const separate = PivotChart.binding(grouped, { values: twoMeasures, formatValue });
  assert.deepEqual(separate.valueAxis.map(axis => [axis.name, axis.title, axis.valueType]),
    [["a", "Amount", "numeric"], ["b", "Count", "numeric"]]);
  assert.equal(separate.valueAxis[1].label.customizeText({ value: 5 }), "b:5");
  assert.deepEqual(separate.seriesTemplate.customizeSeries("Ege - İzmir | Count"), { axis: "b" });

  const panes = PivotChart.binding(grouped, { values: twoMeasures }, { dataFieldsDisplayMode: "splitPanes" });
  assert.deepEqual(panes.panes, [{ name: "a" }, { name: "b" }]);
  assert.equal(panes.valueAxis[1].pane, "b");
  assert.deepEqual(panes.seriesTemplate.customizeSeries("Ege - İzmir | Count"), { axis: "b", pane: "b" });

  const single = PivotChart.binding(grouped, { values: twoMeasures }, { dataFieldsDisplayMode: "singleAxis" });
  assert.equal(single.valueAxis.length, 1);
  assert.deepEqual(single.seriesTemplate.customizeSeries("Ege - İzmir"), {});
  assert.throws(() => PivotChart.binding(grouped, {}, { dataFieldsDisplayMode: "stacked" }),
    /Unknown dataFieldsDisplayMode/);
});

test("customizeSeries and customizeChart change what the chart is given", () => {
  const config = PivotChart.binding(grouped, { values: twoMeasures }, {
    customizeSeries: (name, options) => ({ ...options, type: name.endsWith("Count") ? "line" : "bar" }),
    customizeChart: () => ({ valueAxis: [{ visible: false }, { position: "right" }] })
  });

  assert.deepEqual(config.seriesTemplate.customizeSeries("Ege - İzmir | Count"), { axis: "b", type: "line" });
  // Merged into the axes, not put in their place.
  assert.equal(config.valueAxis[0].name, "a");
  assert.equal(config.valueAxis[0].visible, false);
  assert.equal(config.valueAxis[1].position, "right");
  assert.equal(config.valueAxis[1].title, "Count");
});

test("with no fields on either axis the one item is the grand total", () => {
  const config = PivotChart.binding({
    rowHeaders: [[]],
    columnHeaders: [[]],
    cells: [{ row: 0, column: 0, values: { a: 7 } }],
    grandTotals: { a: 7 }
  }, { values: amount, grandTotalText: "Total" });

  assert.deepEqual(config.dataSource, [{ series: "Total", arg: "Total", val: 7 }]);
});

// ---- bindChart. -------------------------------------------------------------

function regionResult(keys, scale = 1) {
  return {
    rowHeaders: [["Ege"], ["Marmara"]],
    columnHeaders: [["2024"]],
    cells: [
      { row: 0, column: 0, values: { [keys[0]]: 10 * scale, [keys[1]]: 1 } },
      { row: 1, column: 0, values: { [keys[0]]: 20 * scale, [keys[1]]: 2 } }
    ],
    grandTotals: { [keys[0]]: 30 * scale, [keys[1]]: 3 }
  };
}

function fakeChart() {
  return { written: [], option(config) { this.written.push(config); } };
}

test("bindChart writes the chart at once and again after every draw, until unbound", () => {
  withChart(({ widget }) => {
    const keys = widget.valueDefinitions().map(value => value.key);
    const chart = fakeChart();
    widget.result = regionResult(keys);

    const unbind = widget.bindChart(chart, { dataFieldsDisplayMode: "splitPanes" });
    assert.equal(chart.written.length, 1);
    assert.deepEqual(chart.written[0].dataSource.map(item => [item.series, item.arg, item.val]), [
      ["Ege | Tutar", "2024", 10], ["Ege | Adet", "2024", 1],
      ["Marmara | Tutar", "2024", 20], ["Marmara | Adet", "2024", 2]
    ]);
    assert.deepEqual(chart.written[0].panes.map(pane => pane.name), keys);

    widget.result = regionResult(keys, 2);
    widget.render(widget.result);
    assert.equal(chart.written.length, 2);
    assert.equal(chart.written[1].dataSource[0].val, 20);

    unbind();
    widget.render(widget.result);
    assert.equal(chart.written.length, 2);
  });
});

test("bindChart feeds a function, and getChartDataSource answers without binding", () => {
  withChart(({ widget }) => {
    const keys = widget.valueDefinitions().map(value => value.key);
    const configs = [];
    // Bound before any data: nothing is written until the first draw.
    widget.bindChart((config, context) => configs.push({ config, context }), { inverted: true });
    assert.equal(configs.length, 0);

    widget.result = regionResult(keys);
    widget.render(widget.result);
    assert.equal(configs.length, 1);
    assert.equal(configs[0].context.result, widget.result);
    assert.equal(configs[0].config.dataSource[0].series, "2024 | Tutar");

    const config = widget.getChartDataSource({ dataFieldsDisplayMode: "singleAxis" });
    assert.equal(config.dataSource[0].series, "Ege");
    assert.equal(configs.length, 1);
  });
});

test("a chart bound to a second pivot leaves the first, and dispose unbinds every chart", () => {
  const chart = fakeChart();
  let first;
  withChart(({ widget }) => {
    first = widget;
    const keys = widget.valueDefinitions().map(value => value.key);
    widget.result = regionResult(keys);
    widget.bindChart(chart);

    withChart(({ widget: second }) => {
      second.result = regionResult(keys, 3);
      second.bindChart(chart);
      assert.equal(chart.written.at(-1).dataSource[0].val, 30);

      first.render(first.result);
      assert.equal(chart.written.at(-1).dataSource[0].val, 30);
    });
  });

  // Both are disposed; the chart keeps what it was last given.
  assert.equal(chart.written.length, 2);
  assert.equal(first.chartBindings.size, 0);
});

test("bindChart returns null for what is no chart and refuses an unknown option", () => {
  withChart(({ widget }) => {
    assert.equal(widget.bindChart(null), null);
    assert.equal(widget.bindChart({}), null);
    assert.throws(() => widget.bindChart(fakeChart(), { dataFieldsDisplayMode: "stacked" }),
      /Unknown dataFieldsDisplayMode "stacked"/);
    assert.throws(() => widget.bindChart(fakeChart(), { processCell: "x" }), /processCell must be a function/);
  });
});
