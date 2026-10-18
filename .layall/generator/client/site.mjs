import { createBlogHome } from './blog-home.mjs';
import { createDocsNavigation } from './docs-navigation.mjs';
import { createHomeWidgets } from './home-widgets.mjs';
import { mountNavigation } from './navigation.mjs';
import { mountPalettes } from './palette.mjs';
import { createSearch } from './search.mjs';
import { createThemeController } from './theme-controller.mjs';

export function mountSite(config) {
	const root = document.documentElement;
	root.dataset.js = 'true';
	const mount = document.querySelector('[data-theme-view]');
	const docs = createDocsNavigation({ config, root, mount });
	const search = createSearch(config);
	const blog = createBlogHome({ mount });
	const widgets = createHomeWidgets({ mount });
	const themes = createThemeController({
		config,
		root,
		mount,
		beforeReplace: search.invalidate,
		onArticleAppearance: docs.bind,
		onPageMounted(query = '') {
			docs.bind();
			search.bind(query);
			blog.bind();
			widgets.bind();
		},
	});
	const nav = document.querySelector('[data-nav]');
	const navToggle = document.querySelector('[data-nav-toggle]');
	const palettes = mountPalettes({ root, nav, current: themes.current, onSelect: themes.select });
	const navigation = mountNavigation({ nav, navToggle, palettePickers: palettes.pickers });
	themes.restore();
	return {
		dispose() {
			palettes.dispose();
			navigation.dispose();
			themes.dispose();
			blog.dispose();
			docs.dispose();
			widgets.dispose();
			search.invalidate();
		},
	};
}
