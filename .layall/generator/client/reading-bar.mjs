// The in-flow anchor never moves when the bar becomes fixed. Its threshold is
// viewport top, independent of the header we hide: no feedback/scroll oscillation.
export function readingBarPosition(anchorTop, headerHeight) {
	return { pinned: anchorTop <= 0, headerShift: Math.min(0, anchorTop - headerHeight) };
}
export function mountReadingBar(strip, toggle, { document, window }) {
	const header = document.querySelector('.site-header');
	const original = header && {
		inert: header.inert,
		aria: header.getAttribute('aria-hidden'),
	};
	let pinned = false;
	strip.dataset.readingReady = 'true';
	const restoreHeader = () => {
		if (!header) return;
		delete header.dataset.readingHidden;
		header.style.removeProperty('--reading-header-shift');
		header.inert = original.inert;
		if (original.aria === null) header.removeAttribute('aria-hidden');
		else header.setAttribute('aria-hidden', original.aria);
	};
	return {
		refresh() {
			const height = toggle.getBoundingClientRect().height;
			const position = readingBarPosition(
				strip.getBoundingClientRect().top,
				header?.getBoundingClientRect().height || 0
			);
			strip.style.setProperty('--reading-bar-height', `${height}px`);
			strip.dataset.pinned = String(position.pinned);
			if (header) {
				header.style.setProperty('--reading-header-shift', `${position.headerShift}px`);
				if (position.pinned && !pinned) {
					const moveFocus =
						header.contains(document.activeElement) ||
						document.activeElement?.closest?.('[data-palette-options]');
					window.dispatchEvent(new window.Event('layall:reading'));
					if (moveFocus) toggle.focus({ preventScroll: true });
					header.inert = true;
					header.setAttribute('aria-hidden', 'true');
					header.dataset.readingHidden = 'true';
				} else if (!position.pinned && pinned) {
					restoreHeader();
					header.style.setProperty('--reading-header-shift', `${position.headerShift}px`);
				}
			}
			pinned = position.pinned;
			return height + 16;
		},
		reset() {
			pinned = false;
			delete strip.dataset.pinned;
			restoreHeader();
		},
		dispose() {
			this.reset();
			delete strip.dataset.readingReady;
			strip.style.removeProperty('--reading-bar-height');
		},
	};
}
