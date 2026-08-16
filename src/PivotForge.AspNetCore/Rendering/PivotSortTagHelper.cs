using Microsoft.AspNetCore.Razor.TagHelpers;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Declares the initial row ordering of an enclosing <c>pivot-grid</c> element.</summary>
[HtmlTargetElement("pivot-sort", ParentTag = "pivot-grid", TagStructure = TagStructure.WithoutEndTag)]
public sealed class PivotSortTagHelper : TagHelper
{
    /// <summary>The key under which a grid publishes its sort slot to a child sort.</summary>
    internal const string SortKey = "PivotForge.Sort";

    /// <summary>Gets or sets what the rows are ordered by. Defaults to <see cref="PivotSortMode.RowLabel"/>.</summary>
    [HtmlAttributeName("mode")]
    public PivotSortMode Mode { get; set; } = PivotSortMode.RowLabel;

    /// <summary>Gets or sets the direction. Defaults to <see cref="PivotSortDirection.Ascending"/>.</summary>
    [HtmlAttributeName("direction")]
    public PivotSortDirection Direction { get; set; } = PivotSortDirection.Ascending;

    /// <summary>Gets or sets the row field ordered by, for <see cref="PivotSortMode.RowLabel"/>.</summary>
    [HtmlAttributeName("field")]
    public string? Field { get; set; }

    /// <summary>Gets or sets the value key ordered by, for <see cref="PivotSortMode.RowTotalValue"/>.</summary>
    /// <remarks>
    /// Supply this, or <c>value-field</c> with <c>value-aggregation</c> and let the key
    /// be built for you.
    /// </remarks>
    [HtmlAttributeName("value-key")]
    public string? ValueKey { get; set; }

    /// <summary>Gets or sets the data field whose total the rows are ordered by.</summary>
    [HtmlAttributeName("value-field")]
    public string? ValueField { get; set; }

    /// <summary>Gets or sets the aggregation of <see cref="ValueField"/>. Defaults to <see cref="PivotAggregation.Sum"/>.</summary>
    [HtmlAttributeName("value-aggregation")]
    public PivotAggregation ValueAggregation { get; set; } = PivotAggregation.Sum;

    /// <summary>Registers this sort with the enclosing grid and emits nothing itself.</summary>
    /// <param name="context">The tag helper context carrying the grid's sort slot.</param>
    /// <param name="output">The output, suppressed because a sort renders no markup.</param>
    /// <returns>A completed task.</returns>
    /// <exception cref="InvalidOperationException">The sort is not inside a pivot-grid element, or a second sort was declared.</exception>
    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        if (context.Items.TryGetValue(SortKey, out var value) is false ||
            value is not List<PivotSortTagHelper> sorts)
        {
            throw new InvalidOperationException(
                "A pivot-sort element must be nested inside a pivot-grid element.");
        }

        // A grid orders its rows one way, so a second declaration is a mistake
        // rather than a refinement of the first.
        if (sorts.Count > 0)
        {
            throw new InvalidOperationException(
                "A pivot-grid element accepts at most one pivot-sort element.");
        }

        sorts.Add(this);
        output.SuppressOutput();
        return Task.CompletedTask;
    }

    /// <summary>Applies this sort to a grid builder.</summary>
    /// <param name="builder">The builder that receives the sort.</param>
    /// <exception cref="InvalidOperationException">The declaration does not name what to order by.</exception>
    internal void ApplyTo(PivotGridBuilder builder)
    {
        if (Mode == PivotSortMode.RowLabel)
        {
            if (string.IsNullOrWhiteSpace(Field))
            {
                throw new InvalidOperationException(
                    "A pivot-sort element with mode=\"RowLabel\" requires a field attribute.");
            }

            builder.RowSort(PivotSort.RowLabel(Field, Direction));
            return;
        }

        var key = ValueKey ?? (string.IsNullOrWhiteSpace(ValueField)
            ? null
            : PivotValueKey.For(ValueField, ValueAggregation));

        if (key is null)
        {
            throw new InvalidOperationException(
                "A pivot-sort element with mode=\"RowTotalValue\" requires value-key, or value-field.");
        }

        builder.RowSort(PivotSort.RowTotal(key, Direction));
    }
}
