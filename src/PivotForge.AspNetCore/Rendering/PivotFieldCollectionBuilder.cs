namespace PivotForge.AspNetCore.Rendering;

/// <summary>Collects the fields of a pivot grid in declaration order.</summary>
public sealed class PivotFieldCollectionBuilder
{
    private readonly List<PivotFieldBuilder> _fields = [];

    /// <summary>Adds a field and returns its builder.</summary>
    /// <returns>The builder for the added field.</returns>
    public PivotFieldBuilder Add()
    {
        var field = new PivotFieldBuilder();
        _fields.Add(field);
        return field;
    }

    /// <summary>Builds every configured field.</summary>
    /// <returns>The field configurations in declaration order.</returns>
    public IReadOnlyList<IDictionary<string, object?>> Build() =>
        _fields.Select(field => field.Build()).ToList();
}
