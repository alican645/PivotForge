(function (root) {
const PivotForge = root.PivotForge ??= {};

class PivotTableRenderer {
  constructor(container, options = {}) {
    if (!container) {
      throw new Error("PivotTableRenderer requires a container element.");
    }

    this.container = container;
    this.options = {
      emptyText: "-",
      totalText: "Toplam",
      rowFieldLabels: [],
      valueKey: null,
      aggregation: "sum",
      formatter: new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }),
      ...options
    };
  }

  render(result, options = {}) {
    const settings = { ...this.options, ...options };
    const rowHeaders = result?.rowHeaders ?? [];
    const columnHeaders = result?.columnHeaders ?? [];
    const cells = result?.cells ?? [];
    const grandTotals = result?.grandTotals ?? {};
    const valueKey = settings.valueKey ?? this.resolveValueKey(cells, grandTotals);

    this.container.classList.add("pivot-table");

    if (!valueKey) {
      this.container.replaceChildren(this.createEmptyState("Render edilecek value bulunamadı."));
      return;
    }

    const columnDepth = Math.max(1, ...columnHeaders.map(header => header.length));
    const rowDepth = Math.max(1, ...rowHeaders.map(header => header.length));
    const lookup = this.createCellLookup(cells, valueKey);
    const table = document.createElement("table");
    table.className = "pivot-table__table";

    table.appendChild(this.createTableHead(columnHeaders, columnDepth, rowDepth, settings));
    table.appendChild(this.createTableBody(rowHeaders, columnHeaders, rowDepth, lookup, grandTotals, valueKey, settings));

    this.container.replaceChildren(table);
    this.applyStickyOffsets(table, columnDepth, rowDepth);
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

  createTableHead(columnHeaders, columnDepth, rowDepth, settings) {
    const thead = document.createElement("thead");

    for (let level = 0; level < columnDepth; level++) {
      const row = document.createElement("tr");

      if (level === 0) {
        for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
          const label = settings.rowFieldLabels[rowLevel] ?? (rowDepth === 1 ? "Rows" : `Row ${rowLevel + 1}`);
          const corner = this.createCell("th", label, "pivot-table__corner");
          corner.rowSpan = columnDepth;
          corner.dataset.stickyColumn = String(rowLevel);
          row.appendChild(corner);
        }
      }

      const groups = this.createColumnGroups(columnHeaders, level);

      for (const group of groups) {
        const header = this.createCell("th", this.displayValue(group.value, settings), "pivot-table__column-header");
        header.colSpan = group.span;
        header.dataset.stickyRow = String(level);

        if (group.value === null || group.value === undefined || group.value === "") {
          header.classList.add("is-empty");
        }

        row.appendChild(header);
      }

      if (level === 0) {
        const total = this.createCell("th", settings.totalText, "pivot-table__measure-header");
        total.rowSpan = columnDepth;
        total.dataset.stickyRow = "0";
        row.appendChild(total);
      }

      thead.appendChild(row);
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

    columnHeaders.forEach((header, index) => {
      const path = header.slice(0, level + 1);
      const key = JSON.stringify(path);
      const value = header[level] ?? null;

      if (index === 0) {
        currentKey = key;
        currentValue = value;
        span = 1;
        return;
      }

      if (key === currentKey) {
        span++;
        return;
      }

      groups.push({ value: currentValue, span });
      currentKey = key;
      currentValue = value;
      span = 1;
    });

    groups.push({ value: currentValue, span });
    return groups;
  }

  createTableBody(rowHeaders, columnHeaders, rowDepth, lookup, grandTotals, valueKey, settings) {
    const tbody = document.createElement("tbody");

    if (rowHeaders.length === 0) {
      const row = document.createElement("tr");
      const empty = this.createCell("td", "Veri yok", "pivot-table__empty");
      empty.colSpan = rowDepth + Math.max(1, columnHeaders.length) + 1;
      row.appendChild(empty);
      tbody.appendChild(row);
      return tbody;
    }

    rowHeaders.forEach((rowHeader, rowIndex) => {
      const row = document.createElement("tr");

      for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
        const value = rowHeader[rowLevel] ?? null;
        const header = this.createCell("th", this.displayValue(value, settings), "pivot-table__row-header");
        header.dataset.stickyColumn = String(rowLevel);

        if (value === null || value === undefined || value === "") {
          header.classList.add("is-empty");
        }

        row.appendChild(header);
      }

      const rowValues = [];

      columnHeaders.forEach((_, columnIndex) => {
        const value = lookup.get(`${rowIndex}:${columnIndex}`);

        if (typeof value === "number") {
          rowValues.push(value);
        }

        const cell = this.createCell("td", this.formatValue(value, settings), "pivot-table__value");

        if (value === null || value === undefined) {
          cell.classList.add("is-empty");
        }

        row.appendChild(cell);
      });

      row.appendChild(this.createCell("td", this.formatValue(this.summarizeValues(rowValues, settings), settings), "pivot-table__row-total"));
      tbody.appendChild(row);
    });

    tbody.appendChild(this.createGrandTotalRow(rowHeaders, columnHeaders, rowDepth, lookup, grandTotals, valueKey, settings));
    return tbody;
  }

  createGrandTotalRow(rowHeaders, columnHeaders, rowDepth, lookup, grandTotals, valueKey, settings) {
    const row = document.createElement("tr");

    for (let rowLevel = 0; rowLevel < rowDepth; rowLevel++) {
      const label = rowLevel === 0 ? settings.totalText : "";
      const header = this.createCell("th", label, "pivot-table__row-total-label");
      header.dataset.stickyColumn = String(rowLevel);
      row.appendChild(header);
    }

    columnHeaders.forEach((_, columnIndex) => {
      const columnValues = [];

      rowHeaders.forEach((_, rowIndex) => {
        const value = lookup.get(`${rowIndex}:${columnIndex}`);

        if (typeof value === "number") {
          columnValues.push(value);
        }
      });

      row.appendChild(this.createCell("td", this.formatValue(this.summarizeValues(columnValues, settings), settings), "pivot-table__column-total"));
    });

    row.appendChild(this.createCell("td", this.formatValue(grandTotals[valueKey], settings), "pivot-table__grand-total"));
    return row;
  }

  createCellLookup(cells, valueKey) {
    return new Map((cells ?? []).map(cell => {
      const value = cell.values?.[valueKey] ?? null;
      return [`${cell.row}:${cell.column}`, value];
    }));
  }

  applyStickyOffsets(table, columnDepth, rowDepth) {
    const firstBodyRow = table.tBodies[0]?.rows[0];
    const firstHeadRow = table.tHead?.rows[0];
    const headerHeights = [];
    const rowHeaderWidths = [];

    for (let rowIndex = 0; rowIndex < columnDepth; rowIndex++) {
      headerHeights.push(table.tHead?.rows[rowIndex]?.getBoundingClientRect().height ?? 36);
    }

    for (let columnIndex = 0; columnIndex < rowDepth; columnIndex++) {
      const width = firstBodyRow?.cells[columnIndex]?.getBoundingClientRect().width
        ?? firstHeadRow?.cells[columnIndex]?.getBoundingClientRect().width
        ?? 148;
      rowHeaderWidths.push(width);
    }

    table.querySelectorAll("[data-sticky-row]").forEach(cell => {
      const level = Number(cell.dataset.stickyRow ?? "0");
      const offset = headerHeights.slice(0, level).reduce((total, height) => total + height, 0);
      cell.style.setProperty("--sticky-top", `${offset}px`);
    });

    table.querySelectorAll("[data-sticky-column]").forEach(cell => {
      const level = Number(cell.dataset.stickyColumn ?? "0");
      const offset = rowHeaderWidths.slice(0, level).reduce((total, width) => total + width, 0);
      cell.style.setProperty("--sticky-left", `${offset}px`);
    });
  }

  createCell(tagName, text, className) {
    const cell = document.createElement(tagName);
    cell.className = className;
    cell.textContent = text;
    return cell;
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

  formatValue(value, settings) {
    if (value === null || value === undefined) {
      return settings.emptyText;
    }

    if (typeof value !== "number") {
      return String(value);
    }

    return settings.formatter.format(value);
  }

  summarizeValues(values, settings) {
    if (values.length === 0) {
      return null;
    }

    switch (settings.aggregation) {
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
}

PivotForge.PivotTableRenderer = PivotTableRenderer;
})(typeof window !== "undefined" ? window : globalThis);
