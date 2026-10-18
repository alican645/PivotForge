namespace PivotForge.Core;

/// <summary>Applies <see cref="PivotValueDefinition.RunningTotal"/> to a finished result.</summary>
/// <remarks>
/// Works on the result as it will be drawn -- rows and columns already in their final order --
/// because a running total is only meaningful in an order. Each series is one line of the grid
/// in the running direction: a row (or a column) of detail cells, the subtotal cells of one
/// level, or the totals beside them. Within a series every position takes the sum so far; an
/// empty position takes the sum so far too, once there is one, as in DevExtreme.
/// </remarks>
internal static class PivotRunningTotals
{
    private const char Separator = '\u001f';

    public static PivotResult Apply(PivotResult result, IReadOnlyList<PivotValueDefinition> definitions)
    {
        var running = definitions.Where(definition => definition.RunningTotal != PivotRunningTotal.None).ToArray();
        if (running.Length == 0)
        {
            return result;
        }

        var grid = new MutableResult(result);

        foreach (var definition in running)
        {
            if (definition.RunningTotal == PivotRunningTotal.Column)
            {
                grid.AccumulateDown(definition.Key, definition.AllowCrossGroupCalculation);
            }
            else
            {
                grid.AccumulateAcross(definition.Key, definition.AllowCrossGroupCalculation);
            }
        }

        return grid.ToResult(result);
    }

    private static string KeyOf(IEnumerable<string?> path) => string.Join(Separator, path.Select(value => value ?? ""));

    private static string ParentOf(IReadOnlyList<string?> path) => KeyOf(path.Take(Math.Max(0, path.Count - 1)));

    // Walks positions in order, keeping a sum per series. reset says where a new parent
    // group begins.
    private static void Run(
        IEnumerable<(Dictionary<string, decimal?> Values, string Parent)> positions,
        string key,
        bool crossGroups)
    {
        decimal sum = 0m;
        var has = false;
        string? parent = null;

        foreach (var (values, positionParent) in positions)
        {
            if (!crossGroups && parent is not null && positionParent != parent)
            {
                sum = 0m;
                has = false;
            }

            parent = positionParent;

            if (values.TryGetValue(key, out var value) && value is { } number)
            {
                sum += number;
                has = true;
            }

            if (has)
            {
                values[key] = sum;
            }
        }
    }

    private sealed class MutableResult
    {
        private readonly IReadOnlyList<IReadOnlyList<string?>> _rowHeaders;
        private readonly IReadOnlyList<IReadOnlyList<string?>> _columnHeaders;
        private readonly Dictionary<(int Row, int Column), Dictionary<string, decimal?>> _cells;
        private readonly Dictionary<int, Dictionary<string, decimal?>> _rowTotals;
        private readonly Dictionary<int, Dictionary<string, decimal?>> _columnTotals;
        // Subtotal rows in the order they are drawn, with their cells by column and their
        // crossings with the column subtotals by column group.
        private readonly List<SubtotalRow> _subtotals;
        // Column subtotals in drawn order, with their cells by row.
        private readonly List<SubtotalColumn> _columnSubtotals;

        public MutableResult(PivotResult result)
        {
            _rowHeaders = result.RowHeaders;
            _columnHeaders = result.ColumnHeaders;
            _cells = result.Cells.ToDictionary(cell => (cell.Row, cell.Column), cell => Copy(cell.Values));
            _rowTotals = result.RowTotals.ToDictionary(total => total.Index, total => Copy(total.Values));
            _columnTotals = result.ColumnTotals.ToDictionary(total => total.Index, total => Copy(total.Values));
            _subtotals = result.Subtotals
                .Select(subtotal => new SubtotalRow(
                    subtotal.RowHeader,
                    FirstIndex(result.RowHeaders, subtotal.RowHeader),
                    subtotal.Cells.ToDictionary(cell => cell.Column, cell => Copy(cell.Values)),
                    Copy(subtotal.Totals),
                    subtotal.ColumnSubtotals.ToDictionary(cell => KeyOf(cell.ColumnHeader), cell => (cell.ColumnHeader, Copy(cell.Values)))))
                .OrderBy(subtotal => subtotal.FirstRow)
                .ThenBy(subtotal => subtotal.Path.Count)
                .ToList();
            _columnSubtotals = result.ColumnSubtotals
                .Select(subtotal => new SubtotalColumn(
                    subtotal.ColumnHeader,
                    FirstIndex(result.ColumnHeaders, subtotal.ColumnHeader),
                    subtotal.Cells.ToDictionary(cell => cell.Index, cell => Copy(cell.Values)),
                    Copy(subtotal.Totals)))
                .OrderBy(subtotal => subtotal.FirstColumn)
                .ThenBy(subtotal => subtotal.Path.Count)
                .ToList();
        }

        private static Dictionary<string, decimal?> Copy(IReadOnlyDictionary<string, decimal?> values) =>
            new(values, StringComparer.Ordinal);

        private static int FirstIndex(IReadOnlyList<IReadOnlyList<string?>> headers, IReadOnlyList<string?> prefix)
        {
            for (var index = 0; index < headers.Count; index++)
            {
                if (headers[index].Count >= prefix.Count && headers[index].Take(prefix.Count).SequenceEqual(prefix))
                {
                    return index;
                }
            }

            return int.MaxValue;
        }

        private Dictionary<string, decimal?> CellAt(int row, int column)
        {
            if (!_cells.TryGetValue((row, column), out var values))
            {
                values = new Dictionary<string, decimal?>(StringComparer.Ordinal);
                _cells.Add((row, column), values);
            }

            return values;
        }

        private static Dictionary<string, decimal?> At<TKey>(Dictionary<TKey, Dictionary<string, decimal?>> map, TKey key)
            where TKey : notnull
        {
            if (!map.TryGetValue(key, out var values))
            {
                values = new Dictionary<string, decimal?>(StringComparer.Ordinal);
                map.Add(key, values);
            }

            return values;
        }

        // Down each column: detail rows, then each level of subtotal rows, in every column
        // series -- the detail columns, the column subtotals and the right-hand total.
        public void AccumulateDown(string key, bool crossGroups)
        {
            var rows = Enumerable.Range(0, _rowHeaders.Count).ToArray();

            for (var column = 0; column < _columnHeaders.Count; column++)
            {
                var c = column;
                Run(rows.Select(row => (CellAt(row, c), ParentOf(_rowHeaders[row]))), key, crossGroups);
            }

            foreach (var subtotal in _columnSubtotals)
            {
                Run(rows.Select(row => (At(subtotal.Cells, row), ParentOf(_rowHeaders[row]))), key, crossGroups);
            }

            Run(rows.Select(row => (At(_rowTotals, row), ParentOf(_rowHeaders[row]))), key, crossGroups);

            foreach (var level in _subtotals.GroupBy(subtotal => subtotal.Path.Count))
            {
                var ordered = level.ToArray();

                for (var column = 0; column < _columnHeaders.Count; column++)
                {
                    var c = column;
                    Run(ordered.Select(subtotal => (At(subtotal.Cells, c), ParentOf(subtotal.Path))), key, crossGroups);
                }

                foreach (var columnSubtotal in _columnSubtotals)
                {
                    var groupKey = KeyOf(columnSubtotal.Path);
                    Run(ordered.Select(subtotal => (subtotal.Crossing(groupKey, columnSubtotal.Path), ParentOf(subtotal.Path))), key, crossGroups);
                }

                Run(ordered.Select(subtotal => (subtotal.Totals, ParentOf(subtotal.Path))), key, crossGroups);
            }
        }

        // Along each row: detail columns, then each level of subtotal columns, in every row
        // series -- the detail rows, the subtotal rows and the bottom total row.
        public void AccumulateAcross(string key, bool crossGroups)
        {
            var columns = Enumerable.Range(0, _columnHeaders.Count).ToArray();

            for (var row = 0; row < _rowHeaders.Count; row++)
            {
                var r = row;
                Run(columns.Select(column => (CellAt(r, column), ParentOf(_columnHeaders[column]))), key, crossGroups);
            }

            foreach (var subtotal in _subtotals)
            {
                Run(columns.Select(column => (At(subtotal.Cells, column), ParentOf(_columnHeaders[column]))), key, crossGroups);
            }

            Run(columns.Select(column => (At(_columnTotals, column), ParentOf(_columnHeaders[column]))), key, crossGroups);

            foreach (var level in _columnSubtotals.GroupBy(subtotal => subtotal.Path.Count))
            {
                var ordered = level.ToArray();

                for (var row = 0; row < _rowHeaders.Count; row++)
                {
                    var r = row;
                    Run(ordered.Select(subtotal => (At(subtotal.Cells, r), ParentOf(subtotal.Path))), key, crossGroups);
                }

                foreach (var rowSubtotal in _subtotals)
                {
                    Run(ordered.Select(subtotal => (rowSubtotal.Crossing(KeyOf(subtotal.Path), subtotal.Path), ParentOf(subtotal.Path))), key, crossGroups);
                }

                Run(ordered.Select(subtotal => (subtotal.Totals, ParentOf(subtotal.Path))), key, crossGroups);
            }
        }

        public PivotResult ToResult(PivotResult original)
        {
            static IReadOnlyDictionary<string, decimal?> Read(Dictionary<string, decimal?> values) => values;

            // A position that was empty and stayed empty is not written back as a cell.
            var cells = _cells
                .Where(pair => pair.Value.Count > 0)
                .OrderBy(pair => pair.Key.Row)
                .ThenBy(pair => pair.Key.Column)
                .Select(pair => new PivotCell { Row = pair.Key.Row, Column = pair.Key.Column, Values = Read(pair.Value) })
                .ToArray();

            var subtotals = _subtotals.ToDictionary(subtotal => KeyOf(subtotal.Path));
            var columnSubtotals = _columnSubtotals.ToDictionary(subtotal => KeyOf(subtotal.Path));

            return new PivotResult
            {
                RowHeaders = original.RowHeaders,
                ColumnHeaders = original.ColumnHeaders,
                Cells = cells,
                RowTotals = original.RowTotals
                    .Select(total => new PivotTotal { Index = total.Index, Values = Read(_rowTotals[total.Index]) })
                    .ToArray(),
                ColumnTotals = original.ColumnTotals
                    .Select(total => new PivotTotal { Index = total.Index, Values = Read(_columnTotals[total.Index]) })
                    .ToArray(),
                Subtotals = original.Subtotals
                    .Select(subtotal =>
                    {
                        var mutable = subtotals[KeyOf(subtotal.RowHeader)];
                        return new PivotSubtotal
                        {
                            RowHeader = subtotal.RowHeader,
                            Cells = mutable.Cells
                                .Where(pair => pair.Value.Count > 0)
                                .OrderBy(pair => pair.Key)
                                .Select(pair => new PivotCell { Row = 0, Column = pair.Key, Values = Read(pair.Value) })
                                .ToArray(),
                            Totals = Read(mutable.Totals),
                            ColumnSubtotals = mutable.Crossings.Values
                                .Where(crossing => crossing.Values.Count > 0)
                                .Select(crossing => new PivotColumnSubtotalCell { ColumnHeader = crossing.Path, Values = Read(crossing.Values) })
                                .ToArray()
                        };
                    })
                    .ToArray(),
                ColumnSubtotals = original.ColumnSubtotals
                    .Select(subtotal =>
                    {
                        var mutable = columnSubtotals[KeyOf(subtotal.ColumnHeader)];
                        return new PivotColumnSubtotal
                        {
                            ColumnHeader = subtotal.ColumnHeader,
                            Cells = mutable.Cells
                                .Where(pair => pair.Value.Count > 0)
                                .OrderBy(pair => pair.Key)
                                .Select(pair => new PivotTotal { Index = pair.Key, Values = Read(pair.Value) })
                                .ToArray(),
                            Totals = Read(mutable.Totals)
                        };
                    })
                    .ToArray(),
                GrandTotals = original.GrandTotals,
                Metadata = original.Metadata,
                ValueRanges = original.ValueRanges
            };
        }
    }

    private sealed record SubtotalRow(
        IReadOnlyList<string?> Path,
        int FirstRow,
        Dictionary<int, Dictionary<string, decimal?>> Cells,
        Dictionary<string, decimal?> Totals,
        Dictionary<string, (IReadOnlyList<string?> Path, Dictionary<string, decimal?> Values)> CrossingMap)
    {
        public Dictionary<string, (IReadOnlyList<string?> Path, Dictionary<string, decimal?> Values)> Crossings => CrossingMap;

        public Dictionary<string, decimal?> Crossing(string key, IReadOnlyList<string?> path)
        {
            if (!CrossingMap.TryGetValue(key, out var crossing))
            {
                crossing = (path, new Dictionary<string, decimal?>(StringComparer.Ordinal));
                CrossingMap.Add(key, crossing);
            }

            return crossing.Values;
        }
    }

    private sealed record SubtotalColumn(
        IReadOnlyList<string?> Path,
        int FirstColumn,
        Dictionary<int, Dictionary<string, decimal?>> Cells,
        Dictionary<string, decimal?> Totals);
}
