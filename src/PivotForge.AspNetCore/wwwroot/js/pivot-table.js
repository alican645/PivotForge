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
  valuesHeading: "Values",
  noData: "No data",
  noValueFields: "There is nothing to render: no value field.",
  cellActions: "Cell actions",
  openDetails: "Show details",
  copyCell: "Copy cell",
  copyRow: "Copy row",
  sortByValue: "Sort rows by this column",
  sortColumnsByValue: "Sort columns by this row",
  filterByValue: "Filter by this value",
  addConditionalFormat: "Add conditional formatting",
  resizeColumn: "Resize column",
  sortField: "Sort {0}",
  sortActive: "{0} is sorted",
  filterField: "Filter {0}",
  // A header's menu: every group of that field's level at once. {0} is the
  // field's caption.
  headerActions: "Header actions",
  expandLevel: "Expand all {0}",
  collapseLevel: "Collapse all {0}",
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

// What a heatmap scale is drawn across: every value cell of a measure, or one
// row or one column of it. "none" draws nothing.
const HEATMAP_MODES = ["none", "table", "rows", "columns"];

// What the Excel export falls back to when --pt-heat-color is not a hex colour,
// and how much of it the hottest cell gets. Both mirror pivotforge.css.
const HEATMAP_COLOR = "#f97316";
const HEATMAP_STRENGTH = 0.55;

function parseHexColor(text) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(text ?? "").trim());
  return match ? [0, 2, 4].map(start => Number.parseInt(match[1].slice(start, start + 2), 16)) : null;
}

// The range each value is measured against, or null for a non-number. Each
// measure is its own range -- an amount and a count share no units -- and
// "rows" / "columns" split it further by row or column. Shared by the heatmap
// and the value bars, which read the same groups two ways.
//
// ranges, when given, are the server's valueRanges ({ valueKey, column, min,
// max }; column null for the whole table): a large-data page holds only some
// rows, and a scale drawn from those alone would draw one value differently on
// every page. A row is always whole on a page, so "rows" needs none.
function valueScaleRanges(entries, mode, ranges = []) {
  const groupOf = entry => JSON.stringify([
    entry.valueKey ?? null,
    mode === "rows" ? entry.rowKey ?? null : null,
    mode === "columns" ? entry.columnIndex ?? null : null
  ]);
  const groups = new Map();
  const widen = (key, min, max) => {
    const range = groups.get(key);
    groups.set(key, range
      ? { min: Math.min(range.min, min), max: Math.max(range.max, max) }
      : { min, max });
  };

  if (mode !== "rows" && Array.isArray(ranges)) {
    ranges
      .filter(range => Number.isFinite(range?.min) && Number.isFinite(range?.max) &&
        (mode === "table" ? range.column == null : Number.isInteger(range.column)))
      .forEach(range => widen(
        groupOf({ valueKey: range.valueKey, columnIndex: range.column }), range.min, range.max));
  }

  entries.forEach(entry => {
    if (Number.isFinite(entry.value)) {
      widen(groupOf(entry), entry.value, entry.value);
    }
  });

  return entries.map(entry => Number.isFinite(entry.value) ? groups.get(groupOf(entry)) : null);
}

// Where each value sits on its heatmap scale, from 0 (the smallest in its group)
// to 1 (the largest). A non-number gets null, and so does every value of a
// group whose values are all equal: there is no hotter or colder there.
PivotForge.heatmapLevels = function heatmapLevels(entries, mode, ranges = []) {
  if (!HEATMAP_MODES.includes(mode) || mode === "none") {
    return entries.map(() => null);
  }

  return valueScaleRanges(entries, mode, ranges).map((range, index) =>
    range && range.max > range.min
      ? (entries[index].value - range.min) / (range.max - range.min)
      : null);
};

// Each value's bar, as fractions of the cell's width: where it starts and how
// wide it is. The bars of a group share one axis at zero, as a spreadsheet's
// data bars do: all-positive values grow from the left edge, all-negative ones
// from the right, and a group holding both puts zero where it falls between
// them, negatives to its left. Unlike a heatmap, equal values still get bars --
// equally long ones -- and only a group of zeros has nothing to draw.
PivotForge.valueBarExtents = function valueBarExtents(entries, mode, ranges = []) {
  if (!HEATMAP_MODES.includes(mode) || mode === "none") {
    return entries.map(() => null);
  }

  return valueScaleRanges(entries, mode, ranges).map((range, index) => {
    if (!range) {
      return null;
    }

    const low = Math.min(0, range.min);
    const high = Math.max(0, range.max);
    if (high === low) {
      return null;
    }

    const axis = (0 - low) / (high - low);
    const end = (entries[index].value - low) / (high - low);
    return { start: Math.min(axis, end), width: Math.abs(end - axis), negative: entries[index].value < 0 };
  });
};

// Whether an element is laid out right to left -- declared with rtlEnabled or
// inherited from the page. Read from the computed style every time, because
// that is what the browser lays out by; the stylesheet is written in logical
// properties, so only what the code computes from coordinates asks this.
PivotForge.isRtl = function isRtl(element) {
  try {
    return Boolean(element) && typeof getComputedStyle === "function" &&
      getComputedStyle(element).direction === "rtl";
  } catch {
    return false;
  }
};

// Something the grid shows outside itself -- a menu, a picker, a modal -- is
// added to the page's body, which may run the other way. It takes its owner's
// direction so it reads the same way as the grid it came from.
PivotForge.matchDirection = function matchDirection(element, owner) {
  if (element && owner) {
    element.dir = PivotForge.isRtl(owner) ? "rtl" : "ltr";
  }
};

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

// Prints one element on its own. Everything else on the page is hidden for the
// length of the print -- every sibling of the element and of each of its
// ancestors, so the page's own layout around the grid is not a concern -- and
// put back afterwards. The stylesheet's @media print does the rest: the whole
// table rather than its scroll window, headers repeated on every page, colours
// kept. A title and a subtitle, when given, are printed above it.
//
// The selection is a screen affordance, not part of the report, so it is
// lifted for the print as well.
PivotForge.print = function print(element, options = {}) {
  const view = element?.ownerDocument?.defaultView;

  if (!element || typeof view?.print !== "function") {
    throw new Error("PivotForge.print requires an element in a document that can print.");
  }

  const hidden = [];
  for (let node = element; node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !sibling.hasAttribute("data-pivot-print-hidden")) {
        sibling.setAttribute("data-pivot-print-hidden", "");
        hidden.push(sibling);
      }
    }
  }

  const selected = [];
  for (const name of ["is-row-selected", "is-cell-selected"]) {
    for (const node of element.querySelectorAll(`.${name}`)) {
      node.classList.remove(name);
      selected.push([node, name]);
    }
  }

  let header = null;
  if (options.title || options.subtitle) {
    const document = element.ownerDocument;
    header = document.createElement("div");
    header.className = "pivot-print-header";
    for (const [text, className, tag] of [
      [options.title, "pivot-print-header__title", "h1"],
      [options.subtitle, "pivot-print-header__subtitle", "p"]
    ]) {
      if (text) {
        const line = document.createElement(tag);
        line.className = className;
        line.textContent = String(text);
        header.appendChild(line);
      }
    }
    element.prepend(header);
  }

  let restored = false;
  const restore = () => {
    if (restored) {
      return;
    }

    restored = true;
    view.removeEventListener?.("afterprint", restore);
    options.onRestore?.();
    hidden.forEach(node => node.removeAttribute("data-pivot-print-hidden"));
    selected.forEach(([node, name]) => node.classList.add(name));
    header?.remove();
  };

  // Put back on afterprint, not when print() returns: not every browser
  // blocks in print(), and one that does not would snapshot the page already
  // restored. A browser without the event gets the page back a moment later.
  if ("onafterprint" in view) {
    view.addEventListener("afterprint", restore);
  }

  try {
    view.print();
  } catch (error) {
    restore();
    throw error;
  }

  if (!("onafterprint" in view)) {
    view.setTimeout(restore, 1000);
  }
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

// Compact and tree both put every row field in one indented column.
function isOneColumnLayout(settings) {
  return settings?.layoutMode === "compact" || settings?.layoutMode === "tree";
}

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
      // Parallel to columnFields: the direction each column level is ordered
      // in ("Ascending", "Descending"), or null for the order the data arrived
      // in. Only marks the field header's arrow; the ordering is the server's.
      columnFieldSorts: [],
      // The row axis' half of the above, shown only while no row sort
      // (sortState) is in place: a row sort replaces every field's own order.
      rowFieldSorts: [],
      // Parallel to rowFields, following rowFieldLabels' shape. A false entry
      // means that row field starts collapsed, or produces no total.
      rowFieldExpanded: null,
      rowFieldSubtotals: null,
      // Per field, parallel to rowFields; a false entry takes that field's own
      // sort arrow or funnel away, a width sizes its column, a true wordWrap
      // lets its labels wrap instead of ending in an ellipsis.
      rowFieldAllowSorting: null,
      rowFieldAllowFiltering: null,
      rowFieldWidths: null,
      rowFieldWordWrap: null,
      subtotals: true,
      // Where a group's subtotal row goes: "before" its rows, as the group's
      // own header (the default), or "after" them, as Excel lays a report out
      // by default -- a plain header row with the toggle opens the group, and
      // the total closes it. A collapsed group is one row either way.
      totalsPosition: "before",
      // The column axis' half of the two above: a subtotal column after each
      // column group, switched grid-wide or per column field (parallel to
      // columnFields; a false entry means that level produces no total).
      columnSubtotals: true,
      columnFieldSubtotals: null,
      columnFieldAllowSorting: null,
      columnFieldAllowFiltering: null,
      columnFieldWordWrap: null,
      // Parallel to columnFields, as rowFieldExpanded is to rowFields: a false
      // entry means that column field's groups start collapsed, each to the one
      // column holding its total.
      columnFieldExpanded: null,
      valueKey: null,
      values: null,
      aggregation: "sum",
      sortState: null,
      // The column axis' value sort ({ valueKey, rowPath, direction }), set
      // from "sort columns by this row". Only marks the arrow; the ordering is
      // the server's.
      columnSortState: null,
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
      // A colour scale over the value cells: "table", "rows", "columns" or
      // "none". Totals and subtotals are left out -- they would always be the
      // hottest cells and flatten the scale for everything else. A conditional
      // rule's colour wins over the scale on the cells it matches.
      heatmap: "none",
      // Bars behind the value cells, their length the value's share of its
      // group's range; grouped like the heatmap.
      valueBars: "none",
      // DevExtreme names a grand total after the area its header sits in, and
      // so does this: showGrandTotal is the total *row* along the bottom (the
      // row grand total), showColumnGrandTotals the total *column* on the right.
      // The payload names them the other way round -- rowTotals feeds that right
      // column -- because it names what each total sums, not where it is drawn.
      showGrandTotal: true,
      showColumnGrandTotals: true,
      virtualState: null,
      restoreSelectionFocus: true,
      onSelectionChanged: null,
      layoutMode: "tabular",
      // Where several values are drawn: "columns", a block of value columns
      // under every column header, or "rows", one row per value under every
      // row header (DevExtreme's dataFieldArea: "row"). One value has no
      // header of its own either way, so it changes nothing then.
      valuesPosition: "columns",
      // Draw only the columns around what the container shows, with a spacer
      // standing in for the rest (DevExtreme's virtual scrolling, columns).
      // virtualColumnWidth is the first guess at a value column's width; after
      // the first draw the spacers use the width the columns came out at.
      virtualColumns: false,
      virtualColumnWidth: 100,
      repeatRowLabels: false,
      // Cell lines: null keeps the default grid (lines between cells, none
      // round the outside), true closes it with an outer frame, false takes
      // the lines between body cells away and keeps the header's.
      showBorders: null,
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
    const columnSubtotals = result?.columnSubtotals ?? null;
    const grandTotals = result?.grandTotals ?? {};
    const values = this.resolveValues(settings, cells, grandTotals);
    const valuesOnRows = settings.valuesPosition === "rows" && values.length > 1;
    // The values column a rows layout adds after the row headers; every data
    // column index starts after it (dataStart).
    this.measureColumns = valuesOnRows ? 1 : 0;
    // What the column axis is drawn for: every value, or in a rows layout one
    // slot that each body row fills with its own value.
    const columnValues = valuesOnRows ? [this.createValueSlot(values)] : values;

    this.container.classList.add("pivot-table");
    this.container.classList.toggle("is-virtual", Boolean(settings.virtualState));
    this.closeContextMenu();
    this.activeColumnWindow = null;

    if (values.length === 0) {
      this.container.replaceChildren(this.createEmptyState(settings.texts.noValueFields));
      return;
    }

    this.collapsedColumns ??= new Set();
    this.applyInitialColumnCollapse(columnHeaders, settings);
    const columnDepth = Math.max(1, ...columnHeaders.map(header => header.length));
    const measureDepth = columnValues.length > 1 ? 1 : 0;
    const headerDepth = columnDepth + measureDepth;
    const actualRowDepth = Math.max(1, ...rowHeaders.map(header => header.length));
    const rowDepth = isOneColumnLayout(settings) ? 1 : actualRowDepth;
    const lookup = this.createCellLookup(cells);
    this.collapsedRows ??= new Set();
    this.applyInitialCollapse(rowHeaders, actualRowDepth, settings);
    this.selectionMetadata = new WeakMap();
    this.renderedDataStart = this.dataStart(rowDepth);
    this.renderedValueSpan = columnValues.length;
    // Read before anything is drawn: head and body slice the same window.
    this.activeColumnWindow = this.resolveColumnWindow(
      this.createColumnPlan(columnHeaders, settings), columnValues.length, settings);
    const table = document.createElement("table");
    // A tree is the compact layout drawn as a tree, so it carries both classes
    // and inherits every compact rule.
    table.className = settings.layoutMode === "tree"
      ? "pivot-table__table is-compact is-tree"
      : `pivot-table__table is-${settings.layoutMode}`;
    if (settings.showBorders === true || settings.showBorders === false) {
      table.classList.add(settings.showBorders ? "is-bordered" : "is-borderless");
    }
    // The renderer already ships the whole grid keyboard contract — arrow keys,
    // Enter, Ctrl+C, a roving tabindex and cell selection. Declaring the role is
    // what makes that contract discoverable, and what makes the aria-selected
    // already written on rows and cells mean anything: on a plain table it is
    // an unsupported attribute that screen readers drop.
    table.setAttribute("role", "grid");
    table.setAttribute("aria-multiselectable", "false");
    table.setAttribute("aria-label", settings.ariaLabel);

    table.appendChild(this.createTableHead(columnHeaders, columnDepth, measureDepth, rowDepth, columnValues, settings));
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
      subtotals,
      columnSubtotals));
    // A page holds rows of the pivot, and a rows layout draws each of them
    // once per value, so the rows a spacer stands in for are that much taller.
    const virtualState = valuesOnRows && settings.virtualState
      ? { ...settings.virtualState, rowHeight: Math.max(24, settings.virtualState.rowHeight ?? 36) * values.length }
      : settings.virtualState;
    this.applyVirtualSpacers(table, virtualState, rowDepth, columnHeaders, columnValues, settings);
    // After the spacers, so the rows they insert are excluded from the count.
    this.applyGridIndexes(table, settings.virtualState);

    // Swapping the table must not lose the horizontal position the window was
    // computed from.
    const scrollLeft = this.activeColumnWindow ? this.container.scrollLeft : null;
    this.container.replaceChildren(table);
    if (scrollLeft !== null) {
      this.container.scrollLeft = scrollLeft;
    }
    this.currentTable = table;
    this.wireSubtotalToggles(table, result, options);
    this.wireSelection(table, settings);
    this.applySelectionState(table);
    this.applyHeatmap(table, settings);
    this.applyValueBars(table, settings);
    this.applyConditionalFormatting(table, settings);
    this.applyDeclaredWidths(
      table, settings, rowDepth, Math.max(1, this.createColumnPlan(columnHeaders, settings).length), columnValues);
    this.applyWordWrap(table, settings, columnValues);
    this.applyColumnWidths(table);
    this.wireColumnResize(table, settings);
    this.applyStickyOffsets(table, headerDepth, rowDepth + this.measureColumns);
    this.wireVirtualColumnScroll(settings);
    // A redraw the scroll itself asked for must not pull the view back to the
    // selected cell, or scrolling away from it would be impossible.
    if (settings.restoreSelectionFocus && !this.scrollRerender) {
      this.restoreSelectedCellFocus(table);
    }
    // Last: it may draw the grid again, and nothing after it should touch
    // the table this call built.
    this.measureColumnWindow(table);
  }

  // --- Virtual columns -------------------------------------------------------
  // Only the plan positions around what the container shows are drawn, one
  // page of them on either side of it; a spacer before and after keeps the
  // table as wide as it would be whole. Positions stay absolute, so a column
  // keeps its index, its width and its selection key wherever the window is.

  virtualColumnWidth(settings) {
    return Math.max(24, Number(settings?.virtualColumnWidth) || 100);
  }

  resolveColumnWindow(plan, valueSpan, settings) {
    if (!settings.virtualColumns || this.columnWindowSuspended || plan.length === 0) {
      this.columnWindowState = null;
      return null;
    }

    // One plan position's width: measured from the last draw once there was
    // one, so the spacers and the window follow what the browser laid out --
    // a long header widens a column past any estimate. The declared width is
    // only the first guess.
    const width = this.measuredPositionWidth ?? this.virtualColumnWidth(settings) * Math.max(1, valueSpan);
    // Negative in RTL, where the content scrolls the other way.
    const scroll = Math.abs(this.container?.scrollLeft ?? 0);
    const view = Math.max(width, this.container?.clientWidth || 1200);
    const pageSize = Math.max(1, Math.ceil(view / width));
    const first = Math.floor(scroll / width);
    const start = Math.max(0, Math.min(first - pageSize, plan.length - pageSize));
    const end = Math.min(plan.length, Math.max(start, first) + 2 * pageSize);

    this.columnWindowState = { start, end, total: plan.length, width, pageSize };
    return {
      plan: plan.slice(start, end).map((entry, index) => ({ ...entry, position: start + index })),
      offset: start,
      before: start,
      after: plan.length - end
    };
  }

  // Stands in for `count` plan positions, at the width the window counts with.
  createColumnSpacer(tagName, count, valueSpan, settings) {
    const cell = this.createCell(tagName, "", "pivot-table__virtual-column", "presentation");
    const positionWidth = this.columnWindowState?.width ?? valueSpan * this.virtualColumnWidth(settings);
    const width = `${Math.round(count * positionWidth)}px`;
    cell.setAttribute("aria-hidden", "true");
    cell.style.width = width;
    cell.style.minWidth = width;
    cell.style.maxWidth = width;
    return cell;
  }

  appendColumnSpacer(row, side, valueSpan, settings) {
    const count = this.activeColumnWindow?.[side] ?? 0;
    if (count > 0) {
      row.appendChild(this.createColumnSpacer("td", count, valueSpan, settings));
    }
  }

  // How wide one plan position came out, from the first body row's drawn
  // value columns. When it is well off what the window counted with, the grid
  // is drawn once more with it, so the spacers match the columns they replace.
  measureColumnWindow(table) {
    const state = this.columnWindowState;
    const window = this.activeColumnWindow;
    const row = table.tBodies[0]?.rows[0];

    if (!state || !window || !row || window.plan.length === 0) {
      return;
    }

    const first = this.renderedDataStart + window.offset * this.renderedValueSpan;
    const last = first + window.plan.length * this.renderedValueSpan;
    let total = 0;

    for (const cell of row.cells) {
      const index = Number(cell.dataset.columnIndex);
      if (index >= first && index < last) {
        total += cell.getBoundingClientRect?.().width ?? 0;
      }
    }

    const measured = total / window.plan.length;
    if (!(measured > 0)) {
      return;
    }

    this.measuredPositionWidth = measured;
    if (Math.abs(measured - state.width) / state.width > 0.1 && !this.remeasuring) {
      this.remeasuring = true;
      try {
        this.rerenderForScroll();
      } finally {
        this.remeasuring = false;
      }
    }
  }

  // Wired once per renderer: redraws when the view nears the window's edge.
  wireVirtualColumnScroll(settings) {
    if (!settings.virtualColumns || this.virtualScrollWired || typeof this.container?.addEventListener !== "function") {
      return;
    }

    this.virtualScrollWired = true;
    this.container.addEventListener("scroll", () => {
      const state = this.columnWindowState;
      if (!state || this.virtualFramePending) {
        return;
      }

      const first = Math.floor(Math.abs(this.container.scrollLeft) / state.width);
      const margin = Math.ceil(state.pageSize / 2);
      const nearStart = state.start > 0 && first < state.start + margin;
      const nearEnd = state.end < state.total && first + state.pageSize > state.end - margin;

      if (!nearStart && !nearEnd) {
        return;
      }

      this.virtualFramePending = true;
      const run = () => {
        this.virtualFramePending = false;
        this.rerenderForScroll();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 0);
      }
    }, { passive: true });
  }

  // The redraw replaces the cell that had focus -- often the one a click
  // just scrolled into view -- so focus goes back to the selected cell, where
  // it was, without moving the view to it.
  rerenderForScroll() {
    const hadFocus = typeof document !== "undefined" && Boolean(this.container?.contains?.(document.activeElement));
    this.scrollRerender = true;
    try {
      this.rerenderLast();
    } finally {
      this.scrollRerender = false;
    }

    if (hadFocus) {
      this.currentTable?.querySelector("td.is-cell-selected")?.focus({ preventScroll: true });
    }
  }

  // An arrow key at the window's edge: the next column is not drawn yet, so
  // the view moves to it and the grid redraws before focus lands there.
  // Undefined when the ordinary navigation can handle the move.
  moveAcrossColumnWindow(table, currentCell, step, settings) {
    const state = this.columnWindowState;
    const valueSpan = this.renderedValueSpan;
    const first = this.renderedDataStart;
    const desired = Number(currentCell.dataset.columnIndex) + step;
    const row = currentCell.closest("tr");

    if (!state || !row || !(desired >= first && desired < first + state.total * valueSpan) ||
        row.querySelector(`[data-column-index="${desired}"]`)) {
      return undefined;
    }

    const rowIndex = Array.from(table.tBodies[0]?.rows ?? []).indexOf(row);
    const position = Math.floor((desired - first) / valueSpan);
    const target = Math.max(0, position * state.width - (this.container.clientWidth - state.width) / 2);
    this.container.scrollLeft = PivotForge.isRtl(this.container) ? -target : target;
    this.rerenderForScroll();

    const next = this.currentTable?.tBodies[0]?.rows[rowIndex]
      ?.querySelector(`[data-selection-target="cell"][data-column-index="${desired}"]`);
    if (!next) {
      return currentCell;
    }

    this.setSelection(this.selectionMetadata.get(next), settings);
    next.focus({ preventScroll: true });
    this.ensureCellVisible(next, this.currentTable);
    return next;
  }

  // Printing shows the whole table, so the window steps aside until it is done.
  suspendColumnWindow() {
    if (!this.columnWindowState) {
      return false;
    }

    this.columnWindowSuspended = true;
    this.rerenderLast();
    return true;
  }

  resumeColumnWindow() {
    if (!this.columnWindowSuspended) {
      return;
    }

    this.columnWindowSuspended = false;
    this.rerenderLast();
  }

  // An export is of the whole table, as DevExtreme's skips its virtual cut: a
  // copy of this renderer draws it without the window, off screen, and the
  // model is read from that.
  exportModelWithAllColumns(options) {
    const host = document.createElement("div");
    host.dir = PivotForge.isRtl(this.container) ? "rtl" : "ltr";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden;max-height:none;";
    document.body.appendChild(host);

    try {
      const copy = new this.constructor(host, { ...this.options, virtualColumns: false, restoreSelectionFocus: false });
      copy.collapsedRows = new Set(this.collapsedRows ?? []);
      copy.collapsedColumns = new Set(this.collapsedColumns ?? []);
      copy.columnWidths = new Map(this.columnWidths);
      copy.initialCollapseApplied = true;
      copy.initialColumnCollapseApplied = true;
      copy.render(this.lastResult, { ...(this.lastOptions ?? {}), virtualColumns: false, restoreSelectionFocus: false });
      return copy.getExcelExportModel(options);
    } finally {
      host.remove();
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

  // The column axis' half of applyInitialCollapse, under the same rule: once
  // per renderer, after which the collapse set belongs to the user.
  applyInitialColumnCollapse(columnHeaders, settings) {
    if (this.initialColumnCollapseApplied) {
      return;
    }

    this.initialColumnCollapseApplied = true;

    const declared = settings.columnFieldExpanded;
    if (!Array.isArray(declared)) {
      return;
    }

    const levels = declared
      .map((expanded, level) => (expanded === false ? level : -1))
      .filter(level => level >= 0);

    this.columnGroupKeys(columnHeaders, levels)
      .forEach(key => this.collapsedColumns.add(key));
  }

  // Every column group at the given levels, by the key its toggle carries. The
  // innermost level has no groups: its columns are the leaves.
  columnGroupKeys(columnHeaders, levels) {
    const depth = Math.max(0, ...(columnHeaders ?? []).map(header => header.length));
    const keys = new Set();

    for (const header of columnHeaders ?? []) {
      for (const level of levels) {
        if (level < depth - 1 && level < header.length) {
          keys.add(this.createSubtotalKey(header.slice(0, level + 1)));
        }
      }
    }

    return [...keys];
  }

  // Rows only by default, which is what these did before columns could
  // collapse; { axis: "column" } or { axis: "all" } reaches the column groups.
  expandAll(options = {}) {
    const axis = options.axis ?? "row";

    if (axis !== "column") {
      this.collapsedRows?.clear();
    }

    if (axis !== "row") {
      this.collapsedColumns?.clear();
    }

    this.rerenderLast();
    this.notifyViewStateChanged();
  }

  collapseAll(options = {}) {
    const result = this.lastResult;
    const settings = this.lastSettings;
    const axis = options.axis ?? "row";

    if (!result || !settings) {
      return;
    }

    if (axis !== "column") {
      const rowHeaders = result.rowHeaders ?? [];
      const rowDepth = Math.max(1, ...rowHeaders.map(header => header.length));
      const plan = this.createRowPlan(rowHeaders, rowDepth, settings);
      this.collapsedRows = new Set(plan
        .filter(row => row.type === "subtotal" || row.type === "group")
        .map(row => row.key));
    }

    if (axis !== "row") {
      const columnHeaders = result.columnHeaders ?? [];
      const depth = Math.max(0, ...columnHeaders.map(header => header.length));
      this.collapsedColumns = new Set(this.columnGroupKeys(
        columnHeaders, Array.from({ length: Math.max(0, depth - 1) }, (_, level) => level)));
    }

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
      collapsedGroups: [...(this.collapsedRows ?? new Set())],
      collapsedColumnGroups: [...(this.collapsedColumns ?? new Set())]
    };
  }

  getExcelExportModel(options = {}) {
    const table = this.currentTable;

    if (!table) {
      return null;
    }

    if (this.activeColumnWindow && this.lastResult && typeof document !== "undefined") {
      return this.exportModelWithAllColumns(options);
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
      // Written only for a right-to-left grid, so every other model is unchanged.
      ...(PivotForge.isRtl(table) ? { rightToLeft: true } : {}),
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
      highlight: this.getExcelCellHighlight(cell),
      fillColor: this.getExcelCellFillColor(cell),
      source: this.getExportCellSource(cell, row, selection)
    };
  }

  // What an "exporting" handler needs to recognise a cell without reading the
  // DOM: which part of the table it came from and, for a value, which measure
  // and coordinate. The widget strips it before the document is posted.
  getExportCellSource(cell, row, selection) {
    const area = row?.parentElement?.tagName === "THEAD"
      ? "column"
      : selection?.type === "cell" ? "data" : cell.tagName === "TH" ? "row" : "data";

    return {
      area,
      rowType: selection?.rowType ?? null,
      rowPath: selection?.rowHeader ? [...selection.rowHeader] : null,
      columnPath: selection?.columnHeader ? [...selection.columnHeader] : null,
      valueKey: selection?.valueKey ?? null,
      value: selection?.type === "cell" ? selection.value ?? null : null
    };
  }

  // The heatmap shade, mixed the way the stylesheet mixes it but over white:
  // the sheet has no panel colour. A conditional highlight wins, as on screen,
  // and the exporter applies that rule too.
  getExcelCellFillColor(cell) {
    if (!cell.classList.contains("is-heat") || this.getExcelCellHighlight(cell) !== "None") {
      return null;
    }

    const level = Number.parseFloat(cell.style?.getPropertyValue?.("--pt-heat"));
    const style = typeof getComputedStyle === "function" ? getComputedStyle(cell) : null;
    const heat = parseHexColor(style?.getPropertyValue("--pt-heat-color")) ?? parseHexColor(HEATMAP_COLOR);

    if (!Number.isFinite(level)) {
      return null;
    }

    const share = Math.max(0, Math.min(1, level)) * HEATMAP_STRENGTH;
    return "#" + heat
      .map(channel => Math.round(channel * share + 255 * (1 - share)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
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
    if (cell.classList.contains("pivot-table__column-subtotal")) return "Subtotal";
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

    let positive = numberPattern;

    if (format.type === "percent") {
      positive = `${numberPattern}%`;
    } else if (format.type === "currency") {
      const symbol = { TRY: "₺", USD: "$", EUR: "€", GBP: "£" }[format.currency ?? "TRY"] ?? format.currency ?? "";
      positive = `${symbol}${numberPattern}`;
    }

    // Excel's own sections -- positive;negative;zero -- carry the parentheses and
    // the zero text, so the workbook keeps real numbers and still reads like the
    // grid. A compact number has no locale-neutral Excel spelling, so the
    // workbook keeps the full figure.
    const parentheses = format.negative === "parentheses";
    const zeroText = typeof format.zeroText === "string" ? format.zeroText : null;

    if (!parentheses && zeroText === null) {
      return positive;
    }

    const negative = parentheses ? `(${positive})` : `-${positive}`;
    return zeroText === null
      ? `${positive};${negative}`
      : `${positive};${negative};"${zeroText.replace(/"/g, '""')}"`;
  }

  applyViewState(state, options = {}) {
    const { rerender = true, notify = true } = options;
    const widths = Array.isArray(state?.columnWidths) ? state.columnWidths : [];
    const collapsedGroups = Array.isArray(state?.collapsedGroups) ? state.collapsedGroups : [];
    const collapsedColumnGroups = Array.isArray(state?.collapsedColumnGroups) ? state.collapsedColumnGroups : [];

    this.columnWidths = new Map(widths
      .filter(entry => Array.isArray(entry) && Number.isInteger(entry[0]) && Number.isFinite(entry[1]))
      .map(([columnIndex, width]) => [columnIndex, width]));
    this.collapsedRows = new Set(collapsedGroups.filter(key => typeof key === "string"));
    this.collapsedColumns = new Set(collapsedColumnGroups.filter(key => typeof key === "string"));
    // A restored view state is a decision the user already made, so the declared
    // initial state must not overwrite it on the render that follows.
    this.initialCollapseApplied = true;
    this.initialColumnCollapseApplied = true;

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
        showAs: value.showAs ?? "normal",
        showGrandTotals: value.showGrandTotals !== false,
        allowSorting: value.allowSorting !== false,
        width: value.width ?? null,
        wordWrap: value.wordWrap === true,
        customizeText: value.customizeText ?? null
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

  // The one value a rows layout draws its columns for. It stands for every
  // value, so it names none: its header is blank, it sorts nothing, and the
  // total column on the right is there while any value keeps its total.
  createValueSlot(values) {
    return {
      ...values[0],
      label: "",
      slot: true,
      showGrandTotals: values.some(value => value.showGrandTotals !== false),
      allowSorting: false,
      width: null,
      wordWrap: false
    };
  }

  // The index of the first data column: after the row headers and, in a rows
  // layout, the values column.
  dataStart(rowDepth) {
    return rowDepth + (this.measureColumns ?? 0);
  }

  // The values that keep a column in the grand total block on the right. A
  // value opting out of its grand totals loses that column outright rather than
  // keeping an empty one; switching the block off grid-wide leaves none at all.
  totalColumnValues(values, settings) {
    return settings.showColumnGrandTotals === false
      ? []
      : values.filter(value => value.showGrandTotals !== false);
  }

  // A value opting out loses only its column on the right, as in DevExtreme:
  // its cells in the bottom row total a column of the grid, not the value
  // itself, and the other values' totals share that row anyway. Only when every
  // value has opted out does the row go too, since then no grand total is left.
  showsGrandTotalRow(values, settings) {
    return settings.showGrandTotal !== false && values.some(value => value.showGrandTotals !== false);
  }

  columnCount(rowDepth, columnHeaders, values, settings) {
    const window = this.activeColumnWindow;
    const planColumns = window
      ? window.plan.length * values.length + (window.before > 0 ? 1 : 0) + (window.after > 0 ? 1 : 0)
      : Math.max(1, this.createColumnPlan(columnHeaders, settings).length) * values.length;

    return this.dataStart(rowDepth) + planColumns + this.totalColumnValues(values, settings).length;
  }

  // The columns in the order they are drawn, each a block of one cell per
  // value: the engine's columns, with a subtotal column closing each group
  // whose level carries totals. The column axis' counterpart of
  // createRowPlan, except a total follows its group rather than heading it,
  // as in DevExtreme and Excel. A collapsed group is its total alone: one
  // subtotal column marked collapsed, drawn whether or not its level carries
  // totals, since otherwise the group would leave nothing on screen.
  createColumnPlan(columnHeaders, settings) {
    const items = (columnHeaders ?? []).map((columnHeader, columnIndex) => ({ columnHeader, columnIndex }));
    const depth = Math.max(0, ...items.map(item => item.columnHeader.length));
    const plan = [];
    this.appendColumnGroups(plan, items, 0, depth, settings ?? {});
    return plan;
  }

  appendColumnGroups(plan, items, level, depth, settings) {
    if (level >= depth - 1) {
      for (const item of items) {
        plan.push({ type: "detail", columnIndex: item.columnIndex, columnHeader: item.columnHeader });
      }

      return;
    }

    const withTotals = this.columnSubtotalsAt(level, settings);

    // Runs of neighbours rather than every match: the head draws a group as
    // one spanning cell, so only adjacent columns can share it.
    for (const run of this.columnRuns(items, level)) {
      const columnHeader = run[0].columnHeader.slice(0, level + 1);

      if (this.collapsedColumns?.has(this.createSubtotalKey(columnHeader))) {
        plan.push({
          type: "subtotal",
          collapsed: true,
          level,
          columnHeader,
          columnIndexes: run.map(item => item.columnIndex)
        });
        continue;
      }

      this.appendColumnGroups(plan, run, level + 1, depth, settings);

      if (withTotals) {
        plan.push({
          type: "subtotal",
          level,
          columnHeader,
          columnIndexes: run.map(item => item.columnIndex)
        });
      }
    }
  }

  columnRuns(items, level) {
    const runs = [];
    let key = null;

    for (const item of items) {
      const itemKey = JSON.stringify(item.columnHeader.slice(0, level + 1));

      if (runs.length > 0 && itemKey === key) {
        runs.at(-1).push(item);
      } else {
        runs.push([item]);
        key = itemKey;
      }
    }

    return runs;
  }

  columnSubtotalsAt(level, settings) {
    if (settings.columnSubtotals === false) {
      return false;
    }

    const perField = settings.columnFieldSubtotals;
    return !Array.isArray(perField) || perField[level] !== false;
  }

  createTableHead(columnHeaders, columnDepth, measureDepth, rowDepth, values, settings) {
    const thead = document.createElement("thead");
    thead.setAttribute("role", "rowgroup");
    const valueSpan = values.length;
    const totalValues = this.totalColumnValues(values, settings);
    const fullPlan = this.createColumnPlan(columnHeaders, settings);
    // With virtual columns only the window is drawn; positions stay absolute,
    // so a column keeps its index -- and its width -- wherever the window is.
    const columnWindow = this.activeColumnWindow;
    const columnPlan = columnWindow ? columnWindow.plan : fullPlan;
    const offset = columnWindow?.offset ?? 0;
    const planWidth = Math.max(1, fullPlan.length);
    const spacer = side => columnWindow?.[side] > 0
      ? this.createColumnSpacer("th", columnWindow[side], valueSpan, settings)
      : null;
    const spacerCount = (columnWindow?.before > 0 ? 1 : 0) + (columnWindow?.after > 0 ? 1 : 0);
    // A column header names a value -- "2024" -- never the field behind it, so
    // there is nowhere to hang a sort arrow or a funnel the way the row axis
    // hangs them on its corner. The field names get a cell of their own in the
    // corner block, one per column level, which pushes the row field names down
    // to a row of their own. Drawn only when there is a field to name and
    // something to do with it -- sorting or filtering -- so a table with
    // neither keeps the shape it always had.
    const columnFields = settings.columnFields ?? [];
    const namesColumnFields = columnFields.length > 0 && (
      typeof settings.onFilterRequested === "function" ||
      typeof settings.onSortRequested === "function");
    const rowFieldRow = namesColumnFields ? this.createRow() : null;

    const appendRowFieldHeaders = row => {
      for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
        const label = settings.rowFieldLabels[rowLevel] ?? (rowDepth === 1
          ? settings.texts.rowsHeading
          : formatText(settings.texts.rowHeading, rowLevel + 1));
        // One header over every row field. A tree names its levels, as its
        // rows are those levels; compact keeps the spreadsheet's "Row Labels".
        const treeLabel = (settings.rowFieldLabels ?? []).filter(Boolean).join(" / ");
        const displayLabel = settings.layoutMode === "tree" && treeLabel
          ? treeLabel
          : isOneColumnLayout(settings)
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

      if (this.measureColumns > 0) {
        const corner = this.createCell("th", settings.texts.valuesHeading, "pivot-table__corner pivot-table__values-corner");
        corner.rowSpan = namesColumnFields ? 1 : columnDepth + measureDepth;
        corner.dataset.stickyColumn = String(rowDepth);
        corner.dataset.columnIndex = String(rowDepth);
        row.appendChild(corner);
      }
    };

    // The corner cell of a column level's own row: it names the field whose
    // values that row shows, and carries that field's sort arrow and funnel.
    // The arrow orders the level's own values -- 2023, 2024 or 2024, 2023 --
    // which is the column axis' half of what a row field's arrow does.
    const appendColumnFieldHeader = (row, level) => {
      const field = columnFields[level] ?? null;
      const label = settings.columnFieldLabels?.[level] ?? field ?? "";
      const cell = this.createCell("th", label, "pivot-table__corner pivot-table__column-field");
      cell.colSpan = this.dataStart(rowDepth);
      cell.dataset.stickyColumn = "0";
      if (field) {
        this.decorateSortableHeader(cell, label, { mode: "ColumnLabel", field }, settings);
      }
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

      const groups = this.createColumnHeaderGroups(columnPlan, level);
      const before = spacer("before");
      if (before) {
        row.appendChild(before);
      }

      for (const group of groups) {
        if (group.subtotal) {
          // Its own label down to the value headers: the levels below
          // belong to the columns it totals, not to it. A collapsed group
          // keeps its plain name, as a collapsed row group does: the column
          // is the group, folded, rather than a total beside it.
          const label = group.collapsed
            ? this.displayValue(group.value, settings)
            : `${this.displayValue(group.value, settings)} ${settings.totalText}`;
          const header = this.createCell(
            "th", label, "pivot-table__column-header pivot-table__column-subtotal-header");
          header.colSpan = valueSpan;
          header.rowSpan = columnDepth - level;
          header.dataset.stickyRow = String(level);
          header.dataset.columnStart = String(this.dataStart(rowDepth) + (offset + group.start) * valueSpan);
          if (measureDepth === 0 && values.length === 1 && !values[0].slot) {
            this.decorateSortableHeader(header, label, {
              mode: "RowTotalValue",
              valueKey: values[0].key,
              columnPath: columnPlan[group.start]?.columnHeader ?? []
            }, settings);
          }
          if (group.collapsed) {
            header.classList.add("is-collapsed");
            header.prepend(this.createSubtotalToggle(
              this.createSubtotalKey(columnPlan[group.start].columnHeader), label, "column"));
          }
          row.appendChild(header);
          continue;
        }

        const header = this.createCell("th", this.displayValue(group.value, settings), "pivot-table__column-header");
        header.colSpan = group.span * valueSpan;
        header.dataset.stickyRow = String(level);
        header.dataset.columnStart = String(this.dataStart(rowDepth) + (offset + group.start) * valueSpan);

        if (group.value === null || group.value === undefined || group.value === "") {
          header.classList.add("is-empty");
        }

        // With a single value there is no value-header row underneath, so the
        // innermost column header is the only cell naming that column: it takes
        // the sort-rows-by-this-column arrow the value header carries otherwise.
        if (measureDepth === 0 && values.length === 1 && !values[0].slot && level === columnDepth - 1 &&
            columnHeaders.length > 0) {
          this.decorateSortableHeader(header, this.displayValue(group.value, settings), {
            mode: "RowTotalValue",
            valueKey: values[0].key,
            columnPath: columnPlan[group.start]?.columnHeader ?? []
          }, settings);
        }

        // Every level but the innermost is a group of columns, and folds.
        if (level < columnDepth - 1 && columnHeaders.length > 0) {
          header.prepend(this.createSubtotalToggle(
            this.createSubtotalKey(columnPlan[group.start].columnHeader.slice(0, level + 1)),
            this.displayValue(group.value, settings),
            "column"));
        }

        row.appendChild(header);
      }

      const after = spacer("after");
      if (after) {
        row.appendChild(after);
      }

      if (level === 0 && totalValues.length > 0) {
        const total = this.createCell("th", settings.totalText, "pivot-table__measure-header");
        total.colSpan = totalValues.length;
        total.rowSpan = columnDepth;
        total.dataset.stickyRow = "0";
        total.dataset.columnStart = String(this.dataStart(rowDepth) + planWidth * valueSpan);
        if (measureDepth === 0 && values.length === 1 && !values[0].slot) {
          total.dataset.columnIndex = total.dataset.columnStart;
          this.decorateSortableHeader(total, settings.totalText, {
            mode: "RowTotalValue",
            valueKey: totalValues[0].key
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
        filler.colSpan = this.dataStart(rowDepth);
        filler.dataset.stickyColumn = "0";
        measureRow.appendChild(filler);
      }

      const before = spacer("before");
      if (before) {
        measureRow.appendChild(before);
      }

      for (let index = 0; index < (columnWindow ? columnPlan.length : planWidth); index++) {
        const entry = columnPlan[index];
        const position = offset + index;
        const isSubtotal = entry?.type === "subtotal";

        values.forEach((value, valueIndex) => {
          const cell = this.createCell(
            "th",
            value.label,
            isSubtotal
              ? "pivot-table__value-header pivot-table__column-subtotal-value-header"
              : "pivot-table__value-header");
          cell.dataset.stickyRow = String(columnDepth);
          cell.dataset.columnIndex = String(this.dataStart(rowDepth) + position * valueSpan + valueIndex);
          cell.dataset.valueKey = value.key;
          // A subtotal column's path is its group's prefix, which the engine
          // reads as that group's subtotal.
          this.decorateSortableHeader(cell, value.label, {
            mode: "RowTotalValue",
            valueKey: value.key,
            columnPath: entry?.columnHeader ?? []
          }, settings);
          measureRow.appendChild(cell);
        });
      }

      const after = spacer("after");
      if (after) {
        measureRow.appendChild(after);
      }

      totalValues.forEach((value, valueIndex) => {
        const totalCell = this.createCell("th", value.label, "pivot-table__value-header pivot-table__total-value-header");
        totalCell.dataset.stickyRow = String(columnDepth);
        totalCell.dataset.columnIndex = String(this.dataStart(rowDepth) + planWidth * valueSpan + valueIndex);
        totalCell.dataset.valueKey = value.key;
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
      filler.colSpan = (columnWindow ? columnPlan.length : planWidth) * valueSpan + spacerCount + totalValues.length;
      rowFieldRow.appendChild(filler);
      thead.appendChild(rowFieldRow);
    }

    return thead;
  }

  // One head row's cells, read off the column plan. A detail column, or a
  // subtotal of a deeper level, joins the run of its group at this level; a
  // subtotal of this level is a cell of its own; one of a shallower level
  // already reaches down past this row and takes no cell here.
  createColumnHeaderGroups(columnPlan, level) {
    if (columnPlan.length === 0) {
      return [{ value: null, span: 1, start: 0 }];
    }

    const groups = [];
    let current = null;

    columnPlan.forEach((entry, position) => {
      if (entry.type === "subtotal" && entry.level < level) {
        current = null;
        return;
      }

      if (entry.type === "subtotal" && entry.level === level) {
        groups.push({
          value: entry.columnHeader[level] ?? null,
          span: 1,
          start: position,
          subtotal: true,
          ...(entry.collapsed ? { collapsed: true } : {})
        });
        current = null;
        return;
      }

      const key = JSON.stringify(entry.columnHeader.slice(0, level + 1));

      if (current && current.key === key) {
        current.span++;
        return;
      }

      current = { key, value: entry.columnHeader[level] ?? null, span: 1, start: position };
      groups.push(current);
    });

    return groups.map(({ key, ...group }) => group);
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
    subtotals = null,
    columnSubtotals = null) {
    const tbody = document.createElement("tbody");
    tbody.setAttribute("role", "rowgroup");

    if (rowHeaders.length === 0) {
      const row = this.createRow();
      const empty = this.createCell("td", settings.texts.noData, "pivot-table__empty");
      empty.colSpan = this.columnCount(rowDepth, columnHeaders, values, settings);
      row.appendChild(empty);
      tbody.appendChild(row);
      return tbody;
    }

    const rowPlan = this.createRowPlan(rowHeaders, actualRowDepth, settings);
    const rowTotalLookup = this.createTotalLookup(rowTotals);
    const subtotalLookup = this.createSubtotalLookup(subtotals);
    const columns = this.createColumnContext(columnHeaders, settings, columnSubtotals);

    let previousVisibleRowHeader = null;

    rowPlan.forEach(rowInfo => {
      if (this.isRowHidden(rowInfo.rowHeader, rowInfo.type)) {
        return;
      }

      const buildRow = rowValues => this.createPivotBodyRow(
        rowInfo,
        columnHeaders,
        rowDepth,
        rowValues,
        lookup,
        settings,
        previousVisibleRowHeader,
        rowTotalLookup,
        subtotalLookup,
        Array.isArray(rowTotals) || Array.isArray(subtotals),
        columns);

      if (this.measureColumns > 0) {
        // A group heading without totals holds no value, so one row of it.
        this.appendMeasureRows(tbody, rowInfo.type === "group" ? [values[0]] : values, values, rowDepth, buildRow, {
          blank: rowInfo.type === "group",
          settings
        });
      } else {
        tbody.appendChild(buildRow(values));
      }
      previousVisibleRowHeader = rowInfo.rowHeader;
    });

    if (this.showsGrandTotalRow(values, settings)) {
      const buildTotal = rowValues => this.createGrandTotalRow(
        rowHeaders,
        columnHeaders,
        rowDepth,
        rowValues,
        lookup,
        grandTotals,
        settings,
        columnTotals,
        columns);

      if (this.measureColumns > 0) {
        this.appendMeasureRows(tbody, values, values, rowDepth, buildTotal, { settings });
      } else {
        tbody.appendChild(buildTotal(values));
      }
    }
    return tbody;
  }

  // A rows layout: one row of the pivot drawn once per value. Each row is
  // built by the columns-layout code with that value alone, then the row
  // headers of the first are stretched over the rest (and dropped from them),
  // and a header naming the value goes in after them. The rows all carry the
  // pivot row's selection, so selecting one header lights the whole block.
  appendMeasureRows(tbody, drawn, values, rowDepth, buildRow, { blank = false, settings }) {
    const headerCount = isOneColumnLayout(settings) ? 1 : rowDepth;
    const withTotal = this.totalColumnValues([this.createValueSlot(values)], settings).length > 0;

    drawn.forEach((value, index) => {
      const row = buildRow([value]);
      const headers = Array.from(row.children).slice(0, headerCount);

      if (index === 0) {
        headers.forEach(header => { header.rowSpan = drawn.length; });
      } else {
        headers.forEach(header => header.remove());
      }

      const measure = this.createCell(
        "th", blank ? "" : value.label, "pivot-table__row-header pivot-table__measure-row-header", "rowheader");
      measure.dataset.stickyColumn = String(rowDepth);
      measure.dataset.columnIndex = String(rowDepth);
      measure.dataset.valueKey = value.key;
      const rowSelection = this.selectionMetadata.get(row);
      if (rowSelection) {
        this.registerSelectionTarget(measure, rowSelection, "row");
      }
      row.insertBefore(measure, row.children[index === 0 ? headerCount : 0] ?? null);

      // The total column is there while any value keeps its total; one that
      // gave its own up leaves a blank cell, so the rows stay aligned.
      if (withTotal && this.totalColumnValues([value], settings).length === 0) {
        const empty = this.createCell("td", "", "pivot-table__row-total is-empty");
        empty.dataset.columnIndex = String(
          this.dataStart(rowDepth) + Math.max(1, this.createColumnPlan(this.lastResult?.columnHeaders, settings).length));
        row.appendChild(empty);
      }

      tbody.appendChild(row);
    });
  }

  applyVirtualSpacers(table, virtualState, rowDepth, columnHeaders, values, settings = this.options) {
    if (!virtualState || !table?.tBodies[0]) {
      return;
    }

    const rowHeight = Math.max(24, virtualState.rowHeight ?? 36);
    const offset = Math.max(0, virtualState.offset ?? 0);
    const pageRowCount = Math.max(0, virtualState.pageRowCount ?? 0);
    const totalRows = Math.max(pageRowCount, virtualState.totalRowCount ?? pageRowCount);
    const columnCount = this.columnCount(rowDepth, columnHeaders, values, settings);
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
    serverTotalsAvailable = false,
    columns = this.createColumnContext(columnHeaders, settings)) {
    const row = this.createRow();
    const rowSelection = this.createRowSelection(rowInfo);
    row.className = {
      detail: "pivot-table__detail-row",
      group: "pivot-table__group-row",
      subtotal: "pivot-table__subtotal-row"
    }[rowInfo.type] ?? "pivot-table__detail-row";
    this.registerSelectionRow(row, rowSelection);

    if (isOneColumnLayout(settings)) {
      row.appendChild(this.createCompactRowHeader(rowInfo, settings, previousRowHeader, rowSelection));
    } else {
      this.appendTabularRowHeaders(row, rowInfo, rowDepth, settings, previousRowHeader, rowSelection);
    }

    const subtotal = rowInfo.type === "subtotal" ? subtotalLookup.get(rowInfo.key) : null;
    const subtotalCells = this.createCellLookup(subtotal?.cells ?? []);
    const rowValuesByKey = new Map(values.map(value => [value.key, []]));
    const crossings = new Map((subtotal?.columnSubtotals ?? []).map(cell => [
      this.createSubtotalKey(cell.columnHeader ?? []),
      cell.values ?? {}
    ]));

    this.appendColumnSpacer(row, "before", values.length, settings);

    columns.plan.forEach((entry, index) => {
      const position = entry.position ?? index;

      if (entry.type === "subtotal") {
        this.appendColumnSubtotalCells(row, rowInfo, rowSelection, entry, position, rowDepth, values, lookup,
          settings, columns, crossings);
        return;
      }

      const columnIndex = entry.columnIndex;

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

        cell.dataset.columnIndex = String(this.dataStart(rowDepth) + position * values.length + valueIndex);
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

    this.appendColumnSpacer(row, "after", values.length, settings);

    this.totalColumnValues(values, settings).forEach((valueDefinition, valueIndex) => {
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
      totalCell.dataset.columnIndex = String(this.dataStart(rowDepth) + Math.max(1, columns.width) * values.length + valueIndex);
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

    // The row opening a group whose total comes after it is a heading: its
    // sums are on the total row below, so its cells stay blank rather than
    // showing the empty-cell dash, which would read as a zero total.
    if (rowInfo.opensTotal) {
      row.querySelectorAll("td").forEach(cell => { cell.textContent = ""; });
    }

    return row;
  }

  // What every row needs to draw the column axis: the plan, and the engine's
  // column subtotals keyed the way the plan names them. A payload without
  // them -- an older server -- leaves serverSubtotals false, and the cells
  // are summed here from the columns they cover instead.
  createColumnContext(columnHeaders, settings, columnSubtotals = null) {
    const plan = this.createColumnPlan(columnHeaders, settings);

    return {
      // The drawn columns -- the window, with virtual columns -- each carrying
      // its absolute position; width is the whole plan's, which the total
      // columns after it are counted from.
      plan: this.activeColumnWindow ? this.activeColumnWindow.plan : plan,
      width: plan.length,
      subtotals: new Map((columnSubtotals ?? []).map(subtotal => [
        this.createSubtotalKey(subtotal.columnHeader ?? []),
        {
          cells: this.createTotalLookup(subtotal.cells),
          totals: subtotal.totals ?? {}
        }
      ])),
      serverSubtotals: Array.isArray(columnSubtotals)
    };
  }

  // One subtotal column's cells in a body row. A detail row reads its own
  // cell of the column subtotal, a subtotal row the cell where it crosses it;
  // a group row without totals leaves it empty, as it does every other cell.
  appendColumnSubtotalCells(row, rowInfo, rowSelection, entry, position, rowDepth, values, lookup, settings,
    columns, crossings) {
    const key = this.createSubtotalKey(entry.columnHeader);
    const server = columns.subtotals.get(key);

    values.forEach((valueDefinition, valueIndex) => {
      let value = null;

      if (rowInfo.type !== "group") {
        value = columns.serverSubtotals
          ? (rowInfo.type === "detail"
            ? server?.cells.get(rowInfo.rowIndexes[0])?.[valueDefinition.key]
            : crossings.get(key)?.[valueDefinition.key]) ?? null
          : this.summarizeColumnGroup(rowInfo.rowIndexes, entry.columnIndexes, lookup, valueDefinition);
      }

      const cell = this.createCell(
        "td",
        this.formatValue(value, settings, valueDefinition),
        `${rowInfo.type === "subtotal" ? "pivot-table__subtotal-value" : "pivot-table__value"} pivot-table__column-subtotal`);

      if (value === null || value === undefined) {
        cell.classList.add("is-empty");
      }

      cell.dataset.columnIndex = String(this.dataStart(rowDepth) + position * values.length + valueIndex);
      this.registerSelectionTarget(cell, this.createCellSelection(rowSelection, {
        kind: "columnSubtotal",
        columnIndex: null,
        columnHeader: entry.columnHeader,
        valueKey: valueDefinition.key,
        value,
        drillDownEnabled: rowInfo.type !== "group"
      }), "cell");
      row.appendChild(cell);
    });
  }

  summarizeColumnGroup(rowIndexes, columnIndexes, lookup, valueDefinition) {
    const numbers = [];

    for (const rowIndex of rowIndexes) {
      for (const columnIndex of columnIndexes) {
        const value = lookup.get(`${rowIndex}:${columnIndex}`)?.[valueDefinition.key];

        if (typeof value === "number") {
          numbers.push(value);
        }
      }
    }

    return this.summarizeValues(numbers, valueDefinition);
  }

  appendTabularRowHeaders(row, rowInfo, rowDepth, settings, previousRowHeader, rowSelection) {
    for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
      const value = rowInfo.rowHeader[rowLevel] ?? null;
      const isGroupLikeRow = rowInfo.type === "subtotal" || rowInfo.type === "group";
      const header = this.createCell("th", "", isGroupLikeRow ? "pivot-table__subtotal-header" : "pivot-table__row-header", "rowheader");
      header.dataset.stickyColumn = String(rowLevel);
      header.dataset.columnIndex = String(rowLevel);
      header.dataset.rowLevel = String(rowLevel);
      this.registerSelectionTarget(header, rowSelection, "row");
      const isRepeatedLabel = settings.repeatRowLabels === false &&
        previousRowHeader !== null &&
        rowLevel < rowInfo.rowHeader.length &&
        previousRowHeader[rowLevel] === rowInfo.rowHeader[rowLevel];

      if (rowInfo.type === "subtotal" && rowLevel === rowInfo.level) {
        const label = `${this.displayValue(value, settings)} ${settings.totalText}`;
        // The toggle belongs to the row that opens the group; a total
        // closing it has none.
        if (!rowInfo.trailing) {
          header.appendChild(this.createSubtotalToggle(rowInfo.key, label));
        }
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
    header.dataset.rowLevel = String(rowLevel);
    this.registerSelectionTarget(header, rowSelection, "row");
    header.style.setProperty("--pivot-indent", `${rowLevel * 18}px`);
    header.classList.add("is-compact");

    if (rowInfo.type === "subtotal") {
      // In a tree the row is the parent node itself, already above its
      // children, so it is named for the group rather than as its total.
      // A trailing total is named as one even in a tree: the group's own
      // name is already on the header row above its children.
      const label = settings.layoutMode === "tree" && !rowInfo.trailing
        ? this.displayValue(value, settings)
        : `${this.displayValue(value, settings)} ${settings.totalText}`;
      if (!rowInfo.trailing) {
        header.appendChild(this.createSubtotalToggle(rowInfo.key, label));
      }
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
      const row = {
        type,
        key: this.createSubtotalKey(groupHeader),
        rowHeader: groupHeader,
        rowIndexes: group.items.map(item => item.rowIndex),
        level
      };
      // The total moves below the rows only while they are showing: a
      // collapsed group is its total row alone, toggle and all, wherever the
      // totals otherwise go.
      const totalAfter = type === "subtotal" &&
        settings.totalsPosition === "after" &&
        !this.collapsedRows?.has(row.key);

      // Both rows keep the group's key: the header so its toggle collapses
      // the group, the total so it finds the group's sums.
      plan.push(totalAfter ? { ...row, type: "group", opensTotal: true } : row);
      this.appendGroupRows(plan, group.items, level + 1, rowDepth, settings);

      if (totalAfter) {
        plan.push({ ...row, trailing: true });
      }
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
      button.addEventListener("click", event => {
        // A column toggle sits inside a header that may also sort or select.
        event.stopPropagation();
        const isColumn = button.dataset.columnGroupKey !== undefined;
        const key = isColumn ? button.dataset.columnGroupKey : button.dataset.subtotalKey;
        const collapsed = isColumn ? this.collapsedColumns : this.collapsedRows;

        if (collapsed.has(key)) {
          collapsed.delete(key);
        } else {
          collapsed.add(key);
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
      const isMenuKey = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

      if (!isCell && isMenuKey && settings.contextMenu && this.headerLevelOf(target)) {
        event.preventDefault();
        const rect = target.getBoundingClientRect();
        const x = PivotForge.isRtl(target) ? rect.right - 12 : rect.left + 12;
        this.openHeaderMenu(target, x, rect.top + 12, settings);
        return;
      }

      if (isCell && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
        event.preventDefault();
        selectTarget(target);
        const rect = target.getBoundingClientRect();
        // At the cell's starting corner: its right edge in RTL.
        const x = PivotForge.isRtl(target) ? rect.right - 12 : rect.left + 12;
        this.openContextMenu(target, x, rect.top + 12, settings);
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
        this.moveCellSelection(table, target, this.visualArrow(event.key, table), settings);
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

      if (!settings.contextMenu) {
        return;
      }

      // A group header has a menu of its own, for its whole level.
      const header = target ? null : event.target.closest("th");
      if (header && table.contains(header) && this.headerLevelOf(header)) {
        event.preventDefault();
        this.openHeaderMenu(header, event.clientX, event.clientY, settings);
        return;
      }

      if (!target || !table.contains(target)) {
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
      // A trailing total shares its group's header path with the group's
      // header row, so it is told apart here or selecting one lights both.
      rowKey: this.createSelectionRowKey(rowInfo.rowHeader) + (rowInfo.trailing ? ":total" : ""),
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

    if (this.columnWindowState && (direction === "ArrowLeft" || direction === "ArrowRight")) {
      const moved = this.moveAcrossColumnWindow(table, currentCell, direction === "ArrowRight" ? 1 : -1, settings);
      if (moved !== undefined) {
        return moved;
      }
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
    const stickyHeaders = Array.from(cell.parentElement?.querySelectorAll("[data-sticky-column]") ?? [])
      .map(header => header.getBoundingClientRect());
    const stickyBottom = Math.max(
      hostRect.top,
      ...Array.from(table?.querySelectorAll("[data-sticky-row]") ?? [])
        .map(header => header.getBoundingClientRect().bottom));
    const gap = 8;

    // The frozen row headers sit at the start edge -- the right in RTL -- and
    // a cell scrolled under them is as hidden as one scrolled off the far side.
    // A positive scrollLeft change moves the view right in either direction.
    if (PivotForge.isRtl(host)) {
      const stickyLeft = Math.min(hostRect.right, ...stickyHeaders.map(rect => rect.left));

      if (cellRect.left < hostRect.left + gap) {
        host.scrollLeft -= hostRect.left + gap - cellRect.left;
      } else if (cellRect.right > stickyLeft - gap) {
        host.scrollLeft += cellRect.right - stickyLeft + gap;
      }
    } else {
      const stickyRight = Math.max(hostRect.left, ...stickyHeaders.map(rect => rect.right));

      if (cellRect.right > hostRect.right - gap) {
        host.scrollLeft += cellRect.right - hostRect.right + gap;
      } else if (cellRect.left < stickyRight + gap) {
        host.scrollLeft -= stickyRight + gap - cellRect.left;
      }
    }

    if (cellRect.bottom > hostRect.bottom - gap) {
      host.scrollTop += cellRect.bottom - hostRect.bottom + gap;
    } else if (cellRect.top < stickyBottom + gap) {
      host.scrollTop -= stickyBottom + gap - cellRect.top;
    }
  }

  // The arrow keys move the way they point. Navigation walks cells in document
  // order, which runs right to left on screen in RTL, so the two horizontal
  // keys trade places there.
  visualArrow(key, element) {
    if (!PivotForge.isRtl(element)) {
      return key;
    }

    return { ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" }[key] ?? key;
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
      .filter(cell => !cell.classList?.contains("pivot-table__virtual-column"))
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

    return this.presentMenu(
      cell,
      (settings.texts ?? TEXTS).cellActions,
      this.createContextMenuItems(selection, settings.texts ?? TEXTS, settings),
      action => this.handleContextMenuAction(action, cell, settings),
      clientX,
      clientY);
  }

  // A header's own menu (DevExtreme's "Expand All" / "Collapse All" on a
  // group header): every group of the header's level, on its axis, at once.
  // Only headers whose level has groups below it have one.
  openHeaderMenu(header, clientX, clientY, settings = this.lastSettings) {
    const target = this.headerLevelOf(header);

    if (!target || typeof document === "undefined") {
      return null;
    }

    const texts = settings.texts ?? TEXTS;
    const caption = (target.axis === "row" ? settings.rowFieldLabels : settings.columnFieldLabels)?.[target.level] ??
      (target.axis === "row" ? settings.rowFields : settings.columnFields)?.[target.level] ?? "";
    const keys = this.levelGroupKeys(target.axis, target.level);
    const collapsed = target.axis === "row" ? this.collapsedRows : this.collapsedColumns;
    const closedCount = keys.filter(key => collapsed?.has(key)).length;

    return this.presentMenu(
      header,
      texts.headerActions,
      [
        { action: "expand-level", label: formatText(texts.expandLevel, caption), disabled: closedCount === 0 },
        { action: "collapse-level", label: formatText(texts.collapseLevel, caption), disabled: closedCount === keys.length }
      ],
      action => {
        this.closeContextMenu();
        if (action === "expand-level") {
          this.expandLevel(target.axis, target.level);
        } else {
          this.collapseLevel(target.axis, target.level);
        }
      },
      clientX,
      clientY);
  }

  // Which level a header names and on which axis, when that level has groups
  // that fold: a row header above the innermost row level, or a column header
  // carrying a fold toggle. Null for every other cell.
  headerLevelOf(cell) {
    if (!cell || cell.tagName !== "TH") {
      return null;
    }

    const columnToggle = cell.querySelector?.(".pivot-table__toggle.is-column");
    if (columnToggle && cell.closest("thead")) {
      return { axis: "column", level: columnToggle.dataset.columnGroupKey.split("\u001f").length - 1 };
    }

    const level = Number(cell.dataset.rowLevel);
    const depth = Math.max(1, ...(this.lastResult?.rowHeaders ?? []).map(header => header.length));
    return cell.closest("tbody") && Number.isInteger(level) && cell.dataset.rowLevel !== undefined && level < depth - 1
      ? { axis: "row", level }
      : null;
  }

  // Every group key at one level of an axis.
  levelGroupKeys(axis, level) {
    const result = this.lastResult;
    const settings = this.lastSettings;

    if (!result || !settings) {
      return [];
    }

    if (axis === "column") {
      return this.columnGroupKeys(result.columnHeaders ?? [], [level]);
    }

    const rowHeaders = result.rowHeaders ?? [];
    const depth = Math.max(1, ...rowHeaders.map(header => header.length));
    // Keys are the same with or without totals before the rows, so the plan
    // is read with them before: a trailing total adds no key of its own.
    return [...new Set(this.createRowPlan(rowHeaders, depth, { ...settings, totalsPosition: "before" })
      .filter(row => (row.type === "subtotal" || row.type === "group") && row.level === level)
      .map(row => row.key))];
  }

  expandLevel(axis, level) {
    const collapsed = axis === "column" ? this.collapsedColumns : this.collapsedRows;
    this.levelGroupKeys(axis, level).forEach(key => collapsed?.delete(key));
    this.rerenderLast();
    this.notifyViewStateChanged();
  }

  collapseLevel(axis, level) {
    const keys = this.levelGroupKeys(axis, level);
    if (axis === "column") {
      this.collapsedColumns ??= new Set();
      keys.forEach(key => this.collapsedColumns.add(key));
    } else {
      this.collapsedRows ??= new Set();
      keys.forEach(key => this.collapsedRows.add(key));
    }
    this.rerenderLast();
    this.notifyViewStateChanged();
  }

  // The menu box both menus share: buttons, arrow keys, focus, placement.
  presentMenu(cell, label, items, onPick, clientX, clientY) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "pivot-cell-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", label);

    items.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pivot-cell-menu__item";
      button.dataset.contextAction = item.action;
      button.textContent = item.label;
      button.disabled = item.disabled;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => onPick(item.action));
      menu.appendChild(button);
    });

    menu.addEventListener("keydown", event => this.handleContextMenuKeydown(event, cell));
    PivotForge.matchDirection(menu, cell);
    document.body.appendChild(menu);
    this.contextMenu = menu;
    this.contextMenuCell = cell;
    this.ensureContextMenuListeners();

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    // Opening away from the start edge: rightwards from the point, or in RTL
    // leftwards, so the menu covers the cell's neighbours rather than the
    // headers that name it.
    const left = menu.dir === "rtl" ? clientX - rect.width : clientX;
    menu.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
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
    // Any number on screen sits in one column and one row, and the engine can
    // read a summary at either -- a subtotal column or row, or the totals.
    const canSort = isNumeric && Boolean(selection?.valueKey);
    const hasColumnFields = (settings?.columnFields?.length ?? 0) > 0;

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
        action: "sort-columns",
        label: texts.sortColumnsByValue,
        disabled: !canSort,
        available: Boolean(settings?.onSortRequested) && hasColumnFields
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
      case "sort-columns":
        settings?.onSortRequested?.(this.createColumnSortRequest(selection));
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

  // The row a cell sits on, as the column axis reads it: the grand total row
  // is the columns' own totals, a subtotal row its group's prefix.
  createColumnSortRequest(selection) {
    return {
      mode: "ColumnTotalValue",
      valueKey: selection?.valueKey ?? null,
      rowPath: selection?.rowType === "grandTotal" ? null : [...(selection?.rowHeader ?? [])]
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

  // Only the plain value cells: a subtotal or total cell carries other classes.
  // A large-data page brings the whole result's ranges with it, so the scale is
  // the same on every page.
  applyHeatmap(table, settings = this.lastSettings) {
    const cells = Array.from(
      table?.querySelectorAll("td.pivot-table__value:not(.pivot-table__column-subtotal)") ?? []);
    const entries = cells.map(cell => {
      const selection = this.selectionMetadata.get(cell);

      return {
        value: selection?.value,
        valueKey: selection?.valueKey,
        rowKey: selection?.rowKey,
        columnIndex: selection?.columnIndex
      };
    });
    const levels = PivotForge.heatmapLevels(
      entries, settings?.heatmap ?? "none", this.lastResult?.valueRanges ?? []);

    cells.forEach((cell, index) => {
      const level = levels[index];
      cell.classList.toggle("is-heat", level !== null);

      if (level === null) {
        cell.style.removeProperty("--pt-heat");
      } else {
        // Rounded so the attribute stays readable in the inspector.
        cell.style.setProperty("--pt-heat", String(Math.round(level * 1000) / 1000));
      }
    });
  }

  // The same cells the heatmap shades, measured the same way, drawn as bars.
  applyValueBars(table, settings = this.lastSettings) {
    const cells = Array.from(
      table?.querySelectorAll("td.pivot-table__value:not(.pivot-table__column-subtotal)") ?? []);
    const entries = cells.map(cell => {
      const selection = this.selectionMetadata.get(cell);

      return {
        value: selection?.value,
        valueKey: selection?.valueKey,
        rowKey: selection?.rowKey,
        columnIndex: selection?.columnIndex
      };
    });
    const bars = PivotForge.valueBarExtents(
      entries, settings?.valueBars ?? "none", this.lastResult?.valueRanges ?? []);
    const percent = fraction => `${Math.round(fraction * 1000) / 10}%`;

    cells.forEach((cell, index) => {
      const bar = bars[index];
      cell.classList.toggle("has-value-bar", bar !== null);
      cell.classList.toggle("is-negative-bar", bar?.negative === true);

      if (bar === null) {
        cell.style.removeProperty("--pt-bar-start");
        cell.style.removeProperty("--pt-bar-end");
      } else {
        cell.style.setProperty("--pt-bar-start", percent(bar.start));
        cell.style.setProperty("--pt-bar-end", percent(bar.start + bar.width));
      }
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
        // The handle sits on the end edge, the left in RTL: dragging it away
        // from the column widens it either way.
        const sign = PivotForge.isRtl(table) ? -1 : 1;
        const startWidth = header.getBoundingClientRect().width;
        const minWidth = settings.minColumnWidth ?? 72;
        const maxWidth = settings.maxColumnWidth ?? 420;

        table.classList.add("is-resizing");
        document.body.classList.add("pivot-table-resizing");
        handle.setPointerCapture?.(event.pointerId);

        const move = moveEvent => {
          const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + sign * (moveEvent.clientX - startX)));
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

  createGrandTotalRow(rowHeaders, columnHeaders, rowDepth, values, lookup, grandTotals, settings, columnTotals = null,
    columns = this.createColumnContext(columnHeaders, settings)) {
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
      // The grand total row is the columns' own totals: its arrow orders the
      // columns by them, the way the total column's arrow orders the rows.
      // With several values the label cannot say which one, so the cell menu
      // is the way in.
      if (rowLevel === 0 && values.length === 1 && !this.measureColumns && (settings.columnFields?.length ?? 0) > 0 &&
        columnHeaders.length > 1) {
        this.decorateSortableHeader(header, label, {
          mode: "ColumnTotalValue",
          valueKey: values[0].key,
          rowPath: null
        }, settings);
      }
      this.registerSelectionTarget(header, rowSelection, "row");
      row.appendChild(header);
    }

    this.appendColumnSpacer(row, "before", values.length, settings);

    columns.plan.forEach((entry, index) => {
      const position = entry.position ?? index;

      if (entry.type === "subtotal") {
        values.forEach((valueDefinition, valueIndex) => {
          const totalValue = columns.serverSubtotals
            ? columns.subtotals.get(this.createSubtotalKey(entry.columnHeader))?.totals?.[valueDefinition.key] ?? null
            : this.summarizeColumnGroup(rowSelection.rowIndexes, entry.columnIndexes, lookup, valueDefinition);
          const totalCell = this.createCell(
            "td",
            this.formatValue(totalValue, settings, valueDefinition),
            "pivot-table__column-total pivot-table__column-subtotal");
          totalCell.dataset.columnIndex = String(this.dataStart(rowDepth) + position * values.length + valueIndex);
          this.registerSelectionTarget(totalCell, this.createCellSelection(rowSelection, {
            kind: "columnSubtotal",
            columnIndex: null,
            columnHeader: entry.columnHeader,
            valueKey: valueDefinition.key,
            value: totalValue
          }), "cell");
          row.appendChild(totalCell);
        });
        return;
      }

      const columnIndex = entry.columnIndex;

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
        totalCell.dataset.columnIndex = String(this.dataStart(rowDepth) + position * values.length + valueIndex);
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

    this.appendColumnSpacer(row, "after", values.length, settings);

    this.totalColumnValues(values, settings).forEach((valueDefinition, valueIndex) => {
      const grandTotalCell = this.createCell(
        "td",
        this.formatValue(grandTotals[valueDefinition.key], settings, valueDefinition),
        "pivot-table__grand-total");
      grandTotalCell.dataset.columnIndex = String(this.dataStart(rowDepth) + Math.max(1, columns.width) * values.length + valueIndex);
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

    // Each head row sticks below the rows above it, so a multi-row head stays
    // readable when the body scrolls up under it. A cell spanning several rows
    // belongs to the row it starts in.
    let top = 0;
    for (const row of table.tHead?.rows ?? []) {
      for (const cell of row.cells) {
        cell.style.setProperty("--sticky-top", `${top}px`);
      }
      top += row.getBoundingClientRect?.().height ?? 0;
    }

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
  createSubtotalToggle(key, label, axis = "row") {
    const toggle = document.createElement("button");
    const isColumn = axis === "column";
    const collapsed = (isColumn ? this.collapsedColumns : this.collapsedRows).has(key);
    toggle.className = "pivot-table__toggle";
    toggle.type = "button";
    if (isColumn) {
      toggle.dataset.columnGroupKey = key;
      toggle.classList.add("is-column");
    } else {
      toggle.dataset.subtotalKey = key;
    }
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

  // A row or column field's per-field option, looked up by the field's key:
  // rowFieldAllowFiltering for a row field, columnFieldAllowFiltering for a
  // column one. Undefined for a field on neither axis.
  fieldOption(settings, field, option) {
    const rowIndex = (settings.rowFields ?? []).indexOf(field);
    if (rowIndex >= 0) {
      return settings[`rowField${option}`]?.[rowIndex];
    }

    const columnIndex = (settings.columnFields ?? []).indexOf(field);
    return columnIndex >= 0 ? settings[`columnField${option}`]?.[columnIndex] : undefined;
  }

  // A label sort asks the field it orders; a value sort asks the data field
  // whose numbers it orders by, so a measure can be left out of sorting.
  fieldAllowsSorting(request, settings) {
    if (request?.mode === "RowLabel" || request?.mode === "ColumnLabel") {
      return this.fieldOption(settings, request.field, "AllowSorting") !== false;
    }

    const value = request?.valueKey
      ? (settings.values ?? []).find(entry => entry.key === request.valueKey)
      : null;
    return value?.allowSorting !== false;
  }

  // Declared widths, by column index: a row field's on its header column, a
  // data field's on every column of its values, totals included. A width the
  // reader dragged wins, so these only fill the columns nobody has resized.
  // In a one-column layout every row field shares the column; the widest
  // declaration sizes it.
  applyDeclaredWidths(table, settings, rowDepth, planWidth, values) {
    const widths = new Map();
    const rowWidths = (settings.rowFieldWidths ?? []).filter(width => width > 0);

    if (isOneColumnLayout(settings)) {
      if (rowWidths.length > 0) {
        widths.set(0, Math.max(...rowWidths));
      }
    } else {
      (settings.rowFieldWidths ?? []).forEach((width, level) => {
        if (width > 0 && level < rowDepth) {
          widths.set(level, width);
        }
      });
    }

    const valueSpan = values.length;
    for (let position = 0; position < planWidth; position++) {
      values.forEach((value, valueIndex) => {
        if (value.width > 0) {
          widths.set(this.dataStart(rowDepth) + position * valueSpan + valueIndex, value.width);
        }
      });
    }

    this.totalColumnValues(values, settings).forEach((value, valueIndex) => {
      if (value.width > 0) {
        widths.set(this.dataStart(rowDepth) + planWidth * valueSpan + valueIndex, value.width);
      }
    });

    for (const [columnIndex, width] of widths) {
      if (this.columnWidths.has(columnIndex)) {
        continue;
      }

      table.querySelectorAll(`[data-column-index="${columnIndex}"]`).forEach(cell => {
        this.setCellWidth(cell, width);
      });
    }
  }

  // Which labels may wrap: a row field's headers at its level, a column
  // field's headers on its row, a data field's value headers.
  applyWordWrap(table, settings, values) {
    (settings.rowFieldWordWrap ?? []).forEach((wrap, level) => {
      if (wrap === true) {
        table.querySelectorAll(`tbody th[data-row-level="${level}"]`)
          .forEach(cell => cell.classList.add("is-wrapping"));
      }
    });

    (settings.columnFieldWordWrap ?? []).forEach((wrap, level) => {
      if (wrap === true) {
        table.querySelectorAll(`thead .pivot-table__column-header[data-sticky-row="${level}"]`)
          .forEach(cell => cell.classList.add("is-wrapping"));
      }
    });

    values.filter(value => value.wordWrap).forEach(value => {
      table.querySelectorAll(".pivot-table__value-header").forEach(cell => {
        if (cell.dataset.valueKey === value.key) {
          cell.classList.add("is-wrapping");
        }
      });
    });
  }

  decorateSortableHeader(cell, label, request, settings) {
    if (typeof settings.onSortRequested !== "function" || !this.fieldAllowsSorting(request, settings)) {
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
    const activeDirection = this.activeSortDirection(request, settings);
    if (activeDirection) {
      const descending = activeDirection === "Descending";
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
    if (typeof settings.onFilterRequested !== "function" || !field ||
      this.fieldOption(settings, field, "AllowFiltering") === false) {
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
      // The button goes along so the picker can drop down under it.
      settings.onFilterRequested(field, button);
    });

    cell.appendChild(button);
  }

  // The direction a header's own sort is in, or null when it is not sorted. A
  // column field's order is not the row sort: it rides on the field itself, so
  // it is read from what the host says each column level is sorted by. A row
  // field's own order is read the same way until a row sort takes over.
  activeSortDirection(request, settings) {
    if (request?.mode === "ColumnLabel") {
      // A value sort on the columns stands in for their label order.
      if (settings.columnSortState) {
        return null;
      }

      const level = (settings.columnFields ?? []).indexOf(request.field);
      return level >= 0 ? settings.columnFieldSorts?.[level] ?? null : null;
    }

    if (request?.mode === "RowLabel" && !settings.sortState) {
      const level = (settings.rowFields ?? []).indexOf(request.field);
      return level >= 0 ? settings.rowFieldSorts?.[level] ?? null : null;
    }

    if (request?.mode === "ColumnTotalValue") {
      return this.isActiveColumnSort(request, settings.columnSortState)
        ? settings.columnSortState.direction
        : null;
    }

    return this.isActiveSort(request, settings.sortState)
      ? settings.sortState.direction
      : null;
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

  isActiveColumnSort(request, sortState) {
    return Boolean(request && sortState) && request.valueKey === sortState.valueKey &&
      this.sameColumnPath(request.rowPath ?? null, sortState.rowPath ?? null);
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

    return this.customizeText(value, this.formatNumber(value, settings, valueDefinition), valueDefinition);
  }

  formatNumber(value, settings, valueDefinition) {
    const format = valueDefinition?.format;

    // The zero text stands in for the number entirely, whatever else is declared.
    if (value === 0 && typeof format?.zeroText === "string") {
      return format.zeroText;
    }

    // Parentheses replace the sign rather than adding to it, so the number
    // inside them is written as a positive one.
    if (value < 0 && format?.negative === "parentheses") {
      return `(${this.formatNumber(-value, settings, valueDefinition)})`;
    }

    // A format that only asks for a zero text or parentheses leaves the number
    // itself to the grid's default, as a field with no format at all does.
    const shapesNumber = format && ["type", "decimals", "useGrouping", "currency", "compact"]
      .some(member => format[member] !== undefined);

    if (!shapesNumber) {
      return settings.formatter.format(value);
    }

    const decimals = Number.isInteger(format.decimals) ? format.decimals : 2;
    const options = {
      // A compact number drops the trailing zeros it does not need: "1,25 Mn",
      // "3 B", never "3,00 B".
      minimumFractionDigits: format.compact === true ? 0 : decimals,
      maximumFractionDigits: decimals,
      useGrouping: format.useGrouping !== false,
      ...(format.compact === true ? { notation: "compact", compactDisplay: "short" } : {})
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

  // The last word on a value's text: a function the page supplies, or the name
  // of one on the page, handed the number and the text formatted so far. What
  // it returns is shown; null or undefined keeps the formatted text.
  customizeText(value, valueText, valueDefinition) {
    const customize = valueDefinition?.customizeText;
    if (!customize) {
      return valueText;
    }

    const fn = typeof customize === "function"
      ? customize
      : String(customize).split(".").filter(Boolean)
        .reduce((scope, part) => (scope == null ? undefined : scope[part]), globalThis);

    if (typeof fn !== "function") {
      throw new Error(`PivotForge customizeText "${customize}" for "${valueDefinition.key}" is not a function on the page.`);
    }

    const text = fn({ value, valueText, valueKey: valueDefinition.key });
    return text === null || text === undefined ? valueText : String(text);
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
