using Microsoft.AspNetCore.Razor.TagHelpers;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Declares a conditional formatting rule on an enclosing <c>pivot-grid</c> element.</summary>
[HtmlTargetElement("pivot-conditional-rule", ParentTag = "pivot-grid", TagStructure = TagStructure.WithoutEndTag)]
public sealed class PivotConditionalRuleTagHelper : TagHelper
{
    /// <summary>The key under which a grid publishes its rule list to child rules.</summary>
    internal const string RulesKey = "PivotForge.ConditionalRules";

    /// <summary>Gets or sets the value key the rule applies to.</summary>
    /// <remarks>Supply this, or <c>value-field</c> and let the key be built for you.</remarks>
    [HtmlAttributeName("value-key")]
    public string? ValueKey { get; set; }

    /// <summary>Gets or sets the data field the rule applies to.</summary>
    [HtmlAttributeName("value-field")]
    public string? ValueField { get; set; }

    /// <summary>Gets or sets the aggregation of <see cref="ValueField"/>. Defaults to <see cref="PivotAggregation.Sum"/>.</summary>
    [HtmlAttributeName("value-aggregation")]
    public PivotAggregation ValueAggregation { get; set; } = PivotAggregation.Sum;

    /// <summary>Gets or sets the comparison. Defaults to <see cref="PivotConditionalOperator.GreaterThan"/>.</summary>
    [HtmlAttributeName("operator")]
    public PivotConditionalOperator Operator { get; set; } = PivotConditionalOperator.GreaterThan;

    /// <summary>Gets or sets the threshold compared against. Required.</summary>
    [HtmlAttributeName("threshold")]
    public double? Threshold { get; set; }

    /// <summary>Gets or sets the upper bound, required by <see cref="PivotConditionalOperator.Between"/>.</summary>
    [HtmlAttributeName("threshold2")]
    public double? Threshold2 { get; set; }

    /// <summary>Gets or sets the highlight applied to a matching cell. Defaults to <see cref="PivotConditionalColor.Green"/>.</summary>
    [HtmlAttributeName("color")]
    public PivotConditionalColor Color { get; set; } = PivotConditionalColor.Green;

    /// <summary>Gets or sets an identifier carried through to the rendered cell.</summary>
    [HtmlAttributeName("id")]
    public string? RuleId { get; set; }

    /// <summary>Registers this rule with the enclosing grid and emits nothing itself.</summary>
    /// <param name="context">The tag helper context carrying the grid's rule list.</param>
    /// <param name="output">The output, suppressed because a rule renders no markup.</param>
    /// <returns>A completed task.</returns>
    /// <exception cref="InvalidOperationException">The rule is not inside a pivot-grid element.</exception>
    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(output);

        if (context.Items.TryGetValue(RulesKey, out var value) is false ||
            value is not List<PivotConditionalRuleTagHelper> rules)
        {
            throw new InvalidOperationException(
                "A pivot-conditional-rule element must be nested inside a pivot-grid element.");
        }

        rules.Add(this);
        output.SuppressOutput();
        return Task.CompletedTask;
    }

    /// <summary>Applies this rule to a grid builder.</summary>
    /// <param name="builder">The builder that receives the rule.</param>
    /// <exception cref="InvalidOperationException">The rule does not name a value or a threshold.</exception>
    internal void ApplyTo(PivotGridBuilder builder)
    {
        var key = ValueKey ?? (string.IsNullOrWhiteSpace(ValueField)
            ? null
            : PivotValueKey.For(ValueField, ValueAggregation));

        if (key is null)
        {
            throw new InvalidOperationException(
                "A pivot-conditional-rule element requires value-key, or value-field.");
        }

        if (Threshold is not { } threshold)
        {
            throw new InvalidOperationException(
                "A pivot-conditional-rule element requires a threshold attribute.");
        }

        builder.ConditionalRule(key, Operator, threshold, Color, Threshold2, RuleId);
    }
}
