"use strict";
(() => {
  // client/config.mjs
  function readConfig(selector) {
    const node = document.querySelector(selector);
    return node ? JSON.parse(node.textContent) : null;
  }

  // client/discussions.mjs
  function mountDiscussion(config2) {
    const root = document.documentElement;
    const holder = document.querySelector("[data-post-discussion]");
    const container = holder?.querySelector(".giscus");
    if (!container || holder.dataset.giscusMounted === "true") return;
    holder.dataset.giscusMounted = "true";
    const status = holder.querySelector("[data-discussion-status]");
    const retry = holder.querySelector("[data-discussion-retry]");
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const themeUrl = () => {
      const name = Object.hasOwn(config2.themes, root.dataset.theme) ? root.dataset.theme : "layall";
      const mode = root.dataset.colorMode === "dark" || root.dataset.colorMode === "system" && system.matches ? "dark" : "light";
      return config2.themes[name][mode];
    };
    const frame = () => container.querySelector("iframe.giscus-frame");
    let lastTheme = "";
    const sync = (force = false) => {
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
      if (target && target.dataset.layallObserved !== "true") {
        target.dataset.layallObserved = "true";
        target.addEventListener("load", () => sync(true));
        sync(true);
      }
    });
    frames.observe(container, { childList: true });
    system.addEventListener("change", () => sync());
    window.addEventListener("message", (event) => {
      if (event.origin !== "https://giscus.app" || event.source !== frame()?.contentWindow || !event.data?.giscus)
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
      if (frame() || holder.querySelector("script[data-layall-giscus]")) return;
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
      script.addEventListener("error", () => {
        script.remove();
        status.hidden = false;
        status.textContent = "댓글 서비스를 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";
        retry.hidden = false;
      });
      holder.append(script);
    };
    retry.addEventListener("click", start);
    start();
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

  // client/blog-home.mjs
  function createBlogHome({ mount }) {
    const events = listeners();
    const blogState = { tab: "overview", book: "", tags: /* @__PURE__ */ new Set(), enabled: true };
    let syncBlogHash = () => {
    };
    const bindBlog = () => {
      events.dispose();
      syncBlogHash = () => {
      };
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
      syncBlogHash = () => {
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
      home.querySelector("[data-blog-open-posts]")?.addEventListener("click", (event) => {
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
      syncBlogHash();
      filter();
    };
    const onHashChange = () => syncBlogHash();
    window.addEventListener("hashchange", onHashChange);
    return {
      bind: bindBlog,
      dispose: () => {
        events.dispose();
        window.removeEventListener("hashchange", onHashChange);
      }
    };
  }

  // client/docs-navigation.mjs
  function createDocsNavigation({ config: config2, root, mount }) {
    let docsRequest, activeController;
    let disposed = false;
    const loadingDocs = /* @__PURE__ */ new WeakSet();
    const loadedDocs = /* @__PURE__ */ new WeakSet();
    const docsResource = config2.docsResource;
    const postPrefix = config2.postPrefix;
    const requestDocs = (descriptor) => {
      const url = new URL(descriptor, location.href);
      if (url.origin !== location.origin || url.pathname !== docsResource || url.search || url.hash || url.username || url.password)
        throw new Error("Invalid navigation resource");
      if (!docsRequest) {
        const controller = new AbortController();
        activeController = controller;
        const timeout = setTimeout(() => controller.abort(), 8e3);
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
          return data.tree;
        }).catch((error) => {
          docsRequest = null;
          throw error;
        }).finally(() => clearTimeout(timeout));
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
      loadingDocs.add(nav);
      tree.setAttribute("aria-busy", "true");
      try {
        const entries = await requestDocs(nav.dataset.docsResource);
        if (disposed || !nav.isConnected || !mount.contains(nav)) return;
        tree.replaceChildren(docsTree(entries));
        loadedDocs.add(nav);
        status.textContent = "";
      } catch {
        docsRequest = null;
        if (!disposed)
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
      loadEntries: () => requestDocs(docsResource),
      dispose() {
        disposed = true;
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
  function mountNavigation({ config: config2 = {}, root, nav, navToggle, palettePickers, loadDocsTree }) {
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
    const noteTocStrip = document.querySelector("[data-note-toc-strip]");
    const noteTocToggle = document.querySelector("[data-note-toc-toggle]");
    const noteTocDropdown = document.querySelector("[data-note-toc-dropdown]");
    const noteTocMarker = document.querySelector("[data-note-toc-marker]");
    const noteTocLabel = document.querySelector("[data-note-toc-label]");
    const closeNoteToc = () => {
      if (!noteTocDropdown || noteTocDropdown.hidden) return;
      noteTocDropdown.hidden = true;
      noteTocToggle?.setAttribute("aria-expanded", "false");
    };
    if (noteTocToggle && noteTocDropdown) {
      events.on(noteTocToggle, "click", (event) => {
        event.stopPropagation();
        const open = noteTocDropdown.hidden;
        noteTocDropdown.hidden = !open;
        noteTocToggle.setAttribute("aria-expanded", String(open));
        if (open) {
          const activeOrFirst = noteTocDropdown.querySelector(".note-toc-item.active a") || noteTocDropdown.querySelector("a");
          activeOrFirst?.focus();
        }
      });
    }
    noteTocDropdown?.querySelectorAll('a[href^="#"]').forEach(
      (link) => events.on(link, "click", () => {
        closeNoteToc();
        const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }
      })
    );
    if (noteTocStrip && noteTocLabel) {
      const headingEls = [
        ...document.querySelectorAll(".article-body h2, .article-body h3, .article-body h4")
      ];
      if (headingEls.length > 0) {
        let scrollTicking = false;
        const onScroll = () => {
          if (scrollTicking) return;
          scrollTicking = true;
          window.requestAnimationFrame(() => {
            scrollTicking = false;
            const scrollOffset = 140;
            let currentHeading = headingEls[0];
            for (let i = 0; i < headingEls.length; i++) {
              if (headingEls[i].getBoundingClientRect().top <= scrollOffset) {
                currentHeading = headingEls[i];
              } else {
                break;
              }
            }
            if (currentHeading) {
              const cleanText = currentHeading.textContent.replace(/#\s*$/, "").trim();
              if (noteTocLabel.textContent !== cleanText) {
                noteTocLabel.textContent = cleanText;
              }
              if (noteTocMarker) {
                noteTocMarker.textContent = currentHeading.tagName === "H2" ? "§" : "•";
              }
              if (noteTocDropdown) {
                const currentId = currentHeading.id;
                noteTocDropdown.querySelectorAll(".note-toc-item").forEach((item) => {
                  const active = item.dataset.tocTarget === currentId;
                  item.classList.toggle("active", active);
                  const a = item.querySelector("a");
                  if (active) a?.setAttribute("aria-current", "location");
                  else a?.removeAttribute("aria-current");
                });
              }
            }
          });
        };
        events.on(window, "scroll", onScroll, { passive: true });
        onScroll();
      }
    }
    const bindArticleNav = () => {
      const bottomNav = document.querySelector(".article-bottom-nav");
      const activeTheme = root ? root.dataset.theme : document.documentElement.dataset.theme;
      if (!bottomNav || activeTheme !== "layall" || bottomNav.dataset.bound === "true") return;
      bottomNav.dataset.bound = "true";
      const treePromise = loadDocsTree ? loadDocsTree() : config2?.docsResource ? fetch(config2.docsResource).then((res) => res.ok ? res.json() : null).then((data) => data?.tree) : Promise.resolve(null);
      treePromise.then((tree) => {
        if (!tree || !Array.isArray(tree)) return;
        const rawPath = location.pathname.endsWith("/index.html") ? location.pathname.slice(0, -10) : location.pathname;
        const normPath = rawPath.endsWith("/") ? rawPath : rawPath + "/";
        let siblings = null;
        const findInNodes = (nodes) => {
          for (const node of nodes) {
            if (node.children) {
              const directPosts = node.children.filter((child) => typeof child.href === "string");
              if (directPosts.some((p) => {
                const pNorm = p.href.endsWith("/") ? p.href : p.href + "/";
                return pNorm === normPath || normPath.endsWith(pNorm);
              })) {
                siblings = directPosts;
                return true;
              }
              if (findInNodes(node.children)) return true;
            }
          }
          return false;
        };
        findInNodes(tree);
        if (!siblings || siblings.length <= 1) {
          const all = [];
          const collect = (nodes) => {
            for (const n of nodes) {
              if (typeof n.href === "string") all.push(n);
              if (Array.isArray(n.children)) collect(n.children);
            }
          };
          collect(tree);
          siblings = all;
        }
        const idx = siblings.findIndex((p) => {
          const pNorm = p.href.endsWith("/") ? p.href : p.href + "/";
          return pNorm === normPath || normPath.endsWith(pNorm);
        });
        if (idx !== -1) {
          const prev = idx > 0 ? siblings[idx - 1] : null;
          const next = idx < siblings.length - 1 ? siblings[idx + 1] : null;
          const prevLink = bottomNav.querySelector("[data-nav-prev]");
          const prevTitle = bottomNav.querySelector("[data-nav-prev-title]");
          const prevEmpty = bottomNav.querySelector("[data-nav-prev-empty]");
          const nextLink = bottomNav.querySelector("[data-nav-next]");
          const nextTitle = bottomNav.querySelector("[data-nav-next-title]");
          const nextEmpty = bottomNav.querySelector("[data-nav-next-empty]");
          if (prev && prevLink && prevTitle) {
            prevLink.href = prev.href;
            prevTitle.textContent = prev.label;
            prevLink.title = `이전 글: ${prev.label}`;
            prevLink.hidden = false;
            if (prevEmpty) prevEmpty.hidden = true;
          }
          if (next && nextLink && nextTitle) {
            nextLink.href = next.href;
            nextTitle.textContent = next.label;
            nextLink.title = `다음 글: ${next.label}`;
            nextLink.hidden = false;
            if (nextEmpty) nextEmpty.hidden = true;
          }
        }
      }).catch(() => {
      });
    };
    bindArticleNav();
    events.on(document, "click", (event) => {
      if (noteTocDropdown && !noteTocDropdown.hidden && !noteTocStrip?.contains(event.target))
        closeNoteToc();
      if (tocPanel?.dataset.open === "true" && !tocPanel.contains(event.target) && !tocToggle?.contains(event.target))
        closeToc();
      if (nav?.dataset.open === "true" && !nav.contains(event.target) && !navToggle?.contains(event.target) && !palettePickers.some((picker) => picker.contains(event.target)))
        closeNav();
    });
    events.on(document, "keydown", (event) => {
      if (event.key === "Escape") {
        closeNoteToc();
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
      bindArticleNav,
      dispose() {
        events.dispose();
        closeNav();
        closeToc();
        closeNoteToc();
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
      let frame = 0;
      let watching = false;
      const contains = (target) => picker.contains(target) || panel.contains(target);
      const close = (focus = false) => {
        picker.open = false;
        panel.hidden = true;
        summary.setAttribute("aria-expanded", "false");
        window.cancelAnimationFrame(frame);
        frame = 0;
        window.removeEventListener("resize", schedule);
        window.removeEventListener("scroll", schedule, true);
        viewport?.removeEventListener("resize", schedule);
        viewport?.removeEventListener("scroll", schedule);
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
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        viewport?.addEventListener("resize", schedule);
        viewport?.addEventListener("scroll", schedule);
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
      window.addEventListener("pagehide", pagehide);
      disposers.push(() => {
        close();
        window.removeEventListener("pagehide", pagehide);
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
    let pageGeneration = 0;
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
        const query = input.value.trim().toLocaleLowerCase();
        const entries = await fetch(config2.searchUrl).then((response) => response.json());
        if (generation !== pageGeneration || input.isConnected === false) return;
        const found = query ? entries.filter(
          (entry) => [entry.title, entry.body, entry.folder, ...entry.tags].join(" ").toLocaleLowerCase().includes(query)
        ) : entries;
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
          query ? url.searchParams.set("q", input.value.trim()) : url.searchParams.delete("q");
          history.replaceState(null, "", url);
        }
      };
      events.on(form, "submit", (event) => {
        event.preventDefault();
        run(true).catch(() => status.textContent = "검색 색인을 불러오지 못했습니다.");
      });
      input.value = preservedQuery || new URL(location.href).searchParams.get("q") || "";
      run().catch(() => status.textContent = "검색 색인을 불러오지 못했습니다.");
    };
    return {
      bind: bindSearch,
      invalidate: () => {
        pageGeneration++;
        events.dispose();
      }
    };
  }

  // client/appearance.mjs
  function applyArticleAppearance(root, mount, next) {
    const articleShell = mount.querySelector("[data-article-shell]");
    if (!articleShell) return false;
    root.dataset.theme = next;
    root.dataset.layallTheme = next;
    articleShell.className = next === "docs" ? "docs-layout" : "article-frame";
    articleShell.querySelector("[data-article-main]").className = next === "docs" ? "docs-content" : "article-shell theme-article-" + next;
    return true;
  }

  // client/theme-controller.mjs
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
      if (!layoutThemes.has(next) || !mount) return;
      if (applyArticleAppearance(root, mount, next)) {
        syncLayout();
        onArticleAppearance();
        return;
      }
      const template = document.querySelector('template[data-theme-layout="' + next + '"]');
      if (!template) return;
      const query = document.querySelector("[data-search-input]")?.value || "";
      beforeReplace();
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
        activate(next);
        writeStored(layoutKey, next);
      })
    );
    return {
      current: () => root.dataset.theme,
      select(next) {
        if (!layoutThemes.has(next)) return;
        activate(next);
        writeStored(layoutKey, next);
      },
      restore() {
        const remembered = readStored(layoutKey);
        if (layoutThemes.has(remembered) && remembered !== authorTheme) activate(remembered);
        else {
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
  function mountSite(config2) {
    const root = document.documentElement;
    root.dataset.js = "true";
    const mount = document.querySelector("[data-theme-view]");
    const docs = createDocsNavigation({ config: config2, root, mount });
    const search = createSearch(config2);
    const blog = createBlogHome({ mount });
    const widgets = createHomeWidgets({ mount });
    const nav = document.querySelector("[data-nav]");
    const navToggle = document.querySelector("[data-nav-toggle]");
    let navigation;
    const themes = createThemeController({
      config: config2,
      root,
      mount,
      beforeReplace: search.invalidate,
      onArticleAppearance() {
        docs.bind();
        navigation?.bindArticleNav();
      },
      onPageMounted(query = "") {
        docs.bind();
        search.bind(query);
        blog.bind();
        widgets.bind();
        navigation?.bindArticleNav();
      }
    });
    const palettes = mountPalettes({ root, nav, current: themes.current, onSelect: themes.select });
    navigation = mountNavigation({
      config: config2,
      root,
      nav,
      navToggle,
      palettePickers: palettes.pickers,
      loadDocsTree: docs.loadEntries
    });
    themes.restore();
    return {
      dispose() {
        palettes.dispose();
        navigation.dispose();
        themes.dispose();
        blog.dispose();
        docs.dispose();
        widgets.dispose();
        search.invalidate();
      }
    };
  }

  // client/site-entry.mjs
  var config = readConfig("[data-site-config]");
  if (config) {
    mountSite(config);
    registerWorker(config.pwa);
    const discussion = readConfig("[data-discussion-config]");
    if (discussion) mountDiscussion(discussion);
  }
})();
