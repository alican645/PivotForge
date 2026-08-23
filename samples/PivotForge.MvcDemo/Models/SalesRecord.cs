namespace PivotForge.MvcDemo.Models;

public sealed record SalesRecord(
    string Region,
    string Category,
    string SalesPerson,
    int Year,
    string Quarter,
    // The column a year/quarter/month hierarchy is built from. Year and Quarter
    // stay as they are: they are what the other demo pages declare, and keeping
    // both side by side is what shows group-interval replacing them.
    DateTime OrderDate,
    decimal Amount,
    int Quantity,
    decimal Discount);
