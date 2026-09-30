using Microsoft.Extensions.Options;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Internal;

internal sealed class PivotForgeDataExecutor<TRecord>(
    IPivotForgeDataProvider<TRecord> provider,
    IOptions<PivotForgeOptions> options)
    : IPivotForgeDataExecutor
{
    // Copied per engine rather than shared, so a registration made after startup cannot
    // change a result halfway through computing it.
    private PivotEngine CreateEngine() => new()
    {
        CustomAggregates = new Dictionary<string, PivotCustomAggregate>(
            options.Value.CustomAggregates, StringComparer.OrdinalIgnoreCase)
    };

    public async ValueTask<PivotResult> ExecuteAsync(
        PivotRequest request,
        int? sourceRowCount,
        CancellationToken cancellationToken)
    {
        var records = await GetRecordsAsync(sourceRowCount, cancellationToken);

        return await Task.Run(
            () => CreateEngine().Execute(records, request, cancellationToken),
            cancellationToken);
    }

    public async ValueTask<IReadOnlyList<string?>> DistinctValuesAsync(
        string field,
        PivotGroupInterval interval,
        int? sourceRowCount,
        CancellationToken cancellationToken)
    {
        var records = await GetRecordsAsync(sourceRowCount, cancellationToken);

        return await Task.Run(
            () => new PivotEngine().DistinctValues(records, field, interval),
            cancellationToken);
    }

    public async ValueTask<IReadOnlyList<object?>> DrillDownAsync(
        PivotRequest request,
        IReadOnlyList<string?> rowPath,
        IReadOnlyList<string?> columnPath,
        int? sourceRowCount,
        ICollection<string> projection,
        CancellationToken cancellationToken)
    {
        var records = await GetRecordsAsync(sourceRowCount, cancellationToken);

        var matches = await Task.Run(
            () => CreateEngine().DrillDown(records, request, rowPath, columnPath),
            cancellationToken);

        // The detail list is the one response that hands back whole source records, so an
        // allow-list has to reach it too: a field that cannot be a header should not arrive
        // as a column of the modal either.
        return projection.Count == 0
            ? matches.Select(record => (object?)record).ToArray()
            : PivotEngine.Project(matches, projection).Select(record => (object?)record).ToArray();
    }

    private async ValueTask<IReadOnlyList<TRecord>> GetRecordsAsync(
        int? sourceRowCount,
        CancellationToken cancellationToken)
    {
        var records = await provider.GetRecordsAsync(
            new PivotForgeDataRequest(sourceRowCount),
            cancellationToken);
        return records ?? throw new InvalidOperationException("The PivotForge data provider returned null.");
    }
}
