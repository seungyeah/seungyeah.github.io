import { bookNeighbors, navigationPath, validateNavigation } from './navigation-data.mjs';

export function createDocsNavigation({ config, root, mount }) {
	let docsRequest, activeController;
	let disposed = false,
		generation = 0,
		timeout;
	const loadingDocs = new WeakSet();
	const loadedDocs = new WeakSet();
	const docsResource = config.docsResource;
	const postPrefix = config.postPrefix;
	const requestDocs = (descriptor) => {
		if (disposed) throw new Error('Navigation disposed');
		const url = new URL(descriptor, location.href);
		if (
			!/^https?:$/.test(url.protocol) ||
			url.origin !== location.origin ||
			url.pathname !== docsResource ||
			url.search ||
			url.hash ||
			url.username ||
			url.password
		)
			throw new Error('Invalid navigation resource');
		if (!docsRequest) {
			const controller = new AbortController();
			activeController = controller;
			const requestTimeout = setTimeout(() => controller.abort(), 8000);
			timeout = requestTimeout;
			const request = (async () => {
				const response = await fetch(url.href, {
					mode: 'same-origin',
					credentials: 'omit',
					redirect: 'error',
					cache: 'no-cache',
					signal: controller.signal,
				});
				if (!response.ok || response.url !== url.href)
					throw new Error('Navigation unavailable');
				const text = await response.text();
				if (text.length > 8 * 1024 * 1024) throw new Error('Navigation too large');
				if (disposed || controller.signal.aborted) throw new Error('Navigation cancelled');
				const data = validateNavigation(JSON.parse(text), postPrefix, location.origin);
				// Validate deployment skew before either shared consumer can retain it.
				if (
					location.pathname.startsWith(postPrefix) &&
					!bookNeighbors(data.books, location.pathname, postPrefix, location.origin)
				)
					throw new Error('Book not found');
				return data;
			})()
				.catch((error) => {
					if (docsRequest === request) docsRequest = null;
					throw error;
				})
				.finally(() => {
					clearTimeout(requestTimeout);
					if (activeController === controller) {
						activeController = null;
						timeout = undefined;
					}
				});
			docsRequest = request;
		}
		return docsRequest;
	};
	const docsTree = (entries) => {
		const current = location.pathname.endsWith('/index.html')
			? location.pathname.slice(0, -10)
			: location.pathname;
		const branch = (nodes) => {
			const list = document.createElement('ul');
			for (const node of nodes) {
				const li = document.createElement('li');
				if (typeof node.href === 'string') {
					const path = navigationPath(node.href, postPrefix, location.origin);
					const link = document.createElement('a');
					link.href = path;
					link.textContent = node.label;
					if (path === current) link.setAttribute('aria-current', 'page');
					li.append(link);
				} else {
					const label = document.createElement('span');
					label.textContent = node.label;
					li.append(label, branch(node.children));
				}
				list.append(li);
			}
			return list;
		};
		return branch(entries);
	};
	const loadDocs = async (nav) => {
		if (disposed || !nav || loadingDocs.has(nav) || loadedDocs.has(nav)) return;
		const tree = nav.querySelector('[data-docs-tree]');
		const status = nav.querySelector('[data-docs-status]');
		if (!tree || !status) return;
		const mounted = generation;
		const current = () =>
			!disposed && mounted === generation && nav.isConnected && mount.contains(nav);
		loadingDocs.add(nav);
		tree.setAttribute('aria-busy', 'true');
		let request;
		try {
			request = requestDocs(nav.dataset.docsResource);
			const entries = await request;
			if (!current()) return;
			tree.replaceChildren(docsTree(entries.tree));
			loadedDocs.add(nav);
			status.textContent = '';
		} catch {
			// Preserve the owner's consumer guard, including failures constructing DOM.
			if (docsRequest === request) docsRequest = null;
			if (current())
				status.textContent = '목록을 불러오지 못했습니다. 전체 문서에서 글을 확인하세요.';
		} finally {
			tree.removeAttribute('aria-busy');
			loadingDocs.delete(nav);
		}
	};
	const bindDocs = () => {
		if (root.dataset.theme === 'docs')
			mount?.querySelectorAll('[data-docs-resource]').forEach(loadDocs);
	};
	return {
		bind: bindDocs,
		invalidate() {
			generation++;
		},
		loadBooks: async () => (await requestDocs(docsResource)).books,
		dispose() {
			disposed = true;
			generation++;
			clearTimeout(timeout);
			activeController?.abort();
		},
	};
}
