(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const DEFAULTS = {
    endpointPrefix: "/pivotforge",
    autoLoad: true,
    allowSorting: true,
    allowFiltering: true,
    allowDrillDown: true,
    allowExcelExport: false,
    largeData: false,
    pageSize: 40,
    sourceRowCount: 100000,
    rendererOptions: null,
    fetchImpl: null,
    renderImpl: null
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

  function normalizePrefix(prefix) {
    const trimmed = String(prefix ?? "").trim();
    const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
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

      // Validate eagerly so configuration mistakes surface at the call site.
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(this.options.fields ?? []);
      PivotForge.PivotRequestBuilder.buildRequest(this.options.fields ?? []);

      this.renderer = this.options.renderImpl ? null : this.createRenderer();
    }

    createRenderer() {
      const Renderer = PivotForge.PivotTableRenderer;
      if (!Renderer) {
        throw new Error(
          "PivotForge.PivotTableRenderer is not loaded. Reference pivot-table.js before pivot-widget.js."
        );
      }

      const rowFields = this.fields.filter(field => field.visible && field.area === "row");

      return new Renderer(this.container, {
        rowFields: rowFields.map(field => field.dataField),
        rowFieldLabels: rowFields.map(field => field.caption),
        ...(this.options.rendererOptions ?? {})
      });
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
    }

    getState() {
      return {
        fields: this.fields,
        request: this.request,
        result: this.result,
        error: this.error,
        loading: this.loading
      };
    }

    buildRequest() {
      return PivotForge.PivotRequestBuilder.buildRequest(this.options.fields, {
        filters: this.options.filters,
        rowSort: this.rowSort ?? null
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
        throw new Error(payload?.message ?? `Request failed with status ${response.status}.`);
      }

      return payload;
    }

    async refresh() {
      if (this.disposed) {
        throw new Error("This PivotForge widget has been disposed.");
      }

      this.controller?.abort();
      const controller = new AbortController();
      this.controller = controller;
      const token = ++this.requestToken;

      this.loading = true;
      this.error = null;
      this.request = this.buildRequest();
      this.emit("dataLoading", { request: this.request });

      try {
        const result = await this.post("/pivot", this.request, controller.signal);
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

    async updateFields(fields) {
      PivotForge.PivotRequestBuilder.buildRequest(fields);
      this.options.fields = fields;
      this.fields = PivotForge.PivotRequestBuilder.normalizeFields(fields);
      if (this.renderer) {
        this.renderer = this.createRenderer();
      }
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
    return widget;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { create: PivotForge.create, PivotWidget };
  }
})(typeof window !== "undefined" ? window : globalThis);
