namespace PivotForge.AspNetCore.Rendering;

/// <summary>Where a grid persists the layout, captions, filters, and sort a user arrived at.</summary>
public enum PivotStateStorage
{
    /// <summary>Nothing is persisted; every load starts from the declared configuration.</summary>
    None,

    /// <summary>Persisted in <c>localStorage</c>, so it survives closing the browser.</summary>
    Local,

    /// <summary>Persisted in <c>sessionStorage</c>, so it lasts only for the browser tab.</summary>
    Session,

    /// <summary>Handed to page functions that load and save it wherever the page keeps it --
    /// a user profile on the server, for instance. DevExtreme's <c>type: "custom"</c>.</summary>
    Custom
}
