(function (root) {
  const PivotForge = root.PivotForge ??= {};

  // Search text compared without case, accents or the dotted/dotless i:
  // "isk" finds "İskonto", "satis" finds "Satış", "it" finds "Item". Lowered
  // the Turkish way, so I and İ both reach i once the marks are gone.
  const foldSearch = text => String(text ?? "").toLocaleLowerCase("tr")
    .normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

  const AGGREGATIONS = ["sum", "count", "average", "min", "max", "countDistinct", "median", "variance", "standardDeviation", "variancePopulation", "standardDeviationPopulation", "first", "last"];

  const DEFAULT_LABELS = {
    available: "Fields",
    // The list's heading when it shows every field, placed or not.
    allFields: "All fields",
    // {0} is the field's caption; read out on its checkbox.
    placeField: "Show {0}",
    row: "Rows",
    column: "Columns",
    data: "Values",
    filter: "Filters",
    remove: "Remove",
    search: "Search fields...",
    // {0} is the folder's name; read out on its open/close button.
    folderToggle: "Folder {0}",
    format: "Format",
    settings: "Field settings",
    filterValues: "Filter values",
    // Excel's wording for holding edits back until the reader asks for them.
    deferUpdate: "Defer layout update",
    valuesChip: "\u03a3 Values",
    update: "Update",
    // {0} is replaced with the number of listed values.
    filterCount: "({0})",
    // The same count means the opposite thing under an excluding filter, so it
    // cannot share the label.
    filterCountExcluded: "({0} excluded)",
    // A condition names itself instead of counting, so {0} is the operator.
    filterCondition: "({0})",
    filterConditionExcluded: "(not {0})",
    operators: {
      Equals: "equals",
      Contains: "contains",
      StartsWith: "starts with",
      EndsWith: "ends with",
      Between: "between",
      GreaterThan: "greater than",
      LessThan: "less than",
      Blank: "blank"
    },
    aggregation: "Value settings",
    showAs: "Show values as",
    formatting: "Formatting",
    formatDecimals: "Decimal places",
    fieldName: "Field name",
    rename: "Rename",
    resetName: "Reset",
    position: "Position",
    sortOrder: "Sort order",
    sortAscending: "Ascending",
    sortDescending: "Descending",
    sortBy: "Sort by",
    sortByLabel: "Its own labels",
    valueFilter: "Value filter",
    valueFilterOperators: {
      GreaterThan: "Greater than",
      GreaterThanOrEqual: "At least",
      LessThan: "Less than",
      LessThanOrEqual: "At most",
      Equal: "Equal to",
      NotEqual: "Not equal to",
      Between: "Between",
      NotBetween: "Not between"
    },
    valueFilterValue: "Value",
    valueFilterValue2: "and",
    valueFilterApply: "Apply",
    valueFilterClear: "Remove value filter",
    groupSize: "Range width",
    groupSizeApply: "Apply",
    groupSizeReset: "Reset to {0}",
    groupSizeTaken: "This field already has a level of ranges {0} wide.",
    moveUp: "Move up",
    moveDown: "Move down",
    removeField: "Remove field",
    close: "Close",
    runningTotal: "Running total",
    runningTotalLabels: {
      none: "None",
      row: "Along rows",
      column: "Down columns"
    },
    showAsLabels: {
      normal: "Normal",
      percentOfRowTotal: "% of row total",
      percentOfColumnTotal: "% of column total",
      percentOfGrandTotal: "% of grand total",
      differenceFromPrevious: "Difference from previous",
      percentDifferenceFromPrevious: "% difference from previous",
      runningTotal: "Running total",
      percentOfParentRowTotal: "% of parent row total",
      percentOfParentColumnTotal: "% of parent column total"
    },
    formatGrouping: "Thousands separator",
    formatCompact: "Short numbers (1.2M)",
    formatParentheses: "Negatives in parentheses",
    formatTypes: {
      number: "Number",
      currency: "Currency",
      percent: "Percent"
    },
    lastValue: "A pivot requires at least one value field.",
    aggregations: {
      sum: "Sum",
      count: "Count",
      average: "Average",
      min: "Minimum",
      max: "Maximum",
      countDistinct: "Distinct count",
      median: "Median",
      variance: "Variance",
      standardDeviation: "Standard deviation",
      variancePopulation: "Variance (population)",
      standardDeviationPopulation: "Standard deviation (population)",
      first: "First value",
      last: "Last value"
    },
    calculatedField: "Calculated field",
    addCalculatedField: "Add calculated field",
    formula: "Formula",
    formulaHint: "Use + - * / and parentheses. [Field] is the field's sum; Sum, Count, Avg, Min, Max, CountDistinct, Median, Var and StDev summarize it another way. Example: [Revenue] - [Cost]",
    insertField: "Insert field",
    save: "Save",
    cancel: "Cancel",
    editFormula: "Edit formula",
    deleteCalculatedField: "Delete calculated field",
    // {0} is the part of the formula the problem is about: a character, a word
    // or a field name, depending on the code.
    formulaErrors: {
      noName: "Give the field a name.",
      empty: "Write a formula.",
      end: "The formula is incomplete.",
      unexpected: "'{0}' is not expected here.",
      bareWord: "Write field names in brackets: [{0}].",
      unclosed: "A field name is missing its closing ].",
      emptyReference: "[] names no field.",
      number: "'{0}' is not a number.",
      argument: "{0}() takes a field in brackets, such as {0}([Amount]).",
      sliceField: "{0}() takes a field in brackets after the formula, such as {0}([Amount], [Year], -1).",
      sliceOffset: "{0}() moves a whole number of members, such as {0}([Amount], [Year], -1).",
      expected: "'{0}' is missing.",
      unknownField: "There is no field called [{0}]."
    },
    // The builder that puts a formula together from buttons, for readers who
    // should not have to learn the typed syntax.
    formulaBuilder: {
      pickField: "1. Pick a field",
      pickOperator: "2. Pick an operation",
      dropHere: "Drag a field here, or tap one below.",
      nextValue: "Next: add a field or a number.",
      nextOperator: "Next: pick an operation, or save.",
      operators: {
        "+": "Add",
        "-": "Subtract",
        "*": "Multiply",
        "/": "Divide",
        "(": "Open bracket",
        ")": "Close bracket"
      },
      number: "Number",
      addNumber: "Add number",
      invalidNumber: "'{0}' is not a number.",
      undo: "Undo",
      clear: "Clear",
      removeToken: "Remove",
      // {0} is the field's caption.
      summaryOf: "How to summarize {0}",
      typeFormula: "Type the formula instead",
      useButtons: "Build with buttons",
      cannotShow: "This formula cannot be shown as buttons; keep editing it as text."
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
    "runningTotal",
    "percentOfParentRowTotal",
    "percentOfParentColumnTotal"
  ];
  const FORMAT_TYPES = ["number", "currency", "percent"];
  const DECIMAL_CHOICES = [0, 1, 2, 3, 4, 5, 6];
  // What the renderer applies when a member is absent, so the panel opens
  // showing what the user is actually looking at rather than empty controls.
  const RENDERER_DEFAULTS = { type: "number", decimals: 2, useGrouping: true };
  // How far a press has to travel before it counts as a drag rather than a
  // click. Below this the chip's own controls keep working normally.
  const DRAG_THRESHOLD = 5;

  // The chip standing for every value at once -- Excel's Σ Values. It is not a
  // field: it sits at the end of the Rows or Columns zone, only while there are
  // two or more values to place, and moving it changes which axis they are
  // drawn along. Named so no source column plausibly collides with it.
  const VALUES_CHIP = "__pivotforge_values__";

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

  // The builder's operations, with the sign a reader knows from school rather
  // than the one a keyboard has.
  const FORMULA_OPERATORS = [
    { value: "+", symbol: "+" },
    { value: "-", symbol: "−" },
    { value: "*", symbol: "×" },
    { value: "/", symbol: "÷" },
    { value: "(", symbol: "(" },
    { value: ")", symbol: ")" }
  ];
  // How a field in the builder is summarized, named by the aggregations the
  // designer already has words for, and written as the formula's functions.
  const FORMULA_SUMMARIES = ["sum", "average", "count", "min", "max", "countDistinct", "median", "variance", "standardDeviation", "variancePopulation", "standardDeviationPopulation", "first", "last"];
  const SUMMARY_FUNCTIONS = {
    sum: "Sum", average: "Avg", count: "Count", min: "Min", max: "Max",
    countDistinct: "CountDistinct", median: "Median", variance: "Var", standardDeviation: "StDev",
    variancePopulation: "VarP", standardDeviationPopulation: "StDevP", first: "First", last: "Last"
  };
  const FUNCTION_SUMMARIES = {
    sum: "sum", avg: "average", average: "average", count: "count", min: "min", max: "max",
    countdistinct: "countDistinct", median: "median",
    var: "variance", variance: "variance", stdev: "standardDeviation", stddev: "standardDeviation",
    varp: "variancePopulation", stdevp: "standardDeviationPopulation", first: "first", last: "last"
  };

  function operatorToken(value) {
    if (value === "(") return { kind: "open" };
    if (value === ")") return { kind: "close" };
    return { kind: "op", value };
  }

  function operatorValue(token) {
    if (token.kind === "open") return "(";
    if (token.kind === "close") return ")";
    return token.value;
  }

  // The builder's pieces as the formula the server reads.
  function formulaText(tokens) {
    return tokens.map(token => {
      if (token.kind === "field") {
        return token.fn === "sum" ? `[${token.dataField}]` : `${SUMMARY_FUNCTIONS[token.fn]}([${token.dataField}])`;
      }
      return token.kind === "number" ? token.value : operatorValue(token);
    }).join(" ");
  }

  // A typed formula as the builder's pieces, or null when it holds something
  // the pieces cannot show -- a custom function, a stray character -- and so
  // has to stay text. Whether the pieces make sense is the parser's call, on
  // Save, not this one's.
  function formulaTokens(text) {
    const pattern = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\[([^\]]*)\]\s*\)|\[([^\]]*)\]|(\d+(?:\.\d+)?|\.\d+)|([-+*/()]))\s*/y;
    const tokens = [];
    const source = String(text ?? "");
    pattern.lastIndex = 0;

    while (pattern.lastIndex < source.length) {
      const match = pattern.exec(source);
      if (!match) {
        return source.slice(pattern.lastIndex).trim() === "" ? tokens : null;
      }

      const [, fn, fnField, field, number, operator] = match;
      if (fn !== undefined) {
        const summary = FUNCTION_SUMMARIES[fn.toLowerCase()];
        if (!summary || !fnField.trim()) return null;
        tokens.push({ kind: "field", dataField: fnField.trim(), fn: summary });
      } else if (field !== undefined) {
        if (!field.trim()) return null;
        tokens.push({ kind: "field", dataField: field.trim(), fn: "sum" });
      } else if (number !== undefined) {
        tokens.push({ kind: "number", value: number });
      } else if (operator !== undefined) {
        tokens.push(operatorToken(operator));
      }
    }

    return tokens;
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
      // The hook the stylesheet sizes the panel by: the zones adapt to the width
      // the host was given, not to the viewport, because the same designer sits
      // in a 330px sidebar on a desktop and full width on a phone.
      this.host.classList.add("pivot-field-designer");
      this.state = options.state;
      this.widget = options.widget;
      this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
      // One level deeper, so a locale that predates the builder, or words only
      // part of it, still gets a whole set of its words.
      this.labels.formulaBuilder = {
        ...DEFAULT_LABELS.formulaBuilder,
        ...(options.labels?.formulaBuilder ?? {}),
        operators: {
          ...DEFAULT_LABELS.formulaBuilder.operators,
          ...(options.labels?.formulaBuilder?.operators ?? {})
        }
      };
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
      // The field-list folders the reader closed, by name. Like the search term
      // it is a view of the list, so it outlives every re-render.
      this.collapsedFolders = new Set();
      // Which data field the settings modal is showing, or null. The modal
      // lives outside the host, so it survives the re-render every edit
      // triggers and does not need to be rebuilt by render().
      this.settingsFor = null;
      this.settings = null;
      // The calculated field the formula editor is open for: a name, "" while a
      // new one is being defined, or null when the editor is closed. It shares
      // the settings overlay, so only one of the two is ever showing.
      this.formulaFor = null;
      this.formulaEditor = null;
      this.formulaDrag = null;
      // Off unless asked for, so a designer built by hand looks as it always
      // did; the widget asks for it by default.
      this.allowCalculatedFields = options.allowCalculatedFields === true;
      // Built on first use, so a designer whose filter zone is never opened
      // never creates the picker's overlay. A host may supply its own.
      this.filterPicker = options.filterPicker ?? null;
      // Excel's "Defer layout update": null keeps the box off the panel and
      // every edit applied at once, as before the option existed; true or
      // false shows the box, ticked or not. While it is ticked an edit only
      // changes the panel, and what it would have sent is merged into
      // pendingUpdate until Update is pressed or the box is cleared.
      this.deferUpdates = typeof options.deferUpdates === "boolean" ? options.deferUpdates : null;
      // A host that applies the held-back edits itself -- the field chooser's
      // OK button -- keeps the box off the panel.
      this.showDeferBox = options.showDeferBox !== false;
      this.pendingUpdate = null;
      // DevExtreme's field chooser layouts: 0 puts the field list beside the
      // rows and columns with filters and values below, 1 stacks the four
      // zones beside the list, 2 puts the list across the top. Left out, the
      // panel keeps its own arrangement.
      this.layout = [0, 1, 2].includes(options.layout) ? options.layout : null;
      [0, 1, 2].forEach(layout => this.host.classList.toggle(`is-layout-${layout}`, this.layout === layout));
      // The field chooser's "All fields": every field listed, placed or not,
      // each with a checkbox that places or removes it.
      this.allFields = options.allFields === true;
      this.host.classList.toggle("is-all-fields", this.allFields);
      this.render();
    }

    // Every edit that would refresh the grid goes through here. Merged rather
    // than queued: each payload is the designer's whole request state, so the
    // newest one carries every earlier edit, and a sort reset one of them
    // asked for (rowSort: null) survives a later edit that did not ask again.
    async push(update) {
      if (this.deferUpdates === true) {
        this.pendingUpdate = { ...(this.pendingUpdate ?? {}), ...update };
        this.renderFooter();
        return;
      }

      await this.widget.update(update);
    }

    async applyPending() {
      const pending = this.pendingUpdate;
      this.pendingUpdate = null;
      this.renderFooter();

      if (pending) {
        await this.widget.update(pending);
      }
    }

    // Clearing the box applies what it held back, as it does in Excel: the
    // reader asked for edits to take effect, and these are edits.
    async setDeferUpdates(defer) {
      this.deferUpdates = Boolean(defer);
      if (!this.deferUpdates) {
        await this.applyPending();
      } else {
        this.renderFooter();
      }
    }

    createFooter() {
      const document = root.document;
      const footer = document.createElement("div");
      footer.className = "pivot-designer-footer";

      const label = document.createElement("label");
      label.className = "pivot-designer-footer__defer";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.action = "defer-update";
      box.addEventListener("change", () => this.setDeferUpdates(box.checked));
      const text = document.createElement("span");
      text.textContent = this.labels.deferUpdate;
      label.appendChild(box);
      label.appendChild(text);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "pivot-designer-footer__update";
      button.dataset.action = "apply-update";
      button.textContent = this.labels.update;
      button.addEventListener("click", () => this.applyPending());

      this.footerBox = box;
      this.footerButton = button;
      this.renderFooter();
      footer.appendChild(label);
      footer.appendChild(button);
      return footer;
    }

    // Updated in place, so holding an edit back does not rebuild the chips
    // the reader is in the middle of arranging.
    renderFooter() {
      if (!this.footerButton) {
        return;
      }

      this.footerBox.checked = this.deferUpdates === true;
      this.footerButton.disabled = !this.pendingUpdate;
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

      // A field's own menu, DevExtreme's onContextMenuPreparing on a field
      // button: nothing by default, whatever the page adds.
      chip.addEventListener("contextmenu", event => this.openFieldMenu(event, name, chip));

      // In the "All fields" list a checkbox says whether the field is placed,
      // and placing or removing it is one click.
      if (area === "available" && this.allFields) {
        chip.dataset.listed = "true";
        chip.appendChild(this.createPlaceCheckbox(name, field));
      }

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
      if (area === "filter" && this.canPickFilterValues() && this.state.field(name).allowFiltering !== false) {
        const funnel = document.createElement("button");
        funnel.className = "pivot-chip__filter";
        funnel.dataset.action = "filter";
        funnel.tabIndex = -1;
        funnel.textContent = "▼";
        funnel.setAttribute("aria-label", `${field.caption} — ${this.labels.filterValues}`);
        funnel.addEventListener("click", () => this.openFilterPicker(name, funnel));
        chip.appendChild(funnel);
      }

      // A calculated field reads like any other once placed, so the chip is what
      // says it is computed rather than read from the source.
      if (this.state.isCalculated?.(name)) {
        chip.classList.add("is-calculated");
        const badge = document.createElement("span");
        badge.className = "pivot-chip__badge";
        badge.textContent = "ƒx";
        badge.title = this.labels.calculatedField;
        badge.setAttribute("aria-hidden", "true");
        chip.appendChild(badge);
      }

      const label = document.createElement("span");
      label.className = "pivot-chip__label";
      label.textContent = field.caption;
      chip.appendChild(label);

      // A filter whose zone shows only the field name gives no clue that it is
      // restricting anything, so an active one carries its selection count -- or,
      // where a count would mean nothing, the name of the condition it applies.
      const filter = area === "filter" ? this.filterEntryOf(name) : null;
      if (filter && PivotForge.PivotRequestBuilder.restricts(filter)) {
        const count = document.createElement("span");
        count.className = "pivot-chip__filter-count";
        count.classList.toggle("is-excluding", filter.mode === "Exclude");
        count.textContent = this.filterChipText(filter);
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

    // --- All fields ---------------------------------------------------------

    isMeasure(name) {
      return this.state.field(name).role === "measure";
    }

    // The last value cannot leave: a pivot needs one.
    isLastValue(name) {
      return this.state.areaOf(name) === "data" && this.state.getState().values.length === 1;
    }

    createPlaceCheckbox(name, field) {
      const box = root.document.createElement("input");
      box.type = "checkbox";
      box.className = "pivot-chip__place";
      box.dataset.action = "place";
      box.tabIndex = -1;
      box.checked = this.state.areaOf(name) !== "available";
      box.disabled = this.isLastValue(name);
      box.setAttribute("aria-label", format(this.labels.placeField, field.caption));
      // The chip under it starts a drag on a press; a click on the box is not one.
      box.addEventListener("pointerdown", event => event.stopPropagation());
      box.addEventListener("change", () => {
        // The redraw replaces the box; focus comes back to the field's chip.
        this.focusField = name;
        this.placeFields([name], box.checked);
      });
      return box;
    }

    // A folder's checkbox: places its first field when none is placed, as
    // DevExtreme does, and removes every one of them otherwise.
    withFolderCheckbox(heading, names) {
      const row = root.document.createElement("div");
      row.className = "pivot-field-folder-row";
      const placed = names.filter(name => this.state.areaOf(name) !== "available");
      const box = root.document.createElement("input");
      box.type = "checkbox";
      box.className = "pivot-chip__place";
      box.dataset.action = "place-folder";
      box.tabIndex = -1;
      box.checked = placed.length > 0;
      box.indeterminate = placed.length > 0 && placed.length < names.length;
      box.setAttribute("aria-label", format(this.labels.placeField, heading.dataset.folder));
      // Read again at the click: the layout may have changed since the draw.
      box.addEventListener("change", () => {
        const placedNow = names.filter(name => this.state.areaOf(name) !== "available");
        this.placeFields(placedNow.length > 0 ? placedNow : names.slice(0, 1), placedNow.length === 0);
      });
      row.appendChild(box);
      row.appendChild(heading);
      return row;
    }

    // A measure goes to the values, anything else to the columns, as the
    // DevExtreme field chooser places a checked field. The last value stays.
    placeFields(names, place) {
      return this.apply(() => {
        names.forEach(name => {
          if (!place) {
            if (!this.isLastValue(name)) {
              this.state.remove(name);
            }
            return;
          }

          if (this.state.areaOf(name) === "available") {
            this.state.move(name, this.isMeasure(name) ? "data" : "column");
          }
        });
      });
    }

    // --- Field menu ---------------------------------------------------------

    openFieldMenu(event, name, chip) {
      const prepare = this.widget.prepareFieldMenu;
      if (typeof prepare !== "function") {
        return;
      }

      const area = this.state.areaOf(name);
      const items = prepare.call(this.widget, { field: this.state.field(name), area, event, items: [] });
      if (!Array.isArray(items) || items.length === 0) {
        return;
      }

      event.preventDefault();
      this.closeFieldMenu();
      const menu = root.document.createElement("div");
      menu.className = "pivot-cell-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", this.state.field(name).caption);
      items.forEach(item => {
        const button = root.document.createElement("button");
        button.type = "button";
        button.className = "pivot-cell-menu__item";
        button.setAttribute("role", "menuitem");
        button.textContent = String(item?.label ?? item?.text ?? "");
        button.disabled = item?.disabled === true;
        button.addEventListener("click", () => {
          this.closeFieldMenu();
          item?.onClick?.({ field: this.state.field(name), area, item });
        });
        menu.appendChild(button);
      });
      menu.addEventListener("keydown", keyEvent => {
        if (keyEvent.key === "Escape") {
          this.closeFieldMenu();
          chip.focus?.();
        }
      });
      PivotForge.matchDirection?.(menu, chip);
      root.document.body.appendChild(menu);
      menu.style.left = `${Math.max(8, event.clientX ?? 0)}px`;
      menu.style.top = `${Math.max(8, event.clientY ?? 0)}px`;
      this.fieldMenu = menu;
      this.fieldMenuDismiss = dismiss => {
        if (!menu.contains(dismiss.target)) {
          this.closeFieldMenu();
        }
      };
      root.document.addEventListener("pointerdown", this.fieldMenuDismiss, true);
      menu.querySelector?.("button:not(:disabled)")?.focus?.();
    }

    closeFieldMenu() {
      this.fieldMenu?.remove?.();
      this.fieldMenu = null;
      if (this.fieldMenuDismiss) {
        root.document.removeEventListener("pointerdown", this.fieldMenuDismiss, true);
        this.fieldMenuDismiss = null;
      }
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

      if (this.canDropChip(name, target.area)) {
        const dropAt = this.dropIndex(target.body, event.clientY);
        this.apply(() => this.moveChip(name, target.area, dropAt));
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
      if (!this.canDropChip(name, target.area)) {
        target.zone.classList.add("is-drop-refused");
        return;
      }

      // The Σ chip always lands at the end of its zone, so there is no slot to
      // point at -- the zone is the target.
      if (name === VALUES_CHIP) {
        target.zone.classList.add("is-empty-drop-target");
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

      // In the "All fields" list Enter ticks or clears the checkbox, which is
      // kept out of the tab sequence like every other chip control.
      if (!this.grab && event.key === "Enter" && chip.dataset.listed === "true") {
        event.preventDefault?.();
        if (!this.isLastValue(name)) {
          this.focusField = name;
          this.placeFields([name], this.state.areaOf(name) === "available");
        }
        return;
      }

      // The menu key opens the field's own menu, as a right click does.
      if (!this.grab && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
        const rect = chip.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        this.openFieldMenu(
          { preventDefault: () => event.preventDefault?.(), clientX: rect.left + 12, clientY: rect.top + 12, key: event.key },
          name,
          chip);
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
          if (name === VALUES_CHIP || this.state.areaOf(name) === "available") {
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
        // The zones mirror in RTL, so the horizontal keys trade places there.
        case "ArrowLeft": return this.shiftGrabArea(PivotForge.isRtl?.(this.host) ? 1 : -1);
        case "ArrowRight": return this.shiftGrabArea(PivotForge.isRtl?.(this.host) ? -1 : 1);
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
      const area = this.areaOfChip(name);
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
      const last = grab.area === this.areaOfChip(grab.name) ? names.length - 1 : names.length;
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
      grab.index = next === this.areaOfChip(grab.name)
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
        : this.canDropChip(grab.name, grab.area);
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

      if (grab.area === "available" || grab.name === VALUES_CHIP || target.body.children.length === 0) {
        target.zone.classList.add("is-empty-drop-target");
        return;
      }

      this.markDropSlot(target.body, this.markerIndex(grab));
    }

    // markDropSlot draws against the zone as it looks now, which still holds
    // the grabbed chip when the move stays inside its own zone -- so a slot
    // past that chip is one further along on screen than it is in the result.
    markerIndex(grab) {
      const from = grab.area === this.areaOfChip(grab.name)
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

      if (grab.area !== this.areaOfChip(grab.name)) {
        this.apply(() => this.moveChip(grab.name, grab.area, grab.index));
        return;
      }

      // The Σ chip has one place in a zone, so it cannot be reordered there.
      if (grab.name === VALUES_CHIP) {
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
      const body = this.zones.get(this.areaOfChip(name))?.body;
      if (!body) {
        return false;
      }

      const chips = this.chipsIn(body);
      const next = chips[chips.findIndex(chip => chip.dataset.field === name) + step];
      next?.focus?.();
      return Boolean(next);
    }

    // Roving tabindex: one tab stop per zone, on the chip the user last focused
    // there. Making every chip tabbable would bury the rest of the page behind
    // a tab stop per field.
    refreshTabStops() {
      this.zones.forEach(({ body }) => {
        const chips = this.chipsIn(body);
        const stop = chips.find(chip => chip.dataset.field === this.focusField) ?? chips[0];
        chips.forEach(chip => { chip.tabIndex = chip === stop ? 0 : -1; });
      });
    }

    // A zone's chips. The field list also holds folder headings, which are
    // buttons of their own rather than fields to step through.
    chipsIn(body) {
      return Array.from(body.children).filter(child => child.dataset?.field !== undefined);
    }

    canPickFilterValues() {
      return typeof this.widget.fieldValues === "function" &&
        (this.filterPicker !== null || typeof PivotForge.PivotFilterPicker === "function");
    }

    // A chip in the Filters zone always has an entry. A field filtered from its
    // row header does not until the first apply, and an absent entry is exactly
    // the unrestricted filter the picker should open with.
    // A list of values counts; a condition does not -- "(2)" beside a field
    // filtered by "contains" would name its two typed characters.
    filterChipText(filter) {
      if ((filter.operator ?? "Equals") !== "Equals") {
        const name = this.labels.operators[filter.operator] ?? filter.operator;
        return format(
          filter.mode === "Exclude" ? this.labels.filterConditionExcluded : this.labels.filterCondition,
          name);
      }

      return format(
        filter.mode === "Exclude" ? this.labels.filterCountExcluded : this.labels.filterCount,
        filter.values.length);
    }

    filterEntryOf(name) {
      return this.state.getState().filters.find(filter => filter.field === name)
        ?? { field: name, values: [], mode: "Include" };
    }

    // `anchor` is the element the picker drops down under on a wide screen;
    // without one it opens as a modal.
    openFilterPicker(name, anchor = null) {
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
        operator: filter.operator ?? "Equals",
        anchor,
        // One apply(), so a picker that changed all three produces a single
        // refresh. The operator leads, because it decides what the values mean.
        onApply: (values, mode, operator) => this.apply(() => {
          this.state.setFilterOperator(name, operator ?? "Equals");
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
        if (event.key === "Escape" && (this.settingsFor || this.formulaFor !== null)) {
          this.closeSettings();
        }
      };
      root.document.addEventListener("keydown", this.settingsKeydown);

      PivotForge.matchDirection?.(overlay, this.host);
      (root.document.body ?? this.host).appendChild(overlay);
      this.settings = { overlay, dialog, title, body };
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

    // Sorting is the widget's to allow, and then the field's.
    canSort(name) {
      return this.widget?.options?.allowSorting !== false &&
        this.state.field(name).allowSorting !== false &&
        typeof this.state.setSort === "function";
    }

    // Direction, and what the level is ordered by: its own labels, or one of
    // the values on the grid -- "regions by sales, highest first". Each pick
    // sends both, so the two can never disagree.
    appendSortSections(body, name, area) {
      const field = this.state.field(name);
      const valueKeys = this.state.valueKeys();
      const values = this.state.getState().values;
      // A row level with no declared order runs A to Z; a column level keeps
      // the order its data came in, so neither direction is shown as current.
      const order = field.sortOrder ?? (area === "row" ? "Ascending" : null);
      const by = valueKeys.includes(field.sortByValueKey) ? field.sortByValueKey : null;
      const pick = next => this.applySort(name, area, {
        order: next.order ?? order ?? "Ascending",
        byValueKey: next.byValueKey === undefined ? by : next.byValueKey
      });

      const direction = this.settingsSection(this.labels.sortOrder);
      this.settingsChoices(
        direction,
        "sort-order",
        [
          { value: "Ascending", label: this.labels.sortAscending },
          { value: "Descending", label: this.labels.sortDescending }
        ],
        order,
        picked => pick({ order: picked }));
      body.appendChild(direction);

      const measure = this.settingsSection(this.labels.sortBy);
      this.settingsChoices(
        measure,
        "sort-by",
        [
          { value: "", label: this.labels.sortByLabel },
          ...values.map((value, index) => ({
            value: valueKeys[index],
            label: this.valueLabel(value)
          }))
        ],
        by ?? "",
        picked => pick({ byValueKey: picked === "" ? null : picked })
      ).classList.add("is-stacked");
      body.appendChild(measure);
    }

    // Filtering is the widget's to allow, and then the field's; a widget without
    // the value filter API is one built before it existed.
    canValueFilter(name) {
      return this.widget?.options?.allowFiltering !== false &&
        this.state.field(name).allowFiltering !== false &&
        typeof this.widget?.setValueFilter === "function";
    }

    // "Regions whose sales exceed 10,000": which value, how it is compared and
    // against what. Picks change a draft kept on the designer until Apply sends
    // it, so a half-typed bound never reaches the server.
    appendValueFilterSection(body, name) {
      const document = root.document;
      const { VALUE_FILTER_OPERATORS } = PivotForge.PivotRequestBuilder;
      const valueKeys = this.state.valueKeys();
      const values = this.state.getState().values;
      const active = (this.widget.valueFilters ?? []).find(filter => filter.field === name) ?? null;

      if (this.valueFilterDraft?.field !== name) {
        this.valueFilterDraft = {
          field: name,
          operator: active?.operator ?? "GreaterThan",
          value: active ? String(active.value) : "",
          value2: active?.value2 !== undefined ? String(active.value2) : "",
          valueKey: valueKeys.includes(active?.valueKey) ? active.valueKey : valueKeys[0] ?? null
        };
      }

      const draft = this.valueFilterDraft;
      const range = draft.operator === "Between" || draft.operator === "NotBetween";
      const section = this.settingsSection(this.labels.valueFilter);
      const redraw = () => this.renderSettings(name);

      // Only worth asking when there is more than one value to compare.
      if (valueKeys.length > 1) {
        this.settingsChoices(
          section,
          "value-filter-by",
          values.map((value, index) => ({ value: valueKeys[index], label: this.valueLabel(value) })),
          draft.valueKey,
          picked => { draft.valueKey = picked; redraw(); }
        ).classList.add("is-stacked");
      }

      this.settingsChoices(
        section,
        "value-filter-operator",
        VALUE_FILTER_OPERATORS.map(operator => ({ value: operator, label: this.labels.valueFilterOperators[operator] })),
        draft.operator,
        picked => { draft.operator = picked; redraw(); });

      const bounds = document.createElement("div");
      bounds.className = "pivot-value-settings__row";
      const bound = (action, member, label) => {
        const input = document.createElement("input");
        input.className = "pivot-value-settings__input";
        input.setAttribute("type", "number");
        input.setAttribute("aria-label", label);
        input.setAttribute("placeholder", label);
        input.dataset.action = action;
        input.value = draft[member];
        input.addEventListener("input", () => {
          draft[member] = input.value;
          apply.disabled = !complete();
        });
        bounds.appendChild(input);
      };
      const complete = () => draft.value.trim() !== "" && Number.isFinite(Number(draft.value)) &&
        (!range || (draft.value2.trim() !== "" && Number.isFinite(Number(draft.value2))));

      const apply = document.createElement("button");
      apply.className = "pivot-value-settings__choice";
      apply.setAttribute("type", "button");
      apply.dataset.action = "value-filter-apply";
      apply.textContent = this.labels.valueFilterApply;
      apply.addEventListener("click", async () => {
        if (!complete()) {
          return;
        }

        await this.widget.setValueFilter(name, {
          operator: draft.operator,
          value: Number(draft.value),
          ...(range ? { value2: Number(draft.value2) } : {}),
          ...(draft.valueKey ? { valueKey: draft.valueKey } : {})
        });
        this.valueFilterDraft = null;
        if (this.settingsFor === name) {
          redraw();
        }
      });

      bound("value-filter-value", "value", this.labels.valueFilterValue);
      if (range) {
        bound("value-filter-value2", "value2", this.labels.valueFilterValue2);
      }
      apply.disabled = !complete();
      bounds.appendChild(apply);
      section.appendChild(bounds);

      if (active) {
        const clear = document.createElement("button");
        clear.className = "pivot-value-settings__choice is-danger";
        clear.setAttribute("type", "button");
        clear.dataset.action = "value-filter-clear";
        clear.textContent = this.labels.valueFilterClear;
        clear.addEventListener("click", async () => {
          await this.widget.setValueFilter(name, null);
          this.valueFilterDraft = null;
          if (this.settingsFor === name) {
            redraw();
          }
        });
        section.appendChild(clear);
      }

      body.appendChild(section);
    }

    // Only a numeric range level has a width, and only a state that can rename
    // a level can change one.
    canChangeGroupSize(name) {
      return this.state.field(name).groupInterval === "range" &&
        typeof this.state.setGroupSize === "function";
    }

    // "Amount in ranges of 50,000": the width, typed and applied, and a way
    // back to the declared one. A typed width waits for Apply, so the grid is
    // not regrouped on every keystroke.
    appendGroupSizeSection(body, name) {
      const document = root.document;
      const current = this.state.field(name).groupSize;
      const declared = this.state.declaredGroupSize(name);
      const section = this.settingsSection(this.labels.groupSize);
      const row = document.createElement("div");
      row.className = "pivot-value-settings__row";

      const input = document.createElement("input");
      input.className = "pivot-value-settings__input";
      input.setAttribute("type", "number");
      input.setAttribute("min", "0");
      input.setAttribute("step", "any");
      input.setAttribute("aria-label", this.labels.groupSize);
      input.dataset.action = "group-size";
      input.value = String(current);

      const valid = () => input.value.trim() !== "" && Number.isFinite(Number(input.value)) && Number(input.value) > 0;
      const apply = document.createElement("button");
      apply.className = "pivot-value-settings__choice";
      apply.setAttribute("type", "button");
      apply.dataset.action = "group-size-apply";
      apply.textContent = this.labels.groupSizeApply;
      const sync = () => { apply.disabled = !valid() || Number(input.value) === current; };
      input.addEventListener("input", sync);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !apply.disabled) {
          event.preventDefault();
          apply.click();
        }
      });
      apply.addEventListener("click", () => {
        if (valid()) {
          this.applyGroupSize(name, Number(input.value));
        }
      });
      sync();
      row.appendChild(input);
      row.appendChild(apply);
      section.appendChild(row);

      if (this.groupSizeError?.field === name) {
        const error = document.createElement("p");
        error.className = "pivot-value-settings__error";
        error.setAttribute("role", "alert");
        error.textContent = this.groupSizeError.text;
        section.appendChild(error);
      }

      if (current !== declared) {
        const reset = document.createElement("button");
        reset.className = "pivot-value-settings__choice";
        reset.setAttribute("type", "button");
        reset.dataset.action = "group-size-reset";
        reset.textContent = format(this.labels.groupSizeReset, declared);
        reset.addEventListener("click", () => this.applyGroupSize(name, declared));
        section.appendChild(reset);
      }

      body.appendChild(section);
    }

    // The level comes back under a new name, which everything that held the
    // old one -- this modal, the focused chip, the widget's value filters --
    // follows.
    async applyGroupSize(name, size) {
      let renamed;
      try {
        renamed = this.state.setGroupSize(name, size);
      } catch {
        // The only width a valid number is refused for is one another level of
        // the same column already has.
        this.groupSizeError = { field: name, text: format(this.labels.groupSizeTaken, size) };
        this.renderSettings(name);
        return;
      }

      this.groupSizeError = null;
      if (renamed === name) {
        return;
      }

      if (this.settingsFor === name) {
        this.settingsFor = renamed;
      }
      if (this.focusField === name) {
        this.focusField = renamed;
      }
      this.widget.renameField?.(name, renamed);
      this.widget.saveState?.();
      this.render();
      await this.push(this.state.toRequestState());
    }

    // "Tutar (Sum)" -- the caption alone would not tell two summaries of one
    // field apart. A calculated value is its formula's result, so it has none.
    valueLabel(value) {
      const caption = this.state.field(value.field).caption;
      const aggregation = this.labels.aggregations?.[value.aggregation];
      return aggregation && value.aggregation !== PivotForge.PivotRequestBuilder?.CALCULATED
        ? `${caption} (${aggregation})`
        : caption;
    }

    // A header click's sort outranks a field's own, so a choice made here
    // takes that axis' header sort back; otherwise it would appear to do
    // nothing until the header sort was cleared some other way.
    async applySort(name, area, sort) {
      this.state.setSort(name, sort);
      this.render();
      await this.push({
        ...this.state.toRequestState(),
        ...(area === "row" ? { rowSort: null } : { columnSort: null })
      });
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
      settings.dialog?.classList.remove("is-formula");
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

      if (area !== "data" && this.canChangeGroupSize(name)) {
        this.appendGroupSizeSection(settings.body, name);
      }

      if ((area === "row" || area === "column") && this.canSort(name)) {
        this.appendSortSections(settings.body, name, area);
      }

      if (area === "row" && this.canValueFilter(name)) {
        this.appendValueFilterSection(settings.body, name);
      }

      // --- Filter values --------------------------------------------------
      // The chip's ▼ is out of the tab sequence, so this is the keyboard's way
      // in to the picker. Offered only where there are values to pick.
      if (area === "filter" && this.canPickFilterValues() && this.state.field(name).allowFiltering !== false) {
        const filtering = this.settingsSection(this.labels.filterValues);
        const open = document.createElement("button");
        open.className = "pivot-value-settings__choice";
        open.setAttribute("type", "button");
        open.dataset.action = "filter-values";
        open.textContent = this.labels.filterValues;
        open.addEventListener("click", () => {
          this.closeSettings();
          // Dropped down under the chip the settings belonged to, where the
          // funnel would have opened it.
          this.openFilterPicker(name, this.chipFor(name));
        });
        filtering.appendChild(open);
        settings.body.appendChild(filtering);
      }

      if (area === "data" && this.state.isCalculated?.(name)) {
        // --- Formula ------------------------------------------------------
        // In place of the aggregation: the formula is what summarizes this one.
        const formula = this.settingsSection(this.labels.formula);
        const text = document.createElement("code");
        text.className = "pivot-value-settings__formula";
        text.textContent = this.state.field(name).expression;
        formula.appendChild(text);

        // A declared formula is the page's, like any declared field; only the
        // reader's own can be changed or deleted.
        if (this.state.isUserCalculated?.(name)) {
          const row = document.createElement("div");
          row.className = "pivot-value-settings__row";

          const edit = document.createElement("button");
          edit.className = "pivot-value-settings__choice";
          edit.setAttribute("type", "button");
          edit.dataset.action = "edit-formula";
          edit.textContent = this.labels.editFormula;
          edit.addEventListener("click", () => this.openFormula(name));
          row.appendChild(edit);

          const drop = document.createElement("button");
          drop.className = "pivot-value-settings__choice is-danger";
          drop.setAttribute("type", "button");
          drop.dataset.action = "delete-calculated";
          drop.textContent = this.labels.deleteCalculatedField;
          if (this.canReturn(name)) {
            drop.addEventListener("click", () => {
              this.closeSettings();
              this.apply(() => this.state.deleteCalculatedField(name));
            });
          } else {
            drop.disabled = true;
            drop.title = this.labels.lastValue;
          }
          row.appendChild(drop);

          formula.appendChild(row);
        }

        settings.body.appendChild(formula);
      }

      if (area === "data" && !this.state.isCalculated?.(name)) {
        // --- Aggregation --------------------------------------------------
        const aggregation = this.settingsSection(this.labels.aggregation);
        this.settingsChoices(
          aggregation,
          "aggregation",
          AGGREGATIONS.map(entry => ({ value: entry, label: this.labels.aggregations[entry] })),
          value?.aggregation ?? "sum",
          picked => this.apply(() => this.state.setAggregation(name, picked)));
        settings.body.appendChild(aggregation);
      }

      if (area === "data") {
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

        // --- Running total -------------------------------------------------
        // Applied after the display mode, so "% of parent row total" down the
        // columns is a cumulative share.
        if (typeof this.state.setRunningTotal === "function") {
          const running = this.settingsSection(this.labels.runningTotal);
          this.settingsChoices(
            running,
            "running-total",
            [
              { value: "none", label: this.labels.runningTotalLabels.none },
              { value: "row", label: this.labels.runningTotalLabels.row },
              { value: "column", label: this.labels.runningTotalLabels.column }
            ],
            value?.runningTotal ?? "none",
            picked => this.apply(() => this.state.setRunningTotal(name, picked === "none" ? null : picked))
          );
          settings.body.appendChild(running);
        }

        // --- Formatting ---------------------------------------------------
        const formatting = this.settingsSection(this.labels.formatting);

        // On/off switches, each writing one format member.
        const toggle = (action, label, on, write) => {
          const button = document.createElement("button");
          button.className = "pivot-value-settings__choice";
          button.setAttribute("type", "button");
          button.dataset.action = action;
          button.dataset.selected = String(on);
          button.textContent = `${label}${on ? " ✓" : ""}`;
          button.addEventListener("click", write);
          formatting.appendChild(button);
        };

        toggle("format-grouping", this.labels.formatGrouping, format.useGrouping,
          () => this.setFormatMember(name, "useGrouping", !format.useGrouping));
        toggle("format-compact", this.labels.formatCompact, format.compact === true,
          () => this.setFormatMember(name, "compact", format.compact !== true));
        toggle("format-negative", this.labels.formatParentheses, format.negative === "parentheses",
          () => this.setFormatMember(name, "negative", format.negative === "parentheses" ? "minus" : "parentheses"));

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

    // The formula editor. Its first face is a builder: the reader taps (or
    // drags) a field, taps an operation, taps another field, and the formula
    // grows as a row of large pieces written in their own words -- nothing to
    // type, no brackets to spell, nothing to get wrong but the arithmetic. The
    // typed formula is still one button away for what the pieces cannot say
    // (a custom function), and a formula the pieces cannot show opens there.
    // Nothing reaches the state until Save, and a formula the state refuses
    // keeps the editor open with the reason under it.
    renderFormula(name) {
      const document = root.document;
      const settings = this.buildSettings();
      const existing = name ? this.state.field(name) : null;
      const words = this.labels.formulaBuilder;

      settings.title.textContent = existing
        ? `${existing.caption} — ${this.labels.formula}`
        : this.labels.addCalculatedField;
      settings.dialog?.classList.add("is-formula");
      settings.body.replaceChildren();

      const fields = this.state.formulaFields?.() ?? [];
      const captionOf = dataField =>
        fields.find(field => field.dataField.toLowerCase() === dataField.toLowerCase())?.caption ?? dataField;
      const initial = existing?.expression ?? "";
      const tokens = initial ? formulaTokens(initial) : [];
      const editor = {
        name,
        tokens: tokens ?? [],
        history: [],
        typing: tokens === null
      };
      this.formulaEditor = editor;

      let caption = null;
      if (!existing) {
        const naming = this.settingsSection(this.labels.fieldName);
        caption = document.createElement("input");
        caption.className = "pivot-value-settings__input";
        caption.dataset.action = "formula-caption";
        caption.setAttribute("type", "text");
        caption.setAttribute("aria-label", this.labels.fieldName);
        naming.appendChild(caption);
        settings.body.appendChild(naming);
      }

      // --- The formula so far ----------------------------------------------
      const formula = this.settingsSection(this.labels.formula);

      const strip = document.createElement("div");
      strip.className = "pivot-formula__strip";
      strip.dataset.role = "formula-strip";
      strip.setAttribute("role", "list");
      strip.setAttribute("aria-label", this.labels.formula);
      formula.appendChild(strip);

      const next = document.createElement("p");
      next.className = "pivot-formula__next";
      next.dataset.role = "formula-next";
      next.setAttribute("aria-live", "polite");
      formula.appendChild(next);

      const hintId = `${this.zoneHeadingId("formula")}-hint`;
      const input = document.createElement("textarea");
      input.className = "pivot-value-settings__input pivot-value-settings__formula-input";
      input.dataset.action = "formula";
      input.setAttribute("rows", "3");
      input.setAttribute("spellcheck", "false");
      input.setAttribute("aria-label", this.labels.formula);
      input.setAttribute("aria-describedby", hintId);
      input.value = initial;
      formula.appendChild(input);

      const hint = document.createElement("p");
      hint.className = "pivot-value-settings__hint";
      hint.id = hintId;
      hint.textContent = this.labels.formulaHint;
      formula.appendChild(hint);

      const error = document.createElement("div");
      error.className = "pivot-value-settings__error";
      error.dataset.role = "formula-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
      formula.appendChild(error);

      const tools = document.createElement("div");
      tools.className = "pivot-value-settings__row pivot-formula__tools";
      const tool = (action, label, onClick) => {
        const button = document.createElement("button");
        button.className = "pivot-value-settings__choice";
        button.setAttribute("type", "button");
        button.dataset.action = action;
        button.textContent = label;
        button.addEventListener("click", onClick);
        tools.appendChild(button);
        return button;
      };
      const undo = tool("formula-undo", words.undo, () => {
        if (editor.history.length > 0) {
          editor.tokens = editor.history.pop();
          refresh();
        }
      });
      const clear = tool("formula-clear", words.clear, () => change(() => []));
      const switcher = tool("formula-advanced", "", () => {
        if (editor.typing) {
          const parsed = formulaTokens(input.value);
          if (parsed === null) {
            showError(words.cannotShow);
            return;
          }
          editor.history.push(editor.tokens);
          editor.tokens = parsed;
          editor.typing = false;
        } else {
          input.value = formulaText(editor.tokens);
          editor.typing = true;
        }
        refresh();
        (editor.typing ? input : switcher).focus?.();
      });
      formula.appendChild(tools);
      settings.body.appendChild(formula);

      // --- 1. Pick a field ---------------------------------------------------
      // Only the measures: [Region] would sum text. A dimension can still be
      // counted in the typed formula, as Count([Region]).
      const picking = this.settingsSection(words.pickField);
      const palette = document.createElement("div");
      palette.className = "pivot-formula__palette";
      fields.filter(field => field.role === "measure").forEach(field => {
        const button = document.createElement("button");
        button.className = "pivot-formula__field";
        button.setAttribute("type", "button");
        button.dataset.action = "formula-field";
        button.dataset.value = field.dataField;
        button.textContent = field.caption;
        button.addEventListener("click", () => {
          if (Date.now() - (this.formulaDragEnded ?? 0) < 400) {
            return;
          }
          change(list => [...list, { kind: "field", dataField: field.dataField, fn: "sum" }]);
        });
        button.addEventListener("pointerdown", event => this.beginFormulaDrag(event, button, field, strip, change));
        palette.appendChild(button);
      });
      picking.appendChild(palette);
      settings.body.appendChild(picking);

      // --- 2. Pick an operation ----------------------------------------------
      const operating = this.settingsSection(words.pickOperator);
      const operators = document.createElement("div");
      operators.className = "pivot-formula__operators";
      FORMULA_OPERATORS.forEach(({ value, symbol }) => {
        const button = document.createElement("button");
        button.className = "pivot-formula__operator";
        button.setAttribute("type", "button");
        button.dataset.action = "formula-operator";
        button.dataset.value = value;
        const mark = document.createElement("span");
        mark.className = "pivot-formula__symbol";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = symbol;
        const word = document.createElement("span");
        word.textContent = words.operators[value];
        button.appendChild(mark);
        button.appendChild(word);
        button.setAttribute("aria-label", words.operators[value]);
        button.addEventListener("click", () => change(list => [...list, operatorToken(value)]));
        operators.appendChild(button);
      });
      operating.appendChild(operators);

      // A number for the formulas that need one: "× 100" for a percentage, a
      // tax rate. Typed in the reader's own habit, so a comma works as well.
      const numbering = document.createElement("div");
      numbering.className = "pivot-value-settings__row pivot-formula__number";
      const number = document.createElement("input");
      number.className = "pivot-value-settings__input";
      number.dataset.action = "formula-number-input";
      number.setAttribute("type", "text");
      number.setAttribute("inputmode", "decimal");
      number.setAttribute("aria-label", words.number);
      number.setAttribute("placeholder", words.number);
      const addNumber = document.createElement("button");
      addNumber.className = "pivot-value-settings__choice";
      addNumber.setAttribute("type", "button");
      addNumber.dataset.action = "formula-number";
      addNumber.textContent = words.addNumber;
      const pushNumber = () => {
        const text = String(number.value ?? "").trim().replace(",", ".");
        if (!/^(\d+(\.\d+)?|\.\d+)$/.test(text)) {
          showError(format(words.invalidNumber, number.value ?? ""));
          number.focus?.();
          return;
        }
        number.value = "";
        change(list => [...list, { kind: "number", value: text }]);
      };
      addNumber.addEventListener("click", pushNumber);
      number.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault?.();
          pushNumber();
        }
      });
      numbering.appendChild(number);
      numbering.appendChild(addNumber);
      operating.appendChild(numbering);
      settings.body.appendChild(operating);

      // --- Save ----------------------------------------------------------------
      const actions = document.createElement("div");
      actions.className = "pivot-value-settings__row pivot-formula__actions";

      const save = document.createElement("button");
      save.className = "pivot-value-settings__choice";
      save.setAttribute("type", "button");
      save.dataset.action = "formula-save";
      save.dataset.selected = "true";
      save.textContent = this.labels.save;
      save.addEventListener("click", () => this.saveFormula(name, caption, input, error));

      const cancel = document.createElement("button");
      cancel.className = "pivot-value-settings__choice";
      cancel.setAttribute("type", "button");
      cancel.dataset.action = "formula-cancel";
      cancel.textContent = this.labels.cancel;
      cancel.addEventListener("click", () => {
        if (name) {
          this.openSettings(name);
        } else {
          this.closeSettings();
        }
      });

      actions.appendChild(save);
      actions.appendChild(cancel);
      settings.body.appendChild(actions);

      function showError(message) {
        error.textContent = message;
        error.hidden = false;
      }

      // Every edit goes through here, so each one can be undone and the strip
      // never disagrees with what Save would send.
      const change = (edit, at) => {
        editor.history.push(editor.tokens);
        editor.tokens = edit(editor.tokens, at);
        refresh();
      };

      const refresh = () => {
        error.hidden = true;
        input.removeAttribute?.("aria-invalid");
        this.renderFormulaStrip(strip, editor, captionOf, change);

        const last = editor.tokens.at(-1);
        next.textContent = editor.typing
          ? ""
          : last && (last.kind === "field" || last.kind === "number" || last.kind === "close")
            ? words.nextOperator
            : words.nextValue;

        input.hidden = !editor.typing;
        hint.hidden = !editor.typing;
        strip.hidden = editor.typing;
        next.hidden = editor.typing;
        picking.hidden = editor.typing;
        operating.hidden = editor.typing;
        undo.hidden = editor.typing;
        clear.hidden = editor.typing;
        undo.disabled = editor.history.length === 0;
        clear.disabled = editor.tokens.length === 0;
        switcher.textContent = editor.typing ? words.useButtons : words.typeFormula;
        if (!editor.typing) {
          input.value = formulaText(editor.tokens);
        }
      };

      refresh();
      return { settings, focus: caption ?? (editor.typing ? input : palette.children[0] ?? input) };
    }

    // The pieces of the formula so far, each with a way to take it back out
    // and, for a field, a way to summarize it other than by its sum.
    renderFormulaStrip(strip, editor, captionOf, change) {
      const document = root.document;
      const words = this.labels.formulaBuilder;
      strip.replaceChildren();

      if (editor.tokens.length === 0) {
        const empty = document.createElement("span");
        empty.className = "pivot-formula__empty";
        empty.textContent = words.dropHere;
        strip.appendChild(empty);
        return;
      }

      editor.tokens.forEach((token, index) => {
        const piece = document.createElement("span");
        piece.className = `pivot-formula__token is-${token.kind}`;
        piece.dataset.role = "formula-token";
        piece.dataset.index = String(index);
        piece.setAttribute("role", "listitem");

        const text = document.createElement("span");
        text.className = "pivot-formula__token-text";
        if (token.kind === "field") {
          text.textContent = captionOf(token.dataField);
          piece.appendChild(text);

          // "Sum of" is what a bare field means and what almost everyone wants,
          // so the choice stays quiet until it is changed.
          const summary = document.createElement("select");
          summary.className = "pivot-formula__summary";
          summary.dataset.action = "formula-summary";
          summary.dataset.index = String(index);
          summary.setAttribute("aria-label", format(words.summaryOf, captionOf(token.dataField)));
          FORMULA_SUMMARIES.forEach(fn => {
            const option = document.createElement("option");
            option.value = fn;
            option.textContent = this.labels.aggregations[fn] ?? fn;
            option.selected = fn === token.fn;
            summary.appendChild(option);
          });
          summary.value = token.fn;
          summary.addEventListener("change", () => change(list =>
            list.map((entry, at) => at === index ? { ...entry, fn: summary.value } : entry)));
          piece.appendChild(summary);
        } else {
          text.textContent = token.kind === "number"
            ? token.value
            : FORMULA_OPERATORS.find(entry => entry.value === operatorValue(token)).symbol;
          if (token.kind !== "number") {
            text.setAttribute("aria-label", words.operators[operatorValue(token)]);
          }
          piece.appendChild(text);
        }

        const remove = document.createElement("button");
        remove.className = "pivot-formula__remove";
        remove.setAttribute("type", "button");
        remove.dataset.action = "formula-remove-token";
        remove.dataset.index = String(index);
        remove.setAttribute("aria-label", words.removeToken);
        remove.title = words.removeToken;
        remove.textContent = "✕";
        remove.addEventListener("click", () =>
          change(list => list.filter((_, at) => at !== index)));
        piece.appendChild(remove);

        strip.appendChild(piece);
      });
    }

    // A field dragged from the palette into the strip lands where it is let
    // go. The same pointer events the zones use, so it works with a finger;
    // a press that never travels is left to the button's own click.
    beginFormulaDrag(event, button, field, strip, change) {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      this.endFormulaDrag();
      const drag = {
        button,
        field,
        strip,
        change,
        pointerId: event.pointerId,
        startX: event.clientX ?? 0,
        startY: event.clientY ?? 0,
        started: false,
        ghost: null
      };

      drag.move = moved => {
        if (moved.pointerId !== undefined && moved.pointerId !== drag.pointerId) {
          return;
        }

        if (!drag.started) {
          if (Math.hypot((moved.clientX ?? 0) - drag.startX, (moved.clientY ?? 0) - drag.startY) < DRAG_THRESHOLD) {
            return;
          }
          drag.started = true;
          drag.ghost = root.document.createElement("div");
          drag.ghost.className = "pivot-formula__ghost";
          drag.ghost.textContent = field.caption;
          (root.document.body ?? this.host).appendChild(drag.ghost);
        }

        moved.preventDefault?.();
        drag.ghost.style.left = `${moved.clientX}px`;
        drag.ghost.style.top = `${moved.clientY}px`;
        this.markFormulaDrop(drag, moved.clientX, moved.clientY);
      };

      drag.up = released => {
        if (released.pointerId !== undefined && released.pointerId !== drag.pointerId) {
          return;
        }

        const at = drag.started ? this.formulaDropIndex(drag, released.clientX, released.clientY) : null;
        this.endFormulaDrag();
        if (at !== null) {
          change((list, index) => [
            ...list.slice(0, index),
            { kind: "field", dataField: field.dataField, fn: "sum" },
            ...list.slice(index)
          ], at);
        }
      };

      drag.cancel = () => this.endFormulaDrag();

      this.formulaDrag = drag;
      capturePointer(button, event.pointerId);
      button.addEventListener("pointermove", drag.move);
      button.addEventListener("pointerup", drag.up);
      button.addEventListener("pointercancel", drag.cancel);
    }

    endFormulaDrag() {
      const drag = this.formulaDrag;
      this.formulaDrag = null;
      if (!drag) {
        return;
      }

      releasePointer(drag.button, drag.pointerId);
      drag.button.removeEventListener("pointermove", drag.move);
      drag.button.removeEventListener("pointerup", drag.up);
      drag.button.removeEventListener("pointercancel", drag.cancel);
      drag.ghost?.remove();
      drag.strip.classList.remove("is-drop-target");
      this.clearFormulaCaret(drag.strip);

      // The release after a real drag may also click the button, which would
      // add the field a second time at the end. Whether that click comes at
      // all depends on where the pointer was let go, so rather than a
      // listener that could linger and eat the reader's next real tap, a
      // click arriving straight after a drag is ignored.
      if (drag.started) {
        this.formulaDragEnded = Date.now();
      }
    }

    // Where in the strip a drop at this point lands, or null off the strip.
    // Pieces wrap onto several lines, so a piece counts as "after" the pointer
    // when it sits on a lower line, or on the same line to its right.
    formulaDropIndex(drag, clientX, clientY) {
      if (typeof clientX !== "number" || typeof clientY !== "number") {
        return null;
      }

      const element = root.document?.elementFromPoint?.(clientX, clientY);
      if (!element || !drag.strip.contains(element)) {
        return null;
      }

      const pieces = Array.from(drag.strip.children)
        .filter(child => child.dataset?.role === "formula-token");
      const after = pieces.findIndex(piece => {
        const box = piece.getBoundingClientRect();
        return box.top > clientY || (box.bottom >= clientY && box.left + box.width / 2 > clientX);
      });

      return after < 0 ? pieces.length : after;
    }

    markFormulaDrop(drag, clientX, clientY) {
      this.clearFormulaCaret(drag.strip);
      const at = this.formulaDropIndex(drag, clientX, clientY);
      drag.strip.classList.toggle("is-drop-target", at !== null);
      if (at === null) {
        return;
      }

      const pieces = Array.from(drag.strip.children)
        .filter(child => child.dataset?.role === "formula-token");
      pieces[at]?.classList.add("is-drop-before");
      if (at === pieces.length && at > 0) {
        pieces[at - 1].classList.add("is-drop-after");
      }
    }

    clearFormulaCaret(strip) {
      Array.from(strip.children).forEach(child =>
        child.classList.remove("is-drop-before", "is-drop-after"));
    }

    async saveFormula(name, caption, input, error) {
      const editor = this.formulaEditor;
      const expression = !editor || editor.typing ? input.value : formulaText(editor.tokens);

      try {
        if (name) {
          this.state.setExpression(name, expression);
        } else {
          this.state.addCalculatedField({ caption: caption.value, expression });
        }
      } catch (refused) {
        error.textContent = this.formulaError(refused);
        error.hidden = false;

        if (refused.code === "noName") {
          caption?.focus?.();
          return;
        }

        // The position is a character in the typed formula, which only means
        // something where that formula is showing.
        if (!editor || editor.typing) {
          input.setAttribute("aria-invalid", "true");
          input.focus?.();
          if (Number.isInteger(refused.position) && refused.position >= 0) {
            input.setSelectionRange?.(refused.position, refused.position);
          }
        }
        return;
      }

      this.closeSettings();
      this.render();
      await this.push(this.state.toRequestState());
    }

    // In the reader's language where the locale words the code, and in the
    // parser's English where it does not.
    formulaError(error) {
      const template = this.labels.formulaErrors?.[error?.code];
      return template ? format(template, error.detail ?? "") : String(error?.message ?? error);
    }

    openFormula(name = null) {
      this.settingsFor = null;
      this.formulaFor = name ?? "";
      const { settings, focus } = this.renderFormula(name);
      settings.overlay.classList.add("is-open");
      settings.overlay.setAttribute("aria-hidden", "false");
      focus?.focus?.();
    }

    openSettings(name) {
      this.endFormulaDrag();
      this.formulaFor = null;
      this.formulaEditor = null;
      this.settingsFor = name;
      const settings = this.renderSettings(name);
      settings.overlay.classList.add("is-open");
      settings.overlay.setAttribute("aria-hidden", "false");
    }

    closeSettings() {
      this.endFormulaDrag();
      this.settingsFor = null;
      // A bound typed and not applied is dropped with the modal.
      this.valueFilterDraft = null;
      this.groupSizeError = null;
      this.formulaFor = null;
      this.formulaEditor = null;
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
      // Without this the chips are announced as bare buttons: "Region, button"
      // rather than "Rows, Region, button", which is the only part that says
      // where the field currently is.
      body.setAttribute("role", "group");
      body.setAttribute("aria-labelledby", head.id);
      zone.appendChild(body);
      this.zoneBodies.push(body);
      this.zoneElements.push(zone);
      this.zones.set(area, { zone, body, area });

      const names = this.namesIn(area);
      names.forEach(name => body.appendChild(this.createChip(name, area)));
      if (this.showsValuesChip() && this.areaOfChip(VALUES_CHIP) === area) {
        body.appendChild(this.createValuesChip());
      }
      return zone;
    }

    // --- Σ Values ---------------------------------------------------------
    // The drag and keyboard code ask these instead of the state, so the one
    // chip that is not a field is handled in four small places rather than in
    // every gesture.

    showsValuesChip() {
      return typeof this.state.setValuesPosition === "function" && this.state.getState().values.length > 1;
    }

    areaOfChip(name) {
      return name === VALUES_CHIP
        ? (this.state.valuesPosition === "rows" ? "row" : "column")
        : this.state.areaOf(name);
    }

    canDropChip(name, area) {
      return name === VALUES_CHIP
        ? area === "row" || area === "column"
        : this.state.canDrop(name, area);
    }

    moveChip(name, area, index) {
      if (name === VALUES_CHIP) {
        this.state.setValuesPosition(area === "row" ? "rows" : "columns");
        return;
      }

      this.state.move(name, area, index);
    }

    // Built like a field chip -- same grip, same focus and keyboard handling --
    // minus the controls: it cannot be removed and has no settings.
    createValuesChip() {
      const document = root.document;
      const chip = document.createElement("div");
      chip.className = "pivot-chip pivot-chip--values";
      chip.dataset.field = VALUES_CHIP;
      chip.tabIndex = -1;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-grabbed", "false");
      chip.addEventListener("pointerdown", event => this.beginDrag(event, chip, VALUES_CHIP));
      chip.addEventListener("keydown", event => this.handleKeydown(event, VALUES_CHIP, chip));
      chip.addEventListener("focus", () => {
        this.focusField = VALUES_CHIP;
        this.refreshTabStops();
      });

      const label = document.createElement("span");
      label.className = "pivot-chip__label";
      label.textContent = this.labels.valuesChip;
      chip.appendChild(label);

      const grip = document.createElement("span");
      grip.className = "pivot-chip__grip";
      grip.dataset.action = "grip";
      grip.textContent = "⠿";
      grip.setAttribute("aria-hidden", "true");
      chip.appendChild(grip);

      return chip;
    }

    // Whether dragging `name` back to the available list would be accepted.
    // Mirrors what the × button allows, so the two gestures cannot disagree.
    canReturn(name) {
      // The values cannot leave the grid as a block; each value chip can.
      if (name === VALUES_CHIP) {
        return false;
      }

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
        // A filter entry can belong to a field seated in another zone -- one
        // filtered from its row header -- and that field's chip is already
        // there, so only the entries actually seated here become chips.
        case "filter": return state.filters
          .filter(filter => this.state.areaOf(filter.field) === "filter")
          .map(filter => filter.field);
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
      head.textContent = this.allFields ? this.labels.allFields : this.labels.available;
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

      // Beside the search box rather than under it: the list keeps its height,
      // and the badge is the same one a calculated chip carries.
      if (this.allowCalculatedFields && typeof this.state.addCalculatedField === "function") {
        const add = document.createElement("button");
        add.className = "pivot-search__add";
        add.setAttribute("type", "button");
        add.dataset.action = "add-calculated";
        add.textContent = "+ ƒx";
        add.title = this.labels.addCalculatedField;
        add.setAttribute("aria-label", this.labels.addCalculatedField);
        add.addEventListener("click", () => this.openFormula(null));
        searchWrap.classList.add("has-action");
        searchWrap.appendChild(add);
      }

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

    // The names the field list shows: the unplaced ones, or with allFields
    // every field the reader can see, in catalog order.
    listedNames() {
      if (!this.allFields) {
        return this.namesIn("available");
      }

      const available = new Set(this.namesIn("available"));
      return [...this.state.catalog.keys()].filter(name =>
        !available.has(name) || this.state.field(name).visible !== false);
    }

    renderAvailableChips(body) {
      const term = foldSearch(this.searchTerm.trim());
      const names = this.listedNames().filter(name => {
        if (!term) {
          return true;
        }
        const caption = this.state.field(name).caption ?? "";
        return foldSearch(caption).includes(term);
      });

      // Fields with no folder first, then each folder in the order the catalog
      // first names it. A search opens every folder, so a match is never hidden.
      const folderOf = name => this.state.field(name).displayFolder ?? null;
      const folders = [...new Set(names.map(folderOf).filter(Boolean))];
      const nodes = names.filter(name => !folderOf(name)).map(name => this.createChip(name, "available"));

      folders.forEach(folder => {
        const open = term !== "" || !this.collapsedFolders.has(folder);
        const heading = this.createFolderHeading(body, folder, open);
        nodes.push(this.allFields
          ? this.withFolderCheckbox(heading, names.filter(name => folderOf(name) === folder))
          : heading);

        if (open) {
          nodes.push(...names.filter(name => folderOf(name) === folder).map(name => {
            const chip = this.createChip(name, "available");
            chip.classList.add("is-in-folder");
            return chip;
          }));
        }
      });

      body.replaceChildren(...nodes);
    }

    createFolderHeading(body, folder, open) {
      const heading = root.document.createElement("button");
      heading.className = "pivot-field-folder";
      heading.setAttribute("type", "button");
      heading.dataset.action = "folder";
      heading.dataset.folder = folder;
      heading.setAttribute("aria-expanded", String(open));
      heading.setAttribute("aria-label", format(this.labels.folderToggle, folder));
      heading.textContent = `${open ? "▾" : "▸"} ${folder}`;
      heading.addEventListener("click", () => {
        if (this.collapsedFolders.has(folder)) {
          this.collapsedFolders.delete(folder);
        } else {
          this.collapsedFolders.add(folder);
        }

        this.renderAvailableChips(body);
        this.refreshTabStops();
        // Under allFields the heading sits in a row beside its checkbox.
        Array.from(body.children)
          .map(child => child.dataset?.action === "folder" ? child : child.querySelector?.('[data-action="folder"]'))
          .find(child => child?.dataset?.folder === folder)
          ?.focus?.();
      });

      return heading;
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

      this.footer = this.deferUpdates === null || !this.showDeferBox ? null : this.createFooter();
      this.host.replaceChildren(...[this.createAvailable(), grid, this.footer].filter(Boolean));
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
      // The formula editor holds what the reader is typing, so a re-render
      // leaves it alone -- unless its field has been deleted from under it.
      if (this.formulaFor && !this.state.catalog?.has?.(this.formulaFor)) {
        this.closeSettings();
      }

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
      await this.push(this.state.toRequestState());
    }

    dispose() {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      this.closeFieldMenu();
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
      this.host.classList.remove("pivot-field-designer");
    }
  }

  PivotFieldDesigner.instances = 0;

  PivotFieldDesigner.VALUES_CHIP = VALUES_CHIP;
  PivotForge.PivotFieldDesigner = PivotFieldDesigner;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotFieldDesigner;
  }
})(typeof window !== "undefined" ? window : globalThis);
