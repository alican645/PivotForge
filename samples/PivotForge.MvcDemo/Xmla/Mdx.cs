using System.Globalization;
using System.Text;
using PivotForge.MvcDemo.Models;

namespace PivotForge.MvcDemo.Xmla;

// The part of MDX the PivotForge XmlaStore writes, read and run against the
// demo's SalesCube: sets in braces, Level.Members, CrossJoin, Union, NON EMPTY,
// nested subselects, a WHERE tuple, DRILLTHROUGH MAXROWS. Anything else is an
// error, as it would be on a server that does not know it.

internal sealed class MdxException(string message) : Exception(message);

internal enum MdxTokenKind { Bracket, Word, Number, Symbol, End }

internal readonly record struct MdxToken(MdxTokenKind Kind, string Text);

internal abstract record MdxSet;
internal sealed record MdxSetLiteral(IReadOnlyList<MdxSet> Items) : MdxSet;
internal sealed record MdxMemberRef(string UniqueName) : MdxSet;
internal sealed record MdxLevelMembers(string LevelName) : MdxSet;
internal sealed record MdxFunction(string Name, IReadOnlyList<MdxSet> Arguments) : MdxSet;

internal sealed record MdxAxis(MdxSet Set, bool NonEmpty, int Ordinal);

internal abstract record MdxSource;
internal sealed record MdxCube(string Name) : MdxSource;
internal sealed record MdxSubselect(MdxSet Set, MdxSource Inner) : MdxSource;

internal sealed record MdxStatement(
    IReadOnlyList<MdxAxis> Axes,
    MdxSource From,
    IReadOnlyList<string> Where,
    int? DrillthroughMaxRows);

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

            return new MdxStatement(axes, from, where, maxRows);
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
// clause leave.
internal sealed class MdxEvaluator(SalesCube cube)
{
    public sealed record Result(
        IReadOnlyList<IReadOnlyList<CubeMember>> Columns,
        IReadOnlyList<IReadOnlyList<CubeMember>>? Rows,
        IReadOnlyDictionary<int, decimal> Cells);

    public Result Execute(MdxStatement statement)
    {
        var records = Restrict(statement.From).ToArray();
        var slicer = statement.Where.Select(Member).ToArray();
        var columnAxis = statement.Axes.FirstOrDefault(axis => axis.Ordinal == 0);
        var rowAxis = statement.Axes.FirstOrDefault(axis => axis.Ordinal == 1);
        if (statement.Axes.Any(axis => axis.Ordinal > 1))
        {
            throw new MdxException("Only the COLUMNS and ROWS axes are supported.");
        }

        var columns = columnAxis is null ? [[]] : Evaluate(columnAxis.Set);
        var rows = rowAxis is null ? [[]] : Evaluate(rowAxis.Set);

        decimal? Cell(IReadOnlyList<CubeMember> row, IReadOnlyList<CubeMember> column)
        {
            var members = row.Concat(column).Concat(slicer).ToArray();
            var measure = members.LastOrDefault(member => member.Measure is not null)?.Measure ?? cube.DefaultMeasure;
            var kept = records.Where(record => members.All(member => member.Contains(record))).ToArray();
            return measure.Compute(kept);
        }

        var values = rows.Select(row => columns.Select(column => Cell(row, column)).ToArray()).ToArray();
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
                var tuples = Evaluate(subselect.Set);
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

        // A hierarchy's default member is its All member.
        return cube.FindHierarchy(uniqueName)?.AllMember
            ?? throw new MdxException($"The member '{uniqueName}' was not found in the cube.");
    }

    private List<IReadOnlyList<CubeMember>> Evaluate(MdxSet set)
    {
        switch (set)
        {
            case MdxMemberRef reference:
                return [[Member(reference.UniqueName)]];
            case MdxLevelMembers levelMembers:
                var level = cube.FindLevel(levelMembers.LevelName)
                    ?? throw new MdxException($"The level '{levelMembers.LevelName}' was not found in the cube.");
                return level.Members.Select(member => (IReadOnlyList<CubeMember>)[member]).ToList();
            case MdxSetLiteral literal:
                return Distinct(literal.Items.SelectMany(Evaluate));
            case MdxFunction { Name: var name } function when string.Equals(name, "Union", StringComparison.OrdinalIgnoreCase):
                return Distinct(function.Arguments.SelectMany(Evaluate));
            case MdxFunction function:
                var product = new List<IReadOnlyList<CubeMember>> { Array.Empty<CubeMember>() };
                foreach (var argument in function.Arguments)
                {
                    var right = Evaluate(argument);
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
