namespace PivotForge.Core.Aggregation;

internal sealed class AggregateBucket
{
    private readonly Dictionary<string, AggregateState> _states;

    public AggregateBucket(IEnumerable<PivotValueDefinition> definitions)
    {
        _states = definitions.ToDictionary(definition => definition.Key, _ => new AggregateState(), StringComparer.Ordinal);
    }

    public void Add(PivotValueDefinition definition, object? value)
    {
        _states[definition.Key].Add(definition, value);
    }

    public IReadOnlyDictionary<string, decimal?> Finalize(IReadOnlyList<PivotValueDefinition> definitions)
    {
        return definitions.ToDictionary(
            definition => definition.Key,
            definition => _states[definition.Key].Finalize(definition.Aggregation),
            StringComparer.Ordinal);
    }
}
