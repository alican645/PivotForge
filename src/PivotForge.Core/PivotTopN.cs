namespace PivotForge.Core;

/// <summary>Limits one row header level to its highest or lowest ranking groups.</summary>
/// <remarks>
/// Unlike <see cref="PivotFilter"/>, which decides which source records take part, this runs
/// after aggregation: the groups it ranks do not exist until the records have been summed.
/// <para>
/// A level is ranked inside its own parent group, the same way <see cref="PivotFieldSort"/>
/// orders one, so the top two categories of every region are two per region rather than two
/// in total.
/// </para>
/// <para>
/// The rows it drops leave the result entirely, totals included: a grand total still counting
/// rows the reader cannot see is the one number a pivot table cannot afford to get wrong.
/// </para>
/// </remarks>
/// <param name="Field">The row field, or <c>field:interval</c> level key, being limited.</param>
/// <param name="Count">How many groups survive in each parent group.</param>
/// <param name="ValueKey">
/// The <see cref="PivotValueDefinition.Key"/> that ranks the groups. When null the first
/// declared value is used, which is what a grid with one measure means by "top five".
/// </param>
/// <param name="Mode">Whether the highest or the lowest ranking groups survive.</param>
public sealed record PivotTopN(
    string Field,
    int Count,
    string? ValueKey = null,
    PivotTopNMode Mode = PivotTopNMode.Top);

/// <summary>Specifies which end of a ranking a <see cref="PivotTopN"/> keeps.</summary>
public enum PivotTopNMode
{
    /// <summary>Keeps the highest ranking groups.</summary>
    Top,

    /// <summary>Keeps the lowest ranking groups.</summary>
    Bottom
}
