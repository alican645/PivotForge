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

function createContainer() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() {},
    appendChild(node) { return node; },
    children: []
  };
}

// Captures what the widget hands its renderer, and any console warning it makes
// on the way -- the locale's only failure mode is a warning.
function withWidget(run, options = {}) {
  const captured = {};
  class FakeRenderer {
    constructor(container, rendererOptions) { Object.assign(captured, rendererOptions); }
    render() {}
  }
  const previousRenderer = PivotForge.PivotTableRenderer;
  const previousWarn = console.warn;
  const warnings = [];
  PivotForge.PivotTableRenderer = FakeRenderer;
  console.warn = message => warnings.push(message);

  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ cells: [] }) }),
    ...options
  });

  try {
    return run(widget, captured, warnings);
  } finally {
    widget.dispose();
    PivotForge.PivotTableRenderer = previousRenderer;
    console.warn = previousWarn;
  }
}

test("a grid with no locale declares no text, so the English defaults stand", () => {
  withWidget((widget, captured, warnings) => {
    // Nothing is sent rather than something English being sent: the renderer's
    // own defaults are where the English lives, and overriding them with a copy
    // would put the same strings in two places.
    assert.deepEqual(captured.texts, {});
    assert.equal(captured.totalText, undefined);
    assert.deepEqual(warnings, []);
  });
});

test("a locale pack supplies every string the renderer shows", () => {
  withWidget((widget, captured) => {
    assert.equal(captured.texts.rowLabels, "Satır Etiketleri");
    assert.equal(captured.texts.noData, "Veri yok");
    // Not every presentation string lives in `texts`, so the pack carries the
    // rest of the renderer options too.
    assert.equal(captured.totalText, "Toplam");
    assert.equal(captured.ariaLabel, "Pivot tablosu");
  }, { locale: "tr" });
});

test("a declared text wins over the pack without costing the rest of it", () => {
  withWidget((widget, captured) => {
    assert.equal(captured.texts.noData, "Kayıt bulunamadı");
    assert.equal(captured.texts.rowLabels, "Satır Etiketleri");
    assert.equal(captured.totalText, "Genel Toplam");
  }, {
    locale: "tr",
    rendererOptions: { totalText: "Genel Toplam", texts: { noData: "Kayıt bulunamadı" } }
  });
});

test("a locale given as an object is taken as one", () => {
  withWidget((widget, captured) => {
    assert.equal(captured.texts.noData, "Keine Daten");
  }, { locale: { table: { texts: { noData: "Keine Daten" } } } });
});

test("a locale nothing answers to warns and leaves the text English", () => {
  withWidget((widget, captured, warnings) => {
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /pivot-locale-de\.js/);
    // The grid still renders: a missing translation file is not a reason to
    // fail a page.
    assert.deepEqual(captured.texts, {});
  }, { locale: "de" });
});

test("English is the built-in language rather than a pack, so it warns about nothing", () => {
  // The tag helper derives the locale from the request, which means every
  // English page would otherwise warn on every grid.
  withWidget((widget, captured, warnings) => {
    assert.deepEqual(warnings, []);
    assert.deepEqual(captured.texts, {});
  }, { locale: "en" });
});

test("the designer's labels carry the picker's, because the designer opens it", () => {
  withWidget(widget => {
    const labels = widget.designerLabels();

    assert.equal(labels.row, "Satırlar");
    assert.equal(labels.showAsLabels.runningTotal, "Kümülatif toplam");
    assert.equal(labels.filterPicker.apply, "Uygula");
  }, { locale: "tr" });
});

test("a declared designer label wins over the pack, key by key", () => {
  withWidget(widget => {
    const labels = widget.designerLabels();

    assert.equal(labels.row, "Satır Alanları");
    assert.equal(labels.column, "Sütunlar");
    assert.equal(labels.filterPicker.apply, "Tamam");
    assert.equal(labels.filterPicker.cancel, "İptal");
  }, {
    locale: "tr",
    designerLabels: { row: "Satır Alanları", filterPicker: { apply: "Tamam" } }
  });
});

test("the detail modal is built with the pack's labels", () => {
  const previous = PivotForge.PivotDrillDownModal;
  const captured = [];
  PivotForge.PivotDrillDownModal = class {
    constructor(options) { captured.push(options); }
    open() {}
    dispose() {}
  };

  try {
    withWidget(widget => {
      widget.drillDownHandler()({ type: "cell" });

      assert.equal(captured[0].labels.title, "Kaynak Kayıtlar");
    }, { locale: "tr" });
  } finally {
    PivotForge.PivotDrillDownModal = previous;
  }
});
