export function createDocsNavigation({ config, root, mount }) {
	let docsRequest, activeController;
	let disposed = false;
	const loadingDocs = new WeakSet();
	const loadedDocs = new WeakSet();
	const docsResource = config.docsResource;
	const postPrefix = config.postPrefix;
	const requestDocs = (descriptor) => {
		const url = new URL(descriptor, location.href);
		if (
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
			const timeout = setTimeout(() => controller.abort(), 8000);
			docsRequest = fetch(url.href, {
				mode: 'same-origin',
				credentials: 'omit',
				redirect: 'error',
				cache: 'no-cache',
				signal: controller.signal,
			})
				.then(async (response) => {
					if (!response.ok || response.url !== url.href)
						throw new Error('Navigation unavailable');
					const text = await response.text();
					if (text.length > 8 * 1024 * 1024) throw new Error('Navigation too large');
					const data = JSON.parse(text);
					if (
						data.format !== 'layall-docs-navigation' ||
						data.version !== 1 ||
						!Array.isArray(data.tree)
					)
						throw new Error('Invalid navigation');
					return data.tree;
				})
				.catch((error) => {
					docsRequest = null;
					throw error;
				})
				.finally(() => clearTimeout(timeout));
		}
		return docsRequest;
	};
	const docsTree = (entries) => {
		let count = 0;
		const paths = new Set();
		const current = location.pathname.endsWith('/index.html')
			? location.pathname.slice(0, -10)
			: location.pathname;
		const branch = (nodes, depth = 0) => {
			if (!Array.isArray(nodes) || depth > 128) throw new Error('Invalid navigation');
			const list = document.createElement('ul');
			for (const node of nodes) {
				if (!node || typeof node.label !== 'string' || ++count > 50000)
					throw new Error('Invalid navigation');
				const li = document.createElement('li');
				if (typeof node.href === 'string') {
					const url = new URL(node.href, location.href);
					const segment = url.pathname.slice(postPrefix.length);
					if (
						url.origin !== location.origin ||
						!url.pathname.startsWith(postPrefix) ||
						!segment.endsWith('/') ||
						!/^[a-z0-9][a-z0-9-]{0,127}$/.test(segment.slice(0, -1)) ||
						url.search ||
						url.hash ||
						url.username ||
						url.password ||
						paths.has(url.pathname) ||
						node.children !== undefined
					)
						throw new Error('Invalid navigation link');
					paths.add(url.pathname);
					const link = document.createElement('a');
					link.href = url.pathname;
					link.textContent = node.label;
					if (url.pathname === current) link.setAttribute('aria-current', 'page');
					li.append(link);
				} else {
					const label = document.createElement('span');
					label.textContent = node.label;
					li.append(label, branch(node.children, depth + 1));
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
		loadingDocs.add(nav);
		tree.setAttribute('aria-busy', 'true');
		try {
			const entries = await requestDocs(nav.dataset.docsResource);
			if (disposed || !nav.isConnected || !mount.contains(nav)) return;
			tree.replaceChildren(docsTree(entries));
			loadedDocs.add(nav);
			status.textContent = '';
		} catch {
			docsRequest = null;
			if (!disposed)
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
		dispose() {
			disposed = true;
			activeController?.abort();
		},
	};
}
