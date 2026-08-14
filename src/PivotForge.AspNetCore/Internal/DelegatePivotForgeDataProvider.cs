namespace PivotForge.AspNetCore.Internal;

internal sealed class DelegatePivotForgeDataProvider<TRecord>(PivotForgeDataProvider<TRecord> provider)
    : IPivotForgeDataProvider<TRecord>
{
    public ValueTask<IReadOnlyList<TRecord>> GetRecordsAsync(
        PivotForgeDataRequest request,
        CancellationToken cancellationToken)
        => provider(request, cancellationToken);
}
