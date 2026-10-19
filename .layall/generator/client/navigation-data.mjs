// Every consumer admits the same exact same-origin, credential/query/fragment-free post path.
export function navigationPath(href, postPrefix, origin) {
	const url = new URL(href, origin);
	const segment = url.pathname.slice(postPrefix.length);
	if (
		!/^https?:$/.test(url.protocol) ||
		url.origin !== origin ||
		!url.pathname.startsWith(postPrefix) ||
		!/^[a-z0-9][a-z0-9-]{0,127}\/$/.test(segment) ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	)
		throw new Error('Invalid navigation link');
	return url.pathname;
}

export function validateNavigation(data, postPrefix, origin) {
	if (!data || data.format !== 'layall-docs-navigation' || data.version !== 1)
		throw new Error('Invalid navigation');
	const paths = new Set();
	let count = 0;
	const branch = (nodes, depth = 0) => {
		if (!Array.isArray(nodes) || depth > 128) throw new Error('Invalid navigation');
		for (const node of nodes) {
			if (!node || typeof node.label !== 'string' || ++count > 50000)
				throw new Error('Invalid navigation');
			if (typeof node.href === 'string') {
				const path = navigationPath(node.href, postPrefix, origin);
				if (paths.has(path) || node.children !== undefined)
					throw new Error('Invalid navigation link');
				paths.add(path);
			} else branch(node.children, depth + 1);
		}
	};
	branch(data.tree);
	bookGroups(data.books, postPrefix, origin);
	return data;
}

// Match exact canonical post paths, never suffixes. Only same-origin public
// permalinks and text labels from the validated navigation resource are accepted.
function bookGroups(books, postPrefix, origin) {
	if (!Array.isArray(books)) throw new Error('Invalid book navigation');
	const paths = new Set();
	const groups = books.map((book) => {
		if (!Array.isArray(book)) throw new Error('Invalid book navigation');
		return book.map((entry) => {
			if (
				typeof entry?.label !== 'string' ||
				typeof entry.href !== 'string' ||
				paths.size >= 50000
			)
				throw new Error('Invalid book link');
			const path = navigationPath(entry.href, postPrefix, origin);
			if (paths.has(path)) throw new Error('Invalid book link');
			paths.add(path);
			return { label: entry.label, href: path };
		});
	});
	return groups;
}

export function bookNeighbors(books, current, postPrefix, origin) {
	const groups = bookGroups(books, postPrefix, origin);
	let pathname = current.endsWith('/index.html') ? current.slice(0, -10) : current;
	if (!pathname.endsWith('/')) pathname += '/';
	const group = groups.find((book) => book.some((entry) => entry.href === pathname));
	const index = group?.findIndex((entry) => entry.href === pathname) ?? -1;
	return index < 0
		? null
		: { entries: group, index, prev: group[index - 1] ?? null, next: group[index + 1] ?? null };
}
