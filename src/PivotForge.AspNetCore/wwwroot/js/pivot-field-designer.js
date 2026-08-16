(function (root) {
  const PivotForge = root.PivotForge ??= {};

  const AGGREGATIONS = ["sum", "count", "average", "min", "max"];

  const DEFAULT_LABELS = {
    available: "Alanlar",
    row: "Satırlar",
    column: "Sütunlar",
    data: "Değerler",
    filter: "Filtreler",
    remove: "Kaldır",
    search: "Alan ara...",
    format: "Biçim",
    formatGrouping: "Binlik ayracı",
    formatTypes: {
      number: "Sayı",
      currency: "Para birimi",
      percent: "Yüzde"
    },
    lastValue: "Bir pivot en az bir değer alanı gerektirir.",
    aggregations: {
      sum: "Toplam",
      count: "Sayım",
      average: "Ortalama",
      min: "Minimum",
      max: "Maksimum"
    }
  };

  const ZONES = ["filter", "column", "row", "data"];
  const FORMAT_TYPES = ["number", "currency", "percent"];
  const DECIMAL_CHOICES = [0, 1, 2, 3, 4, 5, 6];
  // What the renderer applies when a member is absent, so the panel opens
  // showing what the user is actually looking at rather than empty controls.
  const RENDERER_DEFAULTS = { type: "number", decimals: 2, useGrouping: true };

  class PivotFieldDesigner {
    constructor(host, options = {}) {
      const element = typeof host === "string" ? root.document?.querySelector(host) : host;
      if (!element) {
        throw new Error("PivotFieldDesigner requires a host element or a selector matching one.");
      }

      if (!options.state) {
        throw new Error("PivotFieldDesigner requires a state.");
      }

      if (!options.widget || typeof options.widget.update !== "function") {
        throw new Error("PivotFieldDesigner requires a widget exposing update().");
      }

      this.host = element;
      this.state = options.state;
      this.widget = options.widget;
      this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
      this.disposed = false;
      // The HTML5 drag-and-drop spec makes dataTransfer.getData() unreadable
      // during dragover — only dragstart and drop can read the payload. We
      // track the field being dragged on the instance so dragover can ask
      // canDrop() without touching dataTransfer.
      this.draggedField = null;
      // Filters the available-field list only; never touched by mutations, and
      // must survive the re-renders they trigger, so it lives on the instance.
      this.searchTerm = "";
      // Which data field's format panel is expanded. Held on the instance so it
      // survives the re-render every edit triggers.
      this.openFormatFor = null;
      this.render();
    }

    createChip(name, area) {
      const document = root.document;
      const field = this.state.field(name);
      const chip = document.createElement("div");

      chip.className = "pivot-chip";
      chip.dataset.field = name;
      chip.draggable = true;
      chip.textContent = field.caption;
      chip.addEventListener("dragstart", event => {
        this.draggedField = name;
        chip.classList.add("is-dragging");
        event.dataTransfer?.setData?.("text/plain", name);
      });
      chip.addEventListener("dragend", () => {
        this.draggedField = null;
        chip.classList.remove("is-dragging");
        this.clearDropMarks();
      });

      if (area === "data") {
        const select = document.createElement("select");
        select.className = "pivot-chip__aggregation";
        select.dataset.action = "aggregation";
        const current = this.state.getState().values.find(value => value.field === name);

        AGGREGATIONS.forEach(aggregation => {
          const option = document.createElement("option");
          option.value = aggregation;
          option.textContent = this.labels.aggregations[aggregation];
          select.appendChild(option);
        });

        select.value = current?.aggregation ?? "sum";
        select.addEventListener("change", event => {
          this.apply(() => this.state.setAggregation(name, event.target.value));
        });
        chip.appendChild(select);

        const toggle = document.createElement("button");
        toggle.className = "pivot-chip__format-toggle";
        toggle.dataset.action = "format-toggle";
        toggle.textContent = "\u22ef";
        toggle.setAttribute("aria-label", `${field.caption} \u2014 ${this.labels.format}`);
        toggle.addEventListener("click", () => {
          this.openFormatFor = this.openFormatFor === name ? null : name;
          // A panel opening changes nothing the server cares about, so this
          // re-renders directly instead of going through apply().
          this.render();
        });
        chip.appendChild(toggle);

        if (this.openFormatFor === name) {
          chip.appendChild(this.createFormatPanel(name));
        }
      }

      if (area !== "available") {
        const remove = document.createElement("button");
        remove.className = "pivot-chip__remove";
        remove.dataset.action = "remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `${field.caption} — ${this.labels.remove}`);

        const isLastValue = area === "data" && this.state.getState().values.length === 1;
        if (isLastValue) {
          remove.disabled = true;
          remove.title = this.labels.lastValue;
        } else {
          remove.addEventListener("click", () => this.apply(() => this.state.remove(name)));
        }

        chip.appendChild(remove);
      }

      return chip;
    }

    // The current format as the user sees it: what was set, over what the
    // renderer would otherwise apply.
    effectiveFormat(name) {
      const value = this.state.getState().values.find(entry => entry.field === name);
      return { ...RENDERER_DEFAULTS, ...(value?.format ?? {}) };
    }

    // Writes one member, carrying the rest of the stored format across so an
    // edit never silently drops the currency or another untouched setting.
    setFormatMember(name, member, value) {
      const stored = this.state.getState().values.find(entry => entry.field === name)?.format ?? {};
      this.apply(() => this.state.setFormat(name, { ...stored, [member]: value }));
    }

    createFormatPanel(name) {
      const document = root.document;
      const format = this.effectiveFormat(name);

      const panel = document.createElement("div");
      panel.className = "pivot-chip__format";

      const type = document.createElement("select");
      type.dataset.action = "format-type";
      FORMAT_TYPES.forEach(entry => {
        const option = document.createElement("option");
        option.value = entry;
        option.textContent = this.labels.formatTypes[entry];
        type.appendChild(option);
      });
      type.value = format.type;
      type.addEventListener("change", event => {
        this.setFormatMember(name, "type", event.target.value);
      });
      panel.appendChild(type);

      const decimals = document.createElement("select");
      decimals.dataset.action = "format-decimals";
      DECIMAL_CHOICES.forEach(entry => {
        const option = document.createElement("option");
        option.value = String(entry);
        option.textContent = String(entry);
        decimals.appendChild(option);
      });
      decimals.value = String(format.decimals);
      decimals.addEventListener("change", event => {
        // The select reports a string; setFormat only accepts an integer.
        this.setFormatMember(name, "decimals", Number(event.target.value));
      });
      panel.appendChild(decimals);

      const grouping = document.createElement("input");
      grouping.dataset.action = "format-grouping";
      grouping.setAttribute("type", "checkbox");
      grouping.checked = format.useGrouping;
      grouping.setAttribute("aria-label", this.labels.formatGrouping);
      grouping.addEventListener("change", event => {
        this.setFormatMember(name, "useGrouping", event.target.checked);
      });
      panel.appendChild(grouping);

      return panel;
    }

    createZone(area) {
      const document = root.document;
      const zone = document.createElement("section");
      zone.className = "pivot-zone";
      zone.dataset.zone = area;

      const head = document.createElement("div");
      head.className = "pivot-zone__head";
      head.textContent = this.labels[area];
      zone.appendChild(head);

      const body = document.createElement("div");
      body.className = "pivot-zone__body";
      zone.appendChild(body);
      this.zoneBodies.push(body);

      zone.addEventListener("dragover", event => {
        const name = this.draggedField;
        if (!name || !this.state.canDrop(name, area)) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }

        this.markDropSlot(body, this.dropIndex(body, event.clientY));
      });

      zone.addEventListener("dragleave", () => this.clearDropMarks());

      zone.addEventListener("drop", event => {
        const name = this.draggedField ?? event.dataTransfer?.getData?.("text/plain");
        this.draggedField = null;
        const index = this.dropIndex(body, event.clientY);
        this.clearDropMarks();

        if (!name || !this.state.canDrop(name, area)) {
          return;
        }

        event.preventDefault();
        this.apply(() => this.state.move(name, area, index));
      });

      const names = this.namesIn(area);
      names.forEach(name => body.appendChild(this.createChip(name, area)));
      return zone;
    }

    namesIn(area) {
      const state = this.state.getState();
      switch (area) {
        case "row": return state.rows;
        case "column": return state.columns;
        case "data": return state.values.map(value => value.field);
        case "filter": return state.filters.map(filter => filter.field);
        default: return state.available;
      }
    }

    createAvailable() {
      const document = root.document;
      const section = document.createElement("section");
      section.className = "pivot-field-list-panel";
      section.dataset.zone = "available";

      const head = document.createElement("div");
      head.className = "pivot-section__head";
      head.textContent = this.labels.available;
      section.appendChild(head);

      const searchWrap = document.createElement("div");
      searchWrap.className = "pivot-search";
      const search = document.createElement("input");
      search.dataset.action = "search";
      search.value = this.searchTerm;
      search.setAttribute("placeholder", this.labels.search);
      // Search is a pure display filter over the already-loaded available list:
      // it must never touch the state and must never trigger widget.update(),
      // so it re-renders only the chip body directly, bypassing apply().
      search.addEventListener("input", event => {
        this.searchTerm = event.target.value;
        this.renderAvailableChips(body);
      });
      searchWrap.appendChild(search);
      section.appendChild(searchWrap);

      const body = document.createElement("div");
      body.className = "pivot-field-list";
      section.appendChild(body);

      this.renderAvailableChips(body);

      return section;
    }

    renderAvailableChips(body) {
      const term = this.searchTerm.trim().toLowerCase();
      const names = this.namesIn("available").filter(name => {
        if (!term) {
          return true;
        }
        const caption = this.state.field(name).caption ?? "";
        return caption.toLowerCase().includes(term);
      });

      body.replaceChildren(...names.map(name => this.createChip(name, "available")));
    }

    // Which slot a release at `clientY` targets: the first chip whose midpoint
    // the pointer has not yet passed, or the end of the zone. The dragged chip
    // is deliberately included, so the index is expressed against the zone as
    // it looks right now — which is what PivotLayoutState.move expects.
    dropIndex(body, clientY) {
      if (typeof clientY !== "number") {
        return body.children.length;
      }

      const found = body.children.findIndex(chip => {
        const rect = chip.getBoundingClientRect();
        return clientY < rect.top + (rect.height / 2);
      });

      return found === -1 ? body.children.length : found;
    }

    // The insertion point is drawn as an edge on a chip rather than an inserted
    // node, so the marker cannot disturb the geometry it was measured from.
    markDropSlot(body, index) {
      this.clearDropMarks();

      const chips = body.children;
      if (chips.length === 0) {
        return;
      }

      if (index >= chips.length) {
        chips[chips.length - 1].classList.add("is-drop-after");
      } else {
        chips[index].classList.add("is-drop-before");
      }
    }

    clearDropMarks() {
      (this.zoneBodies ?? []).forEach(body => {
        body.children.forEach(chip => {
          chip.classList.remove("is-drop-before", "is-drop-after");
        });
      });
    }

    render() {
      const document = root.document;
      // Rebuilt every render, so the drop-marker cleanup never touches chips
      // from a previous tree.
      this.zoneBodies = [];
      const grid = document.createElement("div");
      grid.className = "pivot-layout-grid";
      ZONES.forEach(area => grid.appendChild(this.createZone(area)));

      this.host.replaceChildren(this.createAvailable(), grid);
    }

    async apply(mutation) {
      // A refused mutation must not reach the widget, so the state runs first.
      mutation();
      this.render();
      await this.widget.update(this.state.toRequestState());
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.host.replaceChildren();
    }
  }

  PivotForge.PivotFieldDesigner = PivotFieldDesigner;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotFieldDesigner;
  }
})(typeof window !== "undefined" ? window : globalThis);
