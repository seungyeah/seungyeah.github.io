"use strict";
(() => {
  // client/config.mjs
  function readConfig(selector) {
    const node = document.querySelector(selector);
    return node ? JSON.parse(node.textContent) : null;
  }

  // client/pwa.mjs
  function registerWorker(config2) {
    if (!globalThis.isSecureContext || !("serviceWorker" in navigator)) return;
    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker.register(config2.workerUrl, { scope: config2.scope, updateViaCache: "none" }).catch(() => {
        });
      },
      { once: true }
    );
  }

  // client/diagram-graph.mjs
  var graphLimits = {
    file: 2 * 1024 * 1024,
    total: 8 * 1024 * 1024,
    count: 128,
    metadata: 128 * 1024
  };
  var exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.sort().join(",");
  function validateDiagramGraph(graph) {
    if (!exact(graph, ["format", "version", "entry", "modules"]) || graph.format !== "layall-mermaid-graph" || graph.version !== 1 || !Array.isArray(graph.modules) || !graph.modules.length || graph.modules.length > graphLimits.count || graph.entry !== graph.modules.length - 1)
      throw new Error("Invalid diagram graph");
    let total = 0;
    const hashes = /* @__PURE__ */ new Set(), names2 = /* @__PURE__ */ new Set();
    for (const [index, node] of graph.modules.entries()) {
      if (!exact(node, ["name", "sha256", "size", "imports"]) || typeof node.name !== "string" || !/^(?:mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[A-Za-z0-9_-]+\.mjs)$/.test(
        node.name
      ) || names2.has(node.name) || !/^[a-f0-9]{64}$/.test(node.sha256) || hashes.has(node.sha256) || !Number.isSafeInteger(node.size) || node.size <= 0 || node.size > graphLimits.file || !Array.isArray(node.imports))
        throw new Error("Invalid diagram module");
      hashes.add(node.sha256);
      names2.add(node.name);
      total += node.size;
      let end = 0;
      for (const ref of node.imports) {
        if (!Array.isArray(ref) || ref.length !== 3 || !ref.every(Number.isSafeInteger) || ref[0] < end || ref[1] <= ref[0] || ref[1] > node.size || ref[2] < 0 || ref[2] >= index)
          throw new Error("Invalid diagram import");
        end = ref[1];
      }
    }
    if (total > graphLimits.total) throw new Error("Diagram graph too large");
    const reached = /* @__PURE__ */ new Set();
    const visit = (index) => {
      if (reached.has(index)) return;
      reached.add(index);
      graph.modules[index].imports.forEach((ref) => visit(ref[2]));
    };
    visit(graph.entry);
    if (reached.size !== graph.modules.length) throw new Error("Unreachable diagram module");
    return graph;
  }

  // client/diagram-loader.mjs
  function diagramURLs(config2, origin) {
    const local = (value, pattern) => {
      if (typeof value !== "string") throw new Error("Missing diagram URL");
      const url = new URL(value, origin);
      if (url.origin !== origin || !/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || !pattern.test(url.pathname))
        throw new Error("Invalid diagram URL");
      return url;
    };
    const script = local(config2?.script, /\/assets\/static\/diagram-[a-f0-9]{64}\.js$/);
    const graph = local(config2?.graph, /\/assets\/static\/mermaid-[a-f0-9]{64}\/graph\.json$/);
    if (script.pathname.slice(0, script.pathname.lastIndexOf("/")) !== graph.pathname.split("/").slice(0, -2).join("/"))
      throw new Error("Diagram asset root mismatch");
    return { script: script.href, graph: graph.href };
  }
  var hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function readDiagramAsset(url, limit, hash, { window: window2 }, signal) {
    const response = await window2.fetch(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal
    });
    if (!response.ok || response.url !== url || Number(response.headers.get("content-length")) > limit || !response.body)
      throw new Error("Diagram asset unavailable");
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit || signal.aborted) throw new Error("Diagram asset limit");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (signal.aborted || hex(await window2.crypto.subtle.digest("SHA-256", bytes)) !== hash)
      throw new Error("Diagram asset integrity");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  function createDiagramLoader(config2, platform) {
    let pending, controller, cached;
    const cancel = () => {
      controller?.abort();
      controller = null;
      pending = null;
    };
    return {
      cancel,
      dispose() {
        cancel();
        cached = null;
      },
      load() {
        if (cached) return Promise.resolve(cached);
        if (pending) return pending;
        const urls = diagramURLs(config2, platform.window.location.origin);
        const current = new platform.window.AbortController();
        controller = current;
        const promise = (async () => {
          const graphHash = urls.graph.match(/mermaid-([a-f0-9]{64})\//)[1];
          const raw = await readDiagramAsset(
            urls.graph,
            graphLimits.metadata,
            graphHash,
            platform,
            current.signal
          );
          const graph = validateDiagramGraph(JSON.parse(raw));
          const sources = new Array(graph.modules.length);
          let next = 0;
          await Promise.all(
            Array.from({ length: Math.min(6, sources.length) }, async () => {
              while (next < sources.length) {
                const index = next++, node = graph.modules[index];
                const url = new URL(node.sha256 + ".mjs", urls.graph).href;
                sources[index] = await readDiagramAsset(
                  url,
                  node.size,
                  node.sha256,
                  platform,
                  current.signal
                );
              }
            })
          );
          if (current.signal.aborted) throw new Error("Diagram load cancelled");
          cached = { graph, sources };
          return cached;
        })().catch((error) => {
          current.abort();
          throw error;
        }).finally(() => {
          if (controller === current) {
            pending = null;
            controller = null;
          }
        });
        pending = promise;
        return promise;
      }
    };
  }

  // client/lifecycle.mjs
  function listeners() {
    const cleanup = [];
    return {
      on(target, type, handler, options) {
        if (!target) return;
        target.addEventListener(type, handler, options);
        cleanup.push(() => target.removeEventListener(type, handler, options));
      },
      dispose() {
        cleanup.splice(0).forEach((remove) => remove());
      }
    };
  }

  // render/text.mjs
  var esc = (value) => String(value ?? "").replace(
    /[&<>\"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]
  );
  var js = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

  // render/theme-data.mjs
  var themeOrder = ["layall", "blog", "minimal", "portfolio", "docs"];
  var themeNames = new Set(themeOrder);
  var tokenSets = {
    root: {
      "font-scale": "1",
      "font-ui": 'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      paper: "#f7f3ea",
      surface: "#fffdf8",
      "surface-2": "#eee7da",
      ink: "#292723",
      muted: "#716d65",
      line: "#ded6c7",
      accent: "#716690",
      "accent-soft": "#e8e1f3",
      shadow: "0 18px 60px rgba(65,55,43,.09)",
      radius: "22px",
      content: "1180px"
    },
    dark: {
      paper: "#1d1c1a",
      surface: "#272521",
      "surface-2": "#33302a",
      ink: "#f2eee6",
      muted: "#bbb3a7",
      line: "#454139",
      accent: "#c8b9ec",
      "accent-soft": "#3b344b",
      shadow: "0 18px 60px rgba(0,0,0,.28)"
    },
    layall: {
      "font-scale": "1",
      "font-ui": '"TmoneyRoundWindRegular","Tmoney RoundWind","티머니 둥근바람",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      paper: "#f6f4f0",
      surface: "#fffdf8",
      "surface-2": "#e8f7fb",
      ink: "#354146",
      muted: "#566b72",
      line: "#d9e4e2",
      accent: "#566b72",
      "accent-soft": "#dff2f6",
      shadow: "0 22px 58px rgba(69,88,93,.13)",
      radius: "20px",
      content: "1180px"
    },
    blog: {
      paper: "#fff",
      surface: "#fff",
      "surface-2": "#f6f8fa",
      ink: "#24292f",
      muted: "#57606a",
      line: "#d0d7de",
      accent: "#286a47",
      "accent-soft": "#ddf4e5",
      radius: "12px"
    },
    minimal: {
      paper: "#fff",
      surface: "#fff",
      "surface-2": "#f5f5f3",
      ink: "#20201e",
      muted: "#74746e",
      line: "#e5e5e0",
      accent: "#20201e",
      "accent-soft": "#efefeb",
      content: "760px"
    },
    portfolio: {
      paper: "#f0efe9",
      surface: "#fbfaf6",
      "surface-2": "#e4e1d8",
      ink: "#242522",
      muted: "#6d7068",
      line: "#d7d4ca",
      accent: "#556846",
      "accent-soft": "#dce6d3",
      radius: "32px"
    },
    docs: {
      paper: "#fbfcfd",
      surface: "#fff",
      "surface-2": "#f1f4f7",
      ink: "#1f2933",
      muted: "#68727e",
      line: "#e1e7ec",
      accent: "#3973a8",
      "accent-soft": "#e5f1fb",
      content: "1380px"
    },
    layallDark: {
      paper: "#17262d",
      surface: "#21343b",
      "surface-2": "#29434c",
      ink: "#edf6f5",
      muted: "#aec4c8",
      line: "#38535c",
      accent: "#aec4c8",
      "accent-soft": "#294b55",
      shadow: "0 22px 58px rgba(0,0,0,.28)"
    }
  };
  var names = { layall: "청록", blog: "초록", minimal: "차콜", portfolio: "올리브", docs: "파랑" };
  var darkAccents = {
    layall: tokenSets.layallDark.accent,
    blog: "#8dcca4",
    minimal: "#d8d8d2",
    portfolio: "#b3c69d",
    docs: "#9ac4e9"
  };
  var palettes = Object.fromEntries(
    themeOrder.map((name) => [
      name,
      {
        name: names[name],
        primary: tokenSets[name].accent,
        dark: darkAccents[name]
      }
    ])
  );
  function darkAccentTokens(name, surface = "var(--surface)") {
    const accent = palettes[name].dark;
    return { accent, "accent-soft": `color-mix(in srgb,${accent} 16%,${surface})` };
  }
  function themeTokens(name, mode) {
    if (!themeOrder.includes(name) || !["light", "dark"].includes(mode))
      throw new Error("unknown theme");
    const tokens = { ...tokenSets.root, ...tokenSets[name] };
    if (mode === "dark") {
      Object.assign(tokens, tokenSets.dark, name === "layall" ? tokenSets.layallDark : {});
      Object.assign(tokens, darkAccentTokens(name, tokens.surface));
    }
    return tokens;
  }

  // client/mermaid-frame.mjs
  function diagramTheme(root, darkSystem = false) {
    const theme = themeOrder.includes(root.dataset.theme) ? root.dataset.theme : "layall";
    const dark = root.dataset.colorMode === "dark" || root.dataset.colorMode === "system" && darkSystem;
    const tokens = themeTokens(theme, dark ? "dark" : "light");
    return {
      theme,
      dark,
      ink: tokens.ink,
      muted: tokens.muted,
      surface: tokens.surface,
      line: tokens.line,
      accent: tokens.accent
    };
  }
  function diagramDocument({ scriptUrl, origin, source, token, colors }) {
    const script = new URL(scriptUrl, origin);
    if (script.origin !== origin || !/^https?:$/.test(script.protocol) || script.username || script.password || script.search || script.hash || !/\/assets\/static\/diagram-[a-f0-9]{64}\.js$/.test(script.pathname))
      throw new Error("Invalid local diagram runtime");
    const csp = `default-src 'none'; script-src ${script.href} blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;background:transparent}body{padding:12px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,sans-serif}#diagram{min-width:0;overflow:auto}svg{display:block;max-width:100%;height:auto;margin:auto}</style></head><body><div id="diagram"></div><script type="application/json" data-mermaid-frame>${js({ source, token, colors })}<\/script><script defer src="${esc(script.href)}"><\/script></body></html>`;
  }

  // client/article-code.mjs
  var diagramStart = /^(?:flowchart\b|graph\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|quadrantChart\b|xychart(?:-beta)?\b|sankey-beta\b|gitGraph\b|C4[A-Za-z]*\b|requirementDiagram\b|packet-beta\b|architecture-beta\b|kanban\b|block-beta\b)/i;
  function codeKind(source, language = "") {
    const name = language.trim().toLowerCase().split(/\s+/)[0];
    const first = source.split("\n").find((line) => line.trim() && !line.trim().startsWith("%%"))?.trim() || "";
    if (name === "mermaid" || !name && diagramStart.test(first))
      return { language: "mermaid", diagram: true };
    return { language: name, diagram: false };
  }
  var VIEWER_MIN_ZOOM = 0.2;
  var VIEWER_MAX_ZOOM = 10;
  var VIEWER_PADDING = 16;
  var VIEWER_MIN_VISIBLE = 48;
  var VIEWER_PAN_START_PX = 4;
  function mountArticleCode(scope, { document: document2, window: window2, importHighlight = (url) => import(url) }, diagramConfig, highlightUrl) {
    if (!scope) return { dispose() {
    } };
    const entries = /* @__PURE__ */ new Map(), events = listeners();
    let highlightPromise;
    const loadHighlight = () => {
      if (!highlightPromise) {
        highlightPromise = Promise.resolve().then(() => {
          const url = new URL(highlightUrl, window2.location.origin);
          if (url.origin !== window2.location.origin || !/^https?:$/.test(url.protocol) || url.search || url.hash || url.username || url.password || !/\/assets\/static\/highlight-[a-f0-9]{64}\.mjs$/.test(url.pathname))
            throw new Error("Invalid highlight asset");
          return importHighlight(url.href);
        }).catch((error) => {
          highlightPromise = void 0;
          throw error;
        });
      }
      return highlightPromise;
    };
    const enhanceCode = (entry) => {
      if (entry.diagram || !entry.language || entry.source.length > 2e5 || entry.highlighted || entry.highlightPending)
        return;
      entry.highlightPending = true;
      void loadHighlight().then(({ highlightCode }) => {
        if (disposed || suspended || entries.get(entry.code) !== entry || !scope.contains(entry.code))
          return;
        const html = highlightCode(entry.source, entry.language);
        if (html !== null) entry.code.innerHTML = html;
        entry.highlighted = true;
      }).catch(() => {
      }).finally(() => {
        entry.highlightPending = false;
      });
    };
    const root = document2.documentElement;
    const loader = createDiagramLoader(diagramConfig, { window: window2 });
    const scheme = window2.matchMedia?.("(prefers-color-scheme: dark)");
    let disposed = false, suspended = false, sequence = 0;
    const discardFrame = (entry) => {
      window2.clearTimeout(entry.timer);
      if (entry.viewer) closeMermaidViewer(entry, { document: document2, window: window2 }, false);
      entry.diagramEvents.dispose();
      if (entry.diagram) {
        entry.diagram.remove();
        entry.diagram = null;
      }
      if (entry.frame) {
        entry.frame.srcdoc = "";
        entry.frame.remove();
        entry.frame = null;
      }
      entry.markup = "";
      if (![...entries.values()].some((item) => item.frame)) loader.cancel();
      entry.pre.hidden = false;
      entry.button.hidden = true;
    };
    const release = (entry) => {
      discardFrame(entry);
      entry.events.dispose();
      entry.code.textContent = entry.source;
      entry.pre.classList.remove("is-wrapped");
      for (const [name, value] of entry.attributes) {
        if (value === null) entry.pre.removeAttribute(name);
        else entry.pre.setAttribute(name, value);
      }
      if (entry.block.isConnected) entry.block.replaceWith(entry.pre);
    };
    const clear = () => {
      entries.forEach(release);
      entries.clear();
    };
    const renderDiagram = (entry) => {
      discardFrame(entry);
      entry.button.hidden = true;
      if (!diagramConfig || !entry.source.trim() || entry.source.length > 1e5) return;
      try {
        const scriptUrl = diagramURLs(diagramConfig, window2.location.origin).script;
        const frame = document2.createElement("iframe");
        const diagram = document2.createElement("div");
        entry.loading = false;
        entry.token = String(++sequence);
        frame.className = "article-diagram";
        frame.title = "Mermaid 다이어그램";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.setAttribute("data-pending", "true");
        diagram.className = "article-diagram-shell";
        diagram.setAttribute("role", "button");
        diagram.setAttribute("tabindex", "0");
        diagram.setAttribute("aria-label", "Mermaid 다이어그램 전체 화면으로 보기");
        entry.diagramClick = () => openMermaidViewer(entry, { document: document2, window: window2 });
        entry.diagramKeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          entry.diagramClick();
        };
        entry.diagramEvents.on(diagram, "click", entry.diagramClick);
        entry.diagramEvents.on(diagram, "keydown", entry.diagramKeydown);
        frame.srcdoc = diagramDocument({
          scriptUrl,
          origin: window2.location.origin,
          source: entry.source,
          token: entry.token,
          colors: diagramTheme(root, scheme?.matches)
        });
        entry.frame = frame;
        entry.diagram = diagram;
        diagram.append(frame);
        entry.block.append(diagram);
        entry.timer = window2.setTimeout(() => {
          discardFrame(entry);
        }, 15e3);
      } catch {
      }
    };
    const scan = () => {
      if (disposed || suspended) return;
      for (const [code, entry] of entries)
        if (!scope.contains(code)) {
          release(entry);
          entries.delete(code);
        }
      for (const code of scope.querySelectorAll("pre > code")) {
        if (entries.has(code)) {
          enhanceCode(entries.get(code));
          continue;
        }
        const pre = code.parentElement, source = code.textContent;
        const kind = codeKind(source, code.dataset.language);
        const block = document2.createElement("div"), toolbar = document2.createElement("div"), label = document2.createElement("span"), button = document2.createElement("button");
        block.className = "article-code";
        toolbar.className = "article-code-tools";
        label.textContent = kind.language || "text";
        button.type = "button";
        button.textContent = kind.diagram ? "코드 보기" : "줄바꿈";
        button.setAttribute("aria-pressed", "false");
        const entry = {
          events: listeners(),
          diagramEvents: listeners(),
          code,
          pre,
          source,
          block,
          button,
          ...kind,
          frame: null,
          diagram: null,
          markup: "",
          viewer: null,
          timer: 0,
          token: "",
          attributes: ["tabindex", "aria-label"].map((name) => [
            name,
            pre.getAttribute(name)
          ]),
          click: null,
          diagramClick: null,
          diagramKeydown: null
        };
        entry.click = () => {
          const pressed = button.getAttribute("aria-pressed") !== "true";
          button.setAttribute("aria-pressed", String(pressed));
          if (kind.diagram && entry.frame) {
            pre.hidden = !pressed;
            if (entry.diagram) entry.diagram.hidden = pressed;
            entry.frame.hidden = pressed;
          } else pre.classList.toggle("is-wrapped", pressed);
        };
        entries.set(code, entry);
        entry.events.on(button, "click", entry.click);
        toolbar.append(label, button);
        pre.before(block);
        block.append(toolbar, pre);
        pre.setAttribute("tabindex", "0");
        pre.setAttribute("aria-label", (kind.language || "일반") + " 코드");
        if (kind.diagram) renderDiagram(entry);
        else enhanceCode(entry);
      }
    };
    events.on(window2, "message", (event) => {
      if (disposed || suspended || event.data?.kind !== "layall:diagram") return;
      for (const entry of entries.values()) {
        if (!entry.frame || event.source !== entry.frame.contentWindow || event.data.token !== entry.token || !scope.contains(entry.code))
          continue;
        if (event.data.state === "load") {
          if (entry.loading) return;
          entry.loading = true;
          const frame = entry.frame, token = entry.token;
          void loader.load().then((modules) => {
            if (!disposed && !suspended && entry.frame === frame && entry.token === token && scope.contains(entry.code))
              frame.contentWindow.postMessage(
                { kind: "layall:diagram-modules", token, ...modules },
                "*"
              );
          }).catch(() => {
            if (entry.frame === frame) discardFrame(entry);
          });
          return;
        }
        if (event.data.state === "error") {
          discardFrame(entry);
          return;
        }
        if (event.data.state !== "ready" || !Number.isFinite(event.data.height)) return;
        window2.clearTimeout(entry.timer);
        entry.markup = typeof event.data.svg === "string" ? event.data.svg : "";
        entry.frame.style.height = Math.max(80, Math.min(4e3, event.data.height)) + "px";
        entry.frame.removeAttribute("data-pending");
        const sourceVisible = entry.button.getAttribute("aria-pressed") === "true";
        entry.pre.hidden = !sourceVisible;
        if (entry.diagram) entry.diagram.hidden = sourceVisible;
        entry.frame.hidden = sourceVisible;
        entry.button.hidden = false;
      }
    });
    const appearance = () => {
      if (!disposed && !suspended)
        entries.forEach((entry) => {
          if (entry.diagram) renderDiagram(entry);
        });
    };
    const observer = new window2.MutationObserver(scan);
    observer.observe(scope, { childList: true, subtree: true });
    const themes = new window2.MutationObserver(appearance);
    themes.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-mode"]
    });
    events.on(scheme, "change", appearance);
    events.on(window2, "layall:article-content", scan);
    events.on(window2, "pagehide", () => {
      suspended = true;
      clear();
    });
    events.on(window2, "pageshow", () => {
      suspended = false;
      scan();
    });
    scan();
    return {
      dispose() {
        disposed = true;
        observer.disconnect();
        themes.disconnect();
        events.dispose();
        clear();
        loader.dispose();
      }
    };
  }
  function openMermaidViewer(entry, { document: document2, window: window2 }) {
    if (entry.viewer || !entry.markup) return;
    const prepared = createViewerSvg(document2, window2, entry.markup);
    if (!prepared) return;
    const dialog = document2.createElement("div");
    const frame = document2.createElement("div");
    const stage = document2.createElement("div");
    const tools = document2.createElement("div");
    const zoomOut = createViewerTool(document2, "zoom-out", "Zoom out");
    const zoomIn = createViewerTool(document2, "zoom-in", "Zoom in");
    const close = createViewerTool(document2, "close", "Close chart viewer");
    const body = document2.body;
    dialog.className = "article-mermaid-viewer";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Mermaid chart");
    dialog.setAttribute("tabindex", "-1");
    dialog.setAttribute("data-mermaid-fullscreen", "true");
    frame.className = "article-mermaid-viewer-frame";
    frame.setAttribute("role", "group");
    frame.setAttribute("aria-label", "Mermaid chart gesture area");
    stage.className = "article-mermaid-viewer-stage";
    tools.className = "article-mermaid-viewer-tools";
    stage.append(document2.importNode(prepared.svg, true));
    frame.append(stage);
    tools.append(zoomOut, zoomIn, close);
    dialog.append(frame, tools);
    body?.append(dialog);
    const viewer = {
      dialog,
      frame,
      stage,
      zoomOut,
      zoomIn,
      close,
      naturalWidth: prepared.width,
      naturalHeight: prepared.height,
      frameWidth: 0,
      frameHeight: 0,
      chartWidth: 1,
      chartHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      adjusted: false,
      pinch: null,
      panGesture: null,
      pointers: /* @__PURE__ */ new Map(),
      resizeObserver: null,
      previousBodyOverflow: body?.style?.overflow ?? "",
      cleanup: null
    };
    entry.viewer = viewer;
    if (body?.style) body.style.overflow = "hidden";
    const viewportWidth = () => {
      const measured = Number(frame.clientWidth);
      if (measured > 0) return measured;
      return Math.max(
        1,
        Number(window2.innerWidth) || Number(document2.documentElement?.clientWidth) || 1
      );
    };
    const viewportHeight = () => {
      const measured = Number(frame.clientHeight);
      if (measured > 0) return measured;
      return Math.max(
        1,
        Number(window2.innerHeight) || Number(document2.documentElement?.clientHeight) || 1
      );
    };
    const chartSize = () => fittedChartSize(
      viewer.naturalWidth,
      viewer.naturalHeight,
      viewer.frameWidth,
      viewer.frameHeight
    );
    const clampPan = (nextX, nextY, nextZoom) => {
      const visualWidth = viewer.chartWidth * nextZoom;
      const visualHeight = viewer.chartHeight * nextZoom;
      return {
        x: clampAxis(
          nextX,
          VIEWER_MIN_VISIBLE - visualWidth,
          viewer.frameWidth - VIEWER_MIN_VISIBLE
        ),
        y: clampAxis(
          nextY,
          VIEWER_MIN_VISIBLE - visualHeight,
          viewer.frameHeight - VIEWER_MIN_VISIBLE
        )
      };
    };
    const renderStage = () => {
      const size = chartSize();
      viewer.chartWidth = size.width;
      viewer.chartHeight = size.height;
      stage.style.width = size.width * viewer.zoom + "px";
      stage.style.height = size.height * viewer.zoom + "px";
      stage.style.left = viewer.panX + "px";
      stage.style.top = viewer.panY + "px";
      zoomOut.disabled = viewer.zoom <= VIEWER_MIN_ZOOM;
      zoomIn.disabled = viewer.zoom >= VIEWER_MAX_ZOOM;
    };
    const applySize = () => {
      viewer.frameWidth = viewportWidth();
      viewer.frameHeight = viewportHeight();
      const size = chartSize();
      viewer.chartWidth = size.width;
      viewer.chartHeight = size.height;
      if (!viewer.adjusted) {
        viewer.panX = (viewer.frameWidth - size.width) / 2;
        viewer.panY = (viewer.frameHeight - size.height) / 2;
      } else {
        const nextPan = clampPan(viewer.panX, viewer.panY, viewer.zoom);
        viewer.panX = nextPan.x;
        viewer.panY = nextPan.y;
      }
      renderStage();
    };
    const applyZoom = (nextZoom, screenX, screenY) => {
      const clamped = clampZoom(nextZoom);
      const contentX = (screenX - viewer.panX) / viewer.zoom;
      const contentY = (screenY - viewer.panY) / viewer.zoom;
      const nextPan = clampPan(
        screenX - contentX * clamped,
        screenY - contentY * clamped,
        clamped
      );
      viewer.zoom = clamped;
      viewer.panX = nextPan.x;
      viewer.panY = nextPan.y;
      viewer.adjusted = true;
      renderStage();
    };
    const changeZoom = (delta) => {
      const next = Math.round((viewer.zoom + delta) * 4) / 4;
      applyZoom(next, viewer.frameWidth / 2, viewer.frameHeight / 2);
    };
    const resetGesture = () => {
      viewer.pinch = null;
      viewer.panGesture = null;
      viewer.pointers.clear();
    };
    const beginPinch = () => {
      const points = [...viewer.pointers.values()];
      const first = points[0];
      const second = points[1];
      if (!first || !second) return;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance <= 0) return;
      const rect = frame.getBoundingClientRect();
      const screenX = (first.x + second.x) / 2 - rect.left;
      const screenY = (first.y + second.y) / 2 - rect.top;
      viewer.pinch = {
        contentX: (screenX - viewer.panX) / viewer.zoom,
        contentY: (screenY - viewer.panY) / viewer.zoom,
        startDistance: distance,
        startZoom: viewer.zoom
      };
      viewer.panGesture = null;
    };
    const updatePinch = (distance, clientX, clientY) => {
      if (!viewer.pinch) return;
      const rect = frame.getBoundingClientRect();
      const nextZoom = clampZoom(
        viewer.pinch.startZoom * (distance / viewer.pinch.startDistance)
      );
      const nextPan = clampPan(
        clientX - rect.left - viewer.pinch.contentX * nextZoom,
        clientY - rect.top - viewer.pinch.contentY * nextZoom,
        nextZoom
      );
      viewer.zoom = nextZoom;
      viewer.panX = nextPan.x;
      viewer.panY = nextPan.y;
      viewer.adjusted = true;
      renderStage();
    };
    const handlePointerDown = (event) => {
      if (event.button !== 0) return;
      viewer.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
      if (viewer.pointers.size === 2) {
        beginPinch();
        frame.setPointerCapture?.(event.pointerId);
        return;
      }
      viewer.panGesture = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: viewer.panX,
        startPanY: viewer.panY
      };
      frame.setPointerCapture?.(event.pointerId);
    };
    const handlePointerMove = (event) => {
      if (!viewer.pointers.has(event.pointerId)) return;
      viewer.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
      if (viewer.pinch && viewer.pointers.size >= 2) {
        if (event.cancelable) event.preventDefault();
        const points = [...viewer.pointers.values()];
        const first = points[0];
        const second = points[1];
        if (!first || !second) return;
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (distance <= 0 || viewer.pinch.startDistance <= 0) return;
        updatePinch(distance, (first.x + second.x) / 2, (first.y + second.y) / 2);
        return;
      }
      const gesture = viewer.panGesture;
      if (!gesture || gesture.pointerId !== event.pointerId || viewer.pinch) return;
      const deltaX = event.clientX - gesture.startClientX;
      const deltaY = event.clientY - gesture.startClientY;
      if (Math.hypot(deltaX, deltaY) < VIEWER_PAN_START_PX) return;
      if (event.cancelable) event.preventDefault();
      const nextPan = clampPan(
        gesture.startPanX + deltaX,
        gesture.startPanY + deltaY,
        viewer.zoom
      );
      viewer.panX = nextPan.x;
      viewer.panY = nextPan.y;
      viewer.adjusted = true;
      renderStage();
    };
    const handlePointerUp = (event) => {
      viewer.pointers.delete(event.pointerId);
      if (viewer.pinch) {
        if (viewer.pointers.size < 2) {
          viewer.pinch = null;
          viewer.panGesture = null;
          viewer.pointers.clear();
        }
        return;
      }
      const gesture = viewer.panGesture;
      viewer.panGesture = null;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - gesture.startClientX;
      const deltaY = event.clientY - gesture.startClientY;
      if (gesture.pointerType !== "mouse" && Math.abs(viewer.zoom - 1) < 1e-3 && deltaY > 88 && deltaY > Math.abs(deltaX) * 1.2)
        closeMermaidViewer(entry, { document: document2, window: window2 }, true);
    };
    const handleWheel = (event) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 15e-4);
        applyZoom(viewer.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      const nextPan = clampPan(
        viewer.panX - event.deltaX,
        viewer.panY - event.deltaY,
        viewer.zoom
      );
      viewer.panX = nextPan.x;
      viewer.panY = nextPan.y;
      viewer.adjusted = true;
      renderStage();
    };
    const trapFocus = (event) => {
      const focusable = [
        ...dialog.querySelectorAll(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document2.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document2.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        closeMermaidViewer(entry, { document: document2, window: window2 }, true);
        return;
      }
      if (event.key === "Tab") trapFocus(event);
    };
    const viewerEvents = listeners();
    const preventContextMenu = (event) => event.preventDefault();
    viewerEvents.on(zoomOut, "click", () => changeZoom(-0.25));
    viewerEvents.on(zoomIn, "click", () => changeZoom(0.25));
    viewerEvents.on(close, "click", () => closeMermaidViewer(entry, { document: document2, window: window2 }, true));
    viewerEvents.on(frame, "pointerdown", handlePointerDown);
    viewerEvents.on(frame, "pointermove", handlePointerMove);
    viewerEvents.on(frame, "pointerup", handlePointerUp);
    viewerEvents.on(frame, "pointercancel", resetGesture);
    viewerEvents.on(frame, "wheel", handleWheel, { passive: false });
    viewerEvents.on(frame, "contextmenu", preventContextMenu);
    viewerEvents.on(window2, "keydown", handleKeydown, true);
    viewerEvents.on(window2, "resize", applySize);
    const ResizeObserverClass = window2.ResizeObserver || globalThis.ResizeObserver;
    if (typeof ResizeObserverClass === "function") {
      viewer.resizeObserver = new ResizeObserverClass(applySize);
      viewer.resizeObserver.observe(frame);
    }
    viewer.cleanup = () => {
      viewer.resizeObserver?.disconnect();
      viewerEvents.dispose();
      resetGesture();
    };
    applySize();
    queueMicrotask(() => {
      if (entry.viewer === viewer) close.focus({ preventScroll: true });
    });
  }
  function closeMermaidViewer(entry, { document: document2 }, restoreFocus = true) {
    const viewer = entry.viewer;
    if (!viewer) return;
    viewer.cleanup?.();
    entry.viewer = null;
    viewer.dialog.remove();
    if (document2.body?.style) document2.body.style.overflow = viewer.previousBodyOverflow;
    if (restoreFocus && entry.diagram && entry.diagram.isConnected !== false && !entry.diagram.hidden)
      entry.diagram.focus({ preventScroll: true });
  }
  function createViewerTool(document2, kind, label) {
    const button = document2.createElement("button");
    button.className = "article-mermaid-viewer-tool";
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.append(createViewerIcon(document2, kind));
    return button;
  }
  function createViewerIcon(document2, kind) {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document2.createElementNS(namespace, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "18");
    icon.setAttribute("height", "18");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    if (kind === "close") {
      const path = document2.createElementNS(namespace, "path");
      path.setAttribute("d", "M5 5l14 14M19 5L5 19");
      icon.append(path);
      return icon;
    }
    const circle = document2.createElementNS(namespace, "circle");
    circle.setAttribute("cx", "11");
    circle.setAttribute("cy", "11");
    circle.setAttribute("r", "7");
    const line = document2.createElementNS(namespace, "path");
    line.setAttribute("d", kind === "zoom-in" ? "M11 8v6M8 11h6M16 16l4 4" : "M8 11h6M16 16l4 4");
    icon.append(circle, line);
    return icon;
  }
  function createViewerSvg(document2, window2, markup) {
    const Parser = window2.DOMParser || globalThis.DOMParser;
    if (typeof Parser !== "function") return null;
    let parsed;
    try {
      parsed = new Parser().parseFromString(markup, "image/svg+xml");
    } catch {
      return null;
    }
    if (parsed.querySelector?.("parsererror")) return null;
    const source = parsed.documentElement;
    if (!source || String(source.tagName).toLowerCase() !== "svg") return null;
    const size = svgNaturalSize(source);
    for (const element of source.querySelectorAll("script, iframe, object, embed"))
      element.remove();
    namespaceSvgIds(source);
    const svg = document2.importNode(source, true);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
    svg.style.maxWidth = "none";
    svg.style.maxHeight = "none";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.overflow = "visible";
    return { svg, width: size.width, height: size.height };
  }
  function namespaceSvgIds(svg) {
    const ids = /* @__PURE__ */ new Map();
    for (const element of [svg, ...svg.querySelectorAll("[id]")]) {
      if (!element.id) continue;
      const next = element.id + "-layall-mermaid-viewer";
      ids.set(element.id, next);
      element.setAttribute("id", next);
    }
    for (const style of svg.querySelectorAll("style"))
      style.textContent = rewriteSvgIdReferences(style.textContent || "", ids);
    for (const element of [svg, ...svg.querySelectorAll("*")]) {
      for (const attr of [...element.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          element.removeAttribute(attr.name);
          continue;
        }
        if ((name === "href" || name === "xlink:href") && attr.value.trim().toLowerCase().startsWith("javascript:")) {
          element.removeAttribute(attr.name);
          continue;
        }
        if (!attr.value.includes("#")) continue;
        const next = rewriteSvgIdReferences(attr.value, ids);
        if (next !== attr.value) element.setAttribute(attr.name, next);
      }
    }
  }
  function rewriteSvgIdReferences(value, ids) {
    if (!value || ids.size === 0) return value;
    const alternatives = [...ids.keys()].sort((left, right) => right.length - left.length).map(escapeRegExp).join("|");
    return value.replace(new RegExp("#(?:" + alternatives + ")(?![\\w-])", "g"), (match) => {
      const next = ids.get(match.slice(1));
      return next ? "#" + next : match;
    });
  }
  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function svgNaturalSize(svg) {
    const viewBox = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0)
      return { width: viewBox[2], height: viewBox[3] };
    const width = positiveLength(svg.getAttribute("width"));
    const height = positiveLength(svg.getAttribute("height"));
    if (width > 0 && height > 0) return { width, height };
    return { width: 800, height: 600 };
  }
  function positiveLength(value) {
    if (!value || value.includes("%")) return 0;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function fittedChartSize(width, height, availableWidth, availableHeight) {
    const fittedWidth = Math.max(1, availableWidth - VIEWER_PADDING * 2);
    const fittedHeight = Math.max(1, availableHeight - VIEWER_PADDING * 2);
    const fit = Math.min(fittedWidth / width, fittedHeight / height);
    return { width: Math.max(1, width * fit), height: Math.max(1, height * fit) };
  }
  function clampZoom(value) {
    return Math.min(VIEWER_MAX_ZOOM, Math.max(VIEWER_MIN_ZOOM, value));
  }
  function clampAxis(value, min, max) {
    if (max < min) return (min + max) / 2;
    return Math.min(max, Math.max(min, value));
  }

  // client/blog-home.mjs
  function createBlogHome({ mount }) {
    const events = listeners();
    const blogState = { tab: "overview", book: "", tags: /* @__PURE__ */ new Set(), enabled: true };
    const bindBlog = () => {
      events.dispose();
      const home = mount?.querySelector("[data-blog-home]");
      if (!home) return;
      const tabs = [...home.querySelectorAll("[data-blog-tab]")];
      const panels = [...home.querySelectorAll("[data-blog-panel]")];
      const books = [...home.querySelectorAll("[data-book-panel]")];
      const tagLinks = [...home.querySelectorAll("[data-blog-tag]")];
      const rows = [...home.querySelectorAll("[data-blog-post]")].map((node) => ({
        node,
        tags: JSON.parse(node.dataset.postTags)
      }));
      const enabled = home.querySelector("[data-tag-enabled]");
      const clear = home.querySelector("[data-tag-clear]");
      const status = home.querySelector("[data-tag-status]");
      const empty = home.querySelector("[data-tag-empty]");
      home.querySelector("[data-blog-tabs]").setAttribute("role", "tablist");
      home.querySelector("[data-blog-controls]").hidden = false;
      const setHash = (value) => {
        try {
          const url = new URL(location.href);
          url.hash = encodeURIComponent(value);
          if (url.hash !== location.hash) history.pushState(null, "", url);
        } catch {
        }
      };
      const plainClick = (event) => !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      const show = (tab, book = "", sync = false) => {
        if (!tabs.some((node) => node.dataset.blogTab === tab)) tab = "overview";
        const selectedBook = books.find((node) => node.id === book);
        if (!selectedBook) book = "";
        blogState.tab = tab;
        blogState.book = book;
        home.dataset.blogActiveTab = tab;
        tabs.forEach((node) => {
          const selected = node.dataset.blogTab === tab;
          node.setAttribute("role", "tab");
          node.setAttribute("aria-controls", node.dataset.blogTab);
          node.setAttribute("aria-selected", String(selected));
          node.tabIndex = selected ? 0 : -1;
        });
        panels.forEach((node) => {
          node.hidden = node.dataset.blogPanel !== tab;
          node.setAttribute("role", "tabpanel");
          node.setAttribute("aria-labelledby", "blog-tab-" + node.dataset.blogPanel);
          node.tabIndex = 0;
        });
        books.forEach((node) => node.hidden = node.id !== book);
        home.querySelector("[data-book-shelf]").hidden = Boolean(book);
        home.querySelector("[data-books-heading]").hidden = !book;
        home.querySelector("[data-books-title]").textContent = selectedBook?.dataset.bookTitle || "";
        home.querySelector("[data-books-count]").textContent = selectedBook ? selectedBook.dataset.bookCount + "개 글" : "";
        home.querySelector("[data-books-period]").textContent = selectedBook?.dataset.bookPeriod || "";
        home.querySelector("[data-books-back]").setAttribute(
          "aria-label",
          (selectedBook ? selectedBook.dataset.bookTitle + " · " : "") + "Books 목차로 돌아가기"
        );
        home.querySelectorAll("[data-blog-book]").forEach((node) => {
          if (node.dataset.blogBook === book) node.setAttribute("aria-current", "true");
          else node.removeAttribute("aria-current");
        });
        if (sync) setHash(book || tab);
      };
      const syncBlogHash = () => {
        let hash = location.hash.slice(1);
        try {
          hash = decodeURIComponent(hash);
        } catch {
        }
        if (books.some((node) => node.id === hash)) show("books", hash);
        else if (!hash) show("overview");
        else if (tabs.some((node) => node.dataset.blogTab === hash)) show(hash);
        else if ([...home.querySelectorAll(".home-introduction [id]")].some(
          (node) => node.id === hash
        ))
          show("about-me");
        else show(blogState.tab, blogState.book);
      };
      tabs.forEach((node, index) => {
        events.on(node, "click", (event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          show(node.dataset.blogTab, "", true);
        });
        events.on(node, "keydown", (event) => {
          let next;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabs.length - 1;
          else if (event.key === " ") {
            event.preventDefault();
            show(node.dataset.blogTab, "", true);
            return;
          } else return;
          event.preventDefault();
          show(tabs[next].dataset.blogTab, "", true);
          tabs[next].focus();
        });
      });
      home.querySelectorAll("[data-blog-book]").forEach(
        (node) => events.on(node, "click", (event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          show("books", node.dataset.blogBook, true);
          books.find((book) => book.id === node.dataset.blogBook)?.focus();
        })
      );
      home.querySelectorAll("[data-books-back]").forEach(
        (node) => events.on(node, "click", (event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          const current = blogState.book;
          show("books", "", true);
          [...home.querySelectorAll("[data-book-shelf] [data-blog-book]")].find((book) => book.dataset.blogBook === current)?.focus();
        })
      );
      events.on(home.querySelector("[data-blog-open-posts]"), "click", (event) => {
        event.preventDefault();
        show("posts", "", true);
        tabs.find((node) => node.dataset.blogTab === "posts")?.focus();
      });
      const filter = () => {
        enabled.checked = blogState.enabled;
        clear.disabled = blogState.tags.size === 0;
        tagLinks.forEach((node) => {
          node.setAttribute("role", "button");
          node.setAttribute("aria-pressed", String(blogState.tags.has(node.dataset.blogTag)));
        });
        let count = 0;
        rows.forEach(({ node, tags }) => {
          node.hidden = blogState.enabled && blogState.tags.size > 0 && !tags.some((tag) => blogState.tags.has(tag));
          if (!node.hidden) count++;
        });
        home.querySelectorAll("[data-docs-group]").forEach(
          (node) => node.hidden = ![...node.querySelectorAll("[data-blog-post]")].some(
            (row) => !row.hidden
          )
        );
        empty.hidden = count !== 0 || rows.length === 0;
        status.textContent = (blogState.enabled ? blogState.tags.size ? "필터 적용" : "전체" : "필터 꺼짐 · 전체") + " " + count + "개 글 / " + rows.length + "개";
      };
      tagLinks.forEach((node) => {
        events.on(node, "click", (event) => {
          event.preventDefault();
          const tag = node.dataset.blogTag;
          blogState.tags.has(tag) ? blogState.tags.delete(tag) : blogState.tags.add(tag);
          filter();
        });
        events.on(node, "keydown", (event) => {
          if (event.key === " ") {
            event.preventDefault();
            node.click();
          }
        });
      });
      events.on(enabled, "change", () => {
        blogState.enabled = enabled.checked;
        filter();
      });
      events.on(clear, "click", () => {
        blogState.tags.clear();
        filter();
      });
      events.on(window, "hashchange", () => syncBlogHash());
      syncBlogHash();
      filter();
    };
    return {
      bind: bindBlog,
      dispose: () => {
        events.dispose();
      }
    };
  }

  // client/discussions.mjs
  function discussionTheme(config2, root, system) {
    const name = Object.hasOwn(config2.themes, root.dataset.theme) ? root.dataset.theme : "layall";
    const mode = root.dataset.colorMode === "dark" || root.dataset.colorMode === "system" && system.matches ? "dark" : "light";
    return config2.themes[name][mode];
  }
  function mountDiscussion(config2) {
    const events = listeners(), frameEvents = listeners(), scriptEvents = listeners();
    let disposed = false, observedFrame;
    const root = document.documentElement;
    const holder = document.querySelector("[data-post-discussion]");
    const container = holder?.querySelector(".giscus");
    if (!container || holder.dataset.giscusMounted === "true") return;
    holder.dataset.giscusMounted = "true";
    const status = holder.querySelector("[data-discussion-status]");
    const retry = holder.querySelector("[data-discussion-retry]");
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const themeUrl = () => discussionTheme(config2, root, system);
    const frame = () => container.querySelector("iframe.giscus-frame");
    let lastTheme = "";
    const sync = (force = false) => {
      if (disposed) return;
      const target = frame();
      const theme = themeUrl();
      if (!target?.contentWindow || !force && theme === lastTheme) return;
      target.contentWindow.postMessage(
        { giscus: { setConfig: { theme } } },
        "https://giscus.app"
      );
      lastTheme = theme;
    };
    const appearance = new MutationObserver(() => sync());
    appearance.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-mode"]
    });
    const frames = new MutationObserver(() => {
      const target = frame();
      if (target !== observedFrame) {
        frameEvents.dispose();
        observedFrame = target;
        frameEvents.on(target, "load", () => sync(true));
        sync(true);
      }
    });
    frames.observe(container, { childList: true });
    events.on(system, "change", () => sync());
    events.on(window, "message", (event) => {
      if (disposed || event.origin !== "https://giscus.app" || event.source !== frame()?.contentWindow || !event.data?.giscus)
        return;
      if (event.data.giscus.error) {
        status.hidden = false;
        status.textContent = "댓글을 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.";
      } else if (event.data.giscus.discussion || Number.isFinite(event.data.giscus.resizeHeight)) {
        status.hidden = true;
        sync();
      }
    });
    const start = () => {
      if (disposed || frame() || holder.querySelector("script[data-layall-giscus]")) return;
      scriptEvents.dispose();
      retry.hidden = true;
      status.hidden = false;
      status.textContent = "댓글·반응 불러오는 중…";
      const script = document.createElement("script");
      script.src = "https://giscus.app/client.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      const attributes = {
        "data-layall-giscus": "true",
        "data-repo": config2.repo,
        "data-repo-id": config2.repoId,
        "data-category": config2.category,
        "data-category-id": config2.categoryId,
        "data-mapping": "number",
        "data-term": String(config2.post.number),
        "data-reactions-enabled": "1",
        "data-emit-metadata": "1",
        "data-input-position": "top",
        "data-theme": themeUrl(),
        "data-lang": config2.lang
      };
      for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
      scriptEvents.on(script, "error", () => {
        if (disposed) return;
        script.remove();
        status.hidden = false;
        status.textContent = "댓글 서비스를 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";
        retry.hidden = false;
      });
      holder.append(script);
    };
    events.on(retry, "click", start);
    start();
    return () => {
      if (disposed) return;
      disposed = true;
      appearance.disconnect();
      frames.disconnect();
      events.dispose();
      frameEvents.dispose();
      scriptEvents.dispose();
      holder.querySelector("script[data-layall-giscus]")?.remove();
      container.replaceChildren();
      delete holder.dataset.giscusMounted;
    };
  }

  // client/docs-navigation.mjs
  function createDocsNavigation({ config: config2, root, mount }) {
    let docsRequest, activeController;
    let disposed = false, generation = 0, timeout;
    const loadingDocs = /* @__PURE__ */ new WeakSet();
    const loadedDocs = /* @__PURE__ */ new WeakSet();
    const docsResource = config2.docsResource;
    const postPrefix = config2.postPrefix;
    const requestDocs = (descriptor) => {
      if (disposed) throw new Error("Navigation disposed");
      const url = new URL(descriptor, location.href);
      if (url.origin !== location.origin || url.pathname !== docsResource || url.search || url.hash || url.username || url.password)
        throw new Error("Invalid navigation resource");
      if (!docsRequest) {
        const controller = new AbortController();
        activeController = controller;
        const requestTimeout = setTimeout(() => controller.abort(), 8e3);
        timeout = requestTimeout;
        docsRequest = fetch(url.href, {
          mode: "same-origin",
          credentials: "omit",
          redirect: "error",
          cache: "no-cache",
          signal: controller.signal
        }).then(async (response) => {
          if (!response.ok || response.url !== url.href)
            throw new Error("Navigation unavailable");
          const text = await response.text();
          if (text.length > 8 * 1024 * 1024) throw new Error("Navigation too large");
          const data = JSON.parse(text);
          if (data.format !== "layall-docs-navigation" || data.version !== 1 || !Array.isArray(data.tree))
            throw new Error("Invalid navigation");
          return data;
        }).catch((error) => {
          docsRequest = null;
          throw error;
        }).finally(() => {
          clearTimeout(requestTimeout);
          if (timeout === requestTimeout) timeout = void 0;
        });
      }
      return docsRequest;
    };
    const docsTree = (entries) => {
      let count = 0;
      const paths = /* @__PURE__ */ new Set();
      const current = location.pathname.endsWith("/index.html") ? location.pathname.slice(0, -10) : location.pathname;
      const branch = (nodes, depth = 0) => {
        if (!Array.isArray(nodes) || depth > 128) throw new Error("Invalid navigation");
        const list = document.createElement("ul");
        for (const node of nodes) {
          if (!node || typeof node.label !== "string" || ++count > 5e4)
            throw new Error("Invalid navigation");
          const li = document.createElement("li");
          if (typeof node.href === "string") {
            const url = new URL(node.href, location.href);
            const segment = url.pathname.slice(postPrefix.length);
            if (url.origin !== location.origin || !url.pathname.startsWith(postPrefix) || !segment.endsWith("/") || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(segment.slice(0, -1)) || url.search || url.hash || url.username || url.password || paths.has(url.pathname) || node.children !== void 0)
              throw new Error("Invalid navigation link");
            paths.add(url.pathname);
            const link = document.createElement("a");
            link.href = url.pathname;
            link.textContent = node.label;
            if (url.pathname === current) link.setAttribute("aria-current", "page");
            li.append(link);
          } else {
            const label = document.createElement("span");
            label.textContent = node.label;
            li.append(label, branch(node.children, depth + 1));
          }
          list.append(li);
        }
        return list;
      };
      return branch(entries);
    };
    const loadDocs = async (nav) => {
      if (disposed || !nav || loadingDocs.has(nav) || loadedDocs.has(nav)) return;
      const tree = nav.querySelector("[data-docs-tree]");
      const status = nav.querySelector("[data-docs-status]");
      if (!tree || !status) return;
      const mounted = generation;
      const current = () => !disposed && mounted === generation && nav.isConnected && mount.contains(nav);
      loadingDocs.add(nav);
      tree.setAttribute("aria-busy", "true");
      let request;
      try {
        request = requestDocs(nav.dataset.docsResource);
        const entries = await request;
        if (!current()) return;
        tree.replaceChildren(docsTree(entries.tree));
        loadedDocs.add(nav);
        status.textContent = "";
      } catch {
        if (docsRequest === request) docsRequest = null;
        if (current())
          status.textContent = "목록을 불러오지 못했습니다. 전체 문서에서 글을 확인하세요.";
      } finally {
        tree.removeAttribute("aria-busy");
        loadingDocs.delete(nav);
      }
    };
    const bindDocs = () => {
      if (root.dataset.theme === "docs")
        mount?.querySelectorAll("[data-docs-resource]").forEach(loadDocs);
    };
    return {
      bind: bindDocs,
      invalidate() {
        generation++;
      },
      loadBooks: async () => (await requestDocs(docsResource)).books,
      dispose() {
        disposed = true;
        generation++;
        clearTimeout(timeout);
        activeController?.abort();
      }
    };
  }

  // client/home-widgets.mjs
  function createHomeWidgets({ mount }) {
    const events = listeners();
    let selectedReaction = "+1";
    const bindReactions = () => {
      const section = document.querySelector("[data-reaction-ranking]");
      if (!section) return;
      const select = (key) => {
        selectedReaction = key;
        section.querySelectorAll("[data-reaction-kind]").forEach(
          (button) => button.setAttribute("aria-pressed", String(button.dataset.reactionKind === key))
        );
        section.querySelectorAll("[data-reaction-panel]").forEach((panel) => panel.hidden = panel.dataset.reactionPanel !== key);
      };
      section.querySelectorAll("[data-reaction-kind]").forEach(
        (button) => events.on(button, "click", () => select(button.dataset.reactionKind))
      );
      select(selectedReaction);
    };
    const bindHeatmap = () => {
      const section = mount?.querySelector("[data-heatmap]");
      if (!section) return;
      const picker = section.querySelector("[data-heatmap-year-picker]");
      const summary = picker?.querySelector("[data-heatmap-year-label]");
      const total = section.querySelector("[data-heatmap-total]");
      const options = [...section.querySelectorAll("[data-heatmap-year-option]")];
      const panels = [...section.querySelectorAll("[data-heatmap-panel]")];
      if (!picker || !summary || !total || !options.length || !panels.length) return;
      const syncExpanded = () => summary.setAttribute("aria-expanded", String(picker.open));
      const select = (year) => {
        const panel = panels.find((node) => node.dataset.heatmapPanel === year);
        if (!panel) return;
        summary.textContent = year;
        summary.setAttribute("aria-controls", panel.id);
        total.textContent = panel.dataset.heatmapTotal + "개 글";
        panels.forEach((node) => node.hidden = node !== panel);
        options.forEach(
          (node) => node.setAttribute("aria-selected", String(node.dataset.heatmapYearOption === year))
        );
        picker.open = false;
        syncExpanded();
      };
      options.forEach(
        (option) => events.on(option, "click", () => select(option.dataset.heatmapYearOption))
      );
      events.on(picker, "toggle", syncExpanded);
      select(
        options.find((option) => option.getAttribute("aria-selected") === "true")?.dataset.heatmapYearOption || options[0].dataset.heatmapYearOption
      );
    };
    return {
      bind() {
        events.dispose();
        bindHeatmap();
        bindReactions();
      },
      dispose: () => events.dispose()
    };
  }

  // client/navigation.mjs
  function mountNavigation({ nav, navToggle, palettePickers }) {
    const events = listeners();
    const tocToggle = document.querySelector("[data-post-toc-toggle]");
    const tocPanel = document.querySelector("[data-post-toc-panel]");
    const tocClose = document.querySelector("[data-post-toc-close]");
    const closeNav = (restore = false) => {
      palettePickers.forEach((picker) => picker.close());
      if (nav?.dataset.open !== "true") return;
      nav.dataset.open = "false";
      navToggle?.setAttribute("aria-expanded", "false");
      if (restore) navToggle?.focus();
    };
    const closeToc = (restore = false) => {
      if (tocPanel?.dataset.open !== "true") return;
      const hadFocus = tocPanel.contains(document.activeElement);
      tocPanel.dataset.open = "false";
      tocPanel.setAttribute("aria-hidden", "true");
      tocToggle?.setAttribute("aria-expanded", "false");
      if (restore || hadFocus) tocToggle?.focus({ preventScroll: true });
    };
    events.on(window, "layall:reading", () => {
      closeNav();
      closeToc();
    });
    events.on(navToggle, "click", () => {
      if (nav?.dataset.open === "true") closeNav();
      else if (nav) {
        nav.dataset.open = "true";
        navToggle.setAttribute("aria-expanded", "true");
        closeToc();
      }
    });
    events.on(tocToggle, "click", () => {
      const open = tocPanel?.dataset.open !== "true";
      closeNav();
      if (!tocPanel) return;
      tocPanel.dataset.open = String(open);
      tocPanel.setAttribute("aria-hidden", String(!open));
      tocToggle.setAttribute("aria-expanded", String(open));
      if (open) (tocPanel.querySelector("a") || tocPanel).focus();
    });
    events.on(tocClose, "click", () => closeToc(true));
    tocPanel?.querySelectorAll('a[href^="#"]').forEach(
      (link) => events.on(link, "click", () => {
        tocPanel.querySelectorAll('[aria-current="location"]').forEach((active) => active.removeAttribute("aria-current"));
        link.setAttribute("aria-current", "location");
        closeToc();
        const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }
      })
    );
    events.on(document, "click", (event) => {
      if (tocPanel?.dataset.open === "true" && !tocPanel.contains(event.target) && !tocToggle?.contains(event.target))
        closeToc();
      if (nav?.dataset.open === "true" && !nav.contains(event.target) && !navToggle?.contains(event.target) && !palettePickers.some((picker) => picker.contains(event.target)))
        closeNav();
    });
    events.on(document, "keydown", (event) => {
      if (event.key === "Escape") {
        const tocWasOpen = tocPanel?.dataset.open === "true";
        const navWasOpen = nav?.dataset.open === "true";
        closeToc(tocWasOpen);
        closeNav(!tocWasOpen && navWasOpen);
      }
      if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
        const input = document.querySelector("[data-search-input]");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
    });
    return {
      dispose() {
        events.dispose();
        closeNav();
        closeToc();
      }
    };
  }

  // client/page-list.mjs
  function mountPageList(bottom, { document: document2, window: window2, loadBook }) {
    const toggle = bottom.querySelector("[data-page-list-toggle]");
    if (!toggle) return { dispose() {
    } };
    const panel = bottom.querySelector("[data-page-list]");
    const list = panel.querySelector("ol");
    const status = panel.querySelector('[role="status"]');
    const retry = panel.querySelector("[data-page-list-retry]");
    const fallback = bottom.querySelector("[data-page-list-fallback]");
    const events = listeners();
    let disposed = false, request = 0, frame = 0;
    toggle.hidden = false;
    fallback.hidden = true;
    const position = () => {
      if (panel.hidden || disposed) return;
      const rect = bottom.getBoundingClientRect();
      const above = Math.max(0, rect.top - 8);
      const below = Math.max(0, document2.documentElement.clientHeight - rect.bottom - 8);
      panel.dataset.placement = above >= below ? "above" : "below";
      panel.style.maxHeight = `${Math.min(384, document2.documentElement.clientHeight * 0.4, Math.max(above, below))}px`;
    };
    const reposition = () => {
      if (frame || panel.hidden || disposed) return;
      frame = window2.requestAnimationFrame(() => {
        frame = 0;
        position();
      });
    };
    const close = (restore = false) => {
      if (panel.hidden) return;
      const hadFocus = panel.contains(document2.activeElement);
      panel.hidden = true;
      request++;
      toggle.setAttribute("aria-expanded", "false");
      if (restore || hadFocus) toggle.focus({ preventScroll: true });
    };
    const populate = async () => {
      const id = ++request;
      status.textContent = "목록을 불러오는 중…";
      status.hidden = false;
      retry.hidden = true;
      try {
        const book = await loadBook();
        if (disposed || panel.hidden || id !== request) return;
        const rows = book.entries.map((entry, index) => {
          const row = document2.createElement("li");
          const link = document2.createElement("a");
          link.href = entry.href;
          link.textContent = entry.label;
          if (index === book.index) link.setAttribute("aria-current", "page");
          row.append(link);
          return row;
        });
        list.replaceChildren(...rows);
        status.hidden = true;
        const current = list.querySelector('[aria-current="page"]');
        if (document2.activeElement === toggle || document2.activeElement === retry) {
          current?.focus({ preventScroll: true });
          if (current)
            panel.scrollTop = Math.max(0, current.offsetTop - panel.clientHeight / 2);
        }
      } catch {
        if (disposed || panel.hidden || id !== request) return;
        status.textContent = "목록을 불러오지 못했어요.";
        retry.hidden = false;
      }
    };
    events.on(toggle, "click", () => {
      if (!panel.hidden) return close(true);
      toggle.focus({ preventScroll: true });
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      position();
      void populate();
    });
    events.on(retry, "click", () => void populate());
    events.on(list, "click", (event) => {
      if (event.target.closest("a")) close();
    });
    events.on(document2, "click", (event) => {
      if (!panel.contains(event.target) && !toggle.contains(event.target)) close();
    });
    events.on(document2, "focusin", (event) => {
      if (!panel.contains(event.target) && !toggle.contains(event.target)) close();
    });
    events.on(document2, "keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        close(true);
      }
    });
    events.on(window2, "layall:reading", () => close());
    events.on(window2, "layall:page-navigation-hide", () => close());
    events.on(window2, "pagehide", () => close());
    events.on(window2, "scroll", reposition, { passive: true });
    events.on(window2, "resize", reposition);
    return {
      dispose() {
        disposed = true;
        close();
        events.dispose();
        if (frame) window2.cancelAnimationFrame(frame);
        panel.style.removeProperty("max-height");
        delete panel.dataset.placement;
        list.replaceChildren();
        toggle.hidden = true;
        fallback.hidden = false;
      }
    };
  }

  // client/reading-bar.mjs
  function readingBarPosition(anchorTop, headerHeight) {
    return { pinned: anchorTop <= 0, headerShift: Math.min(0, anchorTop - headerHeight) };
  }
  function mountReadingBar(strip, toggle, { document: document2, window: window2 }) {
    const header = document2.querySelector(".site-header");
    const original = header && {
      inert: header.inert,
      aria: header.getAttribute("aria-hidden")
    };
    let revealed = false;
    let lastScroll;
    let travel = 0;
    const footerAnchor = strip.closest?.(".article")?.querySelector(".page-nav-anchor");
    const footer = footerAnchor?.querySelector(".article-bottom-nav");
    const content = footerAnchor || strip.closest?.(".article");
    const focusReader = () => {
      if (toggle) return toggle.focus({ preventScroll: true });
      const originalTabIndex = strip.getAttribute("tabindex");
      strip.setAttribute("tabindex", "-1");
      strip.focus({ preventScroll: true });
      if (originalTabIndex === null) strip.removeAttribute("tabindex");
      else strip.setAttribute("tabindex", originalTabIndex);
    };
    strip.dataset.readingReady = "true";
    const restoreHeader = () => {
      if (!header) return;
      delete header.dataset.readingHidden;
      delete header.dataset.readingRevealed;
      header.style.removeProperty("--reading-header-shift");
      header.inert = original.inert;
      if (original.aria === null) header.removeAttribute("aria-hidden");
      else header.setAttribute("aria-hidden", original.aria);
    };
    return {
      refresh(scrolling = false) {
        const height = toggle?.getBoundingClientRect().height || 0;
        const contentWidth = content?.getBoundingClientRect().width || 0;
        const headerHeight = header?.getBoundingClientRect().height || 0;
        const position = readingBarPosition(strip.getBoundingClientRect().top, headerHeight);
        const scroller = document2.scrollingElement || document2.documentElement;
        const scroll = Math.max(
          0,
          Math.min(
            scroller.scrollTop,
            Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          )
        );
        if (scrolling && lastScroll !== void 0) {
          const delta = scroll - lastScroll;
          if (delta) travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
          if (Math.abs(travel) >= 8) revealed = travel < 0;
        }
        lastScroll = scroll;
        const top = revealed ? headerHeight : 0;
        strip.style.setProperty("--reading-bar-height", `${height}px`);
        strip.style.setProperty("--reading-bar-top", `${top}px`);
        if (contentWidth > 0)
          strip.style.setProperty("--reading-content-width", `${contentWidth}px`);
        else strip.style.removeProperty("--reading-content-width");
        strip.dataset.pinned = String(position.pinned);
        if (header) {
          const hidden = position.pinned && !revealed;
          if (hidden && header.dataset.readingHidden !== "true") {
            const moveFocus = header.contains(document2.activeElement) || footerAnchor?.dataset.docked === "true" && footer.contains(document2.activeElement) || document2.activeElement?.closest?.("[data-palette-options]");
            window2.dispatchEvent(new window2.Event("layall:reading"));
            if (moveFocus) focusReader();
            header.inert = true;
            header.setAttribute("aria-hidden", "true");
            header.dataset.readingHidden = "true";
          } else if (!hidden) {
            restoreHeader();
          }
          header.style.setProperty(
            "--reading-header-shift",
            `${revealed ? 0 : position.headerShift}px`
          );
          if (revealed) header.dataset.readingRevealed = "true";
          else delete header.dataset.readingRevealed;
        }
        if (footer) {
          const footerHeight = footer.getBoundingClientRect().height;
          footerAnchor.style.setProperty("--page-nav-height", `${footerHeight}px`);
          const belowViewport = footerAnchor.getBoundingClientRect().top + footerHeight > scroller.clientHeight;
          const docked = revealed && belowViewport;
          if (footerAnchor.dataset.docked === "true" && !docked && belowViewport) {
            const moveFocus = footer.contains(document2.activeElement);
            window2.dispatchEvent(new window2.Event("layall:page-navigation-hide"));
            if (moveFocus) focusReader();
          }
          footerAnchor.dataset.docked = String(docked);
        }
        return top + height + 16;
      },
      reset() {
        revealed = false;
        lastScroll = void 0;
        travel = 0;
        delete strip.dataset.pinned;
        strip.style.removeProperty("--reading-bar-top");
        strip.style.removeProperty("--reading-content-width");
        if (footerAnchor) {
          delete footerAnchor.dataset.docked;
          footerAnchor.style.removeProperty("--page-nav-height");
        }
        restoreHeader();
      },
      dispose() {
        this.reset();
        delete strip.dataset.readingReady;
        strip.style.removeProperty("--reading-bar-height");
      }
    };
  }

  // client/note-navigation.mjs
  function readingHeading(headings, offset) {
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > offset) break;
      current = heading;
    }
    return current;
  }
  function mountNoteToc(scope, { document: document2, window: window2 }) {
    const body = scope.querySelector(".article-body");
    if (!body) return { refresh() {
    }, dispose() {
    } };
    const strip = scope.querySelector("[data-note-toc-strip]");
    const toggle = strip?.querySelector("[data-note-toc-toggle]");
    const dropdown = strip?.querySelector("[data-note-toc-dropdown]");
    const marker = strip?.querySelector("[data-note-toc-marker]");
    const label = strip?.querySelector("[data-note-toc-label]");
    const items = [...dropdown?.querySelectorAll("[data-toc-target]") || []];
    const headings = [...body.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]")];
    const header = document2.querySelector(".site-header");
    const root = document2.documentElement;
    const events = listeners();
    const anchor = strip || body;
    const readingBar = mountReadingBar(anchor, toggle, { document: document2, window: window2 });
    let suspended = false;
    let scrolled = false;
    let frame = 0, disposed = false, hashTarget;
    const select = (heading) => {
      if (!heading) return;
      for (const item of items) {
        const active = item.dataset.tocTarget === heading.id;
        item.classList.toggle("active", active);
        const link = item.querySelector("a");
        if (active) {
          link.setAttribute("aria-current", "location");
          label.textContent = item.querySelector(".note-toc-item-title").textContent;
          marker.textContent = /^H[12]$/.test(heading.tagName) ? "§" : "•";
        } else link.removeAttribute("aria-current");
      }
    };
    const close = (restore = false) => {
      if (!dropdown || dropdown.hidden) return;
      const hadFocus = dropdown.contains(document2.activeElement);
      dropdown.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "목차 열기");
      if (restore || hadFocus) toggle.focus({ preventScroll: true });
    };
    const refresh = () => {
      if (disposed || suspended || frame) return;
      frame = window2.requestAnimationFrame(() => {
        frame = 0;
        if (disposed || suspended) return;
        const offset = readingBar.refresh(scrolled);
        scrolled = false;
        scope.style.setProperty("--note-heading-offset", `${offset}px`);
        const scroller = document2.scrollingElement || root;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        const atBottom = maxScroll > 0 && scroller.scrollTop > 0 && maxScroll - scroller.scrollTop <= 2;
        select(
          hashTarget || (atBottom ? headings.at(-1) : readingHeading(headings, offset + 1))
        );
        hashTarget = void 0;
      });
    };
    const fromHash = () => {
      try {
        const id = decodeURIComponent(window2.location.hash.slice(1));
        hashTarget = headings.find((heading) => heading.id === id);
      } catch {
        hashTarget = void 0;
      }
      refresh();
    };
    events.on(toggle, "click", () => {
      const open = dropdown.hidden;
      if (!open) return close(true);
      dropdown.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "목차 닫기");
      (dropdown.querySelector('[aria-current="location"]') || dropdown.querySelector("a"))?.focus(
        { preventScroll: true }
      );
    });
    for (const item of items)
      events.on(item.querySelector("a"), "click", () => {
        close();
        const heading = headings.find((entry) => entry.id === item.dataset.tocTarget);
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
          hashTarget = heading;
          refresh();
        }
      });
    events.on(document2, "click", (event) => {
      if (!strip?.contains(event.target)) close();
    });
    events.on(document2, "keydown", (event) => {
      if (event.key === "Escape" && dropdown && !dropdown.hidden) {
        event.preventDefault();
        close(true);
      }
    });
    events.on(
      window2,
      "scroll",
      () => {
        scrolled = true;
        refresh();
      },
      { passive: true }
    );
    events.on(window2, "resize", refresh);
    events.on(window2, "hashchange", fromHash);
    events.on(window2, "pagehide", () => {
      suspended = true;
      scrolled = false;
      close();
      readingBar.reset();
    });
    events.on(window2, "pageshow", () => {
      suspended = false;
      refresh();
    });
    events.on(body, "load", refresh, true);
    const observer = typeof window2.ResizeObserver === "function" ? new window2.ResizeObserver(refresh) : null;
    [
      header,
      toggle,
      body,
      scope,
      anchor.closest?.(".article")?.querySelector(".article-bottom-nav")
    ].filter(Boolean).forEach((node) => observer?.observe(node));
    const appearance = typeof window2.MutationObserver === "function" ? new window2.MutationObserver(() => {
      close();
      refresh();
    }) : null;
    appearance?.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    document2.fonts?.ready.then(refresh);
    fromHash();
    return {
      refresh,
      dispose() {
        disposed = true;
        events.dispose();
        observer?.disconnect();
        appearance?.disconnect();
        if (frame) window2.cancelAnimationFrame(frame);
        close();
        readingBar.dispose();
        scope.style.removeProperty("--note-heading-offset");
      }
    };
  }
  function bookNeighbors(books, current, postPrefix, origin) {
    if (!Array.isArray(books)) throw new Error("Invalid book navigation");
    const paths = /* @__PURE__ */ new Set();
    const groups = books.map((book) => {
      if (!Array.isArray(book)) throw new Error("Invalid book navigation");
      return book.map((entry) => {
        if (typeof entry?.label !== "string" || typeof entry.href !== "string" || paths.size >= 5e4)
          throw new Error("Invalid book link");
        const url = new URL(entry.href, origin);
        const segment = url.pathname.slice(postPrefix.length);
        if (url.origin !== origin || !url.pathname.startsWith(postPrefix) || !/^[a-z0-9][a-z0-9-]{0,127}\/$/.test(segment) || url.search || url.hash || url.username || url.password || paths.has(url.pathname))
          throw new Error("Invalid book link");
        paths.add(url.pathname);
        return { label: entry.label, href: url.pathname };
      });
    });
    let pathname = current.endsWith("/index.html") ? current.slice(0, -10) : current;
    if (!pathname.endsWith("/")) pathname += "/";
    const group = groups.find((book) => book.some((entry) => entry.href === pathname));
    const index = group?.findIndex((entry) => entry.href === pathname) ?? -1;
    return index < 0 ? null : { entries: group, index, prev: group[index - 1] ?? null, next: group[index + 1] ?? null };
  }
  function mountNoteNavigation({ config: config2, loadBooks }, { document: document2, window: window2, location: location2 } = globalThis) {
    const article = document2.querySelector('[data-theme-piece="article"]');
    const toc = article && !article.querySelector("[data-protected-post]") ? mountNoteToc(article, { document: document2, window: window2 }) : null;
    const bottom = article?.querySelector(".article-bottom-nav");
    let disposed = false, pending, loaded;
    const loadBook = () => {
      if (disposed || !bottom) return Promise.reject(new Error("Navigation unavailable"));
      if (loaded) return Promise.resolve(loaded);
      if (pending) return pending;
      pending = Promise.resolve().then(loadBooks).then((books) => {
        if (disposed) return;
        const neighbors = bookNeighbors(
          books,
          location2.pathname,
          config2.postPrefix,
          location2.origin
        );
        if (!neighbors) throw new Error("Book not found");
        for (const direction of ["prev", "next"]) {
          const entry = neighbors[direction];
          const link = bottom.querySelector(`[data-nav-${direction}]`);
          if (!entry || !link) {
            const empty = bottom.querySelector(`[data-nav-${direction}-empty]`);
            empty.setAttribute(
              "aria-label",
              direction === "prev" ? "이전글 없음" : "다음글 없음"
            );
            continue;
          }
          link.href = entry.href;
          link.querySelector(`[data-nav-${direction}-title]`).textContent = entry.label;
          link.title = `${direction === "prev" ? "이전 글" : "다음 글"}: ${entry.label}`;
          link.setAttribute("aria-label", link.title);
          link.hidden = false;
          bottom.querySelector(`[data-nav-${direction}-empty]`).hidden = true;
        }
        loaded = neighbors;
        return neighbors;
      }).finally(() => {
        pending = null;
      });
      return pending;
    };
    const list = bottom && mountPageList(bottom, { document: document2, window: window2, loadBook });
    const refresh = () => {
      toc?.refresh();
      if (!disposed && bottom) void loadBook().catch(() => {
      });
    };
    refresh();
    return {
      refresh,
      dispose() {
        disposed = true;
        toc?.dispose();
        list?.dispose();
      }
    };
  }

  // client/palette.mjs
  function mountPalettes({ root, nav, current, onSelect }) {
    const events = listeners();
    const palettePickers = [];
    const disposers = [];
    document.querySelectorAll("[data-palette-picker]").forEach((picker) => {
      const summary = picker.querySelector("summary");
      const panel = picker.querySelector("[data-palette-options]");
      const choices = [...panel.querySelectorAll("[data-palette-choice]")];
      document.body.append(panel);
      const viewport = window.visualViewport;
      const watchingEvents = listeners();
      let frame = 0;
      let watching = false;
      const contains = (target) => picker.contains(target) || panel.contains(target);
      const close = (focus = false) => {
        picker.open = false;
        panel.hidden = true;
        summary.setAttribute("aria-expanded", "false");
        window.cancelAnimationFrame(frame);
        frame = 0;
        watchingEvents.dispose();
        observer?.disconnect();
        watching = false;
        if (focus) summary.focus({ preventScroll: true });
      };
      const position = () => {
        if (!picker.open) return;
        const anchor = summary.getBoundingClientRect();
        const menu = nav?.getBoundingClientRect();
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || root.clientWidth, height = viewport?.height || root.clientHeight;
        if (!summary.isConnected || !anchor.width || !anchor.height || anchor.bottom <= Math.max(top, menu?.top ?? top) || anchor.top >= Math.min(top + height, menu?.bottom ?? top + height) || anchor.right <= left || anchor.left >= left + width) {
          close();
          return;
        }
        const edge = 8, gap = 4;
        const minX = left + edge, minY = top + edge;
        panel.style.maxWidth = Math.max(0, width - edge * 2) + "px";
        panel.style.maxHeight = Math.max(0, height - edge * 2) + "px";
        const below = Math.max(0, top + height - edge - anchor.bottom - gap), above = Math.max(0, anchor.top - gap - minY);
        const up = below < panel.scrollHeight + 2 && above > below;
        panel.style.maxHeight = Math.max(0, up ? above : below) + "px";
        const box = panel.getBoundingClientRect();
        panel.style.left = Math.max(minX, Math.min(anchor.left, left + width - edge - box.width)) + "px";
        panel.style.top = Math.max(
          minY,
          Math.min(
            up ? anchor.top - gap - box.height : anchor.bottom + gap,
            top + height - edge - box.height
          )
        ) + "px";
      };
      const schedule = (event) => {
        if (!picker.open || panel.contains(event?.target) || frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          position();
        });
      };
      const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(schedule) : null;
      const open = () => {
        picker.open = true;
        panel.hidden = false;
        summary.setAttribute("aria-expanded", "true");
        position();
        if (!picker.open || watching) return;
        watching = true;
        watchingEvents.on(window, "resize", schedule);
        watchingEvents.on(window, "scroll", schedule, true);
        watchingEvents.on(viewport, "resize", schedule);
        watchingEvents.on(viewport, "scroll", schedule);
        observer?.observe(summary);
        if (nav) observer?.observe(nav);
      };
      const selected = () => choices.find((button) => button.dataset.paletteChoice === current()) || choices[0];
      const choose = (button) => {
        const next = button.dataset.paletteChoice;
        onSelect(next);
        position();
      };
      choices.forEach(
        (button) => events.on(button, "click", () => {
          choose(button);
          close(true);
        })
      );
      events.on(summary, "click", (event) => {
        event.preventDefault();
        picker.open ? close() : open();
      });
      events.on(summary, "keydown", (event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          open();
          if (picker.open)
            (event.key === "Home" ? choices[0] : event.key === "End" ? choices.at(-1) : selected())?.focus();
        } else if (event.key === "Tab" && !event.shiftKey && picker.open) {
          event.preventDefault();
          selected()?.focus();
        }
      });
      const keydown = (event) => {
        if (event.key === "Escape" && picker.open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        const index = choices.indexOf(event.target);
        if (event.key === "Tab" && (index >= 0 || event.target === panel)) {
          if (event.shiftKey) event.preventDefault();
          close(true);
          return;
        }
        if (index < 0) return;
        let next = index;
        if (event.key === "ArrowDown" || event.key === "ArrowRight")
          next = (index + 1) % choices.length;
        else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
          next = (index + choices.length - 1) % choices.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = choices.length - 1;
        else return;
        event.preventDefault();
        choose(choices[next]);
        choices[next].focus();
      };
      const focusout = (event) => {
        if (!contains(event.relatedTarget)) close();
      };
      events.on(picker, "keydown", keydown);
      events.on(panel, "keydown", keydown);
      events.on(picker, "focusout", focusout);
      events.on(panel, "focusout", focusout);
      events.on(picker, "toggle", () => picker.open ? open() : close());
      const outside = (event) => {
        if (!contains(event.target)) close();
      };
      const pagehide = () => close();
      events.on(document, "click", outside);
      events.on(window, "pagehide", pagehide);
      disposers.push(() => {
        close();
        picker.append(panel);
      });
      palettePickers.push({ contains, close });
    });
    return {
      pickers: palettePickers,
      dispose() {
        events.dispose();
        disposers.splice(0).forEach((dispose) => dispose());
      }
    };
  }

  // client/search.mjs
  function createSearch(config2) {
    let pageGeneration = 0, queryGeneration = 0, indexPromise;
    const loadIndex = () => indexPromise ??= fetch(config2.searchUrl).then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    }).then(
      (entries) => entries.map((entry) => ({
        entry,
        text: [entry.title, entry.body, entry.folder, ...entry.tags].join(" ").toLocaleLowerCase()
      }))
    ).catch((error) => {
      indexPromise = void 0;
      throw error;
    });
    const events = listeners();
    const bindSearch = (preservedQuery = "") => {
      events.dispose();
      const generation = ++pageGeneration;
      const form = document.querySelector("[data-search-form]");
      const input = document.querySelector("[data-search-input]");
      const results = document.querySelector("[data-search-results]");
      const status = document.querySelector("[data-search-status]");
      if (!form || !input || !results || !status) return;
      const run = async (syncUrl = false) => {
        const request = ++queryGeneration;
        const value = input.value.trim();
        const query = value.toLocaleLowerCase();
        const current = () => generation === pageGeneration && request === queryGeneration && input.isConnected !== false;
        let entries;
        try {
          entries = await loadIndex();
        } catch {
          if (current()) status.textContent = "검색 색인을 불러오지 못했습니다.";
          return;
        }
        if (!current()) return;
        const found = (query ? entries.filter(({ text }) => text.includes(query)) : entries).map(({ entry }) => entry);
        results.replaceChildren(
          ...found.map((entry) => {
            const li = document.createElement("li");
            const row = document.createElement("div");
            row.className = "post-row";
            const strong = document.createElement("strong");
            strong.className = "linked-post-title";
            const folder = document.createElement("a");
            folder.setAttribute(
              "href",
              config2.homeUrl + "#" + encodeURIComponent(entry.bookId)
            );
            folder.setAttribute("data-blog-book", entry.bookId);
            folder.textContent = entry.folder;
            const post = document.createElement("a");
            post.className = "post-title-link";
            post.setAttribute(
              "href",
              config2.postPrefix + encodeURIComponent(entry.permalink) + "/"
            );
            post.textContent = entry.title;
            strong.append(folder, " / ", post);
            const span = document.createElement("span");
            span.className = "post-meta";
            span.textContent = entry.tags.map((tag) => "#" + tag).join(" · ");
            row.append(strong, span);
            li.append(row);
            return li;
          })
        );
        status.textContent = found.length + "개 결과";
        if (syncUrl) {
          const url = new URL(location.href);
          query ? url.searchParams.set("q", value) : url.searchParams.delete("q");
          history.replaceState(null, "", url);
        }
      };
      events.on(form, "submit", (event) => {
        event.preventDefault();
        void run(true);
      });
      input.value = preservedQuery || new URL(location.href).searchParams.get("q") || "";
      void run();
    };
    return {
      bind: bindSearch,
      invalidate: () => {
        pageGeneration++;
        events.dispose();
      }
    };
  }

  // client/theme-controller.mjs
  function applyArticleAppearance(root, mount, next) {
    const articleShell = mount.querySelector("[data-article-shell]");
    if (!articleShell) return false;
    root.dataset.theme = next;
    root.dataset.layallTheme = next;
    articleShell.className = next === "docs" ? "docs-layout" : "article-frame";
    articleShell.querySelector("[data-article-main]").className = next === "docs" ? "docs-content" : "article-shell theme-article-" + next;
    return true;
  }
  function createThemeController({
    config: config2,
    root,
    mount,
    beforeReplace,
    onPageMounted,
    onArticleAppearance
  }) {
    const events = listeners();
    const colorModes = /* @__PURE__ */ new Set(["light", "dark", "system"]);
    const layoutThemes = new Set(config2.themeOrder);
    const authorTheme = config2.theme;
    const layoutKey = config2.layoutStorageKey;
    const pool = document.querySelector("[data-theme-pool]");
    const readStored = (key) => {
      try {
        return localStorage.getItem(key) || "";
      } catch {
        return "";
      }
    };
    const writeStored = (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
      }
    };
    const syncColor = () => document.querySelectorAll("[data-color]").forEach(
      (button) => button.setAttribute(
        "aria-pressed",
        String(button.dataset.color === root.dataset.colorMode)
      )
    );
    const paletteNames = config2.paletteNames;
    const syncLayout = () => {
      document.querySelectorAll("[data-layout-theme]").forEach((select) => select.value = root.dataset.theme);
      document.querySelectorAll("[data-palette-choice]").forEach((button) => {
        const selected = button.dataset.paletteChoice === root.dataset.theme;
        button.setAttribute("aria-checked", String(selected));
        button.setAttribute("tabindex", selected ? "0" : "-1");
      });
      document.querySelectorAll("[data-palette-current]").forEach((node) => {
        node.textContent = paletteNames[root.dataset.theme];
        node.parentElement?.setAttribute("data-palette", root.dataset.theme);
      });
    };
    const activate = (next) => {
      if (!layoutThemes.has(next) || !mount) return false;
      if (root.dataset.theme === next) return true;
      if (applyArticleAppearance(root, mount, next)) {
        syncLayout();
        onArticleAppearance();
        return true;
      }
      const template = document.querySelector('template[data-theme-layout="' + next + '"]');
      if (!template) return false;
      const query = document.querySelector("[data-search-input]")?.value || "";
      const fragment = template.content.cloneNode(true);
      fragment.querySelectorAll("[data-layout-id]").forEach((node) => {
        node.id = node.dataset.layoutId;
        node.removeAttribute("data-layout-id");
      });
      const retained = new Map(
        [...document.querySelectorAll("[data-theme-piece]")].map((node) => [
          node.dataset.themePiece,
          node
        ])
      );
      const used = /* @__PURE__ */ new Set();
      beforeReplace();
      fragment.querySelectorAll("[data-theme-slot]").forEach((target) => {
        const piece = retained.get(target.dataset.themeSlot);
        if (piece) {
          used.add(target.dataset.themeSlot);
          target.replaceWith(piece);
        }
      });
      if (pool)
        pool.replaceChildren(
          ...[...retained].filter(([name]) => !used.has(name)).map(([, node]) => node)
        );
      root.dataset.theme = next;
      root.dataset.layallTheme = next;
      mount.replaceChildren(fragment);
      syncLayout();
      onPageMounted(query);
      return true;
    };
    const savedColor = readStored("layall-color-mode");
    if (colorModes.has(savedColor)) root.dataset.colorMode = savedColor;
    syncColor();
    document.querySelectorAll("[data-color]").forEach(
      (button) => events.on(button, "click", () => {
        const mode = button.dataset.color;
        if (!colorModes.has(mode)) return;
        root.dataset.colorMode = mode;
        writeStored("layall-color-mode", mode);
        syncColor();
      })
    );
    document.querySelectorAll("[data-layout-theme]").forEach(
      (select) => events.on(select, "change", () => {
        const next = select.value;
        if (!layoutThemes.has(next)) {
          syncLayout();
          return;
        }
        if (activate(next)) writeStored(layoutKey, next);
        else syncLayout();
      })
    );
    return {
      current: () => root.dataset.theme,
      select(next) {
        const success = activate(next);
        if (success) writeStored(layoutKey, next);
        else syncLayout();
        return success;
      },
      restore() {
        const remembered = readStored(layoutKey);
        if (layoutThemes.has(remembered) && remembered !== authorTheme && activate(remembered)) {
          if (mount?.querySelector("[data-article-shell]")) onPageMounted();
        } else {
          root.dataset.theme = authorTheme;
          root.dataset.layallTheme = authorTheme;
          syncLayout();
          onPageMounted();
        }
      },
      dispose: () => events.dispose()
    };
  }

  // client/site.mjs
  function mountSite(config2, discussionConfig) {
    const events = listeners();
    const root = document.documentElement;
    root.dataset.js = "true";
    const mount = document.querySelector("[data-theme-view]");
    const docs = createDocsNavigation({ config: config2, root, mount });
    const search = createSearch(config2);
    const blog = createBlogHome({ mount });
    const widgets = createHomeWidgets({ mount });
    const nav = document.querySelector("[data-nav]");
    const navToggle = document.querySelector("[data-nav-toggle]");
    let noteNavigation;
    const themes = createThemeController({
      config: config2,
      root,
      mount,
      beforeReplace() {
        search.invalidate();
        docs.invalidate();
        blog.dispose();
        widgets.dispose();
      },
      onArticleAppearance() {
        docs.bind();
        noteNavigation?.refresh();
      },
      onPageMounted(query = "") {
        docs.bind();
        search.bind(query);
        blog.bind();
        widgets.bind();
        noteNavigation?.refresh();
      }
    });
    const palettes2 = mountPalettes({ root, nav, current: themes.current, onSelect: themes.select });
    const navigation = mountNavigation({
      nav,
      navToggle,
      palettePickers: palettes2.pickers
    });
    noteNavigation = mountNoteNavigation({ config: config2, loadBooks: docs.loadBooks });
    themes.restore();
    const code = mountArticleCode(
      document.querySelector('[data-theme-piece="article"]'),
      { document, window },
      config2.diagram,
      config2.highlight
    );
    const disposeDiscussion = discussionConfig ? mountDiscussion(discussionConfig) : null;
    let disposed = false;
    const controller = {
      dispose() {
        if (disposed) return;
        disposed = true;
        events.dispose();
        disposeDiscussion?.();
        code.dispose();
        palettes2.dispose();
        navigation.dispose();
        noteNavigation.dispose();
        themes.dispose();
        blog.dispose();
        docs.dispose();
        widgets.dispose();
        search.invalidate();
      }
    };
    events.on(window, "pagehide", (event) => {
      if (!event.persisted) controller.dispose();
    });
    return controller;
  }

  // client/site-entry.mjs
  var config = readConfig("[data-site-config]");
  if (config) {
    mountSite(config, readConfig("[data-discussion-config]"));
    registerWorker(config.pwa);
  }
})();
