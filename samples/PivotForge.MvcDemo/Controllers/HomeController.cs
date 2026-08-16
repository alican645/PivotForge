using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using PivotForge.MvcDemo.Models;

namespace PivotForge.MvcDemo.Controllers;

public sealed class HomeController : Controller
{
    public IActionResult Index() => View(SampleSalesData.Create());

    // Both declarative surfaces render the same grid from the same data, so the
    // two views can be compared line by line.
    public IActionResult HtmlHelper() => View(SampleSalesData.Create());

    public IActionResult TagHelpers() => View(SampleSalesData.Create());

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error() =>
        View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
}
