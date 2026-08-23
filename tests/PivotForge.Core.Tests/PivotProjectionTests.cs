using PivotForge.Core;

namespace PivotForge.Core.Tests;

public sealed class PivotProjectionTests
{
    private sealed record Employee(string Department, decimal Salary, string PasswordHash);

    private static readonly Employee[] People =
    [
        new("Sales", 100m, "secret-one"),
        new("Support", 200m, "secret-two")
    ];

    [Fact]
    public void OnlyTheNamedFieldsSurvive()
    {
        var projected = PivotEngine.Project(People, ["Department", "Salary"]);

        Assert.Equal(2, projected.Count);
        Assert.Equal(["Department", "Salary"], projected[0].Keys);
        Assert.Equal("Sales", projected[0]["Department"]);
        Assert.Equal(100m, projected[0]["Salary"]);
    }

    [Fact]
    public void AFieldTheRecordDoesNotCarryIsLeftOutRatherThanReported()
    {
        // The list is written once for an application, while a provider may hand back a
        // narrower record on one page than on another; throwing would make the wider
        // list the narrower page's problem.
        var projected = PivotEngine.Project(People, ["Department", "Bonus"]);

        Assert.Equal(["Department"], projected[0].Keys);
    }

    [Fact]
    public void ANameRepeatedInAnotherCasingDoesNotCollide()
    {
        // Field names are matched without regard to case everywhere else, so two
        // spellings of one field are one field here too.
        var projected = PivotEngine.Project(People, ["Department", "department"]);

        Assert.Single(projected[0]);
        Assert.Equal("Sales", projected[0]["DEPARTMENT"]);
    }

    [Fact]
    public void AnEmptyFieldListLeavesEmptyRecordsRatherThanWholeOnes()
    {
        // The caller decides whether to project at all; asking for nothing has to mean
        // nothing rather than quietly meaning everything.
        var projected = PivotEngine.Project(People, []);

        Assert.Equal(2, projected.Count);
        Assert.All(projected, Assert.Empty);
    }
}
