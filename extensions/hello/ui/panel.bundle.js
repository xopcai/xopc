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

  // ui/panel-entry.ts
  var DEMO_KEY = "hello_sdk_demo";
  function applyBodyTheme(mode) {
    const dark = mode === "dark";
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    document.body.style.background = dark ? "#1c1c1e" : "#f5f5f7";
    document.body.style.color = dark ? "#f5f5f7" : "#111";
  }
  function section(title) {
    const wrap = document.createElement("section");
    wrap.style.cssText = "margin-bottom:14px;padding:12px;border:1px solid rgba(127,127,127,.35);border-radius:10px;background:rgba(127,127,127,.06);";
    const h = document.createElement("h2");
    h.style.cssText = "margin:0 0 10px;font-size:13px;font-weight:600;";
    h.textContent = title;
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:8px;align-items:flex-start;";
    wrap.appendChild(h);
    wrap.appendChild(body);
    return { wrap, body };
  }
  function pre(text, maxHeight = "120px") {
    const p = document.createElement("pre");
    p.style.cssText = `margin:0;width:100%;max-width:100%;overflow:auto;max-height:${maxHeight};padding:8px;border-radius:8px;font-size:11px;background:rgba(0,0,0,.08);white-space:pre-wrap;word-break:break-word;`;
    p.textContent = text;
    return p;
  }
  function btn(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = "cursor:pointer;border-radius:8px;border:1px solid rgba(127,127,127,.4);padding:6px 12px;font-size:12px;background:transparent;color:inherit;";
    b.addEventListener("click", onClick);
    return b;
  }
  async function main() {
    const client = createExtensionClient();
    await client.whenReady();
    document.body.innerHTML = "";
    applyBodyTheme("light");
    const intro = document.createElement("p");
    intro.style.cssText = "margin:0 0 12px;font-size:12px;opacity:.85;";
    intro.textContent = "This panel bundles @xopcai/extension-ui-sdk. Use the sections below to try each API; open the browser devtools console for extra logs.";
    document.body.appendChild(intro);
    const th = section("theme.get / theme.onThemeChange");
    const thPre = pre("\u2026", "80px");
    th.body.appendChild(thPre);
    try {
      const t = await client.theme.getTheme();
      thPre.textContent = JSON.stringify(t, null, 2);
      applyBodyTheme(t.mode);
    } catch (e) {
      thPre.textContent = String(e);
    }
    client.theme.onThemeChange((t) => {
      thPre.textContent = JSON.stringify(t, null, 2);
      applyBodyTheme(t.mode);
    });
    document.body.appendChild(th.wrap);
    const ag = section("agent.sendMessage / agent.onStreamEvent");
    const agLog = pre("(no run yet)", "140px");
    const agRow = document.createElement("div");
    agRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;width:100%;";
    const agInput = document.createElement("input");
    agInput.type = "text";
    agInput.placeholder = "User message";
    agInput.value = "Reply with one short word only.";
    agInput.style.cssText = "flex:1;min-width:12rem;padding:6px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;";
    let unsubStream;
    agRow.appendChild(agInput);
    agRow.appendChild(
      btn("Send (new session)", async () => {
        agLog.textContent = "";
        try {
          unsubStream?.();
          unsubStream = void 0;
          const { sessionKey } = await client.agent.sendMessage(agInput.value.trim() || "Hi", {
            newSession: true
          });
          agLog.textContent += `sessionKey: ${sessionKey}
`;
          unsubStream = client.agent.onStreamEvent(sessionKey, (ev2) => {
            agLog.textContent += `${JSON.stringify(ev2)}
`;
            agLog.scrollTop = agLog.scrollHeight;
          });
        } catch (e) {
          agLog.textContent += `Error: ${e}
`;
        }
      })
    );
    agRow.appendChild(
      btn("Unsubscribe stream", () => {
        unsubStream?.();
        unsubStream = void 0;
        agLog.textContent += "(unsubscribed)\n";
      })
    );
    ag.body.appendChild(agRow);
    ag.body.appendChild(agLog);
    document.body.appendChild(ag.wrap);
    const se = section("session.list / session.navigateToSession");
    const sePre = pre("\u2026", "100px");
    const skInput = document.createElement("input");
    skInput.type = "text";
    skInput.placeholder = "sessionKey to open";
    skInput.style.cssText = "width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;font-size:11px;";
    se.body.appendChild(
      btn("List sessions", async () => {
        try {
          const list = await client.session.listSessions();
          sePre.textContent = JSON.stringify(list, null, 2);
        } catch (e) {
          sePre.textContent = String(e);
        }
      })
    );
    se.body.appendChild(skInput);
    se.body.appendChild(
      btn("Navigate to sessionKey above", async () => {
        const k = skInput.value.trim();
        if (!k) return;
        await client.session.navigateToSession(k);
      })
    );
    se.body.appendChild(sePre);
    document.body.appendChild(se.wrap);
    const cf = section("config.get / config.set");
    const cfPre = pre("\u2026", "80px");
    const greet = document.createElement("input");
    greet.type = "text";
    greet.placeholder = "greeting patch";
    greet.value = "Hello";
    greet.style.cssText = "padding:6px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;";
    cf.body.appendChild(
      btn("Load config", async () => {
        try {
          const c = await client.config.getExtensionConfig();
          cfPre.textContent = JSON.stringify(c, null, 2);
        } catch (e) {
          cfPre.textContent = String(e);
        }
      })
    );
    cf.body.appendChild(greet);
    cf.body.appendChild(
      btn("Save { greeting }", async () => {
        try {
          await client.config.setExtensionConfig({ greeting: greet.value });
          cfPre.textContent = "(patch sent \u2014 load again to verify)";
        } catch (e) {
          cfPre.textContent = String(e);
        }
      })
    );
    cf.body.appendChild(cfPre);
    document.body.appendChild(cf.wrap);
    const st = section("storage.*");
    const stPre = pre("\u2026", "100px");
    const kIn = document.createElement("input");
    kIn.type = "text";
    kIn.placeholder = "key";
    kIn.value = DEMO_KEY;
    kIn.style.cssText = "padding:6px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;";
    const vIn = document.createElement("input");
    vIn.type = "text";
    vIn.placeholder = "value";
    vIn.value = "demo";
    vIn.style.cssText = kIn.style.cssText;
    const stRow = document.createElement("div");
    stRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;";
    stRow.appendChild(kIn);
    stRow.appendChild(vIn);
    st.body.appendChild(stRow);
    st.body.appendChild(
      btn("get", async () => {
        stPre.textContent = String(await client.storage.get(kIn.value || DEMO_KEY));
      })
    );
    st.body.appendChild(
      btn("set", async () => {
        await client.storage.set(kIn.value || DEMO_KEY, vIn.value);
        stPre.textContent = "set ok";
      })
    );
    st.body.appendChild(
      btn("remove", async () => {
        await client.storage.remove(kIn.value || DEMO_KEY);
        stPre.textContent = "removed";
      })
    );
    st.body.appendChild(
      btn("keys", async () => {
        stPre.textContent = JSON.stringify(await client.storage.keys(), null, 2);
      })
    );
    st.body.appendChild(stPre);
    document.body.appendChild(st.wrap);
    const ui = section("ui.*");
    const uiLine = document.createElement("div");
    uiLine.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
    uiLine.appendChild(
      btn("showNotification", async () => {
        await client.ui.showNotification({
          type: "info",
          title: "Hello extension",
          message: "Notification from the SDK demo."
        });
      })
    );
    uiLine.appendChild(
      btn("navigate \u2192 /chat", async () => {
        await client.ui.navigate("/chat");
      })
    );
    uiLine.appendChild(
      btn("resize container", () => {
        client.ui.resize(Math.min(900, document.body.scrollHeight + 40));
      })
    );
    uiLine.appendChild(
      btn("emit ui.closePanel", () => {
        client.ui.closePanel();
      })
    );
    ui.body.appendChild(uiLine);
    document.body.appendChild(ui.wrap);
    const ev = section("events.emit / events.on (ext.*)");
    const evPre = pre("(waiting for ext.hello-demo from other extension iframes\u2026)", "72px");
    const offEv = client.events.on("hello-demo", (data) => {
      evPre.textContent = `received ext.*: ${JSON.stringify(data)}`;
    });
    ev.body.appendChild(
      btn("emit hello-demo", () => {
        client.events.emit("hello-demo", { from: "hello-panel", t: Date.now() });
      })
    );
    ev.body.appendChild(btn("unsubscribe hello-demo listener", () => offEv()));
    ev.body.appendChild(evPre);
    document.body.appendChild(ev.wrap);
    const lc = section("onDispose / onDidChangeVisibility");
    const lcPre = pre("", "72px");
    client.onDispose(() => {
      lcPre.textContent += "[onDispose]\n";
    });
    client.onDidChangeVisibility((visible) => {
      lcPre.textContent += `visibility: ${visible}
`;
    });
    lc.body.appendChild(lcPre);
    document.body.appendChild(lc.wrap);
    client.ui.resize(Math.min(2e3, document.body.scrollHeight + 24));
  }
  void main().catch((e) => {
    document.body.innerHTML = `<pre style="padding:12px;color:#b00;">${String(e)}</pre>`;
  });
})();
