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
    largeData: false,
    pageSize: 40,
    sourceRowCount: 100000,
    // Dropped in the engine rather than hidden in the browser, so paging, Excel
    // export and drill-down all agree on which rows exist.
    hideEmptySummaryCells: false,
    topN: [],
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
    "viewStateChanged"
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
      this.rowSort = this.options.rowSort ?? null;
      // Seeded from the declared rules and owned from here on, so a rule added
      // at runtime and one written in Razor live in the same list.
      this.conditionalRules = [...(this.options.rendererOptions?.conditionalRules ?? [])];
      this.sessionId = null;
      this.totalRowCount = 0;

      // Validate eagerly so configuration mistakes surface at the call site.
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields ?? []);
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

      // Before the renderer, which is the first thing to put text on screen.
      this.locale = this.resolveLocale();

      this.subscribeDeclaredEvents();

      this.renderer = this.options.renderImpl ? null : this.createRenderer();

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
        this.designer = new PivotForge.PivotFieldDesigner(this.options.fieldDesigner, {
          state: this.layoutState,
          widget: this,
          labels: this.designerLabels()
        });
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
            { ...restored.layout, captions: restored.captions });
        } catch {
          this.filters = [...(this.options.filters ?? [])];
        }
      }

      return new PivotForge.PivotLayoutState(this.options.fields);
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

      if (payload?.version !== STATE_VERSION) {
        return null;
      }

      return {
        layout: payload.layout ?? null,
        captions: payload.captions ?? null,
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
        rowSort: payload.rowSort ?? null
      };
    }

    saveState() {
      const storage = this.stateStorage();
      if (!storage) {
        return false;
      }

      const layout = this.layoutState?.getState() ?? null;
      const payload = {
        version: STATE_VERSION,
        ...(layout
          ? {
            // available is derived from the catalog on every read, so storing
            // it would only let a stale copy contradict the catalog.
            layout: {
              rows: layout.rows,
              columns: layout.columns,
              values: layout.values,
              filters: layout.filters
            },
            captions: layout.captions
          }
          : {}),
        filters: layout
          ? layout.filters.filter(PivotForge.PivotRequestBuilder.restricts)
          : this.filters,
        rowSort: this.rowSort
      };

      try {
        storage.setItem(this.stateKey, JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
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

    filterPickerLabels() {
      return {
        ...this.locale.filterPicker,
        ...(this.options.designerLabels?.filterPicker ?? {})
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
        // The column axis needs its field names spelled out before it can carry a
        // funnel: its headers show values, never the field they belong to.
        columnFields: columnFields.map(field => field.key),
        columnFieldLabels: columnFields.map(field => field.caption),
        onSortRequested: this.options.allowSorting
          ? request => { this.sortBy(request); }
          : null,
        onFilterRequested: this.canHeaderFilter()
          ? field => { this.openHeaderFilter(field); }
          : null,
        filteredFields: this.filteredFields(),
        // Without this the renderer treats every result as unsorted and re-orders
        // rows itself, discarding the ordering the server was just asked for.
        // Declared before the spread so a consumer driving sorting through
        // rendererOptions keeps ownership until this widget actually sorts.
        sortState: this.rowSort,
        // The renderer outlives every rule change, so this is also passed per
        // draw in render(); declaring it here is what a first draw reads.
        conditionalRules: this.conditionalRules,
        // Left unset, the renderer auto-detects a single value key from the
        // payload, labels it with that raw key and applies no format — so
        // captions are lost and a second data field disappears.
        values: this.valueDefinitions(),
        ...consumer,
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
        widget: this,
        labels: this.locale.drillDown,
        // Spread first, so a page that pins the modal's culture on purpose wins
        // over the renderer's — but by default the two cannot drift apart.
        culture: this.options.rendererOptions?.culture ?? null,
        ...(this.options.drillDownModalOptions ?? {})
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
          format: field.format
        }));
    }

    // The renderer is built once and reused across refreshes, so a sort applied
    // after construction has to be pushed onto it.
    syncRendererSortState() {
      if (this.renderer) {
        this.renderer.options.sortState = this.rowSort;
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
      return this.filters.filter(PivotForge.PivotRequestBuilder.restricts)
        .map(filter => filter.field);
    }

    // The row header's funnel and the designer's filter chip open one picker
    // over one entry; only the way in differs. With a designer attached the
    // layout state owns the filters, so the picker is opened through it.
    openHeaderFilter(field) {
      if (this.designer) {
        return this.designer.openFilterPicker(field);
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
        onApply: (values, mode, operator) => this.setFilter(field, values, mode, operator)
      });
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
      if (!rule?.valueKey) {
        throw new Error("A conditional rule must name a valueKey.");
      }

      this.conditionalRules = [...this.conditionalRules, rule];
      this.rerender();
      return this;
    }

    // Named by measure rather than by rule id, because that is what the panel
    // can offer: it is opened on a cell, and a cell knows its measure.
    clearConditionalRules(valueKey = null) {
      this.conditionalRules = valueKey === null
        ? []
        : this.conditionalRules.filter(rule => rule.valueKey !== valueKey);
      this.rerender();
      return this;
    }

    setConditionalRules(rules) {
      this.conditionalRules = [...(rules ?? [])];
      this.rerender();
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
        sessionId: this.sessionId,
        totalRowCount: this.totalRowCount
      };
    }

    buildRequest() {
      return PivotForge.PivotRequestBuilder.buildRequest(this.options.fields, {
        filters: this.filters,
        rowSort: this.rowSort,
        hideEmptySummaryCells: this.options.hideEmptySummaryCells,
        topN: this.options.topN
      });
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

      try {
        const result = this.options.largeData
          ? await this.startLargeSession(controller.signal)
          : await this.post("/pivot", this.request, controller.signal);
        if (token !== this.requestToken || this.disposed) {
          return;
        }

        this.loading = false;
        this.result = result;
        this.render(result);
        this.emit("dataLoaded", { result });
      } catch (error) {
        if (error?.name === "AbortError" || token !== this.requestToken || this.disposed) {
          return;
        }

        this.loading = false;
        this.error = error;
        this.showError(error);
        this.emit("error", error);
      }
    }

    render(result) {
      if (this.options.renderImpl) {
        this.options.renderImpl(result);
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

    async update({ fields, filters, rowSort } = {}) {
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

    // The distinct values a filter on this field can accept. Deliberately not
    // narrowed by the filters already applied: a picker that hid the values the
    // user just excluded could never bring them back.
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
        sourceRowCount: this.options.sourceRowCount
      });
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

      const fetchImpl = this.options.fetchImpl ?? root.fetch?.bind(root);
      const response = await fetchImpl(`${this.endpointPrefix}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const error = new Error(payload?.message ?? `Excel export failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
      }

      const blob = await response.blob();
      const fileName = parseContentDispositionFileName(response.headers?.get?.("Content-Disposition"));
      return { blob, fileName };
    }

    cancel() {
      // Invalidate the token as well, so a response already in flight cannot render.
      this.requestToken++;
      this.controller?.abort();
      this.controller = null;
      this.loading = false;
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
