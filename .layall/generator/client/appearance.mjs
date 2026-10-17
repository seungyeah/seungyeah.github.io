// An iframe draft belongs to its browsing context. Article appearance changes
// must update attributes in place; never move the article through a fragment.
export function applyArticleAppearance(root, mount, next) {
	const articleShell = mount.querySelector('[data-article-shell]');
	if (!articleShell) return false;
	root.dataset.theme = next;
	root.dataset.layallTheme = next;
	articleShell.className = next === 'docs' ? 'docs-layout' : 'article-frame';
	articleShell.querySelector('[data-article-main]').className =
		next === 'docs' ? 'docs-content' : 'article-shell theme-article-' + next;
	return true;
}
