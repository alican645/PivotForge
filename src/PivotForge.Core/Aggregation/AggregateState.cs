using System.Globalization;

namespace PivotForge.Core.Aggregation;

internal sealed class AggregateState(MeasureInput input)
{
    // Only a median and a custom aggregate keep the values themselves: both need the whole list,
    // where every other summary folds each value in as it arrives.
    private readonly List<decimal>? _values =
        input.Custom is not null || input.Aggregation == PivotAggregation.Median ? [] : null;
    // Any value type, as Count takes: a distinct count of customer ids or regions is as common as
    // one of numbers.
    private readonly HashSet<object>? _distinct =
        input.Aggregation == PivotAggregation.CountDistinct ? [] : null;
    private decimal _sum;
    // Welford's running mean and sum of squared deviations: a sum of squares overflows decimal
    // long before the values themselves do, and loses the variance of large, close values.
    private decimal _mean;
    private decimal _squaredDeviations;
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

        if (_distinct is not null)
        {
            _distinct.Add(value);
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
            case PivotAggregation.Variance:
            case PivotAggregation.StandardDeviation:
                _count++;
                var deviation = numericValue - _mean;
                _mean += deviation / _count;
                _squaredDeviations += deviation * (numericValue - _mean);
                break;
            default:
                throw new InvalidOperationException($"Unsupported pivot aggregation '{input.Aggregation}'.");
        }
    }

    public decimal? Finalize()
    {
        if (_values is not null)
        {
            return _values.Count == 0 ? null
                : input.Custom is not null ? input.Custom(_values)
                : Median(_values);
        }

        return input.Aggregation switch
        {
            PivotAggregation.Sum => _count == 0 ? null : _sum,
            PivotAggregation.Count => _count,
            PivotAggregation.Average => _count == 0 ? null : _sum / _count,
            PivotAggregation.Min => _min,
            PivotAggregation.Max => _max,
            PivotAggregation.CountDistinct => _distinct!.Count,
            PivotAggregation.Variance => _count < 2 ? null : _squaredDeviations / (_count - 1),
            PivotAggregation.StandardDeviation => _count < 2 ? null : SquareRoot(_squaredDeviations / (_count - 1)),
            _ => throw new InvalidOperationException($"Unsupported pivot aggregation '{input.Aggregation}'.")
        };
    }

    private static decimal Median(List<decimal> values)
    {
        values.Sort();
        var middle = values.Count / 2;

        return values.Count % 2 == 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    }

    // decimal has no square root. A double gets within about 15 digits, and one Newton step in
    // decimal recovers the rest.
    private static decimal SquareRoot(decimal value)
    {
        if (value <= 0)
        {
            return 0;
        }

        var root = (decimal)Math.Sqrt((double)value);
        return root == 0 ? 0 : (root + value / root) / 2;
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
