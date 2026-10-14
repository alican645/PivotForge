namespace PivotForge.AspNetCore.Rendering;

/// <summary>How row headers are arranged.</summary>
public enum PivotGridLayoutMode
{
    /// <summary>Each row field occupies its own column.</summary>
    Tabular,

    /// <summary>Row fields share a single indented column.</summary>
    Compact,

    /// <summary>
    /// The compact column drawn as a tree, as DevExtreme's <c>rowHeaderLayout: "tree"</c>: each group
    /// row is the parent node, named for its group, with guide lines down to its children.
    /// </summary>
    Tree
}
