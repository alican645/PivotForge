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
        event.dataTransfer?.setData?.("text/plain", name);
      });
      chip.addEventListener("dragend", () => {
        this.draggedField = null;
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

      zone.addEventListener("dragover", event => {
        const name = this.draggedField;
        if (name && this.state.canDrop(name, area)) {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
        }
      });

      zone.addEventListener("drop", event => {
        const name = this.draggedField ?? event.dataTransfer?.getData?.("text/plain");
        this.draggedField = null;

        if (!name || !this.state.canDrop(name, area)) {
          return;
        }

        event.preventDefault();
        this.apply(() => this.state.move(name, area));
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
      section.className = "pivot-field-list";
      section.dataset.zone = "available";

      const head = document.createElement("div");
      head.className = "pivot-section__head";
      head.textContent = this.labels.available;
      section.appendChild(head);

      this.namesIn("available")
        .forEach(name => section.appendChild(this.createChip(name, "available")));

      return section;
    }

    render() {
      const document = root.document;
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
