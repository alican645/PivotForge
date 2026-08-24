(function (root) {
const PivotForge = root.PivotForge ??= {};

// Every string the renderer puts on screen. Declared here rather than inline so
// a consumer can replace them without forking the file; a key left out of
// `texts` keeps its default, exactly as the designer's `labels` work. A whole
// language at once comes from a locale pack (pivot-locale-*.js).
// `{0}` is substituted positionally.
const TEXTS = {
  rowLabels: "Row Labels",
  rowsHeading: "Rows",
  rowHeading: "Row {0}",
  noData: "No data",
  noValueFields: "There is nothing to render: no value field.",
  cellActions: "Cell actions",
  openDetails: "Show details",
  copyCell: "Copy cell",
  copyRow: "Copy row",
  sortByValue: "Sort by this value",
  filterByValue: "Filter by this value",
  addConditionalFormat: "Add conditional formatting",
  resizeColumn: "Resize column",
  sortField: "Sort {0}",
  sortActive: "{0} is sorted",
  filterField: "Filter {0}",
  filterActive: "{0} is filtered"
};

// The comparisons matchesConditionalRule evaluates and the highlights
// applyConditionalFormatting has classes for. Named here so a rule can be
// checked against exactly what the renderer will do with it.
const CONDITIONAL_OPERATORS = [
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "equal",
  "between"
];

const CONDITIONAL_COLORS = ["green", "amber", "red", "blue"];

// Turns an export model into comma-separated text. Takes the same model the
// Excel endpoint is sent, so the two exports can never disagree about what the
// grid says -- and it inherits the model's cleaning, which drops the sort
// arrows, resize handles and expand chevrons that a naive scrape of the table
// would carry into the file.
//
// CSV has no merged cells, so a cell spanning several columns or rows is
// written once at its top-left and the covered positions are left empty. Every
// line is padded to the widest row: a ragged file is one a spreadsheet opens
// with its columns shifted.
PivotForge.toCsv = function toCsv(model, options = {}) {
  // Comma by default, because that is the format's name. A spreadsheet whose
  // locale reads the comma as a decimal separator wants ";" instead, which is
  // why this is a choice rather than a constant.
  const delimiter = options.delimiter ?? ",";
  // The displayed text by default: a currency, a fixed number of decimals or a
  // show-as percentage is information the grid computed, and raw numbers would
  // throw it away. "raw" is for feeding another program rather than a reader.
  const raw = options.values === "raw";
  const rows = model?.rows ?? [];
  const grid = rows.map(() => []);

  rows.forEach((row, rowIndex) => {
    let column = 0;

    for (const cell of row.cells ?? []) {
      while (grid[rowIndex][column] !== undefined) {
        column++;
      }

      for (let down = 0; down < (cell.rowSpan || 1); down++) {
        for (let across = 0; across < (cell.columnSpan || 1); across++) {
          const target = grid[rowIndex + down];

          if (target) {
            target[column + across] = down === 0 && across === 0
              ? cellText(cell, raw)
              : "";
          }
        }
      }

      // No need to advance by the span: the cells it just filled are what the
      // search above skips over on the next turn.
    }
  });

  const width = grid.reduce((widest, row) => Math.max(widest, row.length), 0);

  return grid
    .map(row => Array.from({ length: width }, (_, index) => escapeCsv(row[index], delimiter))
      .join(delimiter))
    // CRLF, as RFC 4180 asks and as spreadsheets expect.
    .join("\r\n");
};

// Always a string, never undefined: an undefined entry in the grid is how the
// search above tells an unoccupied position from a filled one, so a cell with
// no text has to still occupy its place.
function cellText(cell, raw) {
  return raw && typeof cell.number === "number"
    ? String(cell.number)
    : String(cell.text ?? "");
}

function escapeCsv(text, delimiter) {
  const value = String(text ?? "");

  // A field holding the delimiter, a quote or a line break has to be quoted, and
  // a quote inside a quoted field is written twice.
  return value.includes(delimiter) || /["\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

// Whether anything could act on this rule at all. Separate from
// matchesConditionalRule, which asks about one value: this asks whether the
// rule is the kind of thing that can ever paint anything. Everything that
// stores, restores or accepts a rule checks it here, so the panel, the widget
// and a restored view all agree on what a rule is.
PivotForge.isConditionalRule = function isConditionalRule(rule) {
  if (typeof rule?.valueKey !== "string" || rule.valueKey === "") {
    return false;
  }

  if (!CONDITIONAL_COLORS.includes(rule.color) ||
    !CONDITIONAL_OPERATORS.includes(rule.operator) ||
    !Number.isFinite(rule.threshold)) {
    return false;
  }

  // Between is the only comparison that reads a second bound, and it cannot do
  // anything without one.
  return rule.operator !== "between" || Number.isFinite(rule.threshold2);
};

function formatText(template, ...values) {
  return values.reduce(
    (result, value, index) => result.replaceAll(`{${index}}`, String(value)),
    String(template));
}

PivotForge.PivotTableRenderer = class PivotTableRenderer {
  constructor(container, options = {}) {
    if (!container) {
      throw new Error("PivotTableRenderer requires a container element.");
    }

    this.container = container;
    this.options = {
      emptyText: "-",
      totalText: "Total",
      // A grid needs a name, and a page with two pivots needs two different
      // ones — so it is declarable rather than fixed.
      ariaLabel: "Pivot table",
      rowFields: [],
      rowFieldLabels: [],
      columnFields: [],
      columnFieldLabels: [],
      // Parallel to rowFields, following rowFieldLabels' shape. A false entry
      // means that row field starts collapsed, or produces no total.
      rowFieldExpanded: null,
      rowFieldSubtotals: null,
      subtotals: true,
      valueKey: null,
      values: null,
      aggregation: "sum",
      sortState: null,
      onSortRequested: null,
      // The row header's funnel, wired the same way sorting is: without a
      // handler the control is not drawn at all, so a host that cannot filter
      // gets no funnel rather than a broken one. filteredFields names the
      // fields currently restricted, which is all the header has to show.
      onFilterRequested: null,
      filteredFields: [],
      onViewStateChanged: null,
      onCellDoubleClick: null,
      onCellCopied: null,
      onCellFilterRequested: null,
      onConditionalFormatRequested: null,
      selectionMode: "single",
      contextMenu: true,
      conditionalRules: [],
      showGrandTotal: true,
      virtualState: null,
      restoreSelectionFocus: true,
      onSelectionChanged: null,
      layoutMode: "tabular",
      repeatRowLabels: false,
      minColumnWidth: 72,
      maxColumnWidth: 420,
      // Left null so Intl falls back to the reader's own locale: a package that
      // hard-codes one gives every other reader the wrong decimal separator.
      culture: null,
      texts: null,
      formatter: new Intl.NumberFormat(
        options.culture ?? undefined, { maximumFractionDigits: 2 }),
      ...options
    };
    this.columnWidths = new Map();
    this.selection = null;
    this.selectionMetadata = new WeakMap();
  }

  render(result, options = {}) {
    const settings = { ...this.options, ...options, texts: this.resolveTexts(options) };
    this.lastResult = result;
    this.lastOptions = options;
    this.lastSettings = settings;
    const rowHeaders = result?.rowHeaders ?? [];
    const columnHeaders = result?.columnHeaders ?? [];
    const cells = result?.cells ?? [];
    const rowTotals = result?.rowTotals ?? null;
    const columnTotals = result?.columnTotals ?? null;
    const subtotals = result?.subtotals ?? null;
    const grandTotals = result?.grandTotals ?? {};
    const values = this.resolveValues(settings, cells, grandTotals);

    this.container.classList.add("pivot-table");
    this.container.classList.toggle("is-virtual", Boolean(settings.virtualState));
    this.closeContextMenu();

    if (values.length === 0) {
      this.container.replaceChildren(this.createEmptyState(settings.texts.noValueFields));
      return;
    }

    const columnDepth = Math.max(1, ...columnHeaders.map(header => header.length));
    const measureDepth = values.length > 1 ? 1 : 0;
    const headerDepth = columnDepth + measureDepth;
    const actualRowDepth = Math.max(1, ...rowHeaders.map(header => header.length));
    const rowDepth = settings.layoutMode === "compact" ? 1 : actualRowDepth;
    const lookup = this.createCellLookup(cells);
    this.collapsedRows ??= new Set();
    this.applyInitialCollapse(rowHeaders, actualRowDepth, settings);
    this.selectionMetadata = new WeakMap();
    const table = document.createElement("table");
    table.className = `pivot-table__table is-${settings.layoutMode}`;
    // The renderer already ships the whole grid keyboard contract — arrow keys,
    // Enter, Ctrl+C, a roving tabindex and cell selection. Declaring the role is
    // what makes that contract discoverable, and what makes the aria-selected
    // already written on rows and cells mean anything: on a plain table it is
    // an unsupported attribute that screen readers drop.
    table.setAttribute("role", "grid");
    table.setAttribute("aria-multiselectable", "false");
    table.setAttribute("aria-label", settings.ariaLabel);

    table.appendChild(this.createTableHead(columnHeaders, columnDepth, measureDepth, rowDepth, values, settings));
    table.appendChild(this.createTableBody(
      rowHeaders,
      columnHeaders,
      rowDepth,
      actualRowDepth,
      values,
      lookup,
      grandTotals,
      settings,
      rowTotals,
      columnTotals,
      subtotals));
    this.applyVirtualSpacers(table, settings.virtualState, rowDepth, columnHeaders, values);
    // After the spacers, so the rows they insert are excluded from the count.
    this.applyGridIndexes(table, settings.virtualState);

    this.container.replaceChildren(table);
    this.currentTable = table;
    this.wireSubtotalToggles(table, result, options);
    this.wireSelection(table, settings);
    this.applySelectionState(table);
    this.applyConditionalFormatting(table, settings);
    this.applyColumnWidths(table);
    this.wireColumnResize(table, settings);
    this.applyStickyOffsets(table, headerDepth, rowDepth);
    if (settings.restoreSelectionFocus) {
      this.restoreSelectedCellFocus(table);
    }
  }

  // Applied once per renderer, at its first render. After that the collapse set
  // belongs to the user: re-applying it on every render would make a declared
  // level impossible to open. A field change rebuilds the renderer, which is
  // the right moment to honour the declaration again -- the hierarchy is new.
  applyInitialCollapse(rowHeaders, rowDepth, settings) {
    if (this.initialCollapseApplied) {
      return;
    }

    this.initialCollapseApplied = true;

    const declared = settings.rowFieldExpanded;
    if (!Array.isArray(declared) || rowDepth < 2) {
      return;
    }

    const collapsed = new Set(declared
      .map((expanded, level) => (expanded === false ? level : -1))
      .filter(level => level >= 0));

    if (collapsed.size === 0) {
      return;
    }

    this.createRowPlan(rowHeaders, rowDepth, settings)
      .filter(row => row.type !== "detail" && collapsed.has(row.level))
      .forEach(row => this.collapsedRows.add(row.key));
  }

  expandAll() {
    this.collapsedRows?.clear();
    this.rerenderLast();
    this.notifyViewStateChanged();
  }

  collapseAll() {
    const result = this.lastResult;
    const settings = this.lastSettings;

    if (!result || !settings) {
      return;
    }

    const rowHeaders = result.rowHeaders ?? [];
    const rowDepth = Math.max(1, ...rowHeaders.map(header => header.length));
    const plan = this.createRowPlan(rowHeaders, rowDepth, settings);
    this.collapsedRows = new Set(plan
      .filter(row => row.type === "subtotal" || row.type === "group")
      .map(row => row.key));
    this.rerenderLast();
    this.notifyViewStateChanged();
  }

  resetColumnWidths() {
    this.columnWidths.clear();
    this.rerenderLast();
    this.notifyViewStateChanged();
  }

  getViewState() {
    return {
      columnWidths: [...this.columnWidths.entries()].map(([columnIndex, width]) => [columnIndex, width]),
      collapsedGroups: [...(this.collapsedRows ?? new Set())]
    };
  }

  getExcelExportModel(options = {}) {
    const table = this.currentTable;

    if (!table) {
      return null;
    }

    const bodyRow = table.tBodies[0]?.rows[0];
    const frozenColumnCount = bodyRow
      ? Array.from(bodyRow.children).findIndex(cell => cell.tagName === "TD")
      : 0;

    return {
      title: options.title ?? "Pivot Tablo",
      filterSummary: options.filterSummary ?? "Aktif filtre yok",
      filterLabel: options.filterLabel ?? "Filtreler",
      sheetName: options.sheetName ?? "Pivot Tablo",
      headerRowCount: table.tHead?.rows.length ?? 0,
      frozenColumnCount: Math.max(0, frozenColumnCount),
      rows: Array.from(table.rows)
        .filter(row => !row.hidden && row.style.display !== "none")
        .map(row => ({
          cells: Array.from(row.children).map(cell => this.createExcelExportCell(cell, row))
        }))
    };
  }

  createExcelExportCell(cell, row) {
    const selection = this.selectionMetadata.get(cell);
    const valueDefinition = this.lastSettings?.values?.find(value => value.key === selection?.valueKey);

    return {
      text: this.getExportCellText(cell),
      number: typeof selection?.value === "number" ? selection.value : null,
      rowSpan: cell.rowSpan || 1,
      columnSpan: cell.colSpan || 1,
      width: Math.round(cell.getBoundingClientRect?.().width || cell.offsetWidth || 118),
      numberFormat: typeof selection?.value === "number" ? this.getExcelNumberFormat(valueDefinition) : null,
      role: this.getExcelCellRole(cell, row),
      highlight: this.getExcelCellHighlight(cell)
    };
  }

  getExportCellText(cell) {
    if (!cell?.cloneNode) {
      return String(cell?.textContent ?? "").trim();
    }

    const clone = cell.cloneNode(true);
    // Every control the header carries, so an export is the text a reader sees
    // rather than the glyphs the controls are drawn with. The funnel belongs
    // here for the same reason the sort arrow does.
    clone.querySelectorAll(
      ".pivot-table__sort-indicator, .pivot-table__resize-handle, .pivot-table__toggle, .pivot-table__filter-button")
      .forEach(element => element.remove());
    return String(clone.textContent ?? "").trim();
  }

  getExcelCellRole(cell, row) {
    if (row?.parentElement?.tagName === "THEAD") return "Header";
    if (cell.classList.contains("pivot-table__grand-total")) return "GrandTotal";
    if (row?.classList.contains("pivot-table__subtotal-row")) return "Subtotal";
    if (cell.classList.contains("pivot-table__row-total") ||
      cell.classList.contains("pivot-table__column-total") ||
      cell.classList.contains("pivot-table__row-total-label")) return "Total";
    if (cell.tagName === "TH") return "RowHeader";
    return "Value";
  }

  getExcelCellHighlight(cell) {
    for (const color of ["Green", "Amber", "Red", "Blue"]) {
      if (cell.classList.contains(`is-conditional-${color.toLowerCase()}`)) {
        return color;
      }
    }

    return "None";
  }

  getExcelNumberFormat(valueDefinition) {
    const format = valueDefinition?.format;

    if (!format) {
      return "#,##0.00";
    }

    const decimals = Number.isInteger(format.decimals) ? Math.max(0, Math.min(6, format.decimals)) : 2;
    const decimalPart = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
    const numberPattern = `${format.useGrouping === false ? "0" : "#,##0"}${decimalPart}`;

    if (format.type === "percent") {
      return `${numberPattern}%`;
    }

    if (format.type === "currency") {
      const symbol = { TRY: "₺", USD: "$", EUR: "€", GBP: "£" }[format.currency ?? "TRY"] ?? format.currency ?? "";
      return `${symbol}${numberPattern}`;
    }

    return numberPattern;
  }

  applyViewState(state, options = {}) {
    const { rerender = true, notify = true } = options;
    const widths = Array.isArray(state?.columnWidths) ? state.columnWidths : [];
    const collapsedGroups = Array.isArray(state?.collapsedGroups) ? state.collapsedGroups : [];

    this.columnWidths = new Map(widths
      .filter(entry => Array.isArray(entry) && Number.isInteger(entry[0]) && Number.isFinite(entry[1]))
      .map(([columnIndex, width]) => [columnIndex, width]));
    this.collapsedRows = new Set(collapsedGroups.filter(key => typeof key === "string"));
    // A restored view state is a decision the user already made, so the declared
    // initial state must not overwrite it on the render that follows.
    this.initialCollapseApplied = true;

    if (rerender) {
      this.rerenderLast();
    }

    if (notify) {
      this.notifyViewStateChanged();
    }
  }

  getSelection() {
    return this.cloneSelection(this.selection);
  }

  clearSelection() {
    if (!this.selection) {
      return;
    }

    this.selection = null;
    this.applySelectionState(this.currentTable);
    this.notifySelectionChanged(this.lastSettings);
  }

  rerenderLast() {
    if (this.lastResult) {
      this.render(this.lastResult, this.lastOptions ?? {});
    }
  }

  resolveValues(settings, cells, grandTotals) {
    if (Array.isArray(settings.values) && settings.values.length > 0) {
      return settings.values.map(value => ({
        key: value.key,
        label: value.label ?? value.key,
        aggregation: value.aggregation ?? settings.aggregation,
        format: value.format ?? null,
        showAs: value.showAs ?? "normal"
      }));
    }

    const key = settings.valueKey ?? this.resolveValueKey(cells, grandTotals);
    return key ? [{ key, label: key, aggregation: settings.aggregation }] : [];
  }

  resolveValueKey(cells, grandTotals) {
    const totalKey = Object.keys(grandTotals ?? {})[0];

    if (totalKey) {
      return totalKey;
    }

    for (const cell of cells ?? []) {
      const key = Object.keys(cell.values ?? {})[0];

      if (key) {
        return key;
      }
    }

    return null;
  }

  createTableHead(columnHeaders, columnDepth, measureDepth, rowDepth, values, settings) {
    const thead = document.createElement("thead");
    thead.setAttribute("role", "rowgroup");
    const valueSpan = values.length;
    // A column header names a value -- "2024" -- never the field behind it, so
    // there is nowhere to hang a funnel the way the row axis hangs one on its
    // corner. The field names get a cell of their own in the corner block, one
    // per column level, which pushes the row field names down to a row of their
    // own. Drawn only when both halves are there: nothing to filter, or no way
    // to filter it, and the table keeps the shape it always had.
    const columnFields = settings.columnFields ?? [];
    const namesColumnFields =
      typeof settings.onFilterRequested === "function" && columnFields.length > 0;
    const rowFieldRow = namesColumnFields ? this.createRow() : null;

    const appendRowFieldHeaders = row => {
      for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
        const label = settings.rowFieldLabels[rowLevel] ?? (rowDepth === 1
          ? settings.texts.rowsHeading
          : formatText(settings.texts.rowHeading, rowLevel + 1));
        const displayLabel = settings.layoutMode === "compact"
          ? settings.texts.rowLabels
          : label;
        const corner = this.createCell("th", displayLabel, "pivot-table__corner");
        corner.rowSpan = namesColumnFields ? 1 : columnDepth + measureDepth;
        corner.dataset.stickyColumn = String(rowLevel);
        corner.dataset.columnIndex = String(rowLevel);
        const rowField = settings.rowFields[rowLevel] ?? null;
        this.decorateSortableHeader(corner, displayLabel, {
          mode: "RowLabel",
          field: rowField
        }, settings);
        // After the sort button, which replaces the cell's children: the
        // funnel has to survive that, and the two controls sit side by side.
        this.decorateFilterableHeader(corner, displayLabel, rowField, settings);
        row.appendChild(corner);
      }
    };

    // The corner cell of a column level's own row: it names the field whose
    // values that row shows, and carries that field's funnel.
    const appendColumnFieldHeader = (row, level) => {
      const field = columnFields[level] ?? null;
      const label = settings.columnFieldLabels?.[level] ?? field ?? "";
      const cell = this.createCell("th", label, "pivot-table__corner pivot-table__column-field");
      cell.colSpan = rowDepth;
      cell.dataset.stickyColumn = "0";
      this.decorateFilterableHeader(cell, label, field, settings);
      row.appendChild(cell);
    };

    for (let level = 0; level < columnDepth; level++) {
      const row = this.createRow();

      if (namesColumnFields) {
        appendColumnFieldHeader(row, level);
      } else if (level === 0) {
        appendRowFieldHeaders(row);
      }

      const groups = this.createColumnGroups(columnHeaders, level);

      for (const group of groups) {
        const header = this.createCell("th", this.displayValue(group.value, settings), "pivot-table__column-header");
        header.colSpan = group.span * valueSpan;
        header.dataset.stickyRow = String(level);
        header.dataset.columnStart = String(rowDepth + group.start * valueSpan);

        if (group.value === null || group.value === undefined || group.value === "") {
          header.classList.add("is-empty");
        }

        row.appendChild(header);
      }

      if (level === 0) {
        const total = this.createCell("th", settings.totalText, "pivot-table__measure-header");
        total.colSpan = valueSpan;
        total.rowSpan = columnDepth;
        total.dataset.stickyRow = "0";
        total.dataset.columnStart = String(rowDepth + Math.max(1, columnHeaders.length) * valueSpan);
        if (measureDepth === 0 && values.length === 1) {
          total.dataset.columnIndex = total.dataset.columnStart;
          this.decorateSortableHeader(total, settings.totalText, {
            mode: "RowTotalValue",
            valueKey: values[0].key
          }, settings);
        }
        row.appendChild(total);
      }

      thead.appendChild(row);
    }

    if (measureDepth > 0) {
      const measureRow = this.createRow();

      if (namesColumnFields) {
        // The corner block keeps its width on every head row, or the value
        // headers below would slide left out from under their columns.
        const filler = this.createCell("th", "", "pivot-table__corner");
        filler.colSpan = rowDepth;
        filler.dataset.stickyColumn = "0";
        measureRow.appendChild(filler);
      }

      for (let columnIndex = 0; columnIndex < Math.max(1, columnHeaders.length); columnIndex++) {
        values.forEach((value, valueIndex) => {
          const cell = this.createCell("th", value.label, "pivot-table__value-header");
          cell.dataset.stickyRow = String(columnDepth);
          cell.dataset.columnIndex = String(rowDepth + columnIndex * valueSpan + valueIndex);
          this.decorateSortableHeader(cell, value.label, {
            mode: "RowTotalValue",
            valueKey: value.key,
            columnPath: columnHeaders[columnIndex] ?? []
          }, settings);
          measureRow.appendChild(cell);
        });
      }

      values.forEach((value, valueIndex) => {
        const totalCell = this.createCell("th", value.label, "pivot-table__value-header pivot-table__total-value-header");
        totalCell.dataset.stickyRow = String(columnDepth);
        totalCell.dataset.columnIndex = String(rowDepth + Math.max(1, columnHeaders.length) * valueSpan + valueIndex);
        this.decorateSortableHeader(totalCell, value.label, {
          mode: "RowTotalValue",
          valueKey: value.key
        }, settings);
        measureRow.appendChild(totalCell);
      });

      thead.appendChild(measureRow);
    }

    if (rowFieldRow) {
      appendRowFieldHeaders(rowFieldRow);
      // One blank strip under the column values rather than a cell per column:
      // the row names an axis, not a coordinate, so there is nothing to line up
      // with underneath.
      const filler = this.createCell("th", "", "pivot-table__column-field-filler");
      filler.colSpan = Math.max(1, columnHeaders.length) * valueSpan + valueSpan;
      rowFieldRow.appendChild(filler);
      thead.appendChild(rowFieldRow);
    }

    return thead;
  }

  createColumnGroups(columnHeaders, level) {
    if (columnHeaders.length === 0) {
      return [{ value: null, span: 1 }];
    }

    const groups = [];
    let currentKey = null;
    let currentValue = null;
    let span = 0;
    let start = 0;

    columnHeaders.forEach((header, index) => {
      const path = header.slice(0, level + 1);
      const key = JSON.stringify(path);
      const value = header[level] ?? null;

      if (index === 0) {
        currentKey = key;
        currentValue = value;
        span = 1;
        start = 0;
        return;
      }

      if (key === currentKey) {
        span++;
        return;
      }

      groups.push({ value: currentValue, span, start });
      currentKey = key;
      currentValue = value;
      span = 1;
      start = index;
    });

    groups.push({ value: currentValue, span, start });
    return groups;
  }

  createTableBody(
    rowHeaders,
    columnHeaders,
    rowDepth,
    actualRowDepth,
    values,
    lookup,
    grandTotals,
    settings,
    rowTotals = null,
    columnTotals = null,
    subtotals = null) {
    const tbody = document.createElement("tbody");
    tbody.setAttribute("role", "rowgroup");

    if (rowHeaders.length === 0) {
      const row = this.createRow();
      const empty = this.createCell("td", settings.texts.noData, "pivot-table__empty");
      empty.colSpan = rowDepth + Math.max(1, columnHeaders.length) * values.length + values.length;
      row.appendChild(empty);
      tbody.appendChild(row);
      return tbody;
    }

    const rowPlan = this.createRowPlan(rowHeaders, actualRowDepth, settings);
    const rowTotalLookup = this.createTotalLookup(rowTotals);
    const subtotalLookup = this.createSubtotalLookup(subtotals);

    let previousVisibleRowHeader = null;

    rowPlan.forEach(rowInfo => {
      if (this.isRowHidden(rowInfo.rowHeader, rowInfo.type)) {
        return;
      }

      tbody.appendChild(this.createPivotBodyRow(
        rowInfo,
        columnHeaders,
        rowDepth,
        values,
        lookup,
        settings,
        previousVisibleRowHeader,
        rowTotalLookup,
        subtotalLookup,
        Array.isArray(rowTotals) || Array.isArray(subtotals)));
      previousVisibleRowHeader = rowInfo.rowHeader;
    });

    if (settings.showGrandTotal !== false) {
      tbody.appendChild(this.createGrandTotalRow(
        rowHeaders,
        columnHeaders,
        rowDepth,
        values,
        lookup,
        grandTotals,
        settings,
        columnTotals));
    }
    return tbody;
  }

  applyVirtualSpacers(table, virtualState, rowDepth, columnHeaders, values) {
    if (!virtualState || !table?.tBodies[0]) {
      return;
    }

    const rowHeight = Math.max(24, virtualState.rowHeight ?? 36);
    const offset = Math.max(0, virtualState.offset ?? 0);
    const pageRowCount = Math.max(0, virtualState.pageRowCount ?? 0);
    const totalRows = Math.max(pageRowCount, virtualState.totalRowCount ?? pageRowCount);
    const columnCount = rowDepth + Math.max(1, columnHeaders.length) * values.length + values.length;
    const topHeight = offset * rowHeight;
    const bottomHeight = Math.max(0, totalRows - offset - pageRowCount) * rowHeight;
    const tbody = table.tBodies[0];

    if (topHeight > 0) {
      tbody.insertBefore(this.createVirtualSpacer(topHeight, columnCount, "top"), tbody.firstChild);
    }

    if (bottomHeight > 0) {
      tbody.appendChild(this.createVirtualSpacer(bottomHeight, columnCount, "bottom"));
    }
  }

  createVirtualSpacer(height, columnCount, position) {
    const row = this.createRow(`pivot-table__virtual-spacer is-${position}`);
    row.setAttribute("aria-hidden", "true");
    const cell = this.createCell("td", "", "");
    cell.colSpan = columnCount;
    cell.style.height = `${height}px`;
    row.appendChild(cell);
    return row;
  }

  createPivotBodyRow(
    rowInfo,
    columnHeaders,
    rowDepth,
    values,
    lookup,
    settings,
    previousRowHeader = null,
    rowTotalLookup = new Map(),
    subtotalLookup = new Map(),
    serverTotalsAvailable = false) {
    const row = this.createRow();
    const rowSelection = this.createRowSelection(rowInfo);
    row.className = {
      detail: "pivot-table__detail-row",
      group: "pivot-table__group-row",
      subtotal: "pivot-table__subtotal-row"
    }[rowInfo.type] ?? "pivot-table__detail-row";
    this.registerSelectionRow(row, rowSelection);

    if (settings.layoutMode === "compact") {
      row.appendChild(this.createCompactRowHeader(rowInfo, settings, previousRowHeader, rowSelection));
    } else {
      this.appendTabularRowHeaders(row, rowInfo, rowDepth, settings, previousRowHeader, rowSelection);
    }

    const subtotal = rowInfo.type === "subtotal" ? subtotalLookup.get(rowInfo.key) : null;
    const subtotalCells = this.createCellLookup(subtotal?.cells ?? []);
    const rowValuesByKey = new Map(values.map(value => [value.key, []]));

    columnHeaders.forEach((_, columnIndex) => {
      values.forEach((valueDefinition, valueIndex) => {
        const serverValue = rowInfo.type === "detail"
          ? lookup.get(`${rowInfo.rowIndexes[0]}:${columnIndex}`)?.[valueDefinition.key]
          : subtotalCells.get(`0:${columnIndex}`)?.[valueDefinition.key];
        const value = rowInfo.type === "group"
          ? null
          : serverTotalsAvailable
            ? serverValue ?? null
            : this.summarizeValues(
              rowInfo.rowIndexes
                .map(rowIndex => lookup.get(`${rowIndex}:${columnIndex}`)?.[valueDefinition.key] ?? null)
                .filter(value => typeof value === "number"),
              valueDefinition);

        if (typeof value === "number") {
          rowValuesByKey.get(valueDefinition.key).push(value);
        }

        const cell = this.createCell(
          "td",
          this.formatValue(value, settings, valueDefinition),
          rowInfo.type === "subtotal" ? "pivot-table__subtotal-value" : "pivot-table__value");

        if (value === null || value === undefined) {
          cell.classList.add("is-empty");
        }

        cell.dataset.columnIndex = String(rowDepth + columnIndex * values.length + valueIndex);
        this.registerSelectionTarget(cell, this.createCellSelection(rowSelection, {
          kind: "column",
          columnIndex,
          columnHeader: columnHeaders[columnIndex] ?? [],
          valueKey: valueDefinition.key,
          value,
          drillDownEnabled: rowInfo.type !== "group"
        }), "cell");
        row.appendChild(cell);
      });
    });

    values.forEach((valueDefinition, valueIndex) => {
      const serverTotal = rowInfo.type === "detail"
        ? rowTotalLookup.get(rowInfo.rowIndexes[0])?.[valueDefinition.key]
        : subtotal?.totals?.[valueDefinition.key];
      const totalValue = rowInfo.type === "group"
        ? null
        : serverTotalsAvailable
          ? serverTotal ?? null
          : this.summarizeValues(rowValuesByKey.get(valueDefinition.key), valueDefinition);
      const totalCell = this.createCell(
        "td",
        this.formatValue(totalValue, settings, valueDefinition),
        rowInfo.type === "subtotal" ? "pivot-table__subtotal-total" : "pivot-table__row-total");
      if (totalValue === null || totalValue === undefined) {
        totalCell.classList.add("is-empty");
      }
      totalCell.dataset.columnIndex = String(rowDepth + Math.max(1, columnHeaders.length) * values.length + valueIndex);
      this.registerSelectionTarget(totalCell, this.createCellSelection(rowSelection, {
        kind: "rowTotal",
        columnIndex: null,
        columnHeader: [],
        valueKey: valueDefinition.key,
        value: totalValue,
        drillDownEnabled: rowInfo.type !== "group"
      }), "cell");
      row.appendChild(totalCell);
    });

    return row;
  }

  appendTabularRowHeaders(row, rowInfo, rowDepth, settings, previousRowHeader, rowSelection) {
    for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
      const value = rowInfo.rowHeader[rowLevel] ?? null;
      const isGroupLikeRow = rowInfo.type === "subtotal" || rowInfo.type === "group";
      const header = this.createCell("th", "", isGroupLikeRow ? "pivot-table__subtotal-header" : "pivot-table__row-header", "rowheader");
      header.dataset.stickyColumn = String(rowLevel);
      header.dataset.columnIndex = String(rowLevel);
      this.registerSelectionTarget(header, rowSelection, "row");
      const isRepeatedLabel = settings.repeatRowLabels === false &&
        previousRowHeader !== null &&
        rowLevel < rowInfo.rowHeader.length &&
        previousRowHeader[rowLevel] === rowInfo.rowHeader[rowLevel];

      if (rowInfo.type === "subtotal" && rowLevel === rowInfo.level) {
        const label = `${this.displayValue(value, settings)} ${settings.totalText}`;
        header.appendChild(this.createSubtotalToggle(rowInfo.key, label));
        header.appendChild(document.createTextNode(label));
      } else if (rowInfo.type === "group" && rowLevel === rowInfo.level) {
        const label = this.displayValue(value, settings);
        header.appendChild(this.createSubtotalToggle(rowInfo.key, label));
        header.appendChild(document.createTextNode(label));
      } else if (rowInfo.type === "detail" || rowLevel < rowInfo.rowHeader.length) {
        if (isRepeatedLabel) {
          header.classList.add("is-repeated");
        } else {
          header.textContent = this.displayValue(value, settings);
        }
      }

      if (value === null || value === undefined || value === "") {
        header.classList.add("is-empty");
      }

      row.appendChild(header);
    }
  }

  createCompactRowHeader(rowInfo, settings, previousRowHeader, rowSelection) {
    const rowLevel = rowInfo.type === "subtotal" || rowInfo.type === "group"
      ? rowInfo.level
      : Math.max(0, rowInfo.rowHeader.length - 1);
    const value = rowInfo.rowHeader[rowLevel] ?? null;
    const header = this.createCell("th", "", rowInfo.type === "subtotal" || rowInfo.type === "group" ? "pivot-table__subtotal-header" : "pivot-table__row-header", "rowheader");
    header.dataset.stickyColumn = "0";
    header.dataset.columnIndex = "0";
    this.registerSelectionTarget(header, rowSelection, "row");
    header.style.setProperty("--pivot-indent", `${rowLevel * 18}px`);
    header.classList.add("is-compact");

    if (rowInfo.type === "subtotal") {
      const label = `${this.displayValue(value, settings)} ${settings.totalText}`;
      header.appendChild(this.createSubtotalToggle(rowInfo.key, label));
      header.appendChild(document.createTextNode(label));
    } else if (rowInfo.type === "group") {
      const label = this.displayValue(value, settings);
      header.appendChild(this.createSubtotalToggle(rowInfo.key, label));
      header.appendChild(document.createTextNode(label));
    } else {
      const isRepeatedLabel = settings.repeatRowLabels === false &&
        previousRowHeader !== null &&
        previousRowHeader[rowLevel] === rowInfo.rowHeader[rowLevel];

      if (isRepeatedLabel) {
        header.classList.add("is-repeated");
      } else {
        header.textContent = this.displayValue(value, settings);
      }
    }

    if (value === null || value === undefined || value === "") {
      header.classList.add("is-empty");
    }

    return header;
  }

  createRowPlan(rowHeaders, rowDepth, settings) {
    // Drawn in the order the engine sent. It re-sorted here once, in a
    // hard-coded "tr" collation, which quietly overrode both the culture the
    // request asked for and any per-field order it declared.
    const items = rowHeaders.map((rowHeader, rowIndex) => ({ rowHeader, rowIndex }));

    if (rowDepth > 1) {
      const plan = [];
      this.appendGroupRows(plan, items, 0, rowDepth, settings);
      return plan;
    }

    return items.map(item => ({
      type: "detail",
      key: `detail:${item.rowIndex}`,
      rowHeader: item.rowHeader,
      rowIndexes: [item.rowIndex],
      level: rowDepth - 1
    }));
  }

  // Whether the groups at `level` carry a total. A "subtotal" row is a group
  // header that also sums its rows; a "group" row is the same header without
  // the sums. They already differed only in that, so a row field opting out of
  // its totals is the same shape the grid uses when totals are off entirely --
  // and both keep the same key, so collapse state survives the distinction.
  subtotalsAt(level, settings) {
    if (settings.subtotals === false) {
      return false;
    }

    const perField = settings.rowFieldSubtotals;
    return !Array.isArray(perField) || perField[level] !== false;
  }

  appendGroupRows(plan, items, level, rowDepth, settings) {
    if (level >= rowDepth - 1) {
      for (const item of items) {
        plan.push({
          type: "detail",
          key: `detail:${item.rowIndex}`,
          rowHeader: item.rowHeader,
          rowIndexes: [item.rowIndex],
          level: rowDepth - 1
        });
      }

      return;
    }

    const type = this.subtotalsAt(level, settings) ? "subtotal" : "group";

    for (const group of this.groupItemsByLevel(items, level)) {
      const groupHeader = group.items[0].rowHeader.slice(0, level + 1);

      plan.push({
        type,
        key: this.createSubtotalKey(groupHeader),
        rowHeader: groupHeader,
        rowIndexes: group.items.map(item => item.rowIndex),
        level
      });

      this.appendGroupRows(plan, group.items, level + 1, rowDepth, settings);
    }
  }

  groupItemsByLevel(items, level) {
    const groupsByKey = new Map();

    for (const item of items) {
      const key = item.rowHeader[level] ?? "";
      const group = groupsByKey.get(key);

      if (group) {
        group.items.push(item);
      } else {
        groupsByKey.set(key, { key, items: [item] });
      }
    }

    return [...groupsByKey.values()];
  }

  createSubtotalKey(prefix) {
    return prefix.map(value => value ?? "").join("\u001f");
  }

  isRowHidden(rowHeader, rowType = "detail") {
    const levelsToCheck = rowType === "detail" ? rowHeader.length : rowHeader.length - 1;

    for (let level = 0; level < levelsToCheck; level++) {
      const key = this.createSubtotalKey(rowHeader.slice(0, level + 1));

      if (this.collapsedRows.has(key)) {
        return true;
      }
    }

    return false;
  }

  wireSubtotalToggles(table, result, options) {
    table.querySelectorAll(".pivot-table__toggle").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.dataset.subtotalKey;

        if (this.collapsedRows.has(key)) {
          this.collapsedRows.delete(key);
        } else {
          this.collapsedRows.add(key);
        }

        this.render(result, options);
        this.notifyViewStateChanged();
      });
    });
  }

  wireSelection(table, settings) {
    if (settings.selectionMode === "none") {
      table.querySelectorAll("[data-selection-target]").forEach(target => {
        delete target.dataset.selectionTarget;
        target.removeAttribute("tabindex");
      });
      return;
    }

    const selectTarget = target => {
      const selection = this.selectionMetadata.get(target);

      if (selection) {
        this.setSelection(selection, settings);
      }
    };

    table.addEventListener("click", event => {
      if (event.target.closest("button, input, select, a, .pivot-table__resize-handle")) {
        return;
      }

      const target = event.target.closest("[data-selection-target]");

      if (target && table.contains(target)) {
        selectTarget(target);
      }
    });

    table.addEventListener("keydown", event => {
      const target = event.target.closest("[data-selection-target]");

      if (!target || !table.contains(target)) {
        return;
      }

      const isCell = target.dataset.selectionTarget === "cell";
      const isCopy = isCell && (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("tr") === "c";

      if (isCell && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
        event.preventDefault();
        selectTarget(target);
        const rect = target.getBoundingClientRect();
        this.openContextMenu(target, rect.left + 12, rect.top + 12, settings);
        return;
      }

      if (isCopy) {
        event.preventDefault();
        selectTarget(target);
        void this.copyCell(target, settings);
        return;
      }

      if (isCell && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        this.moveCellSelection(table, target, event.key, settings);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();

        if (isCell) {
          this.activateCellSelection(this.selectionMetadata.get(target), settings);
        } else {
          selectTarget(target);
        }

        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        selectTarget(target);
      }
    });

    table.addEventListener("dblclick", event => {
      if (event.target.closest("button, input, select, a, .pivot-table__resize-handle")) {
        return;
      }

      const target = event.target.closest('[data-selection-target="cell"]');

      if (!target || !table.contains(target)) {
        return;
      }

      this.activateCellSelection(this.selectionMetadata.get(target), settings);
    });

    table.addEventListener("contextmenu", event => {
      const target = event.target.closest('[data-selection-target="cell"]');

      if (!settings.contextMenu || !target || !table.contains(target)) {
        return;
      }

      event.preventDefault();
      selectTarget(target);
      target.focus({ preventScroll: true });
      this.openContextMenu(target, event.clientX, event.clientY, settings);
    });

    table.addEventListener("copy", event => {
      const activeCell = document.activeElement?.closest?.('[data-selection-target="cell"]');
      const target = activeCell && table.contains(activeCell)
        ? activeCell
        : table.querySelector("td.is-cell-selected");

      if (!target || !event.clipboardData) {
        return;
      }

      const text = this.getCellCopyText(target);
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      selectTarget(target);
      this.markCellCopied(target, text, settings);
    });
  }

  createRowSelection(rowInfo) {
    return {
      type: "row",
      rowKey: this.createSelectionRowKey(rowInfo.rowHeader),
      rowType: rowInfo.type,
      rowHeader: [...rowInfo.rowHeader],
      rowIndexes: [...rowInfo.rowIndexes]
    };
  }

  createCellSelection(rowSelection, cell) {
    return {
      ...rowSelection,
      type: "cell",
      cellKey: this.createSelectionCellKey(cell.kind, cell.columnHeader, cell.valueKey),
      columnKind: cell.kind,
      columnIndex: cell.columnIndex,
      columnHeader: [...cell.columnHeader],
      valueKey: cell.valueKey,
      value: cell.value,
      drillDownEnabled: cell.drillDownEnabled !== false
    };
  }

  activateCellSelection(selection, settings = this.lastSettings) {
    if (selection?.type !== "cell" || selection.drillDownEnabled === false) {
      return;
    }

    this.setSelection(selection, settings);

    if (typeof settings?.onCellDoubleClick === "function") {
      settings.onCellDoubleClick(this.getSelection());
    }
  }

  moveCellSelection(table, currentCell, direction, settings = this.lastSettings) {
    const rows = Array.from(table.tBodies[0]?.rows ?? [])
      .map(row => Array.from(row.querySelectorAll('[data-selection-target="cell"]'))
        .filter(cell => this.selectionMetadata.get(cell)?.drillDownEnabled !== false))
      .filter(cells => cells.length > 0);
    const currentRow = rows.findIndex(cells => cells.includes(currentCell));

    if (currentRow < 0) {
      return null;
    }

    const currentColumn = Number(currentCell.dataset.columnIndex);
    const currentIndex = rows[currentRow].indexOf(currentCell);
    const nextPosition = this.resolveNavigationPosition(
      rows.map(cells => cells.map(cell => Number(cell.dataset.columnIndex))),
      currentRow,
      currentIndex,
      currentColumn,
      direction);

    if (!nextPosition) {
      return currentCell;
    }

    const nextCell = rows[nextPosition.row]?.[nextPosition.index];

    if (!nextCell) {
      return currentCell;
    }

    this.setSelection(this.selectionMetadata.get(nextCell), settings);
    nextCell.focus({ preventScroll: true });
    this.ensureCellVisible(nextCell, table);
    return nextCell;
  }

  ensureCellVisible(cell, table = this.currentTable) {
    const host = this.container;

    if (!cell?.scrollIntoView || !host?.getBoundingClientRect) {
      return;
    }

    cell.scrollIntoView({ block: "nearest", inline: "nearest" });

    const hostRect = host.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const stickyRight = Math.max(
      hostRect.left,
      ...Array.from(cell.parentElement?.querySelectorAll("[data-sticky-column]") ?? [])
        .map(header => header.getBoundingClientRect().right));
    const stickyBottom = Math.max(
      hostRect.top,
      ...Array.from(table?.querySelectorAll("[data-sticky-row]") ?? [])
        .map(header => header.getBoundingClientRect().bottom));
    const gap = 8;

    if (cellRect.right > hostRect.right - gap) {
      host.scrollLeft += cellRect.right - hostRect.right + gap;
    } else if (cellRect.left < stickyRight + gap) {
      host.scrollLeft -= stickyRight + gap - cellRect.left;
    }

    if (cellRect.bottom > hostRect.bottom - gap) {
      host.scrollTop += cellRect.bottom - hostRect.bottom + gap;
    } else if (cellRect.top < stickyBottom + gap) {
      host.scrollTop -= stickyBottom + gap - cellRect.top;
    }
  }

  resolveNavigationPosition(rows, currentRow, currentIndex, currentColumn, direction) {
    if (direction === "ArrowLeft" || direction === "ArrowRight") {
      const delta = direction === "ArrowLeft" ? -1 : 1;
      const nextIndex = currentIndex + delta;
      return nextIndex >= 0 && nextIndex < (rows[currentRow]?.length ?? 0)
        ? { row: currentRow, index: nextIndex }
        : null;
    }

    const delta = direction === "ArrowUp" ? -1 : 1;

    for (let row = currentRow + delta; row >= 0 && row < rows.length; row += delta) {
      const index = rows[row].indexOf(currentColumn);

      if (index >= 0) {
        return { row, index };
      }
    }

    return null;
  }

  async copyCell(cell, settings = this.lastSettings) {
    const text = this.getCellCopyText(cell);

    return this.copyText(text, settings, "cell", cell);
  }

  async copyRow(row, settings = this.lastSettings) {
    const text = this.getRowCopyText(row);

    return this.copyText(text, settings, "row");
  }

  async copyText(text, settings = this.lastSettings, kind = "cell", cell = null) {

    try {
      let copied = false;

      if (globalThis.navigator?.clipboard?.writeText) {
        try {
          await globalThis.navigator.clipboard.writeText(text);
          copied = true;
        } catch {
          copied = this.copyTextFallback(text);
        }
      } else {
        copied = this.copyTextFallback(text);
      }

      if (!copied) {
        throw new Error("Clipboard API is unavailable.");
      }

      if (cell) {
        this.markCellCopied(cell, text, settings, kind);
      } else {
        settings?.onCellCopied?.(text, true, kind);
      }
      return true;
    } catch {
      settings?.onCellCopied?.(text, false, kind);
      return false;
    }
  }

  getCellCopyText(cell) {
    return String(cell?.textContent ?? "").trim();
  }

  getRowCopyText(row) {
    return Array.from(row?.children ?? [])
      .map(cell => String(cell.textContent ?? "").trim())
      .join("\t");
  }

  markCellCopied(cell, text, settings = this.lastSettings, kind = "cell") {
    cell.classList.add("is-cell-copied");
    setTimeout(() => cell.classList.remove("is-cell-copied"), 650);
    settings?.onCellCopied?.(text, true, kind);
  }

  copyTextFallback(text) {
    if (typeof document === "undefined" || typeof document.execCommand !== "function") {
      return false;
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }

  openContextMenu(cell, clientX, clientY, settings = this.lastSettings) {
    const selection = this.selectionMetadata.get(cell);

    if (!selection || selection.type !== "cell" || typeof document === "undefined") {
      return null;
    }

    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "pivot-cell-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", (settings.texts ?? TEXTS).cellActions);

    this.createContextMenuItems(selection, settings.texts ?? TEXTS, settings).forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pivot-cell-menu__item";
      button.dataset.contextAction = item.action;
      button.textContent = item.label;
      button.disabled = item.disabled;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => this.handleContextMenuAction(item.action, cell, settings));
      menu.appendChild(button);
    });

    menu.addEventListener("keydown", event => this.handleContextMenuKeydown(event, cell));
    document.body.appendChild(menu);
    this.contextMenu = menu;
    this.contextMenuCell = cell;
    this.ensureContextMenuListeners();

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin))}px`;
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    return menu;
  }

  // Two different absences, told apart on purpose. An entry whose handler is
  // missing is left out: the page cannot do that at all, and offering it would
  // be a button that does nothing. An entry whose handler exists but whose cell
  // does not qualify is shown disabled: the feature is there, this cell is
  // simply not eligible, and hiding it would make the menu change shape as the
  // reader moves around the grid.
  createContextMenuItems(selection, texts = TEXTS, settings = this.lastSettings ?? this.options) {
    const isNumeric = typeof selection?.value === "number";
    const hasDimensionPath = (selection?.rowHeader?.length ?? 0) + (selection?.columnHeader?.length ?? 0) > 0;
    const canSort = isNumeric && selection?.rowType !== "grandTotal" && selection?.rowType !== "group";

    return [
      { action: "details", label: texts.openDetails, disabled: selection?.drillDownEnabled === false },
      { action: "copy-cell", label: texts.copyCell, disabled: false },
      { action: "copy-row", label: texts.copyRow, disabled: false },
      {
        action: "sort",
        label: texts.sortByValue,
        disabled: !canSort,
        available: Boolean(settings?.onSortRequested)
      },
      {
        action: "filter",
        label: texts.filterByValue,
        disabled: !hasDimensionPath,
        available: Boolean(settings?.onCellFilterRequested)
      },
      {
        action: "conditional",
        label: texts.addConditionalFormat,
        disabled: !isNumeric || !selection?.valueKey,
        available: Boolean(settings?.onConditionalFormatRequested)
      }
    ].filter(item => item.available !== false);
  }

  handleContextMenuAction(action, cell, settings = this.lastSettings) {
    const selection = this.selectionMetadata.get(cell);
    this.closeContextMenu();

    if (!selection) {
      return;
    }

    switch (action) {
      case "details":
        this.activateCellSelection(selection, settings);
        break;
      case "copy-cell":
        void this.copyCell(cell, settings);
        break;
      case "copy-row":
        void this.copyRow(cell.closest("tr"), settings);
        break;
      case "sort":
        settings?.onSortRequested?.(this.createCellSortRequest(selection));
        break;
      case "filter":
        settings?.onCellFilterRequested?.(this.cloneSelection(selection));
        break;
      case "conditional":
        settings?.onConditionalFormatRequested?.(this.cloneSelection(selection), cell);
        break;
    }
  }

  createCellSortRequest(selection) {
    return {
      mode: "RowTotalValue",
      valueKey: selection?.valueKey ?? null,
      columnPath: selection?.columnKind === "rowTotal" ? null : [...(selection?.columnHeader ?? [])]
    };
  }

  handleContextMenuKeydown(event, cell) {
    const buttons = Array.from(this.contextMenu?.querySelectorAll("button:not(:disabled)") ?? []);
    const currentIndex = buttons.indexOf(document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      this.closeContextMenu();
      cell?.focus({ preventScroll: true });
      return;
    }

    if (event.key === "Tab") {
      this.closeContextMenu();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || buttons.length === 0) {
      return;
    }

    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
  }

  ensureContextMenuListeners() {
    if (this.contextMenuListenersWired || typeof document === "undefined") {
      return;
    }

    this.contextMenuListenersWired = true;
    document.addEventListener("pointerdown", event => {
      if (this.contextMenu && !this.contextMenu.contains(event.target)) {
        this.closeContextMenu();
      }
    }, true);
    window.addEventListener("resize", () => this.closeContextMenu());
    document.addEventListener("scroll", () => this.closeContextMenu(), true);
  }

  closeContextMenu() {
    this.contextMenu?.remove();
    this.contextMenu = null;
    this.contextMenuCell = null;
  }

  applyConditionalFormatting(table, settings = this.lastSettings) {
    const rules = Array.isArray(settings?.conditionalRules) ? settings.conditionalRules : [];
    const colorClasses = CONDITIONAL_COLORS;

    table?.querySelectorAll('[data-selection-target="cell"]').forEach(cell => {
      cell.classList.remove(...colorClasses.map(color => `is-conditional-${color}`));
      delete cell.dataset.conditionalRule;
      const selection = this.selectionMetadata.get(cell);
      const rule = [...rules].reverse().find(candidate =>
        candidate?.valueKey === selection?.valueKey && this.matchesConditionalRule(selection?.value, candidate));

      if (!rule || !colorClasses.includes(rule.color)) {
        return;
      }

      cell.classList.add(`is-conditional-${rule.color}`);
      cell.dataset.conditionalRule = rule.id ?? "rule";
    });
  }

  matchesConditionalRule(value, rule) {
    if (typeof value !== "number" || !Number.isFinite(rule?.threshold)) {
      return false;
    }

    switch (rule.operator) {
      case "greaterThan": return value > rule.threshold;
      case "greaterThanOrEqual": return value >= rule.threshold;
      case "lessThan": return value < rule.threshold;
      case "lessThanOrEqual": return value <= rule.threshold;
      case "equal": return value === rule.threshold;
      case "between": return Number.isFinite(rule.threshold2) && value >= Math.min(rule.threshold, rule.threshold2) && value <= Math.max(rule.threshold, rule.threshold2);
      default: return false;
    }
  }

  createSelectionRowKey(rowHeader) {
    return JSON.stringify(["row", rowHeader.map(value => value ?? null)]);
  }

  createSelectionCellKey(kind, columnHeader, valueKey) {
    return JSON.stringify([kind, columnHeader.map(value => value ?? null), valueKey ?? null]);
  }

  registerSelectionTarget(element, selection, targetType) {
    element.dataset.selectionTarget = targetType;
    element.tabIndex = 0;
    this.selectionMetadata.set(element, selection);

    if (targetType === "row") {
      element.dataset.selectionRowKey = selection.rowKey;
    } else {
      element.dataset.selectionRowKey = selection.rowKey;
      element.dataset.selectionCellKey = selection.cellKey;
    }
  }

  registerSelectionRow(row, selection) {
    row.dataset.selectionRowKey = selection.rowKey;
    this.selectionMetadata.set(row, selection);
  }

  setSelection(selection, settings = this.lastSettings) {
    this.selection = this.cloneSelection(selection);
    this.applySelectionState(this.currentTable);
    this.notifySelectionChanged(settings);
  }

  applySelectionState(table) {
    if (!table) {
      return;
    }

    table.querySelectorAll("tbody tr").forEach(row => {
      const isSelected = this.lastSettings?.selectionMode !== "none" &&
        Boolean(this.selection) &&
        row.dataset.selectionRowKey === this.selection.rowKey;
      row.classList.toggle("is-row-selected", isSelected);
      row.setAttribute("aria-selected", String(isSelected));
    });

    table.querySelectorAll('[data-selection-target="cell"]').forEach(cell => {
      const isSelected = this.selection?.type === "cell" &&
        cell.dataset.selectionRowKey === this.selection.rowKey &&
        cell.dataset.selectionCellKey === this.selection.cellKey;
      cell.classList.toggle("is-cell-selected", isSelected);
      cell.setAttribute("aria-selected", String(isSelected));
    });
  }

  restoreSelectedCellFocus(table) {
    if (this.selection?.type !== "cell") {
      return null;
    }

    const cell = table?.querySelector("td.is-cell-selected");

    if (!cell) {
      return null;
    }

    cell.focus({ preventScroll: true });
    this.ensureCellVisible(cell, table);
    return cell;
  }

  notifySelectionChanged(settings) {
    if (typeof settings?.onSelectionChanged === "function") {
      settings.onSelectionChanged(this.getSelection());
    }
  }

  cloneSelection(selection) {
    if (!selection) {
      return null;
    }

    return {
      ...selection,
      rowHeader: [...selection.rowHeader],
      rowIndexes: [...selection.rowIndexes],
      ...(selection.columnHeader ? { columnHeader: [...selection.columnHeader] } : {})
    };
  }

  applyColumnWidths(table) {
    for (const [columnIndex, width] of this.columnWidths.entries()) {
      table.querySelectorAll(`[data-column-index="${columnIndex}"]`).forEach(cell => {
        this.setCellWidth(cell, width);
      });
    }
  }

  wireColumnResize(table, settings) {
    table.querySelectorAll("thead th[data-column-index]").forEach(header => {
      if (header.querySelector(".pivot-table__resize-handle")) {
        return;
      }

      const handle = document.createElement("span");
      handle.className = "pivot-table__resize-handle";
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.title = (settings.texts ?? TEXTS).resizeColumn;
      header.appendChild(handle);

      handle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
      });

      handle.addEventListener("dblclick", event => {
        event.preventDefault();
        event.stopPropagation();
        this.autoFitColumn(table, Number(header.dataset.columnIndex), settings);
      });

      handle.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();

        const columnIndex = Number(header.dataset.columnIndex);
        const startX = event.clientX;
        const startWidth = header.getBoundingClientRect().width;
        const minWidth = settings.minColumnWidth ?? 72;
        const maxWidth = settings.maxColumnWidth ?? 420;

        table.classList.add("is-resizing");
        document.body.classList.add("pivot-table-resizing");
        handle.setPointerCapture?.(event.pointerId);

        const move = moveEvent => {
          const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + moveEvent.clientX - startX));
          this.columnWidths.set(columnIndex, nextWidth);
          table.querySelectorAll(`[data-column-index="${columnIndex}"]`).forEach(cell => {
            this.setCellWidth(cell, nextWidth);
          });
          this.applyStickyOffsets(
            table,
            table.tHead?.rows.length ?? 1,
            table.tHead?.rows[0]?.querySelectorAll("[data-sticky-column]").length ?? 1);
        };

        const stop = stopEvent => {
          handle.releasePointerCapture?.(stopEvent.pointerId);
          table.classList.remove("is-resizing");
          document.body.classList.remove("pivot-table-resizing");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
          this.notifyViewStateChanged();
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
      });
    });
  }

  autoFitColumn(table, columnIndex, settings) {
    const minWidth = settings.minColumnWidth ?? 72;
    const maxWidth = settings.maxColumnWidth ?? 420;
    const cells = Array.from(table.querySelectorAll(`[data-column-index="${columnIndex}"]`));
    const measurer = document.createElement("span");
    measurer.className = "pivot-table__measure-text";
    document.body.appendChild(measurer);

    const measuredWidth = cells.reduce((width, cell) => {
      return Math.max(width, this.measureCellContentWidth(cell, measurer));
    }, minWidth);

    measurer.remove();

    const nextWidth = Math.max(minWidth, Math.min(maxWidth, measuredWidth));
    this.columnWidths.set(columnIndex, nextWidth);
    cells.forEach(cell => {
      this.setCellWidth(cell, nextWidth);
    });
    this.applyStickyOffsets(
      table,
      table.tHead?.rows.length ?? 1,
      table.tHead?.rows[0]?.querySelectorAll("[data-sticky-column]").length ?? 1);
    this.notifyViewStateChanged();
  }

  notifyViewStateChanged() {
    const callback = this.lastSettings?.onViewStateChanged ?? this.options.onViewStateChanged;

    if (typeof callback === "function") {
      callback(this.getViewState());
    }
  }

  measureCellContentWidth(cell, measurer) {
    const sortLabel = cell.querySelector(".pivot-table__sort-label");
    const source = sortLabel ?? cell;
    const text = (sortLabel?.textContent ?? cell.innerText ?? cell.textContent ?? "").trim();
    const cellStyle = window.getComputedStyle(cell);
    const sourceStyle = window.getComputedStyle(source);
    const horizontalPadding =
      Number.parseFloat(cellStyle.paddingLeft || "0") +
      Number.parseFloat(cellStyle.paddingRight || "0");
    const horizontalBorder =
      Number.parseFloat(cellStyle.borderLeftWidth || "0") +
      Number.parseFloat(cellStyle.borderRightWidth || "0");
    const controlSpace = cell.querySelector(".pivot-table__sort-indicator") ? 34 : 18;

    measurer.textContent = text || "-";
    measurer.style.font = sourceStyle.font;
    measurer.style.fontWeight = sourceStyle.fontWeight;
    measurer.style.letterSpacing = sourceStyle.letterSpacing;

    return Math.ceil(measurer.getBoundingClientRect().width + horizontalPadding + horizontalBorder + controlSpace);
  }

  setCellWidth(cell, width) {
    const value = `${Math.round(width)}px`;
    cell.style.width = value;
    cell.style.minWidth = value;
    cell.style.maxWidth = value;
  }

  createGrandTotalRow(rowHeaders, columnHeaders, rowDepth, values, lookup, grandTotals, settings, columnTotals = null) {
    const row = this.createRow();
    const rowSelection = {
      type: "row",
      rowKey: "grand-total",
      rowType: "grandTotal",
      rowHeader: [],
      rowIndexes: rowHeaders.map((_, index) => index)
    };
    this.registerSelectionRow(row, rowSelection);

    for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
      const label = rowLevel === 0 ? settings.totalText : "";
      const header = this.createCell("th", label, "pivot-table__row-total-label", "rowheader");
      header.dataset.stickyColumn = String(rowLevel);
      header.dataset.columnIndex = String(rowLevel);
      this.registerSelectionTarget(header, rowSelection, "row");
      row.appendChild(header);
    }

    columnHeaders.forEach((_, columnIndex) => {
      values.forEach((valueDefinition, valueIndex) => {
        const columnValues = [];

        rowHeaders.forEach((_, rowIndex) => {
          const value = lookup.get(`${rowIndex}:${columnIndex}`)?.[valueDefinition.key] ?? null;

          if (typeof value === "number") {
            columnValues.push(value);
          }
        });

        const serverTotal = Array.isArray(columnTotals)
          ? columnTotals.find(total => total.index === columnIndex)?.values?.[valueDefinition.key]
          : undefined;
        const totalValue = Array.isArray(columnTotals)
          ? serverTotal ?? null
          : this.summarizeValues(columnValues, valueDefinition);
        const totalCell = this.createCell(
          "td",
          this.formatValue(totalValue, settings, valueDefinition),
          "pivot-table__column-total");
        totalCell.dataset.columnIndex = String(rowDepth + columnIndex * values.length + valueIndex);
        this.registerSelectionTarget(totalCell, this.createCellSelection(rowSelection, {
          kind: "column",
          columnIndex,
          columnHeader: columnHeaders[columnIndex] ?? [],
          valueKey: valueDefinition.key,
          value: totalValue
        }), "cell");
        row.appendChild(totalCell);
      });
    });

    values.forEach((valueDefinition, valueIndex) => {
      const grandTotalCell = this.createCell(
        "td",
        this.formatValue(grandTotals[valueDefinition.key], settings, valueDefinition),
        "pivot-table__grand-total");
      grandTotalCell.dataset.columnIndex = String(rowDepth + Math.max(1, columnHeaders.length) * values.length + valueIndex);
      this.registerSelectionTarget(grandTotalCell, this.createCellSelection(rowSelection, {
        kind: "rowTotal",
        columnIndex: null,
        columnHeader: [],
        valueKey: valueDefinition.key,
        value: grandTotals[valueDefinition.key]
      }), "cell");
      row.appendChild(grandTotalCell);
    });

    return row;
  }

  createCellLookup(cells) {
    return new Map((cells ?? []).map(cell => [`${cell.row}:${cell.column}`, cell.values ?? {}]));
  }

  createTotalLookup(totals) {
    return new Map((totals ?? []).map(total => [total.index, total.values ?? {}]));
  }

  createSubtotalLookup(subtotals) {
    return new Map((subtotals ?? []).map(subtotal => [
      this.createSubtotalKey(subtotal.rowHeader ?? []),
      subtotal
    ]));
  }

  applyStickyOffsets(table, headerDepth, rowDepth) {
    const firstBodyRow = table.tBodies[0]?.rows[0];
    const firstHeadRow = table.tHead?.rows[0];
    const rowHeaderWidths = [];

    for (let columnIndex = 0; columnIndex < rowDepth; columnIndex++) {
      const width = firstBodyRow?.cells[columnIndex]?.getBoundingClientRect().width
        ?? firstHeadRow?.cells[columnIndex]?.getBoundingClientRect().width
        ?? 148;
      rowHeaderWidths.push(width);
    }

    table.querySelectorAll("[data-sticky-row]").forEach(cell => {
      cell.style.setProperty("--sticky-top", "0px");
    });

    table.querySelectorAll("[data-sticky-column]").forEach(cell => {
      const level = Number(cell.dataset.stickyColumn ?? "0");
      const offset = rowHeaderWidths.slice(0, level).reduce((total, width) => total + width, 0);
      cell.style.setProperty("--sticky-left", `${offset}px`);
    });
  }

  // Declaring role="grid" on the table *replaces* the native table semantics
  // rather than adding to them, so a row or cell left without a role is a hole
  // in the accessibility tree, not a fallback. Every cell is built here so
  // there is one place that cannot be forgotten. `th` is ambiguous on its own —
  // a column header in the head, a row header in the body — so the caller says
  // which; `td` is always a cell.
  createCell(tagName, text, className, role = null) {
    const cell = document.createElement(tagName);
    cell.className = className;
    cell.textContent = text;
    cell.setAttribute("role", role ?? (tagName === "th" ? "columnheader" : "gridcell"));
    return cell;
  }

  // Merged rather than spread, or a caller overriding one string would drop
  // every other default along with it — and the renderer would render blanks
  // for every key they did not think to repeat.
  resolveTexts(options = {}) {
    return { ...TEXTS, ...(this.options.texts ?? {}), ...(options.texts ?? {}) };
  }

  createRow(className = null) {
    const row = document.createElement("tr");
    row.setAttribute("role", "row");

    if (className) {
      row.className = className;
    }

    return row;
  }

  // The glyph is the whole button, so without a name a screen reader announces
  // nothing but "button", and without aria-expanded there is no way to tell a
  // collapsed group from an expanded one.
  createSubtotalToggle(key, label) {
    const toggle = document.createElement("button");
    const collapsed = this.collapsedRows.has(key);
    toggle.className = "pivot-table__toggle";
    toggle.type = "button";
    toggle.dataset.subtotalKey = key;
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", label);
    return toggle;
  }

  // A screen reader counts the rows it can see. Under virtual scrolling that is
  // a page, not the table — "row 3 of 12" for a five-thousand-row pivot — so
  // the real position and total have to be stated outright.
  applyGridIndexes(table, virtualState) {
    const headRows = Array.from(table.tHead?.rows ?? []);
    const bodyRows = Array.from(table.tBodies[0]?.rows ?? [])
      .filter(row => !row.classList.contains("pivot-table__virtual-spacer"));
    const offset = Math.max(0, virtualState?.offset ?? 0);
    const total = Math.max(bodyRows.length, virtualState?.totalRowCount ?? bodyRows.length);

    table.setAttribute("aria-rowcount", String(headRows.length + total));
    headRows.forEach((row, index) => row.setAttribute("aria-rowindex", String(index + 1)));

    bodyRows.forEach((row, index) => {
      // The grand total is appended after the virtual window, so counting it
      // from the window's start would place it inside the page it follows.
      const position = row.dataset.selectionRowKey === "grand-total"
        ? total
        : offset + index + 1;
      row.setAttribute("aria-rowindex", String(headRows.length + position));
    });
  }

  decorateSortableHeader(cell, label, request, settings) {
    if (typeof settings.onSortRequested !== "function") {
      return;
    }

    cell.classList.add("is-sortable");
    cell.replaceChildren();

    const button = document.createElement("button");
    button.className = "pivot-table__sort-button";
    button.type = "button";
    button.title = formatText(settings.texts.sortField, label);

    const text = document.createElement("span");
    text.className = "pivot-table__sort-label";
    text.textContent = label;
    button.appendChild(text);

    const indicator = document.createElement("span");
    indicator.className = "pivot-table__sort-indicator";
    indicator.setAttribute("aria-hidden", "true");

    // The arrow glyph is aria-hidden, so without aria-sort the active sort is
    // visible and nothing more. It belongs on the header cell rather than the
    // button: the cell is what carries the columnheader role.
    if (this.isActiveSort(request, settings.sortState)) {
      const descending = settings.sortState.direction === "Descending";
      indicator.textContent = descending ? "▼" : "▲";
      button.classList.add("is-active");
      button.title = formatText(settings.texts.sortActive, label);
      cell.setAttribute("aria-sort", descending ? "descending" : "ascending");
    } else {
      indicator.textContent = "↕";
      cell.setAttribute("aria-sort", "none");
    }

    button.appendChild(indicator);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      settings.onSortRequested(request);
    });

    cell.appendChild(button);
  }

  // The funnel on a row field's header. Appended rather than replacing the
  // cell's contents, so a header can be sortable, filterable, both or neither.
  // In compact mode the row fields share one header cell, so only the first of
  // them is reachable from here -- the rest stay a designer-chip job.
  decorateFilterableHeader(cell, label, field, settings) {
    if (typeof settings.onFilterRequested !== "function" || !field) {
      return;
    }

    cell.classList.add("is-filterable");

    const button = document.createElement("button");
    button.className = "pivot-table__filter-button";
    button.type = "button";
    button.dataset.action = "header-filter";
    button.dataset.field = field;
    button.textContent = "▼";

    const active = (settings.filteredFields ?? []).includes(field);
    button.classList.toggle("is-active", active);
    button.title = formatText(
      active ? settings.texts.filterActive : settings.texts.filterField, label);
    button.setAttribute("aria-label", button.title);

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      settings.onFilterRequested(field);
    });

    cell.appendChild(button);
  }

  isActiveSort(request, sortState) {
    if (!request || !sortState || request.mode !== sortState.mode) {
      return false;
    }

    if (request.mode === "RowLabel") {
      return request.field === sortState.field;
    }

    if (request.mode === "RowTotalValue") {
      return request.valueKey === sortState.valueKey &&
        this.sameColumnPath(request.columnPath ?? null, sortState.columnPath ?? null);
    }

    return false;
  }

  sameColumnPath(left, right) {
    if (!left && !right) {
      return true;
    }

    if (!left || !right || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => value === right[index]);
  }

  createEmptyState(text) {
    const empty = document.createElement("div");
    empty.className = "pivot-table__empty";
    empty.textContent = text;
    return empty;
  }

  displayValue(value, settings) {
    if (value === null || value === undefined || value === "") {
      return settings.emptyText;
    }

    return String(value);
  }

  formatValue(value, settings, valueDefinition = null) {
    if (value === null || value === undefined) {
      return settings.emptyText;
    }

    if (typeof value !== "number") {
      return String(value);
    }

    const format = valueDefinition?.format;

    if (!format) {
      return settings.formatter.format(value);
    }

    const decimals = Number.isInteger(format.decimals) ? format.decimals : 2;
    const options = {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: format.useGrouping !== false
    };

    if (format.type === "currency") {
      options.style = "currency";
      options.currency = format.currency || "TRY";
      return new Intl.NumberFormat(settings.culture ?? undefined, options).format(value);
    }

    if (format.type === "percent") {
      options.style = "percent";
      const normalizedValue = this.isPercentShowAs(valueDefinition?.showAs) ? value : value / 100;
      return new Intl.NumberFormat(settings.culture ?? undefined, options).format(normalizedValue);
    }

    return new Intl.NumberFormat(settings.culture ?? undefined, options).format(value);
  }

  summarizeValues(values, valueDefinition) {
    if (!values || values.length === 0) {
      return null;
    }

    switch (valueDefinition.aggregation) {
      case "sum":
      case "count":
        return values.reduce((total, value) => total + value, 0);
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      default:
        return null;
    }
  }

  isPercentShowAs(showAs) {
    return showAs === "percentOfRowTotal" ||
      showAs === "percentOfColumnTotal" ||
      showAs === "percentOfGrandTotal" ||
      showAs === "percentDifferenceFromPrevious";
  }
};
})(typeof window !== "undefined" ? window : globalThis);
