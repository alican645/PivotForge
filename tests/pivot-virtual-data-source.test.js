const assert = require("node:assert/strict");
const test = require("node:test");
const PivotVirtualDataSource = require("../src/PivotForge.AspNetCore/wwwroot/js/pivot-virtual-data-source.js");

test("virtual data source starts a session and reuses cached pages", async () => {
  const states = [];
  let pageRequests = 0;
  const source = new PivotVirtualDataSource({
    pageSize: 20,
    start: async () => ({
      sessionId: "session",
      cacheHit: false,
      page: createPage(0, 20, 20)
    }),
    loadPage: async () => {
      pageRequests++;
      return createPage(20, 20, 20);
    },
    onStateChanged: state => states.push(state)
  });

  const first = await source.start({});
  const cached = await source.load(4);

  assert.equal(first.offset, 0);
  assert.equal(cached, first);
  assert.equal(states[0].phase, "initial-loading");
  assert.equal(states.some(state => state.phase === "ready" && state.cacheHit), true);
  assert.equal(pageRequests, 0);
});

test("virtual data source evicts least recently used pages", () => {
  const source = new PivotVirtualDataSource({
    maxCachedPages: 2,
    start: async () => null,
    loadPage: async () => null
  });

  source.setCachedPage(createPage(0));
  source.setCachedPage(createPage(20));
  source.getCachedPage(0);
  source.setCachedPage(createPage(40));

  assert.equal(source.cache.has(0), true);
  assert.equal(source.cache.has(20), false);
  assert.equal(source.cache.has(40), true);
});

test("virtual data source aborts the previous visible page request", async () => {
  const pending = [];
  const source = new PivotVirtualDataSource({
    pageSize: 20,
    start: async () => null,
    loadPage: (sessionId, offset, pageSize, signal) => new Promise((resolve, reject) => {
      const request = { offset, signal, resolve };
      pending.push(request);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })
  });
  source.sessionId = "session";
  source.totalRowCount = 100;

  const firstPromise = source.load(20);
  const secondPromise = source.load(40);
  pending.find(request => request.offset === 40).resolve(createPage(40));

  assert.equal(await firstPromise, null);
  assert.equal((await secondPromise).offset, 40);
  assert.equal(pending.find(request => request.offset === 20).signal.aborted, true);
});

test("starting a new session aborts the previous calculation request", async () => {
  const pending = [];
  const source = new PivotVirtualDataSource({
    pageSize: 20,
    start: (request, pageSize, signal) => new Promise((resolve, reject) => {
      const call = { request, signal, resolve };
      pending.push(call);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
    loadPage: async () => null
  });

  const firstPromise = source.start({ id: 1 });
  const secondPromise = source.start({ id: 2 });
  pending[1].resolve({ sessionId: "second", page: createPage(0, 20, 20) });

  assert.equal(await firstPromise, null);
  assert.equal((await secondPromise).offset, 0);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(source.sessionId, "second");
});

test("virtual data source normalizes offsets to page boundaries", () => {
  const source = new PivotVirtualDataSource({
    pageSize: 25,
    start: async () => null,
    loadPage: async () => null
  });
  source.totalRowCount = 110;

  assert.equal(source.normalizeOffset(0), 0);
  assert.equal(source.normalizeOffset(49), 25);
  assert.equal(source.normalizeOffset(999), 100);
});

function createPage(offset, pageSize = 20, totalRowCount = 100) {
  return {
    offset,
    pageSize,
    totalRowCount,
    hasMore: offset + pageSize < totalRowCount,
    result: { rowHeaders: [] }
  };
}
