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
            // Month cycles fastest and the year turns over every twelve records, so
            // each year sees all twelve months -- deriving both from the same
            // modulus would tie a year to four of them.
            var month = (index % 12) + 1;
            var year = 2024 + ((index / 12) % 3);
            var orderDate = new DateTime(year, month, (index % 28) + 1);
            // Derived from the date rather than counted separately, so the two
            // columns cannot contradict each other.
            var quarter = $"Ç{((month - 1) / 3) + 1}";
            var amount = 18000m + (index * 1375m) + ((index % 7) * 425m);
            var quantity = 5 + ((index * 3) % 44);
            var discount = (index % 6) * 175m;

            records.Add(new SalesRecord(
                region, category, person, year, quarter, orderDate, amount, quantity, discount,
                $"musteri{index:D4}@ornek.test"));
        }

        return records;
    }
}
