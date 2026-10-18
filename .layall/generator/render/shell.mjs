import { esc, js, safeSocialImage } from './text.mjs';
import { palettes, themeOrder } from './theme-data.mjs';
export function createShell({
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
}) {
	const shell = (title, body, options = {}) => {
		const description = options.description ?? siteDescription;
		const socialImage = safeSocialImage(options.image);
		const socialImageAlt =
			socialImage && String(options.imageAlt ?? '').trim() ? String(options.imageAlt) : '';
		const publicArticle = options.article && !options.noindex;
		const socialMetadata = publicArticle
			? `<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(options.url)}">${socialImage ? `<meta property="og:image" content="${esc(socialImage)}">${socialImageAlt ? `<meta property="og:image:alt" content="${esc(socialImageAlt)}">` : ''}` : ''}<meta name="twitter:card" content="${socialImage ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">${socialImage ? `<meta name="twitter:image" content="${esc(socialImage)}">${socialImageAlt ? `<meta name="twitter:image:alt" content="${esc(socialImageAlt)}">` : ''}` : ''}`
			: '';
		const verification = options.home
			? [
					['google-site-verification', site.googleSiteVerification],
					['naver-site-verification', site.naverSiteVerification],
				]
					.filter(
						([, token]) =>
							typeof token === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(token)
					)
					.map(([name, token]) => `<meta name="${name}" content="${esc(token)}">`)
					.join('')
			: '';
		const canonical = options.url ? `<link rel="canonical" href="${esc(options.url)}">` : '';
		const robots = options.noindex ? '<meta name="robots" content="noindex">' : '';
		const feeds =
			site.feedEnabled !== false
				? `<link rel="alternate" type="application/rss+xml" title="RSS" href="${esc(absolute('/feed.xml'))}"><link rel="alternate" type="application/atom+xml" title="Atom" href="${esc(absolute('/atom.xml'))}">`
				: '';
		const article = publicArticle
			? {
					'@context': 'https://schema.org',
					'@type': 'BlogPosting',
					headline: String(title),
					...(options.url
						? {
								url: options.url,
								mainEntityOfPage: { '@type': 'WebPage', '@id': options.url },
							}
						: {}),
					...(String(author ?? '').trim()
						? { author: { '@type': 'Person', name: String(author).trim() } }
						: {}),
					...(socialImage ? { image: socialImage } : {}),
				}
			: null;
		if (article) {
			for (const [field, value] of [
				['datePublished', options.publicationDates?.publishedAt],
				['dateModified', options.publicationDates?.updatedAt],
			]) {
				if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
					article[field] = value;
			}
		}
		const structuredData = article
			? `<script type="application/ld+json">${js(article)}</script>`
			: '';
		const nav = topLinks();
		const variants =
			options.variants ?? Object.fromEntries(themeOrder.map((name) => [name, body]));
		const pieces = Object.entries(options.pieces ?? {});
		const slot = (name) => `<span data-theme-slot="${name}"></span>`;
		const assemble = (markup) =>
			pieces.reduce((result, [name, piece]) => result.replace(slot(name), piece), markup);
		const activeVariant = variants[theme] ?? body;
		const activeBody = assemble(activeVariant);
		const pool = pieces
			.filter(([name]) => !activeVariant.includes(slot(name)))
			.map(([, piece]) => piece)
			.join('');
		const templates = themeOrder
			.map((name) => {
				const inertBody = (variants[name] ?? body).replace(
					/ id="([^"]+)"/g,
					' data-layout-id="$1"'
				);
				return `<template data-theme-layout="${name}">${inertBody}</template>`;
			})
			.join('');
		const layoutOptions = themeOrder
			.map(
				(name) =>
					`<option value="${name}"${name === theme ? ' selected' : ''}>${palettes[name].name}</option>`
			)
			.join('');
		const palettePicker = `<details class="palette-picker" data-palette-picker><summary aria-label="색상 선택" aria-controls="palette-options" aria-expanded="false" data-palette="${theme}"><span class="palette-dot" aria-hidden="true"></span><span data-palette-current>${palettes[theme].name}</span></summary><div id="palette-options" class="palette-options" data-palette-options hidden tabindex="-1" role="radiogroup" aria-label="색상">${themeOrder.map((name) => `<button type="button" role="radio" aria-checked="${name === theme}" tabindex="${name === theme ? '0' : '-1'}" data-palette-choice="${name}" data-palette="${name}"><span class="palette-dot" aria-hidden="true"></span>${palettes[name].name}</button>`).join('')}</div></details><select data-layout-theme hidden aria-hidden="true" tabindex="-1" aria-label="색상">${layoutOptions}</select>`;
		const footerNames = [
			...new Set([siteTitle, author].map((value) => String(value).trim()).filter(Boolean)),
		];
		const footerIdentity = footerNames
			.map((name) => `<span>${esc(name)}</span>`)
			.join('<span aria-hidden="true">·</span>');
		const postToc = options.postToc
			? `<div class="header-actions"><button class="post-toc-toggle" type="button" data-post-toc-toggle aria-expanded="false" aria-controls="post-table-of-contents">TOC</button><button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button></div><aside class="post-toc-panel" id="post-table-of-contents" data-post-toc-panel data-open="false" aria-hidden="true" tabindex="-1"><div class="post-toc-head"><strong>On This Page</strong><button class="post-toc-close" type="button" data-post-toc-close aria-label="목차 닫기">×</button></div><nav aria-label="현재 글 목차">${options.postToc}</nav></aside>`
			: '<button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button>';
		return `<!doctype html><html lang="${esc(site.locale || 'ko-KR')}" data-layall-theme="${esc(theme)}" data-theme="${esc(theme)}" data-author-theme="${esc(theme)}" data-color-mode="${esc(site.colorMode || 'system')}"><head><meta charset="utf-8">${pwaHead}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}">${socialMetadata}${canonical}${robots}${verification}${feeds}${structuredData}<title>${esc(title)}${title === siteTitle ? '' : ` · ${esc(siteTitle)}`}</title><link rel="stylesheet" href="${esc(href('/' + staticAssets.css))}"><noscript><link rel="stylesheet" href="${esc(href('/' + staticAssets.noScriptCss))}"></noscript></head><body data-page-kind="${esc(options.kind || 'page')}"${options.postToc ? ' data-post-page="true"' : ''}><a class="skip-link" href="#content">본문으로 건너뛰기</a><header class="site-header"><div class="header-inner"><a class="brand" href="${href('/')}">${esc(siteTitle)}</a>${postToc}<nav class="site-nav" id="site-navigation" data-nav>${nav}<div class="appearance-controls">${palettePicker}<span class="color-controls" aria-label="화면 테마"><button type="button" data-color="light" aria-label="라이트 모드">☀</button><button type="button" data-color="dark" aria-label="다크 모드">☾</button><button type="button" data-color="system" aria-label="시스템 모드">◐</button></span></div></nav></div></header><div data-theme-view>${activeBody}</div><noscript><nav class="docs-nav" aria-label="문서 안내"><a href="${href('/#posts')}">전체 문서</a></nav></noscript><div data-theme-pool hidden>${pool}</div><footer class="site-footer">${footerIdentity}</footer><nav class="floating-nav" aria-label="빠른 탐색"><a href="${href('/')}">Home</a><a href="${href('/#posts')}">Post</a><a href="${href('/search/')}">Search</a></nav>${templates}<script type="application/json" data-site-config>${js(clientConfig)}</script>${discussionBehavior(options)}<script defer src="${esc(href('/' + staticAssets.site))}"></script></body></html>`;
	};

	return shell;
}
