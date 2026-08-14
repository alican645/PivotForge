namespace PivotForge.MvcDemo.Models;

public static class SampleSalesData
{
    private static readonly string[] Regions =
    [
        "Marmara",
        "Ege",
        "Akdeniz",
        "İç Anadolu",
        "Karadeniz",
        "Doğu Anadolu"
    ];

    private static readonly string[] Categories =
    [
        "Beton",
        "Çimento",
        "Agrega",
        "Katkı"
    ];

    private static readonly string[] People =
    [
        "Alican",
        "Deniz",
        "Mert",
        "Selin",
        "Ece"
    ];

    public static IReadOnlyList<SalesRecord> Create(int count = 100)
    {
        var records = new List<SalesRecord>(count);

        for (var index = 0; index < count; index++)
        {
            var region = Regions[index % Regions.Length];
            var category = Categories[(index / 2) % Categories.Length];
            var person = People[(index / 3) % People.Length];
            var year = 2024 + (index % 3);
            var quarter = $"Ç{(index % 4) + 1}";
            var amount = 18000m + (index * 1375m) + ((index % 7) * 425m);
            var quantity = 5 + ((index * 3) % 44);
            var discount = (index % 6) * 175m;

            records.Add(new SalesRecord(region, category, person, year, quarter, amount, quantity, discount));
        }

        return records;
    }
}
