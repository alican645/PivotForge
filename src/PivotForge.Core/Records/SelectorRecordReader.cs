namespace PivotForge.Core.Records;

/// <summary>Reads the fields a request maps to a selector from that selector, and every other
/// field from the source.</summary>
/// <remarks>
/// The one place a <see cref="PivotSelector"/> takes effect, as <see cref="TypedRecordReader"/>
/// is for a data type: every engine path reads through a reader, so a selected field is the same
/// value everywhere. A selector reads the other fields through the reader it wraps, so it sees
/// them already converted.
/// </remarks>
internal sealed class SelectorRecordReader : IRecordReader
{
    private readonly IRecordReader _inner;
    private readonly Dictionary<string, PivotSelector> _selectors;

    private SelectorRecordReader(IRecordReader inner, Dictionary<string, PivotSelector> selectors)
    {
        _inner = inner;
        _selectors = selectors;
    }

    /// <summary>Wraps <paramref name="reader"/> when <paramref name="selectors"/> maps anything.</summary>
    /// <exception cref="ArgumentException">A mapped name is not registered.</exception>
    public static IRecordReader Wrap(
        IRecordReader reader,
        IReadOnlyDictionary<string, string>? selectors,
        IReadOnlyDictionary<string, PivotSelector> registry)
    {
        if (selectors is null || selectors.Count == 0)
        {
            return reader;
        }

        var resolved = new Dictionary<string, PivotSelector>(StringComparer.OrdinalIgnoreCase);

        foreach (var (field, name) in selectors)
        {
            if (string.IsNullOrWhiteSpace(field))
            {
                throw new ArgumentException("Pivot fields cannot be empty.", nameof(selectors));
            }

            // Refused rather than ignored: a misspelled name would otherwise read the source
            // field, or fail as a field the source does not have, and look like something else.
            if (string.IsNullOrWhiteSpace(name) || !registry.TryGetValue(name, out var selector))
            {
                throw new ArgumentException($"The selector \"{name}\" is not registered.", nameof(selectors));
            }

            resolved[field] = selector;
        }

        return new SelectorRecordReader(reader, resolved);
    }

    public bool HasField(string field) => _selectors.ContainsKey(field) || _inner.HasField(field);

    public object? GetValue(object record, string field) =>
        _selectors.TryGetValue(field, out var selector)
            ? selector(new PivotRecordValues(record, _inner))
            : _inner.GetValue(record, field);
}
