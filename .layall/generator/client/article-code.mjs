import { createDiagramLoader, diagramURLs } from './diagram-loader.mjs';
import { listeners } from './lifecycle.mjs';
import { diagramDocument, diagramTheme } from './mermaid-frame.mjs';

// Same explicit/untagged Mermaid detection as NotePage's read-only preview.
const diagramStart =
	/^(?:flowchart\b|graph\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|quadrantChart\b|xychart(?:-beta)?\b|sankey-beta\b|gitGraph\b|C4[A-Za-z]*\b|requirementDiagram\b|packet-beta\b|architecture-beta\b|kanban\b|block-beta\b)/i;
export function codeKind(source, language = '') {
	const name = language.trim().toLowerCase().split(/\s+/)[0];
	const first =
		source
			.split('\n')
			.find((line) => line.trim() && !line.trim().startsWith('%%'))
			?.trim() || '';
	if (name === 'mermaid' || (!name && diagramStart.test(first)))
		return { language: 'mermaid', diagram: true };
	return { language: name, diagram: false };
}

const VIEWER_MIN_ZOOM = 0.2;
const VIEWER_MAX_ZOOM = 10;
const VIEWER_PADDING = 16;
const VIEWER_MIN_VISIBLE = 48;
const VIEWER_PAN_START_PX = 4;

export function mountArticleCode(
	scope,
	{ document, window, importHighlight = (url) => import(url) },
	diagramConfig,
	highlightUrl
) {
	if (!scope) return { dispose() {} };
	const entries = new Map(),
		events = listeners();
	let highlightPromise;
	const loadHighlight = () => {
		if (!highlightPromise) {
			highlightPromise = Promise.resolve()
				.then(() => {
					const url = new URL(highlightUrl, window.location.origin);
					if (
						url.origin !== window.location.origin ||
						!/^https?:$/.test(url.protocol) ||
						url.search ||
						url.hash ||
						url.username ||
						url.password ||
						!/\/assets\/static\/highlight-[a-f0-9]{64}\.mjs$/.test(url.pathname)
					)
						throw new Error('Invalid highlight asset');
					return importHighlight(url.href);
				})
				.catch((error) => {
					highlightPromise = undefined;
					throw error;
				});
		}
		return highlightPromise;
	};
	const enhanceCode = (entry) => {
		if (
			entry.diagram ||
			!entry.language ||
			entry.source.length > 200000 ||
			entry.highlighted ||
			entry.highlightPending
		)
			return;
		entry.highlightPending = true;
		void loadHighlight()
			.then(({ highlightCode }) => {
				if (
					disposed ||
					suspended ||
					entries.get(entry.code) !== entry ||
					!scope.contains(entry.code)
				)
					return;
				const html = highlightCode(entry.source, entry.language);
				if (html !== null) entry.code.innerHTML = html;
				entry.highlighted = true;
			})
			.catch(() => {
				/* Readable literal source; next content scan can retry. */
			})
			.finally(() => {
				entry.highlightPending = false;
			});
	};
	const root = document.documentElement;
	const loader = createDiagramLoader(diagramConfig, { window });
	const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
	let disposed = false,
		suspended = false,
		sequence = 0;
	const discardFrame = (entry) => {
		window.clearTimeout(entry.timer);
		if (entry.viewer) closeMermaidViewer(entry, { document, window }, false);
		entry.diagramEvents.dispose();
		if (entry.diagram) {
			entry.diagram.remove();
			entry.diagram = null;
		}
		if (entry.frame) {
			entry.frame.srcdoc = '';
			entry.frame.remove();
			entry.frame = null;
		}
		entry.markup = '';
		if (![...entries.values()].some((item) => item.frame)) loader.cancel();
		entry.pre.hidden = false;
		entry.button.hidden = true;
	};
	const release = (entry) => {
		discardFrame(entry);
		entry.events.dispose();
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
			const diagram = document.createElement('div');
			entry.loading = false;
			entry.token = String(++sequence);
			frame.className = 'article-diagram';
			frame.title = 'Mermaid 다이어그램';
			frame.setAttribute('sandbox', 'allow-scripts');
			frame.setAttribute('referrerpolicy', 'no-referrer');
			frame.setAttribute('data-pending', 'true');
			diagram.className = 'article-diagram-shell';
			diagram.setAttribute('role', 'button');
			diagram.setAttribute('tabindex', '0');
			diagram.setAttribute('aria-label', 'Mermaid 다이어그램 전체 화면으로 보기');
			entry.diagramClick = () => openMermaidViewer(entry, { document, window });
			entry.diagramKeydown = (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				entry.diagramClick();
			};
			entry.diagramEvents.on(diagram, 'click', entry.diagramClick);
			entry.diagramEvents.on(diagram, 'keydown', entry.diagramKeydown);
			frame.srcdoc = diagramDocument({
				scriptUrl,
				origin: window.location.origin,
				source: entry.source,
				token: entry.token,
				colors: diagramTheme(root, scheme?.matches),
			});
			entry.frame = frame;
			entry.diagram = diagram;
			diagram.append(frame);
			entry.block.append(diagram);
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
			if (entries.has(code)) {
				enhanceCode(entries.get(code));
				continue;
			}
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
				markup: '',
				viewer: null,
				timer: 0,
				token: '',
				attributes: ['tabindex', 'aria-label'].map((name) => [
					name,
					pre.getAttribute(name),
				]),
				click: null,
				diagramClick: null,
				diagramKeydown: null,
			};
			entry.click = () => {
				const pressed = button.getAttribute('aria-pressed') !== 'true';
				button.setAttribute('aria-pressed', String(pressed));
				if (kind.diagram && entry.frame) {
					pre.hidden = !pressed;
					if (entry.diagram) entry.diagram.hidden = pressed;
					entry.frame.hidden = pressed;
				} else pre.classList.toggle('is-wrapped', pressed);
			};
			entries.set(code, entry); // Register before DOM changes observed by our own observer.
			entry.events.on(button, 'click', entry.click);
			toolbar.append(label, button);
			pre.before(block);
			block.append(toolbar, pre);
			pre.setAttribute('tabindex', '0');
			pre.setAttribute('aria-label', (kind.language || '일반') + ' 코드');
			if (kind.diagram) renderDiagram(entry);
			else enhanceCode(entry);
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
			entry.markup = typeof event.data.svg === 'string' ? event.data.svg : '';
			entry.frame.style.height = Math.max(80, Math.min(4000, event.data.height)) + 'px';
			entry.frame.removeAttribute('data-pending');
			const sourceVisible = entry.button.getAttribute('aria-pressed') === 'true';
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
	const observer = new window.MutationObserver(scan);
	observer.observe(scope, { childList: true, subtree: true });
	const themes = new window.MutationObserver(appearance);
	themes.observe(root, {
		attributes: true,
		attributeFilter: ['data-theme', 'data-color-mode'],
	});
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

function openMermaidViewer(entry, { document, window }) {
	if (entry.viewer || !entry.markup) return;
	const prepared = createViewerSvg(document, window, entry.markup);
	if (!prepared) return;
	const dialog = document.createElement('div');
	const frame = document.createElement('div');
	const stage = document.createElement('div');
	const tools = document.createElement('div');
	const zoomOut = createViewerTool(document, 'zoom-out', 'Zoom out');
	const zoomIn = createViewerTool(document, 'zoom-in', 'Zoom in');
	const close = createViewerTool(document, 'close', 'Close chart viewer');
	const body = document.body;
	dialog.className = 'article-mermaid-viewer';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Mermaid chart');
	dialog.setAttribute('tabindex', '-1');
	dialog.setAttribute('data-mermaid-fullscreen', 'true');
	frame.className = 'article-mermaid-viewer-frame';
	frame.setAttribute('role', 'group');
	frame.setAttribute('aria-label', 'Mermaid chart gesture area');
	stage.className = 'article-mermaid-viewer-stage';
	tools.className = 'article-mermaid-viewer-tools';
	stage.append(document.importNode(prepared.svg, true));
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
		pointers: new Map(),
		resizeObserver: null,
		previousBodyOverflow: body?.style?.overflow ?? '',
		cleanup: null,
	};
	entry.viewer = viewer;
	if (body?.style) body.style.overflow = 'hidden';

	const viewportWidth = () => {
		const measured = Number(frame.clientWidth);
		if (measured > 0) return measured;
		return Math.max(
			1,
			Number(window.innerWidth) || Number(document.documentElement?.clientWidth) || 1
		);
	};
	const viewportHeight = () => {
		const measured = Number(frame.clientHeight);
		if (measured > 0) return measured;
		return Math.max(
			1,
			Number(window.innerHeight) || Number(document.documentElement?.clientHeight) || 1
		);
	};
	const chartSize = () =>
		fittedChartSize(
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
			),
		};
	};
	const renderStage = () => {
		const size = chartSize();
		viewer.chartWidth = size.width;
		viewer.chartHeight = size.height;
		stage.style.width = size.width * viewer.zoom + 'px';
		stage.style.height = size.height * viewer.zoom + 'px';
		stage.style.left = viewer.panX + 'px';
		stage.style.top = viewer.panY + 'px';
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
			startZoom: viewer.zoom,
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
			y: event.clientY,
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
			startPanY: viewer.panY,
		};
		frame.setPointerCapture?.(event.pointerId);
	};
	const handlePointerMove = (event) => {
		if (!viewer.pointers.has(event.pointerId)) return;
		viewer.pointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
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
		if (
			gesture.pointerType !== 'mouse' &&
			Math.abs(viewer.zoom - 1) < 0.001 &&
			deltaY > 88 &&
			deltaY > Math.abs(deltaX) * 1.2
		)
			closeMermaidViewer(entry, { document, window }, true);
	};
	const handleWheel = (event) => {
		event.preventDefault();
		const rect = frame.getBoundingClientRect();
		if (event.ctrlKey || event.metaKey) {
			const factor = Math.exp(-event.deltaY * 0.0015);
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
			),
		];
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	const handleKeydown = (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation?.();
			closeMermaidViewer(entry, { document, window }, true);
			return;
		}
		if (event.key === 'Tab') trapFocus(event);
	};
	const viewerEvents = listeners();
	const preventContextMenu = (event) => event.preventDefault();
	viewerEvents.on(zoomOut, 'click', () => changeZoom(-0.25));
	viewerEvents.on(zoomIn, 'click', () => changeZoom(0.25));
	viewerEvents.on(close, 'click', () => closeMermaidViewer(entry, { document, window }, true));
	viewerEvents.on(frame, 'pointerdown', handlePointerDown);
	viewerEvents.on(frame, 'pointermove', handlePointerMove);
	viewerEvents.on(frame, 'pointerup', handlePointerUp);
	viewerEvents.on(frame, 'pointercancel', resetGesture);
	viewerEvents.on(frame, 'wheel', handleWheel, { passive: false });
	viewerEvents.on(frame, 'contextmenu', preventContextMenu);
	viewerEvents.on(window, 'keydown', handleKeydown, true);
	viewerEvents.on(window, 'resize', applySize);
	const ResizeObserverClass = window.ResizeObserver || globalThis.ResizeObserver;
	if (typeof ResizeObserverClass === 'function') {
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

function closeMermaidViewer(entry, { document }, restoreFocus = true) {
	const viewer = entry.viewer;
	if (!viewer) return;
	viewer.cleanup?.();
	entry.viewer = null;
	viewer.dialog.remove();
	if (document.body?.style) document.body.style.overflow = viewer.previousBodyOverflow;
	if (
		restoreFocus &&
		entry.diagram &&
		entry.diagram.isConnected !== false &&
		!entry.diagram.hidden
	)
		entry.diagram.focus({ preventScroll: true });
}

function createViewerTool(document, kind, label) {
	const button = document.createElement('button');
	button.className = 'article-mermaid-viewer-tool';
	button.type = 'button';
	button.setAttribute('aria-label', label);
	button.append(createViewerIcon(document, kind));
	return button;
}

function createViewerIcon(document, kind) {
	const namespace = 'http://www.w3.org/2000/svg';
	const icon = document.createElementNS(namespace, 'svg');
	icon.setAttribute('viewBox', '0 0 24 24');
	icon.setAttribute('width', '18');
	icon.setAttribute('height', '18');
	icon.setAttribute('fill', 'none');
	icon.setAttribute('stroke', 'currentColor');
	icon.setAttribute('stroke-width', '2');
	icon.setAttribute('stroke-linecap', 'round');
	icon.setAttribute('stroke-linejoin', 'round');
	if (kind === 'close') {
		const path = document.createElementNS(namespace, 'path');
		path.setAttribute('d', 'M5 5l14 14M19 5L5 19');
		icon.append(path);
		return icon;
	}
	const circle = document.createElementNS(namespace, 'circle');
	circle.setAttribute('cx', '11');
	circle.setAttribute('cy', '11');
	circle.setAttribute('r', '7');
	const line = document.createElementNS(namespace, 'path');
	line.setAttribute('d', kind === 'zoom-in' ? 'M11 8v6M8 11h6M16 16l4 4' : 'M8 11h6M16 16l4 4');
	icon.append(circle, line);
	return icon;
}

function createViewerSvg(document, window, markup) {
	const Parser = window.DOMParser || globalThis.DOMParser;
	if (typeof Parser !== 'function') return null;
	let parsed;
	try {
		parsed = new Parser().parseFromString(markup, 'image/svg+xml');
	} catch {
		return null;
	}
	if (parsed.querySelector?.('parsererror')) return null;
	const source = parsed.documentElement;
	if (!source || String(source.tagName).toLowerCase() !== 'svg') return null;
	const size = svgNaturalSize(source);
	for (const element of source.querySelectorAll('script, iframe, object, embed'))
		element.remove();
	namespaceSvgIds(source);
	const svg = document.importNode(source, true);
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', '100%');
	svg.style.display = 'block';
	svg.style.maxWidth = 'none';
	svg.style.maxHeight = 'none';
	svg.style.width = '100%';
	svg.style.height = '100%';
	svg.style.overflow = 'visible';
	return { svg, width: size.width, height: size.height };
}

function namespaceSvgIds(svg) {
	const ids = new Map();
	for (const element of [svg, ...svg.querySelectorAll('[id]')]) {
		if (!element.id) continue;
		const next = element.id + '-layall-mermaid-viewer';
		ids.set(element.id, next);
		element.setAttribute('id', next);
	}
	for (const style of svg.querySelectorAll('style'))
		style.textContent = rewriteSvgIdReferences(style.textContent || '', ids);
	for (const element of [svg, ...svg.querySelectorAll('*')]) {
		for (const attr of [...element.attributes]) {
			const name = attr.name.toLowerCase();
			if (name.startsWith('on')) {
				element.removeAttribute(attr.name);
				continue;
			}
			if (
				(name === 'href' || name === 'xlink:href') &&
				attr.value.trim().toLowerCase().startsWith('javascript:')
			) {
				element.removeAttribute(attr.name);
				continue;
			}
			if (!attr.value.includes('#')) continue;
			const next = rewriteSvgIdReferences(attr.value, ids);
			if (next !== attr.value) element.setAttribute(attr.name, next);
		}
	}
}

function rewriteSvgIdReferences(value, ids) {
	if (!value || ids.size === 0) return value;
	const alternatives = [...ids.keys()]
		.sort((left, right) => right.length - left.length)
		.map(escapeRegExp)
		.join('|');
	return value.replace(new RegExp('#(?:' + alternatives + ')(?![\\w-])', 'g'), (match) => {
		const next = ids.get(match.slice(1));
		return next ? '#' + next : match;
	});
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function svgNaturalSize(svg) {
	const viewBox = (svg.getAttribute('viewBox') || '')
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0)
		return { width: viewBox[2], height: viewBox[3] };
	const width = positiveLength(svg.getAttribute('width'));
	const height = positiveLength(svg.getAttribute('height'));
	if (width > 0 && height > 0) return { width, height };
	return { width: 800, height: 600 };
}

function positiveLength(value) {
	if (!value || value.includes('%')) return 0;
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
