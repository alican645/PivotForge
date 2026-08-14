using PivotForge.Core;

namespace PivotForge.AspNetCore.Caching;

/// <summary>Stores completed pivot results for page requests.</summary>
public interface IPivotForgeResultCache
{
    /// <summary>Gets a cached result or creates and stores it atomically.</summary>
    /// <param name="cacheIdentity">A serializable value that uniquely describes the pivot result.</param>
    /// <param name="factory">The result factory invoked on a cache miss.</param>
    /// <param name="cancellationToken">A token that can cancel waiting or result creation.</param>
    /// <returns>The cache entry and hit status.</returns>
    Task<PivotForgeCacheEntry> GetOrCreateAsync(
        object cacheIdentity,
        Func<CancellationToken, ValueTask<PivotResult>> factory,
        CancellationToken cancellationToken);

    /// <summary>Attempts to resolve a completed pivot session.</summary>
    /// <param name="sessionId">The session identifier.</param>
    /// <param name="result">The cached result when found.</param>
    /// <returns><see langword="true"/> when the session exists; otherwise <see langword="false"/>.</returns>
    bool TryGet(string sessionId, out PivotResult result);
}

/// <summary>Contains a cached pivot result and its session metadata.</summary>
/// <param name="SessionId">The stable session identifier.</param>
/// <param name="Result">The completed pivot result.</param>
/// <param name="CacheHit">Whether the result was already cached.</param>
public sealed record PivotForgeCacheEntry(string SessionId, PivotResult Result, bool CacheHit);
