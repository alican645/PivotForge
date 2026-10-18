using System.Globalization;
using System.Text;

namespace PivotForge.Core;

/// <summary>A parsed calculated-field formula.</summary>
/// <remarks>
/// <para>
/// A formula is arithmetic over summaries: <c>Sum([Revenue]) - Sum([Cost])</c>. It is
/// evaluated once per cell, after the records behind that cell have been aggregated, so a
/// ratio such as <c>[Profit] / [Revenue]</c> is the ratio of the sums at every level (a row,
/// a subtotal, a grand total) rather than a sum of per-record ratios, which is what Excel's
/// calculated fields and DevExtreme's summary calculations both do.
/// </para>
/// <para>
/// The grammar: numbers written with a dot as the decimal separator; <c>+ - * /</c> with the
/// usual precedence; parentheses; unary minus; a field reference <c>[Name]</c>, which means
/// <c>Sum([Name])</c>; and a summary <c>Function([Name])</c>, where the function is one of
/// <c>Sum</c>, <c>Count</c>, <c>Avg</c> (or <c>Average</c>), <c>Min</c>, <c>Max</c>,
/// <c>CountDistinct</c>, <c>Median</c>, <c>Var</c> (or <c>Variance</c>), <c>StDev</c> (or
/// <c>StdDev</c>), or a
/// custom aggregate registered with the engine. Names are matched without regard to case.
/// </para>
/// <para>
/// A formula may also read another cell, DevExtreme's cell API: <c>Prev(x)</c> / <c>Next(x)</c>
/// evaluate <c>x</c> in the previous / next column of the same level, <c>PrevRow(x)</c> /
/// <c>NextRow(x)</c> in the previous / next row, <c>ParentRow(x)</c> / <c>ParentColumn(x)</c> in
/// the parent group on that axis, <c>RowTotal(x)</c> / <c>ColumnTotal(x)</c> / <c>GrandTotal(x)</c>
/// in the totals, and <c>Slice(x, [Field], n)</c> where <c>[Field]</c>'s level is moved <c>n</c>
/// members along -- <c>Slice([Amount], [Year], -1)</c> is the same cell last year. A cell that
/// does not exist reads as empty. <c>x</c> is any formula, so
/// <c>([Amount] - Prev([Amount])) / Prev([Amount])</c> is the growth on the previous period.
/// </para>
/// <para>
/// Nothing is ever executed: the text is only read as this grammar, so a formula typed by a
/// reader is as safe to evaluate as a number.
/// </para>
/// </remarks>
public sealed class PivotExpression
{
    private PivotExpression(string text, Node root, IReadOnlyList<Summary> summaries, IReadOnlyList<string> sliceFields)
    {
        Text = text;
        Root = root;
        Summaries = summaries;
        // A Slice names a header level as well, which an allow-list has to see too.
        Fields = summaries
            .Select(summary => summary.Field)
            .Concat(sliceFields)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        IsRelative = Contains(root, node => node is RelativeNode);
    }

    /// <summary>Gets whether the formula reads another cell than its own.</summary>
    internal bool IsRelative { get; }

    private static bool Contains(Node node, Func<Node, bool> predicate) => predicate(node) || node switch
    {
        NegateNode negate => Contains(negate.Operand, predicate),
        BinaryNode binary => Contains(binary.Left, predicate) || Contains(binary.Right, predicate),
        RelativeNode relative => Contains(relative.Inner, predicate),
        _ => false
    };

    /// <summary>Gets the formula as it was written.</summary>
    public string Text { get; }

    /// <summary>Gets the source fields the formula reads, each named once.</summary>
    public IReadOnlyList<string> Fields { get; }

    internal Node Root { get; }

    /// <summary>The distinct summaries the formula reads, in the order they first appear.</summary>
    internal IReadOnlyList<Summary> Summaries { get; }

    /// <summary>Parses a formula.</summary>
    /// <param name="text">The formula.</param>
    /// <returns>The parsed formula.</returns>
    /// <exception cref="PivotExpressionException">The text is not a formula.</exception>
    public static PivotExpression Parse(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new PivotExpressionException("A calculated field requires a formula.", 0);
        }

        var parser = new Parser(text);
        var root = parser.ParseAll();
        return new PivotExpression(text, root, parser.Summaries, parser.SliceFields);
    }

    /// <summary>A function applied to one source field.</summary>
    /// <param name="Function">The function name, as written.</param>
    /// <param name="Field">The source field name.</param>
    internal sealed record Summary(string Function, string Field)
    {
        public bool Equals(Summary? other) =>
            other is not null &&
            string.Equals(Function, other.Function, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(Field, other.Field, StringComparison.OrdinalIgnoreCase);

        public override int GetHashCode() => HashCode.Combine(
            StringComparer.OrdinalIgnoreCase.GetHashCode(Function),
            StringComparer.OrdinalIgnoreCase.GetHashCode(Field));
    }

    internal abstract record Node;

    internal sealed record NumberNode(decimal Value) : Node;

    internal sealed record SummaryNode(int Index) : Node;

    internal sealed record NegateNode(Node Operand) : Node;

    internal sealed record BinaryNode(char Operator, Node Left, Node Right) : Node;

    /// <summary>Where a relative function reads its formula.</summary>
    internal enum RelativeKind
    {
        Prev,
        Next,
        PrevRow,
        NextRow,
        ParentRow,
        ParentColumn,
        RowTotal,
        ColumnTotal,
        GrandTotal,
        Slice
    }

    /// <summary><paramref name="Inner"/> evaluated at another cell.</summary>
    /// <param name="Kind">Which cell.</param>
    /// <param name="Inner">The formula read there.</param>
    /// <param name="Field">The level a <see cref="RelativeKind.Slice"/> moves along.</param>
    /// <param name="Offset">How many members a <see cref="RelativeKind.Slice"/> moves.</param>
    internal sealed record RelativeNode(RelativeKind Kind, Node Inner, string? Field, int Offset) : Node;

    /// <summary>Evaluates the formula against the values of its summaries.</summary>
    /// <remarks>
    /// An empty summary empties the result, the way an empty cell stays empty in every
    /// show-as mode, and so does a division by zero: there is no number to show, and zero
    /// would be a wrong one.
    /// </remarks>
    internal static decimal? Evaluate(Node node, IReadOnlyList<decimal?> summaries) =>
        // A cell on its own cannot read another: a relative part is empty here, and the engine
        // works the formula out again once every cell exists.
        Evaluate(node, index => summaries[index], _ => null);

    /// <summary>Evaluates the formula with its summaries and its relative parts read through callbacks.</summary>
    internal static decimal? Evaluate(Node node, Func<int, decimal?> summary, Func<RelativeNode, decimal?> relative)
    {
        try
        {
            return EvaluateCore(node, summary, relative);
        }
        catch (OverflowException)
        {
            return null;
        }
    }

    private static decimal? EvaluateCore(Node node, Func<int, decimal?> summary, Func<RelativeNode, decimal?> relative) => node switch
    {
        NumberNode number => number.Value,
        SummaryNode reference => summary(reference.Index),
        NegateNode negate => -EvaluateCore(negate.Operand, summary, relative),
        BinaryNode binary => Apply(
            binary.Operator,
            EvaluateCore(binary.Left, summary, relative),
            EvaluateCore(binary.Right, summary, relative)),
        RelativeNode other => relative(other),
        _ => throw new InvalidOperationException("Unknown formula node.")
    };

    private static decimal? Apply(char op, decimal? left, decimal? right)
    {
        if (left is not { } l || right is not { } r)
        {
            return null;
        }

        return op switch
        {
            '+' => l + r,
            '-' => l - r,
            '*' => l * r,
            '/' => r == 0m ? null : l / r,
            _ => throw new InvalidOperationException($"Unknown operator '{op}'.")
        };
    }

    // Recursive descent, one method per precedence level. Positions are reported
    // zero-based so the browser can put the caret where the problem is.
    private sealed class Parser(string text)
    {
        private readonly Dictionary<Summary, int> _indexes = new();
        private int _position;

        public List<Summary> Summaries { get; } = [];

        public List<string> SliceFields { get; } = [];

        public Node ParseAll()
        {
            var node = ParseSum();
            SkipWhitespace();

            if (_position < text.Length)
            {
                throw Error($"Unexpected '{text[_position]}'.");
            }

            return node;
        }

        private Node ParseSum()
        {
            var node = ParseProduct();

            while (TryConsume('+', '-') is { } op)
            {
                node = new BinaryNode(op, node, ParseProduct());
            }

            return node;
        }

        private Node ParseProduct()
        {
            var node = ParseUnary();

            while (TryConsume('*', '/') is { } op)
            {
                node = new BinaryNode(op, node, ParseUnary());
            }

            return node;
        }

        private Node ParseUnary()
        {
            if (TryConsume('-') is not null)
            {
                return new NegateNode(ParseUnary());
            }

            // A leading plus says nothing, but "+5" is a number someone may type.
            if (TryConsume('+') is not null)
            {
                return ParseUnary();
            }

            return ParsePrimary();
        }

        private Node ParsePrimary()
        {
            SkipWhitespace();

            if (_position >= text.Length)
            {
                throw Error("The formula ends where a value was expected.");
            }

            var current = text[_position];

            if (current == '(')
            {
                _position++;
                var inner = ParseSum();
                Expect(')');
                return inner;
            }

            if (current == '[')
            {
                return Reference("Sum", ReadFieldName());
            }

            if (char.IsDigit(current) || current == '.')
            {
                return ReadNumber();
            }

            if (char.IsLetter(current) || current == '_')
            {
                var start = _position;
                var function = ReadIdentifier();
                SkipWhitespace();

                if (_position >= text.Length || text[_position] != '(')
                {
                    // A bare word is almost always a field name missing its brackets,
                    // which is worth saying in those words.
                    throw new PivotExpressionException(
                        $"'{function}' is not a value. Field names are written in brackets, as [{function}].",
                        start);
                }

                _position++;

                // A relative function takes a formula rather than a field: Prev([A] - [B]).
                if (Enum.TryParse<RelativeKind>(function, ignoreCase: true, out var kind) &&
                    Enum.GetName(kind)!.Equals(function, StringComparison.OrdinalIgnoreCase))
                {
                    return ParseRelative(kind, function);
                }

                SkipWhitespace();

                if (_position >= text.Length || text[_position] != '[')
                {
                    throw Error($"{function}() takes a field in brackets, such as {function}([Amount]).");
                }

                var field = ReadFieldName();
                Expect(')');
                return Reference(function, field);
            }

            throw Error($"Unexpected '{current}'.");
        }

        // The opening parenthesis is already consumed.
        private RelativeNode ParseRelative(RelativeKind kind, string function)
        {
            var inner = ParseSum();

            if (kind != RelativeKind.Slice)
            {
                Expect(')');
                return new RelativeNode(kind, inner, null, 0);
            }

            Expect(',');
            SkipWhitespace();
            if (_position >= text.Length || text[_position] != '[')
            {
                throw Error($"{function}() takes a field in brackets after the formula, such as {function}([Amount], [Year], -1).");
            }

            var field = ReadFieldName();
            SliceFields.Add(field);
            Expect(',');
            SkipWhitespace();

            var start = _position;
            var negative = TryConsume('-') is not null;
            if (!negative)
            {
                TryConsume('+');
            }

            SkipWhitespace();
            var digits = _position;
            while (_position < text.Length && char.IsDigit(text[_position]))
            {
                _position++;
            }

            if (_position == digits ||
                !int.TryParse(text.AsSpan(digits, _position - digits), NumberStyles.None, CultureInfo.InvariantCulture, out var offset))
            {
                throw new PivotExpressionException(
                    $"{function}() moves a whole number of members, such as {function}([Amount], [Year], -1).", start);
            }

            Expect(')');
            return new RelativeNode(kind, inner, field, negative ? -offset : offset);
        }

        private SummaryNode Reference(string function, string field)
        {
            var summary = new Summary(function, field);

            if (!_indexes.TryGetValue(summary, out var index))
            {
                index = Summaries.Count;
                Summaries.Add(summary);
                _indexes.Add(summary, index);
            }

            return new SummaryNode(index);
        }

        private string ReadFieldName()
        {
            var start = _position;
            _position++;
            var close = text.IndexOf(']', _position);

            if (close < 0)
            {
                throw new PivotExpressionException("A field name is missing its closing ']'.", start);
            }

            var name = text[_position..close].Trim();
            _position = close + 1;

            if (name.Length == 0)
            {
                throw new PivotExpressionException("A field reference names no field.", start);
            }

            return name;
        }

        private string ReadIdentifier()
        {
            var builder = new StringBuilder();

            while (_position < text.Length && (char.IsLetterOrDigit(text[_position]) || text[_position] == '_'))
            {
                builder.Append(text[_position++]);
            }

            return builder.ToString();
        }

        private NumberNode ReadNumber()
        {
            var start = _position;

            while (_position < text.Length && (char.IsDigit(text[_position]) || text[_position] == '.'))
            {
                _position++;
            }

            // Invariant on purpose: a formula means the same thing whichever culture
            // the server runs in, and a comma already has no job in the grammar.
            if (!decimal.TryParse(
                    text.AsSpan(start, _position - start),
                    NumberStyles.AllowDecimalPoint,
                    CultureInfo.InvariantCulture,
                    out var value))
            {
                throw new PivotExpressionException($"'{text[start.._position]}' is not a number.", start);
            }

            return new NumberNode(value);
        }

        private char? TryConsume(params char[] candidates)
        {
            SkipWhitespace();

            if (_position < text.Length && Array.IndexOf(candidates, text[_position]) >= 0)
            {
                return text[_position++];
            }

            return null;
        }

        private void Expect(char expected)
        {
            if (TryConsume(expected) is null)
            {
                throw Error(_position < text.Length
                    ? $"Expected '{expected}' but found '{text[_position]}'."
                    : $"The formula ends where '{expected}' was expected.");
            }
        }

        private void SkipWhitespace()
        {
            while (_position < text.Length && char.IsWhiteSpace(text[_position]))
            {
                _position++;
            }
        }

        private PivotExpressionException Error(string message) => new(message, _position);
    }
}

/// <summary>The exception thrown when a calculated field's formula cannot be read.</summary>
/// <remarks>
/// Derived from <see cref="ArgumentException"/> because a formula arrives as part of a request,
/// and a bad one is a bad argument like any other.
/// </remarks>
public sealed class PivotExpressionException : ArgumentException
{
    /// <summary>Initializes an exception for a formula error.</summary>
    /// <param name="message">What is wrong, in words a reader can act on.</param>
    /// <param name="position">The zero-based character position the problem starts at.</param>
    public PivotExpressionException(string message, int position)
        : base(message)
    {
        Position = position;
    }

    /// <summary>Gets the zero-based character position the problem starts at.</summary>
    public int Position { get; }
}
