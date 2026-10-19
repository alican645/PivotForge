using System.Globalization;
using System.Text;
using PivotForge.MvcDemo.Models;

namespace PivotForge.MvcDemo.Xmla;

// The part of MDX the PivotForge XmlaStore writes, read and run against the
// demo's SalesCube: sets in braces, tuples, Level.Members, CrossJoin, Union,
// NON EMPTY, nested subselects, a WHERE tuple, DRILLTHROUGH MAXROWS, and for a
// page of rows WITH MEMBER, Subset, NonEmpty, Order, Count, Rank, IIF/IsEmpty,
// Ancestor, CurrentMember and Member_Caption, and for a branch opened below a
// closed level Descendants. Anything else is an error, as it would be on a
// server that does not know it.

internal sealed class MdxException(string message) : Exception(message);

internal enum MdxTokenKind { Bracket, Word, Number, Symbol, End }

internal readonly record struct MdxToken(MdxTokenKind Kind, string Text);

internal abstract record MdxSet;
internal sealed record MdxSetLiteral(IReadOnlyList<MdxSet> Items) : MdxSet;
internal sealed record MdxMemberRef(string UniqueName) : MdxSet;
internal sealed record MdxLevelMembers(string LevelName) : MdxSet;
internal sealed record MdxFunction(string Name, IReadOnlyList<MdxSet> Arguments) : MdxSet;
internal sealed record MdxTupleSet(IReadOnlyList<string> Members) : MdxSet;
internal sealed record MdxSubset(MdxSet Set, int Start, int Count) : MdxSet;
internal sealed record MdxNonEmpty(MdxSet Set, MdxSet Against) : MdxSet;
internal sealed record MdxOrder(MdxSet Set, MdxExpression Key, bool Descending) : MdxSet;
internal sealed record MdxDescendants(MdxSet Set, string Level) : MdxSet;

// A member found from where an expression is evaluated.
internal abstract record MdxMemberExpression;
internal sealed record MdxNamedMember(string UniqueName) : MdxMemberExpression;
internal sealed record MdxCurrentMember(string Hierarchy) : MdxMemberExpression;
internal sealed record MdxAncestor(MdxMemberExpression Member, string Level) : MdxMemberExpression;

internal abstract record MdxExpression;
internal sealed record MdxNumber(decimal Value) : MdxExpression;
internal sealed record MdxCount(MdxSet Set) : MdxExpression;
internal sealed record MdxRank(MdxMemberExpression Member, MdxSet Set) : MdxExpression;
internal sealed record MdxIif(MdxExpression Tested, MdxExpression WhenEmpty, MdxExpression Otherwise) : MdxExpression;
internal sealed record MdxTupleValue(IReadOnlyList<MdxMemberExpression> Members) : MdxExpression;
internal sealed record MdxCaption(MdxMemberExpression Member) : MdxExpression;

internal sealed record MdxAxis(MdxSet Set, bool NonEmpty, int Ordinal);

internal abstract record MdxSource;
internal sealed record MdxCube(string Name) : MdxSource;
internal sealed record MdxSubselect(MdxSet Set, MdxSource Inner) : MdxSource;

internal sealed record MdxStatement(
    IReadOnlyList<MdxAxis> Axes,
    MdxSource From,
    IReadOnlyList<string> Where,
    int? DrillthroughMaxRows,
    IReadOnlyDictionary<string, MdxExpression> CalculatedMembers);

internal static class MdxParser
{
    public static MdxStatement Parse(string text) => new Reader(Tokenize(text)).Statement();

    private static List<MdxToken> Tokenize(string text)
    {
        var tokens = new List<MdxToken>();
        var position = 0;
        while (position < text.Length)
        {
            var current = text[position];
            if (char.IsWhiteSpace(current))
            {
                position++;
            }
            else if (current == '[')
            {
                var name = new StringBuilder();
                position++;
                while (true)
                {
                    if (position >= text.Length)
                    {
                        throw new MdxException("A bracketed name is missing its closing ']'.");
                    }

                    if (text[position] == ']')
                    {
                        if (position + 1 < text.Length && text[position + 1] == ']')
                        {
                            name.Append(']');
                            position += 2;
                            continue;
                        }

                        position++;
                        break;
                    }

                    name.Append(text[position++]);
                }

                tokens.Add(new MdxToken(MdxTokenKind.Bracket, name.ToString()));
            }
            else if (char.IsDigit(current))
            {
                var start = position;
                while (position < text.Length && char.IsDigit(text[position]))
                {
                    position++;
                }

                tokens.Add(new MdxToken(MdxTokenKind.Number, text[start..position]));
            }
            else if (char.IsLetter(current) || current == '_')
            {
                var start = position;
                while (position < text.Length && (char.IsLetterOrDigit(text[position]) || text[position] == '_'))
                {
                    position++;
                }

                tokens.Add(new MdxToken(MdxTokenKind.Word, text[start..position]));
            }
            else if ("{}(),.&".Contains(current, StringComparison.Ordinal))
            {
                tokens.Add(new MdxToken(MdxTokenKind.Symbol, current.ToString()));
                position++;
            }
            else
            {
                throw new MdxException($"Unexpected '{current}' in the MDX statement.");
            }
        }

        tokens.Add(new MdxToken(MdxTokenKind.End, ""));
        return tokens;
    }

    private sealed class Reader(List<MdxToken> tokens)
    {
        private int _position;

        private MdxToken Peek(int ahead = 0) => tokens[Math.Min(_position + ahead, tokens.Count - 1)];

        private MdxToken Next() => tokens[_position++];

        private bool IsWord(string word, int ahead = 0) =>
            Peek(ahead).Kind == MdxTokenKind.Word && string.Equals(Peek(ahead).Text, word, StringComparison.OrdinalIgnoreCase);

        private bool IsSymbol(string symbol, int ahead = 0) =>
            Peek(ahead).Kind == MdxTokenKind.Symbol && Peek(ahead).Text == symbol;

        private void ExpectWord(string word)
        {
            if (!IsWord(word))
            {
                throw new MdxException($"Expected {word} but found '{Peek().Text}'.");
            }

            _position++;
        }

        private void ExpectSymbol(string symbol)
        {
            if (!IsSymbol(symbol))
            {
                throw new MdxException($"Expected '{symbol}' but found '{Peek().Text}'.");
            }

            _position++;
        }

        public MdxStatement Statement()
        {
            int? maxRows = null;
            if (IsWord("DRILLTHROUGH"))
            {
                _position++;
                maxRows = int.MaxValue;
                if (IsWord("MAXROWS"))
                {
                    _position++;
                    maxRows = int.Parse(Next().Text, CultureInfo.InvariantCulture);
                }
            }

            var calculated = new Dictionary<string, MdxExpression>(StringComparer.OrdinalIgnoreCase);
            if (IsWord("WITH"))
            {
                _position++;
                while (IsWord("MEMBER"))
                {
                    _position++;
                    var name = Name(out _);
                    ExpectWord("AS");
                    calculated[name] = Expression();
                }
            }

            var (axes, from) = Select();
            var where = new List<string>();
            if (IsWord("WHERE"))
            {
                _position++;
                var parenthesized = IsSymbol("(");
                if (parenthesized)
                {
                    _position++;
                }

                do
                {
                    where.Add(Name(out var members) is { } name && !members
                        ? name
                        : throw new MdxException("A WHERE clause names members, not sets."));
                }
                while (parenthesized && IsSymbol(",") && Advance());

                if (parenthesized)
                {
                    ExpectSymbol(")");
                }
            }

            if (IsWord("CELL"))
            {
                _position++;
                ExpectWord("PROPERTIES");
                Next();
                while (IsSymbol(","))
                {
                    _position++;
                    Next();
                }
            }

            if (Peek().Kind != MdxTokenKind.End)
            {
                throw new MdxException($"Unexpected '{Peek().Text}' after the statement.");
            }

            return new MdxStatement(axes, from, where, maxRows, calculated);
        }

        private bool Advance()
        {
            _position++;
            return true;
        }

        private (List<MdxAxis> Axes, MdxSource From) Select()
        {
            ExpectWord("SELECT");
            var axes = new List<MdxAxis>();
            if (!IsWord("FROM"))
            {
                axes.Add(Axis());
                while (IsSymbol(","))
                {
                    _position++;
                    axes.Add(Axis());
                }
            }

            ExpectWord("FROM");
            return (axes, Source());
        }

        private MdxAxis Axis()
        {
            var nonEmpty = false;
            if (IsWord("NON") && IsWord("EMPTY", 1))
            {
                _position += 2;
                nonEmpty = true;
            }

            var set = Set();
            if (IsWord("DIMENSION"))
            {
                _position++;
                ExpectWord("PROPERTIES");
                Next();
                // A comma continues the list only before another property name;
                // before a set it starts the next axis.
                while (IsSymbol(",") && Peek(1).Kind == MdxTokenKind.Word && !IsSymbol("(", 2) && !IsWord("NON", 1))
                {
                    _position += 2;
                }
            }

            ExpectWord("ON");
            var target = Next();
            var ordinal = target.Kind == MdxTokenKind.Number
                ? int.Parse(target.Text, CultureInfo.InvariantCulture)
                : target.Text.ToUpperInvariant() switch
                {
                    "COLUMNS" => 0,
                    "ROWS" => 1,
                    _ => throw new MdxException($"Unknown axis '{target.Text}'.")
                };
            return new MdxAxis(set, nonEmpty, ordinal);
        }

        private MdxSource Source()
        {
            if (IsSymbol("("))
            {
                _position++;
                var (axes, inner) = Select();
                ExpectSymbol(")");
                if (axes.Count != 1)
                {
                    throw new MdxException("A subselect selects one axis.");
                }

                return new MdxSubselect(axes[0].Set, inner);
            }

            var cube = Next();
            return cube.Kind == MdxTokenKind.Bracket
                ? new MdxCube(cube.Text)
                : throw new MdxException($"Expected a cube name but found '{cube.Text}'.");
        }

        private MdxSet Set()
        {
            if (IsSymbol("{"))
            {
                _position++;
                var items = new List<MdxSet>();
                if (!IsSymbol("}"))
                {
                    items.Add(Set());
                    while (IsSymbol(","))
                    {
                        _position++;
                        items.Add(Set());
                    }
                }

                ExpectSymbol("}");
                return new MdxSetLiteral(items);
            }

            if (IsSymbol("("))
            {
                _position++;
                var members = new List<string> { Name(out _) };
                while (IsSymbol(","))
                {
                    _position++;
                    members.Add(Name(out _));
                }

                ExpectSymbol(")");
                return new MdxTupleSet(members);
            }

            if (IsWord("Subset") && IsSymbol("(", 1))
            {
                _position += 2;
                var inner = Set();
                ExpectSymbol(",");
                var start = int.Parse(Next().Text, CultureInfo.InvariantCulture);
                ExpectSymbol(",");
                var count = int.Parse(Next().Text, CultureInfo.InvariantCulture);
                ExpectSymbol(")");
                return new MdxSubset(inner, start, count);
            }

            if (IsWord("Descendants") && IsSymbol("(", 1))
            {
                _position += 2;
                var inner = Set();
                ExpectSymbol(",");
                var level = Name(out _);
                ExpectSymbol(")");
                return new MdxDescendants(inner, level);
            }

            if (IsWord("NonEmpty") && IsSymbol("(", 1))
            {
                _position += 2;
                var inner = Set();
                ExpectSymbol(",");
                var against = Set();
                ExpectSymbol(")");
                return new MdxNonEmpty(inner, against);
            }

            if (IsWord("Order") && IsSymbol("(", 1))
            {
                _position += 2;
                var inner = Set();
                ExpectSymbol(",");
                var key = Expression();
                ExpectSymbol(",");
                var flag = Next().Text.ToUpperInvariant();
                ExpectSymbol(")");
                return flag is "ASC" or "BASC" or "DESC" or "BDESC"
                    ? new MdxOrder(inner, key, flag.EndsWith("DESC", StringComparison.Ordinal))
                    : throw new MdxException($"Unknown order '{flag}'.");
            }

            if (Peek().Kind == MdxTokenKind.Word && IsSymbol("(", 1))
            {
                var name = Next().Text;
                if (!string.Equals(name, "CrossJoin", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(name, "Union", StringComparison.OrdinalIgnoreCase))
                {
                    throw new MdxException($"The function {name} is not supported here.");
                }

                _position++;
                var arguments = new List<MdxSet> { Set() };
                while (IsSymbol(","))
                {
                    _position++;
                    arguments.Add(Set());
                }

                ExpectSymbol(")");
                return new MdxFunction(name, arguments);
            }

            var reference = Name(out var isMembers);
            return isMembers ? new MdxLevelMembers(reference) : new MdxMemberRef(reference);
        }

        private MdxExpression Expression()
        {
            if (Peek().Kind == MdxTokenKind.Number)
            {
                return new MdxNumber(decimal.Parse(Next().Text, CultureInfo.InvariantCulture));
            }

            if (IsWord("Count") && IsSymbol("(", 1))
            {
                _position += 2;
                var set = Set();
                ExpectSymbol(")");
                return new MdxCount(set);
            }

            if (IsWord("Rank") && IsSymbol("(", 1))
            {
                _position += 2;
                var member = MemberExpression();
                ExpectSymbol(",");
                var set = Set();
                ExpectSymbol(")");
                return new MdxRank(member, set);
            }

            if (IsWord("IIF") && IsSymbol("(", 1))
            {
                _position += 2;
                ExpectWord("IsEmpty");
                ExpectSymbol("(");
                var tested = Expression();
                ExpectSymbol(")");
                ExpectSymbol(",");
                var whenEmpty = Expression();
                ExpectSymbol(",");
                var otherwise = Expression();
                ExpectSymbol(")");
                return new MdxIif(tested, whenEmpty, otherwise);
            }

            if (IsSymbol("("))
            {
                _position++;
                var members = new List<MdxMemberExpression> { MemberExpression() };
                while (IsSymbol(","))
                {
                    _position++;
                    members.Add(MemberExpression());
                }

                ExpectSymbol(")");
                return new MdxTupleValue(members);
            }

            var single = MemberExpression();
            if (IsSymbol(".") && IsWord("Member_Caption", 1))
            {
                _position += 2;
                return new MdxCaption(single);
            }

            return new MdxTupleValue([single]);
        }

        private MdxMemberExpression MemberExpression()
        {
            if (IsWord("Ancestor") && IsSymbol("(", 1))
            {
                _position += 2;
                var member = MemberExpression();
                ExpectSymbol(",");
                var level = Name(out _);
                ExpectSymbol(")");
                return new MdxAncestor(member, level);
            }

            var name = Name(out var members);
            if (members)
            {
                throw new MdxException("Expected a member but found a set.");
            }

            if (IsSymbol(".") && IsWord("CurrentMember", 1))
            {
                _position += 2;
                return new MdxCurrentMember(name);
            }

            return new MdxNamedMember(name);
        }

        // [A].[B].&[C]&[D], or a level followed by .Members.
        private string Name(out bool members)
        {
            members = false;
            var name = new StringBuilder();
            if (Peek().Kind != MdxTokenKind.Bracket)
            {
                throw new MdxException($"Expected a name but found '{Peek().Text}'.");
            }

            name.Append(Bracket(Next().Text));
            while (true)
            {
                if (IsSymbol(".") && Peek(1).Kind == MdxTokenKind.Bracket)
                {
                    _position++;
                    name.Append('.').Append(Bracket(Next().Text));
                }
                else if (IsSymbol("&") && Peek(1).Kind == MdxTokenKind.Bracket)
                {
                    _position++;
                    name.Append('&').Append(Bracket(Next().Text));
                }
                else if (IsSymbol(".") && IsSymbol("&", 1) && Peek(2).Kind == MdxTokenKind.Bracket)
                {
                    _position += 2;
                    name.Append(".&").Append(Bracket(Next().Text));
                }
                else if (IsSymbol(".") && IsWord("Members", 1))
                {
                    _position += 2;
                    members = true;
                    return name.ToString();
                }
                else
                {
                    return name.ToString();
                }
            }
        }

        private static string Bracket(string name) => $"[{name.Replace("]", "]]", StringComparison.Ordinal)}]";
    }
}

// Runs a parsed statement: the axes as lists of member tuples, the cells as
// the measure of each crossing over the records the subselects and the WHERE
// clause leave. An expression is evaluated where a tuple stands: a hierarchy's
// CurrentMember is the tuple's member of it, or its All member.
internal sealed class MdxEvaluator(SalesCube cube)
{
    public sealed record Result(
        IReadOnlyList<IReadOnlyList<CubeMember>> Columns,
        IReadOnlyList<IReadOnlyList<CubeMember>>? Rows,
        IReadOnlyDictionary<int, decimal> Cells);

    private sealed record Context(IReadOnlyList<SalesRecord> Records, IReadOnlyList<CubeMember> Tuple);

    private IReadOnlyDictionary<string, MdxExpression> _calculated =
        new Dictionary<string, MdxExpression>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, CubeMember> _calculatedMembers = new(StringComparer.OrdinalIgnoreCase);

    public Result Execute(MdxStatement statement)
    {
        _calculated = statement.CalculatedMembers;
        var slicer = statement.Where.Select(Member).ToArray();
        var records = Restrict(statement.From)
            .Where(record => slicer.All(member => member.Contains(record)))
            .ToArray();
        var context = new Context(records, slicer);
        var columnAxis = statement.Axes.FirstOrDefault(axis => axis.Ordinal == 0);
        var rowAxis = statement.Axes.FirstOrDefault(axis => axis.Ordinal == 1);
        if (statement.Axes.Any(axis => axis.Ordinal > 1))
        {
            throw new MdxException("Only the COLUMNS and ROWS axes are supported.");
        }

        var columns = columnAxis is null ? [[]] : Evaluate(columnAxis.Set, context);
        var rows = rowAxis is null ? [[]] : Evaluate(rowAxis.Set, context);

        var values = rows.Select(row => columns.Select(column => Cell(context, [.. row, .. column])).ToArray()).ToArray();
        var keptColumns = Enumerable.Range(0, columns.Count)
            .Where(column => columnAxis?.NonEmpty != true || values.Any(row => row[column] is not null))
            .ToArray();
        var keptRows = Enumerable.Range(0, rows.Count)
            .Where(row => rowAxis?.NonEmpty != true || keptColumns.Any(column => values[row][column] is not null))
            .ToArray();

        var cells = new Dictionary<int, decimal>();
        for (var row = 0; row < keptRows.Length; row++)
        {
            for (var column = 0; column < keptColumns.Length; column++)
            {
                if (values[keptRows[row]][keptColumns[column]] is { } value)
                {
                    cells[row * keptColumns.Length + column] = value;
                }
            }
        }

        return new Result(
            keptColumns.Select(column => columns[column]).ToArray(),
            rowAxis is null ? null : keptRows.Select(row => rows[row]).ToArray(),
            cells);
    }

    public IReadOnlyList<SalesRecord> Drillthrough(MdxStatement statement)
    {
        var slicer = statement.Where.Select(Member).ToArray();
        return Restrict(statement.From)
            .Where(record => slicer.All(member => member.Contains(record)))
            .Take(statement.DrillthroughMaxRows ?? int.MaxValue)
            .ToArray();
    }

    // The value of a tuple: its measure (the last one named, a calculated one
    // evaluated in its place) over the records all its members hold.
    private decimal? Cell(Context context, IReadOnlyList<CubeMember> members)
    {
        var tuple = Merge(context.Tuple, members);
        var measure = tuple.LastOrDefault(member => member.Measure is not null);
        if (measure is not null && _calculated.TryGetValue(measure.UniqueName, out var expression))
        {
            return Value(expression, context with { Tuple = tuple }) as decimal?;
        }

        var kept = context.Records.Where(record => tuple.All(member => member.Contains(record))).ToArray();
        return (measure?.Measure ?? cube.DefaultMeasure).Compute(kept);
    }

    // A tuple with another's members in place of its own, hierarchy by hierarchy.
    private static IReadOnlyList<CubeMember> Merge(IReadOnlyList<CubeMember> tuple, IReadOnlyList<CubeMember> members)
    {
        var merged = tuple.Where(member => members.All(other => other.Hierarchy != member.Hierarchy)).ToList();
        merged.AddRange(members);
        return merged;
    }

    private object? Value(MdxExpression expression, Context context)
    {
        switch (expression)
        {
            case MdxNumber number:
                return number.Value;
            case MdxCount count:
                return (decimal)Evaluate(count.Set, context).Count;
            case MdxRank rank:
                var member = Resolve(rank.Member, context);
                var position = Evaluate(rank.Set, context).FindIndex(tuple => tuple.Count == 1 && tuple[0] == member);
                return (decimal)(position + 1);
            case MdxIif iif:
                return Value(iif.Tested, context) is null ? Value(iif.WhenEmpty, context) : Value(iif.Otherwise, context);
            case MdxCaption caption:
                return Resolve(caption.Member, context).Caption;
            case MdxTupleValue tuple:
                return Cell(context, tuple.Members.Select(entry => Resolve(entry, context)).ToArray());
            default:
                throw new MdxException("Unknown expression.");
        }
    }

    private CubeMember Resolve(MdxMemberExpression expression, Context context)
    {
        switch (expression)
        {
            case MdxNamedMember named:
                return Member(named.UniqueName);
            case MdxCurrentMember current:
                var hierarchy = cube.FindHierarchy(current.Hierarchy)
                    ?? throw new MdxException($"The hierarchy '{current.Hierarchy}' was not found in the cube.");
                return context.Tuple.LastOrDefault(member => member.Hierarchy == hierarchy)
                    ?? hierarchy.AllMember
                    ?? throw new MdxException($"The hierarchy '{current.Hierarchy}' has no All member.");
            case MdxAncestor ancestor:
                var level = cube.FindLevel(ancestor.Level)
                    ?? throw new MdxException($"The level '{ancestor.Level}' was not found in the cube.");
                var found = Resolve(ancestor.Member, context);
                while (found is not null && found.Level.Number > level.Number)
                {
                    found = found.Parent;
                }

                return found is not null && found.Level == level
                    ? found
                    : throw new MdxException($"The member has no ancestor at '{ancestor.Level}'.");
            default:
                throw new MdxException("Unknown member expression.");
        }
    }

    private IEnumerable<SalesRecord> Restrict(MdxSource source)
    {
        switch (source)
        {
            case MdxCube named:
                if (!string.Equals(named.Name, SalesCube.CubeName, StringComparison.OrdinalIgnoreCase))
                {
                    throw new MdxException($"The cube '{named.Name}' does not exist.");
                }

                return cube.Records;
            case MdxSubselect subselect:
                var tuples = Evaluate(subselect.Set, new Context(cube.Records, []));
                return Restrict(subselect.Inner)
                    .Where(record => tuples.Any(tuple => tuple.All(member => member.Contains(record))))
                    .ToArray();
            default:
                throw new MdxException("Unknown source.");
        }
    }

    private CubeMember Member(string uniqueName)
    {
        var member = cube.FindMember(uniqueName);
        if (member is not null)
        {
            return member;
        }

        // A calculated measure stands in its tuples like any other; its value is
        // its expression's.
        if (_calculated.ContainsKey(uniqueName))
        {
            if (!_calculatedMembers.TryGetValue(uniqueName, out var calculated))
            {
                var measures = cube.FindLevel("[Measures].[MeasuresLevel]")!;
                var name = uniqueName[(uniqueName.LastIndexOf('[') + 1)..^1];
                calculated = new CubeMember
                {
                    UniqueName = uniqueName, Caption = name, Level = measures, Contains = _ => true,
                    Measure = new CubeMeasure { Name = name, UniqueName = uniqueName, Caption = name, Compute = _ => null }
                };
                _calculatedMembers[uniqueName] = calculated;
            }

            return calculated;
        }

        // A hierarchy's default member is its All member.
        return cube.FindHierarchy(uniqueName)?.AllMember
            ?? throw new MdxException($"The member '{uniqueName}' was not found in the cube.");
    }

    private static bool IsUnder(CubeMember member, CubeMember root)
    {
        for (var current = member; current is not null; current = current.Parent)
        {
            if (current == root)
            {
                return true;
            }
        }

        return false;
    }

    private List<IReadOnlyList<CubeMember>> Evaluate(MdxSet set, Context context)
    {
        switch (set)
        {
            case MdxMemberRef reference:
                return [[Member(reference.UniqueName)]];
            case MdxTupleSet tuple:
                var members = tuple.Members.Select(Member).ToArray();
                if (members.Select(member => member.Hierarchy).Distinct().Count() != members.Length)
                {
                    throw new MdxException("A tuple cannot name the same hierarchy twice.");
                }

                return [members];
            case MdxLevelMembers levelMembers:
                var level = cube.FindLevel(levelMembers.LevelName)
                    ?? throw new MdxException($"The level '{levelMembers.LevelName}' was not found in the cube.");
                return level.Members.Select(member => (IReadOnlyList<CubeMember>)[member]).ToList();
            case MdxSetLiteral literal:
                return Distinct(literal.Items.SelectMany(item => Evaluate(item, context)));
            case MdxSubset subset:
                return Evaluate(subset.Set, context).Skip(subset.Start).Take(subset.Count).ToList();
            case MdxNonEmpty nonEmpty:
                var against = Evaluate(nonEmpty.Against, context);
                return Evaluate(nonEmpty.Set, context)
                    .Where(tuple => against.Any(other => Cell(context, [.. tuple, .. other]) is not null))
                    .ToList();
            case MdxDescendants descendants:
                // The members at the level below each member of the set, or the
                // member itself when it is at that level (the SELF flag).
                var target = cube.FindLevel(descendants.Level)
                    ?? throw new MdxException($"The level '{descendants.Level}' was not found in the cube.");
                var roots = Evaluate(descendants.Set, context).Select(tuple => tuple.Single()).ToList();
                return target.Members
                    .Where(member => roots.Any(root => IsUnder(member, root)))
                    .Select(member => (IReadOnlyList<CubeMember>)[member])
                    .ToList();
            case MdxOrder order:
                // LINQ's ordering is stable, as Analysis Services' is.
                var keyed = Evaluate(order.Set, context)
                    .Select(tuple => (Tuple: tuple, Key: Value(order.Key, context with { Tuple = Merge(context.Tuple, tuple) })))
                    .ToList();
                var comparer = Comparer<object?>.Create(CompareKeys);
                return (order.Descending
                        ? keyed.OrderByDescending(entry => entry.Key, comparer)
                        : keyed.OrderBy(entry => entry.Key, comparer))
                    .Select(entry => entry.Tuple)
                    .ToList();
            case MdxFunction { Name: var name } function when string.Equals(name, "Union", StringComparison.OrdinalIgnoreCase):
                return Distinct(function.Arguments.SelectMany(argument => Evaluate(argument, context)));
            case MdxFunction function:
                var product = new List<IReadOnlyList<CubeMember>> { Array.Empty<CubeMember>() };
                foreach (var argument in function.Arguments)
                {
                    var right = Evaluate(argument, context);
                    product = product.SelectMany(left => right.Select(tuple => (IReadOnlyList<CubeMember>)[.. left, .. tuple])).ToList();
                }

                var hierarchies = product.FirstOrDefault()?.Select(member => member.Hierarchy).ToArray() ?? [];
                if (hierarchies.Distinct().Count() != hierarchies.Length)
                {
                    throw new MdxException("CrossJoin cannot use the same hierarchy twice.");
                }

                return product;
            default:
                throw new MdxException("Unknown set.");
        }
    }

    // Empty first, numbers by value, text in the cube's culture, ignoring case.
    private int CompareKeys(object? left, object? right) => (left, right) switch
    {
        (null, null) => 0,
        (null, _) => -1,
        (_, null) => 1,
        (decimal a, decimal b) => a.CompareTo(b),
        _ => cube.Culture.CompareInfo.Compare(
            Convert.ToString(left, CultureInfo.InvariantCulture), Convert.ToString(right, CultureInfo.InvariantCulture),
            CompareOptions.IgnoreCase)
    };

    private static List<IReadOnlyList<CubeMember>> Distinct(IEnumerable<IReadOnlyList<CubeMember>> tuples)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var kept = new List<IReadOnlyList<CubeMember>>();
        foreach (var tuple in tuples)
        {
            if (seen.Add(string.Join("\u001f", tuple.Select(member => member.UniqueName))))
            {
                kept.Add(tuple);
            }
        }

        if (kept.Select(tuple => string.Join("|", tuple.Select(member => member.Hierarchy.UniqueName))).Distinct().Count() > 1)
        {
            throw new MdxException("The tuples of a set must name the same hierarchies.");
        }

        return kept;
    }
}
