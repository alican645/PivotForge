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
    // {0} is replaced with the number of listed values.
    filterCount: "({0})",
    // The same count means the opposite thing under an excluding filter, so it
    // cannot share the label.
    filterCountExcluded: "({0} hariç)",
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
  // Left-to-right order of the panels on screen, which is the order a keyboard
  // move steps through with the arrow keys.
  const KEYBOARD_AREAS = ["available", "filter", "column", "row", "data"];
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
      // A keyboard move in flight: which field was picked up and where it would
      // land. Nothing is written to the state until it is dropped, so Escape
      // costs nothing to honour -- the same bargain a drag released outside
      // every zone makes.
      this.grab = null;
      // Which chip carries its zone's tab stop, and the chip focus returns to
      // after the re-render every edit triggers.
      this.focusField = null;
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

    // aria-labelledby needs an id, and two designers on one page must not both
    // claim it. The host's own id is the natural namespace when it has one.
    zoneHeadingId(area) {
      this.instanceId ??= this.host.id || `pivotforge-designer-${++PivotFieldDesigner.instances}`;
      return `${this.instanceId}-${area}-heading`;
    }

    createChip(name, area) {
      const document = root.document;
      const field = this.state.field(name);
      const chip = document.createElement("div");

      chip.className = "pivot-chip";
      chip.dataset.field = name;
      // The chip -- not its controls -- is what a keyboard user operates, so it
      // is the thing that takes focus. refreshTabStops() decides afterwards
      // which one chip per zone is reachable with Tab.
      chip.tabIndex = -1;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-grabbed", "false");
      chip.addEventListener("pointerdown", event => this.beginDrag(event, chip, name));
      chip.addEventListener("keydown", event => this.handleKeydown(event, name, chip));
      chip.addEventListener("focus", () => {
        this.focusField = name;
        this.refreshTabStops();
      });

      // Controls come first so they line up down the left edge of a zone,
      // independent of how long each caption is.
      if (area !== "available") {
        const remove = document.createElement("button");
        remove.className = "pivot-chip__remove";
        remove.dataset.action = "remove";
        // Chip controls are taken out of the tab sequence: leaving them in
        // would multiply every field by three tab stops. Delete on the focused
        // chip removes it, and the settings modal carries the rest.
        remove.tabIndex = -1;
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
        settings.tabIndex = -1;
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
        funnel.tabIndex = -1;
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
      const filter = area === "filter" ? this.filterEntryOf(name) : null;
      if (filter && filter.values.length > 0) {
        const count = document.createElement("span");
        count.className = "pivot-chip__filter-count";
        count.classList.toggle("is-excluding", filter.mode === "Exclude");
        count.textContent = format(
          filter.mode === "Exclude" ? this.labels.filterCountExcluded : this.labels.filterCount,
          filter.values.length);
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

      // Reaching for the mouse abandons a keyboard move rather than running two
      // moves at once over the same drop marks.
      this.endGrab();

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

    // --- Keyboard --------------------------------------------------------
    // A drag is a pointer gesture and had no keyboard equivalent at all: chips
    // were not even focusable. The move itself is the same operation the drop
    // handler performs, so only the gesture is new here, not the rules.

    handleKeydown(event, name, chip) {
      // Chip controls sit outside the tab sequence but a click still focuses
      // them, and their keys belong to them rather than to the chip.
      if (event.target && event.target !== chip) {
        return;
      }

      const handled = this.grab
        ? this.grabbedKey(event.key)
        : this.idleKey(event.key, name);

      if (handled) {
        // Arrow keys would otherwise scroll the panel out from under the chip
        // the user is aiming with, and Space would scroll the page.
        event.preventDefault?.();
      }
    }

    idleKey(key, name) {
      switch (key) {
        case "ArrowUp": return this.focusSibling(name, -1);
        case "ArrowDown": return this.focusSibling(name, 1);
        case " ":
        case "Spacebar":
          this.beginGrab(name);
          return true;
        case "Enter":
          if (this.state.areaOf(name) === "available") {
            return false;
          }
          this.openSettings(name);
          return true;
        case "Delete":
          if (!this.canReturn(name)) {
            return false;
          }
          this.focusField = name;
          this.apply(() => this.state.remove(name));
          return true;
        default: return false;
      }
    }

    grabbedKey(key) {
      switch (key) {
        case "ArrowUp": return this.moveGrab(-1);
        case "ArrowDown": return this.moveGrab(1);
        case "ArrowLeft": return this.shiftGrabArea(-1);
        case "ArrowRight": return this.shiftGrabArea(1);
        case " ":
        case "Spacebar":
        case "Enter":
          this.dropGrab();
          return true;
        case "Escape":
          // Nothing was written, so backing out is simply forgetting.
          this.endGrab();
          return true;
        default: return false;
      }
    }

    beginGrab(name) {
      const area = this.state.areaOf(name);
      this.grab = { name, area, index: Math.max(this.namesIn(area).indexOf(name), 0) };

      const chip = this.chipFor(name);
      chip?.classList.add("is-keyboard-moving");
      chip?.setAttribute("aria-grabbed", "true");
      this.showGrabFeedback();
      return true;
    }

    endGrab() {
      const grab = this.grab;
      this.grab = null;

      if (!grab) {
        return;
      }

      const chip = this.chipFor(grab.name);
      chip?.classList.remove("is-keyboard-moving");
      chip?.setAttribute("aria-grabbed", "false");
      this.clearDropMarks();
    }

    // Steps the landing slot within the candidate zone.
    moveGrab(step) {
      const grab = this.grab;
      const names = this.namesIn(grab.area);
      // A field already in this zone can only occupy the slots that exist; one
      // arriving from elsewhere may also land past the last chip.
      const last = grab.area === this.state.areaOf(grab.name) ? names.length - 1 : names.length;
      grab.index = Math.min(Math.max(grab.index + step, 0), Math.max(last, 0));
      this.showGrabFeedback();
      return true;
    }

    shiftGrabArea(step) {
      const grab = this.grab;
      const next = KEYBOARD_AREAS[KEYBOARD_AREAS.indexOf(grab.area) + step];
      if (!next) {
        return false;
      }

      grab.area = next;
      const names = this.namesIn(next);
      // Arriving in a zone lands at its end, which is where a field dropped
      // into a zone with a mouse most often goes.
      grab.index = next === this.state.areaOf(grab.name)
        ? Math.max(names.length - 1, 0)
        : names.length;
      this.showGrabFeedback();
      return true;
    }

    // Mirrors the drag's drop rules exactly, so the two gestures cannot
    // disagree about what is allowed.
    grabAllowed(grab) {
      return grab.area === "available"
        ? this.canReturn(grab.name)
        : this.state.canDrop(grab.name, grab.area);
    }

    showGrabFeedback() {
      this.clearDropMarks();

      const grab = this.grab;
      const target = this.zones.get(grab.area);
      if (!target) {
        return;
      }

      if (!this.grabAllowed(grab)) {
        target.zone.classList.add("is-drop-refused");
        return;
      }

      if (grab.area === "available" || target.body.children.length === 0) {
        target.zone.classList.add("is-empty-drop-target");
        return;
      }

      this.markDropSlot(target.body, this.markerIndex(grab));
    }

    // markDropSlot draws against the zone as it looks now, which still holds
    // the grabbed chip when the move stays inside its own zone -- so a slot
    // past that chip is one further along on screen than it is in the result.
    markerIndex(grab) {
      const from = grab.area === this.state.areaOf(grab.name)
        ? this.namesIn(grab.area).indexOf(grab.name)
        : -1;
      return from >= 0 && grab.index > from ? grab.index + 1 : grab.index;
    }

    dropGrab() {
      const grab = this.grab;
      if (!this.grabAllowed(grab)) {
        return;
      }

      this.endGrab();
      // The field keeps focus through the re-render, wherever it lands.
      this.focusField = grab.name;

      if (grab.area === "available") {
        this.apply(() => this.state.remove(grab.name));
        return;
      }

      if (grab.area !== this.state.areaOf(grab.name)) {
        this.apply(() => this.state.move(grab.name, grab.area, grab.index));
        return;
      }

      // Within one zone the index is a final position, which is what reorder
      // takes -- and dropping a field back on its own slot changes nothing, so
      // it must not cost a request.
      const from = this.namesIn(grab.area).indexOf(grab.name);
      if (from !== grab.index) {
        this.apply(() => this.state.reorder(grab.area, from, grab.index));
      }
    }

    chipFor(name) {
      for (const { body } of this.zones.values()) {
        const found = Array.from(body.children).find(chip => chip.dataset.field === name);
        if (found) {
          return found;
        }
      }

      return null;
    }

    focusSibling(name, step) {
      const body = this.zones.get(this.state.areaOf(name))?.body;
      if (!body) {
        return false;
      }

      const chips = Array.from(body.children);
      const next = chips[chips.findIndex(chip => chip.dataset.field === name) + step];
      next?.focus?.();
      return Boolean(next);
    }

    // Roving tabindex: one tab stop per zone, on the chip the user last focused
    // there. Making every chip tabbable would bury the rest of the page behind
    // a tab stop per field.
    refreshTabStops() {
      this.zones.forEach(({ body }) => {
        const chips = Array.from(body.children);
        const stop = chips.find(chip => chip.dataset.field === this.focusField) ?? chips[0];
        chips.forEach(chip => { chip.tabIndex = chip === stop ? 0 : -1; });
      });
    }

    canPickFilterValues() {
      return typeof this.widget.fieldValues === "function" &&
        (this.filterPicker !== null || typeof PivotForge.PivotFilterPicker === "function");
    }

    filterEntryOf(name) {
      const entry = this.state.getState().filters.find(filter => filter.field === name);
      return { values: entry?.values ?? [], mode: entry?.mode ?? "Include" };
    }

    openFilterPicker(name) {
      this.filterPicker ??= new PivotForge.PivotFilterPicker({
        widget: this.widget,
        labels: this.labels.filterPicker
      });

      const filter = this.filterEntryOf(name);

      return this.filterPicker.open({
        field: name,
        caption: this.state.field(name).caption,
        selected: filter.values,
        mode: filter.mode,
        // One apply(), so a picker that changed both produces a single refresh.
        onApply: (values, mode) => this.apply(() => {
          this.state.setFilterMode(name, mode);
          this.state.setFilterValues(name, values);
        })
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

      // --- Filter values --------------------------------------------------
      // The chip's ▼ is out of the tab sequence, so this is the keyboard's way
      // in to the picker. Offered only where there are values to pick.
      if (area === "filter" && this.canPickFilterValues()) {
        const filtering = this.settingsSection(this.labels.filterValues);
        const open = document.createElement("button");
        open.className = "pivot-value-settings__choice";
        open.setAttribute("type", "button");
        open.dataset.action = "filter-values";
        open.textContent = this.labels.filterValues;
        open.addEventListener("click", () => {
          this.closeSettings();
          this.openFilterPicker(name);
        });
        filtering.appendChild(open);
        settings.body.appendChild(filtering);
      }

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
      head.id = this.zoneHeadingId(area);
      head.textContent = this.labels[area];
      zone.appendChild(head);

      const body = document.createElement("div");
      body.className = "pivot-zone__body";
      // Without this the chips are announced as bare buttons: "Bölge, düğme"
      // rather than "Satırlar, Bölge, düğme", which is the only part that says
      // where the field currently is.
      body.setAttribute("role", "group");
      body.setAttribute("aria-labelledby", head.id);
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
      head.id = this.zoneHeadingId("available");
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
      // A placeholder is not a label: it disappears as soon as the user types.
      search.setAttribute("aria-label", this.labels.search);
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
      body.setAttribute("role", "group");
      body.setAttribute("aria-labelledby", head.id);
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

      // Every render throws the chips away and builds new ones, so focus is
      // about to land on the document body. Asked before the swap, because
      // afterwards the focused element is already detached.
      const held = this.holdsFocus();

      ZONES.forEach(area => grid.appendChild(this.createZone(area)));

      this.host.replaceChildren(this.createAvailable(), grid);
      this.refreshTabStops();

      // Only give focus back if the designer had it: a mutation driven from
      // elsewhere on the page must not pull focus into the panel.
      if (held) {
        this.chipFor(this.focusField)?.focus?.();
      }

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

    // Whether focus currently sits inside the panel. A chip removed by its own
    // × button counts: the button is inside the host too.
    holdsFocus() {
      const active = root.document?.activeElement;
      return Boolean(active && this.host.contains?.(active));
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
      this.endGrab();
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

  PivotFieldDesigner.instances = 0;

  PivotForge.PivotFieldDesigner = PivotFieldDesigner;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotFieldDesigner;
  }
})(typeof window !== "undefined" ? window : globalThis);
