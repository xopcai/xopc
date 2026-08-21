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

  // ui/settings-entry.ts
  async function main() {
    const client = createExtensionClient();
    await client.whenReady();
    const root = document.body;
    root.innerHTML = "";
    root.style.cssText = "font-family:system-ui,sans-serif;margin:0;padding:14px;font-size:13px;line-height:1.45;";
    const h = document.createElement("h1");
    h.style.cssText = "margin:0 0 10px;font-size:15px;";
    h.textContent = "Hello \u2014 Settings (SDK)";
    root.appendChild(h);
    const pre = document.createElement("pre");
    pre.style.cssText = "padding:10px;border-radius:8px;background:rgba(0,0,0,.06);font-size:11px;max-height:10rem;overflow:auto;white-space:pre-wrap;";
    root.appendChild(pre);
    async function refresh() {
      try {
        const c = await client.config.getExtensionConfig();
        pre.textContent = JSON.stringify(c, null, 2);
      } catch (e) {
        pre.textContent = String(e);
      }
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center;";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "greeting";
    inp.value = "Hello";
    inp.style.cssText = "padding:6px 8px;border-radius:6px;border:1px solid #ccc;min-width:8rem;";
    const b1 = document.createElement("button");
    b1.type = "button";
    b1.textContent = "Load config";
    b1.onclick = () => void refresh();
    const b2 = document.createElement("button");
    b2.type = "button";
    b2.textContent = "Save greeting";
    b2.onclick = async () => {
      await client.config.setExtensionConfig({ greeting: inp.value });
      await refresh();
    };
    const b3 = document.createElement("button");
    b3.type = "button";
    b3.textContent = "Record activity";
    b3.onclick = async () => {
      await client.ui.showNotification({ type: "success", title: "Hello settings", message: "Saved from SDK." });
    };
    row.appendChild(b1);
    row.appendChild(inp);
    row.appendChild(b2);
    row.appendChild(b3);
    root.appendChild(row);
    client.theme.onThemeChange((t) => {
      document.documentElement.dataset.mode = t.mode === "dark" ? "dark" : "light";
    });
    await refresh();
    client.ui.resize(document.body.scrollHeight + 20);
  }
  void main().catch((e) => {
    document.body.innerHTML = `<pre>${String(e)}</pre>`;
  });
})();
