using System.Globalization;

namespace PivotForge.Core;

/// <summary>Works out the formulas that read other cells (<c>Prev</c>, <c>ParentRow</c>, <c>Slice</c>…).</summary>
/// <remarks>
/// <para>
/// A cell's own bucket cannot see its neighbours, so a relative formula is first evaluated with
/// its relative parts empty and its summaries kept under hidden keys. This pass runs over the raw
/// result -- before the display modes, which then apply to the formula's value -- and evaluates
/// each relative formula again at every position, reading a relative part's summaries from the
/// position it names. The hidden keys are taken away at the end.
/// </para>
/// <para>
/// A position is where a row reference crosses a column reference; either is a header, a group
/// (a header prefix) or the axis' root (its totals). Neighbours are on the same level: a detail
/// row's neighbour is a detail row, a group's is a group of the same depth. Rows run in their
/// labels' order (the neutral order DevExtreme computes its display modes in), columns in the
/// order they are drawn. With <see cref="PivotValueDefinition.AllowCrossGroupCalculation"/> off a
/// neighbour must share the parent group.
/// </para>
/// </remarks>
internal static class PivotRelativeFormulas
{
    private const char Separator = '\u001f';

    public static string HiddenKey(string key, int index) => $"\u0001{key}#{index.ToString(CultureInfo.InvariantCulture)}";

    public static bool IsHidden(string key) => key.Length > 0 && key[0] == '\u0001';

    internal sealed record Raw(
        IReadOnlyList<PivotCell> Cells,
        IReadOnlyList<PivotTotal> RowTotals,
        IReadOnlyList<PivotTotal> ColumnTotals,
        IReadOnlyList<PivotSubtotal> Subtotals,
        IReadOnlyList<PivotColumnSubtotal> ColumnSubtotals,
        IReadOnlyDictionary<string, decimal?> GrandTotals);

    public static Raw Apply(
        Raw raw,
        IReadOnlyList<PivotValueDefinition> definitions,
        IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
        IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
        IReadOnlyList<PivotFieldRef> rowFields,
        IReadOnlyList<PivotFieldRef> columnFields,
        Func<int, IComparer<string?>> rowLevelOrder)
    {
        var relative = definitions
            .Where(definition => definition.Expression is not null)
            .Select(definition => (Definition: definition, Expression: PivotExpression.Parse(definition.Expression!)))
            .Where(entry => entry.Expression.IsRelative)
            .ToArray();

        if (relative.Length == 0)
        {
            return raw;
        }

        var grid = new Grid(raw, rowHeaders, columnHeaders, rowFields, columnFields, rowLevelOrder);

        foreach (var (definition, expression) in relative)
        {
            grid.Evaluate(definition.Key, expression, definition.AllowCrossGroupCalculation);
        }

        return grid.ToRaw();
    }

    private static string KeyOf(IEnumerable<string?> path) => string.Join(Separator, path.Select(value => value ?? ""));

    /// <summary>One axis' half of a position: a detail header (its index), a group (a prefix) or the root.</summary>
    private sealed record Ref(int? Index, IReadOnlyList<string?> Path)
    {
        public static readonly Ref Root = new(null, []);

        public bool IsRoot => Index is null && Path.Count == 0;

        public bool IsDetail => Index is not null;

        public Ref? Parent => IsRoot ? null : Path.Count <= 1 ? Root : new Ref(null, Path.Take(Path.Count - 1).ToArray());
    }

    private sealed class Grid
    {
        private readonly IReadOnlyList<IReadOnlyList<string?>> _rowHeaders;
        private readonly IReadOnlyList<IReadOnlyList<string?>> _columnHeaders;
        private readonly IReadOnlyList<PivotFieldRef> _rowFields;
        private readonly IReadOnlyList<PivotFieldRef> _columnFields;

        private readonly Dictionary<(int, int), Dictionary<string, decimal?>> _cells;
        private readonly Dictionary<int, Dictionary<string, decimal?>> _rowTotals;
        private readonly Dictionary<int, Dictionary<string, decimal?>> _columnTotals;
        private readonly Dictionary<string, Dictionary<string, decimal?>> _groupTotals = [];
        private readonly Dictionary<(string, int), Dictionary<string, decimal?>> _groupCells = [];
        private readonly Dictionary<(string, string), Dictionary<string, decimal?>> _crossings = [];
        private readonly Dictionary<string, Dictionary<string, decimal?>> _columnGroupTotals = [];
        private readonly Dictionary<(int, string), Dictionary<string, decimal?>> _columnGroupCells = [];
        private readonly Dictionary<string, decimal?> _grandTotals;

        // Neighbour orders, per axis and depth: each a list of references in order, and where
        // each reference sits in it.
        private readonly Dictionary<int, List<Ref>> _rowOrders = [];
        private readonly Dictionary<int, List<Ref>> _columnOrders = [];
        private readonly Dictionary<string, int> _rowPlaces = [];
        private readonly Dictionary<string, int> _columnPlaces = [];
        private readonly Dictionary<string, int> _rowIndexes = [];
        private readonly Dictionary<string, int> _columnIndexes = [];

        // A level's members in order, for Slice.
        private readonly Dictionary<int, List<string?>> _rowMembers = [];
        private readonly Dictionary<int, List<string?>> _columnMembers = [];

        private readonly IReadOnlyList<PivotSubtotal> _subtotals;
        private readonly IReadOnlyList<PivotColumnSubtotal> _columnSubtotals;

        public Grid(
            Raw raw,
            IReadOnlyList<IReadOnlyList<string?>> rowHeaders,
            IReadOnlyList<IReadOnlyList<string?>> columnHeaders,
            IReadOnlyList<PivotFieldRef> rowFields,
            IReadOnlyList<PivotFieldRef> columnFields,
            Func<int, IComparer<string?>> rowLevelOrder)
        {
            _rowHeaders = rowHeaders;
            _columnHeaders = columnHeaders;
            _rowFields = rowFields;
            _columnFields = columnFields;
            _subtotals = raw.Subtotals;
            _columnSubtotals = raw.ColumnSubtotals;
            _cells = raw.Cells.ToDictionary(cell => (cell.Row, cell.Column), cell => Copy(cell.Values));
            _rowTotals = raw.RowTotals.ToDictionary(total => total.Index, total => Copy(total.Values));
            _columnTotals = raw.ColumnTotals.ToDictionary(total => total.Index, total => Copy(total.Values));
            _grandTotals = Copy(raw.GrandTotals);

            foreach (var subtotal in raw.Subtotals)
            {
                var key = KeyOf(subtotal.RowHeader);
                _groupTotals[key] = Copy(subtotal.Totals);
                foreach (var cell in subtotal.Cells)
                {
                    _groupCells[(key, cell.Column)] = Copy(cell.Values);
                }

                foreach (var cell in subtotal.ColumnSubtotals)
                {
                    _crossings[(key, KeyOf(cell.ColumnHeader))] = Copy(cell.Values);
                }
            }

            foreach (var subtotal in raw.ColumnSubtotals)
            {
                var key = KeyOf(subtotal.ColumnHeader);
                _columnGroupTotals[key] = Copy(subtotal.Totals);
                foreach (var cell in subtotal.Cells)
                {
                    _columnGroupCells[(cell.Index, key)] = Copy(cell.Values);
                }
            }

            for (var index = 0; index < rowHeaders.Count; index++)
            {
                _rowIndexes[KeyOf(rowHeaders[index])] = index;
            }

            for (var index = 0; index < columnHeaders.Count; index++)
            {
                _columnIndexes[KeyOf(columnHeaders[index])] = index;
            }

            // Rows in their labels' order, level by level; the comparer is the engine's own.
            var rowComparer = Comparer<IReadOnlyList<string?>>.Create((left, right) =>
            {
                for (var level = 0; level < Math.Min(left.Count, right.Count); level++)
                {
                    var order = rowLevelOrder(level).Compare(left[level], right[level]);
                    if (order != 0)
                    {
                        return order;
                    }
                }

                return left.Count.CompareTo(right.Count);
            });
            BuildOrder(
                rowHeaders,
                raw.Subtotals.Select(subtotal => subtotal.RowHeader),
                headers => headers.OrderBy(entry => entry.Header, rowComparer),
                _rowOrders,
                _rowPlaces,
                _rowMembers);
            // Columns as they are drawn: the engine has already put them in order. The column
            // axis is the product of its levels, so it holds columns no record fell into; they
            // are left out, or a column hidden as empty would sit between two neighbours the
            // reader sees side by side.
            var observed = raw.ColumnTotals.Select(total => total.Index).ToHashSet();
            BuildOrder(
                columnHeaders,
                raw.ColumnSubtotals.Select(subtotal => subtotal.ColumnHeader),
                headers => headers.Where(entry => observed.Contains(entry.Index)),
                _columnOrders,
                _columnPlaces,
                _columnMembers);
        }

        private static Dictionary<string, decimal?> Copy(IReadOnlyDictionary<string, decimal?> values) =>
            new(values, StringComparer.Ordinal);

        private static string PlaceKey(Ref reference) =>
            reference.IsDetail ? "d" + Separator + KeyOf(reference.Path) : "g" + Separator + KeyOf(reference.Path);

        private static void BuildOrder(
            IReadOnlyList<IReadOnlyList<string?>> headers,
            IEnumerable<IReadOnlyList<string?>> groups,
            Func<IEnumerable<(IReadOnlyList<string?> Header, int Index)>, IEnumerable<(IReadOnlyList<string?> Header, int Index)>> order,
            Dictionary<int, List<Ref>> orders,
            Dictionary<string, int> places,
            Dictionary<int, List<string?>> members)
        {
            var details = order(headers.Select((header, index) => (Header: header, Index: index))).ToArray();
            orders[-1] = details.Select(detail => new Ref(detail.Index, detail.Header)).ToList();

            // A group sits where its first header does: one pass records that for every prefix.
            var firstPlace = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var place = 0; place < details.Length; place++)
            {
                for (var length = 1; length < details[place].Header.Count; length++)
                {
                    firstPlace.TryAdd(KeyOf(details[place].Header.Take(length)), place);
                }
            }

            foreach (var byDepth in groups.GroupBy(path => path.Count))
            {
                orders[byDepth.Key] = byDepth
                    .OrderBy(path => firstPlace.GetValueOrDefault(KeyOf(path), int.MaxValue))
                    .Select(path => new Ref(null, path))
                    .ToList();
            }

            foreach (var list in orders.Values)
            {
                for (var place = 0; place < list.Count; place++)
                {
                    places[PlaceKey(list[place])] = place;
                }
            }

            var depth = headers.Count == 0 ? 0 : headers.Max(header => header.Count);
            for (var level = 0; level < depth; level++)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                members[level] = details
                    .Select(detail => detail.Header.ElementAtOrDefault(level))
                    .Where(value => seen.Add(value ?? "\u0000"))
                    .ToList();
            }
        }

        private Dictionary<string, decimal?>? ValuesAt(Ref row, Ref column) => (row, column) switch
        {
            ({ IsRoot: true }, { IsRoot: true }) => _grandTotals,
            ({ IsRoot: true }, { IsDetail: true }) => _columnTotals.GetValueOrDefault(column.Index!.Value),
            ({ IsRoot: true }, _) => _columnGroupTotals.GetValueOrDefault(KeyOf(column.Path)),
            ({ IsDetail: true }, { IsRoot: true }) => _rowTotals.GetValueOrDefault(row.Index!.Value),
            ({ IsDetail: true }, { IsDetail: true }) => _cells.GetValueOrDefault((row.Index!.Value, column.Index!.Value)),
            ({ IsDetail: true }, _) => _columnGroupCells.GetValueOrDefault((row.Index!.Value, KeyOf(column.Path))),
            (_, { IsRoot: true }) => _groupTotals.GetValueOrDefault(KeyOf(row.Path)),
            (_, { IsDetail: true }) => _groupCells.GetValueOrDefault((KeyOf(row.Path), column.Index!.Value)),
            _ => _crossings.GetValueOrDefault((KeyOf(row.Path), KeyOf(column.Path)))
        };

        private static Ref? Neighbour(
            Ref reference,
            int step,
            bool crossGroups,
            Dictionary<int, List<Ref>> orders,
            Dictionary<string, int> places)
        {
            if (reference.IsRoot)
            {
                return null;
            }

            var list = orders[reference.IsDetail ? -1 : reference.Path.Count];
            if (!places.TryGetValue(PlaceKey(reference), out var place))
            {
                return null;
            }

            var target = place + step;
            if (target < 0 || target >= list.Count)
            {
                return null;
            }

            var neighbour = list[target];
            if (!crossGroups && KeyOf(reference.Parent!.Path) != KeyOf(neighbour.Parent!.Path))
            {
                return null;
            }

            return neighbour;
        }

        // The same reference with one level's member moved along that level's members.
        private Ref? Sliced(
            Ref reference,
            int level,
            int offset,
            Dictionary<int, List<string?>> members,
            Dictionary<string, int> detailIndexes,
            Func<string, bool> groupExists)
        {
            if (reference.IsRoot || reference.Path.Count <= level || !members.TryGetValue(level, out var list))
            {
                return null;
            }

            var place = list.IndexOf(reference.Path[level]);
            var target = place + offset;
            if (place < 0 || target < 0 || target >= list.Count)
            {
                return null;
            }

            var path = reference.Path.ToArray();
            path[level] = list[target];
            var key = KeyOf(path);

            if (reference.IsDetail)
            {
                return detailIndexes.TryGetValue(key, out var index) ? new Ref(index, path) : null;
            }

            return groupExists(key) ? new Ref(null, path) : null;
        }

        private static int LevelOf(IReadOnlyList<PivotFieldRef> fields, string name)
        {
            for (var level = 0; level < fields.Count; level++)
            {
                if (string.Equals(fields[level].Field, name, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(fields[level].Key, name, StringComparison.OrdinalIgnoreCase))
                {
                    return level;
                }
            }

            return -1;
        }

        private (Ref Row, Ref Column)? Target((Ref Row, Ref Column) at, PivotExpression.RelativeNode node, bool crossGroups)
        {
            var (row, column) = at;

            switch (node.Kind)
            {
                case PivotExpression.RelativeKind.Prev:
                case PivotExpression.RelativeKind.Next:
                    return Neighbour(column, node.Kind == PivotExpression.RelativeKind.Prev ? -1 : 1, crossGroups, _columnOrders, _columnPlaces)
                        is { } previousColumn ? (row, previousColumn) : null;
                case PivotExpression.RelativeKind.PrevRow:
                case PivotExpression.RelativeKind.NextRow:
                    return Neighbour(row, node.Kind == PivotExpression.RelativeKind.PrevRow ? -1 : 1, crossGroups, _rowOrders, _rowPlaces)
                        is { } previousRow ? (previousRow, column) : null;
                case PivotExpression.RelativeKind.ParentRow:
                    return row.Parent is { } parentRow ? (parentRow, column) : null;
                case PivotExpression.RelativeKind.ParentColumn:
                    return column.Parent is { } parentColumn ? (row, parentColumn) : null;
                case PivotExpression.RelativeKind.RowTotal:
                    return (row, Ref.Root);
                case PivotExpression.RelativeKind.ColumnTotal:
                    return (Ref.Root, column);
                case PivotExpression.RelativeKind.GrandTotal:
                    return (Ref.Root, Ref.Root);
                case PivotExpression.RelativeKind.Slice:
                    var rowLevel = LevelOf(_rowFields, node.Field!);
                    if (rowLevel >= 0)
                    {
                        return Sliced(row, rowLevel, node.Offset, _rowMembers, _rowIndexes, _groupTotals.ContainsKey)
                            is { } slicedRow ? (slicedRow, column) : null;
                    }

                    var columnLevel = LevelOf(_columnFields, node.Field!);
                    if (columnLevel >= 0)
                    {
                        return Sliced(column, columnLevel, node.Offset, _columnMembers, _columnIndexes, _columnGroupTotals.ContainsKey)
                            is { } slicedColumn ? (row, slicedColumn) : null;
                    }

                    // A level that is not on either axis names nothing to move along.
                    return null;
                default:
                    return null;
            }
        }

        private decimal? EvaluateAt(PivotExpression.Node node, (Ref Row, Ref Column) at, string key, bool crossGroups)
        {
            var values = ValuesAt(at.Row, at.Column);

            return PivotExpression.Evaluate(
                node,
                index => values is not null && values.TryGetValue(HiddenKey(key, index), out var summary) ? summary : null,
                relative => Target(at, relative, crossGroups) is { } target
                    ? EvaluateAt(relative.Inner, target, key, crossGroups)
                    : null);
        }

        private IEnumerable<(Ref Row, Ref Column, Dictionary<string, decimal?> Values)> Positions()
        {
            foreach (var ((row, column), values) in _cells)
            {
                yield return (new Ref(row, _rowHeaders[row]), new Ref(column, _columnHeaders[column]), values);
            }

            foreach (var (row, values) in _rowTotals)
            {
                yield return (new Ref(row, _rowHeaders[row]), Ref.Root, values);
            }

            foreach (var (column, values) in _columnTotals)
            {
                yield return (Ref.Root, new Ref(column, _columnHeaders[column]), values);
            }

            foreach (var subtotal in _subtotals)
            {
                var key = KeyOf(subtotal.RowHeader);
                var row = new Ref(null, subtotal.RowHeader);
                yield return (row, Ref.Root, _groupTotals[key]);

                foreach (var cell in subtotal.Cells)
                {
                    yield return (row, new Ref(cell.Column, _columnHeaders[cell.Column]), _groupCells[(key, cell.Column)]);
                }

                foreach (var cell in subtotal.ColumnSubtotals)
                {
                    yield return (row, new Ref(null, cell.ColumnHeader), _crossings[(key, KeyOf(cell.ColumnHeader))]);
                }
            }

            foreach (var subtotal in _columnSubtotals)
            {
                var key = KeyOf(subtotal.ColumnHeader);
                var column = new Ref(null, subtotal.ColumnHeader);
                yield return (Ref.Root, column, _columnGroupTotals[key]);

                foreach (var cell in subtotal.Cells)
                {
                    yield return (new Ref(cell.Index, _rowHeaders[cell.Index]), column, _columnGroupCells[(cell.Index, key)]);
                }
            }

            yield return (Ref.Root, Ref.Root, _grandTotals);
        }

        public void Evaluate(string key, PivotExpression expression, bool crossGroups)
        {
            // Every result first, every write after: each position reads only hidden summaries,
            // but writing as it goes would still mean one position's write is visible to the
            // next only by accident.
            var results = Positions()
                .Select(position => (position.Values, Value: EvaluateAt(expression.Root, (position.Row, position.Column), key, crossGroups)))
                .ToArray();

            foreach (var (values, value) in results)
            {
                values[key] = value;
            }
        }

        public Raw ToRaw()
        {
            static IReadOnlyDictionary<string, decimal?> Visible(Dictionary<string, decimal?> values)
            {
                foreach (var hidden in values.Keys.Where(IsHidden).ToArray())
                {
                    values.Remove(hidden);
                }

                return values;
            }

            return new Raw(
                _cells.OrderBy(pair => pair.Key.Item1).ThenBy(pair => pair.Key.Item2)
                    .Select(pair => new PivotCell { Row = pair.Key.Item1, Column = pair.Key.Item2, Values = Visible(pair.Value) })
                    .ToArray(),
                _rowTotals.OrderBy(pair => pair.Key).Select(pair => new PivotTotal { Index = pair.Key, Values = Visible(pair.Value) }).ToArray(),
                _columnTotals.OrderBy(pair => pair.Key).Select(pair => new PivotTotal { Index = pair.Key, Values = Visible(pair.Value) }).ToArray(),
                _subtotals.Select(subtotal =>
                {
                    var key = KeyOf(subtotal.RowHeader);
                    return new PivotSubtotal
                    {
                        RowHeader = subtotal.RowHeader,
                        Cells = subtotal.Cells
                            .Select(cell => new PivotCell { Row = cell.Row, Column = cell.Column, Values = Visible(_groupCells[(key, cell.Column)]) })
                            .ToArray(),
                        Totals = Visible(_groupTotals[key]),
                        ColumnSubtotals = subtotal.ColumnSubtotals
                            .Select(cell => new PivotColumnSubtotalCell
                            {
                                ColumnHeader = cell.ColumnHeader,
                                Values = Visible(_crossings[(key, KeyOf(cell.ColumnHeader))])
                            })
                            .ToArray()
                    };
                }).ToArray(),
                _columnSubtotals.Select(subtotal =>
                {
                    var key = KeyOf(subtotal.ColumnHeader);
                    return new PivotColumnSubtotal
                    {
                        ColumnHeader = subtotal.ColumnHeader,
                        Cells = subtotal.Cells
                            .Select(cell => new PivotTotal { Index = cell.Index, Values = Visible(_columnGroupCells[(cell.Index, key)]) })
                            .ToArray(),
                        Totals = Visible(_columnGroupTotals[key])
                    };
                }).ToArray(),
                Visible(_grandTotals));
        }
    }
}
