// Public source projection only: protected posts have already been reduced to
// public placeholders by readSources. Never accept decrypted browser content here.
export function indexPublications({
	posts,
	folders,
	postsByFolder,
	unfiledPosts,
	orderBookPosts,
	compareText,
	href,
}) {
	const folderChildren = new Map();
	const books = [...folders].map(([id, folder]) => {
		const parent =
			folder.parentFolderId && folders.has(String(folder.parentFolderId))
				? String(folder.parentFolderId)
				: '';
		const children = folderChildren.get(parent) ?? [];
		children.push({ id, folder });
		folderChildren.set(parent, children);
		const names = [],
			seen = new Set();
		let ancestor = id;
		while (folders.has(ancestor) && !seen.has(ancestor)) {
			seen.add(ancestor);
			const value = folders.get(ancestor);
			names.unshift(String(value.name ?? ancestor));
			ancestor = String(value.parentFolderId ?? '');
		}
		return {
			id: `book-folder-${id}`,
			name: String(folder.name ?? id),
			trail: names.join(' / '),
			items: postsByFolder.get(id) ?? [],
		};
	});
	for (const children of folderChildren.values())
		children.sort((a, b) => compareText(String(a.folder.name), String(b.folder.name)));
	if (unfiledPosts.length)
		books.push({ id: 'book-unfiled', name: '분류 없는 글', trail: '', items: unfiledPosts });
	for (const book of books) book.orderedItems = orderBookPosts(book.items);
	const postInfo = new Map(
		posts.map((post) => {
			const id = String(post.folderId ?? ''),
				folder = folders.get(id);
			return [
				post.postId,
				{
					route: `posts/${post.permalink}/index.html`,
					url: href(`/posts/${encodeURIComponent(post.permalink)}/`),
					bookId: folder ? `book-folder-${id}` : 'book-unfiled',
					folderName: folder ? String(folder.name ?? id) : '분류 없는 글',
				},
			];
		})
	);
	return { postInfo, folderChildren, books };
}
