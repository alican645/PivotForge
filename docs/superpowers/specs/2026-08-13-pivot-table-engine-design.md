# Pivot Table Engine Design

Date: 2026-08-13
Status: Approved for specification review

## Goal

Build a free, MIT-licensed pivot table engine for .NET projects. The first version focuses on a fast, server-side C# engine that existing ASP.NET, Blazor, and enterprise .NET applications can use without depending on paid browser pivot table products.

The MVP is not a visual grid. It produces a clean pivot result model and an ASP.NET-friendly JSON response shape that UI layers can render however they want.

## Scope

The first version includes:

- A pure C# core library.
- Server-side pivot execution for .NET and ASP.NET projects.
- Input from `IEnumerable<T>`, `DataTable`, and normalized JSON/CSV records.
- Basic aggregations: `sum`, `count`, `average`, `min`, and `max`.
- A sparse pivot result model with row headers, column headers, cells, grand totals, and metadata.
- An ASP.NET demo or adapter endpoint that accepts a JSON pivot request and returns `PivotResult` JSON.
- Performance that is reliable for 10,000 to 100,000 rows in a single request.

The first version excludes:

- Browser-side JavaScript execution.
- React, Vue, Angular, Blazor UI components, or any full grid UI.
- Direct SQL connection management.
- Excel export.
- Streaming, chunked processing, and million-row processing.
- Calculated fields, custom aggregators, percentages, and ratio calculations.
- Nested JSON field paths.

## Recommended Architecture

Use a pure C# engine as the product core.

### `PivotForge.Core`

This class library owns all pivot calculation behavior. It does not depend on ASP.NET, Blazor, JavaScript, or any UI framework.

Primary responsibilities:

- Validate pivot requests.
- Read values from supported data sources.
- Build row and column keys.
- Aggregate values in a single pass.
- Return a stable `PivotResult` model.

Suggested public model:

```csharp
public sealed class PivotRequest
{
    public string[] Rows { get; init; }
    public string[] Columns { get; init; }
    public PivotValueDefinition[] Values { get; init; }
}

public sealed class PivotValueDefinition
{
    public string Field { get; init; }
    public PivotAggregation Aggregation { get; init; }
}

public enum PivotAggregation
{
    Sum,
    Count,
    Average,
    Min,
    Max
}

public sealed class PivotResult
{
    public IReadOnlyList<IReadOnlyList<string?>> RowHeaders { get; init; }
    public IReadOnlyList<IReadOnlyList<string?>> ColumnHeaders { get; init; }
    public IReadOnlyList<PivotCell> Cells { get; init; }
    public IReadOnlyDictionary<string, decimal?> GrandTotals { get; init; }
    public PivotMetadata Metadata { get; init; }
}
```

Exact property types can be adjusted during implementation, but the result should remain simple to serialize and easy for any UI layer to consume.

### ASP.NET Demo or Adapter

The ASP.NET layer should be intentionally thin. It demonstrates how to receive a JSON request, call the core engine, and return the result as JSON.

Example endpoint:

```http
POST /api/pivot
Content-Type: application/json
```

Example request:

```json
{
  "rows": ["region"],
  "columns": ["year"],
  "values": [
    { "field": "amount", "aggregation": "sum" }
  ],
  "data": [
    { "region": "East", "year": 2026, "amount": 1200 }
  ]
}
```

Example response:

```json
{
  "rowHeaders": [["East"]],
  "columnHeaders": [["2026"]],
  "cells": [
    { "row": 0, "column": 0, "values": { "amount_sum": 1200 } }
  ],
  "grandTotals": { "amount_sum": 1200 }
}
```

## Data Sources

The core engine should support three input paths.

### `IEnumerable<T>`

This is the primary .NET usage path. A caller can pass a list of application objects and identify fields by name.

Example:

```csharp
var result = pivotEngine.Execute(
    orders,
    new PivotRequest
    {
        Rows = ["Region"],
        Columns = ["Year"],
        Values = [PivotValue.Sum("Amount")]
    });
```

Field access should not use reflection repeatedly per row. The engine should build and cache accessors for the input type and field names, then reuse those accessors while processing records.

### `DataTable`

`DataTable` support is important for older ASP.NET and enterprise systems. The engine should read fields by column name and validate missing columns before aggregation.

### JSON/CSV Records

The core engine should not become a file reader. JSON and CSV helpers should normalize flat records into a table-like structure that the engine can process.

Nested JSON paths are out of scope for the MVP.

## Aggregation Flow

The engine should process records in one pass:

1. Build a row key from the configured row fields.
2. Build a column key from the configured column fields.
3. Find or create the aggregation bucket for the row and column key.
4. Feed each configured value into its aggregator.
5. Finalize buckets into sparse `PivotCell` entries.
6. Compute grand totals and metadata.

Cells should be sparse. Empty row-column combinations should not be stored unless a later rendering helper explicitly needs a dense matrix.

`Average` should be implemented as sum plus count internally, then finalized at result generation time.

## Error Handling

Errors should be explicit and useful for application developers.

- Missing row, column, or value fields should produce `PivotFieldNotFoundException`.
- Unsupported aggregation values should produce a validation error before processing.
- `sum`, `average`, `min`, and `max` over incompatible field types should produce a clear type error.
- Empty data should return an empty but valid `PivotResult`.
- Null values should be handled consistently:
  - `count` counts non-null values for the selected field.
  - `sum`, `average`, `min`, and `max` ignore null values.

## Performance Target

The MVP target is fast and stable execution for 10,000 to 100,000 rows in a single request.

Implementation choices that support this:

- Single-pass aggregation.
- Cached field accessors for `IEnumerable<T>`.
- Column lookup caching for `DataTable`.
- Sparse cell storage.
- Minimal allocations in the hot path.
- No UI rendering inside the engine.

Streaming and million-row processing should be considered future work, not first-version scope.

## Testing Strategy

Core tests should cover:

- `sum`, `count`, `average`, `min`, and `max`.
- Single row field and single column field pivots.
- Multi-row and multi-column pivots.
- Multiple value definitions in one request.
- Empty data.
- Null values.
- Missing fields.
- Invalid aggregation requests.
- Type errors for numeric aggregations.
- `IEnumerable<T>` sources.
- `DataTable` sources.
- Normalized JSON and CSV record sources.

Performance checks should include simple benchmark or timing tests for 10,000, 50,000, and 100,000 rows. These do not need to be strict CI pass/fail gates at first, but they should make regressions visible while developing the engine.

## Future Work

Likely follow-up features:

- Blazor component.
- Browser-side TypeScript engine.
- Excel export.
- Direct SQL helper packages.
- Streaming/chunked processing.
- Custom aggregators.
- Calculated fields.
- Percent of row, percent of column, and percent of total.
- Nested JSON field paths.
- Dense matrix rendering helper for simple HTML tables.

## Approval Notes

The approved direction is:

- Use a pure C# engine first.
- Serve .NET, Blazor, and ASP.NET users first.
- Keep UI out of the MVP.
- Support `.NET` objects, `DataTable`, and normalized JSON/CSV records.
- Support only basic aggregations in the first version.
- Target 10,000 to 100,000 rows.
- Return a simple matrix/JSON-friendly model.
- Release under the MIT license.
