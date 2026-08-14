(function (root) {
  const PivotForge = root.PivotForge ??= {};

  class PivotVirtualDataSource {
    constructor(options = {}) {
      if (typeof options.start !== "function" || typeof options.loadPage !== "function") {
        throw new Error("PivotVirtualDataSource requires start and loadPage functions.");
      }

      this.startRequest = options.start;
      this.pageRequest = options.loadPage;
      this.pageSize = Math.max(10, options.pageSize ?? 40);
      this.maxCachedPages = Math.max(2, options.maxCachedPages ?? 6);
      this.onStateChanged = options.onStateChanged;
      this.cache = new Map();
      this.prefetchControllers = new Map();
      this.generation = 0;
    }

    async start(request) {
      this.cancel();
      this.generation++;
      const generation = this.generation;
      this.cache.clear();
      this.sessionId = null;
      this.totalRowCount = 0;
      this.startController = new AbortController();
      this.emitState({ phase: "initial-loading", cacheHit: false });

      try {
        const response = await this.startRequest(request, this.pageSize, this.startController.signal);

        if (generation !== this.generation) {
          return null;
        }

        this.sessionId = response.sessionId;
        this.totalRowCount = response.page?.totalRowCount ?? 0;
        this.setCachedPage(response.page);
        this.emitState({ phase: "ready", cacheHit: response.cacheHit === true, offset: 0 });
        this.prefetch(this.pageSize, generation);
        return response.page;
      } catch (error) {
        if (error.name === "AbortError" || generation !== this.generation) {
          return null;
        }

        this.emitState({ phase: "error", error });
        throw error;
      } finally {
        if (generation === this.generation) {
          this.startController = null;
        }
      }
    }

    async load(offset) {
      if (!this.sessionId) {
        return null;
      }

      const normalizedOffset = this.normalizeOffset(offset);
      const cached = this.getCachedPage(normalizedOffset);

      if (cached) {
        this.emitState({ phase: "ready", cacheHit: true, offset: normalizedOffset });
        this.prefetch(normalizedOffset + this.pageSize, this.generation);
        return cached;
      }

      this.pageController?.abort();
      this.pageController = new AbortController();
      const controller = this.pageController;
      const generation = this.generation;
      this.emitState({ phase: "page-loading", cacheHit: false, offset: normalizedOffset });

      try {
        const page = await this.pageRequest(
          this.sessionId,
          normalizedOffset,
          this.pageSize,
          controller.signal);

        if (generation !== this.generation || controller.signal.aborted) {
          return null;
        }

        this.setCachedPage(page);
        this.emitState({ phase: "ready", cacheHit: false, offset: normalizedOffset });
        this.prefetch(normalizedOffset + this.pageSize, generation);
        return page;
      } catch (error) {
        if (error.name === "AbortError" || generation !== this.generation) {
          return null;
        }

        this.emitState({ phase: "error", error, offset: normalizedOffset });
        throw error;
      } finally {
        if (this.pageController === controller) {
          this.pageController = null;
        }
      }
    }

    cancel() {
      this.generation++;
      this.startController?.abort();
      this.pageController?.abort();
      this.prefetchControllers.forEach(controller => controller.abort());
      this.prefetchControllers.clear();
      this.startController = null;
      this.pageController = null;
    }

    clearCache() {
      this.cache.clear();
    }

    getCachedPage(offset) {
      const page = this.cache.get(offset);

      if (!page) {
        return null;
      }

      this.cache.delete(offset);
      this.cache.set(offset, page);
      return page;
    }

    setCachedPage(page) {
      if (!page || !Number.isInteger(page.offset)) {
        return;
      }

      this.cache.delete(page.offset);
      this.cache.set(page.offset, page);

      while (this.cache.size > this.maxCachedPages) {
        this.cache.delete(this.cache.keys().next().value);
      }
    }

    normalizeOffset(offset) {
      const maximumOffset = Math.max(0, this.totalRowCount - 1);
      const safeOffset = Math.max(0, Math.min(Number(offset) || 0, maximumOffset));
      return Math.floor(safeOffset / this.pageSize) * this.pageSize;
    }

    prefetch(offset, generation) {
      if (!this.sessionId || offset >= this.totalRowCount || this.cache.has(offset) || this.prefetchControllers.has(offset)) {
        return;
      }

      const controller = new AbortController();
      this.prefetchControllers.set(offset, controller);
      void this.pageRequest(this.sessionId, offset, this.pageSize, controller.signal)
        .then(page => {
          if (generation === this.generation && !controller.signal.aborted) {
            this.setCachedPage(page);
          }
        })
        .catch(error => {
          if (error.name !== "AbortError") {
            this.emitState({ phase: "prefetch-error", error, offset });
          }
        })
        .finally(() => this.prefetchControllers.delete(offset));
    }

    emitState(state) {
      this.onStateChanged?.({
        ...state,
        sessionId: this.sessionId ?? null,
        totalRowCount: this.totalRowCount,
        cachedPageCount: this.cache.size
      });
    }
  }

  PivotForge.PivotVirtualDataSource = PivotVirtualDataSource;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PivotVirtualDataSource;
  }
})(typeof window !== "undefined" ? window : globalThis);
