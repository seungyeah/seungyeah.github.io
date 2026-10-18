import { codeKind, highlightCode } from './code-highlight.mjs';
import { createDiagramLoader, diagramURLs } from './diagram-loader.mjs';
import { listeners } from './lifecycle.mjs';
import { diagramDocument, diagramTheme } from './mermaid-frame.mjs';

export function mountArticleCode(scope, { document, window }, diagramConfig) {
	if (!scope) return { dispose() {} };
	const entries = new Map(),
		events = listeners();
	const root = document.documentElement;
	const loader = createDiagramLoader(diagramConfig, { window });
	const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
	let disposed = false,
		suspended = false,
		sequence = 0;
	const discardFrame = (entry) => {
		window.clearTimeout(entry.timer);
		if (entry.frame) {
			entry.frame.srcdoc = '';
			entry.frame.remove();
			entry.frame = null;
		}
		if (![...entries.values()].some((item) => item.frame)) loader.cancel();
		entry.pre.hidden = false;
		entry.button.hidden = true;
	};
	const release = (entry) => {
		discardFrame(entry);
		entry.button.removeEventListener('click', entry.click);
		entry.code.textContent = entry.source;
		entry.pre.classList.remove('is-wrapped');
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
		if (!diagramConfig || !entry.source.trim() || entry.source.length > 100000) return;
		try {
			const scriptUrl = diagramURLs(diagramConfig, window.location.origin).script;
			const frame = document.createElement('iframe');
			entry.loading = false;
			entry.token = String(++sequence);
			frame.className = 'article-diagram';
			frame.title = 'Mermaid 다이어그램';
			frame.setAttribute('sandbox', 'allow-scripts');
			frame.setAttribute('referrerpolicy', 'no-referrer');
			frame.setAttribute('data-pending', 'true');
			frame.srcdoc = diagramDocument({
				scriptUrl,
				origin: window.location.origin,
				source: entry.source,
				token: entry.token,
				colors: diagramTheme(root, scheme?.matches),
			});
			entry.frame = frame;
			entry.block.append(frame);
			entry.timer = window.setTimeout(() => {
				discardFrame(entry);
			}, 15000);
		} catch {
			/* Plain source stays readable if local runtime configuration is unavailable. */
		}
	};
	const scan = () => {
		if (disposed || suspended) return;
		for (const [code, entry] of entries)
			if (!scope.contains(code)) {
				release(entry);
				entries.delete(code);
			}
		for (const code of scope.querySelectorAll('pre > code')) {
			if (entries.has(code)) continue;
			const pre = code.parentElement,
				source = code.textContent;
			const kind = codeKind(source, code.dataset.language);
			const block = document.createElement('div'),
				toolbar = document.createElement('div'),
				label = document.createElement('span'),
				button = document.createElement('button');
			block.className = 'article-code';
			toolbar.className = 'article-code-tools';
			label.textContent = kind.language || 'text';
			button.type = 'button';
			button.textContent = kind.diagram ? '코드 보기' : '줄바꿈';
			button.setAttribute('aria-pressed', 'false');
			const entry = {
				code,
				pre,
				source,
				block,
				button,
				...kind,
				frame: null,
				timer: 0,
				token: '',
				attributes: ['tabindex', 'aria-label'].map((name) => [
					name,
					pre.getAttribute(name),
				]),
				click: null,
			};
			entry.click = () => {
				const pressed = button.getAttribute('aria-pressed') !== 'true';
				button.setAttribute('aria-pressed', String(pressed));
				if (kind.diagram && entry.frame) {
					pre.hidden = !pressed;
					entry.frame.hidden = pressed;
				} else pre.classList.toggle('is-wrapped', pressed);
			};
			entries.set(code, entry); // Register before DOM changes observed by our own observer.
			button.addEventListener('click', entry.click);
			toolbar.append(label, button);
			pre.before(block);
			block.append(toolbar, pre);
			pre.setAttribute('tabindex', '0');
			pre.setAttribute('aria-label', `${kind.language || '일반'} 코드`);
			if (kind.diagram) renderDiagram(entry);
			else {
				const html = highlightCode(source, kind.language);
				if (html !== null) code.innerHTML = html;
			}
		}
	};
	events.on(window, 'message', (event) => {
		if (disposed || suspended || event.data?.kind !== 'layall:diagram') return;
		for (const entry of entries.values()) {
			if (
				!entry.frame ||
				event.source !== entry.frame.contentWindow ||
				event.data.token !== entry.token ||
				!scope.contains(entry.code)
			)
				continue;
			if (event.data.state === 'load') {
				if (entry.loading) return;
				entry.loading = true;
				const frame = entry.frame,
					token = entry.token;
				void loader
					.load()
					.then((modules) => {
						if (
							!disposed &&
							!suspended &&
							entry.frame === frame &&
							entry.token === token &&
							scope.contains(entry.code)
						)
							frame.contentWindow.postMessage(
								{ kind: 'layall:diagram-modules', token, ...modules },
								'*'
							);
					})
					.catch(() => {
						if (entry.frame === frame) discardFrame(entry);
					});
				return;
			}
			if (event.data.state === 'error') {
				discardFrame(entry);
				return;
			}
			if (event.data.state !== 'ready' || !Number.isFinite(event.data.height)) return;
			window.clearTimeout(entry.timer);
			entry.frame.style.height = `${Math.max(80, Math.min(4000, event.data.height))}px`;
			entry.frame.removeAttribute('data-pending');
			const sourceVisible = entry.button.getAttribute('aria-pressed') === 'true';
			entry.pre.hidden = !sourceVisible;
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
	const observer = new window.MutationObserver(scan);
	observer.observe(scope, { childList: true, subtree: true });
	const themes = new window.MutationObserver(appearance);
	themes.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-color-mode'] });
	events.on(scheme, 'change', appearance);
	events.on(window, 'layall:article-content', scan);
	events.on(window, 'pagehide', () => {
		suspended = true;
		clear();
	});
	events.on(window, 'pageshow', () => {
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
		},
	};
}
