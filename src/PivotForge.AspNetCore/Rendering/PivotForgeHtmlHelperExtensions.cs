using Microsoft.AspNetCore.Mvc.Rendering;

namespace PivotForge.AspNetCore.Rendering;

/// <summary>Exposes PivotForge view components on <see cref="IHtmlHelper"/>.</summary>
public static class PivotForgeHtmlHelperExtensions
{
    /// <summary>Gets the PivotForge component factory.</summary>
    /// <param name="helper">The view's HTML helper.</param>
    /// <returns>A factory for PivotForge components.</returns>
    public static PivotForgeFactory PivotForge(this IHtmlHelper helper)
    {
        ArgumentNullException.ThrowIfNull(helper);
        return new PivotForgeFactory();
    }
}
