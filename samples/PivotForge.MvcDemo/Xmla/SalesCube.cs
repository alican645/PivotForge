using System.Globalization;
using PivotForge.MvcDemo.Models;

namespace PivotForge.MvcDemo.Xmla;

// The demo's sales records as a small OLAP cube, for the XMLA endpoint: a few
// attribute hierarchies, an Order Date calendar of year, quarter and month,
// and four measures, one of them a calculated member. It is what a real
// Analysis Services cube over the same table would expose, kept to what the
// PivotForge XmlaStore asks of it.

internal sealed class CubeMember
{
    public required string UniqueName { get; init; }
    public required string Caption { get; init; }
    public required CubeLevel Level { get; init; }
    public CubeMember? Parent { get; init; }
    public required Func<SalesRecord, bool> Contains { get; init; }
    public CubeMeasure? Measure { get; init; }

    public CubeHierarchy Hierarchy => Level.Hierarchy;
}

internal sealed class CubeLevel
{
    public required string Name { get; init; }
    public required string UniqueName { get; init; }
    public required string Caption { get; init; }
    public required int Number { get; init; }
    public required CubeHierarchy Hierarchy { get; init; }
    public List<CubeMember> Members { get; } = [];
    public bool IsAll => Number == 0 && Hierarchy.AllMember is not null;
}

internal sealed class CubeHierarchy
{
    public required string Name { get; init; }
    public required string UniqueName { get; init; }
    public required string Caption { get; init; }
    public required CubeDimension Dimension { get; init; }
    public List<CubeLevel> Levels { get; } = [];
    public CubeMember? AllMember { get; set; }
}

internal sealed class CubeDimension
{
    public required string Name { get; init; }
    public required string UniqueName { get; init; }
    public required string Caption { get; init; }
    // MDSCHEMA_DIMENSIONS' DIMENSION_TYPE: 1 time, 2 measures, 3 other.
    public required int Type { get; init; }
    public List<CubeHierarchy> Hierarchies { get; } = [];
}

internal sealed class CubeMeasure
{
    public required string Name { get; init; }
    public required string UniqueName { get; init; }
    public required string Caption { get; init; }
    public string? DisplayFolder { get; init; }
    public required Func<IReadOnlyList<SalesRecord>, decimal?> Compute { get; init; }
}

internal sealed class SalesCube
{
    public const string CatalogName = "PivotForgeDemo";
    public const string CubeName = "Sales";
    public const string MeasureGroup = "Sales";

    private readonly Dictionary<string, CubeMember> _members = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, CubeLevel> _levels = new(StringComparer.OrdinalIgnoreCase);

    private SalesCube(IReadOnlyList<SalesRecord> records, CultureInfo culture)
    {
        Records = records;
        Culture = culture;
        Measures = CreateMeasures();

        Dimensions.Add(MeasuresDimension());
        Dimensions.Add(Attribute("Region", "Region", record => record.Region));
        Dimensions.Add(Attribute("Product", "Category", record => record.Category));
        Dimensions.Add(Attribute("Sales Person", "Sales Person", record => record.SalesPerson));
        Dimensions.Add(Calendar());

        foreach (var level in Dimensions.SelectMany(dimension => dimension.Hierarchies).SelectMany(hierarchy => hierarchy.Levels))
        {
            _levels[level.UniqueName] = level;
            foreach (var member in level.Members)
            {
                _members[member.UniqueName] = member;
            }
        }
    }

    public IReadOnlyList<SalesRecord> Records { get; }
    public CultureInfo Culture { get; }
    public List<CubeDimension> Dimensions { get; } = [];
    public IReadOnlyList<CubeMeasure> Measures { get; }
    public CubeMeasure DefaultMeasure => Measures[0];

    public static SalesCube Create(IReadOnlyList<SalesRecord> records, CultureInfo culture) => new(records, culture);

    public CubeMember? FindMember(string uniqueName) => _members.GetValueOrDefault(uniqueName);

    public CubeLevel? FindLevel(string uniqueName) => _levels.GetValueOrDefault(uniqueName);

    public CubeHierarchy? FindHierarchy(string uniqueName) =>
        Dimensions.SelectMany(dimension => dimension.Hierarchies)
            .FirstOrDefault(hierarchy => string.Equals(hierarchy.UniqueName, uniqueName, StringComparison.OrdinalIgnoreCase));

    private static string Bracket(string name) => $"[{name.Replace("]", "]]", StringComparison.Ordinal)}]";

    private static IReadOnlyList<CubeMeasure> CreateMeasures()
    {
        decimal? Sum(IReadOnlyList<SalesRecord> records, Func<SalesRecord, decimal> value) =>
            records.Count == 0 ? null : records.Sum(value);

        return
        [
            new CubeMeasure
            {
                Name = "Amount", UniqueName = "[Measures].[Amount]", Caption = "Amount",
                Compute = records => Sum(records, record => record.Amount)
            },
            new CubeMeasure
            {
                Name = "Quantity", UniqueName = "[Measures].[Quantity]", Caption = "Quantity",
                Compute = records => Sum(records, record => record.Quantity)
            },
            new CubeMeasure
            {
                Name = "Order Count", UniqueName = "[Measures].[Order Count]", Caption = "Order Count",
                Compute = records => records.Count == 0 ? null : records.Count
            },
            // A calculated member, as a cube would define it: Amount / Order Count.
            new CubeMeasure
            {
                Name = "Average Amount", UniqueName = "[Measures].[Average Amount]", Caption = "Average Amount",
                DisplayFolder = "Calculated",
                Compute = records => records.Count == 0 ? null : records.Sum(record => record.Amount) / records.Count
            }
        ];
    }

    private CubeDimension MeasuresDimension()
    {
        var dimension = new CubeDimension { Name = "Measures", UniqueName = "[Measures]", Caption = "Measures", Type = 2 };
        var hierarchy = new CubeHierarchy { Name = "Measures", UniqueName = "[Measures]", Caption = "Measures", Dimension = dimension };
        var level = new CubeLevel
        {
            Name = "MeasuresLevel", UniqueName = "[Measures].[MeasuresLevel]", Caption = "MeasuresLevel", Number = 0,
            Hierarchy = hierarchy
        };
        foreach (var measure in Measures)
        {
            level.Members.Add(new CubeMember
            {
                UniqueName = measure.UniqueName, Caption = measure.Caption, Level = level, Contains = _ => true,
                Measure = measure
            });
        }

        hierarchy.Levels.Add(level);
        dimension.Hierarchies.Add(hierarchy);
        return dimension;
    }

    private (CubeDimension Dimension, CubeHierarchy Hierarchy) NewHierarchy(
        string dimensionName, string hierarchyName, int type, CubeDimension? existing = null)
    {
        var dimension = existing ?? new CubeDimension
        {
            Name = dimensionName, UniqueName = Bracket(dimensionName), Caption = dimensionName, Type = type
        };
        var hierarchy = new CubeHierarchy
        {
            Name = hierarchyName,
            UniqueName = $"{dimension.UniqueName}.{Bracket(hierarchyName)}",
            Caption = hierarchyName,
            Dimension = dimension
        };
        var all = new CubeLevel
        {
            Name = "(All)", UniqueName = $"{hierarchy.UniqueName}.[(All)]", Caption = "(All)", Number = 0,
            Hierarchy = hierarchy
        };
        hierarchy.AllMember = new CubeMember
        {
            UniqueName = $"{hierarchy.UniqueName}.[All]", Caption = "All", Level = all, Contains = _ => true
        };
        all.Members.Add(hierarchy.AllMember);
        hierarchy.Levels.Add(all);
        dimension.Hierarchies.Add(hierarchy);
        return (dimension, hierarchy);
    }

    // One level of text values, its members in the culture's order.
    private CubeDimension Attribute(string dimensionName, string hierarchyName, Func<SalesRecord, string> value)
    {
        var (dimension, hierarchy) = NewHierarchy(dimensionName, hierarchyName, 3);
        var level = new CubeLevel
        {
            Name = hierarchyName, UniqueName = $"{hierarchy.UniqueName}.{Bracket(hierarchyName)}",
            Caption = hierarchyName, Number = 1, Hierarchy = hierarchy
        };
        var compare = Culture.CompareInfo;
        foreach (var key in Records.Select(value).Distinct()
                     .Order(Comparer<string>.Create((left, right) => compare.Compare(left, right, CompareOptions.IgnoreCase))))
        {
            level.Members.Add(new CubeMember
            {
                UniqueName = $"{level.UniqueName}.&{Bracket(key)}",
                Caption = key,
                Level = level,
                Parent = hierarchy.AllMember,
                Contains = record => value(record) == key
            });
        }

        hierarchy.Levels.Add(level);
        return dimension;
    }

    private CubeDimension Calendar()
    {
        var (dimension, hierarchy) = NewHierarchy("Order Date", "Calendar", 1);
        CubeLevel Level(string name, int number) => new()
        {
            Name = name, UniqueName = $"{hierarchy.UniqueName}.{Bracket(name)}", Caption = name, Number = number,
            Hierarchy = hierarchy
        };

        var years = Level("Year", 1);
        var quarters = Level("Quarter", 2);
        var months = Level("Month", 3);
        var monthNames = Culture.DateTimeFormat.MonthNames;

        foreach (var year in Records.Select(record => record.OrderDate.Year).Distinct().Order())
        {
            var yearMember = new CubeMember
            {
                UniqueName = $"{years.UniqueName}.&[{year}]", Caption = year.ToString(CultureInfo.InvariantCulture),
                Level = years, Parent = hierarchy.AllMember, Contains = record => record.OrderDate.Year == year
            };
            years.Members.Add(yearMember);

            var inYear = Records.Where(record => record.OrderDate.Year == year).ToArray();
            foreach (var quarter in inYear.Select(record => (record.OrderDate.Month - 1) / 3 + 1).Distinct().Order())
            {
                var quarterMember = new CubeMember
                {
                    UniqueName = $"{quarters.UniqueName}.&[{year}]&[{quarter}]", Caption = $"Q{quarter}",
                    Level = quarters, Parent = yearMember,
                    Contains = record => record.OrderDate.Year == year && (record.OrderDate.Month - 1) / 3 + 1 == quarter
                };
                quarters.Members.Add(quarterMember);

                foreach (var month in inYear.Select(record => record.OrderDate.Month)
                             .Where(month => (month - 1) / 3 + 1 == quarter).Distinct().Order())
                {
                    months.Members.Add(new CubeMember
                    {
                        UniqueName = $"{months.UniqueName}.&[{year}]&[{month}]", Caption = monthNames[month - 1],
                        Level = months, Parent = quarterMember,
                        Contains = record => record.OrderDate.Year == year && record.OrderDate.Month == month
                    });
                }
            }
        }

        hierarchy.Levels.AddRange([years, quarters, months]);

        // What a quarter or a month means across years -- every year's Q1 -- is
        // an attribute hierarchy of its own in a cube, as it is here.
        PartOfYear(dimension, "Quarter of Year", record => (record.OrderDate.Month - 1) / 3 + 1, quarter => $"Q{quarter}");
        PartOfYear(dimension, "Month of Year", record => record.OrderDate.Month, month => monthNames[month - 1]);
        return dimension;
    }

    private void PartOfYear(CubeDimension dimension, string name, Func<SalesRecord, int> part, Func<int, string> caption)
    {
        var (_, hierarchy) = NewHierarchy(dimension.Name, name, 1, dimension);
        var level = new CubeLevel
        {
            Name = name, UniqueName = $"{hierarchy.UniqueName}.{Bracket(name)}", Caption = name, Number = 1,
            Hierarchy = hierarchy
        };
        foreach (var key in Records.Select(part).Distinct().Order())
        {
            level.Members.Add(new CubeMember
            {
                UniqueName = $"{level.UniqueName}.&[{key}]", Caption = caption(key), Level = level,
                Parent = hierarchy.AllMember, Contains = record => part(record) == key
            });
        }

        hierarchy.Levels.Add(level);
    }
}
