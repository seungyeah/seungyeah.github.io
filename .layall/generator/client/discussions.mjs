import { listeners } from './lifecycle.mjs';

function discussionTheme(config, root, system) {
	const name = Object.hasOwn(config.themes, root.dataset.theme) ? root.dataset.theme : 'layall';
	const mode =
		root.dataset.colorMode === 'dark' || (root.dataset.colorMode === 'system' && system.matches)
			? 'dark'
			: 'light';
	return config.themes[name][mode];
}

export function mountProtectedDiscussion(config, host) {
	const events = listeners();
	const section = document.createElement('section');
	section.className = 'discussion-thread';
	section.setAttribute('aria-label', '댓글과 반응');
	const status = document.createElement('p');
	status.className = 'muted';
	status.setAttribute('role', 'status');
	section.append(status);
	host.append(section);
	if (!config) {
		status.textContent = '댓글 연결이 준비되지 않았습니다.';
		return () => section.remove();
	}
	const notice = document.createElement('p');
	notice.id = 'protected-comments-notice';
	notice.textContent = '댓글은 암호화되지 않습니다.';
	// CSS generated content is not consistently announced by assistive technology.
	// Give the iframe the same description without duplicating the visible notice.
	notice.style.cssText =
		'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
	section.append(notice);
	const frame = document.createElement('iframe');
	frame.className = 'giscus-frame';
	frame.title = '댓글과 반응';
	frame.setAttribute('aria-describedby', notice.id);
	frame.setAttribute('scrolling', 'no');
	frame.setAttribute('allow', 'clipboard-write');
	frame.referrerPolicy = 'no-referrer';
	frame.style.cssText = 'width:100%;min-height:150px;border:0';
	const root = document.documentElement;
	const system = window.matchMedia('(prefers-color-scheme: dark)');
	const theme = () => discussionTheme(config, root, system);
	let disposed = false,
		session = '';
	const returned = new URL(location.href);
	const incoming = returned.searchParams.get('giscus');
	if (incoming) {
		session = incoming;
		returned.searchParams.delete('giscus');
		history.replaceState(history.state, '', returned);
	}
	try {
		if (incoming) localStorage.setItem('giscus-session', JSON.stringify(incoming));
		else session = JSON.parse(localStorage.getItem('giscus-session') || '""');
	} catch {}
	if (typeof session !== 'string' || session.length > 16384) session = '';
	const start = () => {
		if (disposed) return;
		status.hidden = false;
		status.textContent = '댓글·반응 불러오는 중…';
		const params = new URLSearchParams({
			origin: config.url,
			backLink: config.url,
			description: '',
			repo: config.repo,
			repoId: config.repoId,
			category: config.category,
			categoryId: config.categoryId,
			number: String(config.number),
			strict: '1',
			reactionsEnabled: '1',
			emitMetadata: '1',
			inputPosition: 'top',
			theme: theme(),
			session,
		});
		frame.src = `https://giscus.app/${config.lang}/widget?${params}`;
	};
	const sync = () => {
		if (!disposed)
			frame.contentWindow?.postMessage(
				{ giscus: { setConfig: { theme: theme() } } },
				'https://giscus.app'
			);
	};
	const message = (event) => {
		if (
			disposed ||
			event.origin !== 'https://giscus.app' ||
			event.source !== frame.contentWindow ||
			!event.data?.giscus
		)
			return;
		const data = event.data.giscus;
		if (
			data.signOut ||
			(typeof data.error === 'string' &&
				/Bad credentials|Invalid state value|State has expired/.test(data.error))
		) {
			try {
				localStorage.removeItem('giscus-session');
			} catch {}
			if (session) {
				session = '';
				start();
			}
		} else if (data.error) {
			status.hidden = false;
			status.textContent = '댓글을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
		} else if (Number.isFinite(data.resizeHeight) && data.resizeHeight > 0) {
			frame.style.height = `${Math.min(100000, data.resizeHeight)}px`;
			status.hidden = true;
		} else if (data.discussion) status.hidden = true;
	};
	const appearance = new MutationObserver(sync);
	appearance.observe(root, {
		attributes: true,
		attributeFilter: ['data-theme', 'data-color-mode'],
	});
	events.on(system, 'change', sync);
	events.on(window, 'message', message);
	events.on(frame, 'load', sync);
	start();
	section.append(frame);
	return () => {
		disposed = true;
		session = '';
		appearance.disconnect();
		events.dispose();
		section.remove();
	};
}

export function mountDiscussion(config) {
	const events = listeners(),
		frameEvents = listeners(),
		scriptEvents = listeners();
	let disposed = false,
		observedFrame;
	const root = document.documentElement;
	const holder = document.querySelector('[data-post-discussion]');
	const container = holder?.querySelector('.giscus');
	if (!container || holder.dataset.giscusMounted === 'true') return;
	holder.dataset.giscusMounted = 'true';
	const status = holder.querySelector('[data-discussion-status]');
	const retry = holder.querySelector('[data-discussion-retry]');
	const system = window.matchMedia('(prefers-color-scheme: dark)');
	const themeUrl = () => discussionTheme(config, root, system);
	const frame = () => container.querySelector('iframe.giscus-frame');
	let lastTheme = '';
	const sync = (force = false) => {
		if (disposed) return;
		const target = frame();
		const theme = themeUrl();
		if (!target?.contentWindow || (!force && theme === lastTheme)) return;
		target.contentWindow.postMessage(
			{ giscus: { setConfig: { theme } } },
			'https://giscus.app'
		);
		lastTheme = theme;
	};
	const appearance = new MutationObserver(() => sync());
	appearance.observe(root, {
		attributes: true,
		attributeFilter: ['data-theme', 'data-color-mode'],
	});
	const frames = new MutationObserver(() => {
		const target = frame();
		if (target !== observedFrame) {
			frameEvents.dispose();
			observedFrame = target;
			frameEvents.on(target, 'load', () => sync(true));
			sync(true);
		}
	});
	frames.observe(container, { childList: true });
	events.on(system, 'change', () => sync());
	events.on(window, 'message', (event) => {
		if (
			disposed ||
			event.origin !== 'https://giscus.app' ||
			event.source !== frame()?.contentWindow ||
			!event.data?.giscus
		)
			return;
		if (event.data.giscus.error) {
			status.hidden = false;
			status.textContent = '댓글을 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.';
		} else if (
			event.data.giscus.discussion ||
			Number.isFinite(event.data.giscus.resizeHeight)
		) {
			status.hidden = true;
			sync();
		}
	});
	const start = () => {
		if (disposed || frame() || holder.querySelector('script[data-layall-giscus]')) return;
		scriptEvents.dispose();
		retry.hidden = true;
		status.hidden = false;
		status.textContent = '댓글·반응 불러오는 중…';
		const script = document.createElement('script');
		script.src = 'https://giscus.app/client.js';
		script.async = true;
		script.crossOrigin = 'anonymous';
		const attributes = {
			'data-layall-giscus': 'true',
			'data-repo': config.repo,
			'data-repo-id': config.repoId,
			'data-category': config.category,
			'data-category-id': config.categoryId,
			'data-mapping': 'number',
			'data-term': String(config.post.number),
			'data-reactions-enabled': '1',
			'data-emit-metadata': '1',
			'data-input-position': 'top',
			'data-theme': themeUrl(),
			'data-lang': config.lang,
		};
		for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
		scriptEvents.on(script, 'error', () => {
			if (disposed) return;
			script.remove();
			status.hidden = false;
			status.textContent =
				'댓글 서비스를 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.';
			retry.hidden = false;
		});
		holder.append(script);
	};
	events.on(retry, 'click', start);
	start();
	return () => {
		if (disposed) return;
		disposed = true;
		appearance.disconnect();
		frames.disconnect();
		events.dispose();
		frameEvents.dispose();
		scriptEvents.dispose();
		holder.querySelector('script[data-layall-giscus]')?.remove();
		container.replaceChildren();
		delete holder.dataset.giscusMounted;
	};
}
