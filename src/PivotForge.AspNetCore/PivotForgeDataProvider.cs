namespace PivotForge.AspNetCore;

/// <summary>Describes a request for source records.</summary>
/// <param name="SourceRowCount">An optional row-count hint supplied by large-data and drill-down endpoints.</param>
public sealed record PivotForgeDataRequest(int? SourceRowCount);

/// <summary>Loads source records for PivotForge endpoints.</summary>
/// <typeparam name="TRecord">The source record type.</typeparam>
/// <param name="request">The data request.</param>
/// <param name="cancellationToken">A token that can cancel data loading.</param>
/// <returns>The source records.</returns>
public delegate ValueTask<IReadOnlyList<TRecord>> PivotForgeDataProvider<TRecord>(
    PivotForgeDataRequest request,
    CancellationToken cancellationToken);
