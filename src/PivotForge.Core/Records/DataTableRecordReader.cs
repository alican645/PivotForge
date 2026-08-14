using System.Data;

namespace PivotForge.Core.Records;

internal sealed class DataTableRecordReader : IRecordReader
{
    private readonly DataTable _table;
    private readonly Dictionary<string, int> _columns;

    public DataTableRecordReader(DataTable table)
    {
        _table = table;
        _columns = table.Columns
            .Cast<DataColumn>()
            .Select((column, index) => new { column.ColumnName, Index = index })
            .ToDictionary(item => item.ColumnName, item => item.Index, StringComparer.OrdinalIgnoreCase);
    }

    public bool HasField(string field) => _columns.ContainsKey(field);

    public object? GetValue(object record, string field)
    {
        if (!_columns.TryGetValue(field, out var index))
        {
            throw new PivotFieldNotFoundException(field);
        }

        var value = ((DataRow)record)[index];
        return value == DBNull.Value ? null : value;
    }
}
