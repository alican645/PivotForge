using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Configures a single pivot grid field.</summary>
public sealed class PivotFieldBuilder
{
    private string? _dataField;
    private string? _caption;
    private PivotArea _area = PivotArea.Data;
    private PivotAggregation? _aggregation;
    private PivotShowAs? _showAs;
    private PivotFieldRole? _role;
    private PivotValueFormatType? _formatType;
    private int? _formatDecimals;
    private bool? _formatGrouping;
    private string? _formatCurrency;
    private bool _visible = true;

    /// <summary>Sets the source field name.</summary>
    /// <param name="dataField">The source field name.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder DataField(string dataField)
    {
        _dataField = dataField;
        return this;
    }

    /// <summary>Sets the display caption.</summary>
    /// <param name="caption">The caption shown to users.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Caption(string caption)
    {
        _caption = caption;
        return this;
    }

    /// <summary>Sets the layout area.</summary>
    /// <param name="area">The area that receives this field.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Area(PivotArea area)
    {
        _area = area;
        return this;
    }

    /// <summary>Sets which areas the field may occupy.</summary>
    /// <param name="role">The field's role.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Role(PivotFieldRole role)
    {
        _role = role;
        return this;
    }

    /// <summary>Sets the aggregation applied to a data field.</summary>
    /// <param name="aggregation">The aggregation to apply.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Aggregation(PivotAggregation aggregation)
    {
        _aggregation = aggregation;
        return this;
    }

    /// <summary>Sets the secondary calculation applied to a data field.</summary>
    /// <param name="showAs">The secondary calculation.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder ShowAs(PivotShowAs showAs)
    {
        _showAs = showAs;
        return this;
    }

    /// <summary>Sets how this field's values are formatted in the browser.</summary>
    /// <param name="type">The format family.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder FormatType(PivotValueFormatType type)
    {
        _formatType = type;
        return this;
    }

    /// <summary>Sets how many fraction digits this field's values show.</summary>
    /// <param name="decimals">The fraction-digit count, from 0 to 6.</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentOutOfRangeException">The count is outside 0-6.</exception>
    public PivotFieldBuilder FormatDecimals(int decimals)
    {
        // The Excel export builds a "#,##0.00" pattern that only supports this
        // range, so accepting more here would make the two renderings disagree.
        if (decimals is < 0 or > 6)
        {
            throw new ArgumentOutOfRangeException(
                nameof(decimals), decimals, "FormatDecimals must be between 0 and 6.");
        }

        _formatDecimals = decimals;
        return this;
    }

    /// <summary>Sets whether this field's values use a thousands separator.</summary>
    /// <param name="useGrouping">True to group digits; false to render them ungrouped.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder FormatGrouping(bool useGrouping)
    {
        _formatGrouping = useGrouping;
        return this;
    }

    /// <summary>Sets the ISO currency code used when the format type is Currency.</summary>
    /// <param name="currency">An ISO 4217 code, such as "TRY".</param>
    /// <returns>The same builder.</returns>
    /// <exception cref="ArgumentException">The code is null or blank.</exception>
    public PivotFieldBuilder FormatCurrency(string currency)
    {
        if (string.IsNullOrWhiteSpace(currency))
        {
            throw new ArgumentException("FormatCurrency requires a currency code.", nameof(currency));
        }

        _formatCurrency = currency;
        return this;
    }

    /// <summary>Sets whether the field participates in the rendered layout.</summary>
    /// <param name="visible">True to include the field; false to configure it while hidden.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Visible(bool visible)
    {
        _visible = visible;
        return this;
    }

    /// <summary>Builds the browser field configuration.</summary>
    /// <returns>A dictionary matching the JavaScript field model.</returns>
    /// <exception cref="InvalidOperationException">
    /// No data field was supplied, a field in the <see cref="PivotArea.Available"/> area has no <see cref="Role"/>,
    /// a <see cref="Role"/> contradicts its <see cref="Area"/> (e.g., <see cref="PivotFieldRole.Measure"/> outside
    /// <see cref="PivotArea.Data"/>), or <see cref="Aggregation"/>/<see cref="ShowAs"/> was set on a field whose
    /// <see cref="Area"/> is not <see cref="PivotArea.Data"/>.
    /// </exception>
    public IDictionary<string, object?> Build()
    {
        if (string.IsNullOrWhiteSpace(_dataField))
        {
            throw new InvalidOperationException(
                "A pivot field requires DataField to be set before it can be rendered.");
        }

        if (_area == PivotArea.Available && _role is null)
        {
            throw new InvalidOperationException(
                $"Field \"{_dataField}\" is in the Available area, so Role must be set explicitly; there is no area to infer it from.");
        }

        if (_role is { } role)
        {
            var expected = _area == PivotArea.Data ? PivotFieldRole.Measure : PivotFieldRole.Dimension;
            if (_area != PivotArea.Available && role != expected)
            {
                throw new InvalidOperationException(
                    $"Field \"{_dataField}\" is in the {_area} area, so its Role cannot be {role}.");
            }
        }

        // Mirrors the check normalizeField() performs in pivot-request-builder.js, so a
        // configuration mistake surfaces here instead of only failing in the browser.
        if (_area != PivotArea.Data && (_aggregation is not null || _showAs is not null))
        {
            throw new InvalidOperationException(
                $"Field \"{_dataField}\" sets Aggregation or ShowAs, but its Area is \"{_area}\". " +
                "Aggregation and ShowAs are only valid on fields whose Area is Data.");
        }

        // Only a data field produces the numbers the renderer formats.
        if (_area != PivotArea.Data && HasFormat)
        {
            throw new InvalidOperationException(
                $"Field \"{_dataField}\" sets a Format, but its Area is \"{_area}\". " +
                "Format is only valid on fields whose Area is Data.");
        }

        var field = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["dataField"] = _dataField,
            ["caption"] = _caption ?? _dataField,
            ["area"] = ToCamelCase(_area.ToString())
        };

        if (_role is { } declaredRole)
        {
            field["role"] = ToCamelCase(declaredRole.ToString());
        }

        if (_aggregation is { } aggregation)
        {
            field["aggregation"] = ToCamelCase(aggregation.ToString());
        }

        if (_showAs is { } showAs)
        {
            field["showAs"] = ToCamelCase(showAs.ToString());
        }

        if (HasFormat)
        {
            // Only the members that were set are emitted, so the browser's own
            // defaults still apply to everything the caller left alone.
            var format = new Dictionary<string, object?>(StringComparer.Ordinal);

            if (_formatType is { } formatType)
            {
                format["type"] = ToCamelCase(formatType.ToString());
            }

            if (_formatDecimals is { } decimals)
            {
                format["decimals"] = decimals;
            }

            if (_formatGrouping is { } useGrouping)
            {
                format["useGrouping"] = useGrouping;
            }

            if (_formatCurrency is { } currency)
            {
                format["currency"] = currency;
            }

            field["format"] = format;
        }

        if (!_visible)
        {
            field["visible"] = false;
        }

        return field;
    }

    private bool HasFormat =>
        _formatType is not null || _formatDecimals is not null ||
        _formatGrouping is not null || _formatCurrency is not null;

    private static string ToCamelCase(string value) =>
        string.Concat(char.ToLowerInvariant(value[0]), value[1..]);
}
