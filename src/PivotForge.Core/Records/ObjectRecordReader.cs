using System.Collections.Concurrent;
using System.Linq.Expressions;
using System.Reflection;

namespace PivotForge.Core.Records;

internal sealed class ObjectRecordReader<T> : IRecordReader
{
    private static readonly ConcurrentDictionary<string, Func<T, object?>> Accessors = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, MemberInfo> Members = typeof(T)
        .GetMembers(BindingFlags.Instance | BindingFlags.Public)
        .Where(member => member is PropertyInfo { GetMethod: not null } or FieldInfo)
        .GroupBy(member => member.Name, StringComparer.OrdinalIgnoreCase)
        .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

    public bool HasField(string field) => Members.ContainsKey(field);

    public object? GetValue(object record, string field)
    {
        var accessor = Accessors.GetOrAdd(field, CreateAccessor);
        return accessor((T)record);
    }

    private static Func<T, object?> CreateAccessor(string field)
    {
        if (!Members.TryGetValue(field, out var member))
        {
            throw new PivotFieldNotFoundException(field);
        }

        var source = Expression.Parameter(typeof(T), "source");
        Expression value = member switch
        {
            PropertyInfo property => Expression.Property(source, property),
            FieldInfo fieldInfo => Expression.Field(source, fieldInfo),
            _ => throw new PivotFieldNotFoundException(field)
        };

        var boxed = Expression.Convert(value, typeof(object));
        return Expression.Lambda<Func<T, object?>>(boxed, source).Compile();
    }
}
