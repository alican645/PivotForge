namespace PivotForge.Core.Aggregation;

/// <summary>One summary accumulated per bucket: a field, and how its values combine.</summary>
/// <param name="Field">The source field read from each record.</param>
/// <param name="Aggregation">The built-in aggregation, or <see cref="PivotAggregation.Calculated"/>
/// when <paramref name="Custom"/> supplies the summary instead.</param>
/// <param name="Custom">A registered custom aggregate, or null for a built-in one.</param>
internal sealed record MeasureInput(string Field, PivotAggregation Aggregation, PivotCustomAggregate? Custom);

/// <summary>What a request's values need from each bucket, worked out once per request.</summary>
/// <remarks>
/// A plain value is one summary. A calculated value is a formula over several, and those are
/// accumulated exactly like plain ones -- which is why a formula is right at every level: each
/// subtotal and grand total is its own bucket, and the formula runs on that bucket's sums
/// rather than on the sums of its children's results. A summary two values share, such as
/// <c>Amount_sum</c> beside a formula over <c>[Amount]</c>, is accumulated once.
/// </remarks>
internal sealed class MeasurePlan
{
    private readonly (string Key, int Input, PivotExpression? Expression, int[]? Inputs)[] _outputs;

    private MeasurePlan(
        IReadOnlyList<MeasureInput> inputs,
        (string Key, int Input, PivotExpression? Expression, int[]? Inputs)[] outputs)
    {
        Inputs = inputs;
        _outputs = outputs;
    }

    public IReadOnlyList<MeasureInput> Inputs { get; }

    /// <summary>Builds the plan for a request's values.</summary>
    /// <exception cref="ArgumentException">A value is calculated without a formula, or has a
    /// formula without being calculated.</exception>
    /// <exception cref="PivotExpressionException">A formula cannot be read, or calls a function
    /// that is neither built in nor registered.</exception>
    public static MeasurePlan Create(
        IReadOnlyList<PivotValueDefinition> values,
        IReadOnlyDictionary<string, PivotCustomAggregate>? customAggregates)
    {
        var inputs = new List<MeasureInput>();
        var indexes = new Dictionary<(string Field, PivotAggregation Aggregation, string? Custom), int>();

        int InputFor(string field, PivotAggregation aggregation, string? customName, PivotCustomAggregate? custom)
        {
            // Field names resolve without regard to case in every record reader, so two
            // spellings of one field are one summary.
            var identity = (field.ToUpperInvariant(), aggregation, customName?.ToUpperInvariant());

            if (!indexes.TryGetValue(identity, out var index))
            {
                index = inputs.Count;
                inputs.Add(new MeasureInput(field, aggregation, custom));
                indexes.Add(identity, index);
            }

            return index;
        }

        var outputs = values.Select(value =>
        {
            if (value.Aggregation != PivotAggregation.Calculated)
            {
                if (value.Expression is not null)
                {
                    throw new ArgumentException(
                        $"Value '{value.Key}' has a formula but is not a calculated value.", nameof(values));
                }

                return (value.Key, InputFor(value.Field, value.Aggregation, null, null), (PivotExpression?)null, (int[]?)null);
            }

            if (string.IsNullOrWhiteSpace(value.Expression))
            {
                throw new PivotExpressionException(
                    $"Calculated value '{value.Field}' requires a formula.", 0);
            }

            var expression = PivotExpression.Parse(value.Expression);
            var summaryInputs = expression.Summaries.Select(summary =>
            {
                if (TryBuiltIn(summary.Function) is { } aggregation)
                {
                    return InputFor(summary.Field, aggregation, null, null);
                }

                if (customAggregates is not null &&
                    customAggregates.TryGetValue(summary.Function, out var custom))
                {
                    return InputFor(summary.Field, PivotAggregation.Calculated, summary.Function, custom);
                }

                throw new PivotExpressionException(
                    $"'{summary.Function}' is not a summary function.",
                    value.Expression.IndexOf(summary.Function, StringComparison.OrdinalIgnoreCase));
            }).ToArray();

            return (value.Key, -1, expression, summaryInputs);
        }).ToArray();

        return new MeasurePlan(inputs, outputs);
    }

    /// <summary>Reads the fields each input summarizes from one record.</summary>
    public object?[] Read(object record, Records.IRecordReader reader)
    {
        var values = new object?[Inputs.Count];

        for (var index = 0; index < values.Length; index++)
        {
            values[index] = reader.GetValue(record, Inputs[index].Field);
        }

        return values;
    }

    /// <summary>Turns a bucket's accumulated summaries into the request's values, keyed.</summary>
    public IReadOnlyDictionary<string, decimal?> Finalize(IReadOnlyList<decimal?> summaries)
    {
        var result = new Dictionary<string, decimal?>(_outputs.Length, StringComparer.Ordinal);

        foreach (var (key, input, expression, inputs) in _outputs)
        {
            result[key] = expression is null
                ? summaries[input]
                : PivotExpression.Evaluate(expression.Root, inputs!.Select(index => summaries[index]).ToArray());
        }

        return result;
    }

    private static PivotAggregation? TryBuiltIn(string function) => function.ToUpperInvariant() switch
    {
        "SUM" => PivotAggregation.Sum,
        "COUNT" => PivotAggregation.Count,
        "AVG" or "AVERAGE" => PivotAggregation.Average,
        "MIN" => PivotAggregation.Min,
        "MAX" => PivotAggregation.Max,
        _ => null
    };
}
