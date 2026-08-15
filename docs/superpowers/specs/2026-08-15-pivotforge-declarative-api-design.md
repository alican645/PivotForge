# PivotForge Declarative API Design

## Goal

Give consumers a declarative, single-call way to place an interactive pivot
table on a page, comparable to the ergonomics of commercial grid components.
Today the only supported path is manual orchestration: create a
`PivotTableRenderer`, build a `PivotRequest`, call `fetch`, and wire every
interaction by hand. The MVC demo needs 2556 lines of view code to do this.

This design adds two layers above the existing engine: a browser widget that
owns orchestration, and a Razor builder that emits configuration for that
widget. Both are additive. The packaging design already anticipated this work,
stating that "the inline orchestration currently living in the demo view will
move behind a reusable client API."

## Non-Goals

Client-side aggregation is explicitly out of scope. Computing pivots in the
browser would mean writing and maintaining a second engine in JavaScript, with
a second test suite and unavoidable behavior drift from the .NET engine. It
would also forfeit drill-down, Excel export, large-result paging, and
cancellation, which exist only on the server. Data therefore always comes from
a provider registered through `AddPivotForge<TRecord>`.

Inline literal data supplied at the call site is not supported in this
version, because it has no meaning without client-side aggregation.

jQuery is not a dependency. The package's stated value is that it is
dependency-light, and requiring jQuery to initialize a widget would contradict
that.

## Architecture

Three layers, each depending only on the one below it.

The existing layer is unchanged: `PivotEngine`, the HTTP endpoints, and
`PivotTableRenderer`. No public member changes and no behavior changes.

The widget layer is new JavaScript, shipped as
`wwwroot/js/pivot-widget.js` and exposed as `PivotForge.create`. It owns
field-to-request translation, endpoint calls, renderer lifecycle, and
interaction wiring.

The Razor layer is new C#, exposed as `Html.PivotForge().PivotGrid()`. It
builds a configuration object, serializes it to JSON, and emits a container
element plus an initialization call. It performs no pivot logic.

## Field Model

Configuration centers on a single flat `fields` list. Each field names a source
column and assigns it to an area:

```js
{ caption: "Tutar", dataField: "tutar", area: "data", aggregation: "sum" }
```

Areas are `row`, `column`, `data`, and `filter`. Fields in `row` and `column`
become the corresponding header axes in source order. Fields in `data` become
value definitions. Fields in `filter` are available to the filter UI but do not
participate in layout.

A `data` field carries `aggregation` (`sum`, `count`, `average`, `min`, `max`)
and optionally `showAs`. A field may carry `caption` for display, `format` for
value formatting, and `visible` to participate in configuration while hidden.

### Translation Ownership

Translation from the field model to `PivotRequest` happens **only in
JavaScript**. The Razor builder does not translate; it serializes the same
field model the JavaScript API accepts.

This is deliberate. Two translators, one in C# and one in JavaScript, would be
two things to keep synchronized, and they would drift. With one translator, the
Razor builder is a thin serializer and the two entry points cannot disagree.

`caption` and `format` are presentation-only and are not sent to the server.

## Widget Contract

`PivotForge.create(target, options)` accepts an element or a selector string
and returns a controller instance. Creation is synchronous; the first data load
begins immediately and is observable through the returned instance.

Options are `fields`, `endpointPrefix` (default `/pivotforge`), `allowSorting`,
`allowFiltering`, `allowDrillDown`, `allowExcelExport`, `largeData`,
`pageSize`, `sourceRowCount`, plus renderer passthrough options such as
`totalText` and `formatter`.

The returned controller exposes `refresh()`, `updateFields(fields)`,
`getState()`, `exportToExcel()`, and `dispose()`. It emits `dataLoading`,
`dataLoaded`, `error`, and `cellDoubleClick`.

`dispose()` must abort in-flight requests, detach event listeners, and clear
the container, so that a widget in a single-page navigation leaves nothing
behind.

## Razor Builder Contract

`Html.PivotForge()` returns a factory. `PivotGrid()` returns a builder whose
methods mirror the widget options and return the builder for chaining. The
builder implements `IHtmlContent`, so rendering happens when Razor writes it.

```csharp
@(Html.PivotForge().PivotGrid()
    .Id("pivotGrid")
    .AllowSorting(true)
    .AllowFiltering(true)
    .Fields(f =>
    {
        f.Add().Caption("Ürün").DataField("urun").Area(PivotArea.Row);
        f.Add().Caption("Yıl").DataField("yil").Area(PivotArea.Column);
        f.Add().Caption("Tutar").DataField("tutar")
            .Aggregation(PivotAggregation.Sum).Area(PivotArea.Data);
    }))
```

Output is a container `div` carrying the configuration as a JSON payload, plus
a script element that calls `PivotForge.create`. Configuration travels in a
`type="application/json"` script block rather than an inline call argument, so
that captions containing quotes cannot break out of the emitted script and so
the JSON payload itself is not subject to script CSP rules (`application/json`
is not executable). This does **not** make the builder's output CSP-safe end
to end: `PivotGridBuilder` also emits a second, inline `<script>PivotForge.create(...)</script>`
block with no nonce or hash support, and a strict Content Security Policy
without `unsafe-inline` blocks it. Supporting such a policy would
require adding nonce/hash support to the inline script; that is not
implemented by this branch.

`Id` is required; without it the builder throws at render time rather than
generating a random identifier, because a stable identifier is needed to
address the widget from other scripts.

The builder does not register services or map endpoints. Those remain explicit
application decisions.

## New Public Surface

`PivotForge.AspNetCore.Rendering` gains `PivotForgeHtmlHelperExtensions`,
`PivotForgeFactory`, `PivotGridBuilder`, `PivotFieldCollectionBuilder`,
`PivotFieldBuilder`, and the `PivotArea` enum. `PivotAggregation` and
`PivotShowAs` are reused from Core rather than duplicated.

`PivotForge.create` is added to the documented browser API.

## Scope

Included: field translation, data loading, rendering, sorting, filtering,
drill-down, Excel export, and large-result paging.

Deferred: saved views, conditional formatting, selection and clipboard UI, and
a drag-and-drop field designer. Each remains reachable through the existing
lower-level API exactly as the demo uses it today; deferral removes the
automatic wiring, not the capability.

## Failure Behavior

A field naming a column the provider does not supply produces the existing
`PivotFieldNotFoundException` server-side; the widget renders the returned
error message in place rather than leaving an empty container.

Configuration errors detectable without the server — no `data` field, an
unknown area, an aggregation on a non-`data` field — throw from
`PivotForge.create` immediately, so the mistake surfaces at the call site.

Superseded requests are aborted. A late response from an abandoned request must
never replace current state. A failed refresh leaves previously rendered data
visible and surfaces the error alongside it, rather than blanking the table.

Expired large-data sessions restart transparently on the next page request.

## Testing

Widget behavior is covered by `node --test`, following the existing
`tests/*.test.js` pattern: field translation for every area and aggregation,
option defaults, abort-on-supersede, error rendering, and `dispose()`
completeness.

Builder behavior is covered by xUnit: emitted markup, JSON payload shape,
HTML and JSON escaping of captions, the missing-`Id` failure, and parity
between builder output and the JavaScript field model.

The MVC demo is the integration proof. Its pivot section is rebuilt on the
builder, and the resulting reduction in view code is the practical measure of
whether this design achieved its goal.

## Compatibility

Entirely additive. No existing public member changes signature or behavior, and
the manual orchestration path stays supported and documented, since deferred
features still require it. This ships in the `0.x` preview line as
`0.2.0-preview.1`, a minor bump reflecting new surface with no breaks.
