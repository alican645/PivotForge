using System.Data;
using System.Globalization;
using PivotForge.Core.Grouping;
using PivotForge.Core.Aggregation;
using PivotForge.Core.Records;

namespace PivotForge.Core;

/// <summary>Builds pivot results and resolves source records behind pivot coordinates.</summary>
public sealed class PivotEngine
{
    private readonly CultureInfo? culture;

    /// <summary>Creates an engine that collates row labels with the ambient culture.</summary>
    /// <remarks>
    /// Collation is resolved per call from <see cref="CultureInfo.CurrentCulture"/>, so an
    /// ASP.NET application with request localization configured sorts each request in that
    /// request's culture without wiring anything up.
    /// </remarks>
    public PivotEngine()
    {
    }

    /// <summary>Creates an engine that collates row labels with a fixed culture.</summary>
    /// <param name="culture">The culture used to compare row labels.</param>
    /// <exception cref="ArgumentNullException">The culture is null.</exception>
    public PivotEngine(CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(culture);
        this.culture = culture;
    }

    // Read per call rather than cached, because CurrentCulture is per request.
    private CultureInfo Culture => this.culture ?? CultureInfo.CurrentCulture;

    /// <summary>Builds a pivot result from strongly typed records.</summary>
    /// <typeparam name="T">The source record type.</typeparam>
    /// <param name="records">The source records.</param>
    /// <param name="request">The pivot definition.</param>
    /// <returns>The generated pivot result.</returns>
    public PivotResult Execute<T>(IEnumerable<T> records, PivotRequest request)
        => Execute(records, request, CancellationToken.None);

    /// <summary>Builds a cancellable pivot result from strongly typed records.</summary>
    /// <typeparam name="T">The source record type.</typeparam>
    /// <param name="records">The source records.</param>
    /// <param name="request">The pivot definition.</param>
    /// <param name="cancellationToken">A token that can cancel materialization and aggregation.</param>
    /// <returns>The generated pivot result.</returns>
    public PivotResult Execute<T>(IEnumerable<T> records, PivotRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(request);

        var materialized = Materialize(records, cancellationToken);
        return ExecuteCore(materialized, request, new ObjectRecordReader<T>(), Culture, cancellationToken);
    }

    /// <summary>Builds a pivot result from a data table.</summary>
    /// <param name="table">The source data table.</param>
    /// <param name="request">The pivot definition.</param>
    /// <returns>The generated pivot result.</returns>
    public PivotResult Execute(DataTable table, PivotRequest request)
        => Execute(table, request, CancellationToken.None);

    /// <summary>Builds a cancellable pivot result from a data table.</summary>
    /// <param name="table">The source data table.</param>
    /// <param name="request">The pivot definition.</param>
    /// <param name="cancellationToken">A token that can cancel aggregation.</param>
    /// <returns>The generated pivot result.</returns>
    public PivotResult Execute(DataTable table, PivotRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(table);
        ArgumentNullException.ThrowIfNull(request);

        return ExecuteCore(
            table.Rows.Cast<DataRow>().Cast<object>(),
            request,
            new DataTableRecordReader(table),
            Culture,
            cancellationToken);
    }

    /// <summary>Builds a pivot result from dictionary-backed records.</summary>
    /// <param name="records">The source records.</param>
    /// <param name="request">The pivot definition.</param>
    /// <returns>The generated pivot result.</returns>
    public PivotResult ExecuteRecords(IEnumerable<IReadOnlyDictionary<string, object?>> records, PivotRequest request)
        => ExecuteRecords(records, request, CancellationToken.None);

    /// <summary>Builds a cancellable pivot result from dictionary-backed records.</summary>
    /// <param name="records">The source records.</param>
    /// <param name="request">The pivot definition.</param>
    /// <param name="cancellationToken">A token that can cancel materialization and aggregation.</param>
    /// <returns>The generated pivot result.</returns>
    public PivotResult ExecuteRecords(
        IEnumerable<IReadOnlyDictionary<string, object?>> records,
        PivotRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(request);

        var materialized = Materialize(records, cancellationToken);
        var fields = materialized
            .Cast<IReadOnlyDictionary<string, object?>>()
            .SelectMany(record => record.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return ExecuteCore(materialized, request, new DictionaryRecordReader(fields), Culture, cancellationToken);
    }

    /// <summary>Returns strongly typed records matching row and column paths.</summary>
    /// <typeparam name="T">The source record type.</typeparam>
    /// <param name="records">The source records.</param>
    /// <param name="request">The pivot definition used to interpret the paths.</param>
    /// <param name="rowPath">The row-header path, which may be partial.</param>
    /// <param name="columnPath">The column-header path, which may be partial.</param>
    /// <returns>The matching source records.</returns>
    public IReadOnlyList<T> DrillDown<T>(
        IEnumerable<T> records,
        PivotRequest request,
        IReadOnlyList<string?> rowPath,
        IReadOnlyList<string?> columnPath)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(rowPath);
        ArgumentNullException.ThrowIfNull(columnPath);

        var materialized = records.ToList();
        return DrillDownCore(materialized.Cast<object>(), request, rowPath, columnPath, new ObjectRecordReader<T>(), Culture)
            .Cast<T>()
            .ToArray();
    }

    /// <summary>Returns data rows matching row and column paths.</summary>
    /// <param name="table">The source data table.</param>
    /// <param name="request">The pivot definition used to interpret the paths.</param>
    /// <param name="rowPath">The row-header path, which may be partial.</param>
    /// <param name="columnPath">The column-header path, which may be partial.</param>
    /// <returns>The matching data rows.</returns>
    public IReadOnlyList<DataRow> DrillDown(
        DataTable table,
        PivotRequest request,
        IReadOnlyList<string?> rowPath,
        IReadOnlyList<string?> columnPath)
    {
        ArgumentNullException.ThrowIfNull(table);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(rowPath);
        ArgumentNullException.ThrowIfNull(columnPath);

        return DrillDownCore(table.Rows.Cast<DataRow>().Cast<object>(), request, rowPath, columnPath, new DataTableRecordReader(table), Culture)
            .Cast<DataRow>()
            .ToArray();
    }

    /// <summary>Returns dictionary-backed records matching row and column paths.</summary>
    /// <param name="records">The source records.</param>
    /// <param name="request">The pivot definition used to interpret the paths.</param>
    /// <param name="rowPath">The row-header path, which may be partial.</param>
    /// <param name="columnPath">The column-header path, which may be partial.</param>
    /// <returns>The matching source records.</returns>
    public IReadOnlyList<IReadOnlyDictionary<string, object?>> DrillDownRecords(
        IEnumerable<IReadOnlyDictionary<string, object?>> records,
        PivotRequest request,
        IReadOnlyList<string?> rowPath,
        IReadOnlyList<string?> columnPath)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(rowPath);
        ArgumentNullException.ThrowIfNull(columnPath);

        var materialized = records.ToList();
        var fields = materialized
            .SelectMany(record => record.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return DrillDownCore(materialized.Cast<object>(), request, rowPath, columnPath, new DictionaryRecordReader(fields), Culture)
            .Cast<IReadOnlyDictionary<string, object?>>()
            .ToArray();
    }

    /// <summary>Reduces records to a chosen set of fields.</summary>
    /// <typeparam name="T">The source record type.</typeparam>
    /// <param name="records">The records to reduce.</param>
    /// <param name="fields">The field names to keep.</param>
    /// <returns>One dictionary per record, holding only the named fields.</returns>
    /// <remarks>
    /// A field the record type does not carry is left out rather than reported: the list is
    /// written once for an application, while a data provider may hand back a narrower record
    /// type on one page than on another.
    /// </remarks>
    public static IReadOnlyList<IReadOnlyDictionary<string, object?>> Project<T>(
        IEnumerable<T> records,
        IEnumerable<string> fields)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(fields);

        var reader = new ObjectRecordReader<T>();
        var kept = fields.Where(reader.HasField).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

        return records
            .Where(record => record is not null)
            .Select(record => (IReadOnlyDictionary<string, object?>)kept.ToDictionary(
                field => field,
                field => reader.GetValue(record!, field),
                StringComparer.OrdinalIgnoreCase))
            .ToArray();
    }

    /// <summary>Returns the distinct display values of a field in strongly typed records.</summary>
    /// <typeparam name="T">The source record type.</typeparam>
    /// <param name="records">The source records.</param>
    /// <param name="field">The source field name.</param>
    /// <returns>The distinct values a filter on this field can accept, in value order.</returns>
    /// <param name="interval">The date interval to collapse the values to, so the list holds the
    /// groups a header shows rather than the raw dates behind them.</param>
    public IReadOnlyList<string?> DistinctValues<T>(
        IEnumerable<T> records,
        string field,
        PivotGroupInterval interval = PivotGroupInterval.None)
    {
        ArgumentNullException.ThrowIfNull(records);

        return DistinctValuesCore(records.Cast<object>(), field, new ObjectRecordReader<T>(), Culture, interval);
    }

    /// <summary>Returns the distinct display values of a data table column.</summary>
    /// <param name="table">The source data table.</param>
    /// <param name="field">The source column name.</param>
    /// <returns>The distinct values a filter on this column can accept, in value order.</returns>
    /// <param name="interval">The date interval to collapse the values to, so the list holds the
    /// groups a header shows rather than the raw dates behind them.</param>
    public IReadOnlyList<string?> DistinctValues(
        DataTable table,
        string field,
        PivotGroupInterval interval = PivotGroupInterval.None)
    {
        ArgumentNullException.ThrowIfNull(table);

        return DistinctValuesCore(
            table.Rows.Cast<DataRow>().Cast<object>(),
            field,
            new DataTableRecordReader(table),
            Culture,
            interval);
    }

    /// <summary>Returns the distinct display values of a field in dictionary-backed records.</summary>
    /// <param name="records">The source records.</param>
    /// <param name="field">The source field name.</param>
    /// <returns>The distinct values a filter on this field can accept, in value order.</returns>
    /// <param name="interval">The date interval to collapse the values to, so the list holds the
    /// groups a header shows rather than the raw dates behind them.</param>
    public IReadOnlyList<string?> DistinctValuesRecords(
        IEnumerable<IReadOnlyDictionary<string, object?>> records,
        string field,
        PivotGroupInterval interval = PivotGroupInterval.None)
    {
        ArgumentNullException.ThrowIfNull(records);

        var materialized = records.ToList();
        var fields = materialized
            .SelectMany(record => record.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return DistinctValuesCore(
            materialized.Cast<object>(),
            field,
            new DictionaryRecordReader(fields),
            Culture,
            interval);
    }

    private static IReadOnlyList<string?> DistinctValuesCore(
        IEnumerable<object> records,
        string field,
        IRecordReader reader,
        CultureInfo culture,
        PivotGroupInterval interval = PivotGroupInterval.None)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(field);

        if (!reader.HasField(field))
        {
            throw new PivotFieldNotFoundException(field);
        }

        // Keyed by the same string the filter compares against, so whatever a
        // picker shows is exactly what PivotFilter will match. The raw value is
        // carried alongside only to order the result.
        var seen = new Dictionary<string, object?>(StringComparer.Ordinal);
        var hasBlank = false;

        foreach (var record in records)
        {
            var value = reader.GetValue(record, field);
            // The picker lists what the header shows, because that is what the
            // filter will be compared against.
            var text = PivotGroupLabels.Label(value, interval, culture) ?? "";

            // A null source value converts to the empty string here exactly as it
            // does when a filter is matched, so blank is a selectable value — but
            // it holds no raw value to order by, which is why it is kept apart.
            if (text.Length == 0)
            {
                hasBlank = true;
                continue;
            }

            seen.TryAdd(text, value);
        }

        var ordered = PivotGroupLabels.Order(interval, culture) is { } intervalOrder
            // A grouped list runs in its interval's order, not its labels' --
            // the same reason a month column does not sort alphabetically.
            ? seen.Keys.OrderBy(label => (string?)label, intervalOrder).ToArray()
            : OrderDistinctValues(seen, culture);

        // Blank leads the list rather than being sorted into it, the way every
        // spreadsheet filter presents it.
        return hasBlank ? ["", .. ordered] : ordered;
    }

    // Ordinal text order would list 1, 10, 2 for a numeric field. When every
    // raw value shares one comparable type, order by the value itself; anything
    // mixed or non-comparable falls back to text.
    private static IReadOnlyList<string?> OrderDistinctValues(
        Dictionary<string, object?> seen,
        CultureInfo culture)
    {
        var values = seen.Values.ToArray();
        var comparable =
            values.Length > 0 &&
            // Text is deliberately excluded: Comparer<object?>.Default resolves to
            // string.CompareTo, which collates in the ambient culture rather than
            // the one asked for — so a requested culture was quietly ignored for
            // exactly the type this list is usually made of.
            values[0] is IComparable and not string &&
            values.All(value => value is not null && value.GetType() == values[0]!.GetType());

        return comparable
            ? seen.OrderBy(entry => entry.Value, Comparer<object?>.Default)
                .Select(entry => (string?)entry.Key)
                .ToArray()
            // The picker shows this list to a person, so it is sorted the way that
            // person reads rather than by code point.
            : seen.Keys
                .Order(StringComparer.Create(culture, ignoreCase: false))
                .Select(key => (string?)key)
                .ToArray();
    }

    private static IReadOnlyList<object> DrillDownCore(
        IEnumerable<object> records,
        PivotRequest request,
        IReadOnlyList<string?> rowPath,
        IReadOnlyList<string?> columnPath,
        IRecordReader reader,
        CultureInfo culture)
    {
        ValidateRequest(request, reader);
        ValidateDrillDownPath(rowPath, request.Rows, nameof(rowPath));
        ValidateDrillDownPath(columnPath, request.Columns, nameof(columnPath));
        var filters = CompileFilters(request.Filters);

        return records
            .Where(record => MatchesFilters(record, filters, reader, culture))
            .Where(record => MatchesDrillDownPath(record, request.Rows, rowPath, reader, culture))
            .Where(record => MatchesDrillDownPath(record, request.Columns, columnPath, reader, culture))
            .ToArray();
    }

    private static void ValidateDrillDownPath(
        IReadOnlyList<string?> path,
        IReadOnlyList<PivotFieldRef> fields,
        string parameterName)
    {
        if (path.Count > fields.Count)
        {
            throw new ArgumentException("Drill-down path cannot be deeper than its pivot field area.", parameterName);
        }
    }

    private static bool MatchesDrillDownPath(
        object record,
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<string?> path,
        IRecordReader reader,
        CultureInfo culture)
    {
        for (var index = 0; index < path.Count; index++)
        {
            // The path carries what the header showed, so the record has to be
            // collapsed to that same group before it can be compared.
            var value = PivotGroupLabels.Label(
                reader.GetValue(record, fields[index].Field), fields[index].Interval, culture);

            if (!string.Equals(value, path[index], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private static PivotResult ExecuteCore(
        IEnumerable<object> records,
        PivotRequest request,
        IRecordReader reader,
        CultureInfo culture,
        CancellationToken cancellationToken)
    {
        ValidateRequest(request, reader);

        var scan = Scan(records, request, reader, culture, null, cancellationToken);

        // Top-N ranks groups that do not exist until the records have been summed, so the
        // rows it drops can only be known after a pass. Running the pass again without them
        // is what keeps every total agreeing with the rows above it: a column total or a
        // grand total carried over from the first pass would still be counting rows the
        // reader cannot see. The cost is one extra pass over records already in memory, and
        // only for a request that asked for a ranking.
        if (request.TopN.Count > 0)
        {
            var excluded = ExcludedGroups(scan, request, culture);

            if (excluded.Count > 0)
            {
                scan = Scan(records, request, reader, culture, excluded, cancellationToken);
            }
        }

        var rowIndex = scan.RowIndex;
        var columnIndex = scan.ColumnIndex;
        var buckets = scan.Cells;
        var rowTotalBuckets = scan.RowTotals;
        var columnTotalBuckets = scan.ColumnTotals;
        var subtotalBuckets = scan.Subtotals;
        var grandTotalBucket = scan.GrandTotal;
        var columnLevelValues = scan.ColumnLevelValues;
        var sourceRowCount = scan.SourceRowCount;

        var columnHeaders = CreateColumnHeaders(
            columnIndex.Headers,
            columnLevelValues,
            request.Columns,
            ResolveLevelDirections(request.Columns, request.FieldSorts),
            culture);
        var columnLookup = CreateHeaderLookup(columnHeaders);
        var rawCells = buckets
            .OrderBy(pair => pair.Key.Row)
            .ThenBy(pair => RemapColumnIndex(pair.Key.Column, columnIndex.Headers, columnLookup))
            .Select(pair => new PivotCell
            {
                Row = pair.Key.Row,
                Column = RemapColumnIndex(pair.Key.Column, columnIndex.Headers, columnLookup),
                Values = pair.Value.Finalize(request.Values)
            })
            .ToArray();
        var rawRowTotals = rowTotalBuckets
            .OrderBy(pair => pair.Key)
            .Select(pair => new PivotTotal { Index = pair.Key, Values = pair.Value.Finalize(request.Values) })
            .ToArray();
        var rawColumnTotals = columnTotalBuckets
            .Select(pair => new PivotTotal
            {
                Index = RemapColumnIndex(pair.Key, columnIndex.Headers, columnLookup),
                Values = pair.Value.Finalize(request.Values)
            })
            .OrderBy(total => total.Index)
            .ToArray();
        var rawGrandTotals = grandTotalBucket.Finalize(request.Values);
        var rawSubtotals = subtotalBuckets.Values
            .Select(subtotal => subtotal.Finalize(request.Values, columnIndex.Headers, columnLookup))
            .ToArray();
        var transformed = TransformValues(
            rowIndex.Headers.Count,
            columnHeaders.Count,
            request.Values,
            rawCells,
            rawRowTotals,
            rawColumnTotals,
            rawSubtotals,
            rawGrandTotals);
        // Before sorting, so the sort orders what survives rather than ordering
        // rows that are about to disappear.
        var populated = request.HideEmptySummaryCells
            ? DropEmpty(rowIndex.Headers, columnHeaders, transformed)
            : new PopulatedResult(rowIndex.Headers, columnHeaders, transformed);

        var sortedRows = SortRows(
            populated.RowHeaders,
            populated.ColumnHeaders,
            populated.Values.Cells,
            populated.Values.RowTotals,
            request,
            culture);
        cancellationToken.ThrowIfCancellationRequested();

        return new PivotResult
        {
            RowHeaders = sortedRows.Headers,
            ColumnHeaders = populated.ColumnHeaders,
            Cells = sortedRows.Cells,
            RowTotals = sortedRows.RowTotals,
            ColumnTotals = populated.Values.ColumnTotals,
            Subtotals = populated.Values.Subtotals,
            GrandTotals = populated.Values.GrandTotals,
            Metadata = new PivotMetadata
            {
                SourceRowCount = sourceRowCount,
                RowHeaderCount = sortedRows.Headers.Count,
                ColumnHeaderCount = populated.ColumnHeaders.Count,
                CellCount = sortedRows.Cells.Count
            }
        };
    }

    // One pass over the source records, accumulating every bucket the result is built
    // from. Taken apart from ExecuteCore because Top-N has to run it twice.
    private static ScanResult Scan(
        IEnumerable<object> records,
        PivotRequest request,
        IRecordReader reader,
        CultureInfo culture,
        IReadOnlySet<HeaderKey>? excludedGroups,
        CancellationToken cancellationToken)
    {
        var rowIndex = new HeaderIndex();
        var columnIndex = new HeaderIndex();
        var columnLevelValues = CreateColumnLevelValueLists(request.Columns.Count);
        var buckets = new Dictionary<CellKey, AggregateBucket>();
        var rowTotalBuckets = new Dictionary<int, AggregateBucket>();
        var columnTotalBuckets = new Dictionary<int, AggregateBucket>();
        var subtotalBuckets = new Dictionary<HeaderKey, SubtotalBuckets>();
        var grandTotalBucket = new AggregateBucket(request.Values);
        var filters = CompileFilters(request.Filters);
        var sourceRowCount = 0;

        var scannedRowCount = 0;

        foreach (var record in records)
        {
            if ((scannedRowCount++ & 255) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            if (!MatchesFilters(record, filters, reader, culture))
            {
                continue;
            }

            var rowValues = ReadHeaderValues(record, request.Rows, reader, culture);

            // Checked after the filters and before anything is counted, so a group a
            // ranking dropped is absent from the totals rather than merely hidden.
            if (excludedGroups is not null && IsExcluded(excludedGroups, rowValues))
            {
                continue;
            }

            sourceRowCount++;

            var columnValues = ReadHeaderValues(record, request.Columns, reader, culture);
            TrackColumnLevelValues(columnLevelValues, columnValues);
            var row = rowIndex.GetOrAdd(rowValues);
            var column = columnIndex.GetOrAdd(columnValues);
            var key = new CellKey(row, column);

            if (!buckets.TryGetValue(key, out var bucket))
            {
                bucket = new AggregateBucket(request.Values);
                buckets.Add(key, bucket);
            }

            var rowTotalBucket = GetOrAddBucket(rowTotalBuckets, row, request.Values);
            var columnTotalBucket = GetOrAddBucket(columnTotalBuckets, column, request.Values);

            for (var level = 1; level < rowValues.Count; level++)
            {
                var path = rowValues.Take(level).ToArray();
                var subtotalKey = new HeaderKey(path);

                if (!subtotalBuckets.TryGetValue(subtotalKey, out var subtotal))
                {
                    subtotal = new SubtotalBuckets(path, request.Values);
                    subtotalBuckets.Add(subtotalKey, subtotal);
                }

                subtotal.Add(column, request.Values, record, reader);
            }

            foreach (var valueDefinition in request.Values)
            {
                var value = reader.GetValue(record, valueDefinition.Field);
                bucket.Add(valueDefinition, value);
                rowTotalBucket.Add(valueDefinition, value);
                columnTotalBucket.Add(valueDefinition, value);
                grandTotalBucket.Add(valueDefinition, value);
            }
        }

        return new ScanResult(
            rowIndex,
            columnIndex,
            columnLevelValues,
            buckets,
            rowTotalBuckets,
            columnTotalBuckets,
            subtotalBuckets,
            grandTotalBucket,
            sourceRowCount);
    }

    /// <summary>The row groups a ranking leaves out, as header prefixes.</summary>
    private static IReadOnlySet<HeaderKey> ExcludedGroups(
        ScanResult scan,
        PivotRequest request,
        CultureInfo culture)
    {
        var excluded = new HashSet<HeaderKey>();

        foreach (var limit in request.TopN)
        {
            var level = LevelIndex(request.Rows, limit.Field);
            var depth = level + 1;
            var valueKey = limit.ValueKey ?? request.Values[0].Key;
            var ranked = new Dictionary<HeaderKey, List<(HeaderKey Group, IReadOnlyList<string?> Header, decimal? Value)>>();

            for (var row = 0; row < scan.RowIndex.Headers.Count; row++)
            {
                var header = scan.RowIndex.Headers[row];
                var groupHeader = header.Take(depth).ToArray();
                var group = new HeaderKey(groupHeader);
                // Ranked inside its own parent, so "the top two categories" means two per
                // region rather than two across all of them.
                var parent = new HeaderKey(header.Take(level).ToArray());

                if (!ranked.TryGetValue(parent, out var siblings))
                {
                    siblings = [];
                    ranked.Add(parent, siblings);
                }

                if (siblings.Any(sibling => sibling.Group.Equals(group)))
                {
                    continue;
                }

                siblings.Add((group, groupHeader, GroupValue(scan, request, row, depth, group, valueKey)));
            }

            foreach (var siblings in ranked.Values)
            {
                excluded.UnionWith(Losers(siblings, limit, culture));
            }
        }

        return excluded;
    }

    private static IEnumerable<HeaderKey> Losers(
        List<(HeaderKey Group, IReadOnlyList<string?> Header, decimal? Value)> siblings,
        PivotTopN limit,
        CultureInfo culture)
    {
        // A group that aggregated to nothing has no rank, so it sits at the bottom of both
        // orderings rather than winning a "bottom five" by being empty. Ties break on the
        // label so the same data always produces the same rows, whatever order it arrived in.
        var ordered = siblings
            .OrderBy(sibling => sibling.Value is null)
            .ThenBy(sibling => sibling.Value, limit.Mode == PivotTopNMode.Top
                ? Comparer<decimal?>.Create((left, right) => Comparer<decimal?>.Default.Compare(right, left))
                : Comparer<decimal?>.Default)
            .ThenBy(sibling => sibling.Header[^1], StringComparer.Create(culture, ignoreCase: false));

        return ordered.Skip(limit.Count).Select(sibling => sibling.Group);
    }

    private static decimal? GroupValue(
        ScanResult scan,
        PivotRequest request,
        int row,
        int depth,
        HeaderKey group,
        string valueKey) =>
        // At the deepest level a group is one row, and its total is already the row's own.
        // Above it, the subtotal buckets hold exactly this prefix's aggregate.
        depth == request.Rows.Count
            ? Lookup(scan.RowTotals[row].Finalize(request.Values), valueKey)
            : scan.Subtotals.TryGetValue(group, out var subtotal)
                ? Lookup(subtotal.FinalizeTotals(request.Values), valueKey)
                : null;

    private static decimal? Lookup(IReadOnlyDictionary<string, decimal?> values, string key) =>
        values.TryGetValue(key, out var value) ? value : null;

    private static int LevelIndex(IReadOnlyList<PivotFieldRef> fields, string? name)
    {
        for (var level = 0; level < fields.Count; level++)
        {
            if (NamesLevel(name, fields[level]))
            {
                return level;
            }
        }

        return -1;
    }

    private static bool IsExcluded(IReadOnlySet<HeaderKey> excludedGroups, IReadOnlyList<string?> rowValues)
    {
        for (var length = 1; length <= rowValues.Count; length++)
        {
            if (excludedGroups.Contains(new HeaderKey(rowValues.Take(length).ToArray())))
            {
                return true;
            }
        }

        return false;
    }

    private sealed record ScanResult(
        HeaderIndex RowIndex,
        HeaderIndex ColumnIndex,
        List<List<string?>> ColumnLevelValues,
        Dictionary<CellKey, AggregateBucket> Cells,
        Dictionary<int, AggregateBucket> RowTotals,
        Dictionary<int, AggregateBucket> ColumnTotals,
        Dictionary<HeaderKey, SubtotalBuckets> Subtotals,
        AggregateBucket GrandTotal,
        int SourceRowCount);

    private static List<object> Materialize<T>(IEnumerable<T> records, CancellationToken cancellationToken)
    {
        var materialized = new List<object>();
        var index = 0;

        foreach (var record in records)
        {
            if ((index++ & 255) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            materialized.Add(record!);
        }

        cancellationToken.ThrowIfCancellationRequested();
        return materialized;
    }

    private static AggregateBucket GetOrAddBucket(
        Dictionary<int, AggregateBucket> buckets,
        int index,
        IReadOnlyList<PivotValueDefinition> definitions)
    {
        if (buckets.TryGetValue(index, out var bucket))
        {
            return bucket;
        }

        bucket = new AggregateBucket(definitions);
        buckets.Add(index, bucket);
        return bucket;
    }

    private static TransformedResult TransformValues(
        int rowCount,
        int columnCount,
        IReadOnlyList<PivotValueDefinition> definitions,
        IReadOnlyList<PivotCell> rawCells,
        IReadOnlyList<PivotTotal> rawRowTotals,
        IReadOnlyList<PivotTotal> rawColumnTotals,
        IReadOnlyList<PivotSubtotal> rawSubtotals,
        IReadOnlyDictionary<string, decimal?> rawGrandTotals)
    {
        var rowTotalLookup = rawRowTotals.ToDictionary(total => total.Index, total => total.Values);
        var columnTotalLookup = rawColumnTotals.ToDictionary(total => total.Index, total => total.Values);
        var cellLookup = rawCells.ToDictionary(cell => new CellKey(cell.Row, cell.Column), cell => cell.Values);
        var transformedCells = TransformCellMatrix(
            rowCount,
            columnCount,
            definitions,
            cellLookup,
            rowTotalLookup,
            columnTotalLookup,
            rawGrandTotals);
        var transformedRowTotals = rawRowTotals
            .Select(total => new PivotTotal
            {
                Index = total.Index,
                Values = TransformRowTotalValues(total.Values, definitions, rawGrandTotals)
            })
            .ToArray();
        var transformedColumnTotals = TransformColumnTotals(
            columnCount,
            definitions,
            columnTotalLookup,
            rawGrandTotals);
        var transformedSubtotals = rawSubtotals
            .Select(subtotal => TransformSubtotal(
                subtotal,
                columnCount,
                definitions,
                columnTotalLookup,
                rawGrandTotals))
            .ToArray();
        var transformedGrandTotals = definitions.ToDictionary(
            definition => definition.Key,
            definition => TransformGrandTotal(GetValue(rawGrandTotals, definition.Key), definition.ShowAs),
            StringComparer.Ordinal);

        return new TransformedResult(
            transformedCells,
            transformedRowTotals,
            transformedColumnTotals,
            transformedSubtotals,
            transformedGrandTotals);
    }

    private static IReadOnlyList<PivotCell> TransformCellMatrix(
        int rowCount,
        int columnCount,
        IReadOnlyList<PivotValueDefinition> definitions,
        IReadOnlyDictionary<CellKey, IReadOnlyDictionary<string, decimal?>> rawCells,
        IReadOnlyDictionary<int, IReadOnlyDictionary<string, decimal?>> rawRowTotals,
        IReadOnlyDictionary<int, IReadOnlyDictionary<string, decimal?>> rawColumnTotals,
        IReadOnlyDictionary<string, decimal?> rawGrandTotals)
    {
        var valuesByCell = rawCells.Keys.ToDictionary(
            key => key,
            _ => new Dictionary<string, decimal?>(StringComparer.Ordinal));

        for (var row = 0; row < rowCount; row++)
        {
            foreach (var definition in definitions)
            {
                decimal runningTotal = 0m;
                var hasRunningTotal = false;
                decimal? previous = null;

                for (var column = 0; column < columnCount; column++)
                {
                    var key = new CellKey(row, column);
                    var raw = rawCells.TryGetValue(key, out var cellValues)
                        ? GetValue(cellValues, definition.Key)
                        : null;

                    if (raw is not null)
                    {
                        runningTotal += raw.Value;
                        hasRunningTotal = true;
                    }

                    var transformed = TransformCellValue(
                        raw,
                        GetValue(rawRowTotals.GetValueOrDefault(row), definition.Key),
                        GetValue(rawColumnTotals.GetValueOrDefault(column), definition.Key),
                        GetValue(rawGrandTotals, definition.Key),
                        previous,
                        hasRunningTotal ? runningTotal : null,
                        definition.ShowAs);

                    if (transformed is not null || valuesByCell.ContainsKey(key))
                    {
                        if (!valuesByCell.TryGetValue(key, out var values))
                        {
                            values = new Dictionary<string, decimal?>(StringComparer.Ordinal);
                            valuesByCell.Add(key, values);
                        }

                        values[definition.Key] = transformed;
                    }

                    if (raw is not null)
                    {
                        previous = raw;
                    }
                }
            }
        }

        return valuesByCell
            .OrderBy(pair => pair.Key.Row)
            .ThenBy(pair => pair.Key.Column)
            .Select(pair => new PivotCell
            {
                Row = pair.Key.Row,
                Column = pair.Key.Column,
                Values = pair.Value
            })
            .ToArray();
    }

    private static IReadOnlyDictionary<string, decimal?> TransformRowTotalValues(
        IReadOnlyDictionary<string, decimal?> rawValues,
        IReadOnlyList<PivotValueDefinition> definitions,
        IReadOnlyDictionary<string, decimal?> rawGrandTotals)
    {
        return definitions.ToDictionary(
            definition => definition.Key,
            definition => TransformRowTotal(
                GetValue(rawValues, definition.Key),
                GetValue(rawGrandTotals, definition.Key),
                definition.ShowAs),
            StringComparer.Ordinal);
    }

    private static IReadOnlyList<PivotTotal> TransformColumnTotals(
        int columnCount,
        IReadOnlyList<PivotValueDefinition> definitions,
        IReadOnlyDictionary<int, IReadOnlyDictionary<string, decimal?>> rawColumnTotals,
        IReadOnlyDictionary<string, decimal?> rawGrandTotals)
    {
        var totals = Enumerable.Range(0, columnCount)
            .ToDictionary(index => index, _ => new Dictionary<string, decimal?>(StringComparer.Ordinal));

        foreach (var definition in definitions)
        {
            decimal runningTotal = 0m;
            var hasRunningTotal = false;
            decimal? previous = null;

            for (var column = 0; column < columnCount; column++)
            {
                var raw = GetValue(rawColumnTotals.GetValueOrDefault(column), definition.Key);

                if (raw is not null)
                {
                    runningTotal += raw.Value;
                    hasRunningTotal = true;
                }

                totals[column][definition.Key] = TransformColumnTotal(
                    raw,
                    GetValue(rawGrandTotals, definition.Key),
                    previous,
                    hasRunningTotal ? runningTotal : null,
                    definition.ShowAs);
                if (raw is not null)
                {
                    previous = raw;
                }
            }
        }

        return totals.Select(pair => new PivotTotal { Index = pair.Key, Values = pair.Value }).ToArray();
    }

    private static PivotSubtotal TransformSubtotal(
        PivotSubtotal subtotal,
        int columnCount,
        IReadOnlyList<PivotValueDefinition> definitions,
        IReadOnlyDictionary<int, IReadOnlyDictionary<string, decimal?>> rawColumnTotals,
        IReadOnlyDictionary<string, decimal?> rawGrandTotals)
    {
        var subtotalCellLookup = subtotal.Cells.ToDictionary(cell => new CellKey(0, cell.Column), cell => cell.Values);
        var subtotalTotalLookup = new Dictionary<int, IReadOnlyDictionary<string, decimal?>> { [0] = subtotal.Totals };
        var cells = TransformCellMatrix(
            1,
            columnCount,
            definitions,
            subtotalCellLookup,
            subtotalTotalLookup,
            rawColumnTotals,
            rawGrandTotals);

        return new PivotSubtotal
        {
            RowHeader = subtotal.RowHeader,
            Cells = cells,
            Totals = TransformRowTotalValues(subtotal.Totals, definitions, rawGrandTotals)
        };
    }

    private static decimal? TransformCellValue(
        decimal? raw,
        decimal? rowTotal,
        decimal? columnTotal,
        decimal? grandTotal,
        decimal? previous,
        decimal? runningTotal,
        PivotShowAs showAs)
    {
        return showAs switch
        {
            PivotShowAs.Normal => raw,
            PivotShowAs.PercentOfRowTotal => Divide(raw, rowTotal),
            PivotShowAs.PercentOfColumnTotal => Divide(raw, columnTotal),
            PivotShowAs.PercentOfGrandTotal => Divide(raw, grandTotal),
            PivotShowAs.DifferenceFromPrevious => Difference(raw, previous),
            PivotShowAs.PercentDifferenceFromPrevious => Divide(Difference(raw, previous), previous),
            PivotShowAs.RunningTotal => runningTotal,
            _ => throw new ArgumentOutOfRangeException(nameof(showAs), showAs, "Unsupported show-as calculation.")
        };
    }

    private static decimal? TransformRowTotal(decimal? raw, decimal? grandTotal, PivotShowAs showAs)
    {
        return showAs switch
        {
            PivotShowAs.Normal or PivotShowAs.RunningTotal => raw,
            PivotShowAs.PercentOfRowTotal => OneWhenNonZero(raw),
            PivotShowAs.PercentOfColumnTotal or PivotShowAs.PercentOfGrandTotal => Divide(raw, grandTotal),
            PivotShowAs.DifferenceFromPrevious or PivotShowAs.PercentDifferenceFromPrevious => null,
            _ => throw new ArgumentOutOfRangeException(nameof(showAs), showAs, "Unsupported show-as calculation.")
        };
    }

    private static decimal? TransformColumnTotal(
        decimal? raw,
        decimal? grandTotal,
        decimal? previous,
        decimal? runningTotal,
        PivotShowAs showAs)
    {
        return showAs switch
        {
            PivotShowAs.Normal => raw,
            PivotShowAs.PercentOfRowTotal or PivotShowAs.PercentOfGrandTotal => Divide(raw, grandTotal),
            PivotShowAs.PercentOfColumnTotal => OneWhenNonZero(raw),
            PivotShowAs.DifferenceFromPrevious => Difference(raw, previous),
            PivotShowAs.PercentDifferenceFromPrevious => Divide(Difference(raw, previous), previous),
            PivotShowAs.RunningTotal => runningTotal,
            _ => throw new ArgumentOutOfRangeException(nameof(showAs), showAs, "Unsupported show-as calculation.")
        };
    }

    private static decimal? TransformGrandTotal(decimal? raw, PivotShowAs showAs)
    {
        return showAs switch
        {
            PivotShowAs.Normal or PivotShowAs.RunningTotal => raw,
            PivotShowAs.PercentOfRowTotal or PivotShowAs.PercentOfColumnTotal or PivotShowAs.PercentOfGrandTotal => OneWhenNonZero(raw),
            PivotShowAs.DifferenceFromPrevious or PivotShowAs.PercentDifferenceFromPrevious => null,
            _ => throw new ArgumentOutOfRangeException(nameof(showAs), showAs, "Unsupported show-as calculation.")
        };
    }

    private static decimal? Difference(decimal? current, decimal? previous) =>
        current is null || previous is null ? null : current.Value - previous.Value;

    private static decimal? Divide(decimal? numerator, decimal? denominator) =>
        numerator is null || denominator is null || denominator.Value == 0m
            ? null
            : numerator.Value / denominator.Value;

    private static decimal? OneWhenNonZero(decimal? value) =>
        value is null || value.Value == 0m ? null : 1m;

    private static decimal? GetValue(IReadOnlyDictionary<string, decimal?>? values, string key) =>
        values is not null && values.TryGetValue(key, out var value) ? value : null;

    private static void ValidateRequest(PivotRequest request, IRecordReader reader)
    {
        if (request.Values.Count == 0)
        {
            throw new ArgumentException("At least one pivot value definition is required.", nameof(request));
        }

        foreach (var field in request.Rows.Concat(request.Columns).Select(level => level.Field)
                     .Concat(request.Values.Select(value => value.Field))
                     .Concat(request.Filters.Select(filter => filter.Field)))
        {
            if (string.IsNullOrWhiteSpace(field))
            {
                throw new ArgumentException("Pivot fields cannot be empty.", nameof(request));
            }

            if (!reader.HasField(field))
            {
                throw new PivotFieldNotFoundException(field);
            }
        }

        foreach (var limit in request.TopN)
        {
            if (limit.Count <= 0)
            {
                throw new ArgumentException("A pivot ranking must keep at least one group.", nameof(request));
            }

            // A ranking that names nothing would silently show every row, which reads as the
            // feature being broken rather than as the field name being wrong.
            if (LevelIndex(request.Rows, limit.Field) < 0)
            {
                throw new ArgumentException(
                    "A pivot ranking must name a row header level.", nameof(request));
            }

            if (limit.ValueKey is { } valueKey &&
                !request.Values.Any(value => string.Equals(value.Key, valueKey, StringComparison.Ordinal)))
            {
                throw new ArgumentException(
                    "A pivot ranking must be ranked by a declared value.", nameof(request));
            }
        }
    }

    private static IReadOnlyList<CompiledFilter> CompileFilters(IReadOnlyList<PivotFilter> filters)
    {
        // A condition with nothing to compare against restricts nothing in either
        // mode: an empty set to keep is how "no filter" is spelled all the way down
        // from the browser, an empty set to drop says the same from the other side,
        // and a half-typed range says it too rather than dropping every row.
        return filters
            .Where(filter => filter.Values.Count >= PivotFilterPredicates.ArgumentCount(filter.Operator))
            .Select(filter => new CompiledFilter(
                filter.Field,
                filter.Values,
                filter.Mode == PivotFilterMode.Exclude,
                filter.Interval,
                filter.Operator))
            .ToArray();
    }

    private static bool MatchesFilters(
        object record,
        IReadOnlyList<CompiledFilter> filters,
        IRecordReader reader,
        CultureInfo culture)
    {
        if (filters.Count == 0)
        {
            return true;
        }

        foreach (var filter in filters)
        {
            // Collapsed the same way the header was, or a filter listing month
            // names would be compared against raw timestamps and match nothing.
            var value = PivotGroupLabels.Label(
                reader.GetValue(record, filter.Field), filter.Interval, culture);

            // Exclude negates whatever the operator decided, which is where "does
            // not contain" and "is not blank" come from without an operator of
            // their own.
            if (PivotFilterPredicates.Matches(value, filter.Operator, filter.Values, culture)
                == filter.Excludes)
            {
                return false;
            }
        }

        return true;
    }

    private static IReadOnlyList<string?> ReadHeaderValues(
        object record,
        IEnumerable<PivotFieldRef> fields,
        IRecordReader reader,
        CultureInfo culture)
    {
        return fields
            .Select(field => PivotGroupLabels.Label(
                reader.GetValue(record, field.Field), field.Interval, culture))
            .ToArray();
    }

    private static List<List<string?>> CreateColumnLevelValueLists(int columnCount)
    {
        var values = new List<List<string?>>(columnCount);

        for (var index = 0; index < columnCount; index++)
        {
            values.Add([]);
        }

        return values;
    }

    private static void TrackColumnLevelValues(List<List<string?>> columnLevelValues, IReadOnlyList<string?> columnValues)
    {
        for (var index = 0; index < columnValues.Count; index++)
        {
            var values = columnLevelValues[index];
            var value = columnValues[index];

            if (!values.Contains(value, StringComparer.Ordinal))
            {
                values.Add(value);
            }
        }
    }

    private static IReadOnlyList<IReadOnlyList<string?>> CreateColumnHeaders(
        IReadOnlyList<IReadOnlyList<string?>> observedHeaders,
        IReadOnlyList<IReadOnlyList<string?>> columnLevelValues,
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<PivotSortDirection?> directions,
        CultureInfo culture)
    {
        if (observedHeaders.Count == 0)
        {
            return observedHeaders;
        }

        var headers = new List<IReadOnlyList<string?>>();
        AppendColumnHeaderProducts(
            headers, OrderColumnLevels(columnLevelValues, fields, directions, culture), [], 0);
        return headers;
    }

    /// <summary>Orders the values of each declared column level, leaving the rest as observed.</summary>
    /// <remarks>An undeclared level keeps the order the data arrived in, which can carry an
    /// intent the engine cannot see — a query's own ORDER BY on month number, for instance,
    /// which alphabetical ordering would destroy. A grouped level is the exception: the engine
    /// produced those labels itself and knows what order they run in, so it applies it rather
    /// than trusting an arrival order it no longer reflects.</remarks>
    private static IReadOnlyList<IReadOnlyList<string?>> OrderColumnLevels(
        IReadOnlyList<IReadOnlyList<string?>> columnLevelValues,
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<PivotSortDirection?> directions,
        CultureInfo culture)
    {
        return columnLevelValues
            .Select((values, level) =>
            {
                var interval = fields.ElementAtOrDefault(level)?.Interval ?? PivotGroupInterval.None;
                var intervalOrder = PivotGroupLabels.Order(interval, culture);
                var comparer = intervalOrder ?? StringComparer.Create(culture, ignoreCase: true);

                return directions.ElementAtOrDefault(level) switch
                {
                    PivotSortDirection.Ascending =>
                        (IReadOnlyList<string?>)values.OrderBy(value => value, comparer).ToArray(),
                    PivotSortDirection.Descending =>
                        values.OrderByDescending(value => value, comparer).ToArray(),
                    _ => intervalOrder is null
                        ? values
                        : values.OrderBy(value => value, intervalOrder).ToArray()
                };
            })
            .ToArray();
    }

    private static void AppendColumnHeaderProducts(
        List<IReadOnlyList<string?>> headers,
        IReadOnlyList<IReadOnlyList<string?>> columnLevelValues,
        List<string?> current,
        int level)
    {
        if (level == columnLevelValues.Count)
        {
            headers.Add(current.ToArray());
            return;
        }

        foreach (var value in columnLevelValues[level])
        {
            current.Add(value);
            AppendColumnHeaderProducts(headers, columnLevelValues, current, level + 1);
            current.RemoveAt(current.Count - 1);
        }
    }

    private static Dictionary<HeaderKey, int> CreateHeaderLookup(IReadOnlyList<IReadOnlyList<string?>> headers)
    {
        var lookup = new Dictionary<HeaderKey, int>();

        for (var index = 0; index < headers.Count; index++)
        {
            lookup.Add(new HeaderKey(headers[index]), index);
        }

        return lookup;
    }

    private static int RemapColumnIndex(
        int observedColumn,
        IReadOnlyList<IReadOnlyList<string?>> observedHeaders,
        IReadOnlyDictionary<HeaderKey, int> columnLookup)
    {
        return columnLookup[new HeaderKey(observedHeaders[observedColumn])];
    }

    private static SortedRows SortRows(
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
        IReadOnlyList<PivotCell> cells,
        IReadOnlyList<PivotTotal> rowTotals,
        PivotRequest request,
        CultureInfo culture)
    {
        if (rowHeaders.Count == 0)
        {
            return new SortedRows(rowHeaders, cells, rowTotals);
        }

        var rowOrder = Enumerable.Range(0, rowHeaders.Count).ToArray();
        var sort = request.RowSort;

        var directions = ResolveLevelDirections(request.Rows, request.FieldSorts);

        rowOrder = sort is null
            ? rowOrder
                .OrderBy(
                    row => rowHeaders[row],
                    Comparer<IReadOnlyList<string?>>.Create(
                        (left, right) => CompareRowHeaders(left, right, request.Rows, culture, directions)))
                .ToArray()
            : sort.Mode switch
        {
            PivotSortMode.RowLabel => SortRowsByLabel(rowOrder, rowHeaders, request.Rows, sort, culture),
            PivotSortMode.RowTotalValue =>
                SortRowsByTotal(rowOrder, rowHeaders, columnHeaders, cells, rowTotals, sort, culture),
            _ => rowOrder
        };

        var rowMap = rowOrder
            .Select((oldRow, newRow) => new { oldRow, newRow })
            .ToDictionary(item => item.oldRow, item => item.newRow);
        var sortedHeaders = rowOrder.Select(row => rowHeaders[row]).ToArray();
        var sortedCells = cells
            .Select(cell => new PivotCell
            {
                Row = rowMap[cell.Row],
                Column = cell.Column,
                Values = cell.Values
            })
            .OrderBy(cell => cell.Row)
            .ThenBy(cell => cell.Column)
            .ToArray();
        var rowTotalLookup = rowTotals.ToDictionary(total => total.Index);
        var sortedRowTotals = rowOrder
            .Select((oldRow, newRow) => new PivotTotal
            {
                Index = newRow,
                Values = rowTotalLookup.TryGetValue(oldRow, out var total)
                    ? total.Values
                    : new Dictionary<string, decimal?>()
            })
            .ToArray();

        return new SortedRows(sortedHeaders, sortedCells, sortedRowTotals);
    }

    private static int CompareRowHeaders(
        IReadOnlyList<string?> left,
        IReadOnlyList<string?> right,
        IReadOnlyList<PivotFieldRef> fields,
        CultureInfo culture,
        IReadOnlyList<PivotSortDirection?> directions)
    {
        var depth = Math.Max(left.Count, right.Count);

        for (var level = 0; level < depth; level++)
        {
            // Per level rather than once: a grouped level runs in its interval's
            // order while the plain levels around it stay collated.
            var comparison = LevelComparer(fields, level, culture)
                .Compare(left.ElementAtOrDefault(level), right.ElementAtOrDefault(level));

            if (comparison != 0)
            {
                // The comparison is applied level by level, so flipping one level
                // reverses that level's groups without moving them out of their
                // parent -- the hierarchy survives the reversal.
                return directions.ElementAtOrDefault(level) == PivotSortDirection.Descending
                    ? -comparison
                    : comparison;
            }
        }

        return 0;
    }

    /// <summary>Maps the declared per-field sorts onto header levels, by position in the axis.</summary>
    private static IReadOnlyList<PivotSortDirection?> ResolveLevelDirections(
        IReadOnlyList<PivotFieldRef> fields,
        IReadOnlyList<PivotFieldSort> fieldSorts)
    {
        if (fieldSorts.Count == 0)
        {
            return [];
        }

        return fields
            .Select(field => fieldSorts
                .Where(sort => NamesLevel(sort.Field, field))
                .Select(sort => (PivotSortDirection?)sort.Direction)
                .FirstOrDefault())
            .ToArray();
    }

    private static int[] SortRowsByLabel(
        int[] rowOrder,
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<PivotFieldRef> rowFields,
        PivotSort sort,
        CultureInfo culture)
    {
        var level = ResolveRowFieldLevel(rowFields, sort.Field);
        // A grouped level sorts the way its interval runs even when the reader
        // asked for a label sort: alphabetical month names are not what anyone
        // means by sorting a month column.
        var comparer = LevelComparer(rowFields, level, culture);

        return ApplyDirection(
            rowOrder.OrderBy(row => rowHeaders[row].ElementAtOrDefault(level), comparer),
            sort.Direction);
    }

    /// <summary>Whether a declared sort or filter names a given header level.</summary>
    /// <remarks>A grouped level answers to its key — <c>OrderDate:month</c> — and a plain one to
    /// its field name, which are the same string. A bare field name also names every grouped
    /// level of that field, so a declaration written before the grouping existed still lands.</remarks>
    private static bool NamesLevel(string? name, PivotFieldRef field) =>
        string.Equals(name, field.Key, StringComparison.Ordinal) ||
        string.Equals(name, field.Field, StringComparison.Ordinal);

    /// <summary>The comparer a header level is ordered by: its interval's, or the culture's.</summary>
    private static IComparer<string?> LevelComparer(
        IReadOnlyList<PivotFieldRef> fields,
        int level,
        CultureInfo culture)
    {
        var interval = fields.ElementAtOrDefault(level)?.Interval ?? PivotGroupInterval.None;

        return PivotGroupLabels.Order(interval, culture) ?? StringComparer.Create(culture, ignoreCase: true);
    }

    private static int[] SortRowsByTotal(
        int[] rowOrder,
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
        IReadOnlyList<PivotCell> cells,
        IReadOnlyList<PivotTotal> rowTotals,
        PivotSort sort,
        CultureInfo culture)
    {
        if (string.IsNullOrWhiteSpace(sort.ValueKey))
        {
            return rowOrder;
        }

        Dictionary<int, decimal?> values;

        if (sort.ColumnPath is null || sort.ColumnPath.Count == 0)
        {
            values = rowTotals.ToDictionary(
                total => total.Index,
                total => GetValue(total.Values, sort.ValueKey));
        }
        else
        {
            var sortableCells = FilterCellsByColumnPath(cells, columnHeaders, sort.ColumnPath);
            values = sortableCells
                .GroupBy(cell => cell.Row)
                .ToDictionary(
                    group => group.Key,
                    group => group
                        .Select(cell => GetValue(cell.Values, sort.ValueKey))
                        .FirstOrDefault(value => value is not null));
        }

        var labelComparer = StringComparer.Create(culture, ignoreCase: true);
        var ordered = sort.Direction == PivotSortDirection.Descending
            ? rowOrder
                .OrderBy(row => values.GetValueOrDefault(row) is null ? 1 : 0)
                .ThenByDescending(row => values.GetValueOrDefault(row))
                .ThenBy(row => string.Join("\u001f", rowHeaders[row]), labelComparer)
            : rowOrder
                .OrderBy(row => values.GetValueOrDefault(row) is null ? 1 : 0)
                .ThenBy(row => values.GetValueOrDefault(row))
                .ThenBy(row => string.Join("\u001f", rowHeaders[row]), labelComparer);

        return ordered.ToArray();
    }

    private static IEnumerable<PivotCell> FilterCellsByColumnPath(
        IReadOnlyList<PivotCell> cells,
        IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
        IReadOnlyList<string?>? columnPath)
    {
        if (columnPath is null || columnPath.Count == 0)
        {
            return cells;
        }

        var sortableColumns = columnHeaders
            .Select((header, index) => new { header, index })
            .Where(item => HeaderMatches(item.header, columnPath))
            .Select(item => item.index)
            .ToHashSet();

        return cells.Where(cell => sortableColumns.Contains(cell.Column));
    }

    private static bool HeaderMatches(IReadOnlyList<string?> header, IReadOnlyList<string?> expected)
    {
        if (header.Count != expected.Count)
        {
            return false;
        }

        for (var index = 0; index < header.Count; index++)
        {
            if (!string.Equals(header[index], expected[index], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private static int ResolveRowFieldLevel(IReadOnlyList<PivotFieldRef> rowFields, string? field)
    {
        if (string.IsNullOrWhiteSpace(field))
        {
            return 0;
        }

        var index = rowFields
            .Select((item, itemIndex) => new { item, itemIndex })
            .FirstOrDefault(item => NamesLevel(field, item.item))
            ?.itemIndex;

        return index ?? 0;
    }

    private static int[] ApplyDirection(IOrderedEnumerable<int> orderedRows, PivotSortDirection direction)
    {
        var rows = orderedRows.ToArray();

        if (direction == PivotSortDirection.Descending)
        {
            Array.Reverse(rows);
        }

        return rows;
    }

    private sealed record CompiledFilter(
        string Field,
        IReadOnlyList<string?> Values,
        bool Excludes,
        PivotGroupInterval Interval,
        PivotFilterOperator Operator);

    private sealed record SortedRows(
        IReadOnlyList<IReadOnlyList<string?>> Headers,
        IReadOnlyList<PivotCell> Cells,
        IReadOnlyList<PivotTotal> RowTotals);

    /// <summary>Removes the rows and columns that hold no values at all, and renumbers the rest.</summary>
    /// <remarks>
    /// A cell counts as holding something when any of its value keys is not null; a row or column
    /// counts when any of its cells does. Everything addressed by index — cells, row and column
    /// totals, and each subtotal's own cells — is renumbered together, because an index that
    /// survives a drop but points at the old position is worse than the empty column was.
    /// <para>
    /// Grand totals are left alone: a row that aggregated to nothing contributed nothing to them.
    /// </para>
    /// </remarks>
    private static PopulatedResult DropEmpty(
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
        TransformedResult values)
    {
        static bool Holds(IReadOnlyDictionary<string, decimal?> cellValues) =>
            cellValues.Values.Any(value => value is not null);

        var liveRows = new HashSet<int>();
        var liveColumns = new HashSet<int>();

        foreach (var cell in values.Cells.Where(cell => Holds(cell.Values)))
        {
            liveRows.Add(cell.Row);
            liveColumns.Add(cell.Column);
        }

        if (liveRows.Count == rowHeaders.Count && liveColumns.Count == columnHeaders.Count)
        {
            return new PopulatedResult(rowHeaders, columnHeaders, values);
        }

        var rowMap = Renumber(rowHeaders.Count, liveRows);
        var columnMap = Renumber(columnHeaders.Count, liveColumns);

        IReadOnlyList<PivotCell> Remap(IEnumerable<PivotCell> cells) => cells
            .Where(cell => rowMap.ContainsKey(cell.Row) && columnMap.ContainsKey(cell.Column))
            .Select(cell => new PivotCell
            {
                Row = rowMap[cell.Row],
                Column = columnMap[cell.Column],
                Values = cell.Values
            })
            .ToArray();

        var survivingRows = rowMap.Keys.Order().Select(row => rowHeaders[row]).ToArray();

        return new PopulatedResult(
            survivingRows,
            columnMap.Keys.Order().Select(column => columnHeaders[column]).ToArray(),
            values with
            {
                Cells = Remap(values.Cells),
                RowTotals = RemapTotals(values.RowTotals, rowMap),
                ColumnTotals = RemapTotals(values.ColumnTotals, columnMap),
                // A subtotal whose whole group went with the rows has nothing left
                // to summarize, so it goes too rather than heading an empty group.
                Subtotals = values.Subtotals
                    .Where(subtotal => survivingRows.Any(header => StartsWith(header, subtotal.RowHeader)))
                    .Select(subtotal => new PivotSubtotal
                    {
                        RowHeader = subtotal.RowHeader,
                        Cells = Remap(subtotal.Cells),
                        Totals = subtotal.Totals
                    })
                    .ToArray()
            });
    }

    /// <summary>Maps each surviving index to its position among the survivors.</summary>
    private static Dictionary<int, int> Renumber(int count, HashSet<int> live)
    {
        var map = new Dictionary<int, int>(live.Count);

        for (var index = 0; index < count; index++)
        {
            if (live.Contains(index))
            {
                map.Add(index, map.Count);
            }
        }

        return map;
    }

    private static IReadOnlyList<PivotTotal> RemapTotals(
        IReadOnlyList<PivotTotal> totals,
        IReadOnlyDictionary<int, int> map) => totals
        .Where(total => map.ContainsKey(total.Index))
        .Select(total => new PivotTotal { Index = map[total.Index], Values = total.Values })
        .OrderBy(total => total.Index)
        .ToArray();

    private static bool StartsWith(IReadOnlyList<string?> header, IReadOnlyList<string?> prefix) =>
        header.Count >= prefix.Count &&
        prefix.Select((value, level) => string.Equals(header[level], value, StringComparison.Ordinal)).All(match => match);

    private sealed record PopulatedResult(
        IReadOnlyList<IReadOnlyList<string?>> RowHeaders,
        IReadOnlyList<IReadOnlyList<string?>> ColumnHeaders,
        TransformedResult Values);

    private sealed record TransformedResult(
        IReadOnlyList<PivotCell> Cells,
        IReadOnlyList<PivotTotal> RowTotals,
        IReadOnlyList<PivotTotal> ColumnTotals,
        IReadOnlyList<PivotSubtotal> Subtotals,
        IReadOnlyDictionary<string, decimal?> GrandTotals);

    private readonly record struct CellKey(int Row, int Column);

    private sealed class SubtotalBuckets
    {
        private readonly AggregateBucket _total;
        private readonly Dictionary<int, AggregateBucket> _cells = [];

        public SubtotalBuckets(IReadOnlyList<string?> rowHeader, IReadOnlyList<PivotValueDefinition> definitions)
        {
            RowHeader = rowHeader;
            _total = new AggregateBucket(definitions);
        }

        public IReadOnlyList<string?> RowHeader { get; }

        public void Add(
            int column,
            IReadOnlyList<PivotValueDefinition> definitions,
            object record,
            IRecordReader reader)
        {
            var cell = GetOrAddBucket(_cells, column, definitions);

            foreach (var definition in definitions)
            {
                var value = reader.GetValue(record, definition.Field);
                cell.Add(definition, value);
                _total.Add(definition, value);
            }
        }

        /// <summary>The aggregate of the whole group, which is what a ranking compares.</summary>
        public IReadOnlyDictionary<string, decimal?> FinalizeTotals(
            IReadOnlyList<PivotValueDefinition> definitions) => _total.Finalize(definitions);

        public PivotSubtotal Finalize(
            IReadOnlyList<PivotValueDefinition> definitions,
            IReadOnlyList<IReadOnlyList<string?>> observedColumnHeaders,
            IReadOnlyDictionary<HeaderKey, int> columnLookup)
        {
            return new PivotSubtotal
            {
                RowHeader = RowHeader,
                Cells = _cells.Select(pair => new PivotCell
                    {
                        Row = 0,
                        Column = RemapColumnIndex(pair.Key, observedColumnHeaders, columnLookup),
                        Values = pair.Value.Finalize(definitions)
                    })
                    .OrderBy(cell => cell.Column)
                    .ToArray(),
                Totals = _total.Finalize(definitions)
            };
        }
    }

    private sealed class HeaderIndex
    {
        private readonly Dictionary<HeaderKey, int> _indexes = new();
        private readonly List<IReadOnlyList<string?>> _headers = [];

        public IReadOnlyList<IReadOnlyList<string?>> Headers => _headers;

        public int GetOrAdd(IReadOnlyList<string?> values)
        {
            var key = new HeaderKey(values);

            if (_indexes.TryGetValue(key, out var existing))
            {
                return existing;
            }

            var index = _headers.Count;
            _indexes.Add(key, index);
            _headers.Add(values);
            return index;
        }
    }

    private sealed class HeaderKey : IEquatable<HeaderKey>
    {
        private readonly IReadOnlyList<string?> _values;
        private readonly int _hashCode;

        public HeaderKey(IReadOnlyList<string?> values)
        {
            _values = values;
            _hashCode = CalculateHashCode(values);
        }

        public bool Equals(HeaderKey? other)
        {
            if (other is null || _values.Count != other._values.Count)
            {
                return false;
            }

            for (var index = 0; index < _values.Count; index++)
            {
                if (!string.Equals(_values[index], other._values[index], StringComparison.Ordinal))
                {
                    return false;
                }
            }

            return true;
        }

        public override bool Equals(object? obj) => Equals(obj as HeaderKey);

        public override int GetHashCode() => _hashCode;

        private static int CalculateHashCode(IReadOnlyList<string?> values)
        {
            var hash = new HashCode();

            foreach (var value in values)
            {
                hash.Add(value, StringComparer.Ordinal);
            }

            return hash.ToHashCode();
        }
    }
}
