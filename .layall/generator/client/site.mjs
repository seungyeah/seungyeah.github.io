import { mountArticleCode } from './article-code.mjs';
import { createBlogHome } from './blog-home.mjs';
import { mountDiscussion } from './discussions.mjs';
import { createDocsNavigation } from './docs-navigation.mjs';
import { createHomeWidgets } from './home-widgets.mjs';
import { listeners } from './lifecycle.mjs';
import { mountNavigation } from './navigation.mjs';
import { mountNoteNavigation } from './note-navigation.mjs';
import { mountPalettes } from './palette.mjs';
import { createSearch } from './search.mjs';
import { createThemeController } from './theme-controller.mjs';

export function mountSite(config, discussionConfig) {
	const events = listeners();
	const root = document.documentElement;
	root.dataset.js = 'true';
	const mount = document.querySelector('[data-theme-view]');
	const docs = createDocsNavigation({ config, root, mount });
	const search = createSearch(config);
	const blog = createBlogHome({ mount });
	const widgets = createHomeWidgets({ mount });
	const nav = document.querySelector('[data-nav]');
	const navToggle = document.querySelector('[data-nav-toggle]');
	let noteNavigation;
	const themes = createThemeController({
		config,
		root,
		mount,
		beforeReplace() {
			search.invalidate();
			docs.invalidate();
			blog.dispose();
			widgets.dispose();
		},
		onArticleAppearance() {
			docs.bind();
			noteNavigation?.refresh();
		},
		onPageMounted(query = '') {
			docs.bind();
			search.bind(query);
			blog.bind();
			widgets.bind();
			noteNavigation?.refresh();
		},
	});
	const palettes = mountPalettes({ root, nav, current: themes.current, onSelect: themes.select });
	const navigation = mountNavigation({
		nav,
		navToggle,
		palettePickers: palettes.pickers,
	});
	noteNavigation = mountNoteNavigation({ config, loadBooks: docs.loadBooks });
	themes.restore();
	const code = mountArticleCode(
		document.querySelector('[data-theme-piece="article"]'),
		{ document, window },
		config.diagram,
		config.highlight
	);
	const disposeDiscussion = discussionConfig ? mountDiscussion(discussionConfig) : null;
	let disposed = false;
	const controller = {
		dispose() {
			if (disposed) return;
			disposed = true;
			events.dispose();
			disposeDiscussion?.();
			code.dispose();
			palettes.dispose();
			navigation.dispose();
			noteNavigation.dispose();
			themes.dispose();
			blog.dispose();
			docs.dispose();
			widgets.dispose();
			search.invalidate();
		},
	};
	events.on(window, 'pagehide', (event) => {
		if (!event.persisted) controller.dispose();
	});
	return controller;
}
