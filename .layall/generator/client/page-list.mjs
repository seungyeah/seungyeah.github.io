import { listeners } from './lifecycle.mjs';

// A non-modal disclosure of the same validated public book used by prev/next.
// Keep native links for keyboard, modified clicks and protected neutral titles.
export function mountPageList(bottom, { document, window, loadBook }) {
	const toggle = bottom.querySelector('[data-page-list-toggle]');
	if (!toggle) return { dispose() {} };
	const panel = bottom.querySelector('[data-page-list]');
	const list = panel.querySelector('ol');
	const status = panel.querySelector('[role="status"]');
	const retry = panel.querySelector('[data-page-list-retry]');
	const fallback = bottom.querySelector('[data-page-list-fallback]');
	const events = listeners();
	let disposed = false,
		request = 0,
		frame = 0;
	toggle.hidden = false;
	fallback.hidden = true;
	const position = () => {
		if (panel.hidden || disposed) return;
		const rect = bottom.getBoundingClientRect();
		const above = Math.max(0, rect.top - 8);
		const below = Math.max(0, document.documentElement.clientHeight - rect.bottom - 8);
		panel.dataset.placement = above >= below ? 'above' : 'below';
		panel.style.maxHeight = `${Math.min(384, document.documentElement.clientHeight * 0.4, Math.max(above, below))}px`;
	};
	const reposition = () => {
		if (frame || panel.hidden || disposed) return;
		frame = window.requestAnimationFrame(() => {
			frame = 0;
			position();
		});
	};
	const close = (restore = false) => {
		if (panel.hidden) return;
		const hadFocus = panel.contains(document.activeElement);
		panel.hidden = true;
		request++;
		toggle.setAttribute('aria-expanded', 'false');
		if (restore || hadFocus) toggle.focus({ preventScroll: true });
	};
	const populate = async () => {
		const id = ++request;
		status.textContent = '목록을 불러오는 중…';
		status.hidden = false;
		retry.hidden = true;
		try {
			const book = await loadBook();
			if (disposed || panel.hidden || id !== request) return;
			const rows = book.entries.map((entry, index) => {
				const row = document.createElement('li');
				const link = document.createElement('a');
				link.href = entry.href;
				link.textContent = entry.label;
				if (index === book.index) link.setAttribute('aria-current', 'page');
				row.append(link);
				return row;
			});
			list.replaceChildren(...rows);
			status.hidden = true;
			const current = list.querySelector('[aria-current="page"]');
			// Do not steal focus after the user has already tabbed elsewhere.
			if (document.activeElement === toggle || document.activeElement === retry) {
				current?.focus({ preventScroll: true });
				if (current)
					panel.scrollTop = Math.max(0, current.offsetTop - panel.clientHeight / 2);
			}
		} catch {
			if (disposed || panel.hidden || id !== request) return;
			status.textContent = '목록을 불러오지 못했어요.';
			retry.hidden = false;
		}
	};
	events.on(toggle, 'click', () => {
		if (!panel.hidden) return close(true);
		toggle.focus({ preventScroll: true });
		panel.hidden = false;
		toggle.setAttribute('aria-expanded', 'true');
		position();
		void populate();
	});
	events.on(retry, 'click', () => void populate());
	events.on(list, 'click', (event) => {
		if (event.target.closest('a')) close();
	});
	events.on(document, 'click', (event) => {
		if (!panel.contains(event.target) && !toggle.contains(event.target)) close();
	});
	events.on(document, 'focusin', (event) => {
		if (!panel.contains(event.target) && !toggle.contains(event.target)) close();
	});
	events.on(document, 'keydown', (event) => {
		if (event.key === 'Escape' && !panel.hidden) {
			event.preventDefault();
			close(true);
		}
	});
	events.on(window, 'layall:reading', () => close());
	events.on(window, 'layall:page-navigation-hide', () => close());
	events.on(window, 'pagehide', () => close());
	events.on(window, 'scroll', reposition, { passive: true });
	events.on(window, 'resize', reposition);
	return {
		dispose() {
			disposed = true;
			close();
			events.dispose();
			if (frame) window.cancelAnimationFrame(frame);
			panel.style.removeProperty('max-height');
			delete panel.dataset.placement;
			list.replaceChildren();
			toggle.hidden = true;
			fallback.hidden = false;
		},
	};
}
