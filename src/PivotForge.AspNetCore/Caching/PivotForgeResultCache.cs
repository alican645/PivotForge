using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Caching;

/// <summary>Stores completed pivot results in the ASP.NET Core memory cache.</summary>
/// <param name="cache">The application memory cache.</param>
/// <param name="options">The PivotForge options.</param>
public sealed class PivotForgeResultCache(
    IMemoryCache cache,
    IOptions<PivotForgeOptions> options) : IPivotForgeResultCache
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new(StringComparer.Ordinal);

    /// <inheritdoc />
    public async Task<PivotForgeCacheEntry> GetOrCreateAsync(
        object cacheIdentity,
        Func<CancellationToken, ValueTask<PivotResult>> factory,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(cacheIdentity);
        ArgumentNullException.ThrowIfNull(factory);

        var sessionId = CreateSessionId(cacheIdentity);

        if (TryGet(sessionId, out var cached))
        {
            return new PivotForgeCacheEntry(sessionId, cached, true);
        }

        var gate = _locks.GetOrAdd(sessionId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);

        try
        {
            if (TryGet(sessionId, out cached))
            {
                return new PivotForgeCacheEntry(sessionId, cached, true);
            }

            var result = await factory(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            cache.Set(CacheKey(sessionId), result, new MemoryCacheEntryOptions
            {
                SlidingExpiration = options.Value.CacheSlidingExpiration,
                Size = 1
            });

            return new PivotForgeCacheEntry(sessionId, result, false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <inheritdoc />
    public bool TryGet(string sessionId, out PivotResult result)
    {
        result = null!;

        return IsValidSessionId(sessionId) &&
               cache.TryGetValue(CacheKey(sessionId), out result!);
    }

    private static string CreateSessionId(object identity)
    {
        var json = JsonSerializer.Serialize(identity);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    }

    private static bool IsValidSessionId(string? sessionId) =>
        sessionId?.Length == 64 && sessionId.All(char.IsAsciiHexDigit);

    private static string CacheKey(string sessionId) => $"pivotforge:large:{sessionId}";
}
