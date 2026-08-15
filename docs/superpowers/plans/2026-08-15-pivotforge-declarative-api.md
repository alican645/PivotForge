# PivotForge Declarative API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a consumer place a working interactive pivot table with one JavaScript call or one Razor helper, instead of hand-wiring a renderer, a request, and fetch calls.

**Architecture:** Three layers. The existing engine, endpoints, and `PivotTableRenderer` are untouched. A new browser widget (`PivotForge.create`) translates a flat field list into a `PivotRequest`, calls the endpoints, and drives the renderer. A new Razor builder (`Html.PivotForge().PivotGrid()`) emits a container plus the same field configuration as JSON — it performs no pivot logic, so the field-to-request translation exists in exactly one place.

**Tech Stack:** .NET 8 (`net8.0`), ASP.NET Core Razor Class Library, xUnit, browser-native JavaScript (no framework, no jQuery), `node --test` for JS tests.

**Spec:** `docs/superpowers/specs/2026-08-15-pivotforge-declarative-api-design.md`

## Global Constraints

- Target framework stays `net8.0`. Do not add package references to either `src` project; both packages remain dependency-light.
- `TreatWarningsAsErrors` is on. A build warning fails the build.
- `GenerateDocumentationFile` is on. Every new public C# member needs an XML doc comment or the build fails.
- No jQuery, no external JS library. Browser code uses native DOM APIs only.
- JS modules follow the existing pattern exactly: an IIFE taking `typeof window !== "undefined" ? window : globalThis`, attaching to `root.PivotForge ??= {}`, and ending with a `module.exports` guard for `node --test`.
- Client-side aggregation is out of scope. All pivot computation happens server-side through existing endpoints.
- Everything is additive. No existing public member changes signature or behavior.
- Enums cross the wire as strings (`JsonStringEnumConverter` is registered in `PivotForgeServiceCollectionExtensions.cs:71`). JSON property names are camelCase.
- Commit messages are Turkish and descriptive, following the repository's existing style.

---

### Task 1: Field-to-request translation

The pure function at the center of the design. It takes the declarative field list and produces the `PivotForgeRequest` body the `/pivot` endpoint already accepts. No DOM, no network — which is what makes it cheap to test exhaustively.

**Files:**
- Create: `src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js`
- Test: `tests/pivot-request-builder.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PivotForge.PivotRequestBuilder`, an object with two functions.
  - `normalizeFields(fields)` → array of normalized field objects `{ dataField, area, caption, aggregation, showAs, format, visible }`. Throws `Error` on invalid input.
  - `buildRequest(fields, extras)` → `{ rows, columns, values, filters, rowSort }` where `values` entries are `{ field, aggregation, showAs }`. `extras` is `{ filters, rowSort }` and may be omitted.
  - `valueKey(field)` → `string`, matching the C# `PivotValueDefinition.Key` format of `` `${dataField}_${aggregation.toLowerCase()}` ``.

- [ ] **Step 1: Write the failing test**

Create `tests/pivot-request-builder.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const PivotRequestBuilder = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");

const salesFields = [
  { caption: "Ürün", dataField: "urun", area: "row" },
  { caption: "Yıl", dataField: "yil", area: "column" },
  { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
];

test("builds rows, columns, and values from areas", () => {
  const request = PivotRequestBuilder.buildRequest(salesFields);

  assert.deepEqual(request.rows, ["urun"]);
  assert.deepEqual(request.columns, ["yil"]);
  assert.deepEqual(request.values, [
    { field: "tutar", aggregation: "sum", showAs: "normal" }
  ]);
  assert.deepEqual(request.filters, []);
  assert.equal(request.rowSort, null);
});

test("preserves declaration order across multiple row and column fields", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "bolge", area: "row" },
    { dataField: "urun", area: "row" },
    { dataField: "yil", area: "column" },
    { dataField: "ay", area: "column" },
    { dataField: "tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["bolge", "urun"]);
  assert.deepEqual(request.columns, ["yil", "ay"]);
});

test("defaults data field aggregation to sum and showAs to normal", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "tutar", area: "data" }
  ]);

  assert.deepEqual(request.values, [
    { field: "tutar", aggregation: "sum", showAs: "normal" }
  ]);
});

test("supports every aggregation and showAs value", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "a", area: "data", aggregation: "count" },
    { dataField: "b", area: "data", aggregation: "average" },
    { dataField: "c", area: "data", aggregation: "min" },
    { dataField: "d", area: "data", aggregation: "max" },
    { dataField: "e", area: "data", aggregation: "sum", showAs: "percentOfRowTotal" },
    { dataField: "f", area: "data", aggregation: "sum", showAs: "runningTotal" }
  ]);

  assert.deepEqual(request.values.map(value => value.aggregation), [
    "count", "average", "min", "max", "sum", "sum"
  ]);
  assert.equal(request.values[4].showAs, "percentOfRowTotal");
  assert.equal(request.values[5].showAs, "runningTotal");
});

test("filter fields do not enter rows, columns, or values", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "tutar", area: "data", aggregation: "sum" },
    { dataField: "bolge", area: "filter" }
  ]);

  assert.deepEqual(request.rows, ["urun"]);
  assert.deepEqual(request.columns, []);
  assert.equal(request.values.length, 1);
});

test("passes through supplied filters and row sort", () => {
  const rowSort = { mode: "rowLabel", direction: "ascending", field: "urun" };
  const request = PivotRequestBuilder.buildRequest(salesFields, {
    filters: [{ field: "bolge", values: ["Kuzey"] }],
    rowSort
  });

  assert.deepEqual(request.filters, [{ field: "bolge", values: ["Kuzey"] }]);
  assert.deepEqual(request.rowSort, rowSort);
});

test("excludes invisible fields from the request", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "gizli", area: "row", visible: false },
    { dataField: "tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request.rows, ["urun"]);
});

test("value key matches the server key format", () => {
  const [field] = PivotRequestBuilder.normalizeFields([
    { dataField: "tutar", area: "data", aggregation: "average" }
  ]);

  assert.equal(PivotRequestBuilder.valueKey(field), "tutar_average");
});

test("normalize defaults caption to the data field name", () => {
  const [field] = PivotRequestBuilder.normalizeFields([
    { dataField: "tutar", area: "data" }
  ]);

  assert.equal(field.caption, "tutar");
});

test("rejects a configuration without a data field", () => {
  assert.throws(
    () => PivotRequestBuilder.buildRequest([{ dataField: "urun", area: "row" }]),
    /at least one field with area "data"/
  );
});

test("rejects an unknown area", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ dataField: "urun", area: "rows" }]),
    /Unknown area "rows"/
  );
});

test("rejects an aggregation on a non-data field", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "urun", area: "row", aggregation: "sum" }
    ]),
    /only valid on a "data" field/
  );
});

test("rejects an unknown aggregation", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "tutar", area: "data", aggregation: "median" }
    ]),
    /Unknown aggregation "median"/
  );
});

test("rejects a field without a data field name", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ area: "row" }]),
    /requires a non-empty "dataField"/
  );
});

test("rejects a non-array field list", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields("urun"),
    /"fields" must be an array/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-request-builder.test.js`
Expected: FAIL — `Cannot find module '../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js'`

- [ ] **Step 3: Write the implementation**

Create `src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js`:

```js
(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AREAS = ["row", "column", "data", "filter"];
  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];
  const SHOW_AS = [
    "normal",
    "percentOfRowTotal",
    "percentOfColumnTotal",
    "percentOfGrandTotal",
    "differenceFromPrevious",
    "percentDifferenceFromPrevious",
    "runningTotal"
  ];

  function normalizeField(field, index) {
    if (!field || typeof field !== "object") {
      throw new Error(`Field at index ${index} must be an object.`);
    }

    const dataField = field.dataField;
    if (typeof dataField !== "string" || dataField.trim() === "") {
      throw new Error(`Field at index ${index} requires a non-empty "dataField".`);
    }

    const area = field.area ?? "data";
    if (!AREAS.includes(area)) {
      throw new Error(
        `Unknown area "${area}" on field "${dataField}". Expected one of: ${AREAS.join(", ")}.`
      );
    }

    const isData = area === "data";
    if (!isData && field.aggregation !== undefined) {
      throw new Error(
        `"aggregation" is only valid on a "data" field, but was set on "${dataField}" in area "${area}".`
      );
    }

    const aggregation = isData ? field.aggregation ?? "sum" : null;
    if (isData && !AGGREGATIONS.includes(aggregation)) {
      throw new Error(
        `Unknown aggregation "${aggregation}" on field "${dataField}". Expected one of: ${AGGREGATIONS.join(", ")}.`
      );
    }

    const showAs = isData ? field.showAs ?? "normal" : null;
    if (isData && !SHOW_AS.includes(showAs)) {
      throw new Error(
        `Unknown showAs "${showAs}" on field "${dataField}". Expected one of: ${SHOW_AS.join(", ")}.`
      );
    }

    return {
      dataField,
      area,
      caption: field.caption ?? dataField,
      aggregation,
      showAs,
      format: field.format ?? null,
      visible: field.visible !== false
    };
  }

  function normalizeFields(fields) {
    if (!Array.isArray(fields)) {
      throw new Error('"fields" must be an array.');
    }

    return fields.map(normalizeField);
  }

  function valueKey(field) {
    return `${field.dataField}_${String(field.aggregation).toLowerCase()}`;
  }

  function buildRequest(fields, extras = {}) {
    const normalized = normalizeFields(fields).filter(field => field.visible);
    const inArea = area => normalized.filter(field => field.area === area);
    const values = inArea("data");

    if (values.length === 0) {
      throw new Error('A pivot configuration requires at least one field with area "data".');
    }

    return {
      rows: inArea("row").map(field => field.dataField),
      columns: inArea("column").map(field => field.dataField),
      values: values.map(field => ({
        field: field.dataField,
        aggregation: field.aggregation,
        showAs: field.showAs
      })),
      filters: extras.filters ?? [],
      rowSort: extras.rowSort ?? null
    };
  }

  PivotForge.PivotRequestBuilder = { normalizeFields, buildRequest, valueKey };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge.PivotRequestBuilder;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pivot-request-builder.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/pivot-request-builder.test.js src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js
git commit -m "feat(widget): alan modelinden pivot istegi olusturan cevirici eklendi"
```

---

### Task 2: Widget core — create, load, render, dispose

The orchestrator. It owns the renderer, calls `/pivot`, and manages lifecycle. Sorting, drill-down, and Excel arrive in later tasks; this task delivers a widget that renders data and cleans up after itself.

The fetch function is injected via an internal `fetchImpl` option so tests can drive it without a network or a DOM server. Production callers never pass it.

**Files:**
- Create: `src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js`
- Test: `tests/pivot-widget.test.js`

**Interfaces:**
- Consumes: `PivotForge.PivotRequestBuilder.buildRequest`, `normalizeFields` (Task 1).
- Produces:
  - `PivotForge.create(target, options)` → `PivotWidget` instance. `target` is an `Element` or a selector string.
  - `PivotForge.PivotWidget` class with `refresh()` → `Promise<void>`, `updateFields(fields)` → `Promise<void>`, `getState()` → `{ fields, request, result, error, loading }`, `dispose()` → `void`.
  - Events via `on(eventName, handler)` → unsubscribe function. Event names: `dataLoading`, `dataLoaded`, `error`.
  - Options: `fields`, `endpointPrefix` (default `"/pivotforge"`), `rendererOptions`, `fetchImpl` (internal), plus flags consumed in later tasks.

- [ ] **Step 1: Write the failing test**

Create `tests/pivot-widget.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js");

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
  const { widget, rendered } = createWidget({
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-widget.test.js`
Expected: FAIL — `Cannot find module '.../pivot-widget.js'`

- [ ] **Step 3: Write the implementation**

Create `src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js`:

```js
(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const DEFAULTS = {
    endpointPrefix: "/pivotforge",
    autoLoad: true,
    allowSorting: true,
    allowFiltering: true,
    allowDrillDown: true,
    allowExcelExport: false,
    largeData: false,
    pageSize: 40,
    sourceRowCount: 100000,
    rendererOptions: null,
    fetchImpl: null,
    renderImpl: null
  };

  function resolveTarget(target) {
    if (typeof target === "string") {
      const found = root.document?.querySelector(target);
      if (!found) {
        throw new Error(`PivotForge.create could not find an element matching "${target}".`);
      }
      return found;
    }

    if (!target) {
      throw new Error("PivotForge.create requires a target element or selector.");
    }

    return target;
  }

  function normalizePrefix(prefix) {
    const trimmed = String(prefix ?? "").trim();
    const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
  }

  class PivotWidget {
    constructor(container, options) {
      this.container = container;
      this.options = { ...DEFAULTS, ...options };
      this.endpointPrefix = normalizePrefix(this.options.endpointPrefix);
      this.handlers = new Map();
      this.disposed = false;
      this.loading = false;
      this.result = null;
      this.error = null;
      this.request = null;
      this.controller = null;
      this.requestToken = 0;

      // Validate eagerly so configuration mistakes surface at the call site.
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields ?? []);
      PivotForge.PivotRequestBuilder.buildRequest(this.options.fields ?? []);

      this.renderer = this.options.renderImpl ? null : this.createRenderer();
    }

    createRenderer() {
      const Renderer = PivotForge.PivotTableRenderer;
      if (!Renderer) {
        throw new Error(
          "PivotForge.PivotTableRenderer is not loaded. Reference pivot-table.js before pivot-widget.js."
        );
      }

      const rowFields = this.fields.filter(field => field.visible && field.area === "row");

      return new Renderer(this.container, {
        rowFields: rowFields.map(field => field.dataField),
        rowFieldLabels: rowFields.map(field => field.caption),
        ...(this.options.rendererOptions ?? {})
      });
    }

    on(eventName, handler) {
      if (typeof handler !== "function") {
        throw new Error(`Handler for "${eventName}" must be a function.`);
      }

      const handlers = this.handlers.get(eventName) ?? new Set();
      handlers.add(handler);
      this.handlers.set(eventName, handlers);
      return () => handlers.delete(handler);
    }

    emit(eventName, payload) {
      this.handlers.get(eventName)?.forEach(handler => handler(payload));
    }

    getState() {
      return {
        fields: this.fields,
        request: this.request,
        result: this.result,
        error: this.error,
        loading: this.loading
      };
    }

    buildRequest() {
      return PivotForge.PivotRequestBuilder.buildRequest(this.options.fields, {
        filters: this.options.filters,
        rowSort: this.rowSort ?? null
      });
    }

    async post(route, body, signal) {
      const fetchImpl = this.options.fetchImpl ?? root.fetch?.bind(root);
      const response = await fetchImpl(`${this.endpointPrefix}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? `Request failed with status ${response.status}.`);
      }

      return payload;
    }

    async refresh() {
      if (this.disposed) {
        throw new Error("This PivotForge widget has been disposed.");
      }

      this.controller?.abort();
      const controller = new AbortController();
      this.controller = controller;
      const token = ++this.requestToken;

      this.loading = true;
      this.error = null;
      this.request = this.buildRequest();
      this.emit("dataLoading", { request: this.request });

      try {
        const result = await this.post("/pivot", this.request, controller.signal);
        if (token !== this.requestToken || this.disposed) {
          return;
        }

        this.loading = false;
        this.result = result;
        this.render(result);
        this.emit("dataLoaded", { result });
      } catch (error) {
        if (error?.name === "AbortError" || token !== this.requestToken || this.disposed) {
          return;
        }

        this.loading = false;
        this.error = error;
        this.showError(error);
        this.emit("error", error);
      }
    }

    render(result) {
      if (this.options.renderImpl) {
        this.options.renderImpl(result);
        return;
      }

      this.renderer.render(result);
    }

    showError(error) {
      // Keep any previously rendered table visible; surface the message beside it.
      const document = root.document;
      if (!document) {
        return;
      }

      this.errorNode?.remove();
      const node = document.createElement("div");
      node.className = "pivot-error";
      node.setAttribute("role", "alert");
      node.textContent = error.message;
      this.errorNode = node;
      this.container.appendChild(node);
    }

    async updateFields(fields) {
      PivotForge.PivotRequestBuilder.buildRequest(fields);
      this.options.fields = fields;
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(fields);
      if (this.renderer) {
        this.renderer = this.createRenderer();
      }
      await this.refresh();
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.requestToken++;
      this.controller?.abort();
      this.controller = null;
      this.handlers.clear();
      this.errorNode = null;
      this.container.replaceChildren();
      this.container.classList.remove("pivot-table");
    }
  }

  PivotForge.PivotWidget = PivotWidget;

  PivotForge.create = function create(target, options = {}) {
    const widget = new PivotWidget(resolveTarget(target), options);
    if (widget.options.autoLoad) {
      widget.refresh();
    }
    return widget;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { create: PivotForge.create, PivotWidget };
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pivot-widget.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the full JS suite to confirm nothing regressed**

Run: `node --test tests/*.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add tests/pivot-widget.test.js src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js
git commit -m "feat(widget): veri yukleme ve render orkestrasyonu yapan widget cekirdegi eklendi"
```

---

### Task 3: Sorting and filtering

Wires the renderer's existing `onSortRequested` callback into a refresh, and adds filter state that feeds `PivotRequest.Filters`. Both are gated by the `allowSorting` and `allowFiltering` flags.

**Files:**
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js`
- Test: `tests/pivot-widget-interaction.test.js`

**Interfaces:**
- Consumes: `PivotWidget` (Task 2). Sort objects use `PivotRequestBuilder.valueKey(field)` format for their `valueKey` member.
- Produces: on `PivotWidget` —
  - `sortBy(sort)` → `Promise<void>`, where `sort` is `{ mode, direction, field?, valueKey?, columnPath? }`.
  - `setFilter(field, values)` → `Promise<void>`; passing `null` or `[]` clears that field's filter.
  - `clearFilters()` → `Promise<void>`.
  - `getState()` gains `filters` (array) and `rowSort` (object or `null`).

- [ ] **Step 1: Write the failing test**

Create `tests/pivot-widget-interaction.test.js`:

```js
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

  assert.deepEqual(calls[0].filters, [{ field: "urun", values: ["Lokum", "Helva"] }]);
  widget.dispose();
});

test("setFilter replaces an existing filter on the same field", async () => {
  const { widget, calls } = createWidget();

  await widget.setFilter("urun", ["Lokum"]);
  await widget.setFilter("urun", ["Helva"]);

  assert.deepEqual(calls[1].filters, [{ field: "urun", values: ["Helva"] }]);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-widget-interaction.test.js`
Expected: FAIL — `widget.sortBy is not a function`

- [ ] **Step 3: Add filter and sort state to the constructor**

In `pivot-widget.js`, inside `constructor`, immediately after `this.requestToken = 0;` add:

```js
      this.filters = [...(this.options.filters ?? [])];
      this.rowSort = this.options.rowSort ?? null;
```

- [ ] **Step 4: Make buildRequest and getState use that state**

Replace the `buildRequest` method body with:

```js
    buildRequest() {
      return PivotForge.PivotRequestBuilder.buildRequest(this.options.fields, {
        filters: this.filters,
        rowSort: this.rowSort
      });
    }
```

In `getState`, add `filters: [...this.filters],` and `rowSort: this.rowSort,` to the returned object.

- [ ] **Step 5: Add the interaction methods**

In `pivot-widget.js`, add these methods to `PivotWidget` immediately before `dispose()`:

```js
    async sortBy(sort) {
      if (!this.options.allowSorting) {
        throw new Error("Cannot sort because allowSorting is disabled.");
      }

      this.rowSort = sort;
      await this.refresh();
    }

    async setFilter(field, values) {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      this.filters = this.filters.filter(filter => filter.field !== field);
      if (Array.isArray(values) && values.length > 0) {
        this.filters.push({ field, values });
      }

      await this.refresh();
    }

    async clearFilters() {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      this.filters = [];
      await this.refresh();
    }
```

- [ ] **Step 6: Wire the renderer sort callback**

In `createRenderer`, replace the `return new Renderer(...)` statement with:

```js
      return new Renderer(this.container, {
        rowFields: rowFields.map(field => field.dataField),
        rowFieldLabels: rowFields.map(field => field.caption),
        onSortRequested: this.options.allowSorting
          ? request => { this.sortBy(request); }
          : null,
        ...(this.options.rendererOptions ?? {})
      });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/pivot-widget-interaction.test.js tests/pivot-widget.test.js`
Expected: PASS, 21 tests.

- [ ] **Step 8: Commit**

```bash
git add tests/pivot-widget-interaction.test.js src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js
git commit -m "feat(widget): siralama ve filtreleme etkilesimleri baglandi"
```

---

### Task 4: Drill-down, Excel export, and large-result paging

The three server-backed features. Each is opt-in and each maps to an endpoint that already exists.

**Files:**
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js`
- Test: `tests/pivot-widget-features.test.js`

**Interfaces:**
- Consumes: `PivotWidget` (Tasks 2-3), `PivotForge.PivotVirtualDataSource` (existing, `pivot-virtual-data-source.js`).
- Produces: on `PivotWidget` —
  - `drillDown({ rowPath, columnPath, valueKey })` → `Promise<{ records, totalCount }>`.
  - `exportToExcel()` → `Promise<Blob>`.
  - When `largeData` is `true`, `refresh()` routes through `/large/start` instead of `/pivot`, and `loadPage(offset)` → `Promise<object>` becomes available.

- [ ] **Step 1: Write the failing test**

Create `tests/pivot-widget-features.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-widget-features.test.js`
Expected: FAIL — `widget.drillDown is not a function`

- [ ] **Step 3: Track session state in the constructor**

In `pivot-widget.js`, in `constructor`, after the `this.rowSort = ...` line added in Task 3, add:

```js
      this.sessionId = null;
      this.totalRowCount = 0;
```

In `getState`, add `sessionId: this.sessionId,` and `totalRowCount: this.totalRowCount,` to the returned object.

- [ ] **Step 4: Route refresh through the large-data endpoint**

In `refresh()`, replace the line `const result = await this.post("/pivot", this.request, controller.signal);` with:

```js
        const result = this.options.largeData
          ? await this.startLargeSession(controller.signal)
          : await this.post("/pivot", this.request, controller.signal);
```

- [ ] **Step 5: Add the feature methods**

In `pivot-widget.js`, add these methods to `PivotWidget` immediately before `sortBy`:

```js
    async startLargeSession(signal) {
      const response = await this.post("/large/start", {
        ...this.request,
        pageSize: this.options.pageSize,
        sourceRowCount: this.options.sourceRowCount
      }, signal);

      this.sessionId = response.sessionId;
      this.totalRowCount = response.page?.totalRowCount ?? 0;
      this.currentPage = response.page;
      return response.page?.result ?? null;
    }

    async loadPage(offset) {
      if (!this.options.largeData) {
        throw new Error("Cannot load a page because largeData is disabled.");
      }

      if (!this.sessionId) {
        throw new Error("Cannot load a page because there is no active large-data session.");
      }

      const body = { sessionId: this.sessionId, offset, pageSize: this.options.pageSize };

      try {
        return await this.postPage(body);
      } catch (error) {
        // An expired session is recoverable: start a new one and retry once.
        if (error.status !== 410) {
          throw error;
        }

        await this.refresh();
        return await this.postPage({ ...body, sessionId: this.sessionId });
      }
    }

    async postPage(body) {
      const page = await this.post("/large/page", body);
      this.currentPage = page;
      this.totalRowCount = page.totalRowCount ?? this.totalRowCount;
      if (page.result) {
        this.result = page.result;
        this.render(page.result);
      }
      return page;
    }

    async drillDown({ rowPath = [], columnPath = [], valueKey = null } = {}) {
      if (!this.options.allowDrillDown) {
        throw new Error("Cannot drill down because allowDrillDown is disabled.");
      }

      return await this.post("/drill-down", {
        ...this.buildRequest(),
        rowPath,
        columnPath,
        valueKey,
        sourceRowCount: this.options.sourceRowCount
      });
    }

    async exportToExcel() {
      if (!this.options.allowExcelExport) {
        throw new Error("Cannot export because allowExcelExport is disabled.");
      }

      const fetchImpl = this.options.fetchImpl ?? root.fetch?.bind(root);
      const response = await fetchImpl(`${this.endpointPrefix}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequest())
      });

      if (!response.ok) {
        throw new Error(`Excel export failed with status ${response.status}.`);
      }

      return await response.blob();
    }
```

- [ ] **Step 6: Carry the status code on thrown errors**

In `post()`, replace the `throw new Error(...)` line with:

```js
      if (!response.ok) {
        const error = new Error(payload?.message ?? `Request failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/pivot-widget-features.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 8: Run the full JS suite**

Run: `node --test tests/*.test.js`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add tests/pivot-widget-features.test.js src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js
git commit -m "feat(widget): detaya inme, Excel disa aktarma ve buyuk veri sayfalama eklendi"
```

---

### Task 5: Razor field builders

The C# side of the field model. These types only collect configuration; the JSON they produce is consumed by Task 1's translator, so no pivot logic lives here.

`PivotArea` is new. `PivotAggregation` and `PivotShowAs` are reused from `PivotForge.Core` rather than redefined.

**Files:**
- Create: `src/PivotForge.AspNetCore/Rendering/PivotArea.cs`
- Create: `src/PivotForge.AspNetCore/Rendering/PivotFieldBuilder.cs`
- Create: `src/PivotForge.AspNetCore/Rendering/PivotFieldCollectionBuilder.cs`
- Test: `tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs`

**Interfaces:**
- Consumes: `PivotForge.Core.PivotAggregation`, `PivotForge.Core.PivotShowAs`.
- Produces:
  - `enum PivotArea { Row, Column, Data, Filter }`
  - `sealed class PivotFieldBuilder` with fluent methods `DataField(string)`, `Caption(string)`, `Area(PivotArea)`, `Aggregation(PivotAggregation)`, `ShowAs(PivotShowAs)`, `Format(string)`, `Visible(bool)`, each returning `PivotFieldBuilder`; and `IDictionary<string, object?> Build()`.
  - `sealed class PivotFieldCollectionBuilder` with `PivotFieldBuilder Add()` and `IReadOnlyList<IDictionary<string, object?>> Build()`.

Camel-cased JSON keys are produced by `Build()` directly (`dataField`, `area`, `caption`, `aggregation`, `showAs`, `format`, `visible`), so the emitted payload matches the JavaScript field model exactly. Enum values are lower-camel strings (`"row"`, `"sum"`, `"percentOfRowTotal"`).

- [ ] **Step 1: Write the failing test**

Create `tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs`:

```csharp
using PivotForge.AspNetCore.Rendering;
using PivotForge.Core;
using Xunit;

namespace PivotForge.AspNetCore.Tests;

public class PivotFieldBuilderTests
{
    [Fact]
    public void BuildProducesCamelCaseKeysMatchingTheJavaScriptModel()
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Caption("Tutar")
            .Area(PivotArea.Data)
            .Aggregation(PivotAggregation.Sum)
            .Build();

        Assert.Equal("tutar", field["dataField"]);
        Assert.Equal("Tutar", field["caption"]);
        Assert.Equal("data", field["area"]);
        Assert.Equal("sum", field["aggregation"]);
    }

    [Fact]
    public void AreaDefaultsToData()
    {
        var field = new PivotFieldBuilder().DataField("tutar").Build();

        Assert.Equal("data", field["area"]);
    }

    [Fact]
    public void CaptionDefaultsToTheDataFieldName()
    {
        var field = new PivotFieldBuilder().DataField("tutar").Build();

        Assert.Equal("tutar", field["caption"]);
    }

    [Theory]
    [InlineData(PivotArea.Row, "row")]
    [InlineData(PivotArea.Column, "column")]
    [InlineData(PivotArea.Data, "data")]
    [InlineData(PivotArea.Filter, "filter")]
    public void EveryAreaSerializesAsLowerCamelCase(PivotArea area, string expected)
    {
        var field = new PivotFieldBuilder().DataField("alan").Area(area).Build();

        Assert.Equal(expected, field["area"]);
    }

    [Theory]
    [InlineData(PivotAggregation.Sum, "sum")]
    [InlineData(PivotAggregation.Count, "count")]
    [InlineData(PivotAggregation.Average, "average")]
    [InlineData(PivotAggregation.Min, "min")]
    [InlineData(PivotAggregation.Max, "max")]
    public void EveryAggregationSerializesAsLowerCamelCase(PivotAggregation aggregation, string expected)
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Area(PivotArea.Data)
            .Aggregation(aggregation)
            .Build();

        Assert.Equal(expected, field["aggregation"]);
    }

    [Fact]
    public void ShowAsSerializesAsLowerCamelCase()
    {
        var field = new PivotFieldBuilder()
            .DataField("tutar")
            .Area(PivotArea.Data)
            .ShowAs(PivotShowAs.PercentOfRowTotal)
            .Build();

        Assert.Equal("percentOfRowTotal", field["showAs"]);
    }

    [Fact]
    public void OptionalMembersAreOmittedWhenUnset()
    {
        var field = new PivotFieldBuilder().DataField("urun").Area(PivotArea.Row).Build();

        Assert.False(field.ContainsKey("aggregation"));
        Assert.False(field.ContainsKey("showAs"));
        Assert.False(field.ContainsKey("format"));
        Assert.False(field.ContainsKey("visible"));
    }

    [Fact]
    public void VisibleIsEmittedOnlyWhenFalse()
    {
        var hidden = new PivotFieldBuilder().DataField("urun").Visible(false).Build();
        var shown = new PivotFieldBuilder().DataField("urun").Visible(true).Build();

        Assert.Equal(false, hidden["visible"]);
        Assert.False(shown.ContainsKey("visible"));
    }

    [Fact]
    public void BuildWithoutADataFieldThrows()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder().Caption("Tutar").Build());

        Assert.Contains("DataField", exception.Message);
    }

    [Fact]
    public void CollectionBuilderPreservesDeclarationOrder()
    {
        var fields = new PivotFieldCollectionBuilder();
        fields.Add().DataField("bolge").Area(PivotArea.Row);
        fields.Add().DataField("urun").Area(PivotArea.Row);
        fields.Add().DataField("tutar").Area(PivotArea.Data).Aggregation(PivotAggregation.Sum);

        var built = fields.Build();

        Assert.Equal(3, built.Count);
        Assert.Equal("bolge", built[0]["dataField"]);
        Assert.Equal("urun", built[1]["dataField"]);
        Assert.Equal("tutar", built[2]["dataField"]);
    }

    [Fact]
    public void FluentMethodsReturnTheSameBuilderInstance()
    {
        var builder = new PivotFieldBuilder();

        Assert.Same(builder, builder.DataField("tutar"));
        Assert.Same(builder, builder.Caption("Tutar"));
        Assert.Same(builder, builder.Area(PivotArea.Data));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: FAIL — compile error, `PivotForge.AspNetCore.Rendering` does not exist.

- [ ] **Step 3: Create the area enum**

Create `src/PivotForge.AspNetCore/Rendering/PivotArea.cs`:

```csharp
namespace PivotForge.AspNetCore.Rendering;

/// <summary>Specifies where a field is placed in a pivot grid layout.</summary>
public enum PivotArea
{
    /// <summary>Places the field on the row axis.</summary>
    Row,
    /// <summary>Places the field on the column axis.</summary>
    Column,
    /// <summary>Aggregates the field as a pivot value.</summary>
    Data,
    /// <summary>Exposes the field for filtering without placing it in the layout.</summary>
    Filter
}
```

- [ ] **Step 4: Create the field builder**

Create `src/PivotForge.AspNetCore/Rendering/PivotFieldBuilder.cs`:

```csharp
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Configures a single pivot grid field.</summary>
public sealed class PivotFieldBuilder
{
    private string? _dataField;
    private string? _caption;
    private PivotArea _area = PivotArea.Data;
    private PivotAggregation? _aggregation;
    private PivotShowAs? _showAs;
    private string? _format;
    private bool _visible = true;

    /// <summary>Sets the source field name.</summary>
    /// <param name="dataField">The source field name.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder DataField(string dataField)
    {
        _dataField = dataField;
        return this;
    }

    /// <summary>Sets the display caption.</summary>
    /// <param name="caption">The caption shown to users.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Caption(string caption)
    {
        _caption = caption;
        return this;
    }

    /// <summary>Sets the layout area.</summary>
    /// <param name="area">The area that receives this field.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Area(PivotArea area)
    {
        _area = area;
        return this;
    }

    /// <summary>Sets the aggregation applied to a data field.</summary>
    /// <param name="aggregation">The aggregation to apply.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Aggregation(PivotAggregation aggregation)
    {
        _aggregation = aggregation;
        return this;
    }

    /// <summary>Sets the secondary calculation applied to a data field.</summary>
    /// <param name="showAs">The secondary calculation.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder ShowAs(PivotShowAs showAs)
    {
        _showAs = showAs;
        return this;
    }

    /// <summary>Sets the browser number format applied to this field's values.</summary>
    /// <param name="format">A format identifier understood by the browser renderer.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Format(string format)
    {
        _format = format;
        return this;
    }

    /// <summary>Sets whether the field participates in the rendered layout.</summary>
    /// <param name="visible">True to include the field; false to configure it while hidden.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Visible(bool visible)
    {
        _visible = visible;
        return this;
    }

    /// <summary>Builds the browser field configuration.</summary>
    /// <returns>A dictionary matching the JavaScript field model.</returns>
    /// <exception cref="InvalidOperationException">No data field was supplied.</exception>
    public IDictionary<string, object?> Build()
    {
        if (string.IsNullOrWhiteSpace(_dataField))
        {
            throw new InvalidOperationException(
                "A pivot field requires DataField to be set before it can be rendered.");
        }

        var field = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["dataField"] = _dataField,
            ["caption"] = _caption ?? _dataField,
            ["area"] = ToCamelCase(_area.ToString())
        };

        if (_aggregation is { } aggregation)
        {
            field["aggregation"] = ToCamelCase(aggregation.ToString());
        }

        if (_showAs is { } showAs)
        {
            field["showAs"] = ToCamelCase(showAs.ToString());
        }

        if (_format is not null)
        {
            field["format"] = _format;
        }

        if (!_visible)
        {
            field["visible"] = false;
        }

        return field;
    }

    private static string ToCamelCase(string value) =>
        string.Concat(char.ToLowerInvariant(value[0]), value[1..]);
}
```

- [ ] **Step 5: Create the collection builder**

Create `src/PivotForge.AspNetCore/Rendering/PivotFieldCollectionBuilder.cs`:

```csharp
namespace PivotForge.AspNetCore.Rendering;

/// <summary>Collects the fields of a pivot grid in declaration order.</summary>
public sealed class PivotFieldCollectionBuilder
{
    private readonly List<PivotFieldBuilder> _fields = [];

    /// <summary>Adds a field and returns its builder.</summary>
    /// <returns>The builder for the added field.</returns>
    public PivotFieldBuilder Add()
    {
        var field = new PivotFieldBuilder();
        _fields.Add(field);
        return field;
    }

    /// <summary>Builds every configured field.</summary>
    /// <returns>The field configurations in declaration order.</returns>
    public IReadOnlyList<IDictionary<string, object?>> Build() =>
        _fields.Select(field => field.Build()).ToList();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: PASS. 7 pre-existing tests plus the new ones, 0 failures, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/PivotForge.AspNetCore/Rendering tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs
git commit -m "feat(razor): pivot alan olusturucu siniflari eklendi"
```

---

### Task 6: Razor grid builder and HTML helper

Emits the container and the configuration. Configuration travels in a `<script type="application/json">` block rather than an inline call argument, so a strict CSP without `unsafe-inline` stays workable and captions containing quotes cannot break out.

**Files:**
- Create: `src/PivotForge.AspNetCore/Rendering/PivotGridBuilder.cs`
- Create: `src/PivotForge.AspNetCore/Rendering/PivotForgeFactory.cs`
- Create: `src/PivotForge.AspNetCore/Rendering/PivotForgeHtmlHelperExtensions.cs`
- Test: `tests/PivotForge.AspNetCore.Tests/PivotGridBuilderTests.cs`

**Interfaces:**
- Consumes: `PivotFieldCollectionBuilder`, `PivotFieldBuilder`, `PivotArea` (Task 5); the browser contract `PivotForge.create` (Task 2).
- Produces:
  - `sealed class PivotGridBuilder : IHtmlContent` with `Id(string)`, `Fields(Action<PivotFieldCollectionBuilder>)`, `EndpointPrefix(string)`, `AllowSorting(bool)`, `AllowFiltering(bool)`, `AllowDrillDown(bool)`, `AllowExcelExport(bool)`, `LargeData(bool)`, `PageSize(int)`, `SourceRowCount(int)`, `CssClass(string)` — each returning `PivotGridBuilder` — plus `WriteTo(TextWriter, HtmlEncoder)`.
  - `sealed class PivotForgeFactory` with `PivotGridBuilder PivotGrid()`.
  - `static class PivotForgeHtmlHelperExtensions` with `PivotForgeFactory PivotForge(this IHtmlHelper helper)`.

Rendered output, for id `pivotGrid`:

```html
<div id="pivotGrid" class="pivotforge-grid" data-pivotforge-config="pivotGrid-config"></div>
<script type="application/json" id="pivotGrid-config">{"fields":[...],"allowSorting":true}</script>
<script>PivotForge.create(document.getElementById("pivotGrid"), JSON.parse(document.getElementById("pivotGrid-config").textContent));</script>
```

- [ ] **Step 1: Write the failing test**

Create `tests/PivotForge.AspNetCore.Tests/PivotGridBuilderTests.cs`:

```csharp
using System.Text.Encodings.Web;
using System.Text.Json;
using PivotForge.AspNetCore.Rendering;
using PivotForge.Core;
using Xunit;

namespace PivotForge.AspNetCore.Tests;

public class PivotGridBuilderTests
{
    private static string Render(PivotGridBuilder builder)
    {
        using var writer = new StringWriter();
        builder.WriteTo(writer, HtmlEncoder.Default);
        return writer.ToString();
    }

    private static JsonElement ConfigOf(PivotGridBuilder builder)
    {
        var html = Render(builder);
        var start = html.IndexOf('{', html.IndexOf("application/json", StringComparison.Ordinal));
        var end = html.IndexOf("</script>", start, StringComparison.Ordinal);
        return JsonDocument.Parse(html[start..end]).RootElement;
    }

    private static PivotGridBuilder SalesGrid() =>
        new PivotGridBuilder()
            .Id("pivotGrid")
            .Fields(fields =>
            {
                fields.Add().Caption("Ürün").DataField("urun").Area(PivotArea.Row);
                fields.Add().Caption("Yıl").DataField("yil").Area(PivotArea.Column);
                fields.Add().Caption("Tutar").DataField("tutar")
                    .Aggregation(PivotAggregation.Sum).Area(PivotArea.Data);
            });

    [Fact]
    public void RendersAContainerCarryingTheSuppliedId()
    {
        var html = Render(SalesGrid());

        Assert.Contains("id=\"pivotGrid\"", html);
        Assert.Contains("class=\"pivotforge-grid\"", html);
    }

    [Fact]
    public void RendersConfigurationInAJsonScriptBlock()
    {
        var html = Render(SalesGrid());

        Assert.Contains("<script type=\"application/json\" id=\"pivotGrid-config\">", html);
    }

    [Fact]
    public void RendersAnInitializationCallReferencingBothElements()
    {
        var html = Render(SalesGrid());

        Assert.Contains("PivotForge.create(", html);
        Assert.Contains("document.getElementById(\"pivotGrid\")", html);
        Assert.Contains("document.getElementById(\"pivotGrid-config\")", html);
    }

    [Fact]
    public void ConfigurationCarriesFieldsInDeclarationOrder()
    {
        var fields = ConfigOf(SalesGrid()).GetProperty("fields");

        Assert.Equal(3, fields.GetArrayLength());
        Assert.Equal("urun", fields[0].GetProperty("dataField").GetString());
        Assert.Equal("row", fields[0].GetProperty("area").GetString());
        Assert.Equal("yil", fields[1].GetProperty("dataField").GetString());
        Assert.Equal("tutar", fields[2].GetProperty("dataField").GetString());
        Assert.Equal("sum", fields[2].GetProperty("aggregation").GetString());
    }

    [Fact]
    public void TurkishCaptionsSurviveSerializationUnescaped()
    {
        var fields = ConfigOf(SalesGrid()).GetProperty("fields");

        Assert.Equal("Ürün", fields[0].GetProperty("caption").GetString());
    }

    [Fact]
    public void OptionFlagsReachTheConfiguration()
    {
        var config = ConfigOf(SalesGrid()
            .AllowSorting(false)
            .AllowFiltering(true)
            .AllowExcelExport(true)
            .LargeData(true)
            .PageSize(75)
            .SourceRowCount(250_000)
            .EndpointPrefix("/raporlar/pivot-api"));

        Assert.False(config.GetProperty("allowSorting").GetBoolean());
        Assert.True(config.GetProperty("allowFiltering").GetBoolean());
        Assert.True(config.GetProperty("allowExcelExport").GetBoolean());
        Assert.True(config.GetProperty("largeData").GetBoolean());
        Assert.Equal(75, config.GetProperty("pageSize").GetInt32());
        Assert.Equal(250_000, config.GetProperty("sourceRowCount").GetInt32());
        Assert.Equal("/raporlar/pivot-api", config.GetProperty("endpointPrefix").GetString());
    }

    [Fact]
    public void UnsetOptionsAreOmittedSoBrowserDefaultsApply()
    {
        var config = ConfigOf(SalesGrid());

        Assert.False(config.TryGetProperty("pageSize", out _));
        Assert.False(config.TryGetProperty("endpointPrefix", out _));
    }

    [Fact]
    public void ACaptionContainingMarkupCannotEscapeTheScriptBlock()
    {
        var html = Render(new PivotGridBuilder()
            .Id("pivotGrid")
            .Fields(fields =>
            {
                fields.Add().DataField("urun").Area(PivotArea.Row)
                    .Caption("</script><script>alert('x')</script>");
                fields.Add().DataField("tutar").Area(PivotArea.Data)
                    .Aggregation(PivotAggregation.Sum);
            }));

        Assert.DoesNotContain("<script>alert('x')</script>", html);
    }

    [Fact]
    public void ACaptionContainingQuotesIsSerializedSafely()
    {
        var fields = ConfigOf(new PivotGridBuilder()
            .Id("pivotGrid")
            .Fields(f =>
            {
                f.Add().DataField("urun").Area(PivotArea.Row).Caption("Ürün \"A\" Grubu");
                f.Add().DataField("tutar").Area(PivotArea.Data).Aggregation(PivotAggregation.Sum);
            })).GetProperty("fields");

        Assert.Equal("Ürün \"A\" Grubu", fields[0].GetProperty("caption").GetString());
    }

    [Fact]
    public void RenderingWithoutAnIdThrows()
    {
        var builder = new PivotGridBuilder()
            .Fields(f => f.Add().DataField("tutar").Area(PivotArea.Data));

        var exception = Assert.Throws<InvalidOperationException>(() => Render(builder));

        Assert.Contains("Id", exception.Message);
    }

    [Fact]
    public void RenderingWithoutFieldsThrows()
    {
        var builder = new PivotGridBuilder().Id("pivotGrid");

        var exception = Assert.Throws<InvalidOperationException>(() => Render(builder));

        Assert.Contains("field", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AnIdThatIsNotAValidElementIdentifierThrows()
    {
        var builder = new PivotGridBuilder()
            .Id("pivot\" onload=\"alert(1)")
            .Fields(f => f.Add().DataField("tutar").Area(PivotArea.Data));

        Assert.Throws<InvalidOperationException>(() => Render(builder));
    }

    [Fact]
    public void CssClassIsAppendedToTheDefaultClass()
    {
        var html = Render(SalesGrid().CssClass("rapor-tablosu"));

        Assert.Contains("class=\"pivotforge-grid rapor-tablosu\"", html);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: FAIL — compile error, `PivotGridBuilder` does not exist.

- [ ] **Step 3: Create the grid builder**

Create `src/PivotForge.AspNetCore/Rendering/PivotGridBuilder.cs`:

```csharp
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Html;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Builds the markup and configuration that initialize a browser pivot grid.</summary>
public sealed class PivotGridBuilder : IHtmlContent
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        // Non-ASCII characters stay readable; the payload is written inside a
        // JSON script block whose closing-tag sequence is escaped separately.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private readonly Dictionary<string, object?> _options = new(StringComparer.Ordinal);
    private readonly PivotFieldCollectionBuilder _fields = new();
    private bool _hasFields;
    private string? _id;
    private string? _cssClass;

    /// <summary>Sets the element identifier of the grid container.</summary>
    /// <param name="id">A stable HTML element identifier.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder Id(string id)
    {
        _id = id;
        return this;
    }

    /// <summary>Configures the grid fields.</summary>
    /// <param name="configure">A callback that adds fields.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder Fields(Action<PivotFieldCollectionBuilder> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        configure(_fields);
        _hasFields = true;
        return this;
    }

    /// <summary>Sets the server route prefix used by the grid.</summary>
    /// <param name="prefix">The route prefix, matching the mapped endpoint group.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder EndpointPrefix(string prefix) => Set("endpointPrefix", prefix);

    /// <summary>Enables or disables sorting.</summary>
    /// <param name="allow">True to allow sorting.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowSorting(bool allow) => Set("allowSorting", allow);

    /// <summary>Enables or disables filtering.</summary>
    /// <param name="allow">True to allow filtering.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowFiltering(bool allow) => Set("allowFiltering", allow);

    /// <summary>Enables or disables drill-down.</summary>
    /// <param name="allow">True to allow drill-down.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowDrillDown(bool allow) => Set("allowDrillDown", allow);

    /// <summary>Enables or disables Excel export.</summary>
    /// <param name="allow">True to allow Excel export.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder AllowExcelExport(bool allow) => Set("allowExcelExport", allow);

    /// <summary>Enables cached, paged loading for large results.</summary>
    /// <param name="enabled">True to use the large-data endpoints.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder LargeData(bool enabled) => Set("largeData", enabled);

    /// <summary>Sets the number of pivot rows requested per page.</summary>
    /// <param name="pageSize">The page size.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder PageSize(int pageSize) => Set("pageSize", pageSize);

    /// <summary>Sets the source-row hint passed to the data provider.</summary>
    /// <param name="sourceRowCount">The source-row hint.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder SourceRowCount(int sourceRowCount) => Set("sourceRowCount", sourceRowCount);

    /// <summary>Adds a CSS class to the grid container.</summary>
    /// <param name="cssClass">The additional class name.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder CssClass(string cssClass)
    {
        _cssClass = cssClass;
        return this;
    }

    private PivotGridBuilder Set(string key, object? value)
    {
        _options[key] = value;
        return this;
    }

    /// <summary>Writes the grid markup and initialization script.</summary>
    /// <param name="writer">The target writer.</param>
    /// <param name="encoder">The HTML encoder supplied by the view engine.</param>
    /// <exception cref="InvalidOperationException">Required configuration is missing or invalid.</exception>
    public void WriteTo(TextWriter writer, HtmlEncoder encoder)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(encoder);

        if (string.IsNullOrWhiteSpace(_id))
        {
            throw new InvalidOperationException(
                "A pivot grid requires Id to be set, because a stable element identifier is needed to address the grid.");
        }

        if (!IsValidElementId(_id))
        {
            throw new InvalidOperationException(
                $"\"{_id}\" is not a valid element identifier. Use letters, digits, hyphens, and underscores.");
        }

        var fields = _fields.Build();
        if (fields.Count == 0)
        {
            throw new InvalidOperationException(
                "A pivot grid requires at least one field. Configure fields with the Fields method.");
        }

        var configId = $"{_id}-config";
        var payload = new Dictionary<string, object?>(_options, StringComparer.Ordinal)
        {
            ["fields"] = fields
        };

        var json = JsonSerializer.Serialize(payload, SerializerOptions)
            // Prevent any string value from terminating the surrounding script block.
            .Replace("<", "\\u003c", StringComparison.Ordinal);

        var cssClass = string.IsNullOrWhiteSpace(_cssClass)
            ? "pivotforge-grid"
            : $"pivotforge-grid {_cssClass}";

        writer.Write($"<div id=\"{encoder.Encode(_id)}\" class=\"{encoder.Encode(cssClass)}\"");
        writer.Write($" data-pivotforge-config=\"{encoder.Encode(configId)}\"></div>");
        writer.Write($"<script type=\"application/json\" id=\"{encoder.Encode(configId)}\">");
        writer.Write(json);
        writer.Write("</script>");
        writer.Write("<script>PivotForge.create(");
        writer.Write($"document.getElementById(\"{_id}\"), ");
        writer.Write($"JSON.parse(document.getElementById(\"{configId}\").textContent));");
        writer.Write("</script>");
    }

    private static bool IsValidElementId(string id) =>
        id.All(character => char.IsLetterOrDigit(character) || character is '-' or '_');
}
```

- [ ] **Step 4: Create the factory and helper extension**

Create `src/PivotForge.AspNetCore/Rendering/PivotForgeFactory.cs`:

```csharp
namespace PivotForge.AspNetCore.Rendering;

/// <summary>Creates PivotForge view components.</summary>
public sealed class PivotForgeFactory
{
    /// <summary>Creates a pivot grid builder.</summary>
    /// <returns>A new grid builder.</returns>
    public PivotGridBuilder PivotGrid() => new();
}
```

Create `src/PivotForge.AspNetCore/Rendering/PivotForgeHtmlHelperExtensions.cs`:

```csharp
using Microsoft.AspNetCore.Mvc.Rendering;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Exposes PivotForge view components on <see cref="IHtmlHelper"/>.</summary>
public static class PivotForgeHtmlHelperExtensions
{
    /// <summary>Gets the PivotForge component factory.</summary>
    /// <param name="helper">The view's HTML helper.</param>
    /// <returns>A factory for PivotForge components.</returns>
    public static PivotForgeFactory PivotForge(this IHtmlHelper helper)
    {
        ArgumentNullException.ThrowIfNull(helper);
        return new PivotForgeFactory();
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: PASS, 0 failures, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/PivotForge.AspNetCore/Rendering tests/PivotForge.AspNetCore.Tests/PivotGridBuilderTests.cs
git commit -m "feat(razor): Html.PivotForge().PivotGrid() olusturucusu eklendi"
```

---

### Task 7: Rebuild the demo on the declarative API

The integration proof. `samples/PivotForge.MvcDemo/Views/Home/Index.cshtml` is 2556 lines of hand-wired orchestration; the section this API replaces should collapse to a helper call.

Deferred features (saved views, conditional formatting, selection UI) still need the lower-level API. Keep their existing code intact and working — this task replaces the load-render-sort-filter-drilldown wiring only. If a deferred feature's code depends on a variable the removed wiring created, keep that variable rather than deleting it.

**Files:**
- Modify: `samples/PivotForge.MvcDemo/Views/Home/Index.cshtml`
- Modify: `samples/PivotForge.MvcDemo/Views/_ViewImports.cshtml`

**Interfaces:**
- Consumes: `Html.PivotForge().PivotGrid()` (Task 6), `PivotForge.create` (Tasks 2-4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the rendering namespace**

Add to `samples/PivotForge.MvcDemo/Views/_ViewImports.cshtml`:

```cshtml
@using PivotForge.AspNetCore.Rendering
@using PivotForge.Core
```

- [ ] **Step 2: Reference the new scripts in the view**

In `Index.cshtml`, find the block of `<script src="/_content/PivotForge.AspNetCore/js/...">` tags and add these two, after `pivot-table.js` (the widget requires the renderer to already be loaded):

```html
<script src="/_content/PivotForge.AspNetCore/js/pivot-request-builder.js"></script>
<script src="/_content/PivotForge.AspNetCore/js/pivot-widget.js"></script>
```

- [ ] **Step 3: Replace the pivot container with the helper**

Locate the element the demo passes to `new PivotForge.PivotTableRenderer(elements.tableHost, ...)` around `Index.cshtml:341` and find its markup definition. Replace that container element with:

```cshtml
@(Html.PivotForge().PivotGrid()
    .Id("pivotGrid")
    .AllowSorting(true)
    .AllowFiltering(true)
    .AllowDrillDown(true)
    .AllowExcelExport(true)
    .Fields(fields =>
    {
        fields.Add().Caption("Bölge").DataField("Region").Area(PivotArea.Row);
        fields.Add().Caption("Ürün").DataField("Product").Area(PivotArea.Row);
        fields.Add().Caption("Yıl").DataField("Year").Area(PivotArea.Column);
        fields.Add().Caption("Tutar").DataField("Amount")
            .Aggregation(PivotAggregation.Sum).Area(PivotArea.Data);
    }))
```

Read `samples/PivotForge.MvcDemo/Models/SalesRecord.cs` first and use its actual property names; the names above are placeholders only if they do not match, in which case use the real ones.

- [ ] **Step 4: Remove the superseded orchestration**

Delete the manual renderer construction, the `fetch("/pivotforge/pivot", ...)` call, the `/large/start` and `/large/page` calls, the drill-down fetch at `Index.cshtml:1765`, and the Excel fetch at `Index.cshtml:2142`, along with the functions that exist only to serve them.

Keep everything the deferred features need: the saved-views UI and its `PivotViewStore` usage, the conditional-formatting UI, and the selection and clipboard handlers. Where those read pivot data, obtain it from the widget instead — `widget.getState().result` — using the instance the helper created:

```js
const widget = window.pivotGridWidget ??= null;
```

To reach the widget the helper created, capture it on load:

```js
document.getElementById("pivotGrid").addEventListener("pivotforge:ready", event => {
  window.pivotGridWidget = event.detail.widget;
});
```

If that event does not exist yet, add it: in `PivotForge.create`, immediately before `return widget;`, dispatch it when the container supports events.

```js
    if (typeof widget.container.dispatchEvent === "function" && root.CustomEvent) {
      widget.container.dispatchEvent(
        new root.CustomEvent("pivotforge:ready", { detail: { widget } }));
    }
```

Add a matching test to `tests/pivot-widget.test.js`:

```js
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
```

- [ ] **Step 5: Build and run every test**

Run:
```bash
dotnet build PivotForge.slnx -c Release
node --test tests/*.test.js
dotnet test tests/PivotForge.Core.Tests/PivotForge.Core.Tests.csproj -c Release
dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release
```
Expected: build succeeds with 0 warnings; all test suites pass.

- [ ] **Step 6: Verify the demo in a browser**

Run: `dotnet run --project samples/PivotForge.MvcDemo/PivotForge.MvcDemo.csproj`

Confirm by hand, and do not proceed until each holds: the pivot table renders on load; clicking a column header re-sorts; a filter narrows the data; double-clicking a cell opens drill-down with the correct records; Excel export downloads a file that opens; saved views and conditional formatting still work.

- [ ] **Step 7: Record the reduction**

Run: `git diff --stat HEAD -- samples/PivotForge.MvcDemo/Views/Home/Index.cshtml`

Note the line count removed. This is the practical measure the spec asks for.

- [ ] **Step 8: Commit**

```bash
git add samples/PivotForge.MvcDemo
git commit -m "refactor(demo): MVC demosu deklaratif API uzerine tasindi"
```

---

### Task 8: Documentation and version bump

Ships the feature: documents both entry points, records the new public surface, and moves the packages to `0.2.0-preview.1`.

**Files:**
- Modify: `README.md`
- Modify: `docs/aspnetcore-integration.md`
- Modify: `docs/public-api.md`
- Modify: `src/PivotForge.Core/PivotForge.Core.csproj`
- Modify: `src/PivotForge.AspNetCore/PivotForge.AspNetCore.csproj`
- Modify: `src/PivotForge.AspNetCore/README.md`

**Interfaces:**
- Consumes: the full public surface from Tasks 1-6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a quick start to the root README**

In `README.md`, replace the body of the "ASP.NET Core Quick Start" section's asset-reference part by adding the two new scripts to the existing list, and add this section immediately after it:

````markdown
### Declarative Quick Start

With the fields declared in the view, no JavaScript wiring is needed:

```cshtml
@(Html.PivotForge().PivotGrid()
    .Id("pivotGrid")
    .AllowSorting(true)
    .AllowFiltering(true)
    .Fields(fields =>
    {
        fields.Add().Caption("Ürün").DataField("urun").Area(PivotArea.Row);
        fields.Add().Caption("Yıl").DataField("yil").Area(PivotArea.Column);
        fields.Add().Caption("Tutar").DataField("tutar")
            .Aggregation(PivotAggregation.Sum).Area(PivotArea.Data);
    }))
```

The same configuration is available directly from JavaScript:

```js
PivotForge.create("#pivotGrid", {
  fields: [
    { caption: "Ürün", dataField: "urun", area: "row" },
    { caption: "Yıl", dataField: "yil", area: "column" },
    { caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
  ]
});
```

Data always comes from the provider registered with `AddPivotForge<TRecord>`; the
grid computes nothing in the browser.
````

Also update the two `dotnet add package` version numbers and the "The current preview is" line to `0.2.0-preview.1`.

- [ ] **Step 2: Document the API in the integration guide**

In `docs/aspnetcore-integration.md`, add a "Declarative API" section covering: the field model and its four areas; every `PivotGridBuilder` method with its default; the `PivotForge.create` options and their defaults; the controller methods `refresh`, `updateFields`, `sortBy`, `setFilter`, `clearFilters`, `drillDown`, `exportToExcel`, `loadPage`, `getState`, `dispose`; the `dataLoading`, `dataLoaded`, `error`, and `pivotforge:ready` events; and a note that saved views, conditional formatting, and selection still use the lower-level API.

State that script order matters: `pivot-table.js` must load before `pivot-widget.js`.

- [ ] **Step 3: Record the new public surface**

In `docs/public-api.md`, update the version line to `0.2.0-preview.1`. Under "PivotForge.AspNetCore", add a "Declarative rendering" subsection listing `PivotForgeHtmlHelperExtensions`, `PivotForgeFactory`, `PivotGridBuilder`, `PivotFieldCollectionBuilder`, `PivotFieldBuilder`, and `PivotArea`. Under "Browser API", add `PivotForge.create`, `PivotForge.PivotWidget`, and `PivotForge.PivotRequestBuilder`.

- [ ] **Step 4: Bump both package versions**

In both `src/PivotForge.Core/PivotForge.Core.csproj` and `src/PivotForge.AspNetCore/PivotForge.AspNetCore.csproj`, set `<Version>0.2.0-preview.1</Version>` and replace `<PackageReleaseNotes>` with:

```xml
<PackageReleaseNotes>Add a declarative field-based API: PivotForge.create in the browser and Html.PivotForge().PivotGrid() in Razor.</PackageReleaseNotes>
```

- [ ] **Step 5: Update the package README**

In `src/PivotForge.AspNetCore/README.md`, add the declarative Razor and JavaScript examples from Step 1, since this file is what NuGet displays on the package page.

- [ ] **Step 6: Verify everything builds and packs**

Run:
```bash
dotnet build PivotForge.slnx -c Release
dotnet pack src/PivotForge.Core/PivotForge.Core.csproj -c Release -o artifacts/packages
dotnet pack src/PivotForge.AspNetCore/PivotForge.AspNetCore.csproj -c Release -o artifacts/packages
```
Expected: 0 warnings, 0 errors. Package validation passes, confirming the additive-only change introduced no breaks.

- [ ] **Step 7: Confirm the new assets are in the package**

Run: `unzip -l artifacts/packages/PivotForge.AspNetCore.0.2.0-preview.1.nupkg | grep -E "pivot-widget|pivot-request-builder"`
Expected: both files appear under `staticwebassets`.

- [ ] **Step 8: Commit**

```bash
git add README.md docs src/PivotForge.Core/PivotForge.Core.csproj src/PivotForge.AspNetCore
git commit -m "docs(release): deklaratif API belgelendi ve surum 0.2.0-preview.1 yapildi"
```

---

## Self-Review Notes

Checked against the spec:

- Field model with four areas, defaults, and `caption`/`format`/`visible` → Task 1.
- Translation owned solely by JavaScript → Task 1 implements it; Task 5 only serializes, and Task 6's tests assert the emitted shape matches.
- Widget contract, options, controller methods, events, `dispose()` completeness → Tasks 2-4.
- Razor builder contract, JSON script block, required `Id` → Task 6.
- New public surface list → Tasks 5, 6, documented in Task 8.
- Failure behavior: server errors surfaced without blanking (Task 2), call-site configuration errors (Tasks 1-2), abort-on-supersede (Task 2), expired session restart (Task 4).
- Testing: `node --test` for widget behavior, xUnit for the builder, demo as integration proof (Task 7).
- Compatibility: additive only, `0.2.0-preview.1` (Task 8), verified by package validation in Task 8 Step 6.

One spec deviation, applied deliberately: the spec names the widget file `pivot-forge-widget.js`; this plan uses `pivot-widget.js` to match the existing `pivot-*.js` naming of every sibling module. The spec is updated to match.
