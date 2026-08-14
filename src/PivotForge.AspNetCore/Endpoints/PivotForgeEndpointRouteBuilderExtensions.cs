using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using PivotForge.AspNetCore.Caching;
using PivotForge.AspNetCore.Internal;
using PivotForge.AspNetCore.Models;
using PivotForge.Core;
using PivotForge.Core.Excel;

namespace PivotForge.AspNetCore.Endpoints;

/// <summary>Maps PivotForge HTTP endpoints into an ASP.NET Core application.</summary>
public static class PivotForgeEndpointRouteBuilderExtensions
{
    /// <summary>Maps pivot, paging, drill-down, and Excel export endpoints.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <param name="pattern">The route-group prefix, with or without a leading slash.</param>
    /// <returns>The mapped route group.</returns>
    public static RouteGroupBuilder MapPivotForgeEndpoints(
        this IEndpointRouteBuilder endpoints,
        string pattern = "/pivotforge")
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        ArgumentException.ThrowIfNullOrWhiteSpace(pattern);

        var normalizedPattern = pattern.StartsWith('/') ? pattern : $"/{pattern}";
        normalizedPattern = normalizedPattern.Length == 1 ? "" : normalizedPattern.TrimEnd('/');
        var group = endpoints.MapGroup(normalizedPattern).WithTags("PivotForge");

        group.MapPost("/pivot", HandlePivotAsync).WithName("PivotForge.Pivot");
        group.MapPost("/large/start", HandleLargeStartAsync).WithName("PivotForge.Large.Start");
        group.MapPost("/large/page", HandleLargePage).WithName("PivotForge.Large.Page");
        group.MapPost("/drill-down", HandleDrillDownAsync).WithName("PivotForge.DrillDown");
        group.MapPost("/excel", HandleExcel).WithName("PivotForge.Excel");

        return group;
    }

    private static async Task<IResult> HandlePivotAsync(
        PivotForgeRequest request,
        IPivotForgeDataExecutor executor,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await executor.ExecuteAsync(request.ToPivotRequest(), null, cancellationToken);
            return Results.Ok(result);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (IsInvalidPivotRequest(exception))
        {
            return BadRequest("Pivot request is not valid.");
        }
    }

    private static async Task<IResult> HandleLargeStartAsync(
        PivotForgeLargeStartRequest request,
        IPivotForgeDataExecutor executor,
        IPivotForgeResultCache cache,
        IOptions<PivotForgeOptions> optionsAccessor,
        CancellationToken cancellationToken)
    {
        var options = optionsAccessor.Value;
        var sourceRowCount = Math.Clamp(
            request.SourceRowCount,
            options.MinimumLargeDataSourceRowCount,
            options.MaximumSourceRowCount);
        var pageSize = Math.Clamp(request.PageSize, options.MinimumPageSize, options.MaximumPageSize);

        try
        {
            var pivotRequest = request.ToPivotRequest();
            var cacheEntry = await cache.GetOrCreateAsync(
                new
                {
                    request.Rows,
                    request.Columns,
                    request.Values,
                    request.Filters,
                    request.RowSort,
                    SourceRowCount = sourceRowCount
                },
                token => executor.ExecuteAsync(pivotRequest, sourceRowCount, token),
                cancellationToken);
            var page = PivotResultPaginator.CreatePage(cacheEntry.Result, 0, pageSize);

            return Results.Ok(new PivotForgeLargeStartResponse(
                cacheEntry.SessionId,
                cacheEntry.CacheHit,
                Math.Max(1, (int)options.CacheSlidingExpiration.TotalSeconds),
                page));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (IsInvalidPivotRequest(exception))
        {
            return BadRequest("Large pivot request is not valid.");
        }
    }

    private static IResult HandleLargePage(
        PivotForgePageRequest request,
        IPivotForgeResultCache cache,
        IOptions<PivotForgeOptions> optionsAccessor,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!cache.TryGet(request.SessionId, out var result))
        {
            return Results.Json(
                new PivotForgeErrorResponse("The pivot session has expired."),
                statusCode: StatusCodes.Status410Gone);
        }

        var options = optionsAccessor.Value;
        var pageSize = Math.Clamp(request.PageSize, options.MinimumPageSize, options.MaximumPageSize);

        try
        {
            return Results.Ok(PivotResultPaginator.CreatePage(result, request.Offset, pageSize));
        }
        catch (ArgumentOutOfRangeException)
        {
            return BadRequest("Pivot page request is not valid.");
        }
    }

    private static async Task<IResult> HandleDrillDownAsync(
        PivotForgeDrillDownRequest request,
        IPivotForgeDataExecutor executor,
        IOptions<PivotForgeOptions> optionsAccessor,
        CancellationToken cancellationToken)
    {
        var options = optionsAccessor.Value;
        var sourceRowCount = Math.Clamp(request.SourceRowCount, 1, options.MaximumSourceRowCount);

        try
        {
            var records = await executor.DrillDownAsync(
                request.ToPivotRequest(),
                request.RowPath,
                request.ColumnPath,
                sourceRowCount,
                cancellationToken);
            var visibleRecords = records.Take(options.DrillDownRecordLimit).ToArray();

            return Results.Ok(new PivotForgeDrillDownResponse(
                visibleRecords,
                records.Count,
                records.Count > options.DrillDownRecordLimit,
                options.DrillDownRecordLimit,
                request.ValueKey));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (IsInvalidPivotRequest(exception))
        {
            return BadRequest("Drill-down request is not valid.");
        }
    }

    private static IResult HandleExcel(
        PivotExcelDocument document,
        IOptions<PivotForgeOptions> optionsAccessor)
    {
        var options = optionsAccessor.Value;
        var cellCount = document.Rows.Sum(row => row.Cells.Count);

        if (document.Rows.Count == 0 ||
            document.Rows.Count > options.MaximumExcelRows ||
            cellCount > options.MaximumExcelCells)
        {
            return BadRequest("Excel export dimensions are not valid.");
        }

        try
        {
            var workbook = new PivotExcelExporter().Export(document);
            return Results.File(
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"pivotforge-{DateTime.UtcNow:yyyy-MM-dd}.xlsx");
        }
        catch (ArgumentException)
        {
            return BadRequest("Excel export request is not valid.");
        }
    }

    private static IResult BadRequest(string message) =>
        Results.BadRequest(new PivotForgeErrorResponse(message));

    private static bool IsInvalidPivotRequest(Exception exception) =>
        exception is ArgumentException or PivotFieldNotFoundException or PivotFieldTypeException;
}
