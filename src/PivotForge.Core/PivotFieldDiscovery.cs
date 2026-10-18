using System.Collections.Concurrent;
using System.Data;
using System.Reflection;

namespace PivotForge.Core;

/// <summary>A source field found by <see cref="PivotFieldDiscovery"/>.</summary>
/// <param name="DataField">The source field name.</param>
/// <param name="DataType">What its values are read as.</param>
/// <param name="GroupInterval">The date part this entry groups by, or <see cref="PivotGroupInterval.None"/>.</param>
/// <param name="GroupName">For a date part, the date field it belongs to; otherwise null.</param>
/// <param name="GroupIndex">For a date part, its level within the date: 0 year, 1 quarter, 2 month.</param>
public sealed record PivotDiscoveredField(
    string DataField,
    PivotDataType DataType,
    PivotGroupInterval GroupInterval = PivotGroupInterval.None,
    string? GroupName = null,
    int? GroupIndex = null);

/// <summary>Lists the fields a source offers, DevExtreme's <c>retrieveFields</c>.</summary>
/// <remarks>
/// Each readable field comes back once, in declaration order (a type's properties, then its
/// fields), except a date: it comes back as
/// its year, quarter and month, the levels DevExtreme discovers for one. A field the engine
/// cannot read as a single value -- a nested object, a collection -- is left out, as is a name
/// starting with two underscores.
/// </remarks>
public static class PivotFieldDiscovery
{
    private static readonly ConcurrentDictionary<Type, IReadOnlyList<PivotDiscoveredField>> TypeCache = new();

    private static readonly PivotGroupInterval[] DateLevels =
        [PivotGroupInterval.Year, PivotGroupInterval.Quarter, PivotGroupInterval.Month];

    /// <summary>Lists the public properties and fields of a record type.</summary>
    /// <typeparam name="T">The record type the engine reads.</typeparam>
    /// <returns>The discovered fields.</returns>
    public static IReadOnlyList<PivotDiscoveredField> Discover<T>() => Discover(typeof(T));

    /// <summary>Lists the public properties and fields of a record type.</summary>
    /// <param name="recordType">The record type the engine reads.</param>
    /// <returns>The discovered fields.</returns>
    public static IReadOnlyList<PivotDiscoveredField> Discover(Type recordType)
    {
        ArgumentNullException.ThrowIfNull(recordType);

        return TypeCache.GetOrAdd(recordType, type => type
            .GetMembers(BindingFlags.Instance | BindingFlags.Public)
            .Where(member => member is PropertyInfo { GetMethod: not null } property
                ? property.GetIndexParameters().Length == 0
                : member is FieldInfo)
            // Metadata tokens run in declaration order within a kind, and fields come
            // before properties in them: properties, the usual record shape, go first.
            .OrderBy(member => member is FieldInfo)
            .ThenBy(member => member.MetadataToken)
            .SelectMany(member => Describe(member.Name, member switch
            {
                PropertyInfo property => property.PropertyType,
                FieldInfo field => field.FieldType,
                _ => null
            }))
            .ToArray());
    }

    /// <summary>Lists the columns of a table.</summary>
    /// <param name="table">The table the engine reads.</param>
    /// <returns>The discovered fields.</returns>
    public static IReadOnlyList<PivotDiscoveredField> Discover(DataTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        return table.Columns
            .Cast<DataColumn>()
            .SelectMany(column => Describe(column.ColumnName, column.DataType))
            .ToArray();
    }

    /// <summary>Lists the keys of dictionary records.</summary>
    /// <param name="records">The records the engine reads.</param>
    /// <returns>The discovered fields.</returns>
    /// <remarks>
    /// The keys are the first record's. A key's type is read off the first record that holds a
    /// value for it, so a leading null does not hide a date or a number.
    /// </remarks>
    public static IReadOnlyList<PivotDiscoveredField> Discover(IEnumerable<IReadOnlyDictionary<string, object?>> records)
    {
        ArgumentNullException.ThrowIfNull(records);

        var materialized = records as IReadOnlyList<IReadOnlyDictionary<string, object?>> ?? records.ToArray();
        if (materialized.Count == 0)
        {
            return [];
        }

        return materialized[0].Keys
            .SelectMany(key => Describe(key, materialized
                .Select(record => record.TryGetValue(key, out var value) ? value : null)
                .FirstOrDefault(value => value is not null)?.GetType() ?? typeof(string)))
            .ToArray();
    }

    private static IEnumerable<PivotDiscoveredField> Describe(string name, Type? type)
    {
        if (type is null || name.StartsWith("__", StringComparison.Ordinal))
        {
            yield break;
        }

        var dataType = DataTypeOf(Nullable.GetUnderlyingType(type) ?? type);
        if (dataType is null)
        {
            yield break;
        }

        if (dataType != PivotDataType.Date)
        {
            yield return new PivotDiscoveredField(name, dataType.Value);
            yield break;
        }

        for (var level = 0; level < DateLevels.Length; level++)
        {
            yield return new PivotDiscoveredField(name, PivotDataType.Date, DateLevels[level], name, level);
        }
    }

    private static PivotDataType? DataTypeOf(Type type)
    {
        if (type.IsEnum || type == typeof(string) || type == typeof(char) || type == typeof(bool) ||
            type == typeof(Guid) || type == typeof(TimeSpan) || type == typeof(TimeOnly))
        {
            return PivotDataType.String;
        }

        if (type == typeof(DateTime) || type == typeof(DateTimeOffset) || type == typeof(DateOnly))
        {
            return PivotDataType.Date;
        }

        return Type.GetTypeCode(type) switch
        {
            TypeCode.Byte or TypeCode.SByte or TypeCode.Int16 or TypeCode.UInt16 or TypeCode.Int32 or
                TypeCode.UInt32 or TypeCode.Int64 or TypeCode.UInt64 or TypeCode.Single or TypeCode.Double or
                TypeCode.Decimal => PivotDataType.Number,
            // A nested object or a collection is no single value the engine can read.
            _ => null
        };
    }
}
