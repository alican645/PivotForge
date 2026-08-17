(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const DEFAULT_LABELS = {
    // {0} is replaced with the field caption.
    title: "{0} filtresi",
    close: "Kapat",
    apply: "Uygula",
    cancel: "İptal",
    search: "Değerlerde ara",
    selectAll: "Tümünü seç",
    clear: "Temizle",
    blank: "(Boş)",
    loading: "Değerler yükleniyor...",
    noValues: "Bu alan için değer bulunamadı",
    noMatches: "Aramayla eşleşen değer yok",
    failed: "Değerler alınamadı",
    // {0} selected, {1} total.
    summary: "{0} / {1} değer seçili",
    // {0} is replaced with the server's value limit.
    truncated: "İlk {0} değer gösteriliyor. Listede olmayan seçimler korunur."
  };

  function format(template, ...values) {
    return values.reduce(
      (text, value, index) => text.replaceAll(`{${index}}`, String(value)),
      String(template));
  }

  class PivotFilterPicker {
    constructor(options = {}) {
      if (!options.widget || typeof options.widget.fieldValues !== "function") {
        throw new Error("PivotFilterPicker requires a widget exposing fieldValues().");
      }

      this.widget = options.widget;
      this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
      this.host = options.host ?? root.document?.body ?? null;

      if (!this.host) {
        throw new Error("PivotFilterPicker requires a host element.");
      }

      // Every open() takes a ticket, so a response for a field the user has
      // already moved on from is dropped rather than rendered over the current
      // one — the same guard the drill-down modal uses.
      this.requestId = 0;
      this.field = null;
      this.onApply = null;
      this.values = [];
      this.selected = new Set();
      // Values the caller had selected that the server did not list, because
      // the response was truncated. Applying must not silently drop them.
      this.hiddenSelected = [];
      this.searchTerm = "";
      this.isOpen = false;
      this.disposed = false;
      this.elements = null;
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

      const overlay = create("div", "pivot-modal pivot-filter-picker");
      overlay.setAttribute("aria-hidden", "true");

      const dialog = create("div", "pivot-modal__dialog pivot-filter-picker__dialog");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const head = create("div", "pivot-panel-head");
      const heading = create("div", "pivot-filter-picker__heading");
      const title = create("h2");
      const summary = create("span");
      heading.appendChild(title);
      heading.appendChild(summary);

      const close = create("button", "pivot-button");
      close.dataset.action = "filter-close";
      close.setAttribute("type", "button");
      close.textContent = this.labels.close;
      close.addEventListener("click", () => this.close());
      head.appendChild(heading);
      head.appendChild(close);

      const body = create("div", "pivot-filter-picker__body");

      const toolbar = create("div", "pivot-filter-picker__toolbar");
      const search = create("input");
      search.className = "pivot-filter-picker__search";
      search.dataset.action = "filter-search";
      search.setAttribute("type", "search");
      search.setAttribute("placeholder", this.labels.search);
      search.setAttribute("autocomplete", "off");
      search.addEventListener("input", () => {
        this.searchTerm = search.value.trim().toLocaleLowerCase();
        this.renderList();
      });

      // Both act on what the search is showing, the way a spreadsheet filter
      // does: searching then selecting all is how a subset gets picked.
      const selectAll = create("button", "pivot-button");
      selectAll.dataset.action = "filter-select-all";
      selectAll.setAttribute("type", "button");
      selectAll.textContent = this.labels.selectAll;
      selectAll.addEventListener("click", () => this.setVisibleSelection(true));

      const clear = create("button", "pivot-button");
      clear.dataset.action = "filter-clear";
      clear.setAttribute("type", "button");
      clear.textContent = this.labels.clear;
      clear.addEventListener("click", () => this.setVisibleSelection(false));

      toolbar.appendChild(search);
      toolbar.appendChild(selectAll);
      toolbar.appendChild(clear);

      const notice = create("div", "pivot-filter-picker__notice");
      notice.hidden = true;
      const state = create("div", "pivot-filter-picker__state");
      const list = create("div", "pivot-filter-picker__list");
      list.hidden = true;

      const foot = create("div", "pivot-filter-picker__foot");
      const apply = create("button", "pivot-button primary");
      apply.dataset.action = "filter-apply";
      apply.setAttribute("type", "button");
      apply.textContent = this.labels.apply;
      apply.disabled = true;
      apply.addEventListener("click", () => this.apply());

      const cancel = create("button", "pivot-button");
      cancel.dataset.action = "filter-cancel";
      cancel.setAttribute("type", "button");
      cancel.textContent = this.labels.cancel;
      cancel.addEventListener("click", () => this.close());

      foot.appendChild(cancel);
      foot.appendChild(apply);

      body.appendChild(toolbar);
      body.appendChild(notice);
      body.appendChild(state);
      body.appendChild(list);

      dialog.appendChild(head);
      dialog.appendChild(body);
      dialog.appendChild(foot);
      overlay.appendChild(dialog);

      // Only the overlay itself counts as a backdrop click, so a click that
      // lands on a control inside the dialog does not close it.
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
      this.elements = { overlay, title, summary, search, notice, state, list, apply };
      return this.elements;
    }

    async open({ field, caption, selected = [], onApply } = {}) {
      if (this.disposed || !field) {
        return;
      }

      if (typeof onApply !== "function") {
        throw new Error("PivotFilterPicker.open requires an onApply callback.");
      }

      const elements = this.build();
      const requestId = ++this.requestId;

      this.field = field;
      this.onApply = onApply;
      this.values = [];
      this.hiddenSelected = [];
      this.searchTerm = "";
      this.isOpen = true;

      elements.search.value = "";
      elements.apply.disabled = true;
      elements.notice.hidden = true;
      elements.list.hidden = true;
      elements.list.replaceChildren();
      elements.overlay.classList.add("is-open");
      elements.overlay.setAttribute("aria-hidden", "false");
      elements.title.textContent = format(this.labels.title, caption ?? field);
      elements.summary.textContent = "";
      this.setState(this.labels.loading, false);

      try {
        const response = await this.widget.fieldValues(field);

        if (requestId !== this.requestId) {
          return;
        }

        this.values = response?.values ?? [];
        this.applySelection(selected, response);
        this.renderList();
      } catch (error) {
        // An abort means this picker was superseded, not that it failed.
        if (error?.name !== "AbortError" && requestId === this.requestId) {
          this.setState(error?.message || this.labels.failed, true);
        }
      }
    }

    // An empty incoming selection means "no restriction", which is every value
    // checked — not an empty list. Storing it the other way round would show a
    // freshly placed filter field as excluding everything.
    applySelection(selected, response) {
      const incoming = (selected ?? []).map(value => (value == null ? "" : String(value)));

      this.selected = incoming.length === 0
        ? new Set(this.values)
        : new Set(incoming.filter(value => this.values.includes(value)));

      this.hiddenSelected = incoming.length === 0
        ? []
        : incoming.filter(value => !this.values.includes(value));

      const elements = this.elements;
      if (response?.truncated) {
        elements.notice.textContent = format(this.labels.truncated, response.limit);
        elements.notice.hidden = false;
      }
    }

    visibleValues() {
      if (this.searchTerm === "") {
        return this.values;
      }

      return this.values.filter(value =>
        this.displayText(value).toLocaleLowerCase().includes(this.searchTerm));
    }

    displayText(value) {
      return value === "" || value === null ? this.labels.blank : String(value);
    }

    setVisibleSelection(checked) {
      this.visibleValues().forEach(value => {
        if (checked) {
          this.selected.add(value);
        } else {
          this.selected.delete(value);
        }
      });
      this.renderList();
    }

    renderList() {
      const document = root.document;
      const elements = this.elements;

      if (this.values.length === 0) {
        this.setState(this.labels.noValues, false);
        this.hideList();
        elements.apply.disabled = true;
        return;
      }

      const visible = this.visibleValues();
      elements.apply.disabled = false;
      elements.summary.textContent =
        format(this.labels.summary, this.selected.size, this.values.length);

      if (visible.length === 0) {
        this.setState(this.labels.noMatches, false);
        this.hideList();
        return;
      }

      this.setState("", false);
      elements.list.hidden = false;

      const rows = visible.map(value => {
        const row = document.createElement("label");
        row.className = "pivot-filter-picker__value";
        row.dataset.value = value;

        const box = document.createElement("input");
        box.setAttribute("type", "checkbox");
        box.dataset.action = "filter-value";
        box.checked = this.selected.has(value);
        box.addEventListener("change", () => {
          if (box.checked) {
            this.selected.add(value);
          } else {
            this.selected.delete(value);
          }
          elements.summary.textContent =
            format(this.labels.summary, this.selected.size, this.values.length);
        });

        const text = document.createElement("span");
        text.textContent = this.displayText(value);

        row.appendChild(box);
        row.appendChild(text);
        return row;
      });

      elements.list.replaceChildren(...rows);
    }

    // Hiding alone would leave the previous field's values in the DOM, where a
    // later search could reveal rows that no longer belong to anything.
    hideList() {
      this.elements.list.hidden = true;
      this.elements.list.replaceChildren();
    }

    setState(message, isError) {
      const state = this.elements.state;
      state.textContent = message;
      state.hidden = message === "";
      state.classList.toggle("is-error", Boolean(isError));
    }

    apply() {
      // Every value checked means no restriction at all, which is stored as an
      // empty list. Freezing the full set instead would silently exclude values
      // that appear in the source later.
      const everything =
        this.hiddenSelected.length === 0 && this.selected.size === this.values.length;
      const values = everything
        ? []
        : [...this.hiddenSelected, ...this.values.filter(value => this.selected.has(value))];

      const callback = this.onApply;
      this.close();
      callback(values);
    }

    close() {
      if (!this.elements) {
        return;
      }

      // Invalidate the ticket as well, so a response still in flight cannot
      // render into a picker the user has already dismissed.
      this.requestId++;
      this.isOpen = false;
      this.field = null;
      this.onApply = null;
      this.elements.overlay.classList.remove("is-open");
      this.elements.overlay.setAttribute("aria-hidden", "true");
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.isOpen = false;

      if (this.keydownHandler) {
        root.document?.removeEventListener("keydown", this.keydownHandler);
        this.keydownHandler = null;
      }

      this.elements?.overlay.remove();
      this.elements = null;
    }
  }

  PivotForge.PivotFilterPicker = PivotFilterPicker;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
