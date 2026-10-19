import { noteToc } from './note-toc.mjs';
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
	const articleContent = (post, rendered) => {
		const { folder, dates, listUrl } = articleMetadata(post);
		const postTocBar = noteToc(rendered.headings);
		const prevBtn = `<a class="page-nav-link page-nav-prev" data-nav-prev hidden href="#" title="이전 글"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg><span class="page-nav-title" data-nav-prev-title></span><span class="page-nav-label">이전글</span></a><span class="page-nav-disabled" data-nav-prev-empty aria-disabled="true" aria-label="이전글"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg><span>이전글</span></span>`;
		const nextBtn = `<a class="page-nav-link page-nav-next" data-nav-next hidden href="#" title="다음 글"><span class="page-nav-title" data-nav-next-title></span><span class="page-nav-label">다음글</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></a><span class="page-nav-disabled" data-nav-next-empty aria-disabled="true" aria-label="다음글"><span>다음글</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>`;
		const listIcon = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
		const listBtn = `<button class="page-nav-list-btn" type="button" data-page-list-toggle hidden title="페이지 목록 확인" aria-label="페이지 목록 확인" aria-expanded="false" aria-controls="page-list">${listIcon}</button><a class="page-nav-list-btn" data-page-list-fallback href="${esc(listUrl || href('/#posts'))}" title="페이지 목록 확인" aria-label="페이지 목록 확인">${listIcon}</a>`;
		const listPanel = `<div class="page-nav-popover" id="page-list" data-page-list hidden role="region" aria-label="페이지 목록"><p role="status"></p><button type="button" data-page-list-retry hidden>다시 시도</button><ol></ol></div>`;
		const bottomNav = `<div class="page-nav-anchor"><nav class="article-bottom-nav" aria-label="글 탐색"><div class="page-nav-side page-nav-before">${prevBtn}</div>${listBtn}<div class="page-nav-side page-nav-after">${nextBtn}</div>${listPanel}</nav></div>`;

		return post.protectedEnvelope
			? `<article class="article" data-theme-piece="article" data-post-id="${esc(post.postId)}"><div data-protected-post>${folder}<h1>보호된 글</h1>${dates}<p>비밀번호를 입력하려면 JavaScript를 켜세요.</p></div><script type="application/json" data-protected-envelope>${js(post.protectedEnvelope)}</script>${discussionsEnabled ? `<script type="application/json" data-protected-discussion>${js(protectedDiscussionConfig(post))}</script>` : ''}<script defer src="${esc(href('/' + staticAssets.protected))}"></script>${bottomNav}</article>`
			: `<article class="article" data-theme-piece="article" data-post-id="${esc(post.postId)}"><header class="article-header">${folder}<h1>${esc(post.title || 'Untitled')}</h1>${dates}${tagsFor(post)}</header>${postTocBar}<div class="article-body">${rendered.html}</div>${bottomNav}${discussionSection(post)}</article>`;
	};
	const articleSlot = '<span data-theme-slot="article"></span>';
	const docsNavigationSlot = '<span data-theme-slot="docs-navigation"></span>';
	// The article and iframe stay connected while changing appearance. Moving an iframe
	// through a DocumentFragment reloads its browsing context and loses the visitor draft.
	const articleLayout = (selectedTheme) =>
		`<div data-article-shell class="${selectedTheme === 'docs' ? 'docs-layout' : 'article-frame'}">${docsNavigationSlot}<main id="content" data-article-main class="${selectedTheme === 'docs' ? 'docs-content' : `article-shell theme-article-${selectedTheme}`}">${articleSlot}</main></div>`;
	return { toc, articleContent, articleLayout };
}
