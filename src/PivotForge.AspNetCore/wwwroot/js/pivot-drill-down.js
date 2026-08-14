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
