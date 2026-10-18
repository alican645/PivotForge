using PivotForge.Core.Records;

namespace PivotForge.Core;

/// <summary>Works out a field's value from a whole record, DevExtreme's <c>selector</c>.</summary>
/// <param name="record">The record being read.</param>
/// <returns>The field's value for this record: what it groups, filters or sums by.</returns>
/// <remarks>
/// Registered on <see cref="PivotEngine.CustomSelectors"/> under a name and picked by
/// <see cref="PivotRequest.Selectors"/>, which maps a field to it. The field may be one the
/// source has -- the selector's value replaces it -- or a name of its own, such as a fiscal year
/// worked out from an order date. Every path reads the field through it: headers, filters, the
/// value picker, drill-down, sorting and the values a measure sums.
/// </remarks>
public delegate object? PivotSelector(PivotRecordValues record);

/// <summary>One record, as a <see cref="PivotSelector"/> sees it.</summary>
/// <remarks>The indexer reads a field the way the engine does -- from a typed record, a
/// <c>DataRow</c> or a dictionary, after any declared <see cref="PivotRequest.DataTypes"/>
/// conversion -- and <see cref="Source"/> is the record itself, for typed access.</remarks>
public readonly struct PivotRecordValues
{
    private readonly IRecordReader _reader;

    internal PivotRecordValues(object source, IRecordReader reader)
    {
        Source = source;
        _reader = reader;
    }

    /// <summary>Gets the record itself: the typed item, the <c>DataRow</c> or the dictionary.</summary>
    public object Source { get; }

    /// <summary>Gets a source field's value.</summary>
    /// <param name="field">The source field name, matched ignoring case.</param>
    /// <exception cref="PivotFieldNotFoundException">The source has no such field.</exception>
    public object? this[string field] => _reader.GetValue(Source, field);
}
