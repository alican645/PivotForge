(function (root) {
  const PivotForge = root.PivotForge ??= {};

  // Read from the request builder at call time rather than captured here: this
  // file is loaded before it in some hosts, and a captured undefined would only
  // show up when someone opened a condition.
  const COMPARISON_OPERATORS = {
    includes: operator =>
      (PivotForge.PivotRequestBuilder?.COMPARISON_OPERATORS ?? []).includes(operator)
  };

  // What a date control can hold, and so what it can be given back without
  // erasing it.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  // Opened from a button, the picker drops down under it -- but only where
  // there is room beside the button for a dropdown to be one. On a phone it
  // would be a modal without the backdrop, so it stays a modal there. The
  // width matches the stylesheet's phone breakpoint.
  const DROPDOWN_MEDIA = "(min-width: 561px)";
  const DROPDOWN_GAP = 4;
  const VIEWPORT_MARGIN = 8;
  // Excel-sized: narrow, and as tall as its content. The height is what the
  // compact layout takes with a full list, so it decides whether the dropdown
  // fits below the button or has to open above it.
  const DROPDOWN_WIDTH = 300;
  const DROPDOWN_HEIGHT = 400;
  // The controls take about 150px before the list gets any; with less room
  // than this on both sides a centred modal beats a dropdown of three rows.
  const DROPDOWN_MIN_HEIGHT = 240;

  const DEFAULT_LABELS = {
    // {0} is replaced with the field caption.
    title: "{0} filter",
    close: "Close",
    apply: "Apply",
    cancel: "Cancel",
    search: "Search values",
    selectAll: "Select all",
    clear: "Clear",
    blank: "(Blank)",
    // The mode's only observable effect is on values the source does not have
    // yet, so the control says that rather than "include"/"exclude" -- which
    // describes the storage and tells the reader nothing about the outcome.
    // The condition row. An operator other than "equals" replaces the value list
    // rather than narrowing it, so the two are never shown together.
    operatorLabel: "Condition",
    operators: {
      Equals: "is one of",
      Contains: "contains",
      StartsWith: "starts with",
      EndsWith: "ends with",
      Between: "between",
      GreaterThan: "greater than",
      LessThan: "less than",
      Blank: "is blank"
    },
    argument: "Value",
    argumentFrom: "From",
    argumentTo: "To",
    modeLabel: "Values added later",
    modeInclude: "Are hidden",
    modeExclude: "Are shown",
    loading: "Loading values...",
    noValues: "This field has no values",
    noMatches: "No value matches the search",
    failed: "The values could not be loaded",
    // {0} selected, {1} total.
    summary: "{0} of {1} values selected",
    // {0} is replaced with the server's value limit.
    truncated: "Showing the first {0} values. Selections outside the list are kept."
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
      this.mode = "Include";
      // How the values are read: as a list to keep, or as a condition's
      // arguments. Two argument boxes because Between is the widest operator.
      this.operator = "Equals";
      this.arguments = ["", ""];
      // Values the caller had selected that the server did not list, because
      // the response was truncated. Applying must not silently drop them.
      this.hiddenValues = [];
      this.searchTerm = "";
      this.isOpen = false;
      this.disposed = false;
      this.elements = null;
      // The button the picker was opened from, when it was; null opens it as a
      // modal. Kept while open so a scroll or resize can move the dropdown
      // with it.
      this.anchor = null;
      this.watching = false;
      this.reposition = () => this.place();
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

      // Checking a box always means "shown", in both modes. What the mode picks
      // is which side of the list is stored -- and therefore what happens to a
      // value that is not on either side yet.
      const modeRow = create("div", "pivot-filter-picker__mode");
      const modeLabel = create("span", "pivot-filter-picker__mode-label");
      modeLabel.textContent = this.labels.modeLabel;
      modeRow.appendChild(modeLabel);

      const modeButtons = ["Include", "Exclude"].map(mode => {
        const button = create("button", "pivot-button");
        button.dataset.action = "filter-mode";
        button.dataset.mode = mode;
        button.setAttribute("type", "button");
        button.textContent = mode === "Include" ? this.labels.modeInclude : this.labels.modeExclude;
        button.addEventListener("click", () => this.setMode(mode));
        modeRow.appendChild(button);
        return button;
      });

      // Sits above the list because it decides whether the list means anything:
      // an operator other than Equals answers the question the list was asking.
      const { FILTER_OPERATORS, FILTER_ARGUMENTS } = PivotForge.PivotRequestBuilder;
      const conditionRow = create("div", "pivot-filter-picker__condition");
      const conditionLabel = create("label", "pivot-filter-picker__condition-label");
      conditionLabel.textContent = this.labels.operatorLabel;
      conditionLabel.setAttribute("for", "pivot-filter-picker-operator");

      const operator = create("select", "pivot-filter-picker__operator");
      operator.id = "pivot-filter-picker-operator";
      operator.dataset.action = "filter-operator";
      FILTER_OPERATORS.forEach(name => {
        const option = create("option");
        option.value = name;
        option.textContent = this.labels.operators[name] ?? name;
        operator.appendChild(option);
      });
      operator.addEventListener("change", () => this.setOperator(operator.value));

      conditionRow.appendChild(conditionLabel);
      conditionRow.appendChild(operator);

      const argumentInputs = [0, 1].map(index => {
        const input = create("input", "pivot-filter-picker__argument");
        input.dataset.action = "filter-argument";
        input.dataset.index = String(index);
        input.setAttribute("type", "text");
        input.setAttribute("autocomplete", "off");
        input.addEventListener("input", () => {
          this.arguments[index] = input.value;
          this.renderCondition();
        });
        conditionRow.appendChild(input);
        return input;
      });

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

      body.appendChild(conditionRow);
      body.appendChild(toolbar);
      body.appendChild(modeRow);
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
      this.elements = {
        overlay, dialog, title, summary, search, notice, state, list, apply, modeButtons,
        toolbar, operator, argumentInputs, argumentCounts: FILTER_ARGUMENTS
      };
      return this.elements;
    }

    async open({
      field, caption, selected = [], mode = "Include", operator = "Equals", onApply, anchor = null
    } = {}) {
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
      this.hiddenValues = [];
      this.searchTerm = "";
      this.isOpen = true;
      // Anything that is not Exclude is Include; the strict check belongs to
      // the layout state, which is what a stored view is adopted through.
      this.mode = mode === "Exclude" ? "Exclude" : "Include";
      // An unknown operator opens as the value list rather than as a broken
      // control; the strict check belongs to the layout state, which is what a
      // stored view is adopted through.
      this.operator = PivotForge.PivotRequestBuilder.FILTER_OPERATORS.includes(operator)
        ? operator
        : "Equals";
      // A condition's arguments are carried in the same list a value selection
      // uses, so opening one is a matter of reading it as arguments instead.
      this.arguments = this.operator === "Equals"
        ? ["", ""]
        : [selected?.[0] ?? "", selected?.[1] ?? ""];
      this.renderMode();
      this.renderCondition();

      elements.search.value = "";
      elements.apply.disabled = true;
      elements.notice.hidden = true;
      elements.list.hidden = true;
      elements.list.replaceChildren();
      elements.overlay.classList.add("is-open");
      elements.overlay.setAttribute("aria-hidden", "false");
      this.anchor = anchor;
      this.place();
      this.watchAnchor(anchor !== null);
      elements.title.textContent = format(this.labels.title, caption ?? field);
      elements.summary.textContent = "";
      this.setState(this.labels.loading, false);

      if (this.operator !== "Equals") {
        // A text condition compares against values the source may not even hold
        // yet, so listing them would cost a request that answers nothing. A
        // comparison still needs them -- not to show, but to see what kind of
        // value the field holds and hand the reader the right control for it.
        this.setState("", false);

        if (COMPARISON_OPERATORS.includes(this.operator)) {
          this.loadValues({ list: false });
        }

        return;
      }

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

    // A checkbox means "shown" in both modes; only which side of the list is
    // stored differs. An empty incoming list means "no restriction", which is
    // every value checked — not an empty list. Storing it the other way round
    // would show a freshly placed filter field as excluding everything.
    applySelection(selected, response) {
      const incoming = (selected ?? []).map(value => (value == null ? "" : String(value)));
      const listed = new Set(incoming.filter(value => this.values.includes(value)));

      this.selected = incoming.length === 0
        ? new Set(this.values)
        : this.mode === "Exclude"
          ? new Set(this.values.filter(value => !listed.has(value)))
          : listed;

      // Listed values the server did not return, because the response was
      // truncated. Applying must carry them back or the list silently shrinks.
      this.hiddenValues = incoming.filter(value => !this.values.includes(value));

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

      // Excel's "(Select All)": one box over the rows the search is showing,
      // checked when all of them are and mixed when only some are. The
      // dropdown shows it in place of the toolbar's two buttons; the modal
      // keeps the buttons and hides this row.
      const all = document.createElement("label");
      all.className = "pivot-filter-picker__select-all";
      const allBox = document.createElement("input");
      allBox.setAttribute("type", "checkbox");
      allBox.dataset.action = "filter-toggle-all";
      const allText = document.createElement("span");
      allText.textContent = this.labels.selectAll;
      all.appendChild(allBox);
      all.appendChild(allText);

      const syncAll = () => {
        const count = visible.filter(value => this.selected.has(value)).length;
        allBox.checked = count === visible.length;
        allBox.indeterminate = count > 0 && count < visible.length;
      };
      syncAll();
      // A mixed box turns checked when clicked, so "some" goes to "all" first,
      // as it does in Excel.
      allBox.addEventListener("change", () => this.setVisibleSelection(allBox.checked));

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
          syncAll();
        });

        const text = document.createElement("span");
        text.textContent = this.displayText(value);

        row.appendChild(box);
        row.appendChild(text);
        return row;
      });

      elements.list.replaceChildren(all, ...rows);
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

    setMode(mode) {
      // Deliberately leaves the selection alone: the checked values are shown
      // under either mode, so switching changes nothing on screen today. What
      // it changes is a value the source gains tomorrow — hidden under Include
      // because it is not on the keep list, shown under Exclude because it is
      // not on the drop list.
      this.mode = mode === "Exclude" ? "Exclude" : "Include";
      this.renderMode();
    }

    setOperator(operator) {
      this.operator = PivotForge.PivotRequestBuilder.FILTER_OPERATORS.includes(operator)
        ? operator
        : "Equals";
      this.renderCondition();

      // Switching back to the value list needs the list, which was never
      // fetched if the picker opened on a condition; switching to a comparison
      // needs it for the argument control. Fetched once either way.
      if (this.values.length === 0 &&
        (this.operator === "Equals" || COMPARISON_OPERATORS.includes(this.operator))) {
        this.loadValues({ list: this.operator === "Equals" });
      }
    }

    async loadValues({ list = true } = {}) {
      const requestId = this.requestId;

      if (list) {
        this.setState(this.labels.loading, false);
      }

      try {
        const response = await this.widget.fieldValues(this.field);

        if (requestId !== this.requestId) {
          return;
        }

        this.values = response?.values ?? [];

        if (!list) {
          // Fetched only to decide the argument control, so nothing is drawn
          // except the condition that was already on screen.
          this.renderCondition();
          return;
        }

        this.applySelection([], response);
        this.renderList();
      } catch (error) {
        if (error?.name !== "AbortError" && requestId === this.requestId) {
          this.setState(error?.message || this.labels.failed, true);
        }
      }
    }

    // Which half of the picker is the live one. A condition and a value list are
    // two answers to the same question, so exactly one of them is on screen.
    renderCondition() {
      const elements = this.elements;
      if (!elements) {
        return;
      }

      const listed = this.operator === "Equals";
      const count = elements.argumentCounts[this.operator] ?? 1;

      elements.operator.value = this.operator;
      elements.toolbar.hidden = !listed;

      const dates = this.comparesDates();

      elements.argumentInputs.forEach((input, index) => {
        const current = this.arguments[index] ?? "";
        // A date control cannot hold anything but an ISO date, so switching to
        // one would silently erase an argument the reader had already typed.
        // What is already there outranks what the field usually holds.
        const type = dates && (current === "" || ISO_DATE.test(current)) ? "date" : "text";

        input.hidden = listed || index >= count;
        input.setAttribute("type", type);
        input.value = current;
        input.setAttribute("placeholder", count > 1
          ? (index === 0 ? this.labels.argumentFrom : this.labels.argumentTo)
          : this.labels.argument);
      });

      if (!listed) {
        elements.summary.textContent = "";
        elements.list.hidden = true;
        // Enabled as soon as the condition has what it needs, which is exactly
        // the engine's own rule for when a condition restricts anything.
        elements.apply.disabled = this.conditionValues().length < count;
      }
    }

    // Whether this field's values are ones the engine will compare as dates, read
    // off the values themselves rather than declared. That is not a shortcut: the
    // engine decides the same way, so agreeing with the data is agreeing with it.
    // It also settles the grouped levels for free -- a month level reads "Haziran"
    // and a year level reads "2024", and neither is a date to either side.
    comparesDates() {
      if (!COMPARISON_OPERATORS.includes(this.operator)) {
        return false;
      }

      const sample = this.values.find(value => String(value ?? "").trim() !== "");
      return sample !== undefined &&
        PivotForge.PivotRequestBuilder.comparisonType(sample) === "date";
    }

    // The arguments a condition applies with, trimmed and cut to what its
    // operator reads. Blank takes none, which is how it applies with none.
    conditionValues() {
      const count = (this.elements?.argumentCounts ?? {})[this.operator] ?? 1;

      return this.arguments
        .slice(0, count)
        .map(value => String(value ?? "").trim())
        .filter(value => value.length > 0);
    }

    renderMode() {
      this.elements?.modeButtons.forEach(button => {
        const active = button.dataset.mode === this.mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    apply() {
      if (this.operator !== "Equals") {
        const values = this.conditionValues();
        const callback = this.onApply;
        const mode = this.mode;
        const operator = this.operator;
        this.close();
        callback(values, mode, operator);
        return;
      }

      // Include stores the checked values, Exclude the unchecked ones, so the
      // two describe the same visible rows and differ only over values that are
      // not in the source yet.
      const listed = this.values.filter(value =>
        this.selected.has(value) === (this.mode !== "Exclude"));
      // Every value checked means no restriction at all, which is stored as an
      // empty list. Freezing the full set under Include instead would silently
      // exclude values that appear in the source later. Under Exclude the same
      // case already produces an empty list on its own, so this rule does not
      // need to ask which mode it is in.
      const everything =
        this.hiddenValues.length === 0 &&
        this.selected.size === this.values.length;
      const values = everything ? [] : [...this.hiddenValues, ...listed];

      const callback = this.onApply;
      const mode = this.mode;
      this.close();
      callback(values, mode, "Equals");
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
      this.watchAnchor(false);
      this.anchor = null;
      this.elements.overlay.classList.remove("is-open");
      this.elements.overlay.setAttribute("aria-hidden", "true");
    }

    // Where the dropdown goes: under the anchor, or above it when the space
    // below is short of a full dropdown and the space above is longer. Opened
    // above, it is pinned by its bottom edge, so a list that loads after it
    // opens grows away from the button instead of over it. Null means a modal
    // -- no anchor, a phone-sized screen, or a window too short either way.
    dropdownBox() {
      if (!this.anchor || !(root.matchMedia?.(DROPDOWN_MEDIA).matches ?? true)) {
        return null;
      }

      const rect = this.anchor.getBoundingClientRect();
      const viewportWidth = root.innerWidth;
      const viewportHeight = root.innerHeight;
      const below = viewportHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_MARGIN;
      const above = rect.top - DROPDOWN_GAP - VIEWPORT_MARGIN;

      if (Math.max(below, above) < DROPDOWN_MIN_HEIGHT) {
        return null;
      }

      const flip = below < DROPDOWN_HEIGHT && above > below;
      const width = Math.min(DROPDOWN_WIDTH, viewportWidth - 2 * VIEWPORT_MARGIN);
      // Aligned to the button's left edge, pushed back in where that would run
      // past the right edge -- the designer's funnels sit near it.
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left, viewportWidth - width - VIEWPORT_MARGIN));

      return {
        top: flip ? null : rect.bottom + DROPDOWN_GAP,
        bottom: flip ? viewportHeight - rect.top + DROPDOWN_GAP : null,
        left,
        width,
        maxHeight: flip ? above : below
      };
    }

    place() {
      if (!this.elements || !this.isOpen) {
        return;
      }

      const { overlay, dialog } = this.elements;
      const box = this.dropdownBox();

      overlay.classList.toggle("is-anchored", box !== null);
      // A dropdown leaves the page usable around it, so it does not claim to be
      // modal; a click outside it still closes it, as the backdrop's did.
      dialog.setAttribute("aria-modal", String(box === null));
      const px = value => (value === null || value === undefined ? "" : `${Math.round(value)}px`);
      dialog.style.top = px(box?.top);
      dialog.style.bottom = px(box?.bottom);
      dialog.style.left = px(box?.left);
      dialog.style.width = px(box?.width);
      dialog.style.maxHeight = px(box?.maxHeight);
    }

    // Scrolling the table or the page moves the button, and a resize can cross
    // the phone breakpoint, so either one places the dialog again. Capture
    // catches the scroll of any container the button sits in.
    watchAnchor(on) {
      if (on === this.watching) {
        return;
      }

      const method = on ? "addEventListener" : "removeEventListener";
      root[method]?.("scroll", this.reposition, true);
      root[method]?.("resize", this.reposition);
      this.watching = on;
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.isOpen = false;
      this.watchAnchor(false);
      this.anchor = null;

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
