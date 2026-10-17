import { projectHeatmap, projectHomeData } from './home-data.mjs';
import { esc, tagSegment } from './text.mjs';
export function createHomeRenderer({
	posts,
	folders,
	postsByFolder,
	unfiledPosts,
	coverAssetsByPost,
	inlineMarkdown,
	orderBookPosts,
	site,
	publicationDay,
	postUrl,
	docsTreeEntries,
	profileUrl,
	externalLinks,
	profileImageMarkup,
	author,
	authorBio,
	compareText,
	href,
	compactRow,
	compactList,
	portfolioCard,
	blogCard,
	linkedPostTitle,
	reactionOverview,
	theme,
	siteDescription,
	renderMarkdown,
}) {
	const { postTags, bookImageByPost, books, starred, dated, activityByDay } = projectHomeData({
		posts,
		folders,
		postsByFolder,
		unfiledPosts,
		coverAssetsByPost,
		inlineMarkdown,
		orderBookPosts,
		site,
		publicationDay,
	});
	const blogBooks = () => {
		const covers = books
			.map((book) => {
				const image = book.image;
				return `<div class="book-slot"><a class="book-spine" href="#${esc(book.id)}" data-blog-book="${esc(book.id)}" aria-label="${esc(book.trail || book.name)} · ${book.items.length}개 글" title="${esc(book.trail || book.name)}"><span>${esc(book.name)}</span>${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async">` : ''}</a></div>`;
			})
			.join('');
		const contents = books
			.map((book) => {
				return `<section class="book-contents" id="${esc(book.id)}" data-book-panel data-book-title="${esc(book.name)}" data-book-count="${book.items.length}" data-book-period="${esc(book.period)}" tabindex="-1">${compactList(book.orderedItems, true)}</section>`;
			})
			.join('');
		return `<div class="book-shelf" data-book-shelf>${covers || '<p class="muted">아직 공개된 분류가 없습니다.</p>'}</div>${contents}`;
	};
	const blogHeatmap = (items) => {
		const years = projectHeatmap(items, publicationDay);
		if (!years.length) return '<p class="muted">아직 활동이 없습니다.</p>';
		const yearPanels = years.map(
			({ year, total, activeDays, offset, days, months: monthData }) => {
				const cells = Array.from(
					{ length: offset },
					() => '<span aria-hidden="true"></span>'
				);
				const months = monthData.map(
					({ column, month }) =>
						`<span style="grid-column:${column}" data-month="${month}">${month}월</span>`
				);
				for (const { day, count } of days) {
					const label = `${day}: ${count}개 글`;
					cells.push(
						`<span class="heatmap-day" data-date="${day}" data-level="${Math.min(count, 4)}" title="${label}" role="img" aria-label="${label}"></span>`
					);
				}
				const panel = `<div class="heatmap-scroll" tabindex="0" role="region" aria-label="${year}년 포스팅 히트맵, ${activeDays}일에 ${total}개 글"><div class="heatmap-chart"><div class="heatmap-months" aria-hidden="true">${months.join('')}</div><div class="heatmap-weekdays" aria-hidden="true">${['일', '월', '화', '수', '목', '금', '토'].map((day) => `<span>${day}</span>`).join('')}</div><div class="heatmap-grid">${cells.join('')}</div></div></div><div class="heatmap-legend" aria-hidden="true">${[0, 1, 2, 3, 4].map((level) => `<span class="heatmap-day" data-level="${level}"></span>`).join('')}</div>`;
				return { year, total, panel };
			}
		);
		const selected = yearPanels[0];
		const options = yearPanels
			.map(
				({ year }, index) =>
					`<button type="button" role="option" data-heatmap-year-option="${year}" aria-selected="${index === 0}">${year}</button>`
			)
			.join('');
		const panels = yearPanels
			.map(
				({ year, total, panel }, index) =>
					`<div id="heatmap-panel-${year}" data-heatmap-panel="${year}" data-heatmap-total="${total}"${index ? ' hidden' : ''}>${panel}</div>`
			)
			.join('');
		return `<div class="heatmap-summary"><details class="heatmap-year-picker" data-heatmap-year-picker><summary class="muted heatmap-year" data-heatmap-year-label aria-label="Post Activity 연도 선택" aria-controls="heatmap-panel-${selected.year}" aria-expanded="false">${selected.year}</summary><div class="heatmap-year-options" role="listbox" aria-label="연도 선택">${options}</div></details><p class="muted heatmap-total" data-heatmap-total aria-live="polite">${selected.total}개 글</p></div>${panels}`;
	};
	const postByUrl = new Map(posts.map((post) => [postUrl(post), post]));
	const staticDocsTree = (entries, filterable = false) =>
		`<ul>${entries
			.map((node) => {
				const post = postByUrl.get(node.href);
				return `<li${filterable ? (post ? ` data-blog-post data-post-tags="${esc(JSON.stringify(postTags(post)))}"` : ' data-docs-group') : ''}>${node.href ? `<a href="${esc(node.href)}">${esc(node.label)}</a>` : `<span>${esc(node.label)}</span>${staticDocsTree(node.children, filterable)}`}</li>`;
			})
			.join('')}</ul>`;
	const docsHome = () =>
		`<main id="content" class="docs-home"><nav class="docs-nav docs-directory" aria-label="전체 문서">${staticDocsTree(docsTreeEntries)}</nav></main>`;
	const homeProfile = () => {
		const links = [
			...(profileUrl ? [{ label: 'Contact', url: profileUrl }] : []),
			...externalLinks,
		];
		const image = profileImageMarkup();
		return `<aside class="home-profile">${image ? `<div class="profile-portrait">${image}</div>` : ''}<div class="profile-copy">${author ? `<h1>${esc(author)}</h1>` : ''}${authorBio ? `<p class="profile-bio">${esc(authorBio)}</p>` : ''}${links.length ? `<nav class="profile-links" aria-label="Contact 및 외부 링크">${links.map((link) => `<a href="${esc(link.url)}" rel="me noopener">${esc(link.label)}</a>`).join('')}</nav>` : ''}</div></aside>`;
	};
	const homeTabs = () =>
		`<nav class="blog-tabs" data-blog-tabs aria-label="블로그 탐색">${[
			['about-me', 'About Me'],
			['overview', 'Overview'],
			['books', 'Books'],
			['posts', 'Posts'],
		]
			.map(
				([id, label]) =>
					`<a href="#${id}" id="blog-tab-${id}" data-blog-tab="${id}">${label}</a>`
			)
			.join('')}</nav>`;
	const homePosts = (selectedTheme) => {
		const tags = [...new Set(posts.flatMap(postTags))].sort(compareText);
		const listing =
			selectedTheme === 'docs'
				? `<nav class="docs-nav docs-directory" aria-label="전체 문서">${staticDocsTree(docsTreeEntries, true)}</nav>`
				: `<ul class="post-list blog-posts">${posts.map((post) => `<li data-blog-post data-post-tags="${esc(JSON.stringify(postTags(post)))}">${compactRow(post)}</li>`).join('')}</ul>`;
		return `<section id="posts" data-blog-panel="posts" class="blog-panel"><h2>Posts</h2><div class="tag-filter-controls" data-blog-controls hidden><label><input type="checkbox" data-tag-enabled checked> 태그 필터 사용</label><button type="button" data-tag-clear>선택 지우기</button></div><nav class="blog-tags" aria-label="태그 선택">${tags.map((tag) => `<a class="tag" data-blog-tag="${esc(tag)}" href="${href(`/tags/${tagSegment(tag)}/`)}">#${esc(tag)}</a>`).join('')}</nav><p class="muted" data-tag-status role="status">전체 ${posts.length}개 글</p>${listing}<p class="muted" data-tag-empty hidden>선택한 태그에 해당하는 글이 없습니다.</p>${posts.length ? '' : '<p class="muted">아직 공개된 글이 없습니다.</p>'}</section>`;
	};
	const homeOverview = (selectedTheme) => {
		const starList =
			selectedTheme === 'portfolio'
				? `<div class="home-projects">${starred.map(portfolioCard).join('')}</div>`
				: selectedTheme === 'blog'
					? `<div class="blog-grid">${starred.map(blogCard).join('')}</div>`
					: compactList(starred);
		const stars = `<section class="home-stars"><h2>Pinned</h2>${starred.length ? starList : '<p class="muted">아직 고정한 글이 없습니다.</p>'}</section>`;
		const heatmap = `<section class="home-heatmap" data-heatmap><h2>Post Activity</h2>${blogHeatmap(posts)}</section>`;
		const activity = `<section class="home-activity"><h2>Timeline</h2>${dated.length ? `<ol class="post-activity">${[...activityByDay].map(([day, items]) => `<li${items.length > 1 ? ' class="post-activity-multiple"' : ''}><time datetime="${day}">${day}</time>${items.map((post) => `<div class="linked-post-title">${linkedPostTitle(post)}</div>`).join('')}</li>`).join('')}</ol>` : '<p class="muted">아직 게시한 글이 없습니다.</p>'}<a href="#posts" data-blog-open-posts>모든 글 보기 →</a></section>`;
		const composition =
			selectedTheme === 'layall'
				? `<div class="archive-ledger">${heatmap}${activity}</div>`
				: `${heatmap}${activity}`;
		return `<section id="overview" data-blog-panel="overview" class="blog-panel">${stars}${reactionOverview()}${composition}</section>`;
	};
	const renderHome = (_items, selectedTheme = theme) => {
		const tabs = homeTabs();
		const aboutMe = `<section id="about-me" data-blog-panel="about-me" class="blog-panel">${siteDescription.trim() ? `<div class="home-introduction article-body">${renderMarkdown(siteDescription).html}</div>` : '<p class="muted">아직 블로그 소개가 없습니다.</p>'}</section>`;
		const panels = `${aboutMe}${homeOverview(selectedTheme)}<section id="books" data-blog-panel="books" class="blog-panel"><header class="books-heading" data-books-heading hidden><h2><a class="books-back" href="#books" data-books-back aria-label="Books 목차로 돌아가기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"></path></svg><span data-books-title></span></a></h2><p class="books-meta muted"><span data-books-count></span><span data-books-period></span></p></header>${blogBooks()}</section>${homePosts(selectedTheme)}`;
		const profile = homeProfile();
		const composition =
			selectedTheme === 'blog'
				? `${profile}<div class="home-main">${tabs}${panels}</div>`
				: selectedTheme === 'docs'
					? `${tabs}<div class="knowledge-layout">${profile}<div class="home-main">${panels}</div></div>`
					: `${profile}${tabs}<div class="home-main">${panels}</div>`;
		return `<main id="content" class="home home-${selectedTheme}" data-blog-home>${composition}</main>`;
	};
	return { renderHome, docsHome, postTags, bookImageByPost };
}
