const assert = require("node:assert/strict");
const test = require("node:test");

const builder = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
const PivotLayoutState = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-layout-state.js");

const catalog = [
  { dataField: "Region", caption: "Bölge", area: "row" },
  { dataField: "Amount", caption: "Tutar", area: "data" },
  { dataField: "Quantity", caption: "Miktar", area: "available", role: "measure" },
  { dataField: "UnitPrice", caption: "Birim Fiyat", area: "available", expression: "[Amount] / [Quantity]" }
];

// --- The formula reader ---------------------------------------------------

test("a formula lists the fields it reads, each once", () => {
  assert.deepEqual(
    builder.parseExpression("Sum([Amount]) - [Cost] + max([amount]) / 2").fields,
    ["Amount", "Cost"]);
});

test("a formula that cannot be read says why and where", () => {
  const cases = [
    ["", "empty", 0],
    ["[Amount] -", "end", 10],
    ["([Amount]", "end", 9],
    ["[Amount", "unclosed", 0],
    ["Amount", "bareWord", 0],
    ["Sum(Amount)", "argument", 4],
    ["[Amount] $ 2", "unexpected", 9],
    ["[]", "emptyReference", 0],
    ["1..2", "number", 0]
  ];

  cases.forEach(([text, code, position]) => {
    assert.throws(
      () => builder.parseExpression(text),
      error => error.code === code && error.position === position,
      `${JSON.stringify(text)} should fail with ${code} at ${position}`);
  });
});

test("the grammar accepts what the server's does", () => {
  ["-2 + 3 * (1.5 - [Cost] / 10) - -1", "Avg([A]) + Average([A]) * .5", "Median([A])", "+5"]
    .forEach(text => assert.doesNotThrow(() => builder.parseExpression(text), text));
});

// --- The request ----------------------------------------------------------

test("a data field with an expression is calculated and travels with its formula", () => {
  const request = builder.buildRequest([
    { dataField: "Region", area: "row" },
    { dataField: "Profit", expression: "[Revenue] - [Cost]", showAs: "percentOfGrandTotal" }
  ]);

  assert.deepEqual(request.values, [{
    field: "Profit",
    aggregation: "calculated",
    showAs: "percentOfGrandTotal",
    expression: "[Revenue] - [Cost]"
  }]);
});

test("its value key is the name and the calculated aggregation", () => {
  const [field] = builder.normalizeFields([{ dataField: "Profit", expression: "[A] - [B]" }]);
  assert.equal(builder.valueKey(field), "Profit_calculated");
});

test("a plain value carries no expression member", () => {
  const request = builder.buildRequest([{ dataField: "Amount" }]);
  assert.equal("expression" in request.values[0], false);
});

test("a calculated field in the field list is a measure without saying so", () => {
  const [field] = builder.normalizeFields([{ dataField: "P", area: "available", expression: "[A]" }]);
  assert.equal(field.role, "measure");
});

test("an expression is refused outside the data area, beside an aggregation, or unreadable", () => {
  assert.throws(() => builder.normalizeFields([{ dataField: "P", area: "row", expression: "[A]" }]),
    /only valid on a "data" field/);
  assert.throws(() => builder.normalizeFields([{ dataField: "P", expression: "[A]", aggregation: "sum" }]),
    /both "expression" and "aggregation"/);
  assert.throws(() => builder.normalizeFields([{ dataField: "P", expression: "[A" }]),
    /Formula of field "P" is not valid/);
  assert.throws(() => builder.normalizeFields([{ dataField: "P", aggregation: "calculated" }]),
    /Unknown aggregation "calculated"/);
});

// --- The layout -----------------------------------------------------------

test("a declared calculated field is placed with the calculated aggregation", () => {
  const state = new PivotLayoutState(catalog);
  state.move("UnitPrice", "data");

  assert.deepEqual(state.getState().values[1], {
    field: "UnitPrice", aggregation: "calculated", showAs: "normal"
  });
  assert.deepEqual(state.toFields().find(field => field.dataField === "UnitPrice"), {
    dataField: "UnitPrice",
    expression: "[Amount] / [Quantity]",
    caption: "Birim Fiyat",
    area: "data",
    aggregation: "calculated",
    showAs: "normal",
    format: null,
    visible: true
  });
});

test("a calculated field keeps its formula as its aggregation", () => {
  const state = new PivotLayoutState(catalog);
  state.move("UnitPrice", "data");

  assert.throws(() => state.setAggregation("UnitPrice", "sum"), /formula is its aggregation/);
});

test("a calculated field cannot be seated as a dimension", () => {
  const state = new PivotLayoutState(catalog);
  assert.equal(state.canDrop("UnitPrice", "row"), false);
  assert.equal(state.canDrop("UnitPrice", "data"), true);
});

test("the formula can name every source field but no calculated one", () => {
  const state = new PivotLayoutState(catalog);
  assert.deepEqual(state.formulaFields().map(field => field.dataField), ["Region", "Amount", "Quantity"]);
});

test("the reader defines a calculated field and it lands in the data area", () => {
  const state = new PivotLayoutState(catalog);
  let changes = 0;
  state.on("change", () => changes++);

  const name = state.addCalculatedField({ caption: " Kâr ", expression: "[Amount] - [Quantity]" });

  assert.equal(name, "calculated1");
  assert.equal(changes, 1);
  assert.equal(state.field(name).caption, "Kâr");
  assert.equal(state.isUserCalculated(name), true);
  assert.equal(state.isUserCalculated("UnitPrice"), false);
  assert.deepEqual(state.getState().values.map(value => value.field), ["Amount", "calculated1"]);

  const request = builder.buildRequest(state.toFields());
  assert.deepEqual(request.values[1], {
    field: "calculated1", aggregation: "calculated", showAs: "normal", expression: "[Amount] - [Quantity]"
  });
});

test("a formula naming a field the list does not have is refused before it is stored", () => {
  const state = new PivotLayoutState(catalog);

  assert.throws(
    () => state.addCalculatedField({ caption: "X", expression: "[Amount] - [Cost]" }),
    error => error.code === "unknownField" && error.detail === "Cost" && error.position === 11);
  assert.throws(
    () => state.addCalculatedField({ caption: "X", expression: "[UnitPrice] * 2" }),
    error => error.code === "unknownField");
  assert.throws(
    () => state.addCalculatedField({ caption: "  ", expression: "[Amount]" }),
    error => error.code === "noName");
  assert.equal(state.getState().values.length, 1);
});

test("a new name never takes one the page declared", () => {
  const state = new PivotLayoutState([
    ...catalog,
    { dataField: "calculated1", caption: "Declared", area: "available", role: "measure" }
  ]);

  assert.equal(state.addCalculatedField({ caption: "X", expression: "[Amount]" }), "calculated2");
});

test("the reader's formula can be changed, and their field deleted", () => {
  const state = new PivotLayoutState(catalog);
  const name = state.addCalculatedField({ caption: "Kâr", expression: "[Amount]" });

  state.setExpression(name, "[Amount] * 2");
  assert.equal(state.field(name).expression, "[Amount] * 2");

  state.deleteCalculatedField(name);
  assert.equal(state.catalog.has(name), false);
  assert.deepEqual(state.getState().values.map(value => value.field), ["Amount"]);
  assert.deepEqual(state.getState().calculatedFields, []);
});

test("a declared calculated field is the page's to change", () => {
  const state = new PivotLayoutState(catalog);

  assert.throws(() => state.setExpression("UnitPrice", "[Amount]"), /not a calculated field defined/);
  assert.throws(() => state.deleteCalculatedField("UnitPrice"), /not a calculated field defined/);
});

test("the last value cannot be deleted from under the grid", () => {
  const state = new PivotLayoutState(catalog);
  const name = state.addCalculatedField({ caption: "Kâr", expression: "[Amount]" });
  state.remove("Amount");

  assert.throws(() => state.deleteCalculatedField(name), /last field in the data area/);
});

test("a saved view brings the reader's fields back, placed", () => {
  const state = new PivotLayoutState(catalog);
  const name = state.addCalculatedField({ caption: "Kâr", expression: "[Amount] - [Quantity]" });
  state.setCaption(name, "Net Kâr");
  const saved = JSON.parse(JSON.stringify(state.getState()));

  assert.deepEqual(saved.calculatedFields, [{ name, caption: "Kâr", expression: "[Amount] - [Quantity]" }]);

  const restored = new PivotLayoutState(catalog, saved);
  assert.equal(restored.field(name).caption, "Net Kâr");
  assert.equal(restored.isUserCalculated(name), true);
  assert.deepEqual(restored.getState().values, saved.values);
});

test("a saved field that no longer makes sense is skipped", () => {
  const restored = new PivotLayoutState(catalog, {
    rows: ["Region"],
    values: [{ field: "Amount", aggregation: "sum" }],
    calculatedFields: [
      { name: "calculated1", caption: "Gone", expression: "[Dropped] * 2" },
      { name: "Amount", caption: "Clash", expression: "[Amount]" },
      { name: "calculated2", caption: "", expression: "[Amount]" },
      { name: "calculated3", caption: "Kept", expression: "[Amount]" }
    ]
  });

  assert.deepEqual(restored.getState().calculatedFields.map(field => field.name), ["calculated3"]);
  assert.equal(restored.field("Amount").caption, "Tutar");
});

test("an adopted layout cannot give a calculated field another aggregation", () => {
  assert.throws(() => new PivotLayoutState(catalog, {
    values: [{ field: "UnitPrice", aggregation: "sum" }]
  }), /unknown aggregation "sum"/);

  const adopted = new PivotLayoutState(catalog, { values: [{ field: "UnitPrice" }] });
  assert.equal(adopted.getState().values[0].aggregation, "calculated");
});
