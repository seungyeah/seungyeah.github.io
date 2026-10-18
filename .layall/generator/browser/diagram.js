"use strict";
(() => {
  // client/config.mjs
  function readConfig(selector) {
    const node = document.querySelector(selector);
    return node ? JSON.parse(node.textContent) : null;
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
    const hashes = /* @__PURE__ */ new Set(), names = /* @__PURE__ */ new Set();
    for (const [index, node] of graph.modules.entries()) {
      if (!exact(node, ["name", "sha256", "size", "imports"]) || typeof node.name !== "string" || !/^(?:mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[A-Za-z0-9_-]+\.mjs)$/.test(
        node.name
      ) || names.has(node.name) || !/^[a-f0-9]{64}$/.test(node.sha256) || hashes.has(node.sha256) || !Number.isSafeInteger(node.size) || node.size <= 0 || node.size > graphLimits.file || !Array.isArray(node.imports))
        throw new Error("Invalid diagram module");
      hashes.add(node.sha256);
      names.add(node.name);
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
  function linkDiagramModules(graph, sources, { Blob, URL }) {
    validateDiagramGraph(graph);
    if (!Array.isArray(sources) || sources.length !== graph.modules.length)
      throw new Error("Incomplete diagram modules");
    const urls = [];
    const dispose = () => {
      urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    };
    try {
      for (const [index, node] of graph.modules.entries()) {
        let source = sources[index];
        if (typeof source !== "string" || new TextEncoder().encode(source).length !== node.size)
          throw new Error("Invalid diagram bytes");
        for (const [start, end, dependency] of [...node.imports].reverse()) {
          if (!/^(?:"\.{1,2}\/[A-Za-z0-9_./-]+\.mjs"|'\.{1,2}\/[A-Za-z0-9_./-]+\.mjs')$/.test(
            source.slice(start, end)
          ))
            throw new Error("Invalid diagram import span");
          source = source.slice(0, start) + JSON.stringify(urls[dependency]) + source.slice(end);
        }
        urls.push(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      }
      return { entry: urls[graph.entry], dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  // client/diagram-renderer.mjs
  async function renderDiagramFrame(input2, { document: document2, window: window2, active = () => true }, load) {
    const report = (state, height = 0) => active() && window2.parent.postMessage(
      { kind: "layall:diagram", token: input2.token, state, height },
      "*"
    );
    try {
      if (typeof input2.source !== "string" || input2.source.length > 1e5)
        throw new Error("Diagram limit");
      const { default: mermaid } = await load();
      if (!active()) return () => {
      };
      const c = input2.colors;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        maxTextSize: 1e5,
        maxEdges: 500,
        htmlLabels: false,
        theme: "base",
        secure: [
          "securityLevel",
          "startOnLoad",
          "suppressErrorRendering",
          "maxTextSize",
          "maxEdges",
          "htmlLabels",
          "theme",
          "themeVariables",
          "themeCSS",
          "fontFamily"
        ],
        themeVariables: {
          darkMode: c.dark,
          background: c.surface,
          primaryColor: c.surface,
          primaryTextColor: c.ink,
          primaryBorderColor: c.line,
          secondaryColor: c.surface,
          tertiaryColor: c.surface,
          lineColor: c.muted,
          textColor: c.ink,
          mainBkg: c.surface,
          nodeBorder: c.accent,
          fontFamily: "ui-sans-serif,system-ui,sans-serif"
        }
      });
      const host = document2.getElementById("diagram");
      const { svg } = await mermaid.render("layall-diagram", input2.source, host);
      if (!active()) return () => {
      };
      host.innerHTML = svg;
      host.addEventListener("click", (event) => event.preventDefault());
      const measure = () => report("ready", Math.max(80, Math.ceil(host.getBoundingClientRect().height + 24)));
      const observer = new window2.ResizeObserver(measure);
      observer.observe(host);
      measure();
      return () => observer.disconnect();
    } catch {
      report("error");
      return () => {
      };
    }
  }
  function mountDiagramFrame(input2, { document: document2, window: window2 }, load = (url) => import(url)) {
    let active = true, started = false, linked, release = () => {
    };
    const dispose = () => {
      active = false;
      window2.removeEventListener("message", receive);
      window2.removeEventListener("pagehide", dispose);
      release();
      linked?.dispose();
    };
    const receive = async (event) => {
      if (!active || started || event.source !== window2.parent || event.data?.kind !== "layall:diagram-modules" || event.data.token !== input2.token)
        return;
      started = true;
      window2.removeEventListener("message", receive);
      release = await renderDiagramFrame(
        input2,
        { document: document2, window: window2, active: () => active },
        async () => {
          linked = linkDiagramModules(event.data.graph, event.data.sources, window2);
          return load(linked.entry);
        }
      );
      if (!active) {
        release();
        linked?.dispose();
      }
    };
    window2.addEventListener("message", receive);
    window2.addEventListener("pagehide", dispose);
    window2.parent.postMessage({ kind: "layall:diagram", token: input2.token, state: "load" }, "*");
    return { dispose };
  }

  // client/diagram-entry.mjs
  var input = readConfig("[data-mermaid-frame]");
  if (input) mountDiagramFrame(input, { document, window });
})();
