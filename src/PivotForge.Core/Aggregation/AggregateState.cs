using System.Globalization;

namespace PivotForge.Core.Aggregation;

internal sealed class AggregateState(MeasureInput input)
{
    // Only a custom aggregate keeps the values themselves: it is handed the whole list, so a
    // median or a distinct count can be written without the engine knowing what it is.
    private readonly List<decimal>? _values = input.Custom is null ? null : [];
    private decimal _sum;
    private int _count;
    private decimal? _min;
    private decimal? _max;

    public void Add(object? value)
    {
        if (input.Aggregation == PivotAggregation.Count)
        {
            if (value is not null)
            {
                _count++;
            }

            return;
        }

        if (value is null)
        {
            return;
        }

        var numericValue = ConvertToDecimal(input, value);

        if (_values is not null)
        {
            _values.Add(numericValue);
            return;
        }

        switch (input.Aggregation)
        {
            case PivotAggregation.Sum:
            case PivotAggregation.Average:
                _sum += numericValue;
                _count++;
                break;
            case PivotAggregation.Min:
                _min = _min is null || numericValue < _min.Value ? numericValue : _min;
                break;
            case PivotAggregation.Max:
                _max = _max is null || numericValue > _max.Value ? numericValue : _max;
                break;
            default:
                throw new InvalidOperationException($"Unsupported pivot aggregation '{input.Aggregation}'.");
        }
    }

    public decimal? Finalize()
    {
        if (_values is not null)
        {
            return _values.Count == 0 ? null : input.Custom!(_values);
        }

        return input.Aggregation switch
        {
            PivotAggregation.Sum => _count == 0 ? null : _sum,
            PivotAggregation.Count => _count,
            PivotAggregation.Average => _count == 0 ? null : _sum / _count,
            PivotAggregation.Min => _min,
            PivotAggregation.Max => _max,
            _ => throw new InvalidOperationException($"Unsupported pivot aggregation '{input.Aggregation}'.")
        };
    }

    private static decimal ConvertToDecimal(MeasureInput definition, object value)
    {
        try
        {
            return value switch
            {
                byte number => number,
                sbyte number => number,
                short number => number,
                ushort number => number,
                int number => number,
                uint number => number,
                long number => number,
                ulong number => number,
                float number => Convert.ToDecimal(number, CultureInfo.InvariantCulture),
                double number => Convert.ToDecimal(number, CultureInfo.InvariantCulture),
                decimal number => number,
                _ => throw new PivotFieldTypeException(definition.Field, definition.Aggregation, value)
            };
        }
        catch (OverflowException)
        {
            throw new PivotFieldTypeException(definition.Field, definition.Aggregation, value);
        }
    }
}
