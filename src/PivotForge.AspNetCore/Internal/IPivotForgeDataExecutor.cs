using PivotForge.Core;

namespace PivotForge.AspNetCore.Internal;

internal interface IPivotForgeDataExecutor
{
    ValueTask<PivotResult> ExecuteAsync(
        PivotRequest request,
        int? sourceRowCount,
        CancellationToken cancellationToken);

    ValueTask<IReadOnlyList<string?>> DistinctValuesAsync(
        string field,
        PivotGroupInterval interval,
        int? sourceRowCount,
        CancellationToken cancellationToken);

    ValueTask<IReadOnlyList<object?>> DrillDownAsync(
        PivotRequest request,
        IReadOnlyList<string?> rowPath,
        IReadOnlyList<string?> columnPath,
        int? sourceRowCount,
        CancellationToken cancellationToken);
}
