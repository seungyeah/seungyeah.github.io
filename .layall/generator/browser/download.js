"use strict";
(() => {
  // client/config.mjs
  function readConfig(selector) {
    const node = document.querySelector(selector);
    return node ? JSON.parse(node.textContent) : null;
  }

  // client/download.mjs
  async function mountDownload({ basePath }) {
    let url;
    try {
      const path = decodeURIComponent(location.hash.slice(1));
      if (!/^assets\/posts\/[a-zA-Z0-9_-]+\//.test(path) || !path.endsWith(".layall-download.json") || path.split("/").some((part) => !part || part === "." || part === "..") || path.includes("\\"))
        throw new Error("invalid download");
      const response = await fetch(basePath + "/" + path, {
        credentials: "omit",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("download unavailable");
      const payload = await response.json();
      if (payload.format !== "layall-download" || payload.version !== 1 || typeof payload.data !== "string" || typeof payload.name !== "string")
        throw new Error("invalid download");
      const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = new TextDecoder().decode(Uint8Array.from(atob(payload.name), (c) => c.charCodeAt(0))).replace(/[/\\]/g, "_") || "attachment";
      link.textContent = "첨부파일 다운로드";
      document.querySelector("#status").replaceChildren(link);
    } catch {
      document.querySelector("#status").textContent = "첨부파일을 열 수 없습니다.";
    }
    addEventListener("pagehide", () => {
      if (url) URL.revokeObjectURL(url);
    });
  }

  // client/download-entry.mjs
  void mountDownload(readConfig("[data-download-config]"));
})();
