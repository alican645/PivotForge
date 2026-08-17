(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const api = {
    filterRecords(records, columns, searchTerm, columnFilters = {}) {
      const normalizedSearch = String(searchTerm ?? "").trim().toLocaleLowerCase("tr");

      return (records ?? []).filter(record => {
        const matchesColumns = columns.every(column => {
          const selectedValues = columnFilters[column.key];

          if (!selectedValues || selectedValues.size === 0) {
            return true;
          }

          return selectedValues.has(api.rawValue(record[column.key]));
        });

        if (!matchesColumns || !normalizedSearch) {
          return matchesColumns;
        }

        return columns.some(column => api.formatValue(record[column.key], column)
          .toLocaleLowerCase("tr")
          .includes(normalizedSearch));
      });
    },

    distinctValues(records, column) {
      return [...new Set((records ?? []).map(record => api.rawValue(record[column.key])))]
        .sort((left, right) => left.localeCompare(right, "tr", { numeric: true }));
    },

    toCsv(records, columns) {
      const rows = [columns.map(column => api.csvEscape(column.label)).join(",")];

      (records ?? []).forEach(record => {
        rows.push(columns
          .map(column => api.csvEscape(api.formatValue(record[column.key], column)))
          .join(","));
      });

      return `\uFEFF${rows.join("\n")}`;
    },

    // Turns a declared value format into a column formatter, so a detail table
    // renders its numbers exactly as the pivot cells above it do. Mirrors
    // PivotTableRenderer.formatValue; returns null when nothing was declared,
    // which leaves formatValue falling back to plain String(). A null culture
    // means the reader's own locale, which is also the renderer's default —
    // the two must agree or the modal contradicts the table it came from.
    createFormatter(format, culture = null) {
      if (!format) {
        return null;
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
      } else if (format.type === "percent") {
        options.style = "percent";
      }

      const formatter = new Intl.NumberFormat(culture ?? undefined, options);

      return value => {
        if (value === null || value === undefined) {
          return "";
        }

        if (typeof value !== "number") {
          return String(value);
        }

        // A percent format states the value in whole percents, the same
        // assumption the renderer makes for a cell with no showAs transform.
        return formatter.format(format.type === "percent" ? value / 100 : value);
      };
    },

    formatValue(value, column) {
      if (typeof column.format === "function") {
        return String(column.format(value));
      }

      return value === null || value === undefined ? "" : String(value);
    },

    rawValue(value) {
      return value === null || value === undefined ? "" : String(value);
    },

    csvEscape(value) {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }
  };

  PivotForge.PivotDrillDownData = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
