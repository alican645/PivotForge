using Microsoft.AspNetCore.Razor.TagHelpers;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Declares a single field of an enclosing <c>pivot-grid</c> element.</summary>
[HtmlTargetElement("pivot-field", ParentTag = "pivot-grid", TagStructure = TagStructure.WithoutEndTag)]
public sealed class PivotFieldTagHelper : TagHelper
{
    /// <summary>The key under which a grid publishes its field list to child fields.</summary>
    internal const string FieldsKey = "PivotForge.Fields";

    /// <summary>Gets or sets the source field name.</summary>
    [HtmlAttributeName("field")]
    public string? Field { get; set; }

    /// <summary>Gets or sets the display caption. Defaults to the source field name.</summary>
    [HtmlAttributeName("caption")]
    public string? Caption { get; set; }

    /// <summary>Gets or sets the layout area. Defaults to <see cref="PivotArea.Data"/>.</summary>
    [HtmlAttributeName("area")]
    public PivotArea Area { get; set; } = PivotArea.Data;

    /// <summary>Gets or sets which areas the field may occupy.</summary>
    /// <remarks>
    /// Declared non-nullable so Razor accepts the unqualified <c>role="Measure"</c> form;
    /// whether the author wrote the attribute is tracked through the element's attributes.
    /// </remarks>
    [HtmlAttributeName("role")]
    public PivotFieldRole Role { get; set; }

    /// <summary>Gets or sets the aggregation applied to a data field.</summary>
    /// <remarks>
    /// Declared non-nullable so Razor accepts the unqualified <c>aggregation="Sum"</c> form;
    /// a nullable enum property forces authors to write <c>PivotAggregation.Sum</c> instead.
    /// Whether the author actually wrote the attribute is tracked separately.
    /// </remarks>
    [HtmlAttributeName("aggregation")]
    public PivotAggregation Aggregation { get; set; }

    /// <summary>Gets or sets the secondary calculation applied to a data field.</summary>
    [HtmlAttributeName("show-as")]
    public PivotShowAs ShowAs { get; set; }

    /// <summary>Gets or sets how this field's values are formatted in the browser.</summary>
    [HtmlAttributeName("format-type")]
    public PivotValueFormatType FormatType { get; set; }

    /// <summary>Gets or sets how many fraction digits this field's values show (0-6).</summary>
    [HtmlAttributeName("format-decimals")]
    public int? FormatDecimals { get; set; }

    /// <summary>Gets or sets whether this field's values use a thousands separator.</summary>
    [HtmlAttributeName("format-grouping")]
    public bool? FormatGrouping { get; set; }

    /// <summary>Gets or sets the ISO currency code used when the format type is Currency.</summary>
    [HtmlAttributeName("format-currency")]
    public string? FormatCurrency { get; set; }

    /// <summary>Gets or sets whether the field participates in the rendered layout.</summary>
    [HtmlAttributeName("visible")]
    public bool? Visible { get; set; }

    /// <summary>The attribute names the view author actually wrote on this element.</summary>
    private HashSet<string> _writtenAttributes = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Records which attributes were written, for use when applying enum members.</summary>
    /// <param name="names">The attribute names present on the element.</param>
    internal void TrackWrittenAttributes(IEnumerable<string> names) =>
        _writtenAttributes = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);

    /// <summary>Registers this field with the enclosing grid and emits nothing itself.</summary>
    /// <param name="context">The tag helper context carrying the grid's field list.</param>
    /// <param name="output">The output, suppressed because a field renders no markup.</param>
    /// <returns>A completed task.</returns>
    /// <exception cref="InvalidOperationException">The field is not inside a pivot-grid element.</exception>
    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        if (context.Items.TryGetValue(FieldsKey, out var value) is false ||
            value is not List<PivotFieldTagHelper> fields)
        {
            throw new InvalidOperationException(
                "A pivot-field element must be nested inside a pivot-grid element.");
        }

        TrackWrittenAttributes(context.AllAttributes.Select(attribute => attribute.Name));
        fields.Add(this);
        output.SuppressOutput();
        return Task.CompletedTask;
    }

    /// <summary>Applies this field's declared values to a field builder.</summary>
    /// <param name="builder">The builder to configure.</param>
    internal void ApplyTo(PivotFieldBuilder builder)
    {
        if (Field is not null)
        {
            builder.DataField(Field);
        }

        if (Caption is not null)
        {
            builder.Caption(Caption);
        }

        builder.Area(Area);

        // Enum members are non-nullable so Razor accepts the unqualified form, so
        // "was it written?" comes from the element's attributes rather than from null.
        if (_writtenAttributes.Contains("aggregation"))
        {
            builder.Aggregation(Aggregation);
        }

        if (_writtenAttributes.Contains("show-as"))
        {
            builder.ShowAs(ShowAs);
        }

        if (_writtenAttributes.Contains("role"))
        {
            builder.Role(Role);
        }

        // FormatType is non-nullable so that `format-type="Currency"` binds without
        // qualification, which means only the written-attribute set can tell
        // "declared as Number" from "not declared at all".
        if (_writtenAttributes.Contains("format-type"))
        {
            builder.FormatType(FormatType);
        }

        if (FormatDecimals is { } decimals)
        {
            builder.FormatDecimals(decimals);
        }

        if (FormatGrouping is { } useGrouping)
        {
            builder.FormatGrouping(useGrouping);
        }

        if (FormatCurrency is not null)
        {
            builder.FormatCurrency(FormatCurrency);
        }

        if (Visible is { } visible)
        {
            builder.Visible(visible);
        }
    }
}
