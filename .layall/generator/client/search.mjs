import { listeners } from './lifecycle.mjs';
export function createSearch(config) {
	let pageGeneration = 0,
		queryGeneration = 0,
		indexPromise;
	// One normalized index per site controller, shared across theme remounts.
	const loadIndex = () =>
		(indexPromise ??= fetch(config.searchUrl)
			.then((response) => {
				if (!response.ok) throw new Error('Search index unavailable');
				return response.json();
			})
			.then((entries) =>
				entries.map((entry) => ({
					entry,
					text: [entry.title, entry.body, entry.folder, ...entry.tags]
						.join(' ')
						.toLocaleLowerCase(),
				}))
			)
			.catch((error) => {
				indexPromise = undefined;
				throw error;
			}));
	const events = listeners();
	const bindSearch = (preservedQuery) => {
		events.dispose();
		const generation = ++pageGeneration;
		const form = document.querySelector('[data-search-form]');
		const input = document.querySelector('[data-search-input]');
		const results = document.querySelector('[data-search-results]');
		const status = document.querySelector('[data-search-status]');
		if (!form || !input || !results || !status) return;
		const run = async (syncUrl = false) => {
			const request = ++queryGeneration;
			const value = input.value.trim();
			const query = value.toLocaleLowerCase();
			const current = () =>
				generation === pageGeneration &&
				request === queryGeneration &&
				input.isConnected !== false;
			let entries;
			try {
				entries = await loadIndex();
			} catch {
				if (current()) status.textContent = '검색 색인을 불러오지 못했습니다.';
				return;
			}
			if (!current()) return;
			const found = (
				query ? entries.filter(({ text }) => text.includes(query)) : entries
			).map(({ entry }) => entry);
			results.replaceChildren(
				...found.map((entry) => {
					const li = document.createElement('li');
					const row = document.createElement('div');
					row.className = 'post-row';
					const strong = document.createElement('strong');
					strong.className = 'linked-post-title';
					const folder = document.createElement('a');
					folder.setAttribute(
						'href',
						config.homeUrl + '#' + encodeURIComponent(entry.bookId)
					);
					folder.setAttribute('data-blog-book', entry.bookId);
					folder.textContent = entry.folder;
					const post = document.createElement('a');
					post.className = 'post-title-link';
					post.setAttribute(
						'href',
						config.postPrefix + encodeURIComponent(entry.permalink) + '/'
					);
					post.textContent = entry.title;
					strong.append(folder, ' / ', post);
					const span = document.createElement('span');
					span.className = 'post-meta';
					span.textContent = entry.tags.map((tag) => '#' + tag).join(' · ');
					row.append(strong, span);
					li.append(row);
					return li;
				})
			);
			status.textContent = found.length + '개 결과';
			if (syncUrl) {
				const url = new URL(location.href);
				query ? url.searchParams.set('q', value) : url.searchParams.delete('q');
				history.replaceState(null, '', url);
			}
		};
		events.on(form, 'submit', (event) => {
			event.preventDefault();
			void run(true);
		});
		input.value = preservedQuery ?? new URL(location.href).searchParams.get('q') ?? '';
		void run();
	};
	return {
		bind: bindSearch,
		invalidate: () => {
			pageGeneration++;
			events.dispose();
		},
	};
}
