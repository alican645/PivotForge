using PivotForge.AspNetCore.Models;
using PivotForge.Core;

namespace PivotForge.AspNetCore.Internal;

/// <summary>Decides which source fields a request is allowed to reach.</summary>
internal static class PivotFieldAccess
{
    /// <summary>Returns whether every named field is readable under these options.</summary>
    public static bool Allows(this PivotForgeOptions options, IEnumerable<string> fields) =>
        options.AllowedFields.Count == 0 || fields.All(options.AllowedFields.Contains);

    /// <summary>Returns the fields a request reads from the source records.</summary>
    /// <remarks>
    /// Sorts are left out on purpose. A sort names a header level rather than a source field:
    /// the level has to be among the rows or columns to mean anything, and those are checked
    /// here, so a sort cannot reach a field this list has not already seen.
    /// A calculated value reads the fields its formula names, not its own name, so those are
    /// what it contributes: a formula typed in the browser can reach no field a header could not.
    /// </remarks>
    public static IEnumerable<string> ReadFields(this PivotForgeRequest request) => request.Rows
        .Concat(request.Columns)
        .Select(level => level.Field)
        .Concat(request.Values.SelectMany(ValueFields))
        .Concat(request.Filters.Select(filter => filter.Field));

    private static IEnumerable<string> ValueFields(PivotValueDefinition value)
    {
        if (value.Expression is null)
        {
            return [value.Field];
        }

        try
        {
            return PivotExpression.Parse(value.Expression).Fields;
        }
        catch (PivotExpressionException)
        {
            // Nothing is read from a formula that cannot be read; the engine refuses the
            // request for its own reason, which is the more useful one to report.
            return [];
        }
    }
}
