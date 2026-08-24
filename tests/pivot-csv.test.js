const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-table.js");

const PivotForge = globalThis.PivotForge;

const cell = (text, overrides = {}) => ({ text, rowSpan: 1, columnSpan: 1, ...overrides });
const model = (...rows) => ({ rows: rows.map(cells => ({ cells })) });
const lines = csv => csv.split("\r\n");

test("a plain grid becomes one line per row", () => {
  const csv = PivotForge.toCsv(model(
    [cell("Bölge"), cell("Tutar")],
    [cell("Ege"), cell("1250")]));

  assert.deepEqual(lines(csv), ["Bölge,Tutar", "Ege,1250"]);
});

// RFC 4180 asks for CRLF, and a spreadsheet opening a bare-LF file on Windows
// can run the rows together.
test("lines are separated with CRLF", () => {
  const csv = PivotForge.toCsv(model([cell("a")], [cell("b")]));

  assert.equal(csv, "a\r\nb");
});

test("nothing rendered yields nothing rather than throwing", () => {
  assert.equal(PivotForge.toCsv(null), "");
  assert.equal(PivotForge.toCsv({}), "");
  assert.equal(PivotForge.toCsv({ rows: [] }), "");
});

test("a row with no cells is still a line, so the row count survives", () => {
  const csv = PivotForge.toCsv(model([cell("a")], [], [cell("b")]));

  assert.deepEqual(lines(csv), ["a", "", "b"]);
});

// --- Escaping -----------------------------------------------------------------

test("a field holding the delimiter is quoted", () => {
  const csv = PivotForge.toCsv(model([cell("Ege, Marmara"), cell("x")]));

  assert.equal(csv, '"Ege, Marmara",x');
});

test("a quote inside a field is doubled and the field quoted", () => {
  const csv = PivotForge.toCsv(model([cell('12" boru')]));

  assert.equal(csv, '"12"" boru"');
});

test("a line break inside a field is quoted rather than breaking the row", () => {
  assert.equal(PivotForge.toCsv(model([cell("iki\nsatır")])), '"iki\nsatır"');
  assert.equal(PivotForge.toCsv(model([cell("iki\r\nsatır")])), '"iki\r\nsatır"');
});

test("a field that needs no quoting does not get any", () => {
  assert.equal(PivotForge.toCsv(model([cell("Ege"), cell("1250")])), "Ege,1250");
});

test("an absent text becomes an empty field", () => {
  const csv = PivotForge.toCsv(model([cell(undefined), cell(null), cell("")]));

  assert.equal(csv, ",,");
});

// --- Merged cells -------------------------------------------------------------

// CSV has no merged cells, so a span is written once and the positions it
// covers are left empty. Getting this wrong shifts every column after it.
test("a column span leaves empty fields beside its text", () => {
  const csv = PivotForge.toCsv(model(
    [cell("Bölge"), cell("2025", { columnSpan: 2 })],
    [cell("Ege"), cell("1"), cell("2")]));

  assert.deepEqual(lines(csv), ["Bölge,2025,", "Ege,1,2"]);
});

test("a row span leaves an empty field on the rows below it", () => {
  const csv = PivotForge.toCsv(model(
    [cell("Bölge", { rowSpan: 2 }), cell("2025")],
    [cell("Ç1")],
    [cell("Ege"), cell("1")]));

  assert.deepEqual(lines(csv), ["Bölge,2025", ",Ç1", "Ege,1"]);
});

test("a cell spanning both directions covers a whole block", () => {
  const csv = PivotForge.toCsv(model(
    [cell("köşe", { rowSpan: 2, columnSpan: 2 }), cell("a")],
    [cell("b")],
    [cell("1"), cell("2"), cell("3")]));

  assert.deepEqual(lines(csv), ["köşe,,a", ",,b", "1,2,3"]);
});

// A real pivot head: the corner spans the header rows, and each column field
// spans its measures.
test("a two-level header keeps its columns aligned with the body", () => {
  const csv = PivotForge.toCsv(model(
    [cell("Bölge", { rowSpan: 2 }), cell("2024", { columnSpan: 2 }), cell("2025", { columnSpan: 2 })],
    [cell("Adet"), cell("Tutar"), cell("Adet"), cell("Tutar")],
    [cell("Ege"), cell("1"), cell("2"), cell("3"), cell("4")]));

  const rows = lines(csv);
  assert.deepEqual(rows, ["Bölge,2024,,2025,", ",Adet,Tutar,Adet,Tutar", "Ege,1,2,3,4"]);
  // Every line has the same number of fields, which is what keeps a spreadsheet
  // from opening the file with its columns shifted.
  const widths = new Set(rows.map(row => row.split(",").length));
  assert.equal(widths.size, 1);
});

test("a short row is padded to the widest row", () => {
  const csv = PivotForge.toCsv(model([cell("a"), cell("b"), cell("c")], [cell("x")]));

  assert.deepEqual(lines(csv), ["a,b,c", "x,,"]);
});

// The widest row is not always the first: a single-measure pivot has a one-cell
// corner above a body several columns wide.
test("the width comes from the widest row, wherever it is", () => {
  const csv = PivotForge.toCsv(model([cell("Tutar")], [cell("Ege"), cell("1"), cell("2")]));

  assert.deepEqual(lines(csv), ["Tutar,,", "Ege,1,2"]);
});

test("a missing span counts as one, so a bare cell still lands in one column", () => {
  const csv = PivotForge.toCsv(model([{ text: "a" }, { text: "b" }]));

  assert.equal(csv, "a,b");
});

// --- Options ------------------------------------------------------------------

// A locale that reads the comma as a decimal separator needs the semicolon, and
// the escaping has to follow the delimiter rather than stay on the comma.
test("a declared delimiter is used and is what gets escaped", () => {
  const csv = PivotForge.toCsv(
    model([cell("1.250,50"), cell("a;b")]),
    { delimiter: ";" });

  assert.equal(csv, '1.250,50;"a;b"');
});

// And the currency and the decimals survive. A Turkish-formatted number holds
// the comma, so it comes back quoted -- which is the escaping doing its job,
// and the reason the semicolon delimiter below exists.
test("values default to what the grid displays", () => {
  const csv = PivotForge.toCsv(model([cell("₺1.250,50", { number: 1250.5 })]));

  assert.equal(csv, '"₺1.250,50"');
});

// Raw is for feeding another program: a number no locale has to be guessed at.
test("raw values take the number behind the text", () => {
  const csv = PivotForge.toCsv(
    model([cell("₺1.250,50", { number: 1250.5 }), cell("Ege")]),
    { values: "raw" });

  assert.equal(csv, "1250.5,Ege");
});

test("raw leaves a cell that carries no number as its text", () => {
  const csv = PivotForge.toCsv(
    model([cell("Ege", { number: null }), cell("-")]),
    { values: "raw" });

  assert.equal(csv, "Ege,-");
});

test("raw keeps a zero, which is a number like any other", () => {
  const csv = PivotForge.toCsv(model([cell("0,00", { number: 0 })]), { values: "raw" });

  assert.equal(csv, "0");
});

test("an unknown values option is treated as the default rather than as raw", () => {
  const csv = PivotForge.toCsv(model([cell("₺1.250", { number: 1250 })]), { values: "ham" });

  assert.equal(csv, "₺1.250");
});

// --- Cleaning the exported text -----------------------------------------------

// The export model's text is what both CSV and Excel carry, so a control glyph
// that survives here lands in the .xlsx as well.
const { PivotTableRenderer } = PivotForge;

function headerCell(text, ...controlClasses) {
  const controls = controlClasses.map(className => ({
    className,
    textContent: "▼",
    remove() { this.removed = true; }
  }));

  return {
    textContent: text + controls.map(control => control.textContent).join(""),
    cloneNode() {
      // A clone with its own text, so removing a control from it changes what
      // the export reads without touching the cell still on screen.
      const clone = {
        textContent: this.textContent,
        querySelectorAll(selector) {
          const wanted = selector.split(",").map(part => part.trim().slice(1));
          const matched = controls.filter(control => wanted.includes(control.className));
          matched.forEach(control => {
            clone.textContent = clone.textContent.replace(control.textContent, "");
          });
          return { forEach: callback => matched.forEach(callback) };
        }
      };

      return clone;
    }
  };
}

const exportedText = cell =>
  new PivotTableRenderer({}).getExportCellText(cell);

test("a sort indicator is not exported", () => {
  assert.equal(exportedText(headerCell("Bölge", "pivot-table__sort-indicator")), "Bölge");
});

test("a resize handle is not exported", () => {
  assert.equal(exportedText(headerCell("Bölge", "pivot-table__resize-handle")), "Bölge");
});

test("an expand toggle is not exported", () => {
  assert.equal(exportedText(headerCell("Bölge", "pivot-table__toggle")), "Bölge");
});

// This one used to leak, into the .xlsx as well as the .csv.
test("a header filter funnel is not exported", () => {
  assert.equal(exportedText(headerCell("Bölge", "pivot-table__filter-button")), "Bölge");
});

test("a header carrying every control exports as its caption alone", () => {
  const cell = headerCell(
    "Bölge",
    "pivot-table__sort-indicator",
    "pivot-table__resize-handle",
    "pivot-table__toggle",
    "pivot-table__filter-button");

  assert.equal(exportedText(cell), "Bölge");
});

test("a cell that cannot be cloned falls back to its own text", () => {
  assert.equal(exportedText({ textContent: "  Ege  " }), "Ege");
  assert.equal(exportedText(null), "");
});

// A cell with no text still occupies its column: if it did not, the cell after
// it would silently take its place and shift the whole row.
test("an empty cell holds its column open", () => {
  const csv = PivotForge.toCsv(model(
    [cell("a"), cell(undefined), cell("c")],
    [cell("1"), cell("2"), cell("3")]));

  assert.deepEqual(lines(csv), ["a,,c", "1,2,3"]);
});

test("an empty cell that spans holds every column it covers", () => {
  const csv = PivotForge.toCsv(model(
    [cell(""), cell(undefined, { columnSpan: 2 }), cell("d")],
    [cell("1"), cell("2"), cell("3"), cell("4")]));

  assert.deepEqual(lines(csv), [",,,d", "1,2,3,4"]);
});
