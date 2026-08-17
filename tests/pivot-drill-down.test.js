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

test("createFormatter returns null when no format is declared", () => {
  assert.equal(drillDown.createFormatter(null), null);
  assert.equal(drillDown.createFormatter(undefined), null);
});

// These pin a culture because what is under test is the format — decimals,
// grouping, currency, percent — not the locale. The locale is asserted
// separately below, precisely because it used to be hard-coded to tr-TR and
// every other reader silently got Turkish separators.
test("createFormatter honours decimals and grouping", () => {
  const format = drillDown.createFormatter(
    { type: "number", decimals: 0, useGrouping: true }, "tr-TR");

  assert.equal(format(1234567.89), "1.234.568");
});

test("createFormatter formats in the reader's own locale unless one is pinned", () => {
  const declared = { type: "number", decimals: 2, useGrouping: true };

  assert.equal(drillDown.createFormatter(declared, "tr-TR")(1234.5), "1.234,50");
  assert.equal(drillDown.createFormatter(declared, "en-US")(1234.5), "1,234.50");
  // No culture means Intl decides, which is the reader's own locale.
  assert.equal(
    drillDown.createFormatter(declared)(1234.5),
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true
    }).format(1234.5));
});

test("createFormatter can switch grouping off", () => {
  const format = drillDown.createFormatter(
    { type: "number", decimals: 0, useGrouping: false }, "tr-TR");

  assert.equal(format(1234567), "1234567");
});

test("createFormatter renders the declared currency", () => {
  const format = drillDown.createFormatter(
    { type: "currency", decimals: 0, currency: "TRY" }, "tr-TR");

  assert.match(format(1500), /1\.500/);
  assert.match(format(1500), /₺/);
});

test("createFormatter treats percent values as whole numbers, like the renderer", () => {
  const format = drillDown.createFormatter({ type: "percent", decimals: 1 }, "tr-TR");

  assert.match(format(12.5), /12,5/);
  assert.match(format(12.5), /%/);
});

test("createFormatter passes non-numeric values through untouched", () => {
  const format = drillDown.createFormatter({ type: "number", decimals: 2 }, "tr-TR");

  assert.equal(format("Marmara"), "Marmara");
  assert.equal(format(null), "");
  assert.equal(format(undefined), "");
});
