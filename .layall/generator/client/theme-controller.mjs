import { listeners } from './lifecycle.mjs';

// An iframe draft belongs to its browsing context. Article appearance changes
// must update attributes in place; never move the article through a fragment.
function applyArticleAppearance(root, mount, next) {
	const articleShell = mount.querySelector('[data-article-shell]');
	if (!articleShell) return false;
	root.dataset.theme = next;
	root.dataset.layallTheme = next;
	articleShell.className = next === 'docs' ? 'docs-layout' : 'article-frame';
	articleShell.querySelector('[data-article-main]').className =
		next === 'docs' ? 'docs-content' : 'article-shell theme-article-' + next;
	return true;
}

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
		if (!layoutThemes.has(next) || !mount) return false;
		if (root.dataset.theme === next) return true;
		if (applyArticleAppearance(root, mount, next)) {
			syncLayout();
			onArticleAppearance();
			return true;
		}
		const template = document.querySelector('template[data-theme-layout="' + next + '"]');
		if (!template) return false;
		const query = document.querySelector('[data-search-input]')?.value || '';
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
		beforeReplace(); // Unmount controllers before detaching their DOM.
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
		return true;
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
			if (activate(next)) writeStored(layoutKey, next);
			else syncLayout();
		})
	);

	return {
		current: () => root.dataset.theme,
		select(next) {
			const success = activate(next);
			if (success) writeStored(layoutKey, next);
			else syncLayout();
			return success;
		},
		restore() {
			const remembered = readStored(layoutKey);
			if (
				layoutThemes.has(remembered) &&
				remembered !== authorTheme &&
				activate(remembered)
			) {
				// Article appearance retains DOM but still needs its initial mount.
				if (mount?.querySelector('[data-article-shell]')) onPageMounted();
			} else {
				root.dataset.theme = authorTheme;
				root.dataset.layallTheme = authorTheme;
				syncLayout();
				onPageMounted();
			}
		},
		dispose: () => events.dispose(),
	};
}
