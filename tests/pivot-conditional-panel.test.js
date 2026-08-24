const assert = require("node:assert/strict");
const test = require("node:test");

// Real DOM `children` is an HTMLCollection: length and indexed access only, with
// no Array.prototype methods on it. The stub mirrors that contract exactly, so
// production code cannot lean on array methods that do not exist in a browser.
function asChildren(items) {
  const collection = {
    length: items.length,
    item: index => items[index] ?? null,
    [Symbol.iterator]: () => items[Symbol.iterator]()
  };
  items.forEach((item, index) => { collection[index] = item; });
  return collection;
}

function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    _children: [],
    get children() { return asChildren(this._children); },
    listeners: new Map(),
    dataset: {},
    attributes: {},
    style: {},
    textContent: "",
    className: "",
    disabled: false,
    hidden: false,
    checked: false,
    value: "",
    classList: {
      names: new Set(),
      add(...names) { names.forEach(name => this.names.add(name)); },
      remove(...names) { names.forEach(name => this.names.delete(name)); },
      contains(name) { return this.names.has(name); },
      toggle(name, on) { on ? this.names.add(name) : this.names.delete(name); }
    },
    appendChild(child) { this._children.push(child); child.parent = this; return child; },
    remove() { this.removed = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
    // The panel asks whether a pointerdown landed inside itself; the stub
    // answers by walking the parent chain the same way the DOM does.
    contains(node) {
      for (let current = node; current; current = current.parent) {
        if (current === this) {
          return true;
        }
      }
      return false;
    },
    focus() { this.focused = true; },
    addEventListener(name, handler) {
      const handlers = this.listeners.get(name) ?? [];
      handlers.push(handler);
      this.listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter(entry => entry !== handler));
    },
    dispatch(name, event = {}) {
      (this.listeners.get(name) ?? []).forEach(handler => handler(event));
    }
  };
}

const documentListeners = new Map();
globalThis.document = {
  createElement,
  addEventListener(name, handler) {
    const handlers = documentListeners.get(name) ?? [];
    handlers.push(handler);
    documentListeners.set(name, handlers);
  },
  removeEventListener(name, handler) {
    documentListeners.set(
      name, (documentListeners.get(name) ?? []).filter(entry => entry !== handler));
  },
  dispatch(name, event = {}) {
    [...(documentListeners.get(name) ?? [])].forEach(handler => handler(event));
  }
};

require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-table.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-conditional-panel.js");

const PivotForge = globalThis.PivotForge;

function find(node, predicate, found = []) {
  if (predicate(node)) {
    found.push(node);
  }
  Array.from(node.children).forEach(child => find(child, predicate, found));
  return found;
}

const byTag = (node, tag) => find(node, entry => entry.tagName === tag.toUpperCase());
const byClass = (node, name) => find(node, entry => entry.className?.split(" ").includes(name));

function build(options = {}) {
  const host = createElement("div");
  const panel = new PivotForge.PivotConditionalPanel({ host, ...options });
  return { panel, host };
}

// Opens on a cell and returns the rules the panel hands back, plus the parts of
// its form a test needs to drive.
function open(request = {}) {
  const { panel, host } = request.built ?? build(request.options);
  const applied = [];
  const cleared = [];
  const anchor = request.anchor ?? createElement("td");
  panel.open({
    valueKey: "Amount_sum",
    caption: "Tutar",
    value: 1250,
    valueText: "1.250",
    anchor,
    onApply: rule => applied.push(rule),
    onClear: key => cleared.push(key),
    ...request.open
  });

  const numbers = find(host, entry => entry.type === "number");
  return {
    panel,
    host,
    anchor,
    applied,
    cleared,
    operator: byTag(host, "select")[0],
    threshold: numbers[0],
    threshold2: numbers[1],
    thresholdLabel: numbers[1].parent,
    radios: find(host, entry => entry.type === "radio"),
    form: byTag(host, "FORM")[0],
    values: byClass(host, "pivot-conditional-panel__values")[0]
  };
}

const submit = form => form.dispatch("submit", { preventDefault() {} });

test("a panel with nowhere to render is refused at construction", () => {
  assert.throws(
    () => new PivotForge.PivotConditionalPanel({ host: null }),
    /host element/);
});

test("open without a callback is refused, because the rule would go nowhere", () => {
  const { panel, host } = build();
  assert.throws(() => panel.open({ valueKey: "Amount_sum" }), /onApply/);
  assert.equal(byTag(host, "FORM").length, 0);
});

test("the panel offers exactly the comparisons the renderer evaluates", () => {
  const { operator } = open();
  const renderer = new PivotForge.PivotTableRenderer({});
  const offered = Array.from(operator.children).map(option => option.value);

  assert.deepEqual(offered, PivotForge.PivotConditionalPanel.OPERATORS);
  // Every offered comparison must be one the renderer actually acts on. An
  // operator it does not know falls to `default: return false`, so a comparison
  // that is true for no value at all is one the panel must not offer.
  offered.forEach(candidate => {
    const matched = [-5, 1, 5, 9, 15].some(value =>
      renderer.matchesConditionalRule(value, { operator: candidate, threshold: 1, threshold2: 9 }));
    assert.equal(matched, true, `${candidate} is not evaluated by the renderer`);
  });
});

test("the panel offers exactly the highlights the renderer paints", () => {
  const { radios } = open();
  const offered = radios.map(radio => radio.value);

  assert.deepEqual(offered, PivotForge.PivotConditionalPanel.COLORS);

  // The renderer drops a rule whose colour it has no class for, so the two
  // lists agreeing is what makes an added rule visible.
  const renderer = new PivotForge.PivotTableRenderer({});
  const cell = createElement("td");
  cell.dataset.selectionTarget = "cell";
  offered.forEach(color => {
    renderer.selectionMetadata.set(cell, { valueKey: "k", value: 10 });
    renderer.applyConditionalFormatting(
      { querySelectorAll: () => [cell] },
      { conditionalRules: [{ id: "r", valueKey: "k", operator: "greaterThan", threshold: 1, color }] });
    assert.equal(cell.classList.contains(`is-conditional-${color}`), true, color);
  });
});

test("the cell's own number seeds the threshold", () => {
  const { threshold, threshold2 } = open();
  assert.equal(threshold.value, "1250");
  assert.equal(threshold2.value, "1250");
});

test("a cell with no number leaves the threshold empty rather than seeding NaN", () => {
  const { threshold } = open({ open: { value: null } });
  assert.equal(threshold.value, "");
});

test("applying hands back a rule the renderer can read", () => {
  const { applied, form, panel } = open();
  submit(form);

  assert.equal(applied.length, 1);
  const [rule] = applied;
  assert.equal(rule.valueKey, "Amount_sum");
  assert.equal(rule.operator, "greaterThanOrEqual");
  assert.equal(rule.threshold, 1250);
  assert.equal(rule.color, "green");
  assert.equal(typeof rule.id, "string");
  assert.notEqual(rule.id, "");
  // Only Between carries a second bound; spelling it on every rule would make
  // the payload claim a bound the comparison never reads.
  assert.equal("threshold2" in rule, false);
  assert.equal(panel.isOpen, false);
});

test("two rules never share an id, so clearing one cannot clear another", () => {
  const first = open();
  submit(first.form);
  first.panel.open({
    valueKey: "Amount_sum",
    value: 1250,
    onApply: rule => first.applied.push(rule)
  });
  submit(first.form);

  assert.notEqual(first.applied[0].id, first.applied[1].id);
});

test("the selected comparison and colour reach the rule", () => {
  const { applied, form, operator, radios } = open();
  operator.value = "lessThan";
  operator.dispatch("change");
  const red = radios.find(radio => radio.value === "red");
  red.checked = true;
  red.dispatch("change");
  submit(form);

  assert.equal(applied[0].operator, "lessThan");
  assert.equal(applied[0].color, "red");
});

test("between shows its second bound and carries it", () => {
  const { applied, form, operator, threshold, threshold2, thresholdLabel, values } = open();
  assert.equal(thresholdLabel.hidden, true);

  operator.value = "between";
  operator.dispatch("change");
  assert.equal(thresholdLabel.hidden, false);
  assert.equal(values.classList.contains("is-between"), true);

  threshold.value = "100";
  threshold2.value = "900";
  submit(form);

  assert.equal(applied[0].threshold, 100);
  assert.equal(applied[0].threshold2, 900);
});

test("leaving between and coming back hides the second bound again", () => {
  const { operator, thresholdLabel, values } = open();
  operator.value = "between";
  operator.dispatch("change");
  operator.value = "equal";
  operator.dispatch("change");

  assert.equal(thresholdLabel.hidden, true);
  assert.equal(values.classList.contains("is-between"), false);
});

// The renderer ignores a rule whose threshold is not a finite number, so a
// panel that accepted one would close on a rule that colours nothing.
test("a blank threshold is refused rather than applied", () => {
  const { applied, form, threshold, panel } = open();
  threshold.value = "";
  submit(form);

  assert.equal(applied.length, 0);
  assert.equal(panel.isOpen, true);
});

test("between without its second bound is refused", () => {
  const { applied, form, operator, threshold2, panel } = open();
  operator.value = "between";
  operator.dispatch("change");
  threshold2.value = "";
  submit(form);

  assert.equal(applied.length, 0);
  assert.equal(panel.isOpen, true);
});

test("clearing reports the measure it was opened on", () => {
  const { cleared, host, panel } = open();
  byClass(host, "is-secondary")[0].dispatch("click");

  assert.deepEqual(cleared, ["Amount_sum"]);
  assert.equal(panel.isOpen, false);
});

test("closing returns focus to the cell the panel was opened on", () => {
  const { anchor, host, panel } = open();
  byClass(host, "pivot-conditional-panel__head")[0].children[1].dispatch("click");

  assert.equal(panel.isOpen, false);
  assert.equal(anchor.focused, true);
});

test("escape closes the panel", () => {
  const { panel } = open();
  document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(panel.isOpen, false);
});

test("a key that is not escape leaves the panel open", () => {
  const { panel } = open();
  document.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(panel.isOpen, true);
});

test("a pointer outside closes the panel", () => {
  const { panel } = open();
  document.dispatch("pointerdown", { target: createElement("div") });
  assert.equal(panel.isOpen, false);
});

test("a pointer inside the panel leaves it open", () => {
  const { panel, threshold } = open();
  document.dispatch("pointerdown", { target: threshold });
  assert.equal(panel.isOpen, true);
});

// The cell menu that opened this panel removes itself on click. Closing on that
// same gesture would shut the panel the moment it appeared.
test("a pointer on the cell menu that opened it leaves the panel open", () => {
  const { panel } = open();
  const menuItem = createElement("button");
  menuItem.closest = selector => (selector === ".pivot-cell-menu" ? menuItem : null);
  document.dispatch("pointerdown", { target: menuItem });
  assert.equal(panel.isOpen, true);
});

// The panel keeps its document listeners for its whole life, so a closed one
// still sees every Escape on the page. It must let them through: the demo's
// detail modal listens for the same key, and swallowing it there would leave a
// modal that cannot be dismissed.
test("a closed panel lets escape reach whatever else is listening", () => {
  const { panel, applied } = open();
  panel.close();

  // This panel's own handler, called directly: the document is shared with every
  // other panel a test in this file left open, so dispatching there would be
  // answering for all of them.
  let prevented = false;
  panel.keydownHandler({ key: "Escape", preventDefault() { prevented = true; } });
  document.dispatch("pointerdown", { target: createElement("div") });

  assert.equal(prevented, false);
  assert.equal(applied.length, 0);
});

test("an open panel takes escape for itself", () => {
  const { panel } = open();

  let prevented = false;
  panel.keydownHandler({ key: "Escape", preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(panel.isOpen, false);
});

test("reopening seeds the new cell and forgets the last comparison", () => {
  const built = build();
  const first = open({ built });
  first.operator.value = "lessThan";
  first.operator.dispatch("change");
  const red = first.radios.find(radio => radio.value === "red");
  red.checked = true;
  red.dispatch("change");
  first.panel.close();

  const second = open({ built, open: { value: 42, valueKey: "Quantity_sum" } });
  assert.equal(second.operator.value, "greaterThanOrEqual");
  assert.equal(second.threshold.value, "42");
  // The colour resets too, and the radios agree with it: a panel that reopened
  // showing green while still holding red would add a rule the reader can see
  // is not the one they were shown.
  assert.equal(second.radios.find(radio => radio.value === "green").checked, true);
  assert.equal(second.radios.find(radio => radio.value === "red").checked, false);
  submit(second.form);
  assert.equal(second.applied[0].valueKey, "Quantity_sum");
  assert.equal(second.applied[0].operator, "greaterThanOrEqual");
  assert.equal(second.applied[0].color, "green");
});

test("reopening reuses one panel rather than stacking them on the host", () => {
  const built = build();
  open({ built });
  built.panel.close();
  open({ built });

  assert.equal(byClass(built.host, "pivot-conditional-panel").length, 1);
});

test("disposing removes the panel and its document listeners", () => {
  const { panel, host, applied } = open();
  panel.dispose();

  assert.equal(byClass(host, "pivot-conditional-panel")[0].removed, true);
  document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  document.dispatch("pointerdown", { target: createElement("div") });
  assert.equal(applied.length, 0);
  assert.throws(() => panel.open({ valueKey: "x", onApply() {} }), /disposed/);
});

test("disposing twice is harmless", () => {
  const { panel } = open();
  panel.dispose();
  assert.doesNotThrow(() => panel.dispose());
});

test("declared labels win over the defaults, key by key", () => {
  const { host, operator } = open({
    options: { labels: { apply: "Ekle", operators: { equal: "eşittir" } } }
  });

  assert.equal(byClass(host, "is-primary")[0].textContent, "Ekle");
  const options = Array.from(operator.children);
  assert.equal(options.find(option => option.value === "equal").textContent, "eşittir");
  // A key the page did not name keeps the default rather than going blank.
  assert.equal(options.find(option => option.value === "lessThan").textContent, "less than");
});

test("the summary names the measure and the number it was opened on", () => {
  const { host } = open();
  const summary = byClass(host, "pivot-conditional-panel__head")[0].children[0].children[1];
  assert.equal(summary.textContent, "Tutar · 1.250");
});

test("two panels do not share a colour selection", () => {
  const first = open();
  const second = open();
  assert.notEqual(first.radios[0].name, second.radios[0].name);
});
