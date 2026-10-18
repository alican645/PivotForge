using System.Globalization;
using System.Text.Json.Serialization;
using PivotForge.AspNetCore.DependencyInjection;
using PivotForge.AspNetCore.Endpoints;
using PivotForge.MvcDemo.Models;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllersWithViews()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });
builder.Services.AddPivotForge<SalesRecord>(
    (request, _) => ValueTask.FromResult<IReadOnlyList<SalesRecord>>(
        SampleSalesData.Create(request.SourceRowCount ?? 100)),
    // What the endpoints may read. The source record also carries CustomerEmail,
    // which no report needs: leaving it off means the browser can neither pivot on
    // it nor receive it in a drill-down, whatever it asks for.
    options =>
    {
        options.AllowedFields.UnionWith(
        [
            "Region", "Category", "SalesPerson", "Year", "Quarter",
            "OrderDate", "Amount", "Quantity", "Discount"
        ]);

        // Callable from any calculated field's formula, declared or typed into the
        // designer: Median([Amount]).
        options.CustomAggregates["Median"] = values =>
        {
            var sorted = values.Order().ToArray();
            var middle = sorted.Length / 2;
            return sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        };

        // A row or column field can name it as its sorting method:
        // <pivot-field field="Region" area="Row" sorting-method="coastalFirst" />.
        string[] coastalFirst = ["Karadeniz", "Marmara", "Ege", "Akdeniz", "İç Anadolu", "Doğu Anadolu"];
        options.CustomSorts["coastalFirst"] = Comparer<string?>.Create((left, right) =>
            Rank(left).CompareTo(Rank(right)));

        int Rank(string? region) =>
            Array.IndexOf(coastalFirst, region) is var rank and >= 0 ? rank : coastalFirst.Length;

        // Fields whose value is worked out from the whole record:
        // <pivot-field field="FiscalYear" area="Column" selector="fiscalYear" />.
        // The fiscal year starts in October.
        options.CustomSelectors["fiscalYear"] = record =>
            ((SalesRecord)record.Source).OrderDate is var date && date.Month >= 10 ? date.Year + 1 : date.Year;
        options.CustomSelectors["orderSize"] = record =>
            (decimal)record["Amount"]! >= 100_000m ? "Büyük" : "Küçük";
    });

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

// A Turkish app pins its culture; PivotForge reads it twice over. Server-side row
// labels collate with CurrentCulture, and <pivot-grid> derives locale="tr" from
// CurrentUICulture, which is what puts the Turkish locale pack on screen without any
// grid saying so.
var turkish = new CultureInfo("tr-TR");
app.UseRequestLocalization(new RequestLocalizationOptions
{
    DefaultRequestCulture = new Microsoft.AspNetCore.Localization.RequestCulture(turkish, turkish),
    SupportedCultures = [turkish],
    SupportedUICultures = [turkish]
});

app.UseRouting();
app.UseStaticFiles();

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");
app.MapPivotForgeEndpoints();


app.Run();
