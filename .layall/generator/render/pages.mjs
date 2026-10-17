import { createArticleRenderer } from './article.mjs';
import { createDiscussions } from './discussions.mjs';
import { createHomeRenderer } from './home.mjs';
import { createMarkdown } from './markdown.mjs';
import { createShell } from './shell.mjs';
import { esc, excerpt, safeExternal, tagSegment } from './text.mjs';
import { palettes, themeNames, themeOrder } from './theme-data.mjs';

export function createPages({ sources, assets, staticAssets, write }) {
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
	const { profileAsset, imageByPost, coverAssetsByPost, assetsByPost } = assets;
	const { renderMarkdown, inlineMarkdown } = createMarkdown({ href });
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
	const postUrl = (post) => href(`/posts/${encodeURIComponent(post.permalink)}/`);
	const linkedPostTitle = (post) => {
		const folderId = String(post.folderId ?? '');
		const folder = folders.get(folderId);
		const bookId = folder ? `book-folder-${folderId}` : 'book-unfiled';
		const name = folder ? String(folder.name ?? folderId) : '분류 없는 글';
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
		omyuFontPath: staticAssets.font,
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
		const folderId = String(post.folderId ?? '');
		const folder = folders.get(folderId);
		const bookId = folder ? `book-folder-${folderId}` : 'book-unfiled';
		const folderLabel = folder ? String(folder.name ?? folderId) : '분류 없는 글';
		return `<div class="post-meta article-meta"><span>${esc(date)}</span><a href="${esc(href(`/#${bookId}`))}" data-blog-book="${esc(bookId)}">${esc(folderLabel)}</a></div>`;
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

	const folderChildren = new Map();
	for (const [id, folder] of folders) {
		const parent =
			folder.parentFolderId && folders.has(String(folder.parentFolderId))
				? String(folder.parentFolderId)
				: '';
		const entries = folderChildren.get(parent) ?? [];
		entries.push({ id, folder });
		folderChildren.set(parent, entries);
	}
	for (const entries of folderChildren.values())
		entries.sort((a, b) => compareText(String(a.folder.name), String(b.folder.name)));

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
		staticAssets,
		pwaHead,
		clientConfig,
		topLinks,
		discussionBehavior,
	});
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

	const { renderHome, docsHome, postTags, bookImageByPost } = createHomeRenderer({
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
		folderName,
		postTags,
		docsHome,
		linkedPostTitle,
	};
}
