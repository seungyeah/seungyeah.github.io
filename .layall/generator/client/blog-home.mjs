import { listeners } from './lifecycle.mjs';
export function createBlogHome({ mount }) {
	const events = listeners();
	const blogState = { tab: 'overview', book: '', tags: new Set(), enabled: true };
	const bindBlog = () => {
		events.dispose();
		const home = mount?.querySelector('[data-blog-home]');
		if (!home) return;
		const tabs = [...home.querySelectorAll('[data-blog-tab]')];
		const panels = [...home.querySelectorAll('[data-blog-panel]')];
		const books = [...home.querySelectorAll('[data-book-panel]')];
		const tagLinks = [...home.querySelectorAll('[data-blog-tag]')];
		const rows = [...home.querySelectorAll('[data-blog-post]')].map((node) => ({
			node,
			tags: JSON.parse(node.dataset.postTags),
		}));
		const enabled = home.querySelector('[data-tag-enabled]');
		const clear = home.querySelector('[data-tag-clear]');
		const status = home.querySelector('[data-tag-status]');
		const empty = home.querySelector('[data-tag-empty]');
		home.querySelector('[data-blog-tabs]').setAttribute('role', 'tablist');
		home.querySelector('[data-blog-controls]').hidden = false;
		const setHash = (value) => {
			try {
				const url = new URL(location.href);
				url.hash = encodeURIComponent(value);
				if (url.hash !== location.hash) history.pushState(null, '', url);
			} catch {}
		};
		const plainClick = (event) =>
			!event.defaultPrevented &&
			event.button === 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.shiftKey &&
			!event.altKey;
		const show = (tab, book = '', sync = false) => {
			if (!tabs.some((node) => node.dataset.blogTab === tab)) tab = 'overview';
			const selectedBook = books.find((node) => node.id === book);
			if (!selectedBook) book = '';
			blogState.tab = tab;
			blogState.book = book;
			home.dataset.blogActiveTab = tab;
			tabs.forEach((node) => {
				const selected = node.dataset.blogTab === tab;
				node.setAttribute('role', 'tab');
				node.setAttribute('aria-controls', node.dataset.blogTab);
				node.setAttribute('aria-selected', String(selected));
				node.tabIndex = selected ? 0 : -1;
			});
			panels.forEach((node) => {
				node.hidden = node.dataset.blogPanel !== tab;
				node.setAttribute('role', 'tabpanel');
				node.setAttribute('aria-labelledby', 'blog-tab-' + node.dataset.blogPanel);
				node.tabIndex = 0;
			});
			books.forEach((node) => (node.hidden = node.id !== book));
			home.querySelector('[data-book-shelf]').hidden = Boolean(book);
			home.querySelector('[data-books-heading]').hidden = !book;
			home.querySelector('[data-books-title]').textContent =
				selectedBook?.dataset.bookTitle || '';
			home.querySelector('[data-books-count]').textContent = selectedBook
				? selectedBook.dataset.bookCount + '개 글'
				: '';
			home.querySelector('[data-books-period]').textContent =
				selectedBook?.dataset.bookPeriod || '';
			home.querySelector('[data-books-back]').setAttribute(
				'aria-label',
				(selectedBook ? selectedBook.dataset.bookTitle + ' · ' : '') +
					'Books 목차로 돌아가기'
			);
			home.querySelectorAll('[data-blog-book]').forEach((node) => {
				if (node.dataset.blogBook === book) node.setAttribute('aria-current', 'true');
				else node.removeAttribute('aria-current');
			});
			if (sync) setHash(book || tab);
		};
		const syncBlogHash = () => {
			let hash = location.hash.slice(1);
			try {
				hash = decodeURIComponent(hash);
			} catch {}
			if (books.some((node) => node.id === hash)) show('books', hash);
			else if (!hash) show('overview');
			else if (tabs.some((node) => node.dataset.blogTab === hash)) show(hash);
			else if (
				[...home.querySelectorAll('.home-introduction [id]')].some(
					(node) => node.id === hash
				)
			)
				show('about-me');
			else show(blogState.tab, blogState.book);
		};
		tabs.forEach((node, index) => {
			events.on(node, 'click', (event) => {
				if (!plainClick(event)) return;
				event.preventDefault();
				show(node.dataset.blogTab, '', true);
			});
			events.on(node, 'keydown', (event) => {
				let next;
				if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
				else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
				else if (event.key === 'Home') next = 0;
				else if (event.key === 'End') next = tabs.length - 1;
				else if (event.key === ' ') {
					event.preventDefault();
					show(node.dataset.blogTab, '', true);
					return;
				} else return;
				event.preventDefault();
				show(tabs[next].dataset.blogTab, '', true);
				tabs[next].focus();
			});
		});
		home.querySelectorAll('[data-blog-book]').forEach((node) =>
			events.on(node, 'click', (event) => {
				if (!plainClick(event)) return;
				event.preventDefault();
				show('books', node.dataset.blogBook, true);
				books.find((book) => book.id === node.dataset.blogBook)?.focus();
			})
		);
		home.querySelectorAll('[data-books-back]').forEach((node) =>
			events.on(node, 'click', (event) => {
				if (!plainClick(event)) return;
				event.preventDefault();
				const current = blogState.book;
				show('books', '', true);
				[...home.querySelectorAll('[data-book-shelf] [data-blog-book]')]
					.find((book) => book.dataset.blogBook === current)
					?.focus();
			})
		);
		events.on(home.querySelector('[data-blog-open-posts]'), 'click', (event) => {
			event.preventDefault();
			show('posts', '', true);
			tabs.find((node) => node.dataset.blogTab === 'posts')?.focus();
		});
		const filter = () => {
			enabled.checked = blogState.enabled;
			clear.disabled = blogState.tags.size === 0;
			tagLinks.forEach((node) => {
				node.setAttribute('role', 'button');
				node.setAttribute('aria-pressed', String(blogState.tags.has(node.dataset.blogTag)));
			});
			let count = 0;
			rows.forEach(({ node, tags }) => {
				node.hidden =
					blogState.enabled &&
					blogState.tags.size > 0 &&
					!tags.some((tag) => blogState.tags.has(tag));
				if (!node.hidden) count++;
			});
			home.querySelectorAll('[data-docs-group]').forEach(
				(node) =>
					(node.hidden = ![...node.querySelectorAll('[data-blog-post]')].some(
						(row) => !row.hidden
					))
			);
			empty.hidden = count !== 0 || rows.length === 0;
			status.textContent =
				(blogState.enabled
					? blogState.tags.size
						? '필터 적용'
						: '전체'
					: '필터 꺼짐 · 전체') +
				' ' +
				count +
				'개 글 / ' +
				rows.length +
				'개';
		};
		tagLinks.forEach((node) => {
			events.on(node, 'click', (event) => {
				event.preventDefault();
				const tag = node.dataset.blogTag;
				blogState.tags.has(tag) ? blogState.tags.delete(tag) : blogState.tags.add(tag);
				filter();
			});
			events.on(node, 'keydown', (event) => {
				if (event.key === ' ') {
					event.preventDefault();
					node.click();
				}
			});
		});
		events.on(enabled, 'change', () => {
			blogState.enabled = enabled.checked;
			filter();
		});
		events.on(clear, 'click', () => {
			blogState.tags.clear();
			filter();
		});
		events.on(window, 'hashchange', () => syncBlogHash());
		syncBlogHash();
		filter();
	};
	return {
		bind: bindBlog,
		dispose: () => {
			events.dispose();
		},
	};
}
