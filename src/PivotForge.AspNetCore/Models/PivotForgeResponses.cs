using PivotForge.Core;

namespace PivotForge.AspNetCore.Models;

/// <summary>Returns the first page and session metadata for a large pivot operation.</summary>
/// <param name="SessionId">The cache session identifier used to request later pages.</param>
/// <param name="CacheHit">Whether the result was already present in the cache.</param>
/// <param name="ExpiresInSeconds">The configured sliding cache lifetime in seconds.</param>
/// <param name="Page">The first page of pivot rows.</param>
public sealed record PivotForgeLargeStartResponse(
    string SessionId,
    bool CacheHit,
    int ExpiresInSeconds,
    PivotResultPage Page);

/// <summary>Returns source records behind a pivot coordinate.</summary>
/// <param name="Records">The visible source records.</param>
/// <param name="TotalCount">The total number of matching records before truncation.</param>
/// <param name="Truncated">Whether records were omitted because of the configured limit.</param>
/// <param name="Limit">The configured response record limit.</param>
/// <param name="ValueKey">The selected value definition key.</param>
public sealed record PivotForgeDrillDownResponse(
    IReadOnlyList<object?> Records,
    int TotalCount,
    bool Truncated,
    int Limit,
    string? ValueKey);

/// <summary>Returns the distinct values a filter on one field can accept.</summary>
/// <param name="Field">The source field the values belong to.</param>
/// <param name="Values">The visible distinct values, in value order.</param>
/// <param name="TotalCount">The total number of distinct values before truncation.</param>
/// <param name="Truncated">Whether values were omitted because of the configured limit.</param>
/// <param name="Limit">The configured response value limit.</param>
public sealed record PivotForgeFieldValuesResponse(
    string Field,
    IReadOnlyList<string?> Values,
    int TotalCount,
    bool Truncated,
    int Limit);

/// <summary>Returns the fields the record type offers, DevExtreme's <c>retrieveFields</c>.</summary>
/// <param name="Fields">The discovered fields, in declaration order.</param>
public sealed record PivotForgeFieldsResponse(IReadOnlyList<PivotForgeDiscoveredField> Fields);

/// <summary>One discovered field, named the way the browser widget declares fields.</summary>
/// <param name="DataField">The source field name.</param>
/// <param name="DataType">"string", "number" or "date".</param>
/// <param name="GroupInterval">For a date part, "year", "quarter" or "month"; otherwise null.</param>
/// <param name="GroupName">For a date part, the date field it belongs to; otherwise null.</param>
/// <param name="GroupIndex">For a date part, its level within the date; otherwise null.</param>
public sealed record PivotForgeDiscoveredField(
    string DataField,
    string DataType,
    string? GroupInterval,
    string? GroupName,
    int? GroupIndex);

/// <summary>Returns a client-safe endpoint error.</summary>
/// <param name="Message">The error message.</param>
public sealed record PivotForgeErrorResponse(string Message);
