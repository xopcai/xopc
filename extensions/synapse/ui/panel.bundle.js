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
  var DEF_AGENTS = [
    { id: "tl", icon: "\u{1F4A1}", label: "TL", name: "tech-lead", role: "\u534F\u8C03", trust: 5, status: "active", narrative: "\u534F\u8C03\u610F\u56FE\u4E2D", progress: null },
    { id: "be", icon: "\u{1F5A5}", label: "BE", name: "dev-backend", role: "\u540E\u7AEF", trust: 4, status: "active", narrative: "\u5199 API \u4E2D...", progress: 80 },
    { id: "re", icon: "\u{1F50D}", label: "RE", name: "reviewer", role: "\u5BA1\u67E5", trust: 4, status: "active", narrative: "\u5BA1\u67E5\u5BC6\u7801\u91CD\u7F6E\u8BBE\u8BA1", progress: 45 },
    { id: "qa", icon: "\u{1F9EA}", label: "QA", name: "tester", role: "\u6D4B\u8BD5", trust: 3, status: "idle", narrative: "\u7B49 API \u4E2D \u2615", progress: null },
    { id: "do", icon: "\u{1F4DD}", label: "DO", name: "docs", role: "\u6587\u6863", trust: 4, status: "idle", narrative: "\u7A7A\u95F2", progress: null },
    { id: "dep", icon: "\u{1F680}", label: "DEP", name: "deployer", role: "\u90E8\u7F72", trust: 4, status: "idle", narrative: "\u7B49\u90E8\u7F72\u4EFB\u52A1", progress: null }
  ];
  function defaultState() {
    const nid2 = /* @__PURE__ */ (() => {
      let i = 100;
      return () => ++i;
    })();
    return {
      cards: [
        { i: nid2(), c: 1, t: "\u5BC6\u7801\u91CD\u7F6E API \u5F00\u53D1", l: "p0", d: "\u5B9E\u73B0 POST /api/auth/reset \u63A5\u53E3", ag: [{ ic: "\u{1F5A5}", n: "dev-backend", s: "active", p: 80 }, { ic: "\u{1F50D}", n: "reviewer", s: "active", p: 45 }], tg: ["\u540E\u7AEF", "API"], al: "\u7B49\u4F60\u51B3\u7B56", pr: 65 },
        { i: nid2(), c: 2, t: "API \u8BBE\u8BA1\u5BA1\u67E5", l: "p1", d: "\u5BA1\u67E5\u5BC6\u7801\u91CD\u7F6E\u63A5\u53E3\u5B89\u5168\u6027\uFF0CToken \u7B56\u7565\u3001\u9891\u7387\u9650\u5236", ag: [{ ic: "\u{1F50D}", n: "reviewer", s: "active", p: 45 }], tg: ["\u5BA1\u67E5", "\u5B89\u5168"], pr: 45 },
        { i: nid2(), c: 0, t: "\u6D4B\u8BD5\u7528\u4F8B\u7F16\u5199", l: "p1", d: "\u8986\u76D6\u6B63\u5E38/\u5F02\u5E38\u6D41\u7A0B\uFF0CToken \u8FC7\u671F\u3001\u9891\u7387\u9650\u5236", ag: [{ ic: "\u{1F9EA}", n: "tester", s: "idle", p: 0 }], tg: ["\u6D4B\u8BD5"], pr: 0 },
        { i: nid2(), c: 1, t: "\u767B\u5F55\u8D85\u65F6 Bug \u4FEE\u590D", l: "p2", d: "session \u8D85\u65F6\u65F6\u95F4\u914D\u7F6E\u9519\u8BEF", ag: [{ ic: "\u{1F5A5}", n: "dev-backend", s: "active", p: 100 }], tg: ["\u540E\u7AEF", "Bug"], pr: 100 },
        { i: nid2(), c: 3, t: "\u7528\u6237\u53CD\u9988\u9875\u9762\u91CD\u6784 - \u8BBE\u8BA1", l: "p2", d: "\u6574\u7406\u7528\u6237\u53CD\u9988\u6570\u636E\uFF0C\u786E\u5B9A\u91CD\u6784\u8303\u56F4", ag: [{ ic: "\u{1F4DD}", n: "docs", s: "idle", p: 30 }, { ic: "\u{1F4A1}", n: "tech-lead", s: "active", p: 60 }], tg: ["\u524D\u7AEF", "\u8BBE\u8BA1"], pr: 100 },
        { i: nid2(), c: 0, t: "\u5BC6\u7801\u91CD\u7F6E\u524D\u7AEF\u9875\u9762", l: "p0", d: "\u5FD8\u8BB0\u5BC6\u7801 \u2192 \u8F93\u5165\u90AE\u7BB1 \u2192 \u8BBE\u7F6E\u65B0\u5BC6\u7801\u7684\u5B8C\u6574\u6D41\u7A0B", ag: [{ ic: "\u{1F3A8}", n: "frontend", s: "idle", p: 0 }], tg: ["\u524D\u7AEF", "UI"], pr: 0 },
        { i: nid2(), c: 3, t: "\u767B\u5F55\u8D85\u65F6 Bug \u9A8C\u8BC1", l: "p2", d: "\u6D4B\u8BD5\u901A\u8FC7\uFF0C\u7B49\u5F85\u90E8\u7F72", ag: [{ ic: "\u{1F9EA}", n: "tester", s: "idle", p: 100 }, { ic: "\u{1F5A5}", n: "dev-backend", s: "idle", p: 100 }], tg: ["\u6D4B\u8BD5"], pr: 100 }
      ],
      decisions: [
        { i: nid2(), l: "p0", t: "email \u5B57\u6BB5\u65E0\u552F\u4E00\u7D22\u5F15", x: "@dev-backend: \u7528\u6237\u8868\u6709 2 \u6761\u76F8\u540C\u90AE\u7BB1\u7684\u8BB0\u5F55", b: [{ l: "\u6E05\u7406 + \u52A0\u7D22\u5F15", c: "rc", m: "\u2705 \u6E05\u7406\u810F\u6570\u636E" }, { l: "\u4EE3\u7801\u53D6\u6700\u8FD1", c: "", m: "\u2705 \u4EE3\u7801\u5C42\u5904\u7406" }] },
        { i: nid2(), l: "p1", t: "\u8FDE\u7EED\u91CD\u7F6E Token \u7B56\u7565", x: "@tester: \u7B2C\u4E00\u4E2A Token \u662F\u5426\u7ACB\u5373\u5931\u6548\uFF1F", b: [{ l: "\u7ACB\u5373\u5931\u6548 \u2713", c: "rc", m: "\u2705 \u7B2C\u4E00\u4E2A\u5931\u6548" }, { l: "\u540C\u65F6\u6709\u6548", c: "", m: "\u2705 \u540C\u65F6\u6709\u6548" }] }
      ],
      activity: [
        { t: "10:52", x: '<span class="hl">@tester</span> \u5B8C\u6210\u6D4B\u8BD5\u7528\u4F8B\u7F16\u5199' },
        { t: "10:48", x: '<span class="dn">\u2705</span> \u4FEE\u767B\u5F55 Bug \u5B8C\u6210' },
        { t: "10:45", x: '<span class="hl">@michael</span> \u521B\u5EFA\u300C\u5BC6\u7801\u91CD\u7F6E\u300D', nb: true },
        { t: "10:42", x: '<span class="hl">@tech-lead</span> \u62C6\u5206\u4E3A 4 \u4E2A\u5B50\u4EFB\u52A1' },
        { t: "10:30", x: '<span class="hl">@reviewer</span> \u63D0\u4EA4 API \u5BA1\u67E5\u610F\u89C1' }
      ],
      agents: JSON.parse(JSON.stringify(DEF_AGENTS)),
      tick: 0
    };
  }
  function injectCSS() {
    const s = document.createElement("style");
    s.textContent = `
    * { box-sizing:border-box;margin:0;padding:0 }
    body {
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
      background:var(--s-bg);color:var(--s-fg);
      overflow:hidden;height:100vh;
      transition:background .3s,color .3s;
    }
    .app { display:flex;flex-direction:column;height:100vh;max-width:100%; }
    .tb { display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--s-bs);flex-shrink:0; }
    .tb-l { display:flex;align-items:center;gap:10px; }
    .logo { font-size:16px;font-weight:700;color:var(--s-ac);letter-spacing:-.02em; }
    .badge { font-size:10px;color:var(--s-s);background:var(--s-bh);padding:1px 8px;border-radius:99px;border:1px solid var(--s-bs); }
    .tb-r { display:flex;align-items:center;gap:8px; }
    .tb-r button {
      padding:5px 12px;border-radius:99px;font-size:11px;font-weight:600;
      border:1px solid var(--s-bd);background:var(--s-pn);color:var(--s-fg);
      cursor:pointer;transition:all .15s;
    }
    .tb-r button:hover { background:var(--s-bh); }
    .tb-r button.pri { background:var(--s-ac);color:#fff;border-color:var(--s-ac); }
    .tb-r button.pri:hover { background:var(--s-ac2); }
    .bw { flex:1;min-height:0;padding:12px 16px 8px;overflow-x:auto;overflow-y:hidden; }
    .board { display:flex;gap:12px;height:100%;min-width:min-content; }
    .col { flex:0 0 260px;display:flex;flex-direction:column;border:1px solid var(--s-bs);border-radius:10px;max-height:100%; }
    .ch { display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;flex-shrink:0; }
    .ch .ct { font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px; }
    .ch .cc { font-size:11px;color:var(--s-t);background:var(--s-bh);padding:0 6px;border-radius:99px;line-height:18px; }
    .ch .co { font-size:15px;color:var(--s-t);cursor:pointer;line-height:1; }
    .ch .co:hover { color:var(--s-fg); }
    .cb { flex:1;overflow-y:auto;padding:4px 8px 8px;display:flex;flex-direction:column;gap:8px; }
    .card { background:var(--s-pn);border:1px solid var(--s-bs);border-radius:8px;padding:10px 12px;cursor:pointer;transition:all .15s;flex-shrink:0; }
    .card:hover { border-color:var(--s-bd);box-shadow:0 1px 3px rgba(0,0,0,.06); }
    .card .pl { font-size:10px;font-weight:700;letter-spacing:.04em;margin-bottom:4px; }
    .card .pl.p0 { color:var(--s-r); }
    .card .pl.p1 { color:var(--s-y); }
    .card .pl.p2 { color:var(--s-b); }
    .card .ctt { font-size:13px;font-weight:600;margin-bottom:6px;line-height:1.4; }
    .card .cd { font-size:11px;color:var(--s-s);margin-bottom:8px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
    .card .pm { height:3px;border-radius:2px;background:var(--s-bs);overflow:hidden;margin-bottom:6px; }
    .card .pm .f { height:100%;border-radius:2px;background:var(--s-ac);transition:width .6s; }
    .card .cag { display:flex;align-items:center;gap:4px;margin-bottom:6px;flex-wrap:wrap; }
    .card .cag .ca { display:flex;align-items:center;gap:3px;font-size:10px;background:var(--s-bh);padding:2px 5px;border-radius:4px; }
    .card .cag .ca .dot { width:5px;height:5px;border-radius:50%; }
    .card .cag .ca .dot.gr { background:var(--s-g); }
    .card .cag .ca .dot.ac { background:var(--s-ac);animation:bp2 1.5s ease-in-out infinite; }
    .card .cf { display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--s-t); }
    .card .cf .tgs { display:flex;gap:4px; }
    .card .cf .tag { font-size:9px;padding:1px 5px;border-radius:3px;background:var(--s-bh); }
    .card .cf .tag.al { color:var(--s-r);background:var(--s-r2);font-weight:600; }
    @keyframes bp2 { 0%,100%{box-shadow:0 0 3px rgba(217,119,78,.3)} 50%{box-shadow:0 0 8px rgba(217,119,78,.6)} }
    .rp { flex:0 0 280px;display:flex;flex-direction:column;gap:10px;max-height:100%; }
    .rp-l { border-right:1px solid var(--s-bs);padding:0 12px 0 0; }
    .rp-r { border-left:1px solid var(--s-bs);padding:0 0 0 12px; }
    .ps { display:flex;flex-direction:column; }
    .ph { display:flex;align-items:center;justify-content:space-between;padding:0 4px 6px;flex-shrink:0; }
    .ph .pt { font-size:11px;font-weight:600;color:var(--s-s);letter-spacing:.03em;text-transform:uppercase; }
    .ph .pa { font-size:10px;color:var(--s-ac);cursor:pointer; }
    .pb { flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:5px; }
    .di { background:var(--s-pn);border:1px solid var(--s-bs);border-radius:8px;padding:10px 12px;transition:all .3s;flex-shrink:0; }
    .di.rs { opacity:.4;transform:translateX(20px);pointer-events:none; }
    .di .dl { font-size:9px;font-weight:700;letter-spacing:.05em; }
    .di .dl.l0 { color:var(--s-r); }
    .di .dl.l1 { color:var(--s-y); }
    .di .dt { font-size:12px;font-weight:600;margin:2px 0 4px; }
    .di .dx { font-size:11px;color:var(--s-s);line-height:1.5;margin-bottom:6px; }
    .di .db { display:flex;gap:4px;flex-wrap:wrap; }
    .di .db button {
      font-size:10px;padding:3px 8px;border-radius:5px;
      border:1px solid var(--s-bd);background:var(--s-pn);color:var(--s-fg);
      cursor:pointer;font-weight:500;transition:all .12s;
    }
    .di .db button:hover { background:var(--s-bh); }
    .di .db button.rc { border:1.5px solid var(--s-ac);background:var(--s-a2);color:var(--s-ac); }
    .di .db button.rc:hover { background:var(--s-ac);color:#fff; }
    .ai { display:flex;align-items:flex-start;gap:6px;padding:3px 6px;border-radius:4px;font-size:11px;line-height:1.5;transition:background .15s;animation:si .3s ease-out;flex-shrink:0; }
    .ai:hover { background:var(--s-bh); }
    .ai .t { color:var(--s-t);font-size:9px;min-width:28px;font-family:monospace;flex-shrink:0; }
    .ai .c { flex:1; }
    .ai .c .hl { color:var(--s-ac);font-weight:500; }
    .ai .c .dn { color:var(--s-g);font-weight:500; }
    .ai .c .nb { display:inline-block;background:var(--s-ac);color:#fff;font-size:7px;font-weight:700;padding:1px 3px;border-radius:3px;margin-left:3px;vertical-align:middle; }
    @keyframes si { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
    .dw { flex-shrink:0;padding:6px 16px 12px; }
    .dk { display:flex;align-items:flex-end;justify-content:center;gap:6px;padding:8px 16px;background:var(--s-pn);border-radius:10px;border:1px solid var(--s-bs); }
    .d2 { display:flex;flex-direction:column;align-items:center;cursor:pointer;position:relative;padding:2px 5px;border-radius:8px;transition:all .2s; }
    .d2:hover { transform:translateY(-4px) scale(1.06); }
    .d2 .bx { width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--s-pn);border:1px solid var(--s-bs);position:relative; }
    .d2 .rg { position:absolute;bottom:-2px;right:-2px;width:9px;height:9px;border-radius:50%;border:2px solid var(--s-pn); }
    .d2 .rg.on { background:var(--s-ac);animation:bp2 1.5s ease-in-out infinite; }
    .d2 .rg.off { background:var(--s-bd); }
    .d2 .lb { font-size:9px;font-weight:500;color:var(--s-t);margin-top:2px;white-space:nowrap; }
    .dd { width:1px;height:26px;background:var(--s-bs);align-self:center; }
    .dc { position:fixed;bottom:52px;right:16px;z-index:50;display:flex;gap:4px; }
    .dc button {
      background:var(--s-pn);border:1px solid var(--s-bd);border-radius:99px;padding:4px 10px;
      font-size:10px;color:var(--s-t);cursor:pointer;transition:all .2s;backdrop-filter:blur(8px);
    }
    .dc button:hover { border-color:var(--s-ac);color:var(--s-ac);background:var(--s-a2); }
    .dc button.run { border-color:var(--s-ac);color:var(--s-ac);background:var(--s-a2); }
    .mo { position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:300;backdrop-filter:blur(2px); }
    .mo-c { background:var(--s-pn);border:1px solid var(--s-bd);border-radius:10px;padding:20px;min-width:360px;max-width:480px;box-shadow:0 8px 30px rgba(0,0,0,.15); }
    .mo-c h3 { font-size:15px;font-weight:700;margin-bottom:14px; }
    .mo-c input,.mo-c textarea,.mo-c select { width:100%;padding:8px 10px;margin-bottom:10px;border:1px solid var(--s-bd);border-radius:6px;font-size:13px;font-family:inherit;background:var(--s-bg);color:var(--s-fg);outline:none; }
    .mo-c textarea { height:80px;resize:vertical; }
    .mo-c input:focus,.mo-c textarea:focus { border-color:var(--s-ac);box-shadow:0 0 0 2px var(--s-a2); }
    .mo-c .mo-btns { display:flex;gap:8px;justify-content:flex-end;margin-top:4px; }
    .mo-c .mo-btns button { padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;border:1px solid var(--s-bd);background:var(--s-pn);color:var(--s-fg);cursor:pointer; }
    .mo-c .mo-btns button.pri { background:var(--s-ac);color:#fff;border-color:var(--s-ac); }
    .empty { display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px;gap:16px;height:100%; }
    .empty .bi { font-size:48px; }
    .empty h1 { font-size:22px;font-weight:700; }
    .empty p { font-size:13px;color:var(--s-s);max-width:400px;line-height:1.7; }
    .empty .demo-box { background:var(--s-pn);border:1px solid var(--s-bs);border-radius:10px;padding:20px;width:100%;max-width:480px;text-align:left; }
    .empty .demo-box .dlbl { font-size:11px;font-weight:600;color:var(--s-t);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em; }
    .empty .steps { display:flex;flex-direction:column;gap:10px; }
    .empty .step { display:flex;align-items:flex-start;gap:10px; }
    .empty .step .sn { width:24px;height:24px;border-radius:50%;background:var(--s-a2);color:var(--s-ac);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;border:1px solid var(--s-ac); }
    .empty .step .sc .st { font-size:13px;font-weight:600;margin-bottom:2px; }
    .empty .step .sc .sd { font-size:11px;color:var(--s-s);line-height:1.6; }
    .empty .inp { width:100%;margin-top:12px;padding:9px 12px;border:1px solid var(--s-bd);border-radius:8px;font-size:13px;background:var(--s-bg);color:var(--s-fg);outline:none;transition:border-color .2s; }
    .empty .inp:focus { border-color:var(--s-ac);box-shadow:0 0 0 3px var(--s-a2); }
    .empty .links { display:flex;gap:12px;font-size:12px; }
    .empty .links a { color:var(--s-ac);text-decoration:none;cursor:pointer; }
    .empty .links a:hover { text-decoration:underline; }
    .toast { position:fixed;top:12px;left:50%;transform:translateX(-50%) translateY(-20px);background:var(--s-pn);border:1px solid var(--s-g);border-radius:10px;padding:8px 16px;box-shadow:0 4px 12px rgba(0,0,0,.08);opacity:0;transition:all .35s;z-index:200;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;pointer-events:none;backdrop-filter:blur(12px); }
    .toast.show { opacity:1;transform:translateX(-50%) translateY(0); }
    ::-webkit-scrollbar { width:3px;height:3px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:var(--s-bs);border-radius:2px; }
  `;
    document.head.appendChild(s);
  }
  function applyLightTokens() {
    const r = document.documentElement.style;
    r.setProperty("--s-bg", "#F5F3F0");
    r.setProperty("--s-pn", "#FFFFFF");
    r.setProperty("--s-bh", "#EFEBE4");
    r.setProperty("--s-a2", "#FDF0E8");
    r.setProperty("--s-bs", "#EBE5DC");
    r.setProperty("--s-bd", "#D5CDC2");
    r.setProperty("--s-fg", "#2D2A24");
    r.setProperty("--s-s", "#7A7268");
    r.setProperty("--s-t", "#9C9488");
    r.setProperty("--s-ac", "#D9774E");
    r.setProperty("--s-ac2", "#C96A3F");
    r.setProperty("--s-g", "#6B9E8A");
    r.setProperty("--s-y", "#D9A85C");
    r.setProperty("--s-r", "#C9705C");
    r.setProperty("--s-r2", "#F8EDE8");
    r.setProperty("--s-b", "#7AA9C8");
  }
  function applyDarkTokens() {
    const r = document.documentElement.style;
    r.setProperty("--s-bg", "#1C1A18");
    r.setProperty("--s-pn", "#2B2825");
    r.setProperty("--s-bh", "#3A3632");
    r.setProperty("--s-a2", "#3A2A20");
    r.setProperty("--s-bs", "#3A3632");
    r.setProperty("--s-bd", "#48443E");
    r.setProperty("--s-fg", "#F0EDE8");
    r.setProperty("--s-s", "#A9A296");
    r.setProperty("--s-t", "#8C8579");
    r.setProperty("--s-ac", "#E8926C");
    r.setProperty("--s-ac2", "#D9774E");
    r.setProperty("--s-g", "#7FB8A2");
    r.setProperty("--s-y", "#D4A454");
    r.setProperty("--s-r", "#D98874");
    r.setProperty("--s-r2", "#30201C");
    r.setProperty("--s-b", "#8FBFDE");
  }
  function applyTheme(mode) {
    if (mode === "dark") applyDarkTokens();
    else applyLightTokens();
  }
  var state = defaultState();
  var nid = 200;
  function newId() {
    return ++nid;
  }
  function nowTime() {
    const d = /* @__PURE__ */ new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  var demoRunning = false;
  var demoInterval = null;
  function renderBoard() {
    ["b0", "b1", "b2", "b3"].forEach((id, ci) => {
      const el = document.getElementById(id);
      if (!el) return;
      const cs = state.cards.filter((c) => c.c === ci);
      if (!cs.length) {
        el.innerHTML = '<div style="padding:16px 8px;text-align:center;color:var(--s-t);font-size:11px;">\u6682\u65E0\u4EFB\u52A1</div>';
        return;
      }
      el.innerHTML = cs.map((c) => {
        const lc = c.l === "p0" ? "p0" : c.l === "p1" ? "p1" : "p2";
        const ags = c.ag.map((a) => {
          const dt = a.s === "active" ? "ac" : "gr";
          return `<span class="ca">${a.ic}<span class="dot ${dt}"></span></span>`;
        }).join("");
        const pg = c.pr > 0 && c.pr < 100 ? `<div class="pm"><div class="f" style="width:${c.pr}%"></div></div>` : "";
        const ah = c.al ? `<span class="tag al">\u26A0\uFE0F ${c.al}</span>` : "";
        const ts = c.tg.map((t) => `<span class="tag">${t}</span>`).join("");
        return `<div class="card"><div class="pl ${lc}">${c.l.toUpperCase()}</div><div class="ctt">${c.t}</div><div class="cd">${c.d}</div>${pg}<div class="cag">${ags}</div><div class="cf"><div class="tgs">${ts}${ah}</div><span>#${c.i}</span></div></div>`;
      }).join("");
    });
    ["0", "1", "2", "3"].forEach((i) => {
      const e = document.getElementById("c" + i);
      if (e) e.textContent = String(state.cards.filter((c) => c.c === +i).length);
    });
  }
  function renderDecisions() {
    const el = document.getElementById("dl");
    if (!el) return;
    if (!state.decisions.length) {
      el.innerHTML = '<div style="padding:12px;text-align:center;color:var(--s-t);font-size:11px;">\u2705 \u65E0\u5F85\u51B3\u7B56</div>';
      return;
    }
    el.innerHTML = state.decisions.map((d) => {
      const bs = d.b.map((b) => `<button class="${b.c}" onclick="window.__synapse_resolve(${d.i},'${b.m}')">${b.l}</button>`).join("");
      return `<div class="di" id="dc_${d.i}"><div class="dl l${d.l === "p0" ? 0 : 1}">${d.l.toUpperCase()}</div><div class="dt">${d.t}</div><div class="dx">${d.x}</div><div class="db">${bs}</div></div>`;
    }).join("");
  }
  function renderActivity() {
    const el = document.getElementById("al");
    if (!el) return;
    el.innerHTML = state.activity.slice(0, 12).map((a) => `<div class="ai"><span class="t">${a.t}</span><span class="c">${a.x}${a.nb ? '<span class="nb">NEW</span>' : ""}</span></div>`).join("");
  }
  function renderDock() {
    const el = document.getElementById("ad");
    if (!el) return;
    el.innerHTML = "";
    state.agents.forEach((ag, i) => {
      if (i === state.agents.length - 1) {
        const d = document.createElement("div");
        d.className = "dd";
        el.appendChild(d);
      }
      const d2 = document.createElement("div");
      d2.className = "d2";
      const rg = ag.status === "active" ? "on" : "off";
      d2.innerHTML = `<div class="bx">${ag.icon}<div class="rg ${rg}"></div></div><div class="lb">${ag.label}</div>`;
      d2.title = `@${ag.name}: ${ag.narrative}`;
      el.appendChild(d2);
    });
  }
  function renderAll() {
    renderBoard();
    renderDecisions();
    renderActivity();
    renderDock();
  }
  var toastTimer;
  function showToast(msg) {
    const el = document.getElementById("tt");
    const tx = document.getElementById("ttx");
    if (!el || !tx) return;
    tx.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2e3);
  }
  function resolveDecision(id, msg) {
    const el = document.getElementById("dc_" + id);
    if (el) el.classList.add("rs");
    showToast(msg);
    setTimeout(() => {
      state.decisions = state.decisions.filter((d) => d.i !== id);
      renderAll();
    }, 350);
  }
  function simTick() {
    state.tick++;
    const t = nowTime();
    state.cards.forEach((c) => {
      if (c.c === 1 || c.c === 2) {
        c.pr = Math.min(100, c.pr + (2 + Math.floor(Math.random() * 4)));
        c.ag.forEach((a) => {
          if (a.p !== void 0) a.p = c.pr;
        });
      }
    });
    if (state.tick % 3 === 0) {
      state.cards.filter((c) => c.c === 1 && c.pr >= 90).forEach((c) => {
        if (Math.random() > 0.5) {
          c.c = 2;
          c.ag = [{ ic: "\u{1F50D}", n: "reviewer", s: "active", p: 30 }];
        }
      });
    }
    if (state.tick % 5 === 0) {
      state.cards.filter((c) => c.c === 2 && c.pr >= 80).forEach((c) => {
        if (Math.random() > 0.5) c.c = 3;
      });
    }
    if (state.tick % 4 === 0 && state.cards.filter((c) => c.c === 0).length < 3) {
      const tp = [{ t: "\u6570\u636E\u5E93\u8FDE\u63A5\u6C60\u4F18\u5316", l: "p1", d: "\u8FDE\u63A5\u6C60\u4E0D\u591F\uFF0C\u9AD8\u5CF0\u671F\u6709\u7B49\u5F85", tg: ["\u540E\u7AEF", "\u6027\u80FD"] }, { t: "\u9519\u8BEF\u9875\u9762\u6837\u5F0F\u7EDF\u4E00", l: "p2", d: "404/500 \u9875\u9762\u6837\u5F0F\u7EDF\u4E00", tg: ["\u524D\u7AEF", "UI"] }, { t: "\u65E5\u5FD7\u91C7\u96C6\u63A5\u5165", l: "p1", d: "\u63A5\u5165\u65B0\u7684\u65E5\u5FD7\u91C7\u96C6\u7CFB\u7EDF", tg: ["\u8FD0\u7EF4"] }];
      const p = tp[Math.floor(Math.random() * tp.length)];
      state.cards.push({ i: newId(), c: 0, t: p.t, l: p.l, d: p.d, ag: [{ ic: "\u{1F4A1}", n: "tech-lead", s: "idle", p: 0 }], tg: p.tg, pr: 0 });
      state.activity.unshift({ t, x: `\u{1F4CB} \u65B0\u4EFB\u52A1\u300C${p.t}\u300D\u5DF2\u521B\u5EFA`, nb: true });
    }
    if (state.tick % 2 === 0) {
      const ms = [`<span class="hl">@dev-backend</span> \u63A8\u8FDB API \u8FDB\u5EA6`, `<span class="hl">@reviewer</span> \u63D0\u4EA4 2 \u6761\u5BA1\u67E5\u610F\u89C1`, `<span class="hl">@tester</span> \u66F4\u65B0\u6D4B\u8BD5\u8BA1\u5212`, `<span class="hl">@tech-lead</span> \u68C0\u67E5\u4EFB\u52A1\u4F9D\u8D56`, `\u{1F4CA} \u5BC6\u7801\u91CD\u7F6E\u529F\u80FD\u8FDB\u5EA6\u66F4\u65B0`];
      state.activity.unshift({ t, x: ms[Math.floor(Math.random() * ms.length)], nb: true });
      if (state.activity.length > 15) state.activity.pop();
    }
    if (state.tick % 6 === 0 && state.decisions.length < 3) {
      const pk = [{ l: "p0", t: "Token \u8FC7\u671F\u65F6\u957F\uFF1F", x: "@reviewer: 15 \u5206\u949F\u662F\u5426\u592A\u77ED\uFF1F", b: [{ l: "15 \u5206\u949F", c: "rc", m: "\u2705 15 \u5206\u949F" }, { l: "30 \u5206\u949F", c: "", m: "\u2705 30 \u5206\u949F" }] }, { l: "p1", t: "\u91CD\u7F6E\u540E\u53D1\u901A\u77E5\u90AE\u4EF6\uFF1F", x: "@tester: \u5BC6\u7801\u91CD\u7F6E\u540E\u662F\u5426\u53D1\u901A\u77E5\uFF1F", b: [{ l: "\u9700\u8981", c: "rc", m: "\u2705 \u53D1\u901A\u77E5" }, { l: "\u4E0D\u9700\u8981", c: "", m: "\u2705 \u4E0D\u53D1" }] }];
      const p = pk[Math.floor(Math.random() * pk.length)];
      p.i = newId();
      state.decisions.push(p);
    }
    if (state.tick % 4 === 0) state.activity.forEach((a) => a.nb = false);
    const be = state.agents.find((a) => a.id === "be");
    const dc = state.cards.filter((c) => c.c === 1);
    if (dc.length > 0 && be) {
      be.status = "active";
      be.progress = dc[0].pr;
      be.narrative = be.progress >= 90 ? "API \u5FEB\u5B8C\u6210\u4E86" : be.progress > 50 ? "\u7F16\u7801\u4E2D\uFF0C\u8FDB\u5EA6\u8FC7\u534A" : "\u5199 API \u4E2D...";
    }
    renderAll();
  }
  function toggleDemo() {
    const btn = document.getElementById("db");
    if (!btn) return;
    if (demoRunning) {
      clearInterval(demoInterval);
      demoRunning = false;
      btn.textContent = "\u25B6\uFE0F \u81EA\u52A8\u6F14\u793A";
      btn.classList.remove("run");
    } else {
      demoRunning = true;
      btn.textContent = "\u23F8 \u6F14\u793A\u4E2D";
      btn.classList.add("run");
      demoInterval = setInterval(simTick, 3500);
      setTimeout(simTick, 500);
    }
  }
  function showModal(html) {
    const mo = document.createElement("div");
    mo.className = "mo";
    mo.innerHTML = html;
    mo.onclick = (e) => {
      if (e.target.className === "mo") mo.remove();
    };
    document.body.appendChild(mo);
    return mo;
  }
  function createTask() {
    const mo = showModal(`
    <div class="mo-c">
      <h3>\u{1F4CB} \u521B\u5EFA\u4EFB\u52A1</h3>
      <input id="mtTitle" placeholder="\u4EFB\u52A1\u6807\u9898\uFF0C\u5982\uFF1A\u4F18\u5316\u767B\u5F55\u9875\u52A0\u8F7D\u901F\u5EA6">
      <textarea id="mtDesc" placeholder="\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09"></textarea>
      <select id="mtPriority"><option value="p2">P2 \u5E38\u89C4</option><option value="p1" selected>P1 \u91CD\u8981</option><option value="p0">P0 \u7D27\u6025</option></select>
      <div class="mo-btns">
        <button onclick="this.closest('.mo')?.remove()">\u53D6\u6D88</button>
        <button class="pri" id="mtSubmit">\u521B\u5EFA</button>
      </div>
    </div>`);
    mo.querySelector("#mtSubmit").addEventListener("click", () => {
      const t = mo.querySelector("#mtTitle").value.trim();
      if (!t) {
        showToast("\u26A0\uFE0F \u8BF7\u8F93\u5165\u6807\u9898");
        return;
      }
      const d = mo.querySelector("#mtDesc").value.trim();
      const pr = mo.querySelector("#mtPriority").value;
      state.cards.push({ i: newId(), c: 0, t, l: pr, d: d || "\u65E0\u63CF\u8FF0", ag: [{ ic: "\u{1F4A1}", n: "tech-lead", s: "idle", p: 0 }], tg: [], pr: 0 });
      state.activity.unshift({ t: nowTime(), x: `\u{1F4CB} \u624B\u52A8\u521B\u5EFA\u300C${t}\u300D`, nb: true });
      mo.remove();
      renderAll();
      showToast("\u2705 \u4EFB\u52A1\u5DF2\u521B\u5EFA");
    });
  }
  function createIntent() {
    const mo = showModal(`
    <div class="mo-c">
      <h3>\u{1F916} \u521B\u5EFA\u610F\u56FE</h3>
      <p style="font-size:12px;color:var(--s-s);margin-bottom:12px;">\u7528\u81EA\u7136\u8BED\u8A00\u63CF\u8FF0\u4F60\u7684\u610F\u56FE\uFF0CAgent \u4F1A\u81EA\u52A8\u62C6\u89E3\u6210\u4EFB\u52A1\u5361\u7247\u3002</p>
      <textarea id="miText" placeholder="\u4F8B\u5982\uFF1A\u4E3A\u767B\u5F55\u6A21\u5757\u589E\u52A0\u8BB0\u4F4F\u5BC6\u7801\u529F\u80FD"></textarea>
      <div class="mo-btns">
        <button onclick="this.closest('.mo')?.remove()">\u53D6\u6D88</button>
        <button class="pri" id="miSubmit">\u53D1\u9001 \u2192</button>
      </div>
    </div>`);
    mo.querySelector("#miSubmit").addEventListener("click", () => {
      const txt = mo.querySelector("#miText").value.trim();
      if (!txt) {
        showToast("\u26A0\uFE0F \u8BF7\u8F93\u5165\u63CF\u8FF0");
        return;
      }
      mo.remove();
      const title = txt.length > 20 ? txt.slice(0, 20) + "..." : txt;
      state.activity.unshift({ t: nowTime(), x: `<span class="hl">@michael</span> \u521B\u5EFA\u610F\u56FE\u300C${title}\u300D`, nb: true });
      state.cards.push({ i: newId(), c: 0, t: title, l: "p1", d: txt, ag: [{ ic: "\u{1F4A1}", n: "tech-lead", s: "active", p: 10 }], tg: ["\u610F\u56FE"], pr: 10 });
      const tl = state.agents.find((a) => a.id === "tl");
      if (tl) {
        tl.status = "active";
        tl.narrative = `\u6B63\u5728\u5206\u6790\u300C${title}\u300D...`;
      }
      state.activity.unshift({ t: nowTime(), x: `<span class="hl">@tech-lead</span> \u5F00\u59CB\u62C6\u89E3\u300C${title}\u300D`, nb: true });
      renderAll();
      showToast("\u{1F916} @tech-lead \u6B63\u5728\u62C6\u89E3...");
      setTimeout(() => {
        state.cards.push({ i: newId(), c: 0, t: "\u540E\u7AEF API \u5F00\u53D1", l: "p1", d: "\u57FA\u4E8E\u610F\u56FE\u62C6\u89E3\u7684\u540E\u7AEF\u4EFB\u52A1", ag: [{ ic: "\u{1F5A5}", n: "dev-backend", s: "idle", p: 0 }], tg: ["\u540E\u7AEF"], pr: 0 });
        state.cards.push({ i: newId(), c: 0, t: "\u524D\u7AEF UI \u5B9E\u73B0", l: "p1", d: "\u57FA\u4E8E\u610F\u56FE\u62C6\u89E3\u7684\u524D\u7AEF\u4EFB\u52A1", ag: [{ ic: "\u{1F3A8}", n: "frontend", s: "idle", p: 0 }], tg: ["\u524D\u7AEF"], pr: 0 });
        state.activity.unshift({ t: nowTime(), x: `<span class="hl">@tech-lead</span> \u62C6\u89E3\u5B8C\u6210\uFF1A2 \u4E2A\u5B50\u4EFB\u52A1`, nb: true });
        const tl2 = state.agents.find((a) => a.id === "tl");
        if (tl2) {
          tl2.status = "idle";
          tl2.narrative = "\u610F\u56FE\u62C6\u89E3\u5B8C\u6210";
        }
        renderAll();
      }, 3e3);
    });
  }
  function showCardDetail(card) {
    const ags = card.ag.map((a) => `${a.ic} @${a.n}`).join(", ");
    const tgs = card.tg.join(", ");
    showModal(`<div class="mo-c">
    <h3>${card.l.toUpperCase()} ${card.t}</h3>
    <p style="font-size:13px;color:var(--s-s);line-height:1.6;margin-bottom:12px;">${card.d}</p>
    <div style="margin-bottom:8px;font-size:12px;color:var(--s-t);">\u8FDB\u5EA6\uFF1A${card.pr}%</div>
    <div style="margin-bottom:8px;font-size:12px;color:var(--s-t);">Agent\uFF1A${ags || "\u65E0"}</div>
    <div style="margin-bottom:12px;font-size:12px;color:var(--s-t);">\u6807\u7B7E\uFF1A${tgs || "\u65E0"}</div>
    <div class="mo-btns">
      <button onclick="this.closest('.mo')?.remove()">\u5173\u95ED</button>
    </div>
  </div>`);
  }
  function buildHTML() {
    const app = document.createElement("div");
    app.className = "app";
    app.innerHTML = `
    <div class="tb"><div class="tb-l"><span class="logo">\u27D0 Synapse</span><span class="badge">MVP</span></div>
    <div class="tb-r"><button onclick="window.__synapse_createIntent()">+ \u521B\u5EFA\u610F\u56FE</button>
    <button class="pri" onclick="window.__synapse_createTask()">+ \u521B\u5EFA\u4EFB\u52A1</button></div></div>
    <div class="bw"><div style="display:flex;height:100%;">
      <div class="rp rp-l">
        <div class="ps" style="flex:1;"><div class="ph"><span class="pt">\u26A0\uFE0F \u9700\u8981\u4F60\u51B3\u7B56</span><span class="pa">\u5168\u90E8 \u2192</span></div><div class="pb" id="dl"></div></div>
        <div class="ps" style="flex:1;"><div class="ph"><span class="pt">\u{1F4CC} \u6D3B\u52A8</span><span class="pa">\u5168\u90E8 \u2192</span></div><div class="pb" id="al"></div></div>
      </div>
      <div class="board">
        <div class="col"><div class="ch"><span class="ct">\u{1F4CB} \u5F85\u529E <span class="cc" id="c0">0</span></span><span class="co">\u22EF</span></div><div class="cb" id="b0"></div></div>
        <div class="col"><div class="ch"><span class="ct">\u{1F504} \u8FDB\u884C\u4E2D <span class="cc" id="c1">0</span></span><span class="co">\u22EF</span></div><div class="cb" id="b1"></div></div>
        <div class="col"><div class="ch"><span class="ct">\u{1F50D} \u5BA1\u67E5\u4E2D <span class="cc" id="c2">0</span></span><span class="co">\u22EF</span></div><div class="cb" id="b2"></div></div>
        <div class="col"><div class="ch"><span class="ct">\u2705 \u5DF2\u5B8C\u6210 <span class="cc" id="c3">0</span></span><span class="co">\u22EF</span></div><div class="cb" id="b3"></div></div>
      </div>
    </div></div>
    <div class="dw"><div class="dk" id="ad"></div></div>
    <div class="toast" id="tt"><span id="ttx">\u5DF2\u8BB0\u5F55</span></div>
    <div class="dc"><button id="db" onclick="window.__synapse_toggleDemo()">\u25B6\uFE0F \u81EA\u52A8\u6F14\u793A</button></div>
  `;
    document.body.appendChild(app);
  }
  async function main() {
    injectCSS();
    const client = createExtensionClient();
    await client.whenReady();
    const theme = await client.theme.getTheme();
    applyTheme(theme.mode);
    client.theme.onThemeChange((t) => {
      applyTheme(t.mode);
    });
    try {
      const saved = await client.storage.get("synapse.board");
      if (saved && saved.cards) {
        state = saved;
        nid = Math.max(200, Math.max(...saved.cards.map((c) => c.i), ...saved.decisions.map((d) => d.i), ...saved.activity.map(() => 0))) + 1;
      }
    } catch {
    }
    buildHTML();
    renderAll();
    window["__synapse_resolve"] = (id, msg) => resolveDecision(id, msg);
    window["__synapse_toggleDemo"] = () => toggleDemo();
    window["__synapse_createTask"] = () => createTask();
    window["__synapse_createIntent"] = () => createIntent();
    document.querySelector(".bw")?.addEventListener("click", function(e) {
      const card = e.target.closest(".card");
      if (!card) return;
      if (e.target.tagName === "BUTTON") return;
      const idText = card.querySelector(".cf span:last-child")?.textContent?.replace("#", "");
      const c = state.cards.find((ca) => ca.i === Number(idText));
      if (c) showCardDetail(c);
    });
    client.events.on("synapse.board-updated", (data) => {
      if (data) {
        state = data;
        renderAll();
      }
    });
    setInterval(async () => {
      try {
        await client.storage.set("synapse.board", state);
      } catch {
      }
    }, 3e3);
    client.ui.resize(document.body.scrollHeight + 24);
  }
  main().catch((e) => {
    document.body.innerHTML = `<pre style="padding:16px;color:#c00;">${String(e)}</pre>`;
  });
})();
