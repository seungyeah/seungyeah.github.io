import { indexPublications } from '../core/publications.mjs';
import { createArticleRenderer } from './article.mjs';
import { createDiscussions } from './discussions.mjs';
import { projectHomeData } from './home-data.mjs';
import { createHomeRenderer } from './home.mjs';
import { createMarkdown } from './markdown.mjs';
import { createShell } from './shell.mjs';
import { esc, excerpt, safeExternal, tagSegment } from './text.mjs';
import { palettes, themeNames, themeOrder } from './theme-data.mjs';

export function createPages({
	sources,
	assets,
	staticAssets,
	write,
	publications = indexPublications(sources),
	markdown = createMarkdown(sources),
}) {
	const {
		site,
		owner,
		repo,
		posts,
		folders,
		postsByFolder,
		unfiledPosts,
		orderBookPosts,
		compareText,
		formatDate,
		href,
		absolute,
		basePath,
		publicBase,
	} = sources;
	const { profileAsset, imageByPost, coverAssetsByPost } = assets;
	const { postInfo, folderChildren, books } = publications;
	const { renderMarkdown, inlineMarkdown } = markdown;
	const theme = themeNames.has(site.theme) ? site.theme : 'layall';
	const layoutStorageKey = `layall-layout-theme:${publicBase || basePath || '/'}`;
	const siteTitle = String(site.title || 'LayAll Blog');
	const siteDescription = String(site.description || '');
	const pwaScope = href('/');
	const pwaHead = `<link rel="manifest" href="${esc(href('/manifest.webmanifest'))}"><meta name="theme-color" content="#f6f4f0"><link rel="icon" type="image/png" sizes="192x192" href="${esc(href('/' + staticAssets.icon192))}"><link rel="apple-touch-icon" href="${esc(href('/' + staticAssets.icon192))}">`;
	const author = String(site.profileName || site.authorName || '');
	const authorBio = String(site.profileBio || '');
	const profileUrl = safeExternal(site.profileUrl);
	const externalLinks = (Array.isArray(site.externalLinks) ? site.externalLinks : [])
		.filter((link) => link && typeof link === 'object')
		.map((link) => ({ label: String(link.label ?? '').trim(), url: safeExternal(link.url) }))
		.filter((link) => link.label && link.url);
	const postUrl = (post) => postInfo.get(post.postId).url;
	const linkedPostTitle = (post) => {
		const { bookId, folderName: name } = postInfo.get(post.postId);
		return `<a href="${esc(href(`/#${bookId}`))}" data-blog-book="${esc(bookId)}">${esc(name)}</a> / <a class="post-title-link" href="${esc(postUrl(post))}">${esc(post.title || 'Untitled')}</a>`;
	};
	const {
		discussionsEnabled,
		discussionBehavior,
		discussionSection,
		protectedDiscussionConfig,
		reactionOverview,
	} = createDiscussions({
		site,
		owner,
		repo,
		publicBase,
		posts,
		absolute,
		write,
		tmoneyFontPath: staticAssets.tmoneyFont,
		linkedPostTitle,
	});
	const folderName = (id) => String(folders.get(String(id))?.name ?? id ?? 'Unfiled');
	const publicationDay = (post) => post.publicationDates?.publishedAt.slice(0, 10) ?? null;
	const koreanDate = (value) => {
		if (!value) return '';
		const [year, month, day] = value.slice(0, 10).split('-').map(Number);
		return `${year}년 ${month}월 ${day}일`;
	};
	const articleMetadata = (post) => {
		const dates = post.publicationDates;
		const date = dates
			? koreanDate(dates.publishedAt) +
				(Date.parse(dates.updatedAt) > Date.parse(dates.publishedAt)
					? ` (${koreanDate(dates.updatedAt)} 수정)`
					: '')
			: '';
		const { bookId, folderName: folderLabel } = postInfo.get(post.postId);
		return {
			folder: `<div class="post-meta article-meta"><a href="${esc(href(`/#${bookId}`))}" data-blog-book="${esc(bookId)}">${esc(folderLabel)}</a></div>`,
			dates: `<div class="post-meta article-date"><span class="article-date-default">${esc(date)}</span>${dates ? `<span class="article-date-note"><span title="블로그 최초 게시일">생성 <time datetime="${esc(dates.publishedAt)}">${esc(koreanDate(dates.publishedAt))}</time></span><span>수정 <time datetime="${esc(dates.updatedAt)}">${esc(koreanDate(dates.updatedAt))}</time></span></span>` : ''}</div>`,
			listUrl: href(`/#${bookId}`),
			listLabel: folderLabel,
		};
	};
	const tagsFor = (post) =>
		(Array.isArray(post.tags) ? post.tags : [])
			.map((rawTag) => {
				const tag = String(rawTag);
				return `<a class="tag" href="${href(`/tags/${tagSegment(tag)}/`)}">#${esc(tag)}</a>`;
			})
			.join(' ');
	const picture = (post, className = 'post-cover') => {
		const source = imageByPost.get(post.postId);
		return source
			? `<img class="${className}" src="${esc(source)}" alt="" loading="lazy">`
			: '';
	};

	const navigationTree = () => {
		const rendered = new Set();
		const link = (post) => ({ label: String(post.title || 'Untitled'), href: postUrl(post) });
		const branch = ({ id, folder }) => {
			if (rendered.has(id)) return [];
			rendered.add(id);
			return [
				{
					label: String(folder.name ?? ''),
					children: [
						...(postsByFolder.get(id) ?? []).map(link),
						...(folderChildren.get(id) ?? []).flatMap(branch),
					],
				},
			];
		};
		const result = (folderChildren.get('') ?? []).flatMap(branch);
		for (const [id, folder] of folders) result.push(...branch({ id, folder }));
		const remaining = unfiledPosts.filter((post) => !folders.has(String(post.folderId ?? '')));
		if (remaining.length) result.push({ label: '분류 없는 글', children: remaining.map(link) });
		return result;
	};
	const docsTreeEntries = navigationTree();
	const docsResourcePath = '__layall-docs-navigation.json';
	write(
		docsResourcePath,
		JSON.stringify({
			format: 'layall-docs-navigation',
			version: 1,
			tree: docsTreeEntries,
			// Same groups/order as the public home book lists. Do not flatten folders or
			// expose decrypted titles, source timestamps or private source page order.
			books: books
				.filter((book) => book.items.length)
				.map((book) =>
					book.orderedItems.map((post) => ({
						label: post.protectedEnvelope
							? '보호된 글'
							: String(post.title || 'Untitled'),
						href: postUrl(post),
					}))
				),
		})
	);

	const topLinks = () =>
		`<a href="${href('/')}">Home</a><a href="${href('/#posts')}">Posts</a><a href="${href('/search/')}">Search</a>`;
	const profileImageMarkup = () => {
		if (!profileAsset) return '';
		const focus = (value) =>
			typeof value === 'number' && Number.isFinite(value)
				? Math.min(100, Math.max(0, value))
				: 50;
		return `<img class="profile-photo" src="${esc(href('/' + profileAsset))}" alt="${esc(author || siteTitle)}" style="object-position:${focus(site.profileImage.focalX)}% ${focus(site.profileImage.focalY)}%">`;
	};
	const docsNavigation = (activePost) => {
		const folderId = String(activePost?.folderId ?? '');
		const section = folders.has(folderId)
			? `<a href="${href(`/folders/${encodeURIComponent(folderId)}/`)}">${esc(folderName(folderId))}</a>`
			: '';
		return `<nav class="docs-nav" aria-label="문서 목차" data-docs-resource="${esc(href(`/${docsResourcePath}`))}"><div data-docs-fallback><a class="docs-overview" href="${href('/#posts')}">전체 문서</a>${section}</div><div data-docs-tree></div><p data-docs-status role="status"></p></nav>`;
	};

	const clientConfig = {
		highlight: href('/' + staticAssets.highlight),
		diagram: {
			script: href('/' + staticAssets.diagram),
			graph: href('/' + staticAssets.diagramGraph),
		},
		basePath,
		themeOrder,
		theme,
		layoutStorageKey,
		paletteNames: Object.fromEntries(themeOrder.map((name) => [name, palettes[name].name])),
		docsResource: href('/' + docsResourcePath),
		postPrefix: basePath + '/posts/',
		searchUrl: href('/search.json'),
		homeUrl: href('/'),
		pwa: { workerUrl: href('/layall-sw.js'), scope: pwaScope },
	};
	const shell = createShell({
		site,
		theme,
		siteTitle,
		siteDescription,
		author,
		href,
		absolute,
		staticAssets,
		pwaHead,
		clientConfig,
		topLinks,
		discussionBehavior,
	});
	const homeData = projectHomeData({
		posts,
		books,
		coverAssetsByPost,
		inlineMarkdown,
		orderBookPosts,
		site,
		publicationDay,
	});
	const { bookImageByPost, postTags } = homeData;
	const compactRow = (post, bookThumbnails = false) => {
		const text = `<strong class="linked-post-title">${linkedPostTitle(post)}</strong><span class="post-meta">${esc(formatDate(post.publicationDates?.publishedAt))}</span>`;
		const image = bookThumbnails ? bookImageByPost.get(post.postId) : null;
		return `<div class="post-row">${bookThumbnails ? `<div class="book-post-copy">${text}</div>` : text}${image ? `<img src="${esc(image)}" alt="" width="56" height="56" loading="lazy" decoding="async">` : ''}</div>`;
	};
	const compactList = (items, bookThumbnails = false) => {
		if (!items.length) return '<div class="empty">아직 공개된 글이 없습니다.</div>';
		return `<ul class="post-list${bookThumbnails ? ' book-post-list' : ''}">${items
			.map((post) => `<li>${compactRow(post, bookThumbnails)}</li>`)
			.join('')}</ul>`;
	};
	const blogCard = (post) =>
		`<article class="blog-card">${picture(post)}<div class="post-meta">${esc(formatDate(post.publicationDates?.publishedAt))}</div><h2 class="linked-post-title">${linkedPostTitle(post)}</h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 130))}</p>` : ''}${tagsFor(post)}</article>`;
	const portfolioCard = (post) =>
		`<article class="showcase-card">${picture(post)}<div class="showcase-card-content"><span class="post-meta">${esc(formatDate(post.publicationDates?.publishedAt))}</span><h3 class="linked-post-title">${linkedPostTitle(post)}</h3>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 120))}</p>` : ''}</div></article>`;

	const { renderHome, docsHome } = createHomeRenderer({
		homeData,
		posts,
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
	});
	const variantsOf = (renderer) =>
		Object.fromEntries(themeOrder.map((name) => [name, renderer(name)]));

	const { toc, articleContent, articleLayout } = createArticleRenderer({
		articleMetadata,
		tagsFor,
		discussionsEnabled,
		protectedDiscussionConfig,
		discussionSection,
		href,
		staticAssets,
	});
	return {
		postInfo,
		shell,
		variantsOf,
		articleLayout,
		articleContent,
		docsNavigation,
		toc,
		theme,
		siteTitle,
		siteDescription,
		author,
		renderHome,
		blogCard,
		portfolioCard,
		compactList,
		postTags,
		docsHome,
		linkedPostTitle,
	};
}
