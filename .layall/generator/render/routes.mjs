import { esc, excerpt, plainText, tagSegment } from './text.mjs';

export function emitPages({ sources, assets, pages, cache, renderMarkdown, write }) {
	const { site, posts, folders, postsByFolder, unfiledPosts, href, absolute, formatDate } =
		sources;
	const { assetsByPost } = assets;
	const {
		shell,
		variantsOf,
		articleLayout,
		articleContent,
		docsNavigation,
		toc,
		theme,
		siteTitle,
		renderHome,
		blogCard,
		portfolioCard,
		compactList,
		folderName,
		postTags,
		docsHome,
		linkedPostTitle,
	} = pages;
	const { cachedPostHtml, cacheMetrics, cpuMs, postInputs } = cache;
	for (const post of posts) {
		const route = postInputs[post.postId].cacheableOutputs[0].path;
		const cached = post.protectedEnvelope ? null : cachedPostHtml(post);
		if (cached) {
			cacheMetrics.hits += 1;
			write(route, cached, post.postId);
			continue;
		}
		cacheMetrics.misses += 1;
		const renderStarted = performance.now();
		const renderCpuStarted = process.cpuUsage();
		const rendered = renderMarkdown(post.body, assetsByPost.get(post.postId));
		const variants = variantsOf(articleLayout);
		const pieces = {
			article: articleContent(post, rendered),
			'docs-navigation': `<div class="docs-sidebar-wrap" data-theme-piece="docs-navigation"><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation(post)}</aside></div>`,
		};
		const html = shell(post.title || 'Untitled', variants[theme], {
			kind: theme === 'docs' ? 'docs-article' : 'article',
			article: true,
			discussionPostId: post.protectedEnvelope ? null : post.postId,
			description: excerpt(post.body, 160),
			url: absolute(`/posts/${encodeURIComponent(post.permalink)}/`),
			image: rendered.firstImage?.url,
			imageAlt: rendered.firstImage?.alt,
			variants,
			pieces,
			postToc: toc(rendered.headings),
		});
		cacheMetrics.renderWallMs += performance.now() - renderStarted;
		cacheMetrics.renderCpuMs += cpuMs(renderCpuStarted);
		write(route, html, post.postId);
	}

	const PAGE_SIZE = 10;
	const paginationFor = (prefix, index, pages) => {
		if (pages <= 1) return '';
		const url = (page) => href(`/${prefix}${page ? `page/${page + 1}/` : ''}`);
		const visible = [...new Set([0, pages - 1, index - 1, index, index + 1])]
			.filter((page) => page >= 0 && page < pages)
			.sort((a, b) => a - b);
		const links = visible
			.map(
				(page, position) =>
					`${position && page > visible[position - 1] + 1 ? '<span aria-hidden="true">…</span>' : ''}<a${page === index ? ' aria-current="page"' : ''} aria-label="${page + 1} 페이지" href="${url(page)}">${page + 1}</a>`
			)
			.join('');
		return `<nav class="pagination" aria-label="페이지">${index ? `<a rel="prev" aria-label="이전 페이지" href="${url(index - 1)}">←</a>` : ''}${links}${index + 1 < pages ? `<a rel="next" aria-label="다음 페이지" href="${url(index + 1)}">→</a>` : ''}</nav>`;
	};
	const collectionBody = (selectedTheme, title, items, pagination, kind) => {
		const heading = `<header class="page-heading"><p class="eyebrow">${esc(kind.charAt(0).toUpperCase() + kind.slice(1))}</p><h1>${esc(title)}</h1></header>`;
		if (selectedTheme === 'blog')
			return `<main id="content" class="blog-home">${heading}<section class="blog-grid">${items.map(blogCard).join('')}</section>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</main>`;
		if (selectedTheme === 'minimal')
			return `<main id="content" class="minimal-home">${heading}<ul class="minimal-list">${items.map((post) => `<li><span class="post-meta">${esc(formatDate(post.publicationDates?.publishedAt))}</span><h2 class="linked-post-title">${linkedPostTitle(post)}</h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 150))}</p>` : ''}</li>`).join('')}</ul>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</main>`;
		if (selectedTheme === 'portfolio')
			return `<main id="content" class="portfolio-home"><section class="showcase" id="work">${heading}<div class="showcase-grid">${items.map(portfolioCard).join('')}</div>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</section></main>`;
		if (selectedTheme === 'docs')
			return `<div class="docs-layout"><div class="docs-sidebar-wrap"><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="docs-index">${heading}${compactList(items)}${pagination}</main><aside></aside></div>`;
		return `<main id="content">${heading}${compactList(items)}${pagination}</main>`;
	};
	const collection = (prefix, title, items, kind = 'collection') => {
		const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
		for (let index = 0; index < pages; index += 1) {
			const file =
				index === 0 ? `${prefix}index.html` : `${prefix}page/${index + 1}/index.html`;
			const pagination = paginationFor(prefix, index, pages);
			const pageItems = items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
			const variants = variantsOf((name) =>
				prefix === '' && index === 0
					? renderHome(pageItems, name)
					: collectionBody(name, title, pageItems, pagination, kind)
			);
			write(
				file,
				shell(title, variants[theme], {
					kind: prefix === '' ? 'home' : kind,
					variants,
				})
			);
		}
	};

	collection('', siteTitle, posts);
	for (const [id, folder] of folders) {
		collection(
			`folders/${encodeURIComponent(id)}/`,
			folder.name ?? id,
			postsByFolder.get(id) ?? [],
			'folder'
		);
	}
	// Preserve the legacy unfiled route without colliding with a real folder named home.
	if (unfiledPosts.length && !folders.has('home')) {
		collection('folders/home/', '분류 없는 글', unfiledPosts, 'folder');
	}
	const groupedTags = new Map();
	for (const post of posts) {
		for (const rawTag of postTags(post)) {
			const tag = String(rawTag);
			const items = groupedTags.get(tag) ?? [];
			items.push(post);
			groupedTags.set(tag, items);
		}
	}
	for (const [tag, items] of groupedTags) {
		collection(`tags/${tagSegment(tag)}/`, tag, items, 'tag');
	}

	const docsIndex = docsHome();
	const docsIndexVariants = variantsOf((name) =>
		name === 'docs' ? docsIndex : collectionBody(name, 'Docs', posts, '', 'documentation')
	);
	write(
		'docs/index.html',
		shell('Docs', docsIndexVariants[theme], {
			kind: 'docs-index',
			variants: docsIndexVariants,
		})
	);

	const search = posts
		.filter((post) => !post.protectedEnvelope)
		.map((post) => ({
			postId: post.postId,
			title: String(post.title || 'Untitled'),
			permalink: post.permalink,
			body: plainText(post.body),
			tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
			folder: folders.has(String(post.folderId ?? ''))
				? folderName(post.folderId)
				: '분류 없는 글',
			bookId: folders.has(String(post.folderId ?? ''))
				? `book-folder-${post.folderId}`
				: 'book-unfiled',
		}));
	write('search.json', JSON.stringify(search));
	const searchPanel = `<p class="eyebrow">Archive Search</p><h1>Search</h1><form class="search-form" data-search-form role="search"><label class="skip-link" for="search-query">검색어</label><input id="search-query" data-search-input type="search" autocomplete="off" placeholder="제목, 내용, 태그 검색"><button type="submit">검색</button></form><p class="muted" data-search-status aria-live="polite"></p><ul class="post-list search-results" data-search-results></ul>`;
	const searchVariants = variantsOf((name) => {
		if (name === 'docs')
			return `<div class="docs-layout"><div class="docs-sidebar-wrap"><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="search-shell">${searchPanel}</main><aside></aside></div>`;
		if (name === 'portfolio')
			return `<main id="content" class="search-shell portfolio-home"><section class="showcase" id="work">${searchPanel}</section></main>`;
		return `<main id="content" class="search-shell theme-search-${name}">${searchPanel}</main>`;
	});
	write(
		'search/index.html',
		shell('Search', searchVariants[theme], { kind: 'search', variants: searchVariants })
	);

	const notFoundVariants = variantsOf(
		(name) =>
			`<main id="content" class="theme-not-found-${name}"><section class="page-heading"><p class="eyebrow">Error 404</p><h1>페이지를 찾을 수 없습니다.</h1><p><a href="${href('/')}">홈으로 돌아가기</a></p></section></main>`
	);
	write(
		'404.html',
		shell('Not found', notFoundVariants[theme], {
			kind: 'not-found',
			variants: notFoundVariants,
		})
	);
}
