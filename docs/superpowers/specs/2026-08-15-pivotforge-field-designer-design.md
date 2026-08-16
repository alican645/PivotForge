# PivotForge Field Designer Design

## Goal

Move the interactive field designer — the searchable field list and the four
drag-and-drop zones that let a user compose a pivot layout at runtime — out of
the MVC demo and into `PivotForge.AspNetCore`.

Today the designer is roughly 2500 lines of hand-written view code in
`samples/PivotForge.MvcDemo/Views/Home/Index.cshtml`. Nothing in the package
knows how to build a layout interactively; `PivotForge.create` accepts a fixed
field list and renders it. A consumer who wants what the demo has must write
the demo's code themselves.

This design adds that capability as an opt-in browser module, so a consumer can
declare a designer host and get the demo's core experience without writing
drag-and-drop code.

## Non-Goals

Touch and pointer input are out of scope. The designer uses HTML5 drag-and-drop,
which does not fire on touch devices. Supporting tablets requires a
pointer-events implementation of dragging, which is its own body of work and its
own test surface. Reporting applications are predominantly desktop, so this
version targets desktop and says so in its documentation rather than pretending
otherwise.

Filter value selection, the show-as menu, and the sort panel remain out of
scope. They exist in the demo and stay reachable through the lower-level API.
Deferring them keeps this version's public surface small enough to review
carefully.

Saved-view integration is out of scope. `PivotViewStore` already ships, and the
designer's state is serializable, so a consumer can persist layouts today.
Wiring the two together automatically is a separate decision about ownership of
persistence.

The designer does not render pivot results. It composes a layout and hands it to
a widget; the widget still owns fetching and rendering.

## Architecture

Three units, with dependencies flowing in one direction only.

```
PivotFieldDesigner ──uses──▶ PivotLayoutState  (pure; no DOM)
        │
        └──calls──▶ PivotWidget.update(...)
```

`PivotLayoutState` ships as `wwwroot/js/pivot-layout-state.js` and owns the
field catalog, the current layout, the validity rules, and every mutation. It
touches no DOM and performs no I/O.

`PivotFieldDesigner` ships as `wwwroot/js/pivot-field-designer.js` and owns
markup, drag-and-drop event wiring, and visual feedback. It delegates every
decision to the state.

`PivotWidget` gains one method, `update`. It does not learn about the designer;
the dependency points the other way, so a consumer using only the widget
downloads nothing extra and the widget's tests need no designer.

This split is deliberate rather than stylistic. Layout mutation — moving a field
between zones, preserving order, rejecting an invalid target — is where the
logic errors live, and it is exactly the kind of behavior that becomes hard to
test once it is entangled with DOM events. Three tests in the declarative API
branch were found to pass vacuously, and all three asserted DOM-adjacent
behavior. A pure state core is the structural answer to that failure mode.

## Field Catalog and Roles

The designer needs to know which fields exist, not merely which are placed. The
declared `<pivot-field>` elements describe a layout; the catalog is a superset.

Two concepts are added to the field model.

### `PivotArea.Available`

A field may be declared as present in the catalog but absent from the layout:

```cshtml
<pivot-field field="Region"   caption="Bölge"   area="Row" />
<pivot-field field="Amount"   caption="Tutar"   area="Data" aggregation="Sum" />
<pivot-field field="Discount" caption="İskonto" area="Available" role="Measure" />
```

The catalog is the union of **all** declared fields, whatever their area. A user
who drags `Year` out of the columns zone finds it in the available list and can
put it back. A catalog restricted to `Available` fields would make removal
irreversible, which is not a designer.

### `PivotFieldRole`

A new enum with two members, `Dimension` and `Measure`.

A `Measure` may occupy only the data area. A `Dimension` may occupy the row,
column, and filter areas. Without this rule the designer would let a user drag
`Amount` into the rows zone, producing a pivot whose row headers are raw
currency values — technically valid, practically meaningless.

Role is inferred where the declaration makes it unambiguous: a field declared in
the `Data` area is a `Measure`, and a field declared in `Row`, `Column`, or
`Filter` is a `Dimension`. For `Available` fields there is no context to infer
from, so `role` is **required**; omitting it throws at render time with the
field name in the message.

An explicit `role` that contradicts the field's declared area is an error, not a
silent override — for example `area="Data" role="Dimension"`.

## Layout State Contract

```js
const state = new PivotForge.PivotLayoutState(catalog, layout);
```

`catalog` is the normalized field list. `layout` is optional; when omitted, the
layout is derived from the catalog's declared areas.

State is exposed as a plain object:

```js
{
  rows:      ["Region", "Category"],
  columns:   ["Year"],
  values:    [{ field: "Amount", aggregation: "sum", showAs: "normal" }],
  filters:   [{ field: "Quarter", values: ["Q1"] }],
  available: ["SalesPerson", "Quantity", "Discount"]
}
```

`available` is derived, never assigned: it is every catalog field not currently
placed. Storing it independently would allow the two to disagree.

### Operations

| Method | Behavior |
| --- | --- |
| `canDrop(field, area)` | `true` when the field's role permits the area and the field is not already there. Pure; drives drag feedback. |
| `move(field, area, index)` | Validates via `canDrop`, removes the field from its current area, inserts it at `index`. Omitting `index` appends to the end of the target area. Throws if invalid. |
| `remove(field)` | Returns the field to `available`. Throws when it is the last data field. |
| `reorder(area, fromIndex, toIndex)` | Reorders within one area. |
| `setAggregation(field, aggregation)` | Changes a data field's aggregation. Throws when the field is not in the data area. |
| `getState()` | Returns a deep copy of the state object above. |
| `toFields()` | Returns the flat field array `PivotForge.create` and `buildRequest` consume. |
| `toRequestState()` | Returns `{ fields, filters }` for `PivotWidget.update`. It never returns `rowSort`, because sorting is not part of this version's designer; a widget's existing sort survives a layout change untouched. |
| `on(event, handler)` | Subscribes to `change`; returns an unsubscribe function. |

Every mutating operation emits exactly one `change` event, including no-op
reorders, so a subscriber never has to diff to detect a settled state.

### The last data field

`remove` throws when the field is the only one in the data area, because a pivot
request without a value definition is invalid and would fail server-side. The
designer disables that chip's remove control and explains why in its title
attribute, so the user never reaches the throwing path — the exception exists to
protect programmatic callers, not to be seen.

## Designer Contract

```js
const designer = new PivotForge.PivotFieldDesigner(host, { state, widget, labels });
```

`host` is an element or selector. `widget` is the `PivotWidget` the designer
drives. `labels` optionally overrides the panel's Turkish default strings.

`designer.dispose()` detaches listeners and clears the host, matching the
widget's lifecycle contract.

### Rendered structure

The designer renders into `host`:

- a search input filtering the available list
- the available field list
- four zones — filters, columns, rows, values — each with a header, a count, and a body

Chips carry the field's caption, a remove control, and, in the values zone, an
aggregation selector.

The class names reuse what `wwwroot/css/pivotforge.css` already defines:
`pivot-field-list`, `pivot-layout-grid`, `pivot-zone`, `pivot-zone__head`,
`pivot-zone__body`, `pivot-search`. Those rules exist today because the demo's
markup was written against them and the stylesheet was packaged with it. Only
the chip internals need new rules.

### Interaction

Dragging uses HTML5 `dragstart` / `dragover` / `drop`. `dragover` consults
`state.canDrop` and sets the drop effect accordingly, so an invalid target
refuses the drop rather than accepting and reverting it.

Every state change results in exactly one call:

```js
await widget.update(state.toRequestState());
```

One drag produces one server request. This is the reason `update` exists.

## Widget Update Contract

```js
await widget.update({ fields, filters, rowSort });
```

Each member is optional; supplied members replace the widget's corresponding
state and the widget refreshes once. Omitted members are left untouched.

This closes a gap recorded during the declarative API review: the widget had no
public way to set several state pieces and refresh a single time, which is why
the demo migration reached into `options.fields`, `filters`, `rowSort`, and
`renderer.options` directly. With `update`, that reaching becomes unnecessary,
and the designer never needs internals at all.

`updateFields` remains, unchanged, as the single-concern case.

## Request Builder Changes

`pivot-request-builder.js` currently rejects any area outside `row`, `column`,
`data`, and `filter`. It gains `available` as a known area that contributes
nothing to the request: an available field is catalog metadata, not layout.

`normalizeField` also gains `role`, defaulting by the inference rule above.
`buildRequest` ignores `role` entirely — it exists for the designer, and sending
it to the server would imply the engine cares.

These are additive: an existing field list with no `available` entries and no
`role` produces a byte-identical request.

## Declarative Integration

The grid opts in by naming a host element:

```cshtml
<div id="designerHost"></div>

<pivot-grid id="pivotGrid" field-designer="#designerHost">
    <pivot-field field="Region"   caption="Bölge"    area="Row" />
    <pivot-field field="Category" caption="Kategori" area="Row" />
    <pivot-field field="Year"     caption="Yıl"      area="Column" />
    <pivot-field field="Amount"   caption="Tutar"    area="Data" aggregation="Sum" />
    <pivot-field field="Quantity" caption="Miktar"   area="Available" role="Measure" />
    <pivot-field field="Quarter"  caption="Çeyrek"   area="Available" role="Dimension" />
</pivot-grid>
```

A selector rather than a boolean, because the panel's placement is the
consumer's decision. The demo places it in a sidebar beside the table; a
boolean that injected the panel above the grid could not express that, and
dictating layout is what pushed this design away from putting the designer
inside the widget.

`PivotGridBuilder` gains `FieldDesigner(string selector)`. `PivotForge.create`
gains a `fieldDesigner` option taking the same selector, and constructs the
state and designer when it is present.

## Failure Behavior

A drop whose role is not permitted is refused during `dragover`; no state
changes and no request is sent.

A layout naming a field absent from the catalog throws at construction, naming
the field. This is a programming error, not user input, so it fails loudly and
early.

An `Available` field declared without a `role` throws at render time from
`PivotFieldBuilder`, naming the field — the same place and shape as the existing
"aggregation outside the data area" validation.

A designer constructed without a widget, or with a host selector matching
nothing, throws immediately at the call site.

A failed `update` leaves the designer's state as the user left it and surfaces
the error through the widget's existing `error` event. Reverting the panel to
match a failed server call would discard the user's work.

## Testing

`PivotLayoutState` is covered exhaustively by `node --test`, following the
existing `tests/*.test.js` pattern: every role and area combination through
`canDrop`, ordering across `move` and `reorder`, the last-data-field guard,
derived `available` correctness after each operation, event emission counts, and
every throwing path. This suite carries the design's weight and needs no DOM.

`PivotFieldDesigner` is covered with the fake-container pattern the widget tests
already use, asserting that drag events reach the right state calls, that an
invalid drop calls nothing, and that one change produces exactly one `update`.

A parity test asserts that `state.toFields()` output passes `buildRequest`
without error for every reachable layout shape, so the two modules cannot drift.

C# coverage adds the `Available` area, the `PivotFieldRole` enum, role
inference, the contradictory-role error, the missing-role error, and
`FieldDesigner(selector)` reaching the emitted configuration.

The demo is the integration proof. `Index.cshtml`'s hand-written designer is
replaced by the packaged one, and the resulting line reduction is this design's
practical measure. Unlike the declarative API's demo migration — which moved
plumbing but not mass — this migration targets the demo's largest component, so
a substantial reduction is the expected outcome and its absence would be a
signal that the design missed.

## Compatibility

Additive. No existing public member changes signature or behavior; the two new
JavaScript modules are separate files a consumer opts into, and the field model
gains members that default to today's behavior when absent.

This ships as `0.3.0-preview.1`: new feature surface, no breaks, still inside
the `0.x` preview line.
