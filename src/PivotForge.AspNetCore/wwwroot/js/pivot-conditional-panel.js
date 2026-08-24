(function (root) {
  const PivotForge = root.PivotForge ??= {};

  // The six comparisons the renderer knows how to evaluate, in the order a
  // reader scans them. Declared here rather than derived from the renderer so
  // the panel still builds when pivot-table.js is loaded after it -- the shape
  // it produces is checked against the renderer by the tests instead.
  const OPERATORS = [
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "equal",
    "between"
  ];

  // The four highlights the stylesheet paints. A rule naming anything else is
  // dropped by the renderer, so the panel never offers one.
  const COLORS = ["green", "amber", "red", "blue"];

  // Read at call time for the same reason the operator list is not: this file
  // may load before pivot-table.js. A page without the renderer has nothing to
  // paint anyway, so the panel falls back to accepting its own shape.
  function isRule(rule) {
    return PivotForge.isConditionalRule?.(rule) ?? true;
  }

  const DEFAULT_LABELS = {
    title: "Conditional formatting",
    close: "Close",
    operatorLabel: "Condition",
    operators: {
      greaterThan: "greater than",
      greaterThanOrEqual: "greater than or equal to",
      lessThan: "less than",
      lessThanOrEqual: "less than or equal to",
      equal: "equal to",
      between: "between"
    },
    threshold: "Value",
    threshold2: "Second value",
    colorLabel: "Highlight",
    colors: {
      green: "Green",
      amber: "Amber",
      red: "Red",
      blue: "Blue"
    },
    clear: "Clear rules for this measure",
    apply: "Add rule"
  };

  let instanceCount = 0;

  // Number("") is 0, so a blank box would otherwise read as a threshold of zero
  // and colour every cell at or above nothing.
  function readNumber(input) {
    const text = String(input?.value ?? "").trim();
    return text === "" ? Number.NaN : Number(text);
  }

  function createRuleId() {
    return root.crypto?.randomUUID?.() ??
      `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  class PivotConditionalPanel {
    constructor(options = {}) {
      this.labels = {
        ...DEFAULT_LABELS,
        ...(options.labels ?? {}),
        operators: { ...DEFAULT_LABELS.operators, ...(options.labels?.operators ?? {}) },
        colors: { ...DEFAULT_LABELS.colors, ...(options.labels?.colors ?? {}) }
      };
      this.host = options.host ?? root.document?.body ?? null;

      if (!this.host) {
        throw new Error("PivotConditionalPanel requires a host element.");
      }

      // Radios are grouped by name, so two panels on one page would share a
      // selection if the name were fixed.
      this.radioName = `pivot-conditional-color-${++instanceCount}`;
      this.valueKey = null;
      this.onApply = null;
      this.onClear = null;
      this.anchor = null;
      this.operator = "greaterThanOrEqual";
      this.color = "green";
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

      const panel = create("div", "pivot-conditional-panel");
      panel.setAttribute("role", "dialog");
      // Not modal: the panel points at one cell and the reader may want to look
      // at its neighbours while deciding a threshold.
      panel.setAttribute("aria-modal", "false");
      panel.hidden = true;

      const head = create("div", "pivot-conditional-panel__head");
      const heading = create("div");
      const title = create("strong");
      title.textContent = this.labels.title;
      const summary = create("span");
      heading.appendChild(title);
      heading.appendChild(summary);

      const closeButton = create("button");
      closeButton.type = "button";
      closeButton.textContent = "×";
      closeButton.setAttribute("aria-label", this.labels.close);
      closeButton.addEventListener("click", () => this.close());
      head.appendChild(heading);
      head.appendChild(closeButton);

      const form = create("form");
      form.addEventListener("submit", event => {
        event.preventDefault?.();
        this.apply();
      });

      const operatorLabel = create("label");
      const operatorText = create("span");
      operatorText.textContent = this.labels.operatorLabel;
      const operatorSelect = create("select");
      OPERATORS.forEach(operator => {
        const option = document.createElement("option");
        option.value = operator;
        option.textContent = this.labels.operators[operator];
        operatorSelect.appendChild(option);
      });
      operatorSelect.addEventListener("change", () => {
        this.operator = operatorSelect.value;
        this.renderOperator();
      });
      operatorLabel.appendChild(operatorText);
      operatorLabel.appendChild(operatorSelect);

      const values = create("div", "pivot-conditional-panel__values");
      const createThreshold = labelText => {
        const label = create("label");
        const caption = create("span");
        caption.textContent = labelText;
        const input = create("input");
        input.type = "number";
        input.step = "any";
        label.appendChild(caption);
        label.appendChild(input);
        values.appendChild(label);
        return { label, input };
      };
      const threshold = createThreshold(this.labels.threshold);
      const threshold2 = createThreshold(this.labels.threshold2);

      const colors = create("fieldset", "pivot-conditional-colors");
      const legend = create("legend");
      legend.textContent = this.labels.colorLabel;
      colors.appendChild(legend);
      const colorInputs = COLORS.map(color => {
        const label = create("label");
        label.setAttribute("title", this.labels.colors[color]);
        const input = create("input");
        input.type = "radio";
        input.name = this.radioName;
        input.value = color;
        input.addEventListener("change", () => { this.color = color; });
        const swatch = create("span", `is-${color}`);
        label.appendChild(input);
        label.appendChild(swatch);
        colors.appendChild(label);
        return input;
      });

      const actions = create("div", "pivot-conditional-panel__actions");
      const clearButton = create("button", "is-secondary");
      clearButton.type = "button";
      clearButton.textContent = this.labels.clear;
      clearButton.addEventListener("click", () => this.clear());
      const applyButton = create("button", "is-primary");
      applyButton.type = "submit";
      applyButton.textContent = this.labels.apply;
      actions.appendChild(clearButton);
      actions.appendChild(applyButton);

      form.appendChild(operatorLabel);
      form.appendChild(values);
      form.appendChild(colors);
      form.appendChild(actions);
      panel.appendChild(head);
      panel.appendChild(form);
      this.host.appendChild(panel);

      // One pair of document listeners for the panel's whole life rather than a
      // pair per open, so a page that opens it fifty times still has two.
      this.keydownHandler = event => {
        if (event.key === "Escape" && this.isOpen) {
          event.preventDefault?.();
          this.close();
        }
      };
      // Pointerdown rather than click: the cell menu that opened this panel
      // removes itself on click, and a closed panel must not swallow that.
      this.pointerHandler = event => {
        if (!this.isOpen) {
          return;
        }

        const target = event.target;

        if (panel.contains?.(target) || target?.closest?.(".pivot-cell-menu")) {
          return;
        }

        this.close();
      };
      root.document?.addEventListener("keydown", this.keydownHandler);
      root.document?.addEventListener("pointerdown", this.pointerHandler);

      this.elements = {
        panel,
        summary,
        operatorSelect,
        values,
        threshold,
        threshold2,
        colorInputs,
        applyButton
      };
      return this.elements;
    }

    // Opens over one cell. `value` seeds both thresholds: the reader opened the
    // panel on a number they were already looking at, so it is the likeliest
    // bound and saves them typing it.
    open({ valueKey, caption = "", value = null, valueText = "", anchor = null, onApply, onClear } = {}) {
      if (this.disposed) {
        throw new Error("This PivotConditionalPanel has been disposed.");
      }

      if (typeof onApply !== "function") {
        throw new Error("PivotConditionalPanel.open requires an onApply callback.");
      }

      const elements = this.build();
      this.valueKey = valueKey ?? null;
      this.onApply = onApply;
      this.onClear = typeof onClear === "function" ? onClear : null;
      this.anchor = anchor;
      this.operator = "greaterThanOrEqual";
      this.color = "green";

      const seed = Number.isFinite(value) ? String(value) : "";
      elements.summary.textContent = valueText ? `${caption} · ${valueText}` : caption;
      elements.operatorSelect.value = this.operator;
      elements.threshold.input.value = seed;
      elements.threshold2.input.value = seed;
      elements.colorInputs.forEach(input => { input.checked = input.value === this.color; });
      elements.panel.hidden = false;
      this.isOpen = true;
      this.renderOperator();
      this.position();
      elements.operatorSelect.focus?.();
      return this;
    }

    renderOperator() {
      const between = this.operator === "between";
      this.elements?.values.classList.toggle("is-between", between);

      if (this.elements) {
        this.elements.threshold2.label.hidden = !between;
      }
    }

    // Clamped into the viewport rather than simply placed below the cell: a
    // panel opened on the last row or the rightmost column would otherwise
    // render off-screen with no way to reach its buttons.
    position() {
      const panel = this.elements?.panel;
      const rect = this.anchor?.getBoundingClientRect?.();

      if (!panel || !rect || !panel.style) {
        return;
      }

      const margin = 10;
      const own = panel.getBoundingClientRect?.() ?? { width: 0, height: 0 };
      const width = root.innerWidth ?? 0;
      const height = root.innerHeight ?? 0;
      panel.style.left = `${Math.max(margin, Math.min(rect.left, width - own.width - margin))}px`;
      panel.style.top = `${Math.max(margin, Math.min(rect.bottom + 6, height - own.height - margin))}px`;
    }

    // The rule the renderer would keep. Refusing exactly what
    // matchesConditionalRule ignores means the panel can never add a rule that
    // silently colours nothing.
    createRule() {
      const threshold = readNumber(this.elements?.threshold.input);
      const threshold2 = readNumber(this.elements?.threshold2.input);
      const rule = {
        id: createRuleId(),
        valueKey: this.valueKey,
        operator: this.operator,
        threshold,
        // Only Between reads a second bound, and spelling one on every rule
        // would make the payload claim a bound the comparison never reads.
        ...(this.operator === "between" ? { threshold2 } : {}),
        color: this.color
      };

      return isRule(rule) ? rule : null;
    }

    apply() {
      const rule = this.createRule();

      if (!rule) {
        // Marking the box rather than closing: the reader is mid-edit and the
        // only thing wrong is a number they can still supply.
        this.elements?.threshold.input.reportValidity?.();
        return;
      }

      const callback = this.onApply;
      this.close();
      callback(rule);
    }

    clear() {
      const callback = this.onClear;
      const valueKey = this.valueKey;
      this.close();
      callback?.(valueKey);
    }

    close() {
      if (!this.elements || !this.isOpen) {
        return;
      }

      this.isOpen = false;
      this.elements.panel.hidden = true;
      this.onApply = null;
      this.onClear = null;
      // Focus goes back where it came from, so a keyboard reader is returned to
      // the cell rather than to the top of the document.
      this.anchor?.focus?.({ preventScroll: true });
      this.anchor = null;
      this.valueKey = null;
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

      if (this.pointerHandler) {
        root.document?.removeEventListener("pointerdown", this.pointerHandler);
        this.pointerHandler = null;
      }

      this.elements?.panel.remove();
      this.elements = null;
    }
  }

  PivotConditionalPanel.OPERATORS = OPERATORS;
  PivotConditionalPanel.COLORS = COLORS;
  PivotForge.PivotConditionalPanel = PivotConditionalPanel;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotForge;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
