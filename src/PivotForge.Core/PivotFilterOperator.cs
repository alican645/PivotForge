namespace PivotForge.Core;

/// <summary>Specifies how a filter's arguments are compared against a field's values.</summary>
/// <remarks>
/// The operator decides what <see cref="PivotFilter.Values"/> means: for
/// <see cref="Equals"/> it is the list of values themselves, for the text and comparison
/// operators it is the argument they take, and for <see cref="Blank"/> it is ignored.
/// <para>
/// There is no "does not contain" or "is not blank" here on purpose:
/// <see cref="PivotFilterMode.Exclude"/> negates whatever the operator decided, so every
/// operator comes with its opposite already attached.
/// </para>
/// </remarks>
public enum PivotFilterOperator
{
    /// <summary>Keeps the values on the list. Takes any number of arguments.</summary>
    Equals,

    /// <summary>Keeps values containing the argument, ignoring case. Takes one argument.</summary>
    Contains,

    /// <summary>Keeps values starting with the argument, ignoring case. Takes one argument.</summary>
    StartsWith,

    /// <summary>Keeps values ending with the argument, ignoring case. Takes one argument.</summary>
    EndsWith,

    /// <summary>Keeps values between the two arguments, both ends included. Takes two arguments.</summary>
    Between,

    /// <summary>Keeps values above the argument. Takes one argument.</summary>
    GreaterThan,

    /// <summary>Keeps values below the argument. Takes one argument.</summary>
    LessThan,

    /// <summary>Keeps values that are blank. Takes no arguments.</summary>
    Blank
}
