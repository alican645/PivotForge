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
    settings: "Alan ayarları",
    filterValues: "Filtre değerleri",
    // {0} is replaced with the number of selected values.
    filterCount: "({0})",
    aggregation: "Değer ayarları",
    showAs: "Değerleri farklı göster",
    formatting: "Biçimlendirme",
    formatDecimals: "Ondalık basamak",
    fieldName: "Alan adı",
    rename: "Adı değiştir",
    resetName: "Sıfırla",
    position: "Konum",
    moveUp: "Yukarı taşı",
    moveDown: "Aşağı taşı",
    removeField: "Alanı kaldır",
    close: "Kapat",
    showAsLabels: {
      normal: "Normal",
      percentOfRowTotal: "Satır toplamının %'si",
      percentOfColumnTotal: "Sütun toplamının %'si",
      percentOfGrandTotal: "Genel toplamın %'si",
      differenceFromPrevious: "Öncekinden fark",
      percentDifferenceFromPrevious: "Öncekinden % fark",
      runningTotal: "Kümülatif toplam"
    },
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
  const SHOW_AS = [
    "normal",
    "percentOfRowTotal",
    "percentOfColumnTotal",
    "percentOfGrandTotal",
    "differenceFromPrevious",
    "percentDifferenceFromPrevious",
    "runningTotal"
  ];
  const FORMAT_TYPES = ["number", "currency", "percent"];
  const DECIMAL_CHOICES = [0, 1, 2, 3, 4, 5, 6];
  // What the renderer applies when a member is absent, so the panel opens
  // showing what the user is actually looking at rather than empty controls.
  const RENDERER_DEFAULTS = { type: "number", decimals: 2, useGrouping: true };
  // How far a press has to travel before it counts as a drag rather than a
  // click. Below this the chip's own controls keep working normally.
  const DRAG_THRESHOLD = 5;

  // Pointer capture is an optimisation, not a requirement: it keeps moves
  // arriving after the pointer leaves the chip. It legitimately throws when the
  // pointer is no longer active by the time we ask — the press was already
  // released, or the id belongs to a pointer the platform has forgotten — and
  // losing the drag over that would be worse than dragging without capture.
  function capturePointer(element, pointerId) {
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Nothing to do: the drag proceeds on the listeners alone.
    }
  }

  function releasePointer(element, pointerId) {
    try {
      element.releasePointerCapture?.(pointerId);
    } catch {
      // Already gone, which is the state we wanted.
    }
  }

  function format(template, ...values) {
    return values.reduce(
      (text, value, index) => text.replaceAll(`{${index}}`, String(value)),
      String(template));
  }

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
      // Drag runs on pointer events rather than HTML5 drag-and-drop, which
      // never fires on touch devices. One mechanism now covers mouse, touch
      // and pen.
      this.drag = null;
      this.draggedField = null;
      // Bound once so the same reference can be removed again; a fresh arrow
      // per drag would leak a listener on every press.
      this.pointerMove = event => this.handlePointerMove(event);
      this.pointerUp = event => this.handlePointerUp(event);
      this.pointerCancel = event => this.handlePointerCancel(event);
      // Which element each area's chips live in, keyed by area, so a hit test
      // that lands anywhere in a zone can find the list it should measure.
      this.zones = new Map();
      // Filters the available-field list only; never touched by mutations, and
      // must survive the re-renders they trigger, so it lives on the instance.
      this.searchTerm = "";
      // Which data field the settings modal is showing, or null. The modal
      // lives outside the host, so it survives the re-render every edit
      // triggers and does not need to be rebuilt by render().
      this.settingsFor = null;
      this.settings = null;
      // Built on first use, so a designer whose filter zone is never opened
      // never creates the picker's overlay. A host may supply its own.
      this.filterPicker = options.filterPicker ?? null;
      this.render();
    }

    createChip(name, area) {
      const document = root.document;
      const field = this.state.field(name);
      const chip = document.createElement("div");

      chip.className = "pivot-chip";
      chip.dataset.field = name;
      chip.addEventListener("pointerdown", event => this.beginDrag(event, chip, name));

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
      if (area !== "available") {
        const settings = document.createElement("button");
        settings.className = "pivot-chip__settings";
        settings.dataset.action = "settings";
        settings.textContent = "\u22ef";
        settings.setAttribute("aria-label", `${field.caption} \u2014 ${this.labels.settings}`);
        settings.addEventListener("click", () => this.openSettings(name));
        chip.appendChild(settings);
      }

      // Only a filter field has values to pick, and the picker needs the widget
      // to fetch them — a designer wired to a widget without fieldValues() is
      // an older host, so the control is left off rather than offered broken.
      if (area === "filter" && this.canPickFilterValues()) {
        const funnel = document.createElement("button");
        funnel.className = "pivot-chip__filter";
        funnel.dataset.action = "filter";
        funnel.textContent = "▼";
        funnel.setAttribute("aria-label", `${field.caption} — ${this.labels.filterValues}`);
        funnel.addEventListener("click", () => this.openFilterPicker(name));
        chip.appendChild(funnel);
      }

      const label = document.createElement("span");
      label.className = "pivot-chip__label";
      label.textContent = field.caption;
      chip.appendChild(label);

      // A filter whose zone shows only the field name gives no clue that it is
      // restricting anything, so an active one carries its selection count.
      const selectedCount = area === "filter" ? this.filterValuesOf(name).length : 0;
      if (selectedCount > 0) {
        const count = document.createElement("span");
        count.className = "pivot-chip__filter-count";
        count.textContent = format(this.labels.filterCount, selectedCount);
        chip.appendChild(count);
      }

      // Trails the chip, and is the only element carrying touch-action: none —
      // so a touch anywhere else still scrolls the list, which a long
      // available-field catalog needs. A mouse can drag from the whole chip.
      const grip = document.createElement("span");
      grip.className = "pivot-chip__grip";
      grip.dataset.action = "grip";
      grip.textContent = "⠿";
      grip.setAttribute("aria-hidden", "true");
      chip.appendChild(grip);

      return chip;
    }

    // A press becomes a drag only after it has travelled far enough to be one,
    // so a tap or a click on a chip control still reaches that control.
    beginDrag(event, chip, name) {
      const fromGrip = Boolean(event.target?.closest?.(".pivot-chip__grip"));

      // A press on a control belongs to that control.
      if (!fromGrip && event.target?.closest?.("button")) {
        return;
      }

      // Only the grip opts out of the browser's touch gestures, so only the
      // grip can start a drag with a finger or a pen.
      if (!fromGrip && event.pointerType && event.pointerType !== "mouse") {
        return;
      }

      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      this.drag = {
        name,
        chip,
        pointerId: event.pointerId,
        startX: event.clientX ?? 0,
        startY: event.clientY ?? 0,
        started: false
      };

      capturePointer(chip, event.pointerId);
      chip.addEventListener("pointermove", this.pointerMove);
      chip.addEventListener("pointerup", this.pointerUp);
      chip.addEventListener("pointercancel", this.pointerCancel);
    }

    handlePointerMove(event) {
      const drag = this.drag;
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
        return;
      }

      if (!drag.started) {
        const dx = (event.clientX ?? 0) - drag.startX;
        const dy = (event.clientY ?? 0) - drag.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
          return;
        }

        drag.started = true;
        this.draggedField = drag.name;
        drag.chip.classList.add("is-dragging");
      }

      // Stops the page from selecting text under a mouse drag, and from
      // treating a grip drag as a scroll on the platforms that would.
      event.preventDefault?.();
      this.showDropFeedback(drag.name, event.clientX, event.clientY);
    }

    handlePointerUp(event) {
      const drag = this.drag;
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
        return;
      }

      const { name, started } = drag;
      this.endDrag();

      // A press that never travelled is a click, and a click moves nothing.
      if (!started) {
        return;
      }

      // A drag that ends outside every zone is a cancel, not a removal:
      // releasing off the panel is how a user backs out of a move.
      const target = this.zoneAt(event.clientX, event.clientY);
      if (!target) {
        return;
      }

      if (target.area === "available") {
        if (this.canReturn(name)) {
          this.apply(() => this.state.remove(name));
        }
        return;
      }

      if (this.state.canDrop(name, target.area)) {
        const dropAt = this.dropIndex(target.body, event.clientY);
        this.apply(() => this.state.move(name, target.area, dropAt));
      }
    }

    handlePointerCancel(event) {
      if (!this.drag || (event.pointerId !== undefined && event.pointerId !== this.drag.pointerId)) {
        return;
      }

      this.endDrag();
    }

    endDrag() {
      const drag = this.drag;
      this.drag = null;
      this.draggedField = null;

      if (!drag) {
        return;
      }

      releasePointer(drag.chip, drag.pointerId);
      drag.chip.removeEventListener("pointermove", this.pointerMove);
      drag.chip.removeEventListener("pointerup", this.pointerUp);
      drag.chip.removeEventListener("pointercancel", this.pointerCancel);
      drag.chip.classList.remove("is-dragging");
      this.clearDropMarks();

      // A pointer release after a real drag also fires a click. Swallowing it
      // once keeps a drag that started on a chip control from also activating
      // that control.
      if (drag.started) {
        drag.chip.addEventListener(
          "click",
          event => {
            event.stopPropagation?.();
            event.preventDefault?.();
          },
          { capture: true, once: true });
      }
    }

    // The same feedback the drop handler will act on, so what the user sees and
    // what happens on release are decided by one piece of code.
    showDropFeedback(name, clientX, clientY) {
      this.clearDropMarks();

      const target = this.zoneAt(clientX, clientY);
      if (!target) {
        return;
      }

      if (target.area === "available") {
        target.zone.classList.add(
          this.canReturn(name) ? "is-empty-drop-target" : "is-drop-refused");
        return;
      }

      // A refused drag used to fall out silently, leaving "not allowed here"
      // and "broken" looking identical.
      if (!this.state.canDrop(name, target.area)) {
        target.zone.classList.add("is-drop-refused");
        return;
      }

      // The insertion line is drawn on a chip's edge, so an empty zone has
      // nothing to draw it on. Highlight the zone itself instead, otherwise
      // dragging into an empty area gives no feedback whatsoever.
      if (target.body.children.length === 0) {
        target.zone.classList.add("is-empty-drop-target");
        return;
      }

      this.markDropSlot(target.body, this.dropIndex(target.body, clientY));
    }

    // Pointer capture retargets every move and the release to the chip being
    // dragged, so the zone under the pointer has to be found by hit-testing
    // rather than read off the event.
    zoneAt(clientX, clientY) {
      if (typeof clientX !== "number" || typeof clientY !== "number") {
        return null;
      }

      const element = root.document?.elementFromPoint?.(clientX, clientY);
      const zone = element?.closest?.("[data-zone]");
      return zone ? this.zones.get(zone.dataset.zone) ?? null : null;
    }

    canPickFilterValues() {
      return typeof this.widget.fieldValues === "function" &&
        (this.filterPicker !== null || typeof PivotForge.PivotFilterPicker === "function");
    }

    filterValuesOf(name) {
      return this.state.getState().filters.find(entry => entry.field === name)?.values ?? [];
    }

    openFilterPicker(name) {
      this.filterPicker ??= new PivotForge.PivotFilterPicker({
        widget: this.widget,
        labels: this.labels.filterPicker
      });

      return this.filterPicker.open({
        field: name,
        caption: this.state.field(name).caption,
        selected: this.filterValuesOf(name),
        onApply: values => this.apply(() => this.state.setFilterValues(name, values))
      });
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

    // Field settings live in a modal rather than inside the chip: a chip that
    // expands to hold its controls dwarfs its neighbours and makes a zone's
    // drop geometry jump around mid-drag. The sections are rebuilt per open,
    // because which of them apply depends on the field's area.
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
      this.settings = { overlay, title, body };
      return this.settings;
    }

    // A titled block in the modal.
    settingsSection(titleText) {
      const document = root.document;
      const section = document.createElement("div");
      section.className = "pivot-value-settings__section";

      const heading = document.createElement("span");
      heading.className = "pivot-value-settings__title";
      heading.textContent = titleText;
      section.appendChild(heading);

      return section;
    }

    // A row of choice buttons where exactly one is current. The old hand-built
    // menu used buttons rather than a select so the whole set of options is
    // visible at once and the active one is legible without opening anything.
    settingsChoices(parent, action, entries, current, onPick) {
      const document = root.document;
      const grid = document.createElement("div");
      grid.className = "pivot-value-settings__grid";

      entries.forEach(({ value, label }) => {
        const button = document.createElement("button");
        button.className = "pivot-value-settings__choice";
        button.setAttribute("type", "button");
        button.dataset.action = action;
        button.dataset.value = String(value);
        button.dataset.selected = String(value === current);
        button.textContent = label;
        button.addEventListener("click", () => onPick(value));
        grid.appendChild(button);
      });

      parent.appendChild(grid);
      return grid;
    }

    renderSettings(name) {
      const document = root.document;
      const settings = this.buildSettings();
      const area = this.state.areaOf(name);
      const value = this.state.getState().values.find(entry => entry.field === name);
      const format = this.effectiveFormat(name);

      settings.title.textContent =
        `${this.state.field(name).caption} — ${this.labels.settings}`;
      settings.body.replaceChildren();

      // --- Field name -----------------------------------------------------
      const naming = this.settingsSection(this.labels.fieldName);
      const input = document.createElement("input");
      input.className = "pivot-value-settings__input";
      input.dataset.action = "caption";
      input.setAttribute("type", "text");
      input.value = this.state.field(name).caption;
      input.setAttribute("placeholder", this.state.declaredCaption(name));
      naming.appendChild(input);

      const namingRow = document.createElement("div");
      namingRow.className = "pivot-value-settings__row";

      const rename = document.createElement("button");
      rename.className = "pivot-value-settings__choice";
      rename.setAttribute("type", "button");
      rename.dataset.action = "rename";
      rename.textContent = this.labels.rename;
      rename.addEventListener("click", () => {
        this.apply(() => this.state.setCaption(name, input.value));
      });

      const reset = document.createElement("button");
      reset.className = "pivot-value-settings__choice";
      reset.setAttribute("type", "button");
      reset.dataset.action = "reset-caption";
      reset.textContent = this.labels.resetName;
      reset.addEventListener("click", () => {
        this.apply(() => this.state.setCaption(name, ""));
      });

      namingRow.appendChild(rename);
      namingRow.appendChild(reset);
      naming.appendChild(namingRow);
      settings.body.appendChild(naming);

      // --- Position -------------------------------------------------------
      const names = this.namesIn(area);
      const index = names.indexOf(name);
      const position = this.settingsSection(this.labels.position);
      const positionRow = document.createElement("div");
      positionRow.className = "pivot-value-settings__row";

      const step = (action, label, target, enabled) => {
        const button = document.createElement("button");
        button.className = "pivot-value-settings__choice";
        button.setAttribute("type", "button");
        button.dataset.action = action;
        button.textContent = label;
        button.disabled = !enabled;
        if (enabled) {
          button.addEventListener("click", () => {
            this.apply(() => this.state.move(name, area, target));
          });
        }
        positionRow.appendChild(button);
      };

      // move() takes an index against the zone as it looks now, so moving down
      // one slot means targeting index + 2: the field's own entry is still in
      // the list and is compensated for on the way in.
      step("move-up", this.labels.moveUp, index - 1, index > 0);
      step("move-down", this.labels.moveDown, index + 2, index < names.length - 1);
      position.appendChild(positionRow);
      settings.body.appendChild(position);

      if (area === "data") {
        // --- Aggregation --------------------------------------------------
        const aggregation = this.settingsSection(this.labels.aggregation);
        this.settingsChoices(
          aggregation,
          "aggregation",
          AGGREGATIONS.map(entry => ({ value: entry, label: this.labels.aggregations[entry] })),
          value?.aggregation ?? "sum",
          picked => this.apply(() => this.state.setAggregation(name, picked)));
        settings.body.appendChild(aggregation);

        // --- Show as ------------------------------------------------------
        const showAs = this.settingsSection(this.labels.showAs);
        // These labels are sentences rather than words, so they stack one per
        // row instead of sharing the grid the shorter choices use.
        this.settingsChoices(
          showAs,
          "show-as",
          SHOW_AS.map(entry => ({ value: entry, label: this.labels.showAsLabels[entry] })),
          value?.showAs ?? "normal",
          picked => this.apply(() => this.state.setShowAs(name, picked))
        ).classList.add("is-stacked");
        settings.body.appendChild(showAs);

        // --- Formatting ---------------------------------------------------
        const formatting = this.settingsSection(this.labels.formatting);

        const grouping = document.createElement("button");
        grouping.className = "pivot-value-settings__choice";
        grouping.setAttribute("type", "button");
        grouping.dataset.action = "format-grouping";
        grouping.dataset.selected = String(format.useGrouping);
        grouping.textContent =
          `${this.labels.formatGrouping}${format.useGrouping ? " ✓" : ""}`;
        grouping.addEventListener("click", () => {
          this.setFormatMember(name, "useGrouping", !format.useGrouping);
        });
        formatting.appendChild(grouping);

        this.settingsChoices(
          formatting,
          "format-type",
          FORMAT_TYPES.map(entry => ({ value: entry, label: this.labels.formatTypes[entry] })),
          format.type,
          picked => this.setFormatMember(name, "type", picked));

        this.settingsChoices(
          formatting,
          "format-decimals",
          DECIMAL_CHOICES.map(entry => ({ value: entry, label: String(entry) })),
          format.decimals,
          picked => this.setFormatMember(name, "decimals", picked));

        settings.body.appendChild(formatting);
      }

      // --- Remove ---------------------------------------------------------
      const remove = document.createElement("button");
      remove.className = "pivot-value-settings__choice is-danger";
      remove.setAttribute("type", "button");
      remove.dataset.action = "remove";
      remove.textContent = this.labels.removeField;

      if (this.canReturn(name)) {
        remove.addEventListener("click", () => {
          this.closeSettings();
          this.apply(() => this.state.remove(name));
        });
      } else {
        remove.disabled = true;
        remove.title = this.labels.lastValue;
      }

      settings.body.appendChild(remove);
      return settings;
    }

    openSettings(name) {
      this.settingsFor = name;
      const settings = this.renderSettings(name);
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
      this.zones.set(area, { zone, body, area });

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
      // worked in one direction only. Releasing here unplaces the field.
      this.zoneElements.push(section);

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
      this.zones.set("available", { zone: section, body, area: "available" });
      this.zoneBodies.push(body);

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
      this.zones = new Map();
      const grid = document.createElement("div");
      grid.className = "pivot-layout-grid";
      ZONES.forEach(area => grid.appendChild(this.createZone(area)));

      this.host.replaceChildren(this.createAvailable(), grid);

      // Every edit re-renders; the modal lives outside the host and so must be
      // refreshed by hand, or its selected states would show the value from
      // before the edit. A field that left the layout has nothing left to
      // configure, so its modal closes instead.
      if (this.settingsFor) {
        if (this.state.areaOf(this.settingsFor) === "available") {
          this.closeSettings();
        } else {
          this.renderSettings(this.settingsFor);
        }
      }
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
      // A drag in flight holds pointer capture and three listeners on a chip
      // that is about to be thrown away.
      this.endDrag();
      this.closeSettings();

      if (this.settingsKeydown) {
        root.document.removeEventListener("keydown", this.settingsKeydown);
        this.settingsKeydown = null;
      }

      this.settings?.overlay.remove?.();
      this.settings = null;
      this.filterPicker?.dispose();
      this.filterPicker = null;
      this.host.replaceChildren();
    }
  }

  PivotForge.PivotFieldDesigner = PivotFieldDesigner;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotFieldDesigner;
  }
})(typeof window !== "undefined" ? window : globalThis);
