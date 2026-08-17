using System.Data;
using System.Globalization;
using PivotForge.Core;
using PivotForge.Core.Records;

namespace PivotForge.Core.Tests;

public sealed class PivotEngineTests
{
    // In Turkish Ç is a letter of its own, sorting after every word that starts
    // with C. Elsewhere it is a variant of C, so the letters after it decide.
    // "Cx" and "Ça" therefore swap places between the two — which is exactly the
    // difference a hard-coded tr-TR hid from every other consumer.
    private static readonly Order[] TurkishLabels =
    [
        new Order("Zonguldak", 2026, "A", 1m),
        new Order("Çanakkale", 2026, "A", 2m),
        new Order("Corum", 2026, "A", 3m)
    ];

    private static readonly PivotRequest LabelRequest = new()
    {
        Rows = ["Region"],
        Values = [PivotValueDefinition.Sum("Amount")]
    };

    private static string[] RowLabels(PivotResult result)
        => result.RowHeaders.Select(header => header[0]!).ToArray();

    [Fact]
    public void Execute_CollatesRowLabels_WithTheCultureItWasGiven()
    {
        var turkish = new PivotEngine(CultureInfo.GetCultureInfo("tr-TR"))
            .Execute(TurkishLabels, LabelRequest);
        var english = new PivotEngine(CultureInfo.GetCultureInfo("en-US"))
            .Execute(TurkishLabels, LabelRequest);

        Assert.Equal(["Corum", "Çanakkale", "Zonguldak"], RowLabels(turkish));
        Assert.Equal(["Çanakkale", "Corum", "Zonguldak"], RowLabels(english));
    }

    [Fact]
    public void Execute_CollatesRowLabels_WithTheAmbientCultureByDefault()
    {
        var original = CultureInfo.CurrentCulture;

        try
        {
            // Resolved per call rather than cached, so a request-scoped culture —
            // which is what ASP.NET's request localization sets — is honoured.
            var engine = new PivotEngine();

            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("tr-TR");
            Assert.Equal(
                ["Corum", "Çanakkale", "Zonguldak"],
                RowLabels(engine.Execute(TurkishLabels, LabelRequest)));

            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
            Assert.Equal(
                ["Çanakkale", "Corum", "Zonguldak"],
                RowLabels(engine.Execute(TurkishLabels, LabelRequest)));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Execute_CollatesAnExplicitLabelSort_WithTheSameCulture()
    {
        // A declared RowLabel sort takes a different path through the engine than
        // the default ordering does, and used to carry its own hard-coded tr-TR.
        var request = new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            RowSort = PivotSort.RowLabel("Region", PivotSortDirection.Ascending)
        };

        var turkish = new PivotEngine(CultureInfo.GetCultureInfo("tr-TR"))
            .Execute(TurkishLabels, request);
        var english = new PivotEngine(CultureInfo.GetCultureInfo("en-US"))
            .Execute(TurkishLabels, request);

        Assert.Equal(["Corum", "Çanakkale", "Zonguldak"], RowLabels(turkish));
        Assert.Equal(["Çanakkale", "Corum", "Zonguldak"], RowLabels(english));
    }

    [Fact]
    public void Execute_RefusesANullCulture()
    {
        Assert.Throws<ArgumentNullException>(() => new PivotEngine(null!));
    }

    [Fact]
    public void DistinctValues_OrdersThePickerListInTheReadersCulture()
    {
        var turkish = new PivotEngine(CultureInfo.GetCultureInfo("tr-TR"))
            .DistinctValues(TurkishLabels, "Region");
        var english = new PivotEngine(CultureInfo.GetCultureInfo("en-US"))
            .DistinctValues(TurkishLabels, "Region");

        // The picker shows this list to a person, so it is sorted the way that
        // person reads rather than by code point.
        Assert.Equal(["Corum", "Çanakkale", "Zonguldak"], turkish);
        Assert.Equal(["Çanakkale", "Corum", "Zonguldak"], english);
    }

    // Deliberately arriving in neither alphabetical nor chronological order, so
    // "sorted" and "as observed" can never be confused for one another.
    private static readonly Order[] NestedOrders =
    [
        new Order("West", 2026, "Alpha", 1m),
        new Order("West", 2024, "Beta", 2m),
        new Order("East", 2025, "Beta", 4m),
        new Order("East", 2026, "Alpha", 8m)
    ];

    private static string[] RowPaths(PivotResult result)
        => result.RowHeaders.Select(header => string.Join("/", header)).ToArray();

    private static string[] ColumnPaths(PivotResult result)
        => result.ColumnHeaders.Select(header => string.Join("/", header)).ToArray();

    [Fact]
    public void Execute_ReversesADeclaredRowLevel_WithoutBreakingTheHierarchy()
    {
        PivotRequest Request(params PivotFieldSort[] fieldSorts) => new()
        {
            Rows = ["Region", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = fieldSorts
        };

        var engine = new PivotEngine(CultureInfo.InvariantCulture);

        Assert.Equal(
            ["East/Alpha", "East/Beta", "West/Alpha", "West/Beta"],
            RowPaths(engine.Execute(NestedOrders, Request())));

        // The reversal happens inside each parent group: the regions keep their
        // own ascending order and their children stay together underneath them.
        Assert.Equal(
            ["East/Beta", "East/Alpha", "West/Beta", "West/Alpha"],
            RowPaths(engine.Execute(
                NestedOrders, Request(new PivotFieldSort("Category", PivotSortDirection.Descending)))));

        Assert.Equal(
            ["West/Alpha", "West/Beta", "East/Alpha", "East/Beta"],
            RowPaths(engine.Execute(
                NestedOrders, Request(new PivotFieldSort("Region", PivotSortDirection.Descending)))));
    }

    [Fact]
    public void Execute_PrefersAnExplicitRowSort_OverTheDeclaredLevelOrder()
    {
        // Clicking a header is a decision the user just made; the declaration is
        // one the view author made months ago.
        var result = new PivotEngine(CultureInfo.InvariantCulture).Execute(NestedOrders, new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Region", PivotSortDirection.Descending)],
            RowSort = PivotSort.RowLabel("Region", PivotSortDirection.Ascending)
        });

        Assert.Equal(["East", "West"], RowPaths(result));
    }

    [Fact]
    public void Execute_LeavesAnUndeclaredColumnLevel_InTheOrderItArrived()
    {
        // Sorting these silently would destroy an order the query may have chosen
        // on purpose — month names ordered by month number, say.
        var result = new PivotEngine(CultureInfo.InvariantCulture).Execute(NestedOrders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Equal(["2026", "2024", "2025"], ColumnPaths(result));
    }

    [Fact]
    public void Execute_OrdersADeclaredColumnLevel()
    {
        PivotResult Execute(PivotSortDirection direction) =>
            new PivotEngine(CultureInfo.InvariantCulture).Execute(NestedOrders, new PivotRequest
            {
                Rows = ["Region"],
                Columns = ["Year"],
                Values = [PivotValueDefinition.Sum("Amount")],
                FieldSorts = [new PivotFieldSort("Year", direction)]
            });

        Assert.Equal(["2024", "2025", "2026"], ColumnPaths(Execute(PivotSortDirection.Ascending)));
        Assert.Equal(["2026", "2025", "2024"], ColumnPaths(Execute(PivotSortDirection.Descending)));
    }

    [Fact]
    public void Execute_OrdersOnlyTheDeclaredLevel_OfANestedColumnAxis()
    {
        var result = new PivotEngine(CultureInfo.InvariantCulture).Execute(NestedOrders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Descending)]
        });

        // The years stay as observed (2026 arrived first) while the categories
        // reverse — and Beta first is the opposite of the order they arrived in,
        // so this cannot pass by the declaration being applied to the wrong level.
        Assert.Equal(
            ["2026/Beta", "2026/Alpha", "2024/Beta", "2024/Alpha", "2025/Beta", "2025/Alpha"],
            ColumnPaths(result));
    }

    [Fact]
    public void Execute_CollatesADeclaredColumnLevel_WithTheCultureItWasGiven()
    {
        var orders = TurkishLabels
            .Select(order => new Order("East", order.Year, order.Region, order.Amount))
            .ToArray();
        var request = new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Category", PivotSortDirection.Ascending)]
        };

        Assert.Equal(
            ["Corum", "Çanakkale", "Zonguldak"],
            ColumnPaths(new PivotEngine(CultureInfo.GetCultureInfo("tr-TR")).Execute(orders, request)));
        Assert.Equal(
            ["Çanakkale", "Corum", "Zonguldak"],
            ColumnPaths(new PivotEngine(CultureInfo.GetCultureInfo("en-US")).Execute(orders, request)));
    }

    [Fact]
    public void Execute_IgnoresAFieldSortNamingAFieldThatIsNotOnThatAxis()
    {
        // A field can be dragged out of the row area while its declaration stays
        // behind; naming a column field here must not shift the row levels along.
        var result = new PivotEngine(CultureInfo.InvariantCulture).Execute(NestedOrders, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Values = [PivotValueDefinition.Sum("Amount")],
            FieldSorts = [new PivotFieldSort("Year", PivotSortDirection.Descending)]
        });

        Assert.Equal(["East/Alpha", "East/Beta", "West/Alpha", "West/Beta"], RowPaths(result));
    }

    [Fact]
    public void Execute_GroupsRowsAndColumns_WithSum()
    {
        var orders = new[]
        {
            new Order("East", 2026, "A", 100m),
            new Order("East", 2026, "A", 50m),
            new Order("West", 2026, "A", 25m),
            new Order("East", 2025, "B", 10m)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Equal(2, result.RowHeaders.Count);
        Assert.Equal(2, result.ColumnHeaders.Count);
        Assert.Equal(3, result.Cells.Count);
        Assert.Equal(185m, result.GrandTotals["Amount_sum"]);

        var east2026 = result.Cells.Single(cell => cell.Row == 0 && cell.Column == 0);
        Assert.Equal(150m, east2026.Values["Amount_sum"]);
    }

    [Fact]
    public void Execute_SupportsMultipleAggregations()
    {
        var orders = new[]
        {
            new Order("East", 2026, "A", 100m),
            new Order("East", 2026, "A", 50m),
            new Order("East", 2026, "A", null)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values =
            [
                PivotValueDefinition.Count("Amount"),
                PivotValueDefinition.Average("Amount"),
                PivotValueDefinition.Min("Amount"),
                PivotValueDefinition.Max("Amount")
            ]
        });

        var values = result.Cells.Single().Values;
        Assert.Equal(2m, values["Amount_count"]);
        Assert.Equal(75m, values["Amount_average"]);
        Assert.Equal(50m, values["Amount_min"]);
        Assert.Equal(100m, values["Amount_max"]);
    }

    [Fact]
    public void Execute_SupportsMultipleValueFieldsInOnePivot()
    {
        var sales = new[]
        {
            new Sale("East", 2026, 100m, 4, 10m),
            new Sale("East", 2026, 50m, 8, 20m),
            new Sale("West", 2026, 25m, 2, 5m)
        };

        var result = new PivotEngine().Execute(sales, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values =
            [
                PivotValueDefinition.Sum("Amount"),
                PivotValueDefinition.Average("Quantity"),
                PivotValueDefinition.Max("Discount")
            ]
        });

        var eastValues = result.Cells.Single(cell => cell.Row == 0 && cell.Column == 0).Values;
        Assert.Equal(150m, eastValues["Amount_sum"]);
        Assert.Equal(6m, eastValues["Quantity_average"]);
        Assert.Equal(20m, eastValues["Discount_max"]);

        Assert.Equal(175m, result.GrandTotals["Amount_sum"]);
        Assert.Equal(14m / 3m, result.GrandTotals["Quantity_average"]);
        Assert.Equal(20m, result.GrandTotals["Discount_max"]);
    }

    [Fact]
    public void Execute_AppliesFiltersBeforeGrouping()
    {
        var orders = new[]
        {
            new Order("East", 2026, "A", 100m),
            new Order("East", 2026, "B", 50m),
            new Order("West", 2026, "A", 25m),
            new Order("North", 2025, "A", 10m)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Region", ["East", "West"])]
        });

        Assert.Equal(3, result.Metadata.SourceRowCount);
        Assert.Equal(3, result.Metadata.RowHeaderCount);
        Assert.Equal(1, result.Metadata.ColumnHeaderCount);
        Assert.Equal(175m, result.GrandTotals["Amount_sum"]);
        Assert.DoesNotContain(result.RowHeaders, header => header.Contains("North"));
    }

    [Fact]
    public void Execute_CreatesCompleteColumnGridForNestedColumnFields()
    {
        var orders = new[]
        {
            new Order("Marmara", 2024, "Beton", 100m),
            new Order("Ege", 2025, "Beton", 50m),
            new Order("Akdeniz", 2024, "Çimento", 25m)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Category"],
            Columns = ["Year", "Region"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Equal(6, result.Metadata.ColumnHeaderCount);
        Assert.Equal(
            [
                ["2024", "Marmara"],
                ["2024", "Ege"],
                ["2024", "Akdeniz"],
                ["2025", "Marmara"],
                ["2025", "Ege"],
                ["2025", "Akdeniz"]
            ],
            result.ColumnHeaders);

        var beton = result.RowHeaders
            .Select((header, index) => new { Header = header, Index = index })
            .Single(item => item.Header.Single() == "Beton");
        var ege2025Column = result.ColumnHeaders
            .Select((header, index) => new { Header = header, Index = index })
            .Single(item => item.Header.SequenceEqual(["2025", "Ege"]))
            .Index;

        var ege2025 = result.Cells.Single(cell => cell.Row == beton.Index && cell.Column == ege2025Column);
        Assert.Equal(50m, ege2025.Values["Amount_sum"]);
    }

    [Fact]
    public void Execute_SortsRowsByLabel()
    {
        var orders = new[]
        {
            new Order("Marmara", 2024, "Beton", 100m),
            new Order("Ege", 2024, "Agrega", 50m),
            new Order("Akdeniz", 2024, "Çimento", 25m)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            RowSort = PivotSort.RowLabel("Category", PivotSortDirection.Descending)
        });

        Assert.Equal(["Çimento", "Beton", "Agrega"], result.RowHeaders.Select(header => header.Single()));
    }

    [Fact]
    public void Execute_SortsRowsByTotalValueDescending()
    {
        var orders = new[]
        {
            new Order("Marmara", 2024, "Beton", 100m),
            new Order("Ege", 2024, "Beton", 50m),
            new Order("Akdeniz", 2024, "Agrega", 500m),
            new Order("Marmara", 2024, "Çimento", 25m)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            RowSort = PivotSort.RowTotal("Amount_sum", PivotSortDirection.Descending)
        });

        Assert.Equal(["Agrega", "Beton", "Çimento"], result.RowHeaders.Select(header => header.Single()));

        var agregaCell = result.Cells.Single(cell => cell.Row == 0);
        Assert.Equal(500m, agregaCell.Values["Amount_sum"]);
    }

    [Fact]
    public void Execute_SortsRowsBySpecificColumnValueDescending()
    {
        var orders = new[]
        {
            new Order("Marmara", 2024, "Beton", 900m),
            new Order("Marmara", 2025, "Beton", 10m),
            new Order("Ege", 2024, "Agrega", 100m),
            new Order("Ege", 2025, "Agrega", 700m),
            new Order("Akdeniz", 2024, "Çimento", 500m),
            new Order("Akdeniz", 2025, "Çimento", 300m)
        };

        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            RowSort = PivotSort.RowColumnValue("Amount_sum", ["2025"], PivotSortDirection.Descending)
        });

        Assert.Equal(["Agrega", "Çimento", "Beton"], result.RowHeaders.Select(header => header.Single()));
    }

    [Fact]
    public void Execute_SupportsDataTable()
    {
        var table = new DataTable();
        table.Columns.Add("Region", typeof(string));
        table.Columns.Add("Year", typeof(int));
        table.Columns.Add("Amount", typeof(decimal));
        table.Rows.Add("East", 2026, 100m);
        table.Rows.Add("East", 2026, 40m);

        var result = new PivotEngine().Execute(table, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Equal(140m, result.Cells.Single().Values["Amount_sum"]);
    }

    [Fact]
    public void ExecuteRecords_SupportsJsonRecords()
    {
        var records = JsonRecordParser.Parse(
            """
            [
              { "region": "East", "year": 2026, "amount": 12.5 },
              { "region": "East", "year": 2026, "amount": 7.5 }
            ]
            """);

        var result = new PivotEngine().ExecuteRecords(records, new PivotRequest
        {
            Rows = ["region"],
            Columns = ["year"],
            Values = [PivotValueDefinition.Sum("amount")]
        });

        Assert.Equal(20m, result.Cells.Single().Values["amount_sum"]);
    }

    [Fact]
    public void ExecuteRecords_SupportsCsvRecords()
    {
        var records = CsvRecordParser.Parse(
            """
            region,year,amount
            East,2026,12.5
            East,2026,7.5
            """);

        var result = new PivotEngine().ExecuteRecords(records, new PivotRequest
        {
            Rows = ["region"],
            Columns = ["year"],
            Values = [PivotValueDefinition.Sum("amount")]
        });

        Assert.Equal(20m, result.Cells.Single().Values["amount_sum"]);
    }

    [Fact]
    public void Execute_ReturnsEmptyResultForEmptyData()
    {
        var result = new PivotEngine().Execute(Array.Empty<Order>(), new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Empty(result.RowHeaders);
        Assert.Empty(result.ColumnHeaders);
        Assert.Empty(result.Cells);
        Assert.Null(result.GrandTotals["Amount_sum"]);
        Assert.Equal(0, result.Metadata.SourceRowCount);
    }

    [Fact]
    public void Execute_ReturnsNoColumnHeaders_ForEmptyDataWithNoColumnFields()
    {
        // A pivot with no column axis has one implicit, nameless column, which the
        // header builder would happily produce out of nothing — leaving an empty
        // grid claiming a column it has no data for.
        var result = new PivotEngine().Execute(Array.Empty<Order>(), new PivotRequest
        {
            Rows = ["Region"],
            Values = [PivotValueDefinition.Sum("Amount")]
        });

        Assert.Empty(result.ColumnHeaders);
    }

    [Fact]
    public void Execute_ThrowsForMissingField()
    {
        var orders = new[] { new Order("East", 2026, "A", 100m) };

        Assert.Throws<PivotFieldNotFoundException>(() => new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Missing"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")]
        }));
    }

    [Fact]
    public void Execute_ThrowsForNonNumericSum()
    {
        var orders = new[] { new Order("East", 2026, "A", 100m) };

        Assert.Throws<PivotFieldTypeException>(() => new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Category")]
        }));
    }

    [Fact]
    public void DrillDown_MatchesRegularCellPaths()
    {
        var orders = CreateDrillDownOrders();
        var request = CreateDrillDownRequest();

        var records = new PivotEngine().DrillDown(orders, request, ["East", "A"], ["2026"]);

        Assert.Equal([100m, 50m], records.Select(record => record.Amount));
    }

    [Fact]
    public void DrillDown_UsesPrefixPathsForSubtotalsAndEmptyPathsForGrandTotals()
    {
        var orders = CreateDrillDownOrders();
        var request = CreateDrillDownRequest();
        var engine = new PivotEngine();

        var eastSubtotal = engine.DrillDown(orders, request, ["East"], []);
        var columnTotal = engine.DrillDown(orders, request, [], ["2026"]);
        var grandTotal = engine.DrillDown(orders, request, [], []);

        Assert.Equal(3, eastSubtotal.Count);
        Assert.Equal(4, columnTotal.Count);
        Assert.Equal(5, grandTotal.Count);
    }

    [Fact]
    public void DrillDown_CombinesPivotFiltersWithCellPaths()
    {
        var orders = CreateDrillDownOrders();
        var request = new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")],
            Filters = [new PivotFilter("Category", ["A"])]
        };

        var records = new PivotEngine().DrillDown(orders, request, [], []);

        Assert.Equal(3, records.Count);
        Assert.All(records, record => Assert.Equal("A", record.Category));
    }

    [Fact]
    public void DrillDown_RejectsPathsDeeperThanConfiguredFields()
    {
        var orders = CreateDrillDownOrders();

        Assert.Throws<ArgumentException>(() => new PivotEngine().DrillDown(
            orders,
            CreateDrillDownRequest(),
            ["East", "A", "Extra"],
            ["2026"]));
    }

    [Fact]
    public void DrillDown_SupportsDataTableAndDictionaryRecords()
    {
        var table = new DataTable();
        table.Columns.Add("Region", typeof(string));
        table.Columns.Add("Year", typeof(int));
        table.Columns.Add("Amount", typeof(decimal));
        table.Rows.Add("East", 2026, 100m);
        table.Rows.Add("West", 2026, 50m);
        var tableRequest = new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount")]
        };
        var dictionaryRecords = JsonRecordParser.Parse(
            """
            [
              { "region": "East", "year": 2026, "amount": 100 },
              { "region": "West", "year": 2026, "amount": 50 }
            ]
            """);
        var dictionaryRequest = new PivotRequest
        {
            Rows = ["region"],
            Columns = ["year"],
            Values = [PivotValueDefinition.Sum("amount")]
        };
        var engine = new PivotEngine();

        Assert.Single(engine.DrillDown(table, tableRequest, ["East"], ["2026"]));
        Assert.Single(engine.DrillDownRecords(dictionaryRecords, dictionaryRequest, ["West"], ["2026"]));
    }

    [Fact]
    public void DistinctValues_ReturnsEachValueOnceInValueOrder()
    {
        var orders = CreateDrillDownOrders();

        var regions = new PivotEngine().DistinctValues(orders, "Region");
        var years = new PivotEngine().DistinctValues(orders, "Year");

        Assert.Equal(["East", "West"], regions);
        Assert.Equal(["2025", "2026"], years);
    }

    [Fact]
    public void DistinctValues_OrdersNumbersByValueRatherThanText()
    {
        var orders = new[]
        {
            new Order("East", 2, "A", 1m),
            new Order("East", 10, "A", 1m),
            new Order("East", 1, "A", 1m)
        };

        var years = new PivotEngine().DistinctValues(orders, "Year");

        Assert.Equal(["1", "2", "10"], years);
    }

    // A null source value converts to the empty string on the filter path too,
    // so blank is offered as the value that actually selects those records.
    [Fact]
    public void DistinctValues_OffersBlankForNullsAndThatBlankFilters()
    {
        var orders = new[]
        {
            new Order("East", 2026, "A", 100m),
            new Order("East", 2026, "A", null)
        };
        var engine = new PivotEngine();

        Assert.Equal(["", "100"], engine.DistinctValues(orders, "Amount"));

        var blanks = engine.DrillDown(
            orders,
            new PivotRequest
            {
                Rows = ["Region"],
                Columns = ["Year"],
                Values = [PivotValueDefinition.Count("Amount")],
                Filters = [new PivotFilter("Amount", [""])]
            },
            [],
            []);

        Assert.Equal([null], blanks.Select(record => record.Amount));
    }

    // A picker is only useful if choosing what it shows actually filters, so the
    // strings it returns must be the strings the filter compares against.
    [Fact]
    public void DistinctValues_ReturnsTheSameStringsTheFilterMatchesOn()
    {
        var orders = CreateDrillDownOrders();
        var engine = new PivotEngine();

        foreach (var year in engine.DistinctValues(orders, "Year"))
        {
            var matches = engine.DrillDown(
                orders,
                new PivotRequest
                {
                    Rows = ["Region"],
                    Columns = ["Year"],
                    Values = [PivotValueDefinition.Sum("Amount")],
                    Filters = [new PivotFilter("Year", [year])]
                },
                [],
                []);

            Assert.NotEmpty(matches);
            Assert.All(matches, record => Assert.Equal(year, record.Year.ToString()));
        }
    }

    // The reader only discovers an unknown field while reading a record, so an
    // empty source would otherwise report "no values" for a field that is not
    // there at all — a picker would open blank instead of failing.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void DistinctValues_ThrowsForUnknownFieldEvenWithoutRecords(bool hasRecords)
    {
        var orders = hasRecords ? CreateDrillDownOrders() : [];

        Assert.Throws<PivotFieldNotFoundException>(
            () => new PivotEngine().DistinctValues(orders, "Missing"));
    }

    [Fact]
    public void DistinctValues_ThrowsForAnEmptyFieldName()
    {
        var orders = CreateDrillDownOrders();

        Assert.Throws<ArgumentException>(() => new PivotEngine().DistinctValues(orders, "  "));
    }

    [Fact]
    public void DistinctValues_SupportsDataTableAndDictionaryRecords()
    {
        var table = new DataTable();
        table.Columns.Add("Region", typeof(string));
        table.Rows.Add("West");
        table.Rows.Add("East");
        table.Rows.Add("East");
        var dictionaryRecords = JsonRecordParser.Parse(
            """
            [
              { "region": "West" },
              { "region": "East" },
              { "region": "East" }
            ]
            """);
        var engine = new PivotEngine();

        Assert.Equal(["East", "West"], engine.DistinctValues(table, "Region"));
        Assert.Equal(["East", "West"], engine.DistinctValuesRecords(dictionaryRecords, "region"));
    }

    [Fact]
    public void Execute_ShowAsPercentOfRowTotal_TransformsCellsAndTotals()
    {
        var result = ExecuteShowAs(PivotShowAs.PercentOfRowTotal);
        const string key = "Amount_sum";

        Assert.Equal(.25m, CellValue(result, "East", "2024", key));
        Assert.Equal(.75m, CellValue(result, "East", "2025", key));
        Assert.Equal(1m, RowTotalValue(result, "East", key));
        Assert.Equal(200m / 600m, ColumnTotalValue(result, "2024", key));
        Assert.Equal(1m, result.GrandTotals[key]);
    }

    [Fact]
    public void Execute_ShowAsPercentOfColumnTotal_TransformsCellsAndTotals()
    {
        var result = ExecuteShowAs(PivotShowAs.PercentOfColumnTotal);
        const string key = "Amount_sum";

        Assert.Equal(.5m, CellValue(result, "East", "2024", key));
        Assert.Equal(.75m, CellValue(result, "East", "2025", key));
        Assert.Equal(400m / 600m, RowTotalValue(result, "East", key));
        Assert.Equal(1m, ColumnTotalValue(result, "2024", key));
        Assert.Equal(1m, result.GrandTotals[key]);
    }

    [Fact]
    public void Execute_ShowAsPercentOfGrandTotal_HandlesZeroDenominators()
    {
        var result = ExecuteShowAs(PivotShowAs.PercentOfGrandTotal);
        const string key = "Amount_sum";

        Assert.Equal(100m / 600m, CellValue(result, "East", "2024", key));
        Assert.Equal(400m / 600m, RowTotalValue(result, "East", key));
        Assert.Equal(200m / 600m, ColumnTotalValue(result, "2024", key));
        Assert.Equal(1m, result.GrandTotals[key]);

        var zeroResult = new PivotEngine().Execute(
            new[] { new Order("East", 2024, "A", 0m) },
            new PivotRequest
            {
                Rows = ["Region"],
                Columns = ["Year"],
                Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentOfGrandTotal)]
            });

        Assert.Null(zeroResult.Cells.Single().Values[key]);
        Assert.Null(zeroResult.GrandTotals[key]);
    }

    [Fact]
    public void Execute_ShowAsPreviousPeriodDifference_UsesContinuousColumnOrder()
    {
        var orders = new[]
        {
            new PeriodOrder("East", 2024, "Q4", 100m),
            new PeriodOrder("East", 2025, "Q1", 150m),
            new PeriodOrder("West", 2024, "Q4", 100m),
            new PeriodOrder("West", 2025, "Q1", 50m)
        };

        var difference = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year", "Quarter"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.DifferenceFromPrevious)]
        });
        var percentDifference = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year", "Quarter"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.PercentDifferenceFromPrevious)]
        });

        Assert.Null(CellValue(difference, "East", ["2024", "Q4"], "Amount_sum"));
        Assert.Equal(50m, CellValue(difference, "East", ["2025", "Q1"], "Amount_sum"));
        Assert.Equal(.5m, CellValue(percentDifference, "East", ["2025", "Q1"], "Amount_sum"));
        Assert.All(percentDifference.RowTotals, total => Assert.Null(total.Values["Amount_sum"]));
        Assert.Null(percentDifference.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void Execute_ShowAsRunningTotal_CarriesAcrossMissingCells()
    {
        var orders = new[]
        {
            new Order("East", 2024, "A", 100m),
            new Order("West", 2025, "A", 20m),
            new Order("East", 2026, "A", 50m)
        };
        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.RunningTotal)]
        });

        Assert.Equal(100m, CellValue(result, "East", "2024", "Amount_sum"));
        Assert.Equal(100m, CellValue(result, "East", "2025", "Amount_sum"));
        Assert.Equal(150m, CellValue(result, "East", "2026", "Amount_sum"));
        Assert.Equal(150m, RowTotalValue(result, "East", "Amount_sum"));
        Assert.Equal(170m, result.GrandTotals["Amount_sum"]);
    }

    [Fact]
    public void Execute_ShowAsCalculatesAuthoritativeAverageTotalsAndSubtotals()
    {
        var orders = new[]
        {
            new ProductOrder("East", "A", 2024, 100m),
            new ProductOrder("East", "A", 2025, 10m),
            new ProductOrder("East", "A", 2025, 20m),
            new ProductOrder("East", "B", 2025, 30m)
        };
        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region", "Category"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Average("Amount").As(PivotShowAs.PercentOfRowTotal)]
        });
        var subtotal = Assert.Single(result.Subtotals);
        var normalResult = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Average("Amount")]
        });

        Assert.Equal(40m, normalResult.RowTotals.Single().Values["Amount_average"]);
        Assert.Equal("East", subtotal.RowHeader.Single());
        Assert.Equal(2.5m, subtotal.Cells.Single(cell => cell.Column == 0).Values["Amount_average"]);
        Assert.Equal(.5m, subtotal.Cells.Single(cell => cell.Column == 1).Values["Amount_average"]);
        Assert.Equal(1m, subtotal.Totals["Amount_average"]);
    }

    [Fact]
    public void Execute_ReturnsAuthoritativeAverageMinAndMaxAxisTotals()
    {
        var orders = new[]
        {
            new Order("East", 2024, "A", 100m),
            new Order("East", 2024, "A", 0m),
            new Order("East", 2025, "A", 30m),
            new Order("West", 2024, "A", 200m)
        };
        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values =
            [
                PivotValueDefinition.Average("Amount"),
                PivotValueDefinition.Min("Amount"),
                PivotValueDefinition.Max("Amount")
            ]
        });
        var east = result.RowTotals.Single(total => total.Index == 0).Values;
        var year2024 = result.ColumnTotals.Single(total => total.Index == 0).Values;

        Assert.Equal(130m / 3m, east["Amount_average"]);
        Assert.Equal(0m, east["Amount_min"]);
        Assert.Equal(100m, east["Amount_max"]);
        Assert.Equal(100m, year2024["Amount_average"]);
        Assert.Equal(0m, year2024["Amount_min"]);
        Assert.Equal(200m, year2024["Amount_max"]);
    }

    [Fact]
    public void Execute_ShowAsSortsByTransformedColumnValueAndPlacesNullLast()
    {
        var orders = new[]
        {
            new Order("A", 2024, "X", 100m),
            new Order("A", 2025, "X", 50m),
            new Order("B", 2024, "X", 10m),
            new Order("B", 2025, "X", 30m),
            new Order("C", 2025, "X", 90m)
        };
        var result = new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount").As(PivotShowAs.DifferenceFromPrevious)],
            RowSort = PivotSort.RowColumnValue("Amount_sum", ["2025"], PivotSortDirection.Descending)
        });

        Assert.Equal(["B", "A", "C"], result.RowHeaders.Select(header => header[0]!).ToArray());
    }

    private static PivotResult ExecuteShowAs(PivotShowAs showAs)
    {
        var orders = new[]
        {
            new Order("East", 2024, "A", 100m),
            new Order("East", 2025, "A", 300m),
            new Order("West", 2024, "A", 100m),
            new Order("West", 2025, "A", 100m)
        };

        return new PivotEngine().Execute(orders, new PivotRequest
        {
            Rows = ["Region"],
            Columns = ["Year"],
            Values = [PivotValueDefinition.Sum("Amount").As(showAs)]
        });
    }

    private static decimal? CellValue(PivotResult result, string row, string column, string key) =>
        CellValue(result, row, [column], key);

    private static decimal? CellValue(PivotResult result, string row, IReadOnlyList<string?> column, string key)
    {
        var rowIndex = result.RowHeaders
            .Select((header, index) => new { header, index })
            .Single(item => item.header[0] == row)
            .index;
        var columnIndex = result.ColumnHeaders
            .Select((header, index) => new { header, index })
            .Single(item => item.header.SequenceEqual(column))
            .index;

        return result.Cells.Single(cell => cell.Row == rowIndex && cell.Column == columnIndex).Values[key];
    }

    private static decimal? RowTotalValue(PivotResult result, string row, string key)
    {
        var rowIndex = result.RowHeaders
            .Select((header, index) => new { header, index })
            .Single(item => item.header[0] == row)
            .index;
        return result.RowTotals.Single(total => total.Index == rowIndex).Values[key];
    }

    private static decimal? ColumnTotalValue(PivotResult result, string column, string key)
    {
        var columnIndex = result.ColumnHeaders
            .Select((header, index) => new { header, index })
            .Single(item => item.header[0] == column)
            .index;
        return result.ColumnTotals.Single(total => total.Index == columnIndex).Values[key];
    }

    private static Order[] CreateDrillDownOrders() =>
    [
        new("East", 2026, "A", 100m),
        new("East", 2026, "A", 50m),
        new("East", 2025, "B", 25m),
        new("West", 2026, "A", 10m),
        new("West", 2026, "B", 5m)
    ];

    private static PivotRequest CreateDrillDownRequest() => new()
    {
        Rows = ["Region", "Category"],
        Columns = ["Year"],
        Values = [PivotValueDefinition.Sum("Amount")]
    };

    private sealed record Order(string Region, int Year, string Category, decimal? Amount);

    private sealed record Sale(string Region, int Year, decimal Amount, int Quantity, decimal Discount);

    private sealed record PeriodOrder(string Region, int Year, string Quarter, decimal Amount);

    private sealed record ProductOrder(string Region, string Category, int Year, decimal Amount);
}
