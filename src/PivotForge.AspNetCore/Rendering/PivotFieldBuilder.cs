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
    private string? _format;
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

    /// <summary>Sets the browser number format applied to this field's values.</summary>
    /// <param name="format">A format identifier understood by the browser renderer.</param>
    /// <returns>The same builder.</returns>
    public PivotFieldBuilder Format(string format)
    {
        _format = format;
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

        if (_format is not null)
        {
            field["format"] = _format;
        }

        if (!_visible)
        {
            field["visible"] = false;
        }

        return field;
    }

    private static string ToCamelCase(string value) =>
        string.Concat(char.ToLowerInvariant(value[0]), value[1..]);
}
