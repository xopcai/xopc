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
    const theme = await client.theme.getTheme();
    const dark = theme.mode === "dark";
    document.documentElement.style.background = dark ? "#1c1c1e" : "#f5f5f7";
    document.documentElement.style.color = dark ? "#f5f5f7" : "#111";
    document.documentElement.style.fontFamily = '-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI",Roboto,sans-serif';
    document.documentElement.style.padding = "16px";
    document.documentElement.style.fontSize = "13px";
    document.body.innerHTML = `
    <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;">Synapse \u8BBE\u7F6E</h2>
    <p style="color:#888;margin-bottom:16px;font-size:12px;">\u770B\u677F\u884C\u4E3A\u548C\u6F14\u793A\u6A21\u5F0F\u914D\u7F6E\u3002</p>

    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
      <input type="checkbox" id="demoMode" checked style="width:16px;height:16px;">
      <span>\u542F\u7528\u6F14\u793A\u6A21\u5F0F\uFF08\u6A21\u62DF\u6570\u636E\uFF09</span>
    </label>

    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
      <input type="checkbox" id="autoAdvance" checked style="width:16px;height:16px;">
      <span>\u6F14\u793A\u6A21\u5F0F\u4E0B\u81EA\u52A8\u63A8\u8FDB\u8FDB\u5EA6</span>
    </label>

    <button style="margin-top:8px;padding:8px 16px;border-radius:8px;border:1px solid #d0d0d0;background:#fff;cursor:pointer;font-size:13px;"
      onclick="alert('\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF08\u6F14\u793A\uFF09')">\u4FDD\u5B58\u8BBE\u7F6E</button>

    <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;">

    <h3 style="font-size:13px;font-weight:600;margin-bottom:8px;">\u5173\u4E8E</h3>
    <p style="color:#888;font-size:12px;line-height:1.6;">
      Synapse \u662F\u4E00\u4E2A xopc \u6269\u5C55\uFF0C\u5C06\u4EBA \xD7 AI Agent \u534F\u4F5C\u4EE5\u770B\u677F\u5F62\u5F0F\u5448\u73B0\u3002<br>
      \u540E\u7AEF Tool \u6CE8\u518C\u5C06\u5728\u540E\u7EED\u7248\u672C\u4E2D\u652F\u6301\u771F\u5B9E Agent \u9A71\u52A8\u3002
    </p>
  `;
    client.ui.resize(document.body.scrollHeight + 24);
  }
  main().catch((e) => {
    document.body.innerHTML = `<pre style="padding:16px;color:#c00;">${String(e)}</pre>`;
  });
})();
