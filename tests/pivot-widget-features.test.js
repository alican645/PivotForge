const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

const PivotForge = globalThis.PivotForge;

const fields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

function createContainer() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    replaceChildren() { this.children = []; },
    appendChild(node) { (this.children ??= []).push(node); return node; },
    children: []
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

test("exportToExcel posts the current request and returns a blob", async () => {
  const { widget, calls } = createWidget(() => ({
    ok: true,
    status: 200,
    blob: async () => ({ size: 2048, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  }), { allowExcelExport: true });

  await widget.refresh();
  const blob = await widget.exportToExcel();

  assert.equal(calls[1].url, "/pivotforge/excel");
  assert.deepEqual(calls[1].body.rows, ["urun"]);
  assert.equal(blob.size, 2048);
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
  const { widget, calls } = createWidget(call => {
    if (call.url.endsWith("/large/start")) {
      return okJson({
        sessionId: "oturum-2",
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
  assert.equal(page.offset, 40);
  widget.dispose();
});

test("loadPage without an active session throws", async () => {
  const { widget } = createWidget(() => okJson({}), { largeData: true });

  await assert.rejects(() => widget.loadPage(40), /no active large-data session/);
  widget.dispose();
});
