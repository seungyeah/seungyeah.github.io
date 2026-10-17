import { esc, excerpt } from './text.mjs';

export function emitFeeds({ site, posts, absolute, write, siteTitle, siteDescription, author }) {
	if (site.feedEnabled !== false) {
		const feedUpdated =
			posts
				.map((post) => Date.parse(post.publicationDates.updatedAt))
				.filter(Number.isFinite)
				.sort((a, b) => b - a)[0] ?? 0;
		const feedUpdatedIso = new Date(feedUpdated).toISOString();
		const rssItems = posts
			.filter((post) => !post.protectedEnvelope)
			.map(
				(post) =>
					`<item><title>${esc(post.title || 'Untitled')}</title><link>${esc(absolute(`/posts/${post.permalink}/`))}</link><guid>${esc(absolute(`/posts/${post.permalink}/`))}</guid><pubDate>${esc(new Date(post.publicationDates.publishedAt).toUTCString())}</pubDate><description>${esc(excerpt(post.body, 240))}</description></item>`
			)
			.join('');
		const atomItems = posts
			.filter((post) => !post.protectedEnvelope)
			.map((post) => {
				const postUpdated = Date.parse(post.publicationDates.updatedAt);
				const updated = new Date(
					Number.isFinite(postUpdated) ? postUpdated : 0
				).toISOString();
				const url = absolute(`/posts/${post.permalink}/`);
				return `<entry><title>${esc(post.title || 'Untitled')}</title><id>${esc(url)}</id><published>${esc(post.publicationDates.publishedAt)}</published><updated>${updated}</updated><link rel="alternate" href="${esc(url)}"/><summary>${esc(excerpt(post.body, 240))}</summary></entry>`;
			})
			.join('');
		write(
			'feed.xml',
			`<rss version="2.0"><channel><title>${esc(siteTitle)}</title><link>${esc(absolute('/'))}</link><description>${esc(siteDescription || siteTitle)}</description>${rssItems}</channel></rss>`
		);
		write(
			'atom.xml',
			`<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(siteTitle)}</title><id>${esc(absolute('/'))}</id><updated>${feedUpdatedIso}</updated><author><name>${esc(author || siteTitle)}</name></author><link rel="alternate" href="${esc(absolute('/'))}"/>${atomItems}</feed>`
		);
	}
	const sitemapPages = [
		{ url: '/' },
		{ url: '/search/' },
		{ url: '/docs/' },
		...posts.map((post) => ({
			url: `/posts/${post.permalink}/`,
			updatedAt: post.publicationDates.updatedAt,
		})),
	];
	write(
		'sitemap.xml',
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapPages.map(({ url, updatedAt }) => `<url><loc>${esc(absolute(url))}</loc>${updatedAt ? `<lastmod>${esc(updatedAt)}</lastmod>` : ''}</url>`).join('')}</urlset>`
	);
}
