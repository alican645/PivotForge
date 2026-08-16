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
    settings: "Değer ayarları",
    aggregation: "Özet",
    formatDecimals: "Ondalık basamak",
    close: "Kapat",
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
      // Which data field the settings modal is showing, or null. The modal
      // lives outside the host, so it survives the re-render every edit
      // triggers and does not need to be rebuilt by render().
      this.settingsFor = null;
      this.settings = null;
      this.render();
    }

    createChip(name, area) {
      const document = root.document;
      const field = this.state.field(name);
      const chip = document.createElement("div");

      chip.className = "pivot-chip";
      chip.dataset.field = name;
      chip.draggable = true;
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

      // Controls come first so they line up down the left edge of a zone,
      // independent of how long each caption is.
      if (area !== "available") {
        const remove = document.createElement("button");
        remove.className = "pivot-chip__remove";
        remove.dataset.action = "remove";
        remove.textContent = "\u00d7";
        remove.setAttribute("aria-label", `${field.caption} \u2014 ${this.labels.remove}`);

        const isLastValue = area === "data" && this.state.getState().values.length === 1;
        if (isLastValue) {
          remove.disabled = true;
          remove.title = this.labels.lastValue;
        } else {
          remove.addEventListener("click", () => this.apply(() => this.state.remove(name)));
        }

        chip.appendChild(remove);
      }

      // Aggregation and format used to sit inside the chip, which made a placed
      // value chip several times the height of a plain one and left the zone
      // ragged. They live in a modal now; the chip only offers the way in.
      if (area === "data") {
        const settings = document.createElement("button");
        settings.className = "pivot-chip__settings";
        settings.dataset.action = "settings";
        settings.textContent = "\u22ef";
        settings.setAttribute("aria-label", `${field.caption} \u2014 ${this.labels.settings}`);
        settings.addEventListener("click", () => this.openSettings(name));
        chip.appendChild(settings);
      }

      const label = document.createElement("span");
      label.className = "pivot-chip__label";
      label.textContent = field.caption;
      chip.appendChild(label);

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

    // Value settings live in a modal rather than inside the chip: a chip that
    // expands to hold three controls dwarfs its neighbours and makes a zone's
    // drop geometry jump around mid-drag.
    buildSettings() {
      if (this.settings) {
        return this.settings;
      }

      const document = root.document;
      const overlay = document.createElement("div");
      overlay.className = "pivot-modal pivot-value-settings";
      overlay.setAttribute("aria-hidden", "true");

      const dialog = document.createElement("div");
      dialog.className = "pivot-modal__dialog pivot-value-settings__dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const head = document.createElement("div");
      head.className = "pivot-panel-head";
      const title = document.createElement("h2");
      const close = document.createElement("button");
      close.className = "pivot-button";
      close.dataset.action = "settings-close";
      close.setAttribute("type", "button");
      close.textContent = this.labels.close;
      close.addEventListener("click", () => this.closeSettings());
      head.appendChild(title);
      head.appendChild(close);

      const body = document.createElement("div");
      body.className = "pivot-value-settings__body";

      const row = (labelText, control) => {
        const wrap = document.createElement("label");
        wrap.className = "pivot-value-settings__row";
        const caption = document.createElement("span");
        caption.textContent = labelText;
        wrap.appendChild(caption);
        wrap.appendChild(control);
        body.appendChild(wrap);
        return control;
      };

      const aggregation = document.createElement("select");
      aggregation.dataset.action = "aggregation";
      AGGREGATIONS.forEach(entry => {
        const option = document.createElement("option");
        option.value = entry;
        option.textContent = this.labels.aggregations[entry];
        aggregation.appendChild(option);
      });
      aggregation.addEventListener("change", event => {
        this.apply(() => this.state.setAggregation(this.settingsFor, event.target.value));
      });
      row(this.labels.aggregation, aggregation);

      const type = document.createElement("select");
      type.dataset.action = "format-type";
      FORMAT_TYPES.forEach(entry => {
        const option = document.createElement("option");
        option.value = entry;
        option.textContent = this.labels.formatTypes[entry];
        type.appendChild(option);
      });
      type.addEventListener("change", event => {
        this.setFormatMember(this.settingsFor, "type", event.target.value);
      });
      row(this.labels.format, type);

      const decimals = document.createElement("select");
      decimals.dataset.action = "format-decimals";
      DECIMAL_CHOICES.forEach(entry => {
        const option = document.createElement("option");
        option.value = String(entry);
        option.textContent = String(entry);
        decimals.appendChild(option);
      });
      decimals.addEventListener("change", event => {
        // The select reports a string; setFormat only accepts an integer.
        this.setFormatMember(this.settingsFor, "decimals", Number(event.target.value));
      });
      row(this.labels.formatDecimals, decimals);

      const grouping = document.createElement("input");
      grouping.dataset.action = "format-grouping";
      grouping.setAttribute("type", "checkbox");
      grouping.addEventListener("change", event => {
        this.setFormatMember(this.settingsFor, "useGrouping", event.target.checked);
      });
      row(this.labels.formatGrouping, grouping);

      dialog.appendChild(head);
      dialog.appendChild(body);
      overlay.appendChild(dialog);

      // Only the overlay itself counts as a backdrop click, so a click that
      // lands on a control inside the dialog does not close it.
      overlay.addEventListener("click", event => {
        if (event.target === overlay) {
          this.closeSettings();
        }
      });

      this.settingsKeydown = event => {
        if (event.key === "Escape" && this.settingsFor) {
          this.closeSettings();
        }
      };
      root.document.addEventListener("keydown", this.settingsKeydown);

      (root.document.body ?? this.host).appendChild(overlay);
      this.settings = { overlay, title, aggregation, type, decimals, grouping };
      return this.settings;
    }

    openSettings(name) {
      const settings = this.buildSettings();
      this.settingsFor = name;

      const value = this.state.getState().values.find(entry => entry.field === name);
      const format = this.effectiveFormat(name);

      settings.title.textContent =
        `${this.state.field(name).caption} \u2014 ${this.labels.settings}`;
      settings.aggregation.value = value?.aggregation ?? "sum";
      settings.type.value = format.type;
      settings.decimals.value = String(format.decimals);
      settings.grouping.checked = format.useGrouping;
      settings.overlay.classList.add("is-open");
      settings.overlay.setAttribute("aria-hidden", "false");
    }

    closeSettings() {
      this.settingsFor = null;
      if (this.settings) {
        this.settings.overlay.classList.remove("is-open");
        this.settings.overlay.setAttribute("aria-hidden", "true");
      }
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
      this.zoneElements.push(zone);

      zone.addEventListener("dragover", event => {
        const name = this.draggedField;
        if (!name) {
          return;
        }

        this.clearDropMarks();

        // A refused drag used to fall out silently, leaving "not allowed here"
        // and "broken" looking identical. Saying so costs one class and the
        // cursor the platform already draws for dropEffect "none".
        if (!this.state.canDrop(name, area)) {
          zone.classList.add("is-drop-refused");
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "none";
          }
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }

        // The insertion line is drawn on a chip's edge, so an empty zone has
        // nothing to draw it on. Highlight the zone itself instead, otherwise
        // dragging into an empty area gives no feedback whatsoever.
        if (body.children.length === 0) {
          zone.classList.add("is-empty-drop-target");
          return;
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

    // Whether dragging `name` back to the available list would be accepted.
    // Mirrors what the × button allows, so the two gestures cannot disagree.
    canReturn(name) {
      const area = this.state.areaOf(name);
      if (area === "available") {
        return false;
      }

      return !(area === "data" && this.state.getState().values.length === 1);
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

      // Removing a field was only possible through its × button: a chip could be
      // dragged out of the available list but never back into it, so the gesture
      // worked in one direction only. Dropping here unplaces the field.
      this.zoneElements.push(section);

      section.addEventListener("dragover", event => {
        const name = this.draggedField;
        if (!name) {
          return;
        }

        this.clearDropMarks();

        if (!this.canReturn(name)) {
          section.classList.add("is-drop-refused");
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "none";
          }
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        section.classList.add("is-empty-drop-target");
      });

      section.addEventListener("drop", event => {
        const name = this.draggedField ?? event.dataTransfer?.getData?.("text/plain");
        this.draggedField = null;
        this.clearDropMarks();

        if (!name || !this.canReturn(name)) {
          return;
        }

        event.preventDefault();
        this.apply(() => this.state.remove(name));
      });

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

      // `children` is an HTMLCollection, which has length and indexed access but
      // none of Array.prototype — so it has to be copied before findIndex.
      const found = Array.from(body.children).findIndex(chip => {
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
      (this.zoneElements ?? []).forEach(zone => {
        zone.classList.remove("is-empty-drop-target", "is-drop-refused");
      });

      (this.zoneBodies ?? []).forEach(body => {
        // Same HTMLCollection constraint as dropIndex: copy before iterating.
        Array.from(body.children).forEach(chip => {
          chip.classList.remove("is-drop-before", "is-drop-after");
        });
      });
    }

    render() {
      const document = root.document;
      // Rebuilt every render, so the drop-marker cleanup never touches chips
      // from a previous tree.
      this.zoneBodies = [];
      this.zoneElements = [];
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
      this.closeSettings();

      if (this.settingsKeydown) {
        root.document.removeEventListener("keydown", this.settingsKeydown);
        this.settingsKeydown = null;
      }

      this.settings?.overlay.remove?.();
      this.settings = null;
      this.host.replaceChildren();
    }
  }

  PivotForge.PivotFieldDesigner = PivotFieldDesigner;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotFieldDesigner;
  }
})(typeof window !== "undefined" ? window : globalThis);
