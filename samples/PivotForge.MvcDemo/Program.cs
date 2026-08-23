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
        SampleSalesData.Create(request.SourceRowCount ?? 100)));

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
