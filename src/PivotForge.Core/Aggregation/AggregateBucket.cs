namespace PivotForge.Core.Aggregation;

internal sealed class AggregateBucket
{
    private readonly MeasurePlan _plan;
    private readonly AggregateState[] _states;

    public AggregateBucket(MeasurePlan plan)
    {
        _plan = plan;
        _states = new AggregateState[plan.Inputs.Count];

        for (var index = 0; index < _states.Length; index++)
        {
            _states[index] = new AggregateState(plan.Inputs[index]);
        }
    }

    /// <summary>Adds one record's values, as <see cref="MeasurePlan.Read"/> returned them.</summary>
    public void Add(object?[] values)
    {
        for (var index = 0; index < _states.Length; index++)
        {
            _states[index].Add(values[index]);
        }
    }

    public IReadOnlyDictionary<string, decimal?> Finalize()
    {
        var summaries = new decimal?[_states.Length];

        for (var index = 0; index < summaries.Length; index++)
        {
            summaries[index] = _states[index].Finalize();
        }

        return _plan.Finalize(summaries);
    }
}
