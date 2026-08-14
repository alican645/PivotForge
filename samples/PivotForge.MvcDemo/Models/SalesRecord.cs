namespace PivotForge.MvcDemo.Models;

public sealed record SalesRecord(
    string Region,
    string Category,
    string SalesPerson,
    int Year,
    string Quarter,
    decimal Amount,
    int Quantity,
    decimal Discount);
