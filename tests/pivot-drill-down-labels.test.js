const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-drill-down-modal.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-locale-tr.js");

const PivotForge = globalThis.PivotForge;

// The server checks a declared label key against a list of its own. Read back
// from the C# source, so a label added here and not there fails a test rather
// than a page.
test("the server knows exactly the detail modal's label keys", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/PivotForge.AspNetCore/Rendering/PivotGridBuilder.cs"), "utf8");
  const list = source.match(/DrillDownLabelKeys =\s*\[([^\]]*)\]/)[1];
  const serverKeys = [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]);

  assert.deepEqual(serverKeys.sort(), Object.keys(PivotForge.PivotDrillDownModal.defaultLabels).sort());
});

test("a declared label wins over the locale pack without costing the pack's other labels", () => {
  const original = PivotForge.PivotDrillDownModal;
  const built = [];
  PivotForge.PivotDrillDownModal = class {
    constructor(options) { built.push(options); }
    open() {}
    dispose() {}
  };

  try {
    const container = { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, replaceChildren() {} };
    const widget = PivotForge.create(container, {
      fields: [
        { dataField: "urun", area: "row" },
        { dataField: "tutar", area: "data", aggregation: "sum" }
      ],
      autoLoad: false,
      renderImpl: () => {},
      locale: "tr",
      drillDownModalOptions: { labels: { title: "Satış kayıtları" }, culture: "tr-TR" }
    });

    widget.openDrillDown({ rowHeader: [], columnHeader: [] });

    assert.equal(built.length, 1);
    assert.equal(built[0].labels.title, "Satış kayıtları");
    // The pack's word, not the English default and not missing.
    assert.equal(built[0].labels.close, "Kapat");
    assert.equal(built[0].culture, "tr-TR");
    assert.equal(built[0].widget, widget);
    widget.dispose();
  } finally {
    PivotForge.PivotDrillDownModal = original;
  }
});
