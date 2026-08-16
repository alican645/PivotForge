using Microsoft.AspNetCore.Razor.TagHelpers;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Declares an initial filter on an enclosing <c>pivot-grid</c> element.</summary>
[HtmlTargetElement("pivot-filter", ParentTag = "pivot-grid", TagStructure = TagStructure.WithoutEndTag)]
public sealed class PivotFilterTagHelper : TagHelper
{
    /// <summary>The key under which a grid publishes its filter list to child filters.</summary>
    internal const string FiltersKey = "PivotForge.Filters";

    /// <summary>Gets or sets the source field to filter. Required.</summary>
    [HtmlAttributeName("field")]
    public string? Field { get; set; }

    /// <summary>Gets or sets the values to keep, separated by commas.</summary>
    /// <remarks>
    /// A comma-separated string rather than a collection, because that is what a Razor
    /// attribute can express without a model expression. Entries are trimmed; a value
    /// containing a comma has to be supplied through <see cref="PivotGridBuilder.Filter"/>.
    /// </remarks>
    [HtmlAttributeName("values")]
    public string? Values { get; set; }

    /// <summary>Registers this filter with the enclosing grid and emits nothing itself.</summary>
    /// <param name="context">The tag helper context carrying the grid's filter list.</param>
    /// <param name="output">The output, suppressed because a filter renders no markup.</param>
    /// <returns>A completed task.</returns>
    /// <exception cref="InvalidOperationException">The filter is not inside a pivot-grid element.</exception>
    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        if (context.Items.TryGetValue(FiltersKey, out var value) is false ||
            value is not List<PivotFilterTagHelper> filters)
        {
            throw new InvalidOperationException(
                "A pivot-filter element must be nested inside a pivot-grid element.");
        }

        filters.Add(this);
        output.SuppressOutput();
        return Task.CompletedTask;
    }

    /// <summary>Applies this filter to a grid builder.</summary>
    /// <param name="builder">The builder that receives the filter.</param>
    /// <exception cref="InvalidOperationException">The field is missing.</exception>
    internal void ApplyTo(PivotGridBuilder builder)
    {
        if (string.IsNullOrWhiteSpace(Field))
        {
            throw new InvalidOperationException("A pivot-filter element requires a field attribute.");
        }

        var values = (Values ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        builder.Filter(Field, values);
    }
}
