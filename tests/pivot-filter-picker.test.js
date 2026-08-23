const assert = require("node:assert/strict");
const test = require("node:test");

// Real DOM `children` is an HTMLCollection: length and indexed access only, with
// no Array.prototype methods on it. The stub mirrors that contract exactly, so
// production code cannot lean on array methods that do not exist in a browser.
function asChildren(items) {
  const collection = {
    length: items.length,
    item: index => items[index] ?? null,
    // A real HTMLCollection is iterable, so Array.from and spread work on it —
    // it just has no Array.prototype methods of its own.
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
    appendChild(child) { this._children.push(child); return child; },
    replaceChildren(...nodes) { this._children = nodes; },
    remove() { this.removed = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
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

// The picker reads the operator list from the request builder, which a page
// loads before it in the documented order.
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-request-builder.js");
require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-filter-picker.js");

const PivotForge = globalThis.PivotForge;

const VALUES = ["Ege", "İç Anadolu", "Marmara"];

// A widget stub whose fieldValues() resolution the test controls.
function createWidget(options = {}) {
  const calls = [];
  return {
    calls,
    fieldValues(field) {
      calls.push(field);
      return options.respond
        ? options.respond(field, calls.length)
        : Promise.resolve({
          field,
          values: options.values ?? VALUES,
          totalCount: (options.values ?? VALUES).length,
          truncated: false,
          limit: 1000
        });
    }
  };
}

function build(options = {}) {
  const host = createElement("div");
  const widget = options.widget ?? createWidget(options);
  const picker = new PivotForge.PivotFilterPicker({ widget, host, ...options.picker });
  return { picker, widget, host };
}

function find(node, predicate, found = []) {
  if (predicate(node)) {
    found.push(node);
  }
  Array.from(node.children).forEach(child => find(child, predicate, found));
  return found;
}

const byAction = (node, action) => find(node, entry => entry.dataset?.action === action);
const byClass = (node, name) => find(node, entry => entry.className?.split(" ").includes(name));

const rowsOf = host => byClass(host, "pivot-filter-picker__value");
const checkboxesOf = host => byAction(host, "filter-value");
const labelsOf = host => rowsOf(host).map(row => Array.from(row.children)[1].textContent);

// Opens the picker and resolves once its list has rendered.
async function open(host, picker, request = {}) {
  const applied = [];
  await picker.open({
    field: "Region",
    caption: "Bölge",
    onApply: values => applied.push(values),
    ...request
  });
  return applied;
}

function toggle(host, value, checked) {
  const index = rowsOf(host).findIndex(row => row.dataset.value === value);
  const box = checkboxesOf(host)[index];
  box.checked = checked;
  box.dispatch("change");
}

test("a widget without fieldValues is refused at construction", () => {
  assert.throws(
    () => new PivotForge.PivotFilterPicker({ widget: {}, host: createElement("div") }),
    /fieldValues/);
});

test("open without an onApply callback is refused", async () => {
  const { picker } = build();

  await assert.rejects(() => picker.open({ field: "Region" }), /onApply/);
});

test("the picker lists every value the endpoint returned", async () => {
  const { picker, host, widget } = build();

  await open(host, picker);

  assert.deepEqual(widget.calls, ["Region"]);
  assert.deepEqual(labelsOf(host), ["Ege", "İç Anadolu", "Marmara"]);
});

test("an empty incoming selection means no restriction, so everything is checked", async () => {
  const { picker, host } = build();

  await open(host, picker, { selected: [] });

  assert.deepEqual(checkboxesOf(host).map(box => box.checked), [true, true, true]);
});

test("an incoming selection checks only those values", async () => {
  const { picker, host } = build();

  await open(host, picker, { selected: ["Marmara"] });

  assert.deepEqual(checkboxesOf(host).map(box => box.checked), [false, false, true]);
});

test("applying with everything checked clears the filter rather than freezing it", async () => {
  const { picker, host } = build();
  const applied = await open(host, picker, { selected: [] });

  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [[]]);
});

test("applying a subset emits exactly the checked values in list order", async () => {
  const { picker, host } = build();
  const applied = await open(host, picker, { selected: [] });

  toggle(host, "İç Anadolu", false);
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [["Ege", "Marmara"]]);
});

test("cancelling leaves the filter untouched", async () => {
  const { picker, host } = build();
  const applied = await open(host, picker, { selected: [] });

  toggle(host, "Ege", false);
  byAction(host, "filter-cancel")[0].dispatch("click");

  assert.deepEqual(applied, []);
  assert.equal(picker.isOpen, false);
});

test("search narrows the list without losing selections outside it", async () => {
  const { picker, host } = build();
  const applied = await open(host, picker, { selected: [] });

  const search = byAction(host, "filter-search")[0];
  search.value = "mar";
  search.dispatch("input");

  assert.deepEqual(labelsOf(host), ["Marmara"]);

  search.value = "";
  search.dispatch("input");
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [[]]);
});

test("search matches case-insensitively", async () => {
  const { picker, host } = build();
  await open(host, picker);

  const search = byAction(host, "filter-search")[0];
  search.value = "EGE";
  search.dispatch("input");

  assert.deepEqual(labelsOf(host), ["Ege"]);
});

test("select all and clear act on the searched subset only", async () => {
  const { picker, host } = build();
  const applied = await open(host, picker, { selected: [] });

  byAction(host, "filter-clear")[0].dispatch("click");
  const search = byAction(host, "filter-search")[0];
  search.value = "mar";
  search.dispatch("input");
  byAction(host, "filter-select-all")[0].dispatch("click");
  search.value = "";
  search.dispatch("input");
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [["Marmara"]]);
});

test("a search matching nothing says so instead of showing an empty list", async () => {
  const { picker, host } = build();
  await open(host, picker);

  const search = byAction(host, "filter-search")[0];
  search.value = "zzz";
  search.dispatch("input");

  assert.equal(rowsOf(host).length, 0);
  assert.match(byClass(host, "pivot-filter-picker__state")[0].textContent, /No value matches/);
});

test("a null value is offered as blank and applies as the empty string", async () => {
  const { picker, host } = build({ values: ["", "Ege"] });
  const applied = await open(host, picker, { selected: [] });

  assert.deepEqual(labelsOf(host), ["(Blank)", "Ege"]);

  toggle(host, "Ege", false);
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [[""]]);
});

test("a truncated response warns and preserves selections it could not list", async () => {
  const widget = createWidget({
    respond: () => Promise.resolve({
      field: "Region",
      values: ["Ege"],
      totalCount: 5000,
      truncated: true,
      limit: 1
    })
  });
  const { picker, host } = build({ widget });
  const applied = await open(host, picker, { selected: ["Ege", "Karadeniz"] });

  const notice = byClass(host, "pivot-filter-picker__notice")[0];
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /first 1 values/);

  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [["Karadeniz", "Ege"]]);
});

test("a preserved hidden selection keeps the filter from being cleared", async () => {
  const widget = createWidget({
    respond: () => Promise.resolve({
      field: "Region",
      values: ["Ege"],
      totalCount: 2,
      truncated: true,
      limit: 1
    })
  });
  const { picker, host } = build({ widget });
  const applied = await open(host, picker, { selected: ["Ege", "Karadeniz"] });

  // Everything the picker can see is checked, but a hidden selection exists, so
  // this is a real restriction and must not collapse to "no filter".
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [["Karadeniz", "Ege"]]);
});

test("a field with no values says so and cannot be applied", async () => {
  const { picker, host } = build({ values: [] });
  const applied = await open(host, picker);

  assert.match(byClass(host, "pivot-filter-picker__state")[0].textContent, /no values/);
  assert.equal(byAction(host, "filter-apply")[0].disabled, true);
  assert.deepEqual(applied, []);
});

test("a failed load shows the error rather than an empty list", async () => {
  const widget = createWidget({ respond: () => Promise.reject(new Error("sunucu yok")) });
  const { picker, host } = build({ widget });

  await open(host, picker);

  const state = byClass(host, "pivot-filter-picker__state")[0];
  assert.equal(state.textContent, "sunucu yok");
  assert.equal(state.classList.contains("is-error"), true);
});

test("an aborted load is not reported as a failure, because it was superseded", async () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const widget = createWidget({ respond: () => Promise.reject(abort) });
  const { picker, host } = build({ widget });

  await open(host, picker);

  const state = byClass(host, "pivot-filter-picker__state")[0];
  assert.equal(state.classList.contains("is-error"), false);
  assert.doesNotMatch(state.textContent, /aborted/);
});

test("a response for a superseded field never renders over the current one", async () => {
  let releaseFirst;
  const widget = createWidget({
    respond: (field, call) => call === 1
      ? new Promise(resolve => { releaseFirst = () => resolve({
        field, values: ["Eski"], totalCount: 1, truncated: false, limit: 1000 }); })
      : Promise.resolve({ field, values: ["Yeni"], totalCount: 1, truncated: false, limit: 1000 })
  });
  const { picker, host } = build({ widget });

  const first = open(host, picker, { field: "Region" });
  await open(host, picker, { field: "Category" });

  releaseFirst();
  await first;

  assert.deepEqual(labelsOf(host), ["Yeni"]);
});

test("a response that lands after the picker was closed does not render into it", async () => {
  let release;
  const widget = createWidget({
    respond: field => new Promise(resolve => {
      release = () => resolve({
        field, values: ["Geç"], totalCount: 1, truncated: false, limit: 1000 });
    })
  });
  const { picker, host } = build({ widget });

  const pending = open(host, picker);
  picker.close();
  release();
  await pending;

  assert.deepEqual(labelsOf(host), []);
});

test("escape closes the picker without applying", async () => {
  const { picker, host } = build();
  const applied = await open(host, picker, { selected: [] });

  document.dispatch("keydown", { key: "Escape" });

  assert.equal(picker.isOpen, false);
  assert.deepEqual(applied, []);
});

test("a backdrop click closes the picker but a click inside it does not", async () => {
  const { picker, host } = build();
  await open(host, picker);
  const overlay = byClass(host, "pivot-filter-picker")[0];

  overlay.dispatch("click", { target: byClass(host, "pivot-filter-picker__list")[0] });
  assert.equal(picker.isOpen, true);

  overlay.dispatch("click", { target: overlay });
  assert.equal(picker.isOpen, false);
});

test("disposing removes the overlay and the document listener", async () => {
  const { picker, host } = build();
  await open(host, picker);
  const overlay = byClass(host, "pivot-filter-picker")[0];
  // Every picker built in this file registers one listener on the shared stub
  // document, so what matters is that dispose gives back exactly its own.
  const before = documentListeners.get("keydown")?.length ?? 0;

  picker.dispose();

  assert.equal(overlay.removed, true);
  assert.equal(documentListeners.get("keydown")?.length ?? 0, before - 1);
});

test("a disposed picker refuses to open again", async () => {
  const { picker, host, widget } = build();
  picker.dispose();

  await open(host, picker);

  assert.deepEqual(widget.calls, []);
});

// --- Include / exclude ------------------------------------------------------
// A checkbox means "shown" in both modes; the mode picks which side of the list
// is stored, and therefore what happens to a value the source gains later.

const modeButtons = host => byAction(host, "filter-mode");
const activeMode = host =>
  modeButtons(host).find(button => button.classList.contains("is-active"))?.dataset.mode ?? null;

async function openCapturing(host, picker, request = {}) {
  const applied = [];
  await picker.open({
    field: "Region",
    caption: "Bölge",
    onApply: (values, mode) => applied.push({ values, mode }),
    ...request
  });
  return applied;
}

test("an excluding filter checks everything except the values it lists", async () => {
  const { picker, host } = build();
  await openCapturing(host, picker, { selected: ["Ege"], mode: "Exclude" });

  assert.deepEqual(
    checkboxesOf(host).map(box => box.checked),
    [false, true, true]);
  assert.equal(activeMode(host), "Exclude");
});

test("applying an excluding filter stores the unchecked values", async () => {
  const { picker, host } = build();
  const applied = await openCapturing(host, picker, { selected: [], mode: "Exclude" });

  toggle(host, "Marmara", false);
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [{ values: ["Marmara"], mode: "Exclude" }]);
});

test("an excluding filter with nothing unchecked restricts nothing", async () => {
  const { picker, host } = build();
  const applied = await openCapturing(host, picker, { selected: ["Ege"], mode: "Exclude" });

  toggle(host, "Ege", true);
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [{ values: [], mode: "Exclude" }]);
});

test("switching the mode leaves the visible selection exactly as it was", async () => {
  const { picker, host } = build();
  const applied = await openCapturing(host, picker, { selected: ["Ege"] });

  const before = checkboxesOf(host).map(box => box.checked);
  modeButtons(host).find(button => button.dataset.mode === "Exclude").dispatch("click");

  // The rows on screen are the same rows under either mode -- Include keeps the
  // checked ones, Exclude drops the unchecked ones, which is the same set. What
  // changes is a value that is not in the source yet.
  assert.deepEqual(checkboxesOf(host).map(box => box.checked), before);
  assert.equal(activeMode(host), "Exclude");

  byAction(host, "filter-apply")[0].dispatch("click");
  assert.deepEqual(applied, [{ values: ["İç Anadolu", "Marmara"], mode: "Exclude" }]);
});

test("an undeclared mode opens as including", async () => {
  const { picker, host } = build();
  const applied = await openCapturing(host, picker, { selected: ["Ege"] });

  assert.equal(activeMode(host), "Include");

  byAction(host, "filter-apply")[0].dispatch("click");
  assert.deepEqual(applied, [{ values: ["Ege"], mode: "Include" }]);
});

test("an excluding filter keeps listed values the truncated response omitted", async () => {
  const { picker, host } = build();
  const applied = await openCapturing(host, picker, {
    selected: ["Karadeniz"],
    mode: "Exclude"
  });

  // Karadeniz is excluded but was not listed; applying must not quietly bring
  // it back, the same way an including filter keeps its unlisted selections.
  toggle(host, "Marmara", false);
  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [{ values: ["Karadeniz", "Marmara"], mode: "Exclude" }]);
});

// --- conditions -------------------------------------------------------------

// The picker's condition half: an operator and its arguments, which replace the
// value list rather than narrowing it.
const operatorOf = host => byAction(host, "filter-operator")[0];
const argumentsOf = host => byAction(host, "filter-argument");

async function openCondition(host, picker, request = {}) {
  const applied = [];
  await picker.open({
    field: "Amount",
    caption: "Tutar",
    onApply: (values, mode, operator) => applied.push({ values, mode, operator }),
    ...request
  });
  return applied;
}

function type(input, text) {
  input.value = text;
  input.dispatch("input");
}

test("the picker opens on the value list unless told otherwise", async () => {
  const { picker, host } = build();

  await open(host, picker);

  assert.equal(operatorOf(host).value, "Equals");
  assert.equal(argumentsOf(host).every(input => input.hidden), true);
});

test("choosing a condition replaces the value list with its arguments", async () => {
  const { picker, host } = build();
  await open(host, picker);

  picker.setOperator("Contains");

  const [first, second] = argumentsOf(host);
  assert.equal(first.hidden, false);
  // Contains reads one argument, so the second box is not part of the question.
  assert.equal(second.hidden, true);
  assert.equal(byClass(host, "pivot-filter-picker__toolbar")[0].hidden, true);
});

test("between asks for both ends", async () => {
  const { picker, host } = build();
  await open(host, picker);

  picker.setOperator("Between");

  assert.deepEqual(argumentsOf(host).map(input => input.hidden), [false, false]);
});

test("a condition applies its arguments rather than the value list", async () => {
  const { picker, host } = build();
  const applied = await openCondition(host, picker);

  picker.setOperator("Contains");
  type(argumentsOf(host)[0], " çim ");
  byAction(host, "filter-apply")[0].dispatch("click");

  // Trimmed, because a trailing space in a text box is a typo rather than part
  // of the condition.
  assert.deepEqual(applied, [{ values: ["çim"], mode: "Include", operator: "Contains" }]);
});

test("a half-typed range cannot be applied", async () => {
  const { picker, host } = build();
  await openCondition(host, picker);

  picker.setOperator("Between");
  type(argumentsOf(host)[0], "100");

  assert.equal(byAction(host, "filter-apply")[0].disabled, true);

  type(argumentsOf(host)[1], "500");

  assert.equal(byAction(host, "filter-apply")[0].disabled, false);
});

test("blank needs no argument at all", async () => {
  const { picker, host } = build();
  const applied = await openCondition(host, picker);

  picker.setOperator("Blank");

  assert.deepEqual(argumentsOf(host).map(input => input.hidden), [true, true]);
  assert.equal(byAction(host, "filter-apply")[0].disabled, false);

  byAction(host, "filter-apply")[0].dispatch("click");

  assert.deepEqual(applied, [{ values: [], mode: "Include", operator: "Blank" }]);
});

test("a picker opened on a condition shows the arguments already in force", async () => {
  const { picker, host } = build();

  await openCondition(host, picker, { operator: "Between", selected: ["100", "500"] });

  assert.equal(operatorOf(host).value, "Between");
  assert.deepEqual(argumentsOf(host).map(input => input.value), ["100", "500"]);
});

test("opening on a condition costs no value request", async () => {
  // The list answers a question the condition is not asking, and the values it
  // would list need not even exist in the source yet.
  const { picker, host, widget } = build();

  await openCondition(host, picker, { operator: "Contains", selected: ["çim"] });

  assert.deepEqual(widget.calls, []);
});

test("switching back to the value list fetches it", async () => {
  const { picker, host, widget } = build();
  await openCondition(host, picker, { operator: "Contains", selected: ["çim"] });

  await picker.setOperator("Equals");
  await Promise.resolve();

  assert.deepEqual(widget.calls, ["Amount"]);
});

test("an unknown operator opens as the value list rather than as a broken control", async () => {
  const { picker, host } = build();

  await open(host, picker, { operator: "Sometimes" });

  assert.equal(operatorOf(host).value, "Equals");
});
