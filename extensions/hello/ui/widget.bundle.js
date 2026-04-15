(() => {
  // ../../packages/extension-ui-sdk/src/transport.ts
  var Transport = class {
    extensionId = "";
    pending = /* @__PURE__ */ new Map();
    eventHandlers = /* @__PURE__ */ new Map();
    initResolve = null;
    initPromise;
    disposed = false;
    timeout;
    requestCounter = 0;
    constructor(options) {
      this.timeout = options?.timeout ?? 1e4;
      this.initPromise = new Promise((resolve) => {
        this.initResolve = resolve;
      });
      window.addEventListener("message", this.handleMessage);
    }
    get ready() {
      return this.initPromise;
    }
    get id() {
      return this.extensionId;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      window.removeEventListener("message", this.handleMessage);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Transport disposed"));
      }
      this.pending.clear();
      this.eventHandlers.clear();
    }
    async request(method, params) {
      await this.initPromise;
      if (this.disposed) {
        throw new Error("Transport disposed");
      }
      const requestId = this.nextRequestId();
      const message = {
        source: "xopc-extension",
        extensionId: this.extensionId,
        type: "request",
        requestId,
        method,
        params
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error(`Request '${method}' timed out after ${this.timeout}ms`));
        }, this.timeout);
        this.pending.set(requestId, {
          resolve,
          reject,
          timer
        });
        window.parent.postMessage(message, "*");
      });
    }
    emit(event, data) {
      if (!this.extensionId || this.disposed) return;
      const message = {
        source: "xopc-extension",
        extensionId: this.extensionId,
        type: "event",
        event,
        data
      };
      window.parent.postMessage(message, "*");
    }
    on(event, handler) {
      let set = this.eventHandlers.get(event);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.eventHandlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
        if (set.size === 0) {
          this.eventHandlers.delete(event);
        }
      };
    }
    nextRequestId() {
      this.requestCounter += 1;
      return `req_${Date.now()}_${this.requestCounter}`;
    }
    handleMessage = (event) => {
      if (this.disposed) return;
      const msg = event.data;
      if (!msg || msg.source !== "xopc-host") return;
      switch (msg.type) {
        case "init": {
          this.extensionId = msg.extensionId;
          this.initResolve?.(msg);
          this.initResolve = null;
          return;
        }
        case "response": {
          const r = msg;
          const pending = this.pending.get(r.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(r.requestId);
          if (r.error) {
            pending.reject(new Error(r.error.message || `Error ${r.error.code}`));
          } else {
            pending.resolve(r.result);
          }
          return;
        }
        case "event": {
          const ev = msg;
          const handlers = this.eventHandlers.get(ev.event);
          if (handlers) {
            for (const h of handlers) {
              try {
                h(ev.data);
              } catch {
              }
            }
          }
          return;
        }
        default:
          return;
      }
    };
  };

  // ../../packages/extension-ui-sdk/src/client.ts
  function createExtensionClient(options) {
    const transport = options?.transport ?? new Transport();
    const client = {
      async whenReady() {
        await transport.ready;
      },
      theme: {
        async getTheme() {
          return transport.request("theme.get");
        },
        onThemeChange(handler) {
          return transport.on("theme.changed", (data) => {
            handler(data);
          });
        }
      },
      agent: {
        async sendMessage(message, opts) {
          return transport.request("agent.sendMessage", {
            message,
            sessionKey: opts?.sessionKey,
            newSession: opts?.newSession
          });
        },
        onStreamEvent(sessionKey, handler) {
          transport.emit("agent.subscribe", { sessionKey });
          const unsub = transport.on(`agent.stream.${sessionKey}`, handler);
          return () => {
            transport.emit("agent.unsubscribe", { sessionKey });
            unsub();
          };
        }
      },
      session: {
        async listSessions() {
          return transport.request("session.list");
        },
        async navigateToSession(sessionKey) {
          await transport.request("session.navigate", { sessionKey });
        }
      },
      config: {
        async getExtensionConfig() {
          return transport.request("config.get");
        },
        async setExtensionConfig(patch) {
          await transport.request("config.set", patch);
        }
      },
      storage: {
        async get(key) {
          return transport.request("storage.get", { key });
        },
        async set(key, value) {
          await transport.request("storage.set", { key, value });
        },
        async remove(key) {
          await transport.request("storage.remove", { key });
        },
        async keys() {
          return transport.request("storage.keys");
        }
      },
      ui: {
        resize(height) {
          transport.emit("ui.resize", { height });
        },
        async showNotification(options2) {
          await transport.request("ui.notification", options2);
        },
        closePanel() {
          transport.emit("ui.closePanel", void 0);
        },
        async navigate(path) {
          await transport.request("ui.navigate", { path });
        },
        onWidgetResult(handler) {
          return transport.on("widget.data", handler);
        }
      },
      events: {
        emit(event, data) {
          transport.emit(`ext.${event}`, data);
        },
        on(event, handler) {
          return transport.on(`ext.${event}`, handler);
        }
      },
      onDispose(handler) {
        return transport.on("panel.dispose", () => {
          handler();
        });
      },
      onDidChangeVisibility(handler) {
        return transport.on("panel.visibility", (data) => {
          const v = typeof data === "object" && data !== null && "visible" in data && typeof data.visible === "boolean" ? data.visible : Boolean(data);
          handler(v);
        });
      }
    };
    return client;
  }

  // ui/widget-entry.ts
  function applyThemeTokens(tokens) {
    if (!tokens) return;
    for (const [key, value] of Object.entries(tokens)) {
      if (typeof value === "string" && value.trim()) {
        const k = key.startsWith("--") ? key : `--${key}`;
        document.documentElement.style.setProperty(k, value);
      }
    }
  }
  function format(data) {
    if (data == null) return "(empty)";
    if (typeof data === "string") {
      const t = data.trim();
      try {
        const o = JSON.parse(t);
        if (o && typeof o === "object") {
          if ("message" in o) return String(o.message);
          if ("result" in o) return String(o.result);
          if ("greeting" in o) return String(o.greeting);
        }
      } catch {
      }
      return data;
    }
    return JSON.stringify(data);
  }
  async function main() {
    const client = createExtensionClient();
    await client.whenReady();
    const out = document.getElementById("result-text");
    if (!out) return;
    const t = await client.theme.getTheme();
    applyThemeTokens(t.tokens);
    client.theme.onThemeChange((th) => applyThemeTokens(th.tokens));
    client.ui.onWidgetResult((data) => {
      out.textContent = format(data);
      client.ui.resize(document.body.scrollHeight + 8);
    });
    client.ui.resize(document.body.scrollHeight + 8);
  }
  void main().catch((e) => {
    const out = document.getElementById("result-text");
    if (out) out.textContent = String(e);
  });
})();
