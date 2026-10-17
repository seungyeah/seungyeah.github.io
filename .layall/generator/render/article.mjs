import { esc, js } from './text.mjs';
export function createArticleRenderer({
	articleMetadata,
	tagsFor,
	discussionsEnabled,
	protectedDiscussionConfig,
	discussionSection,
	href,
	staticAssets,
}) {
	const toc = (headings) => {
		const visible = headings.filter((heading) => heading.level >= 2 && heading.level <= 4);
		return visible.length
			? `<ol>${visible.map((heading) => `<li class="toc-level-${heading.level}"><a href="#${esc(heading.id)}">${esc(heading.label)}</a></li>`).join('')}</ol>`
			: '<p class="muted">이 문서에는 세부 목차가 없습니다.</p>';
	};
	const articleContent = (post, rendered) =>
		post.protectedEnvelope
			? `<article class="article" data-theme-piece="article" data-post-id="${esc(post.postId)}"><div data-protected-post><h1>보호된 글</h1>${articleMetadata(post)}<p>비밀번호를 입력하려면 JavaScript를 켜세요.</p></div><script type="application/json" data-protected-envelope>${js(post.protectedEnvelope)}</script>${discussionsEnabled ? `<script type="application/json" data-protected-discussion>${js(protectedDiscussionConfig(post))}</script>` : ''}<script defer src="${esc(href('/' + staticAssets.protected))}"></script></article>`
			: `<article class="article" data-theme-piece="article" data-post-id="${esc(post.postId)}"><header class="article-header"><h1>${esc(post.title || 'Untitled')}</h1>${articleMetadata(post)}${tagsFor(post)}</header><div class="article-body">${rendered.html}</div>${discussionSection(post)}</article>`;
	const articleSlot = '<span data-theme-slot="article"></span>';
	const docsNavigationSlot = '<span data-theme-slot="docs-navigation"></span>';
	// The article and iframe stay connected while changing appearance. Moving an iframe
	// through a DocumentFragment reloads its browsing context and loses the visitor draft.
	const articleLayout = (selectedTheme) =>
		`<div data-article-shell class="${selectedTheme === 'docs' ? 'docs-layout' : 'article-frame'}">${docsNavigationSlot}<main id="content" data-article-main class="${selectedTheme === 'docs' ? 'docs-content' : `article-shell theme-article-${selectedTheme}`}">${articleSlot}</main></div>`;
	return { toc, articleContent, articleLayout };
}
