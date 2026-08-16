(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const DEFAULT_LABELS = {
    title: "Kaynak Kayıtlar",
    close: "Kapat",
    search: "Kayıtlarda ara",
    csv: "CSV",
    all: "Tümü",
    empty: "(Boş)",
    loading: "Kayıtlar yükleniyor...",
    noRecords: "Bu hücre için kaynak kayıt bulunamadı",
    noMatches: "Filtrelerle eşleşen kayıt yok",
    failed: "Kaynak kayıtlar alınamadı",
    allRows: "Tüm satırlar",
    allColumns: "Tüm sütunlar",
    // {0} is replaced with the server's record limit.
    truncated: "İlk {0} kayıt gösteriliyor.",
    // {0} visible, {1} total.
    summary: "{0} / {1} kayıt",
    columnFilter: "{0} filtresi"
  };

  const NUMERIC_TYPES = ["number", "currency", "percent"];

  function format(template, ...values) {
    return values.reduce(
      (text, value, index) => text.replaceAll(`{${index}}`, String(value)),
      String(template));
  }

  class PivotDrillDownModal {
    constructor(options = {}) {
      if (!options.widget || typeof options.widget.drillDown !== "function") {
        throw new Error("PivotDrillDownModal requires a widget exposing drillDown().");
      }

      this.widget = options.widget;
      // An explicit column list wins over anything derived from the catalog,
      // for sources whose detail shape differs from the pivot fields.
      this.columns = options.columns ?? null;
      this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
      this.host = options.host ?? root.document?.body ?? null;

      if (!this.host) {
        throw new Error("PivotDrillDownModal requires a host element.");
      }

      // Every open() takes a ticket. A response whose ticket is stale belongs
      // to a cell the user has already navigated away from, so it is dropped
      // rather than rendered over the current one.
      this.requestId = 0;
      this.records = [];
      this.visibleRecords = [];
      this.columnFilters = {};
      this.response = null;
      this.activeColumns = [];
      this.isOpen = false;
      this.disposed = false;
      this.elements = null;
    }

    // Which columns a detail table shows, resolved against the records the
    // server actually returned. The declared fields carry captions and number
    // formats, but the serializer decides the casing of the record keys, so
    // the two are matched case-insensitively rather than assumed equal.
    resolveColumns(records) {
      if (this.columns) {
        return this.columns;
      }

      const sample = records?.[0];
      if (!sample) {
        return [];
      }

      const keys = Object.keys(sample);
      const declared = (this.widget.fields ?? [])
        .map(field => {
          const key = keys.find(entry => entry.toLowerCase() === String(field.dataField).toLowerCase());
          return key === undefined ? null : {
            key,
            label: field.caption ?? key,
            format: PivotForge.PivotDrillDownData.createFormatter(field.format),
            // Alignment follows the data, not just the declaration: a measure
            // with no declared format is still a number, and left-aligning it
            // next to a formatted one reads as a mistake.
            numeric: NUMERIC_TYPES.includes(field.format?.type) || typeof sample[key] === "number"
          };
        })
        .filter(column => column !== null);

      // A source whose detail records share no key with the declared fields is
      // a different shape entirely; showing its raw keys beats showing nothing.
      return declared.length > 0
        ? declared
        : keys.map(key => ({
          key,
          label: key,
          format: null,
          numeric: typeof sample[key] === "number"
        }));
    }

    build() {
      if (this.elements) {
        return this.elements;
      }

      const document = root.document;
      const create = (tag, className) => {
        const node = document.createElement(tag);
        if (className) {
          node.className = className;
        }
        return node;
      };

      const overlay = create("div", "pivot-modal pivot-drill-down-modal");
      overlay.setAttribute("aria-hidden", "true");

      const dialog = create("div", "pivot-modal__dialog pivot-drill-down-dialog");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const head = create("div", "pivot-panel-head");
      const heading = create("div", "pivot-drill-down-heading");
      const title = create("h2");
      title.textContent = this.labels.title;
      const summary = create("span");
      heading.appendChild(title);
      heading.appendChild(summary);

      const close = create("button", "pivot-button");
      close.setAttribute("type", "button");
      close.textContent = this.labels.close;
      close.addEventListener("click", () => this.close());
      head.appendChild(heading);
      head.appendChild(close);

      const body = create("div", "pivot-drill-down-body");
      const toolbar = create("div", "pivot-drill-down-toolbar");
      const search = create("input");
      search.setAttribute("type", "search");
      search.setAttribute("placeholder", this.labels.search);
      search.setAttribute("autocomplete", "off");
      search.addEventListener("input", () => this.applyFilters());

      const csv = create("button", "pivot-button");
      csv.setAttribute("type", "button");
      csv.textContent = this.labels.csv;
      csv.disabled = true;
      csv.addEventListener("click", () => this.exportCsv());
      toolbar.appendChild(search);
      toolbar.appendChild(csv);

      const notice = create("div", "pivot-drill-down-notice");
      notice.hidden = true;
      const state = create("div", "pivot-drill-down-state");
      const tableWrap = create("div", "pivot-drill-down-table-wrap");
      tableWrap.hidden = true;

      const table = create("table", "pivot-drill-down-table");
      const thead = create("thead");
      const tbody = create("tbody");
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);

      body.appendChild(toolbar);
      body.appendChild(notice);
      body.appendChild(state);
      body.appendChild(tableWrap);

      dialog.appendChild(head);
      dialog.appendChild(body);
      overlay.appendChild(dialog);

      // A click that starts on the dialog must not close the modal, so only the
      // overlay itself counts as a backdrop click.
      overlay.addEventListener("click", event => {
        if (event.target === overlay) {
          this.close();
        }
      });

      this.keydownHandler = event => {
        if (event.key === "Escape" && this.isOpen) {
          this.close();
        }
      };
      root.document.addEventListener("keydown", this.keydownHandler);

      this.host.appendChild(overlay);
      this.elements = { overlay, title, summary, search, csv, notice, state, tableWrap, thead, tbody };
      return this.elements;
    }

    async open(selection) {
      if (this.disposed || selection?.type !== "cell" || selection.drillDownEnabled === false) {
        return;
      }

      const elements = this.build();
      const requestId = ++this.requestId;

      this.records = [];
      this.visibleRecords = [];
      this.columnFilters = {};
      this.response = null;
      this.isOpen = true;

      elements.search.value = "";
      elements.csv.disabled = true;
      elements.notice.hidden = true;
      elements.tableWrap.hidden = true;
      elements.overlay.classList.add("is-open");
      elements.overlay.setAttribute("aria-hidden", "false");
      elements.title.textContent = this.createTitle(selection);
      elements.summary.textContent = "";
      this.setState(this.labels.loading, false);

      try {
        const response = await this.widget.drillDown({
          rowPath: selection.rowHeader ?? [],
          columnPath: selection.columnHeader ?? [],
          valueKey: selection.valueKey
        });

        if (requestId !== this.requestId) {
          return;
        }

        this.response = response;
        this.records = response?.records ?? [];
        this.renderTable();
      } catch (error) {
        // An abort is this modal being superseded, not a failure worth showing.
        if (error?.name !== "AbortError" && requestId === this.requestId) {
          this.setState(error?.message || this.labels.failed, true);
          elements.summary.textContent = "";
        }
      }
    }

    close() {
      if (!this.elements) {
        return;
      }

      // Bumping the ticket makes any in-flight response stale, so a slow
      // drill-down cannot repopulate a modal the user has already closed.
      this.requestId++;
      this.isOpen = false;
      this.records = [];
      this.visibleRecords = [];
      this.columnFilters = {};
      this.response = null;
      this.elements.search.value = "";
      this.elements.overlay.classList.remove("is-open");
      this.elements.overlay.setAttribute("aria-hidden", "true");
    }

    createTitle(selection) {
      const rows = selection.rowHeader ?? [];
      const columns = selection.columnHeader ?? [];
      const rowLabel = rows.length > 0 ? rows.join(" / ") : this.labels.allRows;
      const columnLabel = columns.length > 0 ? columns.join(" / ") : this.labels.allColumns;
      const value = (this.widget.valueDefinitions?.() ?? [])
        .find(entry => entry.key === selection.valueKey);

      return `${rowLabel} · ${columnLabel} · ${value?.label ?? selection.valueKey}`;
    }

    renderTable() {
      const document = root.document;
      const elements = this.elements;
      this.activeColumns = this.resolveColumns(this.records);

      elements.thead.replaceChildren();
      const labelRow = document.createElement("tr");
      const filterRow = document.createElement("tr");

      this.activeColumns.forEach(column => {
        const header = document.createElement("th");
        header.textContent = column.label;
        labelRow.appendChild(header);

        const filterHeader = document.createElement("th");
        const select = document.createElement("select");
        select.setAttribute("aria-label", format(this.labels.columnFilter, column.label));

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = this.labels.all;
        select.appendChild(allOption);

        PivotForge.PivotDrillDownData.distinctValues(this.records, column).forEach(value => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value || this.labels.empty;
          select.appendChild(option);
        });

        select.addEventListener("change", event => {
          this.columnFilters[column.key] = event.target.value
            ? new Set([event.target.value])
            : new Set();
          this.applyFilters();
        });

        filterHeader.appendChild(select);
        filterRow.appendChild(filterHeader);
      });

      elements.thead.appendChild(labelRow);
      elements.thead.appendChild(filterRow);
      elements.tableWrap.hidden = false;
      elements.notice.hidden = !this.response?.truncated;
      elements.notice.textContent = this.response?.truncated
        ? format(this.labels.truncated, this.response.limit)
        : "";

      this.applyFilters();
    }

    applyFilters() {
      const document = root.document;
      const elements = this.elements;

      this.visibleRecords = PivotForge.PivotDrillDownData.filterRecords(
        this.records,
        this.activeColumns,
        elements.search.value,
        this.columnFilters);

      elements.tbody.replaceChildren();

      this.visibleRecords.forEach(record => {
        const row = document.createElement("tr");

        this.activeColumns.forEach(column => {
          const cell = document.createElement("td");
          if (column.numeric) {
            cell.className = "is-numeric";
          }
          cell.textContent = PivotForge.PivotDrillDownData.formatValue(record[column.key], column);
          row.appendChild(cell);
        });

        elements.tbody.appendChild(row);
      });

      const totalCount = this.response?.totalCount ?? this.records.length;
      elements.summary.textContent = format(
        this.labels.summary, this.visibleRecords.length, totalCount);
      elements.csv.disabled = this.visibleRecords.length === 0;

      if (this.visibleRecords.length === 0) {
        this.setState(
          this.records.length === 0 ? this.labels.noRecords : this.labels.noMatches,
          false);
      } else {
        this.setState("", false);
      }
    }

    setState(message, isError) {
      const state = this.elements.state;
      state.textContent = message;
      state.classList.toggle("error", isError);
      state.hidden = !message;
    }

    exportCsv() {
      if (this.visibleRecords.length === 0) {
        return;
      }

      const csv = PivotForge.PivotDrillDownData.toCsv(this.visibleRecords, this.activeColumns);
      const fileName = `pivot-detay-${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = new root.Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = root.URL.createObjectURL(blob);
      const link = root.document.createElement("a");

      link.href = url;
      link.download = fileName;
      link.click();
      root.URL.revokeObjectURL(url);
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.requestId++;
      this.isOpen = false;

      if (this.keydownHandler) {
        root.document.removeEventListener("keydown", this.keydownHandler);
        this.keydownHandler = null;
      }

      this.elements?.overlay.remove?.();
      this.elements = null;
    }
  }

  PivotForge.PivotDrillDownModal = PivotDrillDownModal;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotDrillDownModal;
  }
})(typeof window !== "undefined" ? window : globalThis);
