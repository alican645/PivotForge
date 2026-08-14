namespace PivotForge.Core.Records;

internal interface IRecordReader
{
    bool HasField(string field);

    object? GetValue(object record, string field);
}
