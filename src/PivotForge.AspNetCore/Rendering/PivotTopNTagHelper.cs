using Microsoft.AspNetCore.Razor.TagHelpers;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Limits a row header level to its highest or lowest ranking groups.</summary>
/// <remarks>
/// Unlike <c>pivot-filter</c>, which decides which source records take part, this runs after
/// aggregation: the groups it ranks do not exist until the records have been summed. The rows
/// it drops leave the result entirely, totals included.
/// </remarks>
[HtmlTargetElement("pivot-top-n", ParentTag = "pivot-grid", TagStructure = TagStructure.WithoutEndTag)]
public sealed class PivotTopNTagHelper : TagHelper
{
    /// <summary>The key under which a grid publishes its ranking list to child rankings.</summary>
    internal const string RankingsKey = "PivotForge.TopN";

    /// <summary>Gets or sets the row field, or <c>field:interval</c> level key, being limited. Required.</summary>
    [HtmlAttributeName("field")]
    public string? Field { get; set; }

    /// <summary>Gets or sets how many groups survive in each parent group. Required.</summary>
    /// <remarks>
    /// Counted inside the parent group rather than across the table, so <c>count="2"</c> on an
    /// inner level keeps two groups per outer group.
    /// </remarks>
    [HtmlAttributeName("count")]
    public int Count { get; set; }

    /// <summary>Gets or sets the value key that ranks the groups, as <c>Field_aggregation</c>.</summary>
    /// <remarks>Left unset the first declared value ranks them, which is what a grid with one
    /// measure means by "top five".</remarks>
    [HtmlAttributeName("value-key")]
    public string? ValueKey { get; set; }

    /// <summary>Gets or sets whether the highest or the lowest ranking groups survive.</summary>
    [HtmlAttributeName("mode")]
    public PivotTopNMode Mode { get; set; }

    /// <summary>Registers this ranking with the enclosing grid and emits nothing itself.</summary>
    /// <param name="context">The tag helper context carrying the grid's ranking list.</param>
    /// <param name="output">The output, suppressed because a ranking renders no markup.</param>
    /// <returns>A completed task.</returns>
    /// <exception cref="InvalidOperationException">The ranking is not inside a pivot-grid element.</exception>
    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        if (context.Items.TryGetValue(RankingsKey, out var value) is false ||
            value is not List<PivotTopNTagHelper> rankings)
        {
            throw new InvalidOperationException(
                "A pivot-top-n element must be nested inside a pivot-grid element.");
        }

        rankings.Add(this);
        output.SuppressOutput();
        return Task.CompletedTask;
    }

    /// <summary>Applies this ranking to a grid builder.</summary>
    /// <param name="builder">The builder that receives the ranking.</param>
    /// <exception cref="InvalidOperationException">The field is missing or the count is not positive.</exception>
    internal void ApplyTo(PivotGridBuilder builder)
    {
        if (string.IsNullOrWhiteSpace(Field))
        {
            throw new InvalidOperationException("A pivot-top-n element requires a field attribute.");
        }

        if (Count < 1)
        {
            throw new InvalidOperationException(
                "A pivot-top-n element requires a count attribute of at least one.");
        }

        builder.TopN(Field, Count, ValueKey, Mode);
    }
}
