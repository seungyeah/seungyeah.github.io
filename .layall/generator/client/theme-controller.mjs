import { applyArticleAppearance } from './appearance.mjs';
import { listeners } from './lifecycle.mjs';

export function createThemeController({
	config,
	root,
	mount,
	beforeReplace,
	onPageMounted,
	onArticleAppearance,
}) {
	const events = listeners();
	const colorModes = new Set(['light', 'dark', 'system']);
	const layoutThemes = new Set(config.themeOrder);
	const authorTheme = config.theme;
	const layoutKey = config.layoutStorageKey;
	const pool = document.querySelector('[data-theme-pool]');
	const readStored = (key) => {
		try {
			return localStorage.getItem(key) || '';
		} catch {
			return '';
		}
	};
	const writeStored = (key, value) => {
		try {
			localStorage.setItem(key, value);
		} catch {}
	};
	const syncColor = () =>
		document
			.querySelectorAll('[data-color]')
			.forEach((button) =>
				button.setAttribute(
					'aria-pressed',
					String(button.dataset.color === root.dataset.colorMode)
				)
			);
	const paletteNames = config.paletteNames;
	const syncLayout = () => {
		document
			.querySelectorAll('[data-layout-theme]')
			.forEach((select) => (select.value = root.dataset.theme));
		document.querySelectorAll('[data-palette-choice]').forEach((button) => {
			const selected = button.dataset.paletteChoice === root.dataset.theme;
			button.setAttribute('aria-checked', String(selected));
			button.setAttribute('tabindex', selected ? '0' : '-1');
		});
		document.querySelectorAll('[data-palette-current]').forEach((node) => {
			node.textContent = paletteNames[root.dataset.theme];
			node.parentElement?.setAttribute('data-palette', root.dataset.theme);
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
		const query = document.querySelector('[data-search-input]')?.value || '';
		beforeReplace();
		const fragment = template.content.cloneNode(true);
		fragment.querySelectorAll('[data-layout-id]').forEach((node) => {
			node.id = node.dataset.layoutId;
			node.removeAttribute('data-layout-id');
		});
		const retained = new Map(
			[...document.querySelectorAll('[data-theme-piece]')].map((node) => [
				node.dataset.themePiece,
				node,
			])
		);
		const used = new Set();
		fragment.querySelectorAll('[data-theme-slot]').forEach((target) => {
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
	const savedColor = readStored('layall-color-mode');
	if (colorModes.has(savedColor)) root.dataset.colorMode = savedColor;
	syncColor();
	document.querySelectorAll('[data-color]').forEach((button) =>
		events.on(button, 'click', () => {
			const mode = button.dataset.color;
			if (!colorModes.has(mode)) return;
			root.dataset.colorMode = mode;
			writeStored('layall-color-mode', mode);
			syncColor();
		})
	);
	document.querySelectorAll('[data-layout-theme]').forEach((select) =>
		events.on(select, 'change', () => {
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
		dispose: () => events.dispose(),
	};
}
