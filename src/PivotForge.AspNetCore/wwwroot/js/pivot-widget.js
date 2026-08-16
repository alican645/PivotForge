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
    largeData: false,
    pageSize: 40,
    sourceRowCount: 100000,
    rendererOptions: null,
    events: null,
    fetchImpl: null,
    renderImpl: null,
    fieldDesigner: null
  };

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
      this.sessionId = null;
      this.totalRowCount = 0;

      // Validate eagerly so configuration mistakes surface at the call site.
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields ?? []);
      PivotForge.PivotRequestBuilder.buildRequest(this.options.fields ?? []);

      this.subscribeDeclaredEvents();

      this.renderer = this.options.renderImpl ? null : this.createRenderer();

      this.layoutState = null;
      this.designer = null;
      this.drillDownModal = null;

      if (this.options.fieldDesigner) {
        if (!PivotForge.PivotLayoutState || !PivotForge.PivotFieldDesigner) {
          throw new Error(
            "fieldDesigner requires pivot-layout-state.js and pivot-field-designer.js to be loaded."
          );
        }

        this.layoutState = new PivotForge.PivotLayoutState(this.options.fields);
        this.designer = new PivotForge.PivotFieldDesigner(this.options.fieldDesigner, {
          state: this.layoutState,
          widget: this
        });
      }
    }

    createRenderer() {
      const Renderer = PivotForge.PivotTableRenderer;
      if (!Renderer) {
        throw new Error(
          "PivotForge.PivotTableRenderer is not loaded. Reference pivot-table.js before pivot-widget.js."
        );
      }

      const rowFields = this.fields.filter(field => field.visible && field.area === "row");
      const consumer = this.options.rendererOptions ?? {};

      // Emits the widget event, then hands the same payload to whatever the
      // consumer supplied through rendererOptions. Declared AFTER the spread so
      // the event always fires, while the consumer's own callback still runs --
      // otherwise supplying a callback would silently switch the event off.
      const bridge = (eventName, payload) => {
        this.emit(eventName, payload);
        consumer[`on${eventName[0].toUpperCase()}${eventName.slice(1)}`]?.(payload);
      };

      return new Renderer(this.container, {
        rowFields: rowFields.map(field => field.dataField),
        rowFieldLabels: rowFields.map(field => field.caption),
        onSortRequested: this.options.allowSorting
          ? request => { this.sortBy(request); }
          : null,
        // Without this the renderer treats every result as unsorted and re-orders
        // rows itself, discarding the ordering the server was just asked for.
        // Declared before the spread so a consumer driving sorting through
        // rendererOptions keeps ownership until this widget actually sorts.
        sortState: this.rowSort,
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
        onSelectionChanged: selection => bridge("selectionChanged", selection),
        onCellFilterRequested: selection => bridge("cellFilterRequested", selection),
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
        rowSort: this.rowSort
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

      this.renderer.render(result);
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
        this.filters = filters.map(filter => ({ field: filter.field, values: [...filter.values] }));
      }

      if (rowSort !== undefined) {
        this.rowSort = rowSort;
        this.syncRendererSortState();
      }

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
      await this.refresh();
    }

    async setFilter(field, values) {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      this.filters = this.filters.filter(filter => filter.field !== field);
      if (Array.isArray(values) && values.length > 0) {
        this.filters.push({ field, values });
      }

      await this.refresh();
    }

    async clearFilters() {
      if (!this.options.allowFiltering) {
        throw new Error("Cannot filter because allowFiltering is disabled.");
      }

      this.filters = [];
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
