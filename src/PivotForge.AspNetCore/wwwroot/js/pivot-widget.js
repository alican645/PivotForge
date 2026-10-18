(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const DEFAULTS = {
    endpointPrefix: "/pivotforge",
    autoLoad: true,
    allowSorting: true,
    allowFiltering: true,
    allowDrillDown: true,
    drillDownModal: true,
    drillDownModalOptions: null,
    allowExcelExport: false,
    // The cell menu's conditional-formatting entry, and the panel behind it. A
    // page that turns this off gets no entry rather than a dead one.
    allowConditionalFormatting: true,
    conditionalPanelOptions: null,
    // The designer's calculated field editor. Only a page with a designer shows
    // it; a formula declared in the markup works whatever this says.
    allowCalculatedFields: true,
    // The "Loading..." panel over the grid while a refresh is in flight, with
    // the previous table dimmed beneath it. It appears only once a request has
    // run for loadPanelDelay milliseconds, so a fast answer does not flash it.
    loadPanel: true,
    loadPanelDelay: 300,
    // A strip of buttons above the grid: true for every item the grid can
    // offer, or a list naming which and in what order. Off unless asked for, so
    // a page that draws its own buttons keeps drawing them alone.
    toolbar: false,
    // A chart of the pivot beside the grid (pivot-chart.js): true, a type name
    // ("column", "stackedColumn", "bar", "line") or
    // { type, position: "top" | "bottom", height, valueKey, visible }. The
    // reader can switch its type and value, and hide it from the toolbar's
    // "chart" button; all three are kept with the rest of the view.
    chart: null,
    largeData: false,
    pageSize: 40,
    sourceRowCount: 100000,
    // Dropped in the engine rather than hidden in the browser, so paging, Excel
    // export and drill-down all agree on which rows exist.
    hideEmptySummaryCells: false,
    // A filter picker lists only the values the other fields' filters leave
    // (DevExtreme's headerFilter.showRelevantValues). Never the field's own
    // filter: a value unchecked there has to stay on the list to come back.
    showRelevantValues: false,
    // Excel's "Defer layout update" box on the designer: null leaves it off the
    // panel, true or false shows it ticked or not.
    deferLayoutUpdate: null,
    // Right to left (DevExtreme's rtlEnabled). Null follows the page: the
    // stylesheet is written in logical properties, so a grid inside dir="rtl"
    // mirrors without being told. True or false pins the grid either way.
    rtlEnabled: null,
    topN: [],
    // Row levels kept only where their summary value meets a condition:
    // { field, operator, value, value2?, valueKey? }. Like topN they run after
    // aggregation, in the engine; unlike topN the reader can change them.
    valueFilters: [],
    rendererOptions: null,
    // A locale pack name ("tr") or an object shaped like one. It supplies the
    // language for every component that puts text on screen; anything the page
    // declared explicitly still wins over it.
    locale: null,
    // The field designer's labels, and through `filterPicker` the value
    // picker's. Declared here rather than on the designer because the widget is
    // what builds it.
    designerLabels: null,
    events: null,
    fetchImpl: null,
    renderImpl: null,
    fieldDesigner: null,
    stateStoring: null,
    stateKey: null
  };

  // Bumped only when a stored payload can no longer be read by this code. An
  // older or newer version is ignored rather than migrated, so a stale entry
  // costs the user their saved layout, never a broken page.
  const STATE_VERSION = 1;
  const STATE_PREFIX = "pivotforge:state:";
  const STORAGES = { local: "localStorage", session: "sessionStorage" };

  // Both exports hand back a file without saving it, which left every consuming
  // page writing the same anchor dance. Takes exactly what they return, so a
  // download is one call rather than a destructuring plus five lines.
  PivotForge.download = function download(file) {
    const document = root.document;

    if (!file?.blob || !document) {
      return false;
    }

    const url = root.URL.createObjectURL(file.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.fileName ?? "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    root.URL.revokeObjectURL(url);
    return true;
  };

  // The cell context an "exporting" handler reads is for the page, not the
  // server: it would only grow the request and tie the endpoint's contract to
  // the renderer's.
  function serializeExportDocument(document) {
    return JSON.stringify(document, (key, value) => (key === "source" ? undefined : value));
  }

  function isConditionalRule(rule) {
    return PivotForge.isConditionalRule?.(rule) ?? true;
  }

  function resolveTarget(target) {
    if (typeof target === "string") {
      const found = root.document?.querySelector(target);
      if (!found) {
        throw new Error(`PivotForge.create could not find an element matching "${target}".`);
      }
      return found;
    }

    if (!target) {
      throw new Error("PivotForge.create requires a target element or selector.");
    }

    return target;
  }

  // Every event a widget emits, and the DOM event name it dispatches alongside.
  // DOM event names are lowercased because that is the convention listeners
  // expect; the widget's own on()/emit() keeps the camelCase name.
  const EVENTS = [
    "dataLoading",
    "dataLoaded",
    "error",
    "selectionChanged",
    "cellDoubleClick",
    "cellCopied",
    "cellFilterRequested",
    "conditionalFormatRequested",
    "viewStateChanged",
    "exporting"
  ];

  // Looks up a handler declared by name, so Razor markup can name a function
  // without the page writing any wiring code. A dotted path is walked so a
  // handler can live on an app namespace instead of directly on window.
  //
  // Resolved when the event fires rather than when the grid is created. A Razor
  // helper initializes the grid inline, where its markup sits, which is before a
  // script block further down the page has run — resolving eagerly would reject
  // every handler declared in the natural place for one.
  function resolveHandler(root, path, eventName) {
    const found = String(path ?? "")
      .split(".")
      .filter(Boolean)
      .reduce((scope, part) => (scope == null ? undefined : scope[part]), root);

    if (typeof found !== "function") {
      throw new Error(
        `PivotForge event handler "${path}" for "${eventName}" is not a function on the page.`
      );
    }

    return found;
  }

  // Two column paths name the same column when both are absent (the row total)
  // or they match value for value.
  function sameSortColumnPath(left, right) {
    if (!left || !right) {
      return !left && !right;
    }

    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  // The direction a row or column field's own level runs in, as the request
  // builder sends it: a value sort declared without a direction ascends, and a
  // field that declares neither is left to the axis default (null).
  function fieldSortDirection(field) {
    return field.sortOrder ?? (field.sortByValueKey ? "Ascending" : null);
  }

  function normalizePrefix(prefix) {
    const trimmed = String(prefix ?? "").trim();
    const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
  }

  // Extracts the file name the server suggested for a download, preferring the
  // RFC 5987 encoded form (filename*=) over the plain quoted form (filename=).
  function parseContentDispositionFileName(headerValue) {
    if (!headerValue) {
      return null;
    }

    const encodedName = headerValue.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encodedName) {
      try {
        return decodeURIComponent(encodedName);
      } catch {
        // Fall through to the plain form when the encoded value is malformed.
      }
    }

    const plainName = headerValue.match(/filename="?([^";]+)"?/i)?.[1];
    return plainName ?? null;
  }

  // What a toolbar button does, and the English text it shows until a locale or
  // the page names it otherwise.
  const TOOLBAR_ITEMS = {
    excel: { text: "toolbarExcel", label: "Excel" },
    csv: { text: "toolbarCsv", label: "CSV" },
    print: { text: "toolbarPrint", label: "Print" },
    expandAll: { text: "toolbarExpandAll", label: "Expand all" },
    collapseAll: { text: "toolbarCollapseAll", label: "Collapse all" },
    saveReport: { text: "toolbarSaveReport", label: "Save report" },
    openReport: { text: "toolbarOpenReport", label: "Open report" },
    fullscreen: { text: "toolbarFullscreen", label: "Full screen" },
    chart: { text: "toolbarChart", label: "Chart" }
  };

  // Written into a saved report file beside the state's version, so a file
  // picked by mistake is told apart from a view this grid can open.
  const REPORT_FORMAT = "pivotforge-report";

  class PivotWidget {
    constructor(container, options) {
      this.container = container;
      this.options = { ...DEFAULTS, ...options };
      this.endpointPrefix = normalizePrefix(this.options.endpointPrefix);
      this.handlers = new Map();
      this.disposed = false;
      this.loading = false;
      this.result = null;
      this.error = null;
      this.request = null;
      this.controller = null;
      this.requestToken = 0;
      this.filters = [...(this.options.filters ?? [])];
      this.valueFilters = PivotForge.PivotRequestBuilder.normalizeValueFilters(this.options.valueFilters);
      this.rowSort = this.options.rowSort ?? null;
      // The column axis' value sort, { valueKey, rowPath, direction }: "sort
      // columns by this row". Null leaves each column field's own order.
      this.columnSort = this.options.columnSort ?? null;
      // Seeded from the declared rules and owned from here on, so a rule added
      // at runtime and one written in Razor live in the same list.
      this.conditionalRules = [...(this.options.rendererOptions?.conditionalRules ?? [])];
      this.sessionId = null;
      this.totalRowCount = 0;

      // Validate eagerly so configuration mistakes surface at the call site.
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields ?? []);
      // The declared catalog, kept apart from options.fields, which the designer
      // rewrites to the current layout: an opened report is laid out against
      // every field the page offers, not only the ones on screen.
      this.declaredFields = this.options.fields ?? [];
      PivotForge.PivotRequestBuilder.buildRequest(this.options.fields ?? []);

      // Resolved before anything reads state, and never fatal: a page that
      // cannot persist is a page that keeps working from its declaration.
      this.stateStorageName = this.resolveStateStorage();
      this.stateKey = this.resolveStateKey();
      const restored = this.readState();

      if (restored?.filters) {
        this.filters = restored.filters;
      }

      if (restored?.rowSort !== undefined) {
        this.rowSort = restored.rowSort;
      }

      if (restored?.columnSort !== undefined) {
        this.columnSort = restored.columnSort;
      }

      if (restored?.valueFilters) {
        this.valueFilters = restored.valueFilters;
      }

      // Replaces the declared rules rather than adding to them, because that is
      // what was stored: the reader's list already contained whatever the markup
      // declared when it was saved. A page whose declared rules have since
      // changed reaches them again through clearState().
      if (restored?.conditionalRules) {
        this.conditionalRules = restored.conditionalRules;
      }

      // Which axis several values are drawn along. Declared through
      // rendererOptions; once a designer's Σ Values chip moves it, the layout
      // owns it and a stored view brings it back.
      this.valuesPosition = restored?.layout?.valuesPosition ?? this.declaredValuesPosition();

      // Before the renderer, which is the first thing to put text on screen.
      this.locale = this.resolveLocale();
      this.applyDirection(this.container);

      this.subscribeDeclaredEvents();

      this.renderer = this.options.renderImpl ? null : this.createRenderer();

      // Before the toolbar, which offers its chart button only for a chart.
      this.chartOptions = this.resolveChartOptions();
      this.chartState = this.chartOptions
        ? {
          type: restored?.chart?.type ?? this.chartOptions.type,
          valueKey: restored?.chart?.valueKey ?? this.chartOptions.valueKey
        }
        : null;
      // Kept beside the chart's own state rather than in it: the chart knows
      // what it draws, the widget whether it is drawn at all.
      this.chartVisible = this.chartOptions
        ? restored?.chart?.visible ?? this.chartOptions.visible
        : false;

      this.toolbarNode = this.createToolbar();
      this.applyDirection(this.toolbarNode);

      // After the toolbar, so a chart above the grid sits between the two.
      this.chart = this.createChart();

      this.layoutState = null;
      this.designer = null;
      this.drillDownModal = null;
      // Built on first use, and only when there is no designer to borrow one
      // from, so a page that never touches a header funnel pays nothing.
      this.headerFilterPicker = null;

      if (this.options.fieldDesigner) {
        if (!PivotForge.PivotLayoutState || !PivotForge.PivotFieldDesigner) {
          throw new Error(
            "fieldDesigner requires pivot-layout-state.js and pivot-field-designer.js to be loaded."
          );
        }

        this.layoutState = this.createLayoutState(restored);
        if (!restored?.layout?.valuesPosition) {
          this.layoutState.adoptValuesPosition(this.valuesPosition);
        }

        // The designer shows the restored layout, so the grid has to draw it
        // too. Without this the chips came back as saved while the first
        // request still went out with the declared fields.
        if (restored?.layout) {
          this.options.fields = this.layoutState.toFields();
          this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields);
          // Built above from the declaration, and it labels headers from it.
          if (this.renderer) {
            this.renderer = this.createRenderer();
          }
        }
        this.designer = new PivotForge.PivotFieldDesigner(this.options.fieldDesigner, {
          state: this.layoutState,
          widget: this,
          labels: this.designerLabels(),
          allowCalculatedFields: this.options.allowCalculatedFields !== false,
          deferUpdates: this.options.deferLayoutUpdate
        });
        this.applyDirection(this.designer.host);
        // Caption edits and filter-value picks never travel through a widget
        // method, so subscribing here is what makes them persist at all.
        this.layoutState.on("change", () => this.saveState());
      }
    }

    // A stored layout is a preference, not a contract: the field catalog may
    // have changed since it was written, and PivotLayoutState rightly refuses a
    // layout it cannot honour. Falling back to the declaration beats a page
    // that will not load.
    createLayoutState(restored) {
      if (restored?.layout) {
        try {
          return new PivotForge.PivotLayoutState(
            this.options.fields,
            {
              ...restored.layout,
              captions: restored.captions,
              sortOrders: restored.sortOrders,
              sortBys: restored.sortBys,
              groupSizes: restored.groupSizes
            });
        } catch {
          this.filters = [...(this.options.filters ?? [])];
        }
      }

      return new PivotForge.PivotLayoutState(this.options.fields);
    }

    // Writes the declared direction onto an element the widget owns. Undeclared
    // leaves it alone, so it inherits whatever the page says.
    applyDirection(element) {
      if (!element || typeof this.options.rtlEnabled !== "boolean") {
        return;
      }

      element.dir = this.options.rtlEnabled ? "rtl" : "ltr";
    }

    declaredValuesPosition() {
      return this.options.rendererOptions?.valuesPosition === "rows" ? "rows" : "columns";
    }

    resolveStateStorage() {
      const requested = this.options.stateStoring;

      if (requested === null || requested === undefined || requested === false) {
        return null;
      }

      if (!Object.hasOwn(STORAGES, requested)) {
        throw new Error(
          `Unknown stateStoring "${requested}". Expected "local", "session", or null.`);
      }

      return STORAGES[requested];
    }

    // The key is best-effort by design: naming one is how a page opts in, and a
    // page that does not is simply not persisted. Inventing a shared default
    // would let two grids overwrite each other's layouts.
    resolveStateKey() {
      if (!this.stateStorageName) {
        return null;
      }

      const name = this.options.stateKey ?? this.container?.id ?? "";
      return name ? `${STATE_PREFIX}${name}` : null;
    }

    // Access itself can throw — a browser with storage disabled raises on the
    // property, not just on read — so every touch is guarded.
    stateStorage() {
      if (!this.stateKey) {
        return null;
      }

      try {
        return root[this.stateStorageName] ?? null;
      } catch {
        return null;
      }
    }

    readState() {
      const storage = this.stateStorage();
      if (!storage) {
        return null;
      }

      let payload = null;
      try {
        const raw = storage.getItem(this.stateKey);
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }

      return payload?.version === STATE_VERSION ? this.parseState(payload) : null;
    }

    // What a stored payload -- or an opened report -- restores, with anything
    // this grid can no longer honour left out.
    parseState(payload) {
      return {
        layout: payload.layout ?? null,
        captions: payload.captions ?? null,
        sortOrders: payload.sortOrders ?? null,
        sortBys: payload.sortBys ?? null,
        groupSizes: payload.groupSizes ?? null,
        // A filter naming a field the catalog dropped would be rejected by the
        // server, so it is discarded here rather than sent. A mode the vocabulary
        // does not know is discarded the same way rather than thrown on: a view
        // stored by an older or a tampered-with client should still open.
        filters: Array.isArray(payload.filters)
          ? payload.filters.filter(filter =>
            this.fields.some(field => field.key === filter?.field) &&
            Array.isArray(filter.values) &&
            (filter.mode === undefined ||
              PivotForge.PivotRequestBuilder.FILTER_MODES.includes(filter.mode)))
            .map(filter => ({
              field: filter.field,
              values: [...filter.values],
              // A view stored before modes existed is an including filter, which
              // is what it did when it was saved.
              mode: filter.mode ?? "Include"
            }))
          : null,
        rowSort: payload.rowSort ?? null,
        columnSort: payload.columnSort ?? null,
        // Each entry checked on its own, so one a newer or tampered-with client
        // wrote is dropped rather than costing the reader the rest of the view.
        valueFilters: Array.isArray(payload.valueFilters)
          ? payload.valueFilters.flatMap(filter => {
            try {
              return PivotForge.PivotRequestBuilder.normalizeValueFilters([filter]);
            } catch {
              return [];
            }
          })
          : null,
        // A rule the renderer could not act on is dropped rather than thrown
        // on, the same bargain the filters above make: a view stored by an
        // older or a tampered-with client should still open. A rule naming a
        // measure that is not on screen right now is NOT dropped -- it paints
        // nothing until the reader brings that measure back, which is the
        // behaviour they saved.
        conditionalRules: Array.isArray(payload.conditionalRules)
          ? payload.conditionalRules.filter(isConditionalRule)
          : null,
        chart: this.parseChartState(payload.chart)
      };
    }

    // A type this build does not draw is dropped rather than thrown on, and
    // takes the value key with it only when that is malformed too.
    parseChartState(chart) {
      if (!chart || typeof chart !== "object") {
        return null;
      }

      const types = PivotForge.PivotChart?.TYPES ?? [];
      return {
        type: types.includes(chart.type) ? chart.type : undefined,
        valueKey: typeof chart.valueKey === "string" ? chart.valueKey : undefined,
        visible: typeof chart.visible === "boolean" ? chart.visible : undefined
      };
    }

    saveState() {
      const storage = this.stateStorage();
      if (!storage) {
        return false;
      }

      try {
        storage.setItem(this.stateKey, JSON.stringify(this.snapshotState()));
        return true;
      } catch {
        return false;
      }
    }

    // The view as state-storing keeps it: layout, captions, filters, sorts and
    // conditional rules -- everything the reader changed, nothing the page
    // declares anyway.
    snapshotState() {
      const layout = this.layoutState?.getState() ?? null;
      return {
        version: STATE_VERSION,
        ...(layout
          ? {
            // available is derived from the catalog on every read, so storing
            // it would only let a stale copy contradict the catalog.
            layout: {
              rows: layout.rows,
              columns: layout.columns,
              values: layout.values,
              filters: layout.filters,
              // Only when the reader moved the values away from where the page
              // declared them, so a view saved before the Σ chip existed is
              // byte-identical -- and one that left them there follows the
              // declaration if the page later changes it.
              ...(layout.valuesPosition !== this.declaredValuesPosition()
                ? { valuesPosition: layout.valuesPosition }
                : {}),
              // Before the placements on the way back in, which may seat them.
              ...(layout.calculatedFields.length > 0
                ? { calculatedFields: layout.calculatedFields }
                : {})
            },
            captions: layout.captions,
            sortOrders: layout.sortOrders,
            sortBys: layout.sortBys,
            // Only when the reader changed one, so a view saved before range
            // widths could be changed is byte-identical.
            ...(Object.keys(layout.groupSizes ?? {}).length > 0 ? { groupSizes: layout.groupSizes } : {})
          }
          : {}),
        filters: layout
          ? layout.filters.filter(PivotForge.PivotRequestBuilder.restricts)
          : this.filters,
        rowSort: this.rowSort,
        columnSort: this.columnSort,
        valueFilters: this.valueFilters,
        conditionalRules: this.conditionalRules,
        ...(this.chartState ? { chart: { ...this.chartState, visible: this.chartVisible } } : {})
      };
    }

    // The view as a file the reader keeps or hands on, and opens again with
    // loadReport -- in this grid or another page offering the same fields.
    exportReport(options = {}) {
      this.assertNotDisposed();
      const text = JSON.stringify({ format: REPORT_FORMAT, ...this.snapshotState() }, null, 2);

      return {
        blob: new root.Blob([text], { type: "application/json" }),
        fileName: options.fileName ?? `pivotforge-report-${new Date().toISOString().slice(0, 10)}.json`
      };
    }

    // Opens a report exportReport wrote: a File or Blob, its JSON text, or the
    // parsed object. Unlike a stored view, which falls back to the declaration
    // when it no longer fits, a report the reader picked and that does not fit
    // is an error -- they asked for that view, not for whatever loads.
    async loadReport(source) {
      this.assertNotDisposed();
      const text = typeof source?.text === "function" ? await source.text() : source;
      let payload;
      try {
        payload = typeof text === "string" ? JSON.parse(text) : text;
      } catch {
        throw new Error("This file is not a PivotForge report: it is not JSON.");
      }

      if (payload?.format !== REPORT_FORMAT || payload.version !== STATE_VERSION) {
        throw new Error("This file is not a PivotForge report this grid can open.");
      }

      const report = this.parseState(payload);

      if (report.layout && PivotForge.PivotLayoutState) {
        const state = new PivotForge.PivotLayoutState(this.declaredFields, {
          ...report.layout,
          captions: report.captions,
          sortOrders: report.sortOrders,
          sortBys: report.sortBys,
          groupSizes: report.groupSizes
        });

        // A report silent about it left the values where the page declares them.
        if (!report.layout.valuesPosition) {
          state.adoptValuesPosition(this.declaredValuesPosition());
        }
        this.options.fields = state.toFields();
        this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields);
        this.valuesPosition = state.valuesPosition;

        if (this.layoutState) {
          this.layoutState = state;
          this.layoutState.on("change", () => this.saveState());
          if (this.designer) {
            this.designer.state = state;
            this.designer.render();
          }
        }

        if (this.renderer) {
          this.renderer = this.createRenderer();
        }
      }

      // Read again now the fields are the report's: a filter on a field the
      // report seats is checked against those fields, not the ones it replaced.
      const filters = this.parseState(payload).filters;
      this.filters = filters ?? (report.layout ? [] : this.filters);
      this.rowSort = report.rowSort;
      this.columnSort = report.columnSort;
      this.valueFilters = report.valueFilters ?? [];
      this.syncRendererSortState();
      if (report.conditionalRules) {
        this.conditionalRules = report.conditionalRules;
      }

      if (report.chart && this.chartState) {
        this.chartState = {
          type: report.chart.type ?? this.chartState.type,
          valueKey: report.chart.valueKey ?? this.chartState.valueKey
        };
        this.chart?.setState(this.chartState);
        if (report.chart.visible !== undefined) {
          this.showChart(report.chart.visible, { save: false });
        }
      }

      this.saveState();
      return this.refresh();
    }

    clearState() {
      const storage = this.stateStorage();
      if (!storage) {
        return false;
      }

      try {
        storage.removeItem(this.stateKey);
        return true;
      } catch {
        return false;
      }
    }

    // A name is looked up among the loaded locale packs; an object is taken as
    // one. A name nothing answers to leaves every component in English rather
    // than failing the grid over a presentation file that did not load -- the
    // warning is for the developer, the English is for the reader.
    resolveLocale() {
      const locale = this.options.locale;
      // English is the built-in language rather than a pack, so naming it loads
      // nothing and warns about nothing -- which is what lets the tag helper
      // derive a locale from the request without noise on English pages.
      if (!locale || locale === "en") {
        return {};
      }

      if (typeof locale === "object") {
        return locale;
      }

      const found = PivotForge.locales?.[locale];
      if (!found) {
        root.console?.warn(
          `PivotForge: locale "${locale}" is not loaded. Reference pivot-locale-${locale}.js before pivot-widget.js.`);
        return {};
      }

      return found;
    }

    // The designer's labels, and nested under them the value picker's -- the
    // designer is what opens it. Declared labels win over the locale key by
    // key, so translating one term does not cost the rest of the language.
    designerLabels() {
      const declared = this.options.designerLabels ?? {};
      return {
        ...this.locale.designer,
        ...declared,
        filterPicker: this.filterPickerLabels()
      };
    }

    // Operators one level down as well: a page renaming one condition keeps
    // the pack's names for the other seven.
    filterPickerLabels() {
      const declared = this.options.designerLabels?.filterPicker ?? {};
      return {
        ...this.locale.filterPicker,
        ...declared,
        operators: { ...this.locale.filterPicker?.operators, ...declared.operators }
      };
    }

    createRenderer() {
      const Renderer = PivotForge.PivotTableRenderer;
      if (!Renderer) {
        throw new Error(
          "PivotForge.PivotTableRenderer is not loaded. Reference pivot-table.js before pivot-widget.js."
        );
      }

      const rowFields = this.fields.filter(field => field.visible && field.area === "row");
      const columnFields = this.fields.filter(field => field.visible && field.area === "column");
      const consumer = this.options.rendererOptions ?? {};

      // Emits the widget event, then hands the same payload to whatever the
      // consumer supplied through rendererOptions. Declared AFTER the spread so
      // the event always fires, while the consumer's own callback still runs --
      // otherwise supplying a callback would silently switch the event off.
      const bridge = (eventName, payload) => {
        this.emit(eventName, payload);
        consumer[`on${eventName[0].toUpperCase()}${eventName.slice(1)}`]?.(payload);
      };

      // The locale leads: it carries presentation strings that live outside
      // `texts` too (totalText, ariaLabel), and a rendererOption the page
      // declared still overrides it below.
      const localeTable = this.locale.table ?? {};

      return new Renderer(this.container, {
        ...localeTable,
        rowFields: rowFields.map(field => field.key),
        rowFieldLabels: rowFields.map(field => field.caption),
        rowFieldExpanded: rowFields.map(field => field.expanded),
        rowFieldSubtotals: rowFields.map(field => field.showTotals),
        // Per field, parallel to rowFields / columnFields like the two above.
        rowFieldAllowSorting: rowFields.map(field => field.allowSorting),
        rowFieldAllowFiltering: rowFields.map(field => field.allowFiltering),
        rowFieldWidths: rowFields.map(field => field.width),
        rowFieldWordWrap: rowFields.map(field => field.wordWrap),
        // The field's own order, set by a declaration or the designer's sort
        // panel; a row sort picked in the grid stands in for all of them.
        rowFieldSorts: rowFields.map(fieldSortDirection),
        // The column axis needs its field names spelled out before it can carry a
        // funnel: its headers show values, never the field they belong to.
        columnFields: columnFields.map(field => field.key),
        columnFieldLabels: columnFields.map(field => field.caption),
        columnFieldSubtotals: columnFields.map(field => field.showTotals),
        columnFieldAllowSorting: columnFields.map(field => field.allowSorting),
        columnFieldAllowFiltering: columnFields.map(field => field.allowFiltering),
        columnFieldWordWrap: columnFields.map(field => field.wordWrap),
        columnFieldExpanded: columnFields.map(field => field.expanded),
        // Read at construction only: a column sort changes the fields, and a
        // field change builds a new renderer.
        columnFieldSorts: columnFields.map(fieldSortDirection),
        onSortRequested: this.options.allowSorting
          ? request => {
            // A column field's arrow orders that level's own values, which the
            // engine takes from the field's sortOrder rather than the row sort.
            if (request?.mode === "ColumnLabel") {
              this.sortColumnField(request.field);
              return;
            }

            // "Sort columns by this row" orders every column level by that
            // row's value, which the engine reads from the column fields.
            if (request?.mode === "ColumnTotalValue") {
              this.sortColumnsBy(this.nextColumnSort(request));
              return;
            }

            this.sortBy(this.nextHeaderSort(request));
          }
          : null,
        onFilterRequested: this.canHeaderFilter()
          ? (field, anchor) => { this.openHeaderFilter(field, anchor); }
          : null,
        filteredFields: this.filteredFields(),
        // Without this the renderer treats every result as unsorted and re-orders
        // rows itself, discarding the ordering the server was just asked for.
        // Declared before the spread so a consumer driving sorting through
        // rendererOptions keeps ownership until this widget actually sorts.
        sortState: this.rowSort,
        columnSortState: this.columnSort,
        // The renderer outlives every rule change, so this is also passed per
        // draw in render(); declaring it here is what a first draw reads.
        conditionalRules: this.conditionalRules,
        // Left unset, the renderer auto-detects a single value key from the
        // payload, labels it with that raw key and applies no format — so
        // captions are lost and a second data field disappears.
        values: this.valueDefinitions(),
        ...consumer,
        // After the spread: the declaration seeds it, the Σ Values chip owns it.
        valuesPosition: this.valuesPosition,
        // A cell activation always announces itself. The packaged detail modal
        // opens only when the consumer did not bring its own detail UI, so a
        // page with its own modal does not get two.
        onCellDoubleClick: selection => {
          this.emit("cellDoubleClick", selection);

          if (consumer.onCellDoubleClick) {
            consumer.onCellDoubleClick(selection);
            return;
          }

          this.drillDownHandler()?.(selection);
        },
        // Merged rather than replaced: a page overriding one string keeps the
        // locale's other seventeen.
        texts: { ...localeTable.texts, ...(consumer.texts ?? {}) },
        onSelectionChanged: selection => bridge("selectionChanged", selection),
        onCellFilterRequested: selection => bridge("cellFilterRequested", selection),
        // Announced first, then handled. A page that brought its own panel
        // through rendererOptions keeps it; one that did not gets the packaged
        // panel; a page with neither gets no menu entry at all, because the
        // renderer hides the entry when this is null.
        onConditionalFormatRequested: this.canEditConditionalFormat() || consumer.onConditionalFormatRequested
          ? (selection, cell) => {
            this.emit("conditionalFormatRequested", selection);

            if (consumer.onConditionalFormatRequested) {
              consumer.onConditionalFormatRequested(selection, cell);
              return;
            }

            this.openConditionalPanel(selection, cell);
          }
          : null,
        onViewStateChanged: state => bridge("viewStateChanged", state),
        // The renderer reports this as three positional arguments; the event
        // carries them as one object so listeners are not order-dependent.
        onCellCopied: (text, copied, kind) => {
          this.emit("cellCopied", { text, copied, kind });
          consumer.onCellCopied?.(text, copied, kind);
        }
      });
    }

    // Joins cell activation to the packaged detail modal. Returns null — the
    // renderer's "no handler" value — whenever drill-down is off, the modal was
    // declined, or pivot-drill-down-modal.js was never loaded, so an absent
    // script degrades to no detail view rather than a broken widget.
    drillDownHandler() {
      if (!this.options.allowDrillDown ||
          this.options.drillDownModal === false ||
          !PivotForge.PivotDrillDownModal) {
        return null;
      }

      return selection => { this.openDrillDown(selection); };
    }

    // Built on first use: a page that never drills down pays nothing, and the
    // modal's DOM stays out of the document until it is actually needed.
    openDrillDown(selection) {
      this.drillDownModal ??= new PivotForge.PivotDrillDownModal({
        // Spread first, so a page that pins the modal's culture on purpose wins
        // over the renderer's — but by default the two cannot drift apart.
        culture: this.options.rendererOptions?.culture ?? null,
        ...(this.options.drillDownModalOptions ?? {}),
        widget: this,
        labels: this.drillDownLabels()
      });

      return this.drillDownModal.open(selection);
    }

    // Describes the data-area fields for the renderer, in declaration order.
    // The key must match how the server keys its cells and totals, which is
    // exactly what PivotRequestBuilder.valueKey produces.
    valueDefinitions() {
      return this.fields
        .filter(field => field.visible && field.area === "data")
        .map(field => ({
          key: PivotForge.PivotRequestBuilder.valueKey(field),
          label: field.caption,
          aggregation: field.aggregation,
          showAs: field.showAs,
          format: field.format,
          showGrandTotals: field.showGrandTotals,
          showValues: field.showValues,
          showTotals: field.showTotals,
          allowSorting: field.allowSorting,
          width: field.width,
          wordWrap: field.wordWrap,
          customizeText: field.customizeText
        }));
    }

    // The renderer is built once and reused across refreshes, so a sort applied
    // after construction has to be pushed onto it.
    syncRendererSortState() {
      if (this.renderer) {
        this.renderer.options.sortState = this.rowSort;
        this.renderer.options.columnSortState = this.columnSort;
      }
    }

    // The header funnel needs somewhere to fetch values from and something to
    // show them in. A page that loaded neither gets no funnel at all, the same
    // bargain the designer's chip funnel makes.
    canHeaderFilter() {
      return Boolean(this.options.allowFiltering && PivotForge.PivotFilterPicker);
    }

    // Which fields are restricted right now, so the header can mark its funnel.
    // An empty value list is no restriction, so it does not count.
    filteredFields() {
      // A blank condition carries no values and still restricts, so counting
      // values would leave its funnel looking inactive.
      // A value filter restricts its field's groups too, so it lights the
      // same funnel a picked value would.
      return [...new Set([
        ...this.filters.filter(PivotForge.PivotRequestBuilder.restricts).map(filter => filter.field),
        ...this.activeValueFilters().map(filter => filter.field)
      ])];
    }

    // The row header's funnel and the designer's filter chip open one picker
    // over one entry; only the way in differs. With a designer attached the
    // layout state owns the filters, so the picker is opened through it.
    // `anchor` is the funnel that was pressed, so the picker can drop down
    // under it.
    openHeaderFilter(field, anchor = null) {
      if (this.designer) {
        return this.designer.openFilterPicker(field, anchor);
      }

      this.headerFilterPicker ??= new PivotForge.PivotFilterPicker({
        widget: this,
        labels: this.filterPickerLabels()
      });
      const current = this.filters.find(filter => filter.field === field) ?? null;

      return this.headerFilterPicker.open({
        field,
        caption: this.fields.find(entry => entry.key === field)?.caption ?? field,
        selected: current?.values ?? [],
        mode: current?.mode ?? "Include",
        operator: current?.operator ?? "Equals",
        anchor,
        onApply: (values, mode, operator) => this.setFilter(field, values, mode, operator)
      });
    }

    // Merged key by key, as the panel's and the designer's are: a page renaming
    // the title keeps the pack's words for the other fifteen labels. (Spreading
    // the options over the pack replaced the whole set.)
    drillDownLabels() {
      return {
        ...this.locale.drillDown,
        ...(this.options.drillDownModalOptions?.labels ?? {})
      };
    }

    conditionalPanelLabels() {
      return {
        ...this.locale.conditionalPanel,
        ...(this.options.conditionalPanelOptions?.labels ?? {})
      };
    }

    // The same bargain the header funnel makes: a page that turned the feature
    // off, or never loaded pivot-conditional-panel.js, gets no menu entry
    // rather than one that does nothing when clicked.
    canEditConditionalFormat() {
      return Boolean(
        this.options.allowConditionalFormatting && PivotForge.PivotConditionalPanel);
    }

    openConditionalPanel(selection, cell) {
      if (!this.canEditConditionalFormat() || !selection?.valueKey) {
        return null;
      }

      this.conditionalPanel ??= new PivotForge.PivotConditionalPanel({
        ...(this.options.conditionalPanelOptions ?? {}),
        labels: this.conditionalPanelLabels()
      });

      return this.conditionalPanel.open({
        valueKey: selection.valueKey,
        caption: this.valueDefinitions()
          .find(value => value.key === selection.valueKey)?.label ?? selection.valueKey,
        value: selection.value,
        valueText: cell?.textContent?.trim() ?? "",
        anchor: cell,
        onApply: rule => this.addConditionalRule(rule),
        onClear: valueKey => this.clearConditionalRules(valueKey)
      });
    }

    // Redraws with the rules that exist now. No refetch: a rule decides how a
    // number is painted, never which numbers there are.
    addConditionalRule(rule) {
      // Refused rather than stored: a rule the renderer cannot act on would sit
      // in the list and in storage colouring nothing, which reads as the
      // feature being broken rather than the call being wrong.
      if (!isConditionalRule(rule)) {
        throw new Error(
          "A conditional rule needs a valueKey, a known operator and color, and a finite threshold.");
      }

      this.conditionalRules = [...this.conditionalRules, rule];
      this.rerender();
      this.saveState();
      return this;
    }

    // Named by measure rather than by rule id, because that is what the panel
    // can offer: it is opened on a cell, and a cell knows its measure.
    clearConditionalRules(valueKey = null) {
      this.conditionalRules = valueKey === null
        ? []
        : this.conditionalRules.filter(rule => rule.valueKey !== valueKey);
      this.rerender();
      this.saveState();
      return this;
    }

    // Anything the renderer could not act on is dropped rather than refused:
    // this is the call that restores a saved view, and one unreadable rule must
    // not cost the reader the rest of them.
    setConditionalRules(rules) {
      this.conditionalRules = [...(rules ?? [])].filter(isConditionalRule);
      this.rerender();
      this.saveState();
      return this;
    }

    rerender() {
      if (this.result) {
        this.render(this.result);
      }
    }

    on(eventName, handler) {
      if (typeof handler !== "function") {
        throw new Error(`Handler for "${eventName}" must be a function.`);
      }

      const handlers = this.handlers.get(eventName) ?? new Set();
      handlers.add(handler);
      this.handlers.set(eventName, handlers);
      return () => handlers.delete(handler);
    }

    emit(eventName, payload) {
      this.handlers.get(eventName)?.forEach(handler => handler(payload));
      this.dispatchDomEvent(eventName, payload);
    }

    // Mirrors every emitted event onto the container as a CustomEvent, so a page
    // can listen with addEventListener instead of reaching into the instance.
    dispatchDomEvent(eventName, payload) {
      if (typeof this.container?.dispatchEvent !== "function" || !root.CustomEvent) {
        return;
      }

      this.container.dispatchEvent(new root.CustomEvent(
        `pivotforge:${eventName.toLowerCase()}`,
        { detail: payload, bubbles: true }));
    }

    // Subscribes the handlers named in the declarative `events` option. The event
    // names are checked now — that is a configuration mistake we can always catch
    // — while each handler name is resolved when its event first fires.
    subscribeDeclaredEvents() {
      const declared = this.options.events;
      if (!declared) {
        return;
      }

      Object.entries(declared).forEach(([eventName, path]) => {
        if (!EVENTS.includes(eventName)) {
          throw new Error(
            `Unknown PivotForge event "${eventName}". Expected one of: ${EVENTS.join(", ")}.`
          );
        }

        if (path === null || path === undefined) {
          return;
        }

        this.on(eventName, payload => resolveHandler(root, path, eventName)(payload));
      });
    }

    // Shared guard for methods that issue a network request or mutate state,
    // so disposal is enforced consistently instead of ad hoc per method.
    assertNotDisposed() {
      if (this.disposed) {
        throw new Error("This PivotForge widget has been disposed.");
      }
    }

    getState() {
      return {
        fields: this.fields,
        request: this.request,
        result: this.result,
        error: this.error,
        loading: this.loading,
        filters: [...this.filters],
        rowSort: this.rowSort,
        columnSort: this.columnSort,
        valueFilters: [...this.valueFilters],
        conditionalRules: [...this.conditionalRules],
        sessionId: this.sessionId,
        totalRowCount: this.totalRowCount
      };
    }

    buildRequest() {
      return PivotForge.PivotRequestBuilder.buildRequest(this.options.fields, {
        filters: this.filters,
        rowSort: this.rowSort,
        columnSort: this.columnSort,
        hideEmptySummaryCells: this.options.hideEmptySummaryCells,
        topN: this.options.topN,
        valueFilters: this.activeValueFilters()
      });
    }

    // The value filters the current layout can honour: one on a field that left
    // the rows, or comparing a value no longer on the grid, waits -- kept, so it
    // comes back with the field -- rather than failing the request.
    activeValueFilters() {
      const rows = new Set(this.fields.filter(field => field.visible && field.area === "row").map(field => field.key));
      const values = new Set(this.valueDefinitions().map(value => value.key));

      return this.valueFilters.filter(filter =>
        rows.has(filter.field) && (!filter.valueKey || values.has(filter.valueKey)));
    }

    // Sets or, with null, removes the value filter on one row field.
    async setValueFilter(field, filter) {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      const others = this.valueFilters.filter(entry => entry.field !== field);
      this.valueFilters = filter
        ? [...others, ...PivotForge.PivotRequestBuilder.normalizeValueFilters([{ ...filter, field }])]
        : others;

      this.saveState();
      this.designer?.render();
      await this.refresh();
    }

    // A level renamed under the value filters -- a range width changed in the
    // designer renames its level -- takes its value filter with it: the
    // condition is on the groups' totals, which still mean the same thing.
    renameField(from, to) {
      if (from === to) {
        return;
      }

      this.valueFilters = this.valueFilters.map(filter => (filter.field === from ? { ...filter, field: to } : filter));
    }

    async clearValueFilters() {
      this.valueFilters = [];
      this.saveState();
      this.designer?.render();
      await this.refresh();
    }

    async post(route, body, signal) {
      const fetchImpl = this.options.fetchImpl ?? root.fetch?.bind(root);
      const response = await fetchImpl(`${this.endpointPrefix}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal
      });

      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload?.message ?? `Request failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }

      return payload;
    }

    async refresh() {
      this.assertNotDisposed();

      this.controller?.abort();
      const controller = new AbortController();
      this.controller = controller;
      const token = ++this.requestToken;

      this.loading = true;
      this.error = null;
      this.request = this.buildRequest();
      this.emit("dataLoading", { request: this.request });
      this.scheduleLoadPanel();

      try {
        const result = this.options.largeData
          ? await this.startLargeSession(controller.signal)
          : await this.post("/pivot", this.request, controller.signal);
        if (token !== this.requestToken || this.disposed) {
          return;
        }

        this.loading = false;
        this.hideLoadPanel();
        this.result = result;
        this.render(result);
        this.emit("dataLoaded", { result });
      } catch (error) {
        if (error?.name === "AbortError" || token !== this.requestToken || this.disposed) {
          return;
        }

        this.loading = false;
        this.hideLoadPanel();
        this.error = error;
        this.showError(error);
        this.emit("error", error);
      }
    }

    render(result) {
      if (this.options.renderImpl) {
        this.options.renderImpl(result);
        this.renderChart(result);
        return;
      }

      // The renderer outlives every filter change, so which fields are
      // restricted is passed per draw rather than at construction -- otherwise
      // the funnel would keep marking whatever was filtered when it was built.
      // Per-render options rather than a write into renderer.options, because a
      // renderer supplied from outside need not have that member at all.
      this.renderer.render(result, {
        filteredFields: this.filteredFields(),
        conditionalRules: this.conditionalRules
      });

      this.renderChart(result);

      // A redraw while a request is still out (a conditional rule added
      // mid-load) replaces the container's children, the panel among them.
      if (this.loadPanelShown) {
        this.showLoadPanel();
      }
    }

    // The chart's options, checked here so a misspelt type fails at creation
    // like every other declaration does.
    resolveChartOptions() {
      if (this.options.chart === null || this.options.chart === undefined || this.options.chart === false) {
        return null;
      }

      if (!PivotForge.PivotChart) {
        throw new Error("chart requires pivot-chart.js to be loaded.");
      }

      return PivotForge.PivotChart.normalize(this.options.chart);
    }

    // Beside the container rather than in it, as the toolbar is: the renderer
    // replaces the container's children on every draw.
    createChart() {
      const document = root.document;
      if (!this.chartOptions || !document) {
        return null;
      }

      const host = document.createElement("div");
      const top = this.chartOptions.position === "top";
      if (top ? typeof this.container.before !== "function" : typeof this.container.after !== "function") {
        return null;
      }

      if (top) {
        this.container.before(host);
      } else {
        this.container.after(host);
      }
      this.chartNode = host;
      host.hidden = !this.chartVisible;
      // A chart's axes do not mirror: categories still run left to right and
      // numbers still rise upwards, whichever way the page reads.
      host.dir = "ltr";

      return new PivotForge.PivotChart(host, {
        ...this.chartState,
        height: this.chartOptions.height,
        texts: this.locale.chart,
        culture: this.options.rendererOptions?.culture ?? this.locale.table?.culture ?? null,
        // The grid's own text for a value, so a tooltip and a cell never
        // disagree about what a number says.
        formatValue: (value, definition) => this.renderer
          ? this.renderer.formatValue(value, this.renderer.lastSettings ?? this.renderer.options, definition)
          : String(value),
        onChange: state => {
          this.chartState = state;
          this.saveState();
        }
      });
    }

    renderChart(result) {
      // A hidden chart is not drawn: it has no width to be drawn at, and the
      // reader is not looking. Showing it draws the latest result.
      if (!this.chart || !this.chartVisible) {
        return;
      }

      const columns = this.fields.filter(field => field.visible && field.area === "column");
      this.chart.render(result, {
        values: this.valueDefinitions(),
        scope: columns.map(field => field.key).join("|")
      });
      this.chartState = { ...this.chart.state };
    }

    // Shows or hides the chart, as the toolbar's chart button does, and keeps
    // the choice with the view. With no argument it toggles.
    showChart(visible = !this.chartVisible, { save = true } = {}) {
      this.assertNotDisposed();
      if (!this.chart) {
        throw new Error("Cannot show the chart because the grid has no chart.");
      }

      this.chartVisible = Boolean(visible);
      if (this.chartNode) {
        this.chartNode.hidden = !this.chartVisible;
      }
      this.syncChartButton();
      if (this.chartVisible && this.result) {
        this.renderChart(this.result);
      }
      if (save) {
        this.saveState();
      }
    }

    syncChartButton() {
      const button = this.toolbarNode?.children
        ? Array.from(this.toolbarNode.children).find(child => child.dataset?.toolbarItem === "chart")
        : null;
      button?.setAttribute("aria-pressed", String(this.chartVisible));
    }

    // Switches the chart's type or value from code, as the reader's own
    // buttons do.
    setChart(state = {}) {
      this.assertNotDisposed();
      if (!this.chart) {
        throw new Error("Cannot set the chart because the grid has no chart.");
      }

      const type = state.type === undefined ? undefined : PivotForge.PivotChart.normalize(state.type)?.type;
      if (state.type !== undefined && !type) {
        throw new Error("setChart needs a chart type; remove the chart option to have none.");
      }

      this.chartState = {
        type: type ?? this.chartState.type,
        valueKey: state.valueKey ?? this.chartState.valueKey
      };
      this.chart.setState(this.chartState);
      this.chartState = { ...this.chart.state };
      this.saveState();
    }

    // Waits before showing, and a newer refresh restarts the wait without
    // hiding a panel already on screen, so a run of quick re-sorts reads as one
    // load rather than a flicker.
    scheduleLoadPanel() {
      if (this.options.loadPanel === false || !root.document) {
        return;
      }

      root.clearTimeout(this.loadPanelTimer);
      const delay = Math.max(0, Number(this.options.loadPanelDelay) || 0);
      this.loadPanelTimer = root.setTimeout(() => {
        this.loadPanelTimer = null;
        this.showLoadPanel();
      }, delay);
    }

    // Sits inside the grid's own scroll box, as its first child, so it stays in
    // view however far the table is scrolled; the stylesheet makes it sticky.
    showLoadPanel() {
      const document = root.document;

      if (!this.loadPanelNode) {
        const node = document.createElement("div");
        node.className = "pivot-load-panel";
        node.setAttribute("role", "status");
        const pane = document.createElement("div");
        pane.className = "pivot-load-panel__pane";
        const spinner = document.createElement("span");
        spinner.className = "pivot-load-panel__spinner";
        spinner.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "pivot-load-panel__text";
        text.textContent = this.loadPanelText();
        pane.append(spinner, text);
        node.appendChild(pane);
        this.loadPanelNode = node;
      }

      this.loadPanelShown = true;
      this.container.classList.add("pivot-is-loading");
      this.container.setAttribute("aria-busy", "true");

      if (this.loadPanelNode.parentNode !== this.container) {
        this.container.prepend(this.loadPanelNode);
      }
    }

    hideLoadPanel() {
      root.clearTimeout?.(this.loadPanelTimer);
      this.loadPanelTimer = null;

      if (!this.loadPanelShown) {
        return;
      }

      this.loadPanelShown = false;
      this.loadPanelNode?.remove();
      this.container.classList.remove("pivot-is-loading");
      this.container.removeAttribute("aria-busy");
    }

    // The items the toolbar shows, in order. Excel needs its endpoint and both
    // expand buttons need the renderer, so an item the grid cannot honour is
    // left out rather than drawn dead -- the same rule the cell menu follows.
    toolbarItems() {
      const declared = this.options.toolbar === true
        ? Object.keys(TOOLBAR_ITEMS)
        : Array.isArray(this.options.toolbar) ? this.options.toolbar : [];

      return [...new Set(declared)].filter(item => {
        if (!TOOLBAR_ITEMS[item]) {
          throw new Error(
            `Unknown toolbar item "${item}". Expected one of: ${Object.keys(TOOLBAR_ITEMS).join(", ")}.`);
        }

        if (item === "chart") {
          return Boolean(this.chartOptions);
        }

        return item === "excel" ? this.options.allowExcelExport === true : Boolean(this.renderer);
      });
    }

    // Outside the container rather than in it: the renderer replaces the
    // container's children on every draw, and the strip has to stay put while
    // the grid scrolls. PivotForge.print hides it with the rest of the page.
    createToolbar() {
      const document = root.document;
      const items = this.toolbarItems();

      if (items.length === 0 || !document || typeof this.container.before !== "function") {
        return null;
      }

      const toolbar = document.createElement("div");
      toolbar.className = "pivot-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", this.tableText("toolbar", "Pivot table tools"));

      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pivot-toolbar__button";
        button.dataset.toolbarItem = item;
        button.textContent = this.tableText(TOOLBAR_ITEMS[item].text, TOOLBAR_ITEMS[item].label);
        button.addEventListener("click", () => this.runToolbarItem(item, button));
        // A toggle: pressed while the chart is on screen.
        if (item === "chart") {
          button.setAttribute("aria-pressed", String(this.chartVisible));
        }
        toolbar.appendChild(button);
      }

      this.container.before(toolbar);
      return toolbar;
    }

    // A failure goes out as the widget's "error" event, as a failed load does,
    // so a page that already shows those shows these too.
    async runToolbarItem(item, button) {
      // What the grid is called on screen is what the file and the page are
      // titled, unless the page named nothing.
      const title = this.options.rendererOptions?.ariaLabel ?? undefined;

      try {
        switch (item) {
          case "excel":
            button.disabled = true;
            try {
              PivotForge.download(await this.exportToExcel(title ? { title, sheetName: title } : {}));
            } finally {
              button.disabled = false;
            }
            break;
          case "csv":
            PivotForge.download(this.exportToCsv());
            break;
          case "print":
            this.print(title ? { title } : {});
            break;
          case "expandAll":
            // Both axes: the button says "all", and the column groups fold too.
            this.renderer.expandAll({ axis: "all" });
            break;
          case "collapseAll":
            this.renderer.collapseAll({ axis: "all" });
            break;
          case "saveReport":
            PivotForge.download(this.exportReport());
            break;
          case "openReport":
            await this.loadReport(await this.pickReportFile());
            break;
          case "fullscreen":
            this.toggleFullscreen();
            break;
          case "chart":
            this.showChart();
            break;
        }
      } catch (error) {
        this.emit("error", error);
      }
    }

    // The browser's own file dialog, asked for one JSON file. Resolves with the
    // file, or not at all when the reader cancels -- there is nothing to do.
    // The input sits hidden in the page while the dialog is open, where every
    // browser honours a click on it, and leaves with the dialog.
    pickReportFile() {
      return new Promise(resolve => {
        const document = root.document;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.hidden = true;
        const done = () => input.remove?.();
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          done();
          if (file) {
            resolve(file);
          }
        });
        input.addEventListener("cancel", done);
        document.body?.appendChild(input);
        input.click();
      });
    }

    // Full screen in the page rather than through the Fullscreen API: the grid
    // and its toolbar take the whole window, which keeps the toolbar -- and its
    // way back -- on screen, works inside an iframe and needs no permission.
    // Escape leaves it too.
    toggleFullscreen(on = !this.fullscreen) {
      const document = root.document;
      this.fullscreen = on;
      this.container.classList.toggle("pivot-is-fullscreen", on);
      this.toolbarNode?.classList?.toggle("pivot-is-fullscreen", on);
      document?.documentElement?.classList?.toggle("pivot-has-fullscreen", on);

      const button = this.toolbarNode?.children
        ? Array.from(this.toolbarNode.children).find(child => child.dataset?.toolbarItem === "fullscreen")
        : null;
      if (button) {
        button.textContent = on
          ? this.tableText("toolbarExitFullscreen", "Exit full screen")
          : this.tableText(TOOLBAR_ITEMS.fullscreen.text, TOOLBAR_ITEMS.fullscreen.label);
        button.setAttribute("aria-pressed", String(on));
      }

      if (on) {
        // The grid sits below the toolbar, however tall the toolbar wraps.
        const height = this.toolbarNode?.offsetHeight ?? 0;
        this.container.style?.setProperty?.("--pivot-toolbar-height", `${height}px`);
        this.fullscreenKey = event => {
          if (event.key === "Escape") {
            this.toggleFullscreen(false);
          }
        };
        document?.addEventListener?.("keydown", this.fullscreenKey);
      } else if (this.fullscreenKey) {
        document?.removeEventListener?.("keydown", this.fullscreenKey);
        this.fullscreenKey = null;
      }
    }

    // A renderer string in spirit: the page's rendererOptions.texts first, then
    // the locale's table texts, then English.
    tableText(key, fallback) {
      return this.options.rendererOptions?.texts?.[key] ??
        this.locale.table?.texts?.[key] ??
        fallback;
    }

    loadPanelText() {
      return this.tableText("loading", "Loading...");
    }

    showError(error) {
      // Keep any previously rendered table visible; surface the message beside it.
      const document = root.document;
      if (!document) {
        return;
      }

      this.errorNode?.remove();
      const node = document.createElement("div");
      node.className = "pivot-error";
      node.setAttribute("role", "alert");
      node.textContent = error.message;
      this.errorNode = node;
      this.container.appendChild(node);
    }

    async update({ fields, filters, rowSort, columnSort, valuesPosition } = {}) {
      // One call, one refresh: a designer changes several pieces per interaction
      // and must not produce a request per piece.
      if (fields !== undefined) {
        PivotForge.PivotRequestBuilder.buildRequest(fields);
        this.options.fields = fields;
        this.fields = PivotForge.PivotRequestBuilder.normalizeFields(fields);
        if (this.renderer) {
          this.renderer = this.createRenderer();
        }
      }

      if (filters !== undefined) {
        // Copied member by member rather than spread, so an entry cannot carry
        // anything the request builder has not agreed to -- but the operator has
        // to be among them, or a condition would arrive as a value selection.
        this.filters = filters.map(filter => ({
          field: filter.field,
          values: [...filter.values],
          mode: filter.mode,
          ...(filter.operator ? { operator: filter.operator } : {})
        }));
      }

      if (rowSort !== undefined) {
        this.rowSort = rowSort;
        this.syncRendererSortState();
      }

      if (columnSort !== undefined) {
        this.columnSort = columnSort;
        this.syncRendererSortState();
      }

      if (valuesPosition !== undefined && valuesPosition !== this.valuesPosition) {
        this.valuesPosition = valuesPosition;
        if (this.renderer?.options) {
          this.renderer.options.valuesPosition = valuesPosition;
        }
      }

      this.saveState();
      await this.refresh();
    }

    async updateFields(fields) {
      PivotForge.PivotRequestBuilder.buildRequest(fields);
      this.options.fields = fields;
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(fields);
      if (this.renderer) {
        this.renderer = this.createRenderer();
      }
      await this.refresh();
    }

    async startLargeSession(signal) {
      const response = await this.post("/large/start", {
        ...this.request,
        pageSize: this.options.pageSize,
        sourceRowCount: this.options.sourceRowCount
      }, signal);

      this.sessionId = response.sessionId;
      this.totalRowCount = response.page?.totalRowCount ?? 0;
      this.currentPage = response.page;
      return response.page?.result ?? null;
    }

    async loadPage(offset) {
      this.assertNotDisposed();

      if (!this.options.largeData) {
        throw new Error("Cannot load a page because largeData is disabled.");
      }

      if (!this.sessionId) {
        throw new Error("Cannot load a page because there is no active large-data session.");
      }

      const body = { sessionId: this.sessionId, offset, pageSize: this.options.pageSize };

      try {
        return await this.postPage(body);
      } catch (error) {
        // An expired session is recoverable: start a new one and retry once.
        if (error.status !== 410) {
          throw error;
        }

        const staleSessionId = this.sessionId;
        await this.refresh();
        // refresh() swallows its own failures and turns them into an "error" event
        // instead of throwing, so a failed restart must be detected explicitly:
        // the session id will still be the stale one that just triggered the 410.
        if (this.sessionId === staleSessionId) {
          throw this.error ?? error;
        }

        return await this.postPage({ ...body, sessionId: this.sessionId });
      }
    }

    async postPage(body) {
      const page = await this.post("/large/page", body);
      this.currentPage = page;
      this.totalRowCount = page.totalRowCount ?? this.totalRowCount;
      if (page.result) {
        this.result = page.result;
        this.render(page.result);
      }
      return page;
    }

    async drillDown({ rowPath = [], columnPath = [], valueKey = null } = {}) {
      this.assertNotDisposed();

      if (!this.options.allowDrillDown) {
        throw new Error("Cannot drill down because allowDrillDown is disabled.");
      }

      return await this.post("/drill-down", {
        ...this.buildRequest(),
        rowPath,
        columnPath,
        valueKey,
        sourceRowCount: this.options.sourceRowCount
      });
    }

    // The distinct values a filter on this field can accept. Never narrowed by
    // the field's own filter: a picker that hid the values the user just
    // excluded could never bring them back. With showRelevantValues the other
    // fields' filters narrow it, which leaves that promise intact.
    async fieldValues(field) {
      this.assertNotDisposed();

      if (!this.options.allowFiltering) {
        throw new Error("Cannot list field values because allowFiltering is disabled.");
      }

      // The picker asks by level; the server lists values of a column. A grouped
      // level has to say which interval, or it would get raw dates back and the
      // filter it applied would match nothing.
      const level = this.fields.find(entry => entry.key === field) ?? null;

      return await this.post("/field-values", {
        field: level?.dataField ?? field,
        ...(level?.groupInterval ? { interval: level.groupInterval } : {}),
        ...(level?.groupSize ? { binSize: level.groupSize } : {}),
        ...this.relevantValueFilters(field),
        ...this.fieldValueDataTypes(),
        sourceRowCount: this.options.sourceRowCount
      });
    }

    // The list has to hold what the headers show, so it is read with the same
    // conversions the pivot request asks for.
    fieldValueDataTypes() {
      const types = PivotForge.PivotRequestBuilder.dataTypes(this.fields);
      const selectors = PivotForge.PivotRequestBuilder.selectors(this.fields);
      return {
        ...(Object.keys(types).length > 0 ? { dataTypes: types } : {}),
        ...(Object.keys(selectors).length > 0 ? { selectors } : {})
      };
    }

    // Translated by the request builder, so a grouped level's filter arrives as
    // its source field plus interval, exactly as the pivot request sends it.
    relevantValueFilters(field) {
      if (!this.options.showRelevantValues) {
        return {};
      }

      const others = this.filters.filter(filter => filter.field !== field);
      if (others.length === 0) {
        return {};
      }

      return {
        filters: PivotForge.PivotRequestBuilder.buildRequest(this.options.fields, { filters: others }).filters
      };
    }

    async exportToExcel(options = {}) {
      this.assertNotDisposed();

      if (!this.options.allowExcelExport) {
        throw new Error("Cannot export because allowExcelExport is disabled.");
      }

      // The endpoint renders a table document, not a pivot request, so the model
      // has to come from the renderer that produced the visible table.
      if (!this.renderer) {
        throw new Error(
          "Cannot export because this widget renders through renderImpl and has no renderer to export from."
        );
      }

      const document = this.renderer.getExcelExportModel(options);
      if (!document) {
        throw new Error("Cannot export because no pivot table has been rendered yet.");
      }

      const exporting = this.emitExporting("excel", document, options.fileName ?? null);
      if (exporting.cancel) {
        return null;
      }

      const fetchImpl = this.options.fetchImpl ?? root.fetch?.bind(root);
      const response = await fetchImpl(`${this.endpointPrefix}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializeExportDocument(exporting.document)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const error = new Error(payload?.message ?? `Excel export failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }

      const blob = await response.blob();
      // A name the handler chose wins over the server's suggestion: it is the
      // one place a page can name the file without wrapping the download.
      const fileName = exporting.fileName ??
        parseContentDispositionFileName(response.headers?.get?.("Content-Disposition"));
      return { blob, fileName };
    }

    // Synchronous on purpose, unlike exportToExcel: a CSV is produced entirely
    // from the table already on screen, so returning a promise would imply a
    // request that never happens. For the same reason there is no
    // allowCsvExport -- there is no endpoint to gate, and nothing in the file
    // that the reader is not already looking at.
    exportToCsv(options = {}) {
      this.assertNotDisposed();

      if (!this.renderer) {
        throw new Error(
          "Cannot export because this widget renders through renderImpl and has no renderer to export from."
        );
      }

      const model = this.renderer.getExcelExportModel(options);
      if (!model) {
        throw new Error("Cannot export because no pivot table has been rendered yet.");
      }

      const exporting = this.emitExporting(
        "csv",
        model,
        options.fileName ?? `pivotforge-${new Date().toISOString().slice(0, 10)}.csv`);
      if (exporting.cancel) {
        return null;
      }

      // A byte-order mark, because a spreadsheet opening a CSV without one
      // guesses the encoding and gets every non-ASCII caption wrong.
      const text = `\uFEFF${PivotForge.toCsv(exporting.document, options)}`;
      return {
        blob: new root.Blob([text], { type: "text/csv;charset=utf-8" }),
        fileName: exporting.fileName
      };
    }

    // DevExtreme's onExporting and customizeCell in one event: the handler gets
    // the document about to be written, may change any cell in place (each
    // carries a `source` saying what it shows), rename the file, or set
    // `cancel`. Synchronous, so a handler that wants to stop the export has to
    // decide before the file is made -- which is the only moment it can.
    emitExporting(format, document, fileName) {
      const payload = {
        format,
        document,
        fileName,
        // As DevExtreme's onExporting has it, so a handler can lay out what it
        // adds the way the grid reads.
        rtlEnabled: Boolean(PivotForge.isRtl?.(this.container)),
        cancel: false
      };
      this.emit("exporting", payload);
      return payload;
    }

    // Prints this grid and nothing else on the page: the whole table, headers
    // repeated on each sheet, heatmap and conditional colours kept. The
    // browser's own "Save as PDF" makes the same into a PDF. In large-data
    // mode it is the page of rows loaded, which is what the grid holds.
    print(options = {}) {
      this.assertNotDisposed();

      if (!this.result) {
        throw new Error("Cannot print because no pivot table has been rendered yet.");
      }

      // Virtual columns draw a window; a print is of the whole table.
      const suspended = this.renderer?.suspendColumnWindow?.() === true;
      PivotForge.print(this.container, suspended
        ? { ...options, onRestore: () => this.renderer?.resumeColumnWindow?.() }
        : options);
    }

    cancel() {
      // Invalidate the token as well, so a response already in flight cannot render.
      this.requestToken++;
      this.controller?.abort();
      this.controller = null;
      this.loading = false;
      this.hideLoadPanel();
    }

    // A header click (or the context menu's "sort by value") carries only what
    // to sort by, never a direction: the renderer does not know the current
    // sort's direction well enough to flip it. Left without one, every click
    // re-sent the same ascending sort, so a second click on the same header
    // never reversed it. The direction is decided here instead: the header
    // that is already sorted flips, any other starts where the demo does --
    // labels A to Z, values largest first.
    nextHeaderSort(request) {
      if (!request || request.direction) {
        return request;
      }

      const current = this.rowSort;
      const sameTarget = Boolean(current) && current.mode === request.mode && (
        request.mode === "RowLabel"
          ? current.field === request.field
          : current.valueKey === request.valueKey &&
            sameSortColumnPath(current.columnPath ?? null, request.columnPath ?? null));
      // With no row sort in place, a row field's arrow shows the field's own
      // order, so the first click turns that order around rather than
      // repeating it.
      const shown = sameTarget
        ? current.direction
        : !current && request.mode === "RowLabel"
          ? this.rowFieldSortDirection(request.field)
          : null;
      const initial = request.mode === "RowTotalValue" ? "Descending" : "Ascending";
      const direction = shown
        ? (shown === "Descending" ? "Ascending" : "Descending")
        : initial;

      return { ...request, direction };
    }

    rowFieldSortDirection(key) {
      const field = this.fields.find(entry => entry.visible && entry.area === "row" && entry.key === key);
      return field ? fieldSortDirection(field) : null;
    }

    // The column half of nextHeaderSort: the same row flips, any other starts
    // largest first.
    nextColumnSort(request) {
      const sort = {
        valueKey: request?.valueKey ?? null,
        rowPath: Array.isArray(request?.rowPath) && request.rowPath.length > 0 ? [...request.rowPath] : null
      };

      if (request?.direction) {
        return { ...sort, direction: request.direction };
      }

      const current = this.columnSort;
      const sameTarget = Boolean(current) && current.valueKey === sort.valueKey &&
        sameSortColumnPath(current.rowPath ?? null, sort.rowPath);
      const direction = sameTarget && current.direction === "Descending" ? "Ascending" : "Descending";

      return { ...sort, direction };
    }

    // Orders the columns by one row's value -- null for the columns' own
    // totals -- or, given null, hands them back to their fields' own order.
    async sortColumnsBy(sort) {
      if (!this.options.allowSorting) {
        throw new Error("Cannot sort because allowSorting is disabled.");
      }

      this.columnSort = sort ?? null;
      this.syncRendererSortState();
      this.saveState();
      await this.refresh();
    }

    async sortBy(sort) {
      if (!this.options.allowSorting) {
        throw new Error("Cannot sort because allowSorting is disabled.");
      }

      this.rowSort = sort;
      this.syncRendererSortState();
      this.saveState();
      await this.refresh();
    }

    // Orders a column field's own values, flipping on every click: A to Z
    // first, as a label sort starts. The order lives on the field, so it goes
    // through the layout state when a designer owns the fields, and straight
    // into the declaration otherwise.
    async sortColumnField(field, direction = null) {
      if (!this.options.allowSorting) {
        throw new Error("Cannot sort because allowSorting is disabled.");
      }

      const declared = this.fields.find(entry => entry.key === field);
      const current = declared ? fieldSortDirection(declared) : null;
      const next = direction ?? (current === "Ascending" ? "Descending" : "Ascending");
      // A label sort picked on a column field takes the columns back from a
      // value sort; left in place, the value sort would go on winning.
      if (this.columnSort) {
        this.columnSort = null;
        this.syncRendererSortState();
      }

      if (this.layoutState) {
        this.layoutState.setSortOrder(field, next);
        await this.update({ fields: this.layoutState.toFields() });
        return;
      }

      // Matched on the level key, which a declaration only has once normalized:
      // one date column grouped two ways is two fields with one dataField.
      const { normalizeFields } = PivotForge.PivotRequestBuilder;
      const fields = this.options.fields.map(entry =>
        normalizeFields([entry])[0].key === field ? { ...entry, sortOrder: next } : entry);
      await this.update({ fields });
    }

    async setFilter(field, values, mode = "Include", operator = "Equals") {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      // With a designer attached the layout state owns the filters: writing
      // here directly would be overwritten by the next update() the designer
      // sends, and its chip would go on showing the previous selection.
      if (this.layoutState) {
        // The operator first: it decides whether the values are a selection or
        // a condition's arguments.
        this.layoutState.setFilterOperator(field, operator);
        this.layoutState.setFilterMode(field, mode);
        this.layoutState.setFilterValues(field, values ?? []);
        this.designer.render();
        await this.update(this.layoutState.toRequestState());
        return;
      }

      this.filters = this.filters.filter(filter => filter.field !== field);
      // A condition with fewer arguments than its operator reads restricts
      // nothing, so it is stored as no filter at all rather than as a half one.
      const candidate = { field, values: values ?? [], mode, operator };
      if (PivotForge.PivotRequestBuilder.restricts(candidate)) {
        this.filters.push(PivotForge.PivotRequestBuilder.normalizeFilter(candidate, 0));
      }

      this.saveState();
      await this.refresh();
    }

    async clearFilters() {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      this.filters = [];
      this.saveState();
      await this.refresh();
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.requestToken++;
      this.controller?.abort();
      this.controller = null;
      this.hideLoadPanel();
      this.loadPanelNode = null;
      this.handlers.clear();
      this.errorNode = null;
      this.designer?.dispose();
      this.designer = null;
      this.headerFilterPicker?.dispose();
      this.conditionalPanel?.dispose();
      this.conditionalPanel = null;
      this.headerFilterPicker = null;
      this.drillDownModal?.dispose();
      this.drillDownModal = null;
      if (this.fullscreen) {
        this.toggleFullscreen(false);
      }
      this.toolbarNode?.remove();
      this.toolbarNode = null;
      this.chart?.dispose();
      this.chart = null;
      this.chartNode?.remove();
      this.chartNode = null;
      this.container.replaceChildren();
      this.container.classList.remove("pivot-table");
    }
  }

  PivotForge.PivotWidget = PivotWidget;

  PivotForge.create = function create(target, options = {}) {
    const widget = new PivotWidget(resolveTarget(target), options);
    if (widget.options.autoLoad) {
      widget.refresh();
    }

    // Announce the instance so page code that cannot see the create() call
    // (server-rendered helpers, for example) can still reach the widget.
    if (typeof widget.container.dispatchEvent === "function" && root.CustomEvent) {
      widget.container.dispatchEvent(
        new root.CustomEvent("pivotforge:ready", { detail: { widget } }));
    }

    return widget;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { create: PivotForge.create, PivotWidget };
  }
})(typeof window !== "undefined" ? window : globalThis);
