using System.Globalization;

namespace PivotForge.Core.Aggregation;

internal sealed class AggregateState
{
    private decimal _sum;
    private int _count;
    private decimal? _min;
    private decimal? _max;

    public void Add(PivotValueDefinition definition, object? value)
    {
        if (definition.Aggregation == PivotAggregation.Count)
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

        var numericValue = ConvertToDecimal(definition, value);

        switch (definition.Aggregation)
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
                throw new ArgumentOutOfRangeException(nameof(definition), definition.Aggregation, "Unsupported pivot aggregation.");
        }
    }

    public decimal? Finalize(PivotAggregation aggregation)
    {
        return aggregation switch
        {
            PivotAggregation.Sum => _count == 0 ? null : _sum,
            PivotAggregation.Count => _count,
            PivotAggregation.Average => _count == 0 ? null : _sum / _count,
            PivotAggregation.Min => _min,
            PivotAggregation.Max => _max,
            _ => throw new ArgumentOutOfRangeException(nameof(aggregation), aggregation, "Unsupported pivot aggregation.")
        };
    }

    private static decimal ConvertToDecimal(PivotValueDefinition definition, object value)
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
