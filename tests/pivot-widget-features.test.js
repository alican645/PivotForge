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

function createWidget(responder, overrides = {}) {
  const calls = [];
  const widget = PivotForge.create(createContainer(), {
    fields,
    autoLoad: false,
    renderImpl: () => {},
    fetchImpl: async (url, init) => {
      const call = { url, body: JSON.parse(init.body) };
      calls.push(call);
      return responder(call);
    },
    ...overrides
  });
  return { widget, calls };
}

const okJson = payload => ({ ok: true, status: 200, json: async () => payload });

test("drillDown posts the coordinate to the drill-down endpoint", async () => {
  const { widget, calls } = createWidget(() =>
    okJson({ records: [{ urun: "Lokum", tutar: 10000 }], totalCount: 1 }));

  const response = await widget.drillDown({
    rowPath: ["Lokum"],
    columnPath: ["2025"],
    valueKey: "tutar_sum"
  });

  assert.equal(calls[0].url, "/pivotforge/drill-down");
  assert.deepEqual(calls[0].body.rowPath, ["Lokum"]);
  assert.deepEqual(calls[0].body.columnPath, ["2025"]);
  assert.equal(calls[0].body.valueKey, "tutar_sum");
  assert.deepEqual(calls[0].body.rows, ["urun"]);
  assert.equal(response.totalCount, 1);
  widget.dispose();
});

test("drillDown is rejected when drill-down is disabled", async () => {
  const { widget } = createWidget(() => okJson({}), { allowDrillDown: false });

  await assert.rejects(
    () => widget.drillDown({ rowPath: ["Lokum"], columnPath: [] }),
    /allowDrillDown is disabled/
  );
  widget.dispose();
});

test("fieldValues asks the endpoint for one field and nothing else", async () => {
  const { widget, calls } = createWidget(() =>
    okJson({ field: "urun", values: ["Lokum"], totalCount: 1, truncated: false, limit: 1000 }));

  const response = await widget.fieldValues("urun");

  assert.equal(calls[0].url, "/pivotforge/field-values");
  assert.equal(calls[0].body.field, "urun");
  // The picker lists every value the field holds, so the pivot layout and the
  // filters already applied are deliberately absent from the request.
  assert.equal(calls[0].body.rows, undefined);
  assert.equal(calls[0].body.filters, undefined);
  assert.deepEqual(response.values, ["Lokum"]);
  widget.dispose();
});

test("fieldValues is rejected when filtering is disabled", async () => {
  const { widget } = createWidget(() => okJson({}), { allowFiltering: false });

  await assert.rejects(() => widget.fieldValues("urun"), /allowFiltering is disabled/);
  widget.dispose();
});

test("exportToExcel posts the rendered document model, not the pivot request", async () => {
  const exportModel = { title: "Pivot Tablo", rows: [{ cells: [{ text: "Ürün" }] }] };
  const { widget, calls } = createWidget(() => ({
    ok: true,
    status: 200,
    blob: async () => ({ size: 2048, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  }), { allowExcelExport: true });
  // The endpoint renders a table document, and the test helper's widget uses
  // renderImpl (no renderer), so a fake renderer stands in for the real one.
  const requested = [];
  widget.renderer = { getExcelExportModel: options => { requested.push(options); return exportModel; } };

  const { blob, fileName } = await widget.exportToExcel({ sheetName: "Pivot Tablo" });

  assert.equal(calls[0].url, "/pivotforge/excel");
  assert.deepEqual(calls[0].body, exportModel);
  assert.deepEqual(requested, [{ sheetName: "Pivot Tablo" }]);
  assert.equal(blob.size, 2048);
  assert.equal(fileName, null);
  widget.dispose();
});

test("exportToExcel throws when the widget has no renderer to export from", async () => {
  const { widget } = createWidget(() => okJson({}), { allowExcelExport: true });

  await assert.rejects(() => widget.exportToExcel(), /renderImpl/);
  widget.dispose();
});

test("exportToExcel throws when the renderer has nothing rendered yet", async () => {
  const { widget } = createWidget(() => okJson({}), { allowExcelExport: true });
  widget.renderer = { getExcelExportModel: () => null };

  await assert.rejects(() => widget.exportToExcel(), /no pivot table has been rendered/);
  widget.dispose();
});

test("exportToExcel is rejected when export is disabled", async () => {
  const { widget } = createWidget(() => okJson({}));

  await assert.rejects(() => widget.exportToExcel(), /allowExcelExport is disabled/);
  widget.dispose();
});

test("largeData refresh starts a session and renders the first page", async () => {
  const { widget, calls } = createWidget(call =>
    call.url.endsWith("/large/start")
      ? okJson({
          sessionId: "oturum-1",
          cacheHit: false,
          page: { offset: 0, pageSize: 40, totalRowCount: 5000, result: { cells: [] } }
        })
      : okJson({}),
    { largeData: true, pageSize: 40, sourceRowCount: 250000 });

  await widget.refresh();

  assert.equal(calls[0].url, "/pivotforge/large/start");
  assert.equal(calls[0].body.pageSize, 40);
  assert.equal(calls[0].body.sourceRowCount, 250000);
  assert.equal(widget.getState().sessionId, "oturum-1");
  assert.equal(widget.getState().totalRowCount, 5000);
  widget.dispose();
});

test("loadPage requests a page from the active session", async () => {
  const { widget, calls } = createWidget(call =>
    call.url.endsWith("/large/start")
      ? okJson({
          sessionId: "oturum-1",
          page: { offset: 0, pageSize: 40, totalRowCount: 5000, result: { cells: [] } }
        })
      : okJson({ offset: 40, pageSize: 40, totalRowCount: 5000, result: { cells: [] } }),
    { largeData: true });

  await widget.refresh();
  const page = await widget.loadPage(40);

  assert.equal(calls[1].url, "/pivotforge/large/page");
  assert.equal(calls[1].body.sessionId, "oturum-1");
  assert.equal(calls[1].body.offset, 40);
  assert.equal(page.offset, 40);
  widget.dispose();
});

test("an expired session restarts transparently on the next page request", async () => {
  let sessionGone = true;
  let startCount = 0;
  const { widget, calls } = createWidget(call => {
    if (call.url.endsWith("/large/start")) {
      startCount += 1;
      return okJson({
        sessionId: `oturum-${startCount}`,
        page: { offset: 0, pageSize: 40, totalRowCount: 5000, result: { cells: [] } }
      });
    }
    if (sessionGone) {
      sessionGone = false;
      return { ok: false, status: 410, json: async () => ({ message: "Oturum süresi doldu." }) };
    }
    return okJson({ offset: 40, pageSize: 40, totalRowCount: 5000, result: { cells: [] } });
  }, { largeData: true });

  await widget.refresh();
  const page = await widget.loadPage(40);

  // start, failed page, restart, retried page
  assert.equal(calls.length, 4);
  assert.equal(calls[2].url, "/pivotforge/large/start");
  assert.equal(calls[3].body.sessionId, "oturum-2");
  assert.equal(page.offset, 40);
  widget.dispose();
});

test("loadPage surfaces the underlying error when the session restart itself fails", async () => {
  let pageCallCount = 0;
  const { widget, calls } = createWidget(call => {
    if (call.url.endsWith("/large/start")) {
      // The very first start (from refresh()) succeeds; the restart triggered by
      // the expired-session retry fails, so sessionId never changes.
      if (calls.filter(c => c.url.endsWith("/large/start")).length === 1) {
        return okJson({
          sessionId: "oturum-1",
          page: { offset: 0, pageSize: 40, totalRowCount: 5000, result: { cells: [] } }
        });
      }
      return { ok: false, status: 500, json: async () => ({ message: "Sunucu hatasi." }) };
    }
    pageCallCount += 1;
    return { ok: false, status: 410, json: async () => ({ message: "Oturum süresi doldu." }) };
  }, { largeData: true });

  await widget.refresh();

  await assert.rejects(() => widget.loadPage(40), /Sunucu hatasi\./);

  // Only the first (expired) page request should have gone out; the retry never
  // fires because the restart failed and sessionId stayed the same.
  assert.equal(pageCallCount, 1);
  assert.equal(widget.getState().sessionId, "oturum-1");
  widget.dispose();
});

test("loadPage without an active session throws", async () => {
  const { widget } = createWidget(() => okJson({}), { largeData: true });

  await assert.rejects(() => widget.loadPage(40), /no active large-data session/);
  widget.dispose();
});

test("loadPage is rejected when largeData is disabled", async () => {
  const { widget } = createWidget(() => okJson({}));

  await assert.rejects(() => widget.loadPage(40), /largeData is disabled/);
  widget.dispose();
});
