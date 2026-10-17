import { listeners } from './lifecycle.mjs';
export function mountNavigation({ nav, navToggle, palettePickers }) {
	const events = listeners();
	const tocToggle = document.querySelector('[data-post-toc-toggle]');
	const tocPanel = document.querySelector('[data-post-toc-panel]');
	const tocClose = document.querySelector('[data-post-toc-close]');
	const closeNav = (restore = false) => {
		palettePickers.forEach((picker) => picker.close());
		if (nav?.dataset.open !== 'true') return;
		nav.dataset.open = 'false';
		navToggle?.setAttribute('aria-expanded', 'false');
		if (restore) navToggle?.focus();
	};
	const closeToc = (restore = false) => {
		if (tocPanel?.dataset.open !== 'true') return;
		const hadFocus = tocPanel.contains(document.activeElement);
		tocPanel.dataset.open = 'false';
		tocPanel.setAttribute('aria-hidden', 'true');
		tocToggle?.setAttribute('aria-expanded', 'false');
		if (restore || hadFocus) tocToggle?.focus({ preventScroll: true });
	};
	events.on(navToggle, 'click', () => {
		if (nav?.dataset.open === 'true') closeNav();
		else if (nav) {
			nav.dataset.open = 'true';
			navToggle.setAttribute('aria-expanded', 'true');
			closeToc();
		}
	});
	events.on(tocToggle, 'click', () => {
		const open = tocPanel?.dataset.open !== 'true';
		closeNav();
		if (!tocPanel) return;
		tocPanel.dataset.open = String(open);
		tocPanel.setAttribute('aria-hidden', String(!open));
		tocToggle.setAttribute('aria-expanded', String(open));
		if (open) (tocPanel.querySelector('a') || tocPanel).focus();
	});
	events.on(tocClose, 'click', () => closeToc(true));
	tocPanel?.querySelectorAll('a[href^="#"]').forEach((link) =>
		events.on(link, 'click', () => {
			tocPanel
				.querySelectorAll('[aria-current="location"]')
				.forEach((active) => active.removeAttribute('aria-current'));
			link.setAttribute('aria-current', 'location');
			closeToc();
			const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
			if (heading) {
				heading.setAttribute('tabindex', '-1');
				heading.focus({ preventScroll: true });
			}
		})
	);
	events.on(document, 'click', (event) => {
		if (
			tocPanel?.dataset.open === 'true' &&
			!tocPanel.contains(event.target) &&
			!tocToggle?.contains(event.target)
		)
			closeToc();
		if (
			nav?.dataset.open === 'true' &&
			!nav.contains(event.target) &&
			!navToggle?.contains(event.target) &&
			!palettePickers.some((picker) => picker.contains(event.target))
		)
			closeNav();
	});
	events.on(document, 'keydown', (event) => {
		if (event.key === 'Escape') {
			const tocWasOpen = tocPanel?.dataset.open === 'true';
			const navWasOpen = nav?.dataset.open === 'true';
			closeToc(tocWasOpen);
			closeNav(!tocWasOpen && navWasOpen);
		}
		if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
			const input = document.querySelector('[data-search-input]');
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
		},
	};
}
