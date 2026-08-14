const assert = require("node:assert/strict");
const test = require("node:test");
const drillDown = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-drill-down.js");

const columns = [
  { key: "region", label: "Bölge" },
  { key: "category", label: "Kategori" },
  { key: "amount", label: "Tutar", format: value => `₺${value}` }
];
const records = [
  { region: "Marmara", category: "Beton", amount: 100 },
  { region: "Marmara", category: "Çimento", amount: 200 },
  { region: "Ege", category: "Beton", amount: 300 }
];

test("global search and column filters combine with AND semantics", () => {
  const filters = { region: new Set(["Marmara"]) };

  assert.deepEqual(
    drillDown.filterRecords(records, columns, "beton", filters),
    [records[0]]
  );
});

test("distinct values are unique and locale sorted", () => {
  assert.deepEqual(drillDown.distinctValues(records, columns[1]), ["Beton", "Çimento"]);
});

test("CSV export contains only supplied records in display order", () => {
  const csv = drillDown.toCsv([records[1]], columns);

  assert.equal(csv, "\uFEFFBölge,Kategori,Tutar\nMarmara,Çimento,₺200");
});
