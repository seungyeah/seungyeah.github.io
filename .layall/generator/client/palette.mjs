import { listeners } from './lifecycle.mjs';
export function mountPalettes({ root, nav, current, onSelect }) {
	const events = listeners();
	const palettePickers = [];
	const disposers = [];
	document.querySelectorAll('[data-palette-picker]').forEach((picker) => {
		const summary = picker.querySelector('summary');
		const panel = picker.querySelector('[data-palette-options]');
		const choices = [...panel.querySelectorAll('[data-palette-choice]')];
		// Escape both Menu overflow and the sticky header's backdrop-filter containing block.
		document.body.append(panel);
		const viewport = window.visualViewport;
		const watchingEvents = listeners();
		let frame = 0;
		let watching = false;
		const contains = (target) => picker.contains(target) || panel.contains(target);
		const close = (focus = false) => {
			picker.open = false;
			panel.hidden = true;
			summary.setAttribute('aria-expanded', 'false');
			window.cancelAnimationFrame(frame);
			frame = 0;
			watchingEvents.dispose();
			observer?.disconnect();
			watching = false;
			if (focus) summary.focus({ preventScroll: true });
		};
		const position = () => {
			if (!picker.open) return;
			const anchor = summary.getBoundingClientRect();
			const menu = nav?.getBoundingClientRect();
			const left = viewport?.offsetLeft || 0,
				top = viewport?.offsetTop || 0;
			const width = viewport?.width || root.clientWidth,
				height = viewport?.height || root.clientHeight;
			if (
				!summary.isConnected ||
				!anchor.width ||
				!anchor.height ||
				anchor.bottom <= Math.max(top, menu?.top ?? top) ||
				anchor.top >= Math.min(top + height, menu?.bottom ?? top + height) ||
				anchor.right <= left ||
				anchor.left >= left + width
			) {
				close();
				return;
			}
			const edge = 8,
				gap = 4;
			const minX = left + edge,
				minY = top + edge;
			panel.style.maxWidth = Math.max(0, width - edge * 2) + 'px';
			panel.style.maxHeight = Math.max(0, height - edge * 2) + 'px';
			const below = Math.max(0, top + height - edge - anchor.bottom - gap),
				above = Math.max(0, anchor.top - gap - minY);
			const up = below < panel.scrollHeight + 2 && above > below;
			panel.style.maxHeight = Math.max(0, up ? above : below) + 'px';
			const box = panel.getBoundingClientRect();
			panel.style.left =
				Math.max(minX, Math.min(anchor.left, left + width - edge - box.width)) + 'px';
			panel.style.top =
				Math.max(
					minY,
					Math.min(
						up ? anchor.top - gap - box.height : anchor.bottom + gap,
						top + height - edge - box.height
					)
				) + 'px';
		};
		const schedule = (event) => {
			if (!picker.open || panel.contains(event?.target) || frame) return;
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				position();
			});
		};
		const observer =
			typeof window.ResizeObserver === 'function'
				? new window.ResizeObserver(schedule)
				: null;
		const open = () => {
			picker.open = true;
			panel.hidden = false;
			summary.setAttribute('aria-expanded', 'true');
			position();
			if (!picker.open || watching) return;
			watching = true;
			watchingEvents.on(window, 'resize', schedule);
			watchingEvents.on(window, 'scroll', schedule, true);
			watchingEvents.on(viewport, 'resize', schedule);
			watchingEvents.on(viewport, 'scroll', schedule);
			observer?.observe(summary);
			if (nav) observer?.observe(nav);
		};
		const selected = () =>
			choices.find((button) => button.dataset.paletteChoice === current()) || choices[0];
		const choose = (button) => {
			const next = button.dataset.paletteChoice;
			onSelect(next);
			position();
		};
		choices.forEach((button) =>
			events.on(button, 'click', () => {
				choose(button);
				close(true);
			})
		);
		events.on(summary, 'click', (event) => {
			event.preventDefault();
			picker.open ? close() : open();
		});
		events.on(summary, 'keydown', (event) => {
			if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
				event.preventDefault();
				open();
				if (picker.open)
					(event.key === 'Home'
						? choices[0]
						: event.key === 'End'
							? choices.at(-1)
							: selected()
					)?.focus();
			} else if (event.key === 'Tab' && !event.shiftKey && picker.open) {
				event.preventDefault();
				selected()?.focus();
			}
		});
		const keydown = (event) => {
			if (event.key === 'Escape' && picker.open) {
				event.preventDefault();
				event.stopPropagation();
				close(true);
				return;
			}
			const index = choices.indexOf(event.target);
			// The portal lives at the end of body; resume Tab order from its header trigger.
			if (event.key === 'Tab' && (index >= 0 || event.target === panel)) {
				if (event.shiftKey) event.preventDefault();
				close(true);
				return;
			}
			if (index < 0) return;
			let next = index;
			if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
				next = (index + 1) % choices.length;
			else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
				next = (index + choices.length - 1) % choices.length;
			else if (event.key === 'Home') next = 0;
			else if (event.key === 'End') next = choices.length - 1;
			else return;
			event.preventDefault();
			choose(choices[next]);
			choices[next].focus();
		};
		const focusout = (event) => {
			if (!contains(event.relatedTarget)) close();
		};
		events.on(picker, 'keydown', keydown);
		events.on(panel, 'keydown', keydown);
		events.on(picker, 'focusout', focusout);
		events.on(panel, 'focusout', focusout);
		events.on(picker, 'toggle', () => (picker.open ? open() : close()));
		const outside = (event) => {
			if (!contains(event.target)) close();
		};
		const pagehide = () => close();
		events.on(document, 'click', outside);
		events.on(window, 'pagehide', pagehide);
		disposers.push(() => {
			close();
			picker.append(panel);
		});
		palettePickers.push({ contains, close });
	});
	return {
		pickers: palettePickers,
		dispose() {
			events.dispose();
			disposers.splice(0).forEach((dispose) => dispose());
		},
	};
}
