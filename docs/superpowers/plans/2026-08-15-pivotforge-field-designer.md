# PivotForge Field Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the interactive field designer — searchable field list plus four drag-and-drop zones — as part of `PivotForge.AspNetCore`, so consumers get the demo's layout-building experience without writing it themselves.

**Architecture:** Three units with one-way dependencies. `PivotLayoutState` is a pure module owning the catalog, the layout, the role rules, and every mutation — no DOM, no I/O. `PivotFieldDesigner` renders the panel and wires HTML5 drag-and-drop, delegating all decisions to the state. `PivotWidget` gains a batched `update()` so one drag produces one server request. The widget never learns about the designer.

**Tech Stack:** .NET 8 (`net8.0`), ASP.NET Core Razor Class Library, xUnit, browser-native JavaScript (no framework, no jQuery), `node --test` for JS tests.

**Spec:** `docs/superpowers/specs/2026-08-15-pivotforge-field-designer-design.md`

## Global Constraints

- Target framework stays `net8.0`. Do not add package references to either `src` project.
- `TreatWarningsAsErrors` is on — a build warning fails the build.
- `GenerateDocumentationFile` is on — every new public C# member needs an XML doc comment or the build fails.
- No jQuery, no external JS library. Browser code uses native DOM APIs only.
- JS modules follow the existing pattern exactly: an IIFE taking `typeof window !== "undefined" ? window : globalThis`, attaching to `root.PivotForge ??= {}`, ending with a `module.exports` guard. Reference sibling: `src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js`.
- Field-to-request translation stays in `pivot-request-builder.js` only. `PivotLayoutState` composes layouts; it must not build requests, and C# must not translate.
- Roles: a `Measure` may occupy only the `data` area; a `Dimension` may occupy `row`, `column`, and `filter`. Both may sit in `available`.
- Role inference: a field declared in `data` is a `Measure`; a field in `row`, `column`, or `filter` is a `Dimension`. For `available`, `role` is required.
- `aggregation` remains valid only on `data` fields, in both C# and JavaScript. A measure moved into the data area receives the default `"sum"`.
- Everything is additive. A field list with no `available` entries and no `role` must produce a byte-identical request to today.
- Desktop only: HTML5 drag-and-drop. No pointer-events or touch handling.
- Enums cross the wire as strings; JSON property names are camelCase.
- Commit messages are Turkish and descriptive.

---

### Task 1: Request builder learns `available` and `role`

The foundation. Every later task depends on the field model carrying a role and tolerating catalog-only fields.

**Files:**
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js`
- Test: `tests/pivot-request-builder.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeField` output gains `role` (`"dimension"` or `"measure"`); `"available"` becomes a valid area that `buildRequest` excludes from `rows`, `columns`, `values`, and `filters`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pivot-request-builder.test.js`:

```js
test("available fields stay out of the request", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "tutar", area: "data", aggregation: "sum" },
    { dataField: "miktar", area: "available", role: "measure" },
    { dataField: "bolge", area: "available", role: "dimension" }
  ]);

  assert.deepEqual(request.rows, ["urun"]);
  assert.deepEqual(request.columns, []);
  assert.equal(request.values.length, 1);
  assert.deepEqual(request.filters, []);
});

test("role is inferred from the declared area", () => {
  const fields = PivotRequestBuilder.normalizeFields([
    { dataField: "urun", area: "row" },
    { dataField: "yil", area: "column" },
    { dataField: "bolge", area: "filter" },
    { dataField: "tutar", area: "data" }
  ]);

  assert.deepEqual(fields.map(field => field.role), [
    "dimension", "dimension", "dimension", "measure"
  ]);
});

test("an explicit role is honored", () => {
  const [field] = PivotRequestBuilder.normalizeFields([
    { dataField: "miktar", area: "available", role: "measure" }
  ]);

  assert.equal(field.role, "measure");
});

test("an available field requires a role", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([{ dataField: "miktar", area: "available" }]),
    /requires an explicit "role"/
  );
});

test("a role contradicting the declared area is rejected", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "tutar", area: "data", role: "dimension" }
    ]),
    /cannot be "dimension"/
  );
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "urun", area: "row", role: "measure" }
    ]),
    /cannot be "measure"/
  );
});

test("an unknown role is rejected", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "miktar", area: "available", role: "metric" }
    ]),
    /Unknown role "metric"/
  );
});

test("aggregation is still rejected outside the data area, including available", () => {
  assert.throws(
    () => PivotRequestBuilder.normalizeFields([
      { dataField: "miktar", area: "available", role: "measure", aggregation: "sum" }
    ]),
    /only valid on a "data" field/
  );
});

test("a list with no available fields and no roles builds the same request as before", () => {
  const request = PivotRequestBuilder.buildRequest([
    { dataField: "urun", area: "row" },
    { dataField: "yil", area: "column" },
    { dataField: "tutar", area: "data", aggregation: "sum" }
  ]);

  assert.deepEqual(request, {
    rows: ["urun"],
    columns: ["yil"],
    values: [{ field: "tutar", aggregation: "sum", showAs: "normal" }],
    filters: [],
    rowSort: null
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pivot-request-builder.test.js`
Expected: FAIL — `Unknown area "available"`.

- [ ] **Step 3: Add the role constants**

In `pivot-request-builder.js`, extend the `AREAS` constant and add `ROLES` beside it:

```js
  const AREAS = ["row", "column", "data", "filter", "available"];
  const ROLES = ["dimension", "measure"];
```

- [ ] **Step 4: Infer and validate the role**

In `normalizeField`, immediately after the `area` validation block, insert:

```js
    const inferredRole = area === "data" ? "measure" : area === "available" ? null : "dimension";
    const role = field.role ?? inferredRole;

    if (role === null) {
      throw new Error(
        `Field "${dataField}" in area "available" requires an explicit "role" because there is no area to infer it from.`
      );
    }

    if (!ROLES.includes(role)) {
      throw new Error(
        `Unknown role "${role}" on field "${dataField}". Expected one of: ${ROLES.join(", ")}.`
      );
    }

    if (inferredRole !== null && role !== inferredRole) {
      throw new Error(
        `Field "${dataField}" is in area "${area}", so its role cannot be "${role}".`
      );
    }
```

- [ ] **Step 5: Return the role**

In the object `normalizeField` returns, add `role` after `area`:

```js
    return {
      dataField,
      area,
      role,
      caption: field.caption ?? dataField,
      aggregation,
      showAs,
      format: field.format ?? null,
      visible: field.visible !== false
    };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/pivot-request-builder.test.js`
Expected: PASS. `buildRequest` already filters by area, so `available` fields fall out with no further change.

- [ ] **Step 7: Run the full JS suite**

Run: `node --test tests/*.test.js`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js tests/pivot-request-builder.test.js
git commit -m "feat(widget): alan modeline available bolgesi ve rol eklendi"
```

---

### Task 2: `PivotLayoutState`

The pure core. Every layout rule lives here, and every rule is tested without a DOM. This is the largest task and the one carrying the design's weight.

**Files:**
- Create: `src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js`
- Test: `tests/pivot-layout-state.test.js`

**Interfaces:**
- Consumes: `PivotForge.PivotRequestBuilder.normalizeFields` (Task 1).
- Produces: `PivotForge.PivotLayoutState`, constructed as `new PivotLayoutState(catalog, layout)` where `catalog` is a raw field array and `layout` is optional. Methods: `canDrop(field, area)` → `boolean`; `move(field, area, index)`; `remove(field)`; `reorder(area, fromIndex, toIndex)`; `setAggregation(field, aggregation)`; `getState()` → `{ rows, columns, values, filters, available }`; `toFields()` → field array; `toRequestState()` → `{ fields, filters }`; `field(name)` → the normalized catalog entry, throwing when the name is unknown (Task 4 uses it to read captions); `on(event, handler)` → unsubscribe function; event name `change`.

- [ ] **Step 1: Write the failing test**

Create `tests/pivot-layout-state.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");

const PivotForge = globalThis.PivotForge;

const catalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Category", caption: "Kategori", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure" },
  { dataField: "Quarter", caption: "Çeyrek", area: "available", role: "dimension" }
];

const create = () => new PivotForge.PivotLayoutState(catalog);

test("the initial layout comes from the declared areas", () => {
  const state = create().getState();

  assert.deepEqual(state.rows, ["Region", "Category"]);
  assert.deepEqual(state.columns, ["Year"]);
  assert.deepEqual(state.values, [{ field: "Amount", aggregation: "sum", showAs: "normal" }]);
  assert.deepEqual(state.filters, []);
});

test("available is derived from what is not placed", () => {
  assert.deepEqual(create().getState().available, ["Quantity", "Quarter"]);
});

test("a dimension may drop into row, column, and filter but not data", () => {
  const state = create();

  assert.equal(state.canDrop("Quarter", "row"), true);
  assert.equal(state.canDrop("Quarter", "column"), true);
  assert.equal(state.canDrop("Quarter", "filter"), true);
  assert.equal(state.canDrop("Quarter", "data"), false);
});

test("a measure may drop into data only", () => {
  const state = create();

  assert.equal(state.canDrop("Quantity", "data"), true);
  assert.equal(state.canDrop("Quantity", "row"), false);
  assert.equal(state.canDrop("Quantity", "column"), false);
  assert.equal(state.canDrop("Quantity", "filter"), false);
});

test("a field already in the target area cannot be dropped there again", () => {
  assert.equal(create().canDrop("Region", "row"), false);
});

test("move places a field at the requested index", () => {
  const state = create();

  state.move("Quarter", "row", 1);

  assert.deepEqual(state.getState().rows, ["Region", "Quarter", "Category"]);
});

test("move without an index appends", () => {
  const state = create();

  state.move("Quarter", "row");

  assert.deepEqual(state.getState().rows, ["Region", "Category", "Quarter"]);
});

test("move removes the field from its previous area", () => {
  const state = create();

  state.move("Year", "row", 0);

  assert.deepEqual(state.getState().columns, []);
  assert.deepEqual(state.getState().rows, ["Year", "Region", "Category"]);
});

test("moving a measure into data gives it the default sum aggregation", () => {
  const state = create();

  state.move("Quantity", "data");

  assert.deepEqual(state.getState().values, [
    { field: "Amount", aggregation: "sum", showAs: "normal" },
    { field: "Quantity", aggregation: "sum", showAs: "normal" }
  ]);
});

test("an invalid move throws and leaves the state untouched", () => {
  const state = create();
  const before = state.getState();

  assert.throws(() => state.move("Quantity", "row"), /cannot be placed in area "row"/);
  assert.deepEqual(state.getState(), before);
});

test("remove returns a field to available", () => {
  const state = create();

  state.remove("Year");

  assert.deepEqual(state.getState().columns, []);
  assert.equal(state.getState().available.includes("Year"), true);
});

test("removing the last data field is refused", () => {
  const state = create();

  assert.throws(() => state.remove("Amount"), /last field in the data area/);
  assert.deepEqual(state.getState().values.length, 1);
});

test("removing a data field is allowed once another one exists", () => {
  const state = create();

  state.move("Quantity", "data");
  state.remove("Amount");

  assert.deepEqual(state.getState().values, [
    { field: "Quantity", aggregation: "sum", showAs: "normal" }
  ]);
});

test("reorder moves a field within its area", () => {
  const state = create();

  state.reorder("row", 0, 1);

  assert.deepEqual(state.getState().rows, ["Category", "Region"]);
});

test("setAggregation changes a data field", () => {
  const state = create();

  state.setAggregation("Amount", "average");

  assert.equal(state.getState().values[0].aggregation, "average");
});

test("setAggregation on a field outside the data area throws", () => {
  assert.throws(() => create().setAggregation("Region", "sum"), /not in the data area/);
});

test("setAggregation rejects an unknown aggregation", () => {
  assert.throws(() => create().setAggregation("Amount", "median"), /Unknown aggregation/);
});

test("getState returns a copy that cannot mutate the state", () => {
  const state = create();
  const snapshot = state.getState();

  snapshot.rows.push("Quarter");

  assert.deepEqual(state.getState().rows, ["Region", "Category"]);
});

test("toFields produces a list buildRequest accepts", () => {
  const state = create();
  state.move("Quarter", "filter");

  const request = PivotForge.PivotRequestBuilder.buildRequest(state.toFields());

  assert.deepEqual(request.rows, ["Region", "Category"]);
  assert.deepEqual(request.columns, ["Year"]);
  assert.equal(request.values.length, 1);
});

test("toRequestState carries fields and filters but never rowSort", () => {
  const requestState = create().toRequestState();

  assert.equal(Array.isArray(requestState.fields), true);
  assert.deepEqual(requestState.filters, []);
  assert.equal("rowSort" in requestState, false);
});

test("each mutation emits exactly one change event", () => {
  const state = create();
  let changes = 0;
  state.on("change", () => changes++);

  state.move("Quarter", "row");
  state.reorder("row", 0, 1);
  state.setAggregation("Amount", "min");
  state.remove("Quarter");

  assert.equal(changes, 4);
});

test("a refused mutation emits no change event", () => {
  const state = create();
  let changes = 0;
  state.on("change", () => changes++);

  assert.throws(() => state.move("Quantity", "row"));
  assert.throws(() => state.remove("Amount"));

  assert.equal(changes, 0);
});

test("on returns an unsubscribe function", () => {
  const state = create();
  let changes = 0;
  const off = state.on("change", () => changes++);

  off();
  state.move("Quarter", "row");

  assert.equal(changes, 0);
});

test("a layout naming a field absent from the catalog throws", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState(catalog, {
      rows: ["Bilinmeyen"],
      columns: [],
      values: [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
      filters: []
    }),
    /"Bilinmeyen" is not in the catalog/
  );
});

test("an explicit layout overrides the declared areas", () => {
  const state = new PivotForge.PivotLayoutState(catalog, {
    rows: ["Quarter"],
    columns: [],
    values: [{ field: "Quantity", aggregation: "average", showAs: "normal" }],
    filters: []
  });

  assert.deepEqual(state.getState().rows, ["Quarter"]);
  assert.deepEqual(state.getState().values, [
    { field: "Quantity", aggregation: "average", showAs: "normal" }
  ]);
  assert.equal(state.getState().available.includes("Region"), true);
});

test("a catalog without a data field throws", () => {
  assert.throws(
    () => new PivotForge.PivotLayoutState([{ dataField: "Region", area: "row" }]),
    /at least one field in the data area/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-layout-state.test.js`
Expected: FAIL — `Cannot find module '.../pivot-layout-state.js'`

- [ ] **Step 3: Write the implementation**

Create `src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js`:

```js
(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];
  const PLACED_AREAS = ["row", "column", "data", "filter"];
  const AREA_TO_KEY = { row: "rows", column: "columns", data: "values", filter: "filters" };

  class PivotLayoutState {
    constructor(catalog, layout = null) {
      const normalized = PivotForge.PivotRequestBuilder.normalizeFields(catalog ?? []);

      this.catalog = new Map(normalized.map(field => [field.dataField, field]));
      this.handlers = new Map();
      this.layout = layout ? this.adoptLayout(layout) : this.layoutFromCatalog(normalized);

      if (this.layout.values.length === 0) {
        throw new Error("A pivot layout requires at least one field in the data area.");
      }
    }

    layoutFromCatalog(fields) {
      const inArea = area => fields.filter(field => field.area === area);

      return {
        rows: inArea("row").map(field => field.dataField),
        columns: inArea("column").map(field => field.dataField),
        values: inArea("data").map(field => ({
          field: field.dataField,
          aggregation: field.aggregation ?? "sum",
          showAs: field.showAs ?? "normal"
        })),
        filters: inArea("filter").map(field => ({ field: field.dataField, values: [] }))
      };
    }

    adoptLayout(layout) {
      const assertKnown = name => {
        if (!this.catalog.has(name)) {
          throw new Error(`Layout field "${name}" is not in the catalog.`);
        }
      };

      (layout.rows ?? []).forEach(assertKnown);
      (layout.columns ?? []).forEach(assertKnown);
      (layout.values ?? []).forEach(value => assertKnown(value.field));
      (layout.filters ?? []).forEach(filter => assertKnown(filter.field));

      return {
        rows: [...(layout.rows ?? [])],
        columns: [...(layout.columns ?? [])],
        values: (layout.values ?? []).map(value => ({
          field: value.field,
          aggregation: value.aggregation ?? "sum",
          showAs: value.showAs ?? "normal"
        })),
        filters: (layout.filters ?? []).map(filter => ({
          field: filter.field,
          values: [...(filter.values ?? [])]
        }))
      };
    }

    field(name) {
      const found = this.catalog.get(name);
      if (!found) {
        throw new Error(`Field "${name}" is not in the catalog.`);
      }
      return found;
    }

    areaOf(name) {
      if (this.layout.rows.includes(name)) return "row";
      if (this.layout.columns.includes(name)) return "column";
      if (this.layout.values.some(value => value.field === name)) return "data";
      if (this.layout.filters.some(filter => filter.field === name)) return "filter";
      return "available";
    }

    canDrop(name, area) {
      if (!this.catalog.has(name) || !PLACED_AREAS.includes(area)) {
        return false;
      }

      if (this.areaOf(name) === area) {
        return false;
      }

      const isMeasure = this.field(name).role === "measure";
      return area === "data" ? isMeasure : !isMeasure;
    }

    detach(name) {
      this.layout.rows = this.layout.rows.filter(entry => entry !== name);
      this.layout.columns = this.layout.columns.filter(entry => entry !== name);
      this.layout.values = this.layout.values.filter(value => value.field !== name);
      this.layout.filters = this.layout.filters.filter(filter => filter.field !== name);
    }

    move(name, area, index) {
      if (!this.canDrop(name, area)) {
        throw new Error(`Field "${name}" cannot be placed in area "${area}".`);
      }

      this.detach(name);

      const key = AREA_TO_KEY[area];
      const entry = area === "data"
        ? { field: name, aggregation: "sum", showAs: "normal" }
        : area === "filter"
          ? { field: name, values: [] }
          : name;

      const target = this.layout[key];
      target.splice(index ?? target.length, 0, entry);
      this.emitChange();
    }

    remove(name) {
      const area = this.areaOf(name);
      if (area === "available") {
        return;
      }

      if (area === "data" && this.layout.values.length === 1) {
        throw new Error(
          `Field "${name}" is the last field in the data area and a pivot requires at least one.`
        );
      }

      this.detach(name);
      this.emitChange();
    }

    reorder(area, fromIndex, toIndex) {
      const key = AREA_TO_KEY[area];
      if (!key) {
        throw new Error(`Cannot reorder unknown area "${area}".`);
      }

      const target = this.layout[key];
      const [entry] = target.splice(fromIndex, 1);
      if (entry === undefined) {
        throw new Error(`No field at index ${fromIndex} in area "${area}".`);
      }

      target.splice(toIndex, 0, entry);
      this.emitChange();
    }

    setAggregation(name, aggregation) {
      const value = this.layout.values.find(entry => entry.field === name);
      if (!value) {
        throw new Error(`Field "${name}" is not in the data area.`);
      }

      if (!AGGREGATIONS.includes(aggregation)) {
        throw new Error(
          `Unknown aggregation "${aggregation}". Expected one of: ${AGGREGATIONS.join(", ")}.`
        );
      }

      value.aggregation = aggregation;
      this.emitChange();
    }

    getState() {
      const placed = new Set([
        ...this.layout.rows,
        ...this.layout.columns,
        ...this.layout.values.map(value => value.field),
        ...this.layout.filters.map(filter => filter.field)
      ]);

      return {
        rows: [...this.layout.rows],
        columns: [...this.layout.columns],
        values: this.layout.values.map(value => ({ ...value })),
        filters: this.layout.filters.map(filter => ({ ...filter, values: [...filter.values] })),
        available: [...this.catalog.keys()].filter(name => !placed.has(name))
      };
    }

    toFields() {
      const captionOf = name => this.field(name).caption;
      const state = this.getState();

      return [
        ...state.rows.map(name => ({ dataField: name, caption: captionOf(name), area: "row" })),
        ...state.columns.map(name => ({ dataField: name, caption: captionOf(name), area: "column" })),
        ...state.values.map(value => ({
          dataField: value.field,
          caption: captionOf(value.field),
          area: "data",
          aggregation: value.aggregation,
          showAs: value.showAs
        })),
        ...state.filters.map(filter => ({
          dataField: filter.field,
          caption: captionOf(filter.field),
          area: "filter"
        }))
      ];
    }

    toRequestState() {
      return {
        fields: this.toFields(),
        filters: this.getState().filters.filter(filter => filter.values.length > 0)
      };
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

    emitChange() {
      this.handlers.get("change")?.forEach(handler => handler(this.getState()));
    }
  }

  PivotForge.PivotLayoutState = PivotLayoutState;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotLayoutState;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pivot-layout-state.test.js`
Expected: PASS, 25 tests.

- [ ] **Step 5: Prove the role rules discriminate**

Temporarily change `canDrop`'s last line to `return true;`, run the test, and confirm the role tests FAIL. Restore it and confirm they pass. Record both outputs — this project has shipped tests that passed with the feature removed, so a rule this central needs mutation evidence.

- [ ] **Step 6: Run the full JS suite**

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js tests/pivot-layout-state.test.js
git commit -m "feat(designer): yerlesim durumu cekirdegi eklendi"
```

---

### Task 3: Batched `widget.update()`

One drag must produce one request. This also closes a gap recorded during the declarative API review: the widget had no public way to set several state pieces and refresh once, which forced the demo to reach into internals.

**Files:**
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js`
- Test: `tests/pivot-widget.test.js`

**Interfaces:**
- Consumes: existing `PivotWidget` internals `options.fields`, `fields`, `filters`, `rowSort`, `refresh()`.
- Produces: `widget.update({ fields, filters, rowSort })` → `Promise<void>`. Every member optional; supplied members replace state, omitted members are untouched; exactly one refresh follows.

- [ ] **Step 1: Write the failing test**

Append to `tests/pivot-widget.test.js`:

```js
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
```

Note: `createWidget` is the existing helper in this file; it supplies `renderImpl` and a recording `fetchImpl`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-widget.test.js`
Expected: FAIL — `widget.update is not a function`

- [ ] **Step 3: Add the method**

In `pivot-widget.js`, add this method to `PivotWidget` immediately before `updateFields`:

```js
    async update({ fields, filters, rowSort } = {}) {
      // One call, one refresh: a designer changes several pieces per interaction
      // and must not produce a request per piece.
      if (fields !== undefined) {
        PivotForge.PivotRequestBuilder.buildRequest(fields);
        this.options.fields = fields;
        this.fields = PivotForge.PivotRequestBuilder.normalizeFields(fields);
        if (this.renderer) {
          this.renderer = this.createRenderer();
        }
      }

      if (filters !== undefined) {
        this.filters = filters.map(filter => ({ field: filter.field, values: [...filter.values] }));
      }

      if (rowSort !== undefined) {
        this.rowSort = rowSort;
      }

      await this.refresh();
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pivot-widget.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full JS suite**

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js tests/pivot-widget.test.js
git commit -m "feat(widget): tek yenilemeyle toplu durum guncelleyen update() eklendi"
```

---

### Task 4: `PivotFieldDesigner`

The DOM layer. It renders the panel, wires drag-and-drop, and delegates every decision to the state.

**Files:**
- Create: `src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js`
- Modify: `src/PivotForge.AspNetCore/wwwroot/css/pivotforge.css`
- Test: `tests/pivot-field-designer.test.js`

**Interfaces:**
- Consumes: `PivotForge.PivotLayoutState` (Task 2), `widget.update(...)` (Task 3).
- Produces: `PivotForge.PivotFieldDesigner`, constructed as `new PivotFieldDesigner(host, { state, widget, labels })`. Methods: `render()`, `dispose()`. `host` is an element or selector string.

The tests use a DOM stub rather than a real browser, following the pattern the widget tests already use. Because the designer creates elements, the stub must provide `document.createElement`. Install it in the test file.

- [ ] **Step 1: Write the failing test**

Create `tests/pivot-field-designer.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

// A DOM stub sufficient for the designer: element creation, class lists,
// children, and event listeners. The designer must not need more than this.
function createElement(tagName) {
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

globalThis.document = { createElement };

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js");

const PivotForge = globalThis.PivotForge;

const catalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Year", caption: "Yıl", area: "column" },
  { dataField: "Amount", caption: "Tutar", area: "data", aggregation: "sum" },
  { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure" },
  { dataField: "Quarter", caption: "Çeyrek", area: "available", role: "dimension" }
];

function build() {
  const updates = [];
  const widget = { update: async payload => { updates.push(payload); } };
  const state = new PivotForge.PivotLayoutState(catalog);
  const host = createElement("div");
  const designer = new PivotForge.PivotFieldDesigner(host, { state, widget });

  return { designer, state, host, updates };
}

// Finds every rendered element carrying a data-field value, at any depth.
function chips(node, found = []) {
  if (node.dataset?.field) {
    found.push(node);
  }
  node.children.forEach(child => chips(child, found));
  return found;
}

function zone(node, area) {
  if (node.dataset?.zone === area) {
    return node;
  }
  for (const child of node.children) {
    const match = zone(child, area);
    if (match) {
      return match;
    }
  }
  return null;
}

test("renders a zone for each area plus the available list", () => {
  const { host } = build();

  assert.notEqual(zone(host, "row"), null);
  assert.notEqual(zone(host, "column"), null);
  assert.notEqual(zone(host, "data"), null);
  assert.notEqual(zone(host, "filter"), null);
  assert.notEqual(zone(host, "available"), null);
});

test("renders a chip for every catalog field", () => {
  const { host } = build();

  assert.deepEqual(
    chips(host).map(chip => chip.dataset.field).sort(),
    ["Amount", "Quantity", "Quarter", "Region", "Year"]
  );
});

test("a chip carries the field caption, not its name", () => {
  const { host } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Region");

  assert.equal(chip.textContent.includes("Bölge"), true);
});

test("dropping a dimension into the rows zone updates the state and the widget once", async () => {
  const { host, state, updates } = build();

  const target = zone(host, "row");
  target.dispatch("drop", {
    preventDefault() {},
    dataTransfer: { getData: () => "Quarter" }
  });
  await Promise.resolve();

  assert.deepEqual(state.getState().rows, ["Region", "Quarter"]);
  assert.equal(updates.length, 1);
});

test("dropping a measure into the rows zone changes nothing", async () => {
  const { host, state, updates } = build();
  const before = state.getState();

  zone(host, "row").dispatch("drop", {
    preventDefault() {},
    dataTransfer: { getData: () => "Quantity" }
  });
  await Promise.resolve();

  assert.deepEqual(state.getState(), before);
  assert.equal(updates.length, 0);
});

test("dragover refuses an invalid target", () => {
  const { host } = build();
  let prevented = false;

  zone(host, "row").dispatch("dragover", {
    preventDefault() { prevented = true; },
    dataTransfer: { getData: () => "Quantity", dropEffect: "" }
  });

  assert.equal(prevented, false);
});

test("dragover accepts a valid target", () => {
  const { host } = build();
  let prevented = false;

  zone(host, "row").dispatch("dragover", {
    preventDefault() { prevented = true; },
    dataTransfer: { getData: () => "Quarter", dropEffect: "" }
  });

  assert.equal(prevented, true);
});

test("the remove control on the last data field is disabled and explains why", () => {
  const { host } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Amount");
  const remove = chip.children.find(child => child.dataset?.action === "remove");

  assert.equal(remove.disabled, true);
  assert.equal(remove.title.length > 0, true);
});

test("changing an aggregation updates the state and the widget once", async () => {
  const { host, state, updates } = build();
  const chip = chips(host).find(entry => entry.dataset.field === "Amount");
  const select = chip.children.find(child => child.dataset?.action === "aggregation");

  select.value = "average";
  select.dispatch("change", { target: select });
  await Promise.resolve();

  assert.equal(state.getState().values[0].aggregation, "average");
  assert.equal(updates.length, 1);
});

test("dispose clears the host", () => {
  const { designer, host } = build();

  designer.dispose();

  assert.equal(host.children.length, 0);
});

test("a designer without a widget throws", () => {
  const state = new PivotForge.PivotLayoutState(catalog);

  assert.throws(
    () => new PivotForge.PivotFieldDesigner(createElement("div"), { state }),
    /requires a widget/
  );
});

test("a designer without a state throws", () => {
  assert.throws(
    () => new PivotForge.PivotFieldDesigner(createElement("div"), { widget: { update() {} } }),
    /requires a state/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pivot-field-designer.test.js`
Expected: FAIL — `Cannot find module '.../pivot-field-designer.js'`

- [ ] **Step 3: Write the implementation**

Create `src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js`:

```js
(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];

  const DEFAULT_LABELS = {
    available: "Alanlar",
    row: "Satırlar",
    column: "Sütunlar",
    data: "Değerler",
    filter: "Filtreler",
    remove: "Kaldır",
    lastValue: "Bir pivot en az bir değer alanı gerektirir.",
    aggregations: {
      sum: "Toplam",
      count: "Sayım",
      average: "Ortalama",
      min: "Minimum",
      max: "Maksimum"
    }
  };

  const ZONES = ["filter", "column", "row", "data"];

  class PivotFieldDesigner {
    constructor(host, options = {}) {
      const element = typeof host === "string" ? root.document?.querySelector(host) : host;
      if (!element) {
        throw new Error("PivotFieldDesigner requires a host element or a selector matching one.");
      }

      if (!options.state) {
        throw new Error("PivotFieldDesigner requires a state.");
      }

      if (!options.widget || typeof options.widget.update !== "function") {
        throw new Error("PivotFieldDesigner requires a widget exposing update().");
      }

      this.host = element;
      this.state = options.state;
      this.widget = options.widget;
      this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
      this.disposed = false;
      this.render();
    }

    createChip(name, area) {
      const document = root.document;
      const field = this.state.field(name);
      const chip = document.createElement("div");

      chip.className = "pivot-chip";
      chip.dataset.field = name;
      chip.draggable = true;
      chip.textContent = field.caption;
      chip.addEventListener("dragstart", event => {
        event.dataTransfer?.setData?.("text/plain", name);
      });

      if (area === "data") {
        const select = document.createElement("select");
        select.className = "pivot-chip__aggregation";
        select.dataset.action = "aggregation";
        const current = this.state.getState().values.find(value => value.field === name);

        AGGREGATIONS.forEach(aggregation => {
          const option = document.createElement("option");
          option.value = aggregation;
          option.textContent = this.labels.aggregations[aggregation];
          select.appendChild(option);
        });

        select.value = current?.aggregation ?? "sum";
        select.addEventListener("change", event => {
          this.apply(() => this.state.setAggregation(name, event.target.value));
        });
        chip.appendChild(select);
      }

      if (area !== "available") {
        const remove = document.createElement("button");
        remove.className = "pivot-chip__remove";
        remove.dataset.action = "remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `${field.caption} — ${this.labels.remove}`);

        const isLastValue = area === "data" && this.state.getState().values.length === 1;
        if (isLastValue) {
          remove.disabled = true;
          remove.title = this.labels.lastValue;
        } else {
          remove.addEventListener("click", () => this.apply(() => this.state.remove(name)));
        }

        chip.appendChild(remove);
      }

      return chip;
    }

    createZone(area) {
      const document = root.document;
      const zone = document.createElement("section");
      zone.className = "pivot-zone";
      zone.dataset.zone = area;

      const head = document.createElement("div");
      head.className = "pivot-zone__head";
      head.textContent = this.labels[area];
      zone.appendChild(head);

      const body = document.createElement("div");
      body.className = "pivot-zone__body";
      zone.appendChild(body);

      zone.addEventListener("dragover", event => {
        const name = event.dataTransfer?.getData?.("text/plain");
        if (name && this.state.canDrop(name, area)) {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
        }
      });

      zone.addEventListener("drop", event => {
        const name = event.dataTransfer?.getData?.("text/plain");
        if (!name || !this.state.canDrop(name, area)) {
          return;
        }

        event.preventDefault();
        this.apply(() => this.state.move(name, area));
      });

      const names = this.namesIn(area);
      names.forEach(name => body.appendChild(this.createChip(name, area)));
      return zone;
    }

    namesIn(area) {
      const state = this.state.getState();
      switch (area) {
        case "row": return state.rows;
        case "column": return state.columns;
        case "data": return state.values.map(value => value.field);
        case "filter": return state.filters.map(filter => filter.field);
        default: return state.available;
      }
    }

    createAvailable() {
      const document = root.document;
      const section = document.createElement("section");
      section.className = "pivot-field-list";
      section.dataset.zone = "available";

      const head = document.createElement("div");
      head.className = "pivot-section__head";
      head.textContent = this.labels.available;
      section.appendChild(head);

      this.namesIn("available")
        .forEach(name => section.appendChild(this.createChip(name, "available")));

      return section;
    }

    render() {
      const document = root.document;
      const grid = document.createElement("div");
      grid.className = "pivot-layout-grid";
      ZONES.forEach(area => grid.appendChild(this.createZone(area)));

      this.host.replaceChildren(this.createAvailable(), grid);
    }

    async apply(mutation) {
      // A refused mutation must not reach the widget, so the state runs first.
      mutation();
      this.render();
      await this.widget.update(this.state.toRequestState());
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.host.replaceChildren();
    }
  }

  PivotForge.PivotFieldDesigner = PivotFieldDesigner;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotFieldDesigner;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pivot-field-designer.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the chip styles**

Append to `src/PivotForge.AspNetCore/wwwroot/css/pivotforge.css`, matching the file's existing custom-property conventions:

```css
.pivot-chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  margin: 0.125rem 0;
  border: 1px solid var(--pt-border);
  border-radius: 0.375rem;
  background: var(--pt-surface);
  cursor: grab;
  font-size: 0.8125rem;
}

.pivot-chip[draggable="true"]:active {
  cursor: grabbing;
}

.pivot-chip__aggregation {
  margin-left: auto;
  font-size: 0.75rem;
}

.pivot-chip__remove {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.125rem;
}

.pivot-chip__remove:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
```

Before writing these, read the top of `pivotforge.css` and use the custom property names it actually defines. If `--pt-border` or `--pt-surface` do not exist, substitute the nearest equivalents the file already uses and say so in your report.

- [ ] **Step 6: Run the full JS suite**

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/PivotForge.AspNetCore/wwwroot/js/pivot-field-designer.js src/PivotForge.AspNetCore/wwwroot/css/pivotforge.css tests/pivot-field-designer.test.js
git commit -m "feat(designer): surukle birak alan tasarimcisi paneli eklendi"
```

---

### Task 5: C# area, role, and validation

The Razor half of the field model. These types only carry configuration; the role rules are enforced in JavaScript, and this layer rejects declarations that could never be valid.

**Files:**
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotArea.cs`
- Create: `src/PivotForge.AspNetCore/Rendering/PivotFieldRole.cs`
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotFieldBuilder.cs`
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotFieldTagHelper.cs`
- Test: `tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PivotArea.Available`; `enum PivotFieldRole { Dimension, Measure }`; `PivotFieldBuilder.Role(PivotFieldRole)`; `PivotFieldTagHelper.Role` bound to the `role` attribute. `Build()` emits `role` as a lower-camelCase string whenever it was set explicitly, and throws when an `Available` field has no role or when a role contradicts its area.

- [ ] **Step 1: Write the failing tests**

Append to `tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs`:

```csharp
    [Fact]
    public void AvailableAreaSerializesAsLowerCamelCase()
    {
        var field = new PivotFieldBuilder()
            .DataField("miktar")
            .Area(PivotArea.Available)
            .Role(PivotFieldRole.Measure)
            .Build();

        Assert.Equal("available", field["area"]);
        Assert.Equal("measure", field["role"]);
    }

    [Theory]
    [InlineData(PivotFieldRole.Dimension, "dimension")]
    [InlineData(PivotFieldRole.Measure, "measure")]
    public void EveryRoleSerializesAsLowerCamelCase(PivotFieldRole role, string expected)
    {
        var area = role == PivotFieldRole.Measure ? PivotArea.Data : PivotArea.Row;
        var field = new PivotFieldBuilder().DataField("alan").Area(area).Role(role).Build();

        Assert.Equal(expected, field["role"]);
    }

    [Fact]
    public void RoleIsOmittedWhenNotSetSoJavaScriptInfersIt()
    {
        var field = new PivotFieldBuilder().DataField("urun").Area(PivotArea.Row).Build();

        Assert.False(field.ContainsKey("role"));
    }

    [Fact]
    public void AnAvailableFieldWithoutARoleThrows()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder().DataField("miktar").Area(PivotArea.Available).Build());

        Assert.Contains("miktar", exception.Message, StringComparison.Ordinal);
        Assert.Contains("Role", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void AMeasureOutsideTheDataAreaThrows()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder()
                .DataField("tutar")
                .Area(PivotArea.Row)
                .Role(PivotFieldRole.Measure)
                .Build());

        Assert.Contains("tutar", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ADimensionInTheDataAreaThrows()
    {
        Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder()
                .DataField("urun")
                .Area(PivotArea.Data)
                .Role(PivotFieldRole.Dimension)
                .Build());
    }

    [Fact]
    public void AnAggregationOnAnAvailableFieldThrows()
    {
        Assert.Throws<InvalidOperationException>(
            () => new PivotFieldBuilder()
                .DataField("miktar")
                .Area(PivotArea.Available)
                .Role(PivotFieldRole.Measure)
                .Aggregation(PivotAggregation.Sum)
                .Build());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: FAIL — compile error, `PivotFieldRole` does not exist.

- [ ] **Step 3: Add the enum member and the role enum**

In `src/PivotForge.AspNetCore/Rendering/PivotArea.cs`, add a member after `Filter`:

```csharp
    /// <summary>Offers the field in the designer's catalog without placing it in the layout.</summary>
    Available
```

Create `src/PivotForge.AspNetCore/Rendering/PivotFieldRole.cs`:

```csharp
namespace PivotForge.AspNetCore.Rendering;

/// <summary>Specifies which pivot areas a field may occupy.</summary>
public enum PivotFieldRole
{
    /// <summary>Groups records; valid in the row, column, and filter areas.</summary>
    Dimension,
    /// <summary>Is aggregated; valid in the data area.</summary>
    Measure
}
```

- [ ] **Step 4: Add the builder method and validation**

In `PivotFieldBuilder.cs`, add the backing field beside the others:

```csharp
    private PivotFieldRole? _role;
```

Add the fluent method after `Area`:

```csharp
    /// <summary>Sets which areas the field may occupy.</summary>
    /// <param name="role">The field's role.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Role(PivotFieldRole role)
    {
        _role = role;
        return this;
    }
```

In `Build()`, immediately after the existing `DataField` null check, insert:

```csharp
        if (_area == PivotArea.Available && _role is null)
        {
            throw new InvalidOperationException(
                $"Field \"{_dataField}\" is in the Available area, so Role must be set explicitly; there is no area to infer it from.");
        }

        if (_role is { } role)
        {
            var expected = _area == PivotArea.Data ? PivotFieldRole.Measure : PivotFieldRole.Dimension;
            if (_area != PivotArea.Available && role != expected)
            {
                throw new InvalidOperationException(
                    $"Field \"{_dataField}\" is in the {_area} area, so its Role cannot be {role}.");
            }
        }
```

The existing aggregation guard already rejects an aggregation outside `Data`, which now covers `Available` as well.

In the dictionary `Build()` returns, emit the role after `area`:

```csharp
        if (_role is { } declaredRole)
        {
            field["role"] = ToCamelCase(declaredRole.ToString());
        }
```

- [ ] **Step 5: Bind the attribute in the tag helper**

In `PivotFieldTagHelper.cs`, add the property after `Area`:

```csharp
    /// <summary>Gets or sets which areas the field may occupy.</summary>
    /// <remarks>
    /// Declared non-nullable so Razor accepts the unqualified <c>role="Measure"</c> form;
    /// whether the author wrote the attribute is tracked through the element's attributes.
    /// </remarks>
    [HtmlAttributeName("role")]
    public PivotFieldRole Role { get; set; }
```

In `ApplyTo`, after the `show-as` block, add:

```csharp
        if (_writtenAttributes.Contains("role"))
        {
            builder.Role(Role);
        }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: PASS, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/PivotForge.AspNetCore/Rendering tests/PivotForge.AspNetCore.Tests/PivotFieldBuilderTests.cs
git commit -m "feat(razor): available bolgesi ve alan rolu eklendi"
```

---

### Task 6: Declaring a designer host

The grid opts in by naming a host element, so the consumer keeps control of where the panel sits.

**Files:**
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotGridBuilder.cs`
- Modify: `src/PivotForge.AspNetCore/Rendering/PivotGridTagHelper.cs`
- Modify: `src/PivotForge.AspNetCore/wwwroot/js/pivot-widget.js`
- Test: `tests/PivotForge.AspNetCore.Tests/PivotGridBuilderTests.cs`
- Test: `tests/pivot-widget.test.js`

**Interfaces:**
- Consumes: `PivotLayoutState` (Task 2), `PivotFieldDesigner` (Task 4), `PivotGridBuilder` conventions (existing).
- Produces: `PivotGridBuilder.FieldDesigner(string selector)`; `<pivot-grid field-designer="#host">`; the `fieldDesigner` option on `PivotForge.create`, which constructs the state and designer and exposes them as `widget.designer`.

- [ ] **Step 1: Write the failing C# test**

Append to `tests/PivotForge.AspNetCore.Tests/PivotGridBuilderTests.cs`:

```csharp
    [Fact]
    public void FieldDesignerSelectorReachesTheConfiguration()
    {
        var config = ConfigOf(SalesGrid().FieldDesigner("#designerHost"));

        Assert.Equal("#designerHost", config.GetProperty("fieldDesigner").GetString());
    }

    [Fact]
    public void FieldDesignerIsOmittedWhenNotRequested()
    {
        Assert.False(ConfigOf(SalesGrid()).TryGetProperty("fieldDesigner", out _));
    }
```

- [ ] **Step 2: Write the failing JS test**

Append to `tests/pivot-widget.test.js`:

```js
test("create builds a designer when fieldDesigner is supplied", () => {
  const designerHost = createContainer();
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: () => designerHost };

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
```

- [ ] **Step 3: Run both to verify they fail**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: FAIL — `FieldDesigner` does not exist.

Run: `node --test tests/pivot-widget.test.js`
Expected: FAIL — `widget.designer` is undefined.

- [ ] **Step 4: Add the builder method**

In `PivotGridBuilder.cs`, add after `CssClass`:

```csharp
    /// <summary>Renders an interactive field designer into the element matching a selector.</summary>
    /// <param name="selector">A CSS selector for the designer's host element.</param>
    /// <returns>The same builder.</returns>
    public PivotGridBuilder FieldDesigner(string selector) => Set("fieldDesigner", selector);
```

- [ ] **Step 5: Add the tag helper attribute**

In `PivotGridTagHelper.cs`, add the property after `CssClass`:

```csharp
    /// <summary>Gets or sets a CSS selector for the field designer's host element.</summary>
    [HtmlAttributeName("field-designer")]
    public string? FieldDesigner { get; set; }
```

In `ProcessAsync`, after the `CssClass` block:

```csharp
        if (FieldDesigner is not null)
        {
            builder.FieldDesigner(FieldDesigner);
        }
```

- [ ] **Step 6: Construct the designer in the widget**

In `pivot-widget.js`, add `fieldDesigner: null` to `DEFAULTS`. Then in the `PivotWidget` constructor, after `this.renderer = ...`, add:

```js
      this.layoutState = null;
      this.designer = null;

      if (this.options.fieldDesigner) {
        if (!PivotForge.PivotLayoutState || !PivotForge.PivotFieldDesigner) {
          throw new Error(
            "fieldDesigner requires pivot-layout-state.js and pivot-field-designer.js to be loaded."
          );
        }

        this.layoutState = new PivotForge.PivotLayoutState(this.options.fields);
        this.designer = new PivotForge.PivotFieldDesigner(this.options.fieldDesigner, {
          state: this.layoutState,
          widget: this
        });
      }
```

In `dispose()`, before `this.container.replaceChildren()`, add:

```js
      this.designer?.dispose();
      this.designer = null;
```

- [ ] **Step 7: Run both suites to verify they pass**

Run: `dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release`
Expected: PASS, 0 warnings.

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/PivotForge.AspNetCore tests/PivotForge.AspNetCore.Tests/PivotGridBuilderTests.cs tests/pivot-widget.test.js
git commit -m "feat(razor): field-designer niteligi ve widget entegrasyonu eklendi"
```

---

### Task 7: Replace the demo's hand-written designer

The integration proof. This targets the demo's largest component, so a substantial line reduction is the expected outcome; its absence means the design missed.

**Files:**
- Modify: `samples/PivotForge.MvcDemo/Views/Home/Index.cshtml`
- Modify: `samples/PivotForge.MvcDemo/Views/Shared/_Layout.cshtml`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Load the new scripts**

In `_Layout.cshtml`, add after `pivot-widget.js` (order matters — the designer needs both the state and the widget):

```html
    <script src="~/_content/PivotForge.AspNetCore/js/pivot-layout-state.js" asp-append-version="true"></script>
    <script src="~/_content/PivotForge.AspNetCore/js/pivot-field-designer.js" asp-append-version="true"></script>
```

- [ ] **Step 2: Declare the full catalog and the designer host**

In `Index.cshtml`, replace the `<pivot-grid>` element's contents so the catalog covers every `SalesRecord` property, and point the grid at the existing sidebar as its designer host. Read the current markup first; the sidebar element is `<aside class="pivot-sidebar">`. Give it `id="designerHost"` and empty it of the hand-written zones.

```cshtml
<pivot-grid id="pivotGrid"
            auto-load="false"
            allow-sorting="true"
            allow-filtering="true"
            allow-drill-down="true"
            allow-excel-export="true"
            field-designer="#designerHost"
            source-row-count="@Model.Count">
    <pivot-field field="Region" caption="Bölge" area="Row" />
    <pivot-field field="Category" caption="Kategori" area="Row" />
    <pivot-field field="Year" caption="Yıl" area="Column" />
    <pivot-field field="Amount" caption="Tutar" area="Data" aggregation="Sum" />
    <pivot-field field="SalesPerson" caption="Satış Temsilcisi" area="Available" role="Dimension" />
    <pivot-field field="Quarter" caption="Çeyrek" area="Available" role="Dimension" />
    <pivot-field field="Quantity" caption="Miktar" area="Available" role="Measure" />
    <pivot-field field="Discount" caption="İskonto" area="Available" role="Measure" />
</pivot-grid>
```

Set `auto-load` to `true` once the hand-written designer is gone, because nothing will rebuild the layout at runtime any more.

- [ ] **Step 3: Delete the superseded code**

Remove the hand-written designer: the `fields` catalog array, `defaultLayout`, `cloneLayout`, the chip rendering functions, the drag-and-drop handlers, the zone rendering, the field search wiring, `syncWidgetRequest`, and the `layout` object itself.

Keep everything the deferred features need: saved views (`PivotViewStore`), conditional formatting, selection and clipboard handlers, the large-data path, and the Excel export. Where they read the layout, source it from `widget.layoutState.getState()` instead.

Losing a working feature is worse than removing fewer lines. If a deferred feature cannot be cleanly separated from the designer code, keep it and report exactly what you kept and why.

- [ ] **Step 4: Build and run every suite**

Run:
```bash
dotnet build PivotForge.slnx -c Release
node --test tests/*.test.js
dotnet test tests/PivotForge.Core.Tests/PivotForge.Core.Tests.csproj -c Release
dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release
```
Expected: build succeeds with 0 warnings; all suites pass.

- [ ] **Step 5: Verify the rendered page**

Run the demo and fetch both pages:

```bash
dotnet run --project samples/PivotForge.MvcDemo/PivotForge.MvcDemo.csproj --no-launch-profile > /tmp/demo.log 2>&1 &
```

Wait for `Now listening on`, then confirm `/` emits the designer host, the grid container, and a config carrying `fieldDesigner`. Stop the server afterwards.

Interactive drag-and-drop cannot be verified without a browser. Report that explicitly rather than claiming it works.

- [ ] **Step 6: Record the reduction**

Run: `git diff --stat HEAD -- samples/PivotForge.MvcDemo/Views/Home/Index.cshtml`

Note the line count removed. This is the practical measure the spec asks for.

- [ ] **Step 7: Commit**

```bash
git add samples/PivotForge.MvcDemo
git commit -m "refactor(demo): elle yazilmis tasarimci paketlenmis olanla degistirildi"
```

---

### Task 8: Documentation and version bump

**Files:**
- Modify: `README.md`
- Modify: `docs/aspnetcore-integration.md`
- Modify: `docs/public-api.md`
- Modify: `src/PivotForge.AspNetCore/README.md`
- Modify: `src/PivotForge.Core/PivotForge.Core.csproj`
- Modify: `src/PivotForge.AspNetCore/PivotForge.AspNetCore.csproj`
- Modify: `samples/PivotForge.MvcDemo/README.md`

**Interfaces:**
- Consumes: the full public surface from Tasks 1-6.
- Produces: nothing.

- [ ] **Step 1: Document the designer in the integration guide**

In `docs/aspnetcore-integration.md`, add a "Field designer" section under the Declarative API heading covering: the `field-designer` attribute and `FieldDesigner(selector)` builder method; the `Available` area and the `role` attribute, including that `role` is required for `Available` fields and inferred elsewhere; the role rules; `PivotLayoutState`'s methods; `PivotFieldDesigner`'s constructor and `dispose`; and `widget.update()`.

State the script order explicitly: `pivot-table.js`, then `pivot-request-builder.js`, then `pivot-widget.js`, then `pivot-layout-state.js`, then `pivot-field-designer.js`.

State plainly that the designer is desktop-only — HTML5 drag-and-drop does not fire on touch devices — and that filter value selection, the show-as menu, and the sort panel are not included.

- [ ] **Step 2: Add a designer example to both READMEs**

In `README.md` and `src/PivotForge.AspNetCore/README.md`, add the markup example:

```cshtml
<div id="designerHost"></div>

<pivot-grid id="pivotGrid" field-designer="#designerHost">
    <pivot-field field="Region"   caption="Bölge"  area="Row" />
    <pivot-field field="Year"     caption="Yıl"    area="Column" />
    <pivot-field field="Amount"   caption="Tutar"  area="Data" aggregation="Sum" />
    <pivot-field field="Quantity" caption="Miktar" area="Available" role="Measure" />
</pivot-grid>
```

Update the version numbers in the installation commands and the "current preview" line to `0.3.0-preview.1`.

- [ ] **Step 3: Record the new public surface**

In `docs/public-api.md`, set the version line to `0.3.0-preview.1`. Add `PivotFieldRole` and `PivotArea.Available` to the declarative rendering list, add `PivotGridBuilder.FieldDesigner`, and add `PivotForge.PivotLayoutState` and `PivotForge.PivotFieldDesigner` to the browser API list. Note `widget.update()` alongside `updateFields`.

- [ ] **Step 4: Bump both package versions**

Set `<Version>0.3.0-preview.1</Version>` in both csproj files.

Set the AspNetCore release notes to:

```xml
<PackageReleaseNotes>Add an interactive field designer: drag-and-drop layout building, a field catalog with dimension and measure roles, and batched widget updates.</PackageReleaseNotes>
```

Set the Core release notes to:

```xml
<PackageReleaseNotes>Version-aligned preview release for the PivotForge.AspNetCore field designer.</PackageReleaseNotes>
```

Core ships no designer code, so its notes must not claim the feature.

- [ ] **Step 5: Update the demo README**

In `samples/PivotForge.MvcDemo/README.md`, change the "Field drag-and-drop" bullet to say the designer now comes from the package rather than the demo.

- [ ] **Step 6: Verify build, tests, and pack**

Run:
```bash
dotnet build PivotForge.slnx -c Release
node --test tests/*.test.js
dotnet test tests/PivotForge.Core.Tests/PivotForge.Core.Tests.csproj -c Release
dotnet test tests/PivotForge.AspNetCore.Tests/PivotForge.AspNetCore.Tests.csproj -c Release
dotnet pack src/PivotForge.Core/PivotForge.Core.csproj -c Release -o artifacts/packages
dotnet pack src/PivotForge.AspNetCore/PivotForge.AspNetCore.csproj -c Release -o artifacts/packages
unzip -l artifacts/packages/PivotForge.AspNetCore.0.3.0-preview.1.nupkg | grep -E "pivot-layout-state|pivot-field-designer"
```
Expected: 0 warnings, all suites pass, and both new JS files appear under `staticwebassets`.

- [ ] **Step 7: Commit**

```bash
git add README.md docs src samples/PivotForge.MvcDemo/README.md
git commit -m "docs(release): alan tasarimcisi belgelendi ve surum 0.3.0-preview.1 yapildi"
```

---

## Self-Review Notes

Checked against the spec:

- `PivotArea.Available`, `PivotFieldRole`, role inference, contradiction and missing-role errors → Tasks 1 and 5.
- Catalog as the union of all declared fields; `available` derived → Task 2.
- Role rules constraining drops → Task 2, mutation-proven in Step 5.
- Last-data-field guard, in state and in the disabled control → Tasks 2 and 4.
- `PivotLayoutState` full method list, one `change` event per mutation → Task 2.
- `PivotFieldDesigner` constructor, rendered structure, drag-and-drop, `dispose` → Task 4.
- `widget.update()` batching → Task 3.
- Request builder tolerating `available` and carrying `role` → Task 1.
- `field-designer` selector on both Razor entry points and `PivotForge.create` → Task 6.
- Failure behavior: invalid drop refused, unknown catalog field, missing role, designer without widget → Tasks 2, 4, 5.
- Testing: exhaustive pure-state suite, DOM-stub designer suite, parity through `buildRequest`, demo as integration proof → Tasks 2, 4, 7.
- Compatibility and `0.3.0-preview.1` → Task 8, verified by pack in Step 6.

One decision made while planning, not stated in the spec: a measure moved into the data area receives `"sum"`. The spec left the default unstated, and `"sum"` matches what `normalizeField` already applies when `aggregation` is omitted, so the two layers agree.
