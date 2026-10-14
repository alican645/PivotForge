using Microsoft.AspNetCore.Razor.TagHelpers;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Keeps the groups of a row header level whose summary value meets a condition.</summary>
/// <remarks>
/// <c>&lt;pivot-value-filter field="Region" operator="GreaterThan" value="10000" /&gt;</c> keeps
/// the regions whose total exceeds 10,000. Like <c>pivot-top-n</c> this runs after aggregation,
/// and the groups it drops leave the result, totals included.
/// </remarks>
[HtmlTargetElement("pivot-value-filter", ParentTag = "pivot-grid", TagStructure = TagStructure.WithoutEndTag)]
public sealed class PivotValueFilterTagHelper : TagHelper
{
    /// <summary>The key under which a grid publishes its value filter list to child filters.</summary>
    internal const string ValueFiltersKey = "PivotForge.ValueFilters";

    /// <summary>Gets or sets the row field, or <c>field:interval</c> level key, being filtered. Required.</summary>
    [HtmlAttributeName("field")]
    public string? Field { get; set; }

    /// <summary>Gets or sets how each group's value is compared.</summary>
    [HtmlAttributeName("operator")]
    public PivotValueFilterOperator Operator { get; set; }

    /// <summary>Gets or sets the value compared against; the lower bound of a range. Required.</summary>
    [HtmlAttributeName("value")]
    public decimal? Value { get; set; }

    /// <summary>Gets or sets the upper bound, for <c>Between</c> and <c>NotBetween</c> only.</summary>
    [HtmlAttributeName("value2")]
    public decimal? Value2 { get; set; }

    /// <summary>Gets or sets the value key compared, as <c>Field_aggregation</c>.</summary>
    /// <remarks>Left unset the first declared value is compared.</remarks>
    [HtmlAttributeName("value-key")]
    public string? ValueKey { get; set; }

    /// <summary>Registers this filter with the enclosing grid and emits nothing itself.</summary>
    /// <param name="context">The tag helper context carrying the grid's value filter list.</param>
    /// <param name="output">The output, suppressed because a filter renders no markup.</param>
    /// <returns>A completed task.</returns>
    /// <exception cref="InvalidOperationException">The filter is not inside a pivot-grid element.</exception>
    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        if (context.Items.TryGetValue(ValueFiltersKey, out var value) is false ||
            value is not List<PivotValueFilterTagHelper> filters)
        {
            throw new InvalidOperationException(
                "A pivot-value-filter element must be nested inside a pivot-grid element.");
        }

        filters.Add(this);
        output.SuppressOutput();
        return Task.CompletedTask;
    }

    /// <summary>Applies this filter to a grid builder.</summary>
    /// <param name="builder">The builder that receives the filter.</param>
    /// <exception cref="InvalidOperationException">The field or the value is missing, or the
    /// bounds do not fit the operator.</exception>
    internal void ApplyTo(PivotGridBuilder builder)
    {
        if (string.IsNullOrWhiteSpace(Field))
        {
            throw new InvalidOperationException("A pivot-value-filter element requires a field attribute.");
        }

        if (Value is not { } compared)
        {
            throw new InvalidOperationException("A pivot-value-filter element requires a value attribute.");
        }

        try
        {
            builder.ValueFilter(Field, Operator, compared, Value2, ValueKey);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                $"pivot-value-filter on \"{Field}\": {exception.Message}", exception);
        }
    }
}
