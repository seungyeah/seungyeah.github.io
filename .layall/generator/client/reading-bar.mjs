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
	let revealed = false;
	let lastScroll;
	let travel = 0;
	const footerAnchor = strip.closest?.('.article')?.querySelector('.page-nav-anchor');
	const footer = footerAnchor?.querySelector('.article-bottom-nav');
	const content = footerAnchor || strip.closest?.('.article');
	const focusReader = () => {
		if (toggle) return toggle.focus({ preventScroll: true });
		const originalTabIndex = strip.getAttribute('tabindex');
		strip.setAttribute('tabindex', '-1');
		strip.focus({ preventScroll: true });
		if (originalTabIndex === null) strip.removeAttribute('tabindex');
		else strip.setAttribute('tabindex', originalTabIndex);
	};
	strip.dataset.readingReady = 'true';
	const restoreHeader = () => {
		if (!header) return;
		delete header.dataset.readingHidden;
		delete header.dataset.readingRevealed;
		header.style.removeProperty('--reading-header-shift');
		header.inert = original.inert;
		if (original.aria === null) header.removeAttribute('aria-hidden');
		else header.setAttribute('aria-hidden', original.aria);
	};
	return {
		refresh(scrolling = false) {
			const height = toggle?.getBoundingClientRect().height || 0;
			const contentWidth = content?.getBoundingClientRect().width || 0;
			const headerHeight = header?.getBoundingClientRect().height || 0;
			const position = readingBarPosition(strip.getBoundingClientRect().top, headerHeight);
			const scroller = document.scrollingElement || document.documentElement;
			const scroll = Math.max(
				0,
				Math.min(
					scroller.scrollTop,
					Math.max(0, scroller.scrollHeight - scroller.clientHeight)
				)
			);
			if (scrolling && lastScroll !== undefined) {
				const delta = scroll - lastScroll;
				if (delta) travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
				// Accumulate actual scroll travel, ignoring subpixel/touch jitter.
				if (Math.abs(travel) >= 8) revealed = travel < 0;
			}
			lastScroll = scroll;
			const top = revealed ? headerHeight : 0;
			strip.style.setProperty('--reading-bar-height', `${height}px`);
			strip.style.setProperty('--reading-bar-top', `${top}px`);
			if (contentWidth > 0)
				strip.style.setProperty('--reading-content-width', `${contentWidth}px`);
			else strip.style.removeProperty('--reading-content-width');
			strip.dataset.pinned = String(position.pinned);
			if (header) {
				const hidden = position.pinned && !revealed;
				if (hidden && header.dataset.readingHidden !== 'true') {
					const moveFocus =
						header.contains(document.activeElement) ||
						(footerAnchor?.dataset.docked === 'true' &&
							footer.contains(document.activeElement)) ||
						document.activeElement?.closest?.('[data-palette-options]');
					window.dispatchEvent(new window.Event('layall:reading'));
					if (moveFocus) focusReader();
					header.inert = true;
					header.setAttribute('aria-hidden', 'true');
					header.dataset.readingHidden = 'true';
				} else if (!hidden) {
					restoreHeader();
				}
				header.style.setProperty(
					'--reading-header-shift',
					`${revealed ? 0 : position.headerShift}px`
				);
				if (revealed) header.dataset.readingRevealed = 'true';
				else delete header.dataset.readingRevealed;
			}
			if (footer) {
				const footerHeight = footer.getBoundingClientRect().height;
				footerAnchor.style.setProperty('--page-nav-height', `${footerHeight}px`);
				const belowViewport =
					footerAnchor.getBoundingClientRect().top + footerHeight > scroller.clientHeight;
				const docked = revealed && belowViewport;
				if (footerAnchor.dataset.docked === 'true' && !docked && belowViewport) {
					const moveFocus = footer.contains(document.activeElement);
					window.dispatchEvent(new window.Event('layall:page-navigation-hide'));
					if (moveFocus) focusReader();
				}
				footerAnchor.dataset.docked = String(docked);
			}
			return top + height + 16;
		},
		reset() {
			revealed = false;
			lastScroll = undefined;
			travel = 0;
			delete strip.dataset.pinned;
			strip.style.removeProperty('--reading-bar-top');
			strip.style.removeProperty('--reading-content-width');
			if (footerAnchor) {
				delete footerAnchor.dataset.docked;
				footerAnchor.style.removeProperty('--page-nav-height');
			}
			restoreHeader();
		},
		dispose() {
			this.reset();
			delete strip.dataset.readingReady;
			strip.style.removeProperty('--reading-bar-height');
		},
	};
}
