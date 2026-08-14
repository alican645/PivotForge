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

app.UseRouting();
app.UseStaticFiles();

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");
app.MapPivotForgeEndpoints();


app.Run();
