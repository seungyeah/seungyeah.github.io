import { listeners } from './lifecycle.mjs';
import { mountReadingBar } from './reading-bar.mjs';

// Re-evaluate every heading's current position; an intersection-only cursor can
// retain a later heading when scrolling backwards through a long section.
export function readingHeading(headings, offset) {
	let current = headings[0];
	for (const heading of headings) {
		if (heading.getBoundingClientRect().top > offset) break;
		current = heading;
	}
	return current;
}

export function mountNoteToc(scope, { document, window }) {
	const strip = scope.querySelector('[data-note-toc-strip]');
	if (!strip) return { refresh() {}, dispose() {} };
	const toggle = strip.querySelector('[data-note-toc-toggle]');
	const dropdown = strip.querySelector('[data-note-toc-dropdown]');
	const marker = strip.querySelector('[data-note-toc-marker]');
	const label = strip.querySelector('[data-note-toc-label]');
	const items = [...dropdown.querySelectorAll('[data-toc-target]')];
	const body = scope.querySelector('.article-body');
	const headings = [...body.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
	const header = document.querySelector('.site-header');
	const root = document.documentElement;
	const events = listeners();
	const readingBar = mountReadingBar(strip, toggle, { document, window });
	let suspended = false;
	let frame = 0,
		disposed = false,
		hashTarget;
	const select = (heading) => {
		if (!heading) return;
		for (const item of items) {
			const active = item.dataset.tocTarget === heading.id;
			item.classList.toggle('active', active);
			const link = item.querySelector('a');
			if (active) {
				link.setAttribute('aria-current', 'location');
				label.textContent = item.querySelector('.note-toc-item-title').textContent;
				marker.textContent = /^H[12]$/.test(heading.tagName) ? '§' : '•';
			} else link.removeAttribute('aria-current');
		}
	};
	const close = (restore = false) => {
		if (dropdown.hidden) return;
		const hadFocus = dropdown.contains(document.activeElement);
		dropdown.hidden = true;
		toggle.setAttribute('aria-expanded', 'false');
		toggle.setAttribute('aria-label', '목차 열기');
		if (restore || hadFocus) toggle.focus({ preventScroll: true });
	};
	const refresh = () => {
		if (disposed || suspended || frame) return;
		frame = window.requestAnimationFrame(() => {
			frame = 0;
			if (disposed || suspended) return;
			const offset = readingBar.refresh();
			scope.style.setProperty('--note-heading-offset', `${offset}px`);
			const scroller = document.scrollingElement || root;
			const maxScroll = scroller.scrollHeight - scroller.clientHeight;
			const atBottom =
				maxScroll > 0 && scroller.scrollTop > 0 && maxScroll - scroller.scrollTop <= 2;
			select(
				hashTarget || (atBottom ? headings.at(-1) : readingHeading(headings, offset + 1))
			);
			hashTarget = undefined;
		});
	};
	const fromHash = () => {
		try {
			const id = decodeURIComponent(window.location.hash.slice(1));
			hashTarget = headings.find((heading) => heading.id === id);
		} catch {
			hashTarget = undefined;
		}
		refresh();
	};
	events.on(toggle, 'click', () => {
		const open = dropdown.hidden;
		if (!open) return close(true);
		dropdown.hidden = false;
		toggle.setAttribute('aria-expanded', 'true');
		toggle.setAttribute('aria-label', '목차 닫기');
		(dropdown.querySelector('[aria-current="location"]') || dropdown.querySelector('a'))?.focus(
			{ preventScroll: true }
		);
	});
	for (const item of items)
		events.on(item.querySelector('a'), 'click', () => {
			close();
			const heading = headings.find((entry) => entry.id === item.dataset.tocTarget);
			if (heading) {
				heading.setAttribute('tabindex', '-1');
				heading.focus({ preventScroll: true });
				hashTarget = heading;
				refresh();
			}
		});
	events.on(document, 'click', (event) => {
		if (!strip.contains(event.target)) close();
	});
	events.on(document, 'keydown', (event) => {
		if (event.key === 'Escape' && !dropdown.hidden) {
			event.preventDefault();
			close(true);
		}
	});
	events.on(window, 'scroll', refresh, { passive: true });
	events.on(window, 'resize', refresh);
	events.on(window, 'hashchange', fromHash);
	events.on(window, 'pagehide', () => {
		suspended = true;
		close();
		readingBar.reset();
	});
	events.on(window, 'pageshow', () => {
		suspended = false;
		refresh();
	});
	events.on(body, 'load', refresh, true);
	const observer =
		typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(refresh) : null;
	[header, toggle, body, scope].filter(Boolean).forEach((node) => observer?.observe(node));
	const appearance =
		typeof window.MutationObserver === 'function'
			? new window.MutationObserver(() => {
					close();
					refresh();
				})
			: null;
	appearance?.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
	document.fonts?.ready.then(refresh);
	fromHash();
	return {
		refresh,
		dispose() {
			disposed = true;
			events.dispose();
			observer?.disconnect();
			appearance?.disconnect();
			if (frame) window.cancelAnimationFrame(frame);
			close();
			readingBar.dispose();
			scope.style.removeProperty('--note-heading-offset');
		},
	};
}

// Match exact canonical post paths, never suffixes. Only same-origin public
// permalinks and text labels from the validated navigation resource are accepted.
export function bookNeighbors(books, current, postPrefix, origin) {
	if (!Array.isArray(books)) throw new Error('Invalid book navigation');
	const paths = new Set();
	const groups = books.map((book) => {
		if (!Array.isArray(book)) throw new Error('Invalid book navigation');
		return book.map((entry) => {
			if (
				typeof entry?.label !== 'string' ||
				typeof entry.href !== 'string' ||
				paths.size >= 50000
			)
				throw new Error('Invalid book link');
			const url = new URL(entry.href, origin);
			const segment = url.pathname.slice(postPrefix.length);
			if (
				url.origin !== origin ||
				!url.pathname.startsWith(postPrefix) ||
				!/^[a-z0-9][a-z0-9-]{0,127}\/$/.test(segment) ||
				url.search ||
				url.hash ||
				url.username ||
				url.password ||
				paths.has(url.pathname)
			)
				throw new Error('Invalid book link');
			paths.add(url.pathname);
			return { label: entry.label, href: url.pathname };
		});
	});
	let pathname = current.endsWith('/index.html') ? current.slice(0, -10) : current;
	if (!pathname.endsWith('/')) pathname += '/';
	const group = groups.find((book) => book.some((entry) => entry.href === pathname));
	const index = group?.findIndex((entry) => entry.href === pathname) ?? -1;
	return index < 0 ? null : { prev: group[index - 1] ?? null, next: group[index + 1] ?? null };
}

export function mountNoteNavigation({ config, loadBooks }) {
	const article = document.querySelector('[data-theme-piece="article"]');
	const toc =
		article && !article.querySelector('[data-protected-post]')
			? mountNoteToc(article, { document, window })
			: null;
	const bottom = article?.querySelector('.article-bottom-nav');
	let disposed = false,
		loading = false,
		loaded = false;
	const refresh = () => {
		toc?.refresh();
		if (disposed || !bottom || loading || loaded) return;
		loading = true;
		loadBooks()
			.then((books) => {
				if (disposed) return;
				const neighbors = bookNeighbors(
					books,
					location.pathname,
					config.postPrefix,
					location.origin
				);
				if (!neighbors) return;
				for (const direction of ['prev', 'next']) {
					const entry = neighbors[direction];
					const link = bottom.querySelector(`[data-nav-${direction}]`);
					if (!entry || !link) {
						const empty = bottom.querySelector(`[data-nav-${direction}-empty]`);
						empty.setAttribute(
							'aria-label',
							direction === 'prev' ? '이전글 없음' : '다음글 없음'
						);
						continue;
					}
					link.href = entry.href;
					link.querySelector(`[data-nav-${direction}-title]`).textContent = entry.label;
					link.title = `${direction === 'prev' ? '이전 글' : '다음 글'}: ${entry.label}`;
					link.setAttribute('aria-label', link.title);
					link.hidden = false;
					bottom.querySelector(`[data-nav-${direction}-empty]`).hidden = true;
				}
				loaded = true;
			})
			.catch(() => {
				/* The public list link remains available on failure. */
			})
			.finally(() => {
				loading = false;
			});
	};
	refresh();
	return {
		refresh,
		dispose() {
			disposed = true;
			toc?.dispose();
		},
	};
}
