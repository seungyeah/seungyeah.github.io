"use strict";
(() => {
  // render/markdown-fences.mjs
  function openFence(line) {
    const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,}|'{3,})[ \t]*([^\s`~']*)/);
    return match ? { marker: match[1][0], length: match[1].length, language: match[2] } : null;
  }
  function closesFence(line, fence) {
    return new RegExp(`^[ 	]{0,3}${fence.marker}{${fence.length},}[ 	]*$`).test(line);
  }

  // render/text.mjs
  var esc = (value) => String(value ?? "").replace(
    /[&<>\"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]
  );
  var safeExternal = (value) => {
    try {
      const url = new URL(String(value ?? ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  };
  var isInternalHostname = (value) => {
    const hostname = String(value ?? "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || /\.(?:localhost|local|internal)$/.test(hostname))
      return true;
    const ipv4 = hostname.split(".").map(Number);
    if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [first, second] = ipv4;
      return first === 0 || first === 10 || first === 127 || first === 100 && second >= 64 && second <= 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 || first >= 224;
    }
    if (hostname.includes(":"))
      return hostname === "::" || hostname === "::1" || /^f[cd]/.test(hostname) || /^fe[89ab]/.test(hostname);
    return !hostname.includes(".");
  };
  var safeSocialImage = (value) => {
    try {
      const url = new URL(String(value ?? ""));
      return url.protocol === "https:" && !url.username && !url.password && !isInternalHostname(url.hostname) ? url.href : null;
    } catch {
      return null;
    }
  };
  var plainText = (value) => String(value ?? "").replace(/```[\s\S]*?```/g, " ").replace(/!?(\[([^\]]*)\])\([^)]*\)/g, "$2").replace(/[#>*_`~-]/g, " ").replace(/\s+/g, " ").trim();
  var slugify = (value) => {
    const slug = String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "");
    return slug || "section";
  };

  // render/markdown.mjs
  function createMarkdown({ href = (value) => value } = {}) {
    const safeContentHref = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw || raw.startsWith("//") || raw.includes("\\")) return null;
      if (raw.startsWith("#")) return raw.replace(/[^#a-zA-Z0-9_-]/g, "");
      if (raw.startsWith("/")) return href(raw.replace(/\s/g, "%20"));
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return safeExternal(raw);
      return raw.replace(/\s/g, "%20");
    };
    const inlineMarkdown = (source, assets = /* @__PURE__ */ new Map(), figures = false, onImage = null) => {
      const placeholders = [];
      const keep = (html) => {
        const token = `\0${placeholders.length}\0`;
        placeholders.push(html);
        return token;
      };
      let value = String(source ?? "").replace(/\u0000/g, "").replace(/`([^`]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));
      value = value.replace(
        /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+[\"'][^\"']*[\"'])?\)/g,
        (_, image, label, target) => {
          const attachment = target.startsWith("layall-attachment:");
          const asset = attachment ? assets.get(target.slice("layall-attachment:".length)) : null;
          const safe = attachment ? asset?.url : safeContentHref(target);
          if (!safe || /[\u0000-\u001f\u007f]/.test(safe)) {
            return keep(
              attachment ? `<span class="attachment-missing">첨부파일: ${esc(label || "Attachment")}</span>` : esc(label)
            );
          }
          if (image && (!attachment || asset.image)) {
            const publicUrl = attachment ? asset.publicUrl : safeSocialImage(target);
            if (publicUrl) onImage?.({ url: publicUrl, alt: String(label ?? "") });
            const picture = `<img src="${esc(safe)}" alt="${esc(label)}" loading="lazy" decoding="async">`;
            return keep(
              figures ? `<figure class="article-image">${picture}${label.trim() ? `<figcaption>${esc(label)}</figcaption>` : ""}</figure>` : picture
            );
          }
          return keep(`<a href="${esc(safe)}">${esc(label || "Attachment")}</a>`);
        }
      );
      value = esc(value).replace(/\\\|/g, "|").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
      while (/\u0000\d+\u0000/.test(value))
        value = value.replace(
          /\u0000(\d+)\u0000/g,
          (_, index) => placeholders[Number(index)] ?? ""
        );
      return value;
    };
    const tableCells = (line = "") => {
      let value = line.trim();
      if (!value.includes("|")) return null;
      if (value.startsWith("|")) value = value.slice(1);
      if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
      const cells = [];
      let cell = "";
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] === "\\" && index + 1 < value.length) {
          cell += value[index] + value[++index];
        } else if (value[index] === "|") {
          cells.push(cell.trim());
          cell = "";
        } else cell += value[index];
      }
      cells.push(cell.trim());
      return cells;
    };
    const imageLine = (line) => {
      const pattern = /!\[[^\]]*\]\([^\s)]+(?:\s+["'][^"']*["'])?\)/g;
      const images = [...line.matchAll(pattern)];
      return images.length && !line.replace(pattern, "").trim() ? images.length : 0;
    };
    const finiteMapCoordinate = (value) => {
      const text = String(value ?? "").trim();
      if (!text) return null;
      const number = Number(text);
      return Number.isFinite(number) ? number : null;
    };
    const mapCoordinatePair = (lat, lng) => {
      if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    };
    const naverCameraPair = (raw) => {
      const parts = String(raw ?? "").split(",");
      if (parts.length < 6) return null;
      return mapCoordinatePair(finiteMapCoordinate(parts[1]), finiteMapCoordinate(parts[0]));
    };
    const parseMapPlaceUrl = (raw) => {
      let url;
      try {
        url = new URL(raw);
      } catch {
        return null;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const host = url.hostname.replace(/^www\./, "");
      if (host === "google.com" && url.pathname.startsWith("/maps")) {
        const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
        const [latText, lngText] = query.split(",");
        const pair = mapCoordinatePair(
          finiteMapCoordinate(latText),
          finiteMapCoordinate(lngText)
        );
        return pair ? { provider: "google", ...pair } : null;
      }
      if (host === "map.naver.com") {
        const fromPoint = mapCoordinatePair(
          finiteMapCoordinate(url.searchParams.get("lat")),
          finiteMapCoordinate(url.searchParams.get("lng"))
        );
        const pair = fromPoint || naverCameraPair(url.searchParams.get("c"));
        return pair ? { provider: "naver", ...pair } : null;
      }
      return null;
    };
    const naverPlaceOpenUrl = (raw, label, lat, lng) => {
      let url;
      try {
        url = new URL(raw);
      } catch {
        return raw;
      }
      if (url.hostname.replace(/^www\./, "") !== "map.naver.com") return raw;
      if (/\/place\/\d+/.test(url.pathname)) return raw;
      const name = String(label ?? "").trim();
      if (!name) return raw;
      return `https://map.naver.com/p/search/${encodeURIComponent(name)}?c=15.00,0,0,0,dh&lat=${Number(lat).toFixed(6)}&lng=${Number(lng).toFixed(6)}`;
    };
    const mapPlaceFromLine = (line) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return null;
      const pattern = /\[([^\]]*)\]\(([^)\s]+)\)/g;
      const links = [...trimmed.matchAll(pattern)];
      if (!links.length) return null;
      if (trimmed.replace(pattern, "").replace(/[·\s]/g, "").length) return null;
      const places = [];
      for (const match of links) {
        const parsed = parseMapPlaceUrl(match[2]);
        if (!parsed) return null;
        places.push({ label: String(match[1] ?? "").trim(), url: match[2], ...parsed });
      }
      const named = places.find((place) => place.label && place.label !== "네이버 지도") ?? places[0];
      const preferred = places.find((place) => place.provider === "naver") ?? named;
      const label = named.label || `${preferred.lat.toFixed(6)}, ${preferred.lng.toFixed(6)}`;
      return {
        ...preferred,
        label,
        url: preferred.provider === "naver" ? naverPlaceOpenUrl(preferred.url, label, preferred.lat, preferred.lng) : preferred.url
      };
    };
    const mapPlaceTile = (lat, lng, zoom = 16) => {
      const clampedLat = Math.min(85, Math.max(-85, lat));
      const n = 2 ** zoom;
      const worldX = (lng + 180) / 360 * n;
      const latRad = clampedLat * Math.PI / 180;
      const worldY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
      const tileX = Math.min(n - 1, Math.max(0, Math.floor(worldX)));
      const tileY = Math.min(n - 1, Math.max(0, Math.floor(worldY)));
      return {
        url: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
        left: (worldX - tileX) * 100,
        top: (worldY - tileY) * 100
      };
    };
    const mapPlaceCardHtml = (place) => {
      const tile = mapPlaceTile(place.lat, place.lng);
      const caption = place.provider === "naver" ? "네이버 지도" : "Google Map";
      const coords = `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
      return `<a class="map-place-card" data-map-place="${place.provider}" href="${esc(place.url)}" target="_blank" rel="noopener noreferrer"><span class="map-place-map" aria-hidden="true"><img src="${esc(tile.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="map-place-pin" style="left:${tile.left.toFixed(2)}%;top:${tile.top.toFixed(2)}%"></span><span class="map-place-credit">© OSM</span></span><span class="map-place-body"><span class="map-place-name">${esc(place.label)}</span><span class="map-place-meta">${esc(caption)}</span><span class="map-place-coords">${esc(coords)}</span></span></a>`;
    };
    const renderMarkdown = (source, assets) => {
      const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
      const html = [];
      const headings = [];
      let firstImage = null;
      const usedIds = /* @__PURE__ */ new Set();
      const rememberImage = (image) => {
        firstImage ??= image;
      };
      const inline = (value) => inlineMarkdown(value, assets, false, rememberImage);
      let paragraph = [];
      let list = null;
      let fence = null;
      let quote = [];
      const flushParagraph = () => {
        if (!paragraph.length) return;
        for (const line of paragraph) html.push(`<p>${inline(line)}</p>`);
        paragraph = [];
      };
      const flushList = () => {
        if (!list) return;
        html.push(
          `<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.type}>`
        );
        list = null;
      };
      const flushQuote = () => {
        if (!quote.length) return;
        html.push(
          `<blockquote>${quote.map((line) => inline(line)).join("<br />")}</blockquote>`
        );
        quote = [];
      };
      const flushAll = () => {
        flushParagraph();
        flushList();
        flushQuote();
      };
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (fence) {
          if (closesFence(line, fence)) {
            html.push(
              `<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ""}>${esc(fence.lines.join("\n"))}</code></pre>`
            );
            fence = null;
          } else fence.lines.push(line);
          continue;
        }
        const fenceMatch = openFence(line);
        if (fenceMatch) {
          flushAll();
          fence = {
            ...fenceMatch,
            lines: []
          };
          continue;
        }
        const imageCount = imageLine(line);
        if (imageCount) {
          flushAll();
          const images = inlineMarkdown(line, assets, true, rememberImage);
          html.push(
            imageCount > 1 ? `<div class="image-gallery" data-image-gallery="true">${images}</div>` : images
          );
          continue;
        }
        const header = tableCells(line);
        const separator = tableCells(lines[index + 1]);
        if (header && separator?.length === header.length && separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
          flushAll();
          const alignments = separator.map(
            (cell) => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left"
          );
          const row = (cells, tag) => `<tr>${header.map((_, column) => `<${tag}${tag === "th" ? ' scope="col"' : ""} class="align-${alignments[column]}">${inline(cells[column] ?? "").replace(/&lt;br\s*\/?&gt;/gi, "<br>")}</${tag}>`).join("")}</tr>`;
          const rows = [];
          index += 1;
          while (index + 1 < lines.length) {
            const cells = tableCells(lines[index + 1]);
            if (!cells || imageLine(lines[index + 1]) || /^#{1,6}\s/.test(lines[index + 1]) || openFence(lines[index + 1]))
              break;
            rows.push(cells);
            index += 1;
          }
          html.push(
            `<div class="article-table" tabindex="0" role="region" aria-label="표"><table><thead>${row(header, "th")}</thead><tbody>${rows.map((cells) => row(cells, "td")).join("")}</tbody></table></div>`
          );
          continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          flushAll();
          const level = heading[1].length;
          const label = plainText(heading[2]);
          const base = `heading-${slugify(label)}`;
          let id = base;
          let suffix = 2;
          while (usedIds.has(id)) id = `${base}-${suffix++}`;
          usedIds.add(id);
          headings.push({ level, label, id });
          html.push(
            `<h${level} id="${esc(id)}">${inline(heading[2])}<a class="heading-anchor" href="#${esc(id)}" aria-label="${esc(label)} 바로가기">#</a></h${level}>`
          );
          continue;
        }
        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (unordered || ordered) {
          flushParagraph();
          flushQuote();
          const type = ordered ? "ol" : "ul";
          if (list?.type !== type) flushList();
          list ??= { type, items: [] };
          list.items.push((ordered || unordered)[1]);
          continue;
        }
        const quoted = line.match(/^>\s?(.*)$/);
        if (quoted) {
          flushParagraph();
          flushList();
          quote.push(quoted[1]);
          continue;
        }
        if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
          flushAll();
          html.push("<hr>");
          continue;
        }
        if (!line.trim()) {
          flushAll();
          html.push("<br>");
          continue;
        }
        const mapPlace = mapPlaceFromLine(line);
        if (mapPlace) {
          flushAll();
          html.push(mapPlaceCardHtml(mapPlace));
          continue;
        }
        flushList();
        flushQuote();
        paragraph.push(line.trim());
      }
      if (fence)
        html.push(
          `<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ""}>${esc(fence.lines.join("\n"))}</code></pre>`
        );
      flushAll();
      return { html: html.join("\n"), headings, firstImage };
    };
    return { renderMarkdown, inlineMarkdown };
  }

  // client/config.mjs
  function readConfig(selector) {
    const node = document.querySelector(selector);
    return node ? JSON.parse(node.textContent) : null;
  }

  // core/protection.mjs
  function folderCrypto(platform = globalThis) {
    const max = 64 * 1024 * 1024;
    const enc = new TextEncoder();
    const fail = () => {
      throw new Error("Invalid protected post");
    };
    const decode = (s, limit) => {
      if (typeof s !== "string" || s.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))
        fail();
      const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      if (b.length > limit) fail();
      return b;
    };
    const parameters = (p) => {
      if (!p || Object.keys(p).sort().join(",") !== "folderId,iterations,keyVersion,salt,siteId,version" || p.version !== 1 || p.iterations !== 6e5 || !/^github:[0-9]+$/.test(p.siteId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.folderId) || !/^[a-f0-9]{32}$/.test(p.keyVersion) || decode(p.salt, 16).length !== 16)
        fail();
      return p;
    };
    const validate = (e) => {
      const p = e?.protection;
      if (!e || Object.keys(e).sort().join(",") !== "ciphertext,folderId,format,nonce,permalink,postId,protection,version" || e.format !== "layall-protected" || e.version !== 1 || typeof e.postId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(e.postId) || e.permalink !== e.postId || e.folderId !== null && (typeof e.folderId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(e.folderId)))
        fail();
      parameters(p);
      if (decode(e.nonce, 12).length !== 12 || typeof e.ciphertext !== "string" || e.ciphertext.length > Math.ceil((max + 16) / 3) * 4 || e.ciphertext.length < 24)
        fail();
      return p;
    };
    const namespace = (e) => {
      const p = validate(e);
      return JSON.stringify([
        platform.location?.origin || "",
        p.siteId,
        p.folderId,
        p.keyVersion,
        p.salt,
        p.iterations
      ]);
    };
    const derive = async (e, password) => {
      const p = validate(e);
      if (typeof password !== "string" || !password) fail();
      const material = await platform.crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
      );
      return platform.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: decode(p.salt, 16), iterations: p.iterations, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
    };
    const open = async (e, key) => {
      const p = validate(e);
      if (!key || key.extractable || key.type !== "secret" || key.algorithm?.name !== "AES-GCM" || key.algorithm.length !== 256 || key.usages.length !== 1 || key.usages[0] !== "decrypt")
        fail();
      const additionalData = enc.encode(
        JSON.stringify([
          "layall-protected",
          1,
          p.siteId,
          p.folderId,
          p.keyVersion,
          p.salt,
          p.iterations,
          e.postId,
          e.folderId
        ])
      );
      const bytes = await platform.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(e.nonce, 12), additionalData, tagLength: 128 },
        key,
        decode(e.ciphertext, max + 16)
      );
      const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const s = payload.source;
      if (!s || s.format !== "layall-note" || s.postId !== e.postId || s.folderId !== e.folderId || s.permalink !== e.postId || !payload.assets || typeof payload.assets !== "object" || Array.isArray(payload.assets))
        fail();
      for (const [path, bytes2] of Object.entries(payload.assets)) {
        if (!path.startsWith(`content/posts/${e.postId}/assets/`) || path.includes("\\") || path.split("/").some((p2) => !p2 || p2 === "." || p2 === ".."))
          fail();
        decode(bytes2, max);
      }
      return payload;
    };
    const scope = (name) => {
      try {
        return JSON.stringify(JSON.parse(name).slice(0, 3));
      } catch {
        return null;
      }
    };
    const session = /* @__PURE__ */ new Map();
    const epochs = /* @__PURE__ */ new Map();
    const revisions = /* @__PURE__ */ new Map();
    const revoked = () => Object.assign(new Error("Unlock was revoked"), { revoked: true });
    const storage = (op, name, key, expected) => new Promise((resolve, reject) => {
      let db, tx, settled = false, result, reason;
      const end = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error)
          try {
            tx?.abort();
          } catch {
          }
        db?.close();
        error ? reject(reason || new Error("Unlock storage unavailable")) : resolve(result);
      };
      const timer = setTimeout(() => {
        reason = new Error("Unlock storage timed out");
        if (tx) {
          try {
            tx.abort();
            return;
          } catch {
          }
        }
        end(true);
      }, 3e3);
      try {
        const request = platform.indexedDB.open("layall-folder-keys-v1", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("keys");
        request.onerror = request.onblocked = () => end(true);
        request.onsuccess = () => {
          db = request.result;
          if (settled) {
            db.close();
            return;
          }
          try {
            tx = db.transaction(
              "keys",
              op === "forget" || op === "put" ? "readwrite" : "readonly"
            );
            const store = tx.objectStore("keys"), revName = "rev:" + scope(name), r = store.get(revName);
            r.onsuccess = () => {
              const revision = r.result ?? 0;
              if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
                tx.abort();
                return;
              }
              if (op === "forget") {
                store.put(revision + 1, revName);
                result = revision + 1;
                const all = store.getAllKeys();
                all.onsuccess = () => {
                  for (const candidate of all.result)
                    if (scope(candidate) === scope(name))
                      store.delete(candidate);
                };
              } else if (op === "put") {
                if (revision !== expected) {
                  reason = revoked();
                  tx.abort();
                  return;
                }
                store.put(key, name);
                result = revision;
              } else if (op === "revision") result = revision;
              else {
                const k = store.get(name);
                k.onsuccess = () => {
                  result = { key: k.result, revision };
                };
              }
            };
            tx.oncomplete = () => end(false);
            tx.onerror = tx.onabort = () => end(true);
          } catch {
            end(true);
          }
        };
      } catch {
        end(true);
      }
    });
    const invalidate = (e) => {
      const name = namespace(e), group = scope(name);
      epochs.set(group, (epochs.get(group) || 0) + 1);
      for (const candidate of session.keys())
        if (scope(candidate) === group) session.delete(candidate);
    };
    const observe = (name, revision) => {
      const group = scope(name);
      revisions.set(group, Math.max(revision, revisions.get(group) ?? -1));
    };
    const notify = (e, revision) => {
      const name = namespace(e);
      if (!Number.isSafeInteger(revision) || revision < 0 || revision <= (revisions.get(scope(name)) ?? -1))
        return false;
      observe(name, revision);
      invalidate(e);
      return true;
    };
    const unlock = async (e, password) => {
      const name = namespace(e), epoch = epochs.get(scope(name)) || 0;
      let revision, persisted = true;
      try {
        revision = await storage("revision", name);
        observe(name, revision);
      } catch {
        persisted = false;
      }
      const key = await derive(e, password), payload = await open(e, key);
      if ((epochs.get(scope(name)) || 0) !== epoch) throw revoked();
      if (persisted)
        try {
          await storage("put", name, key, revision);
          if (await storage("revision", name) !== revision) throw revoked();
        } catch (error) {
          if (error.revoked) throw error;
          persisted = false;
        }
      if ((epochs.get(scope(name)) || 0) !== epoch) throw revoked();
      session.set(name, { key, revision, persisted });
      return { payload, persisted };
    };
    const restore = async (e) => {
      const name = namespace(e), epoch = epochs.get(scope(name)) || 0;
      let remembered = session.get(name), storageFailed = false, stored;
      try {
        stored = await storage("get", name);
        observe(name, stored.revision);
      } catch {
        storageFailed = true;
      }
      if (stored && remembered && (remembered.revision !== stored.revision || remembered.persisted && !stored.key)) {
        session.delete(name);
        remembered = null;
      }
      const key = stored?.key || (!storageFailed || !remembered?.persisted) && remembered?.key;
      if (!key) return { payload: null, storageFailed };
      try {
        const payload = await open(e, key);
        if ((epochs.get(scope(name)) || 0) !== epoch) return { payload: null, storageFailed };
        if (stored && await storage("revision", name) !== stored.revision) {
          session.delete(name);
          return { payload: null, storageFailed };
        }
        session.set(name, {
          key,
          revision: stored?.revision ?? remembered?.revision,
          persisted: !!stored?.key
        });
        return { payload, storageFailed };
      } catch {
        session.delete(name);
        return { payload: null, storageFailed };
      }
    };
    const forget = async (e) => {
      invalidate(e);
      const name = namespace(e), revision = await storage("forget", name);
      observe(name, revision);
      return revision;
    };
    return {
      validate,
      parameters,
      namespace,
      scope,
      derive,
      open,
      unlock,
      restore,
      forget,
      invalidate,
      notify,
      decode
    };
  }

  // render/note-toc.mjs
  function noteToc(headings = []) {
    const visibleHeadings = headings?.filter((h) => h.level >= 1 && h.level <= 6) ?? [];
    const firstHeadingLabel = visibleHeadings[0]?.label ?? "목차";
    return visibleHeadings.length ? `<div class="note-toc-strip" data-note-toc-strip><div class="note-toc-bar"><button type="button" class="note-toc-toggle-bar" data-note-toc-toggle aria-expanded="false" aria-label="목차 열기" aria-controls="note-toc-list"><span class="note-toc-current"><span class="note-toc-active-marker" data-note-toc-marker>§</span><span class="note-toc-active-label" data-note-toc-label>${esc(firstHeadingLabel)}</span></span><span class="note-toc-caret" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></button><nav class="note-toc-dropdown" id="note-toc-list" data-note-toc-dropdown hidden aria-label="글 목차"><ol class="note-toc-list">${visibleHeadings.map((h, i) => `<li class="note-toc-item toc-level-${h.level}" data-toc-target="${esc(h.id)}" data-toc-idx="${i}"><a href="#${esc(h.id)}" class="note-toc-link"><span class="note-toc-item-marker">${h.level <= 2 ? "§" : "•"}</span><span class="note-toc-item-title">${esc(h.label)}</span></a></li>`).join("")}</ol></nav></div></div>` : "";
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

  // client/discussions.mjs
  function discussionTheme(config2, root, system) {
    const name = Object.hasOwn(config2.themes, root.dataset.theme) ? root.dataset.theme : "layall";
    const mode = root.dataset.colorMode === "dark" || root.dataset.colorMode === "system" && system.matches ? "dark" : "light";
    return config2.themes[name][mode];
  }
  function mountProtectedDiscussion(config2, host) {
    const events = listeners();
    const section = document.createElement("section");
    section.className = "discussion-thread";
    section.setAttribute("aria-label", "댓글과 반응");
    const status = document.createElement("p");
    status.className = "muted";
    status.setAttribute("role", "status");
    section.append(status);
    host.append(section);
    if (!config2) {
      status.textContent = "댓글 연결이 준비되지 않았습니다.";
      return () => section.remove();
    }
    const notice = document.createElement("p");
    notice.id = "protected-comments-notice";
    notice.textContent = "댓글은 암호화되지 않습니다.";
    notice.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
    section.append(notice);
    const frame = document.createElement("iframe");
    frame.className = "giscus-frame";
    frame.title = "댓글과 반응";
    frame.setAttribute("aria-describedby", notice.id);
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("allow", "clipboard-write");
    frame.referrerPolicy = "no-referrer";
    frame.style.cssText = "width:100%;min-height:150px;border:0";
    const root = document.documentElement;
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const theme = () => discussionTheme(config2, root, system);
    let disposed = false, session = "";
    const returned = new URL(location.href);
    const incoming = returned.searchParams.get("giscus");
    if (incoming) {
      session = incoming;
      returned.searchParams.delete("giscus");
      history.replaceState(history.state, "", returned);
    }
    try {
      if (incoming) localStorage.setItem("giscus-session", JSON.stringify(incoming));
      else session = JSON.parse(localStorage.getItem("giscus-session") || '""');
    } catch {
    }
    if (typeof session !== "string" || session.length > 16384) session = "";
    const start = () => {
      if (disposed) return;
      status.hidden = false;
      status.textContent = "댓글·반응 불러오는 중…";
      const params = new URLSearchParams({
        origin: config2.url,
        backLink: config2.url,
        description: "",
        repo: config2.repo,
        repoId: config2.repoId,
        category: config2.category,
        categoryId: config2.categoryId,
        number: String(config2.number),
        strict: "1",
        reactionsEnabled: "1",
        emitMetadata: "1",
        inputPosition: "top",
        theme: theme(),
        session
      });
      frame.src = `https://giscus.app/${config2.lang}/widget?${params}`;
    };
    const sync = () => {
      if (!disposed)
        frame.contentWindow?.postMessage(
          { giscus: { setConfig: { theme: theme() } } },
          "https://giscus.app"
        );
    };
    const message = (event) => {
      if (disposed || event.origin !== "https://giscus.app" || event.source !== frame.contentWindow || !event.data?.giscus)
        return;
      const data = event.data.giscus;
      if (data.signOut || typeof data.error === "string" && /Bad credentials|Invalid state value|State has expired/.test(data.error)) {
        try {
          localStorage.removeItem("giscus-session");
        } catch {
        }
        if (session) {
          session = "";
          start();
        }
      } else if (data.error) {
        status.hidden = false;
        status.textContent = "댓글을 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
      } else if (Number.isFinite(data.resizeHeight) && data.resizeHeight > 0) {
        frame.style.height = `${Math.min(1e5, data.resizeHeight)}px`;
        status.hidden = true;
      } else if (data.discussion) status.hidden = true;
    };
    const appearance = new MutationObserver(sync);
    appearance.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-mode"]
    });
    events.on(system, "change", sync);
    events.on(window, "message", message);
    events.on(frame, "load", sync);
    start();
    section.append(frame);
    return () => {
      disposed = true;
      session = "";
      appearance.disconnect();
      events.dispose();
      section.remove();
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

  // client/protected.mjs
  function mountProtected(envelope2, renderMarkdown, { platform = globalThis, core = folderCrypto(platform) } = {}) {
    const { document: document2, window: window2, URL: URL2, Blob, BroadcastChannel } = platform;
    const host = document2.querySelector("[data-protected-post]");
    if (!host) return { dispose() {
    } };
    const publicMetadata = [".article-meta", ".article-date"].map(
      (selector) => host.querySelector(selector)?.cloneNode(true)
    );
    const urls = [];
    const events = listeners();
    let disposed = false, suspended = false, pendingLocks = 0;
    let generation = 0, disposeComments, disposeToc;
    const name = core.scope(core.namespace(envelope2));
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("layall-folder-locks-v1") : null;
    const clear = () => {
      generation++;
      disposeToc?.();
      disposeToc = void 0;
      disposeComments?.();
      disposeComments = void 0;
      urls.splice(0).forEach((url) => URL2.revokeObjectURL(url));
      host.replaceChildren();
      window2.dispatchEvent?.(new (window2.Event || Event)("layall:article-content"));
      document2.title = "보호된 글";
    };
    const text = (tag, value) => {
      const el = document2.createElement(tag);
      el.textContent = value;
      return el;
    };
    const locked = (notice = "") => {
      if (disposed || suspended) return;
      clear();
      host.append(
        text("h1", "보호된 글"),
        text("p", "이 폴더의 비밀번호를 입력하세요. 잠금 해제는 이 브라우저에 기억됩니다.")
      );
      const form = document2.createElement("form");
      form.className = "search-form";
      const input = document2.createElement("input");
      input.type = "password";
      input.autocomplete = "current-password";
      input.required = true;
      input.setAttribute("aria-label", "폴더 비밀번호");
      const button = text("button", "잠금 해제");
      button.type = "submit";
      const status = text("p", notice);
      status.setAttribute("role", "status");
      form.append(input, button);
      host.append(form, status);
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (disposed || suspended) return;
        const current = ++generation;
        button.disabled = true;
        let password = input.value;
        input.value = "";
        try {
          const result = await core.unlock(envelope2, password);
          password = "";
          if (current !== generation) return;
          show(
            result.payload,
            result.persisted ? "" : "브라우저 저장을 확인하지 못했습니다. 현재 페이지는 열리지만 다음 방문에 비밀번호가 다시 필요할 수 있습니다."
          );
        } catch {
          if (current === generation) {
            status.textContent = "비밀번호가 다르거나 글을 열 수 없습니다.";
            button.disabled = false;
          }
        } finally {
          password = "";
        }
      };
    };
    const show = (payload, notice = "") => {
      if (disposed || suspended) return;
      clear();
      const source = payload.source, assets = /* @__PURE__ */ new Map();
      for (const a of Array.isArray(source.attachments) ? source.attachments : []) {
        const bytes = payload.assets[`content/posts/${source.postId}/${a.path}`];
        if (typeof bytes !== "string") continue;
        const mime = /^image\/(png|jpeg|gif|webp|avif)$/.test(a.mimeType) ? a.mimeType : "application/octet-stream";
        const url = URL2.createObjectURL(
          new Blob([core.decode(bytes, 64 * 1024 * 1024)], { type: mime })
        );
        urls.push(url);
        assets.set(String(a.id), { url, image: mime.startsWith("image/") });
      }
      const relock = text("button", "다시 잠금");
      relock.type = "button";
      const status = text("p", notice);
      status.setAttribute("role", "status");
      relock.onclick = async () => {
        if (disposed || suspended) return;
        clear();
        const current = generation;
        pendingLocks++;
        let failed = false, revision;
        try {
          revision = await core.forget(envelope2);
        } catch {
          failed = true;
        }
        try {
          channel?.postMessage({ scope: name, revision });
        } finally {
          pendingLocks--;
          if (disposed && !pendingLocks) channel?.close();
        }
        if (current !== generation) return;
        locked(
          failed ? "저장된 키를 지우지 못했습니다. 브라우저의 사이트 데이터를 삭제하세요." : "잠금 해제 정보를 지웠습니다."
        );
      };
      const header = document2.createElement("header");
      header.className = "note-protected-header";
      header.append(
        ...[
          publicMetadata[0]?.cloneNode(true),
          text("h1", String(source.title || "제목 없는 글")),
          publicMetadata[1]?.cloneNode(true)
        ].filter(Boolean)
      );
      host.append(relock, status, header);
      const content = document2.createElement("div");
      content.className = "article-body";
      const rendered = renderMarkdown(source.body, assets);
      content.innerHTML = rendered.html;
      const tocMarkup = noteToc(rendered.headings);
      if (tocMarkup) {
        const template = document2.createElement("template");
        template.innerHTML = tocMarkup;
        host.append(template.content);
      }
      host.append(content);
      disposeToc = mountNoteToc(host, platform).dispose;
      for (const [field, label] of [
        ["tags", "태그"],
        ["summaries", "요약"],
        ["tasks", "할 일"],
        ["highlights", "강조 표시"]
      ]) {
        if (!Array.isArray(source[field]) || !source[field].length) continue;
        host.append(text("h2", label));
        for (const item of source[field]) {
          const row = document2.createElement("div");
          row.innerHTML = renderMarkdown(String(item), assets).html;
          host.append(row);
        }
      }
      for (const a of Array.isArray(source.attachments) ? source.attachments : []) {
        const asset = assets.get(String(a.id));
        if (!asset) continue;
        const link = text("a", String(a.path).split("/").pop() || "첨부파일");
        link.href = asset.url;
        link.download = String(a.path).split("/").pop();
        host.append(link, document2.createElement("br"));
      }
      const comments = document2.querySelector("[data-protected-discussion]");
      window2.dispatchEvent?.(new (window2.Event || Event)("layall:article-content"));
      if (comments)
        disposeComments = mountProtectedDiscussion(JSON.parse(comments.textContent), host);
    };
    channel && (channel.onmessage = (event) => {
      if (!disposed && event.data?.scope === name && core.notify(envelope2, event.data.revision)) {
        locked("이 폴더를 다시 잠갔습니다.");
      }
    });
    const restore = async () => {
      if (disposed) return;
      suspended = false;
      locked();
      const current = generation;
      try {
        const result = await core.restore(envelope2);
        if (current !== generation) return;
        if (result.payload) show(result.payload);
        else if (result.storageFailed)
          locked("브라우저의 잠금 해제 저장소에 접근할 수 없습니다.");
      } catch {
        if (current === generation) locked("보호된 글을 열 수 없습니다.");
      }
    };
    const controller = {
      dispose() {
        if (disposed) return;
        disposed = true;
        events.dispose();
        if (channel) channel.onmessage = null;
        if (!pendingLocks) channel?.close();
        core.invalidate(envelope2);
        clear();
      }
    };
    events.on(window2, "pagehide", (event) => {
      if (event?.persisted === false) {
        controller.dispose();
        return;
      }
      suspended = true;
      core.invalidate(envelope2);
      clear();
    });
    events.on(window2, "pageshow", (event) => {
      if (event.persisted) void restore();
    });
    void restore();
    return controller;
  }

  // client/protected-entry.mjs
  var config = readConfig("[data-site-config]");
  var envelope = readConfig("[data-protected-envelope]");
  if (envelope)
    mountProtected(
      envelope,
      createMarkdown({ href: (value) => config.basePath + value }).renderMarkdown
    );
})();
