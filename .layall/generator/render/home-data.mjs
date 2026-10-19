import { closesFence, openFence } from './markdown-fences.mjs';
export function projectHomeData({
	posts,
	books: sourceBooks,
	coverAssetsByPost,
	inlineMarkdown,
	orderBookPosts,
	site,
	publicationDay,
}) {
	// All home themes share published data and interaction state.
	const postTags = (post) => [
		...new Set((Array.isArray(post.tags) ? post.tags : []).map(String)),
	];

	// Reuse the inline parser's code/link handling without rendering cached articles again.
	const bookImageByPost = new Map();
	for (const post of posts) {
		const candidates = coverAssetsByPost.get(post.postId);
		if (!candidates.length) continue;
		const eligible = new Map(
			candidates
				.filter((asset) => asset.id)
				.map((asset) => [asset.id, { ...asset, image: true, publicUrl: asset.url }])
		);
		let first = null;
		let fence = null;
		for (const line of String(post.body ?? '')
			.replace(/\r\n?/g, '\n')
			.split('\n')) {
			if (fence) {
				if (closesFence(line, fence)) fence = null;
				continue;
			}
			fence = openFence(line);
			if (fence) continue;
			inlineMarkdown(line, eligible, false, (image) => {
				if (!first && candidates.some((asset) => asset.url === image.url))
					first = image.url;
			});
			if (first) break;
		}
		bookImageByPost.set(post.postId, first || candidates[0].url);
	}
	const books = sourceBooks.map((book) => ({ ...book }));
	const cover = (book) =>
		[...book.items]
			.sort(
				(a, b) =>
					(Date.parse(b.publicationDates?.publishedAt) || 0) -
						(Date.parse(a.publicationDates?.publishedAt) || 0) ||
					String(a.postId).localeCompare(String(b.postId))
			)
			.map((post) => bookImageByPost.get(post.postId))
			.find(Boolean);
	for (const book of books) {
		book.image = cover(book);
		const dates = book.items.map(publicationDay).filter(Boolean).sort();
		book.period = dates.length
			? `${dates[0].replaceAll('-', '.')} - ${dates.at(-1).replaceAll('-', '.')}`
			: '날짜 기록 없음';
	}
	const starIds = new Set(
		Array.isArray(site.postLayout?.starredPostIds) ? site.postLayout.starredPostIds : []
	);
	const starred = orderBookPosts(posts.filter((post) => starIds.has(post.postId)));
	const dated = posts
		.filter(publicationDay)
		.sort((a, b) => publicationDay(b).localeCompare(publicationDay(a)))
		.slice(0, 12);
	const activityByDay = new Map();
	for (const post of dated) {
		const day = publicationDay(post);
		if (!activityByDay.has(day)) activityByDay.set(day, []);
		activityByDay.get(day).push(post);
	}
	return { postTags, bookImageByPost, books, starred, dated, activityByDay };
}

export function projectHeatmap(items, publicationDay) {
	const dates = items.map(publicationDay).filter(Boolean).sort();
	const years = [...new Set(dates.map((day) => Number(day.slice(0, 4))))].sort((a, b) => b - a);
	return years.map((year) => {
		const counts = new Map();
		for (const day of dates)
			if (Number(day.slice(0, 4)) === year) counts.set(day, (counts.get(day) ?? 0) + 1);
		const first = new Date(`${String(year).padStart(4, '0')}-01-01T00:00:00.000Z`);
		const offset = first.getUTCDay();
		const days = [],
			months = [];
		let index = offset;
		for (
			const date = new Date(first);
			date.getUTCFullYear() === year;
			date.setUTCDate(date.getUTCDate() + 1), index++
		) {
			const day = date.toISOString().slice(0, 10),
				count = counts.get(day) ?? 0;
			if (date.getUTCDate() === 1)
				months.push({ column: Math.floor(index / 7) + 1, month: date.getUTCMonth() + 1 });
			days.push({ day, count });
		}
		return {
			year,
			offset,
			days,
			months,
			activeDays: counts.size,
			total: [...counts.values()].reduce((sum, count) => sum + count, 0),
		};
	});
}
