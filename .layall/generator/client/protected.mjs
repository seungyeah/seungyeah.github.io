import { folderCrypto } from '../core/protection.mjs';
import { noteToc } from '../render/note-toc.mjs';
import { mountProtectedDiscussion } from './discussions.mjs';
import { mountNoteToc } from './note-navigation.mjs';

export function mountProtected(
	envelope,
	renderMarkdown,
	{ platform = globalThis, core = folderCrypto(platform) } = {}
) {
	const { document, window, URL, Blob, BroadcastChannel } = platform;
	const host = document.querySelector('[data-protected-post]');
	if (!host) return;
	const publicMetadata = ['.article-meta', '.article-date'].map((selector) =>
		host.querySelector(selector)?.cloneNode(true)
	);
	const urls = [];
	let generation = 0,
		disposeComments,
		disposeToc;
	const name = core.scope(core.namespace(envelope));
	const channel =
		typeof BroadcastChannel === 'function'
			? new BroadcastChannel('layall-folder-locks-v1')
			: null;
	const clear = () => {
		generation++;
		disposeToc?.();
		disposeToc = undefined;
		disposeComments?.();
		disposeComments = undefined;
		urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
		host.replaceChildren();
		window.dispatchEvent?.(new (window.Event || Event)('layall:article-content'));
		document.title = '보호된 글';
	};
	const text = (tag, value) => {
		const el = document.createElement(tag);
		el.textContent = value;
		return el;
	};
	const locked = (notice = '') => {
		clear();
		host.append(
			text('h1', '보호된 글'),
			text('p', '이 폴더의 비밀번호를 입력하세요. 잠금 해제는 이 브라우저에 기억됩니다.')
		);
		const form = document.createElement('form');
		form.className = 'search-form';
		const input = document.createElement('input');
		input.type = 'password';
		input.autocomplete = 'current-password';
		input.required = true;
		input.setAttribute('aria-label', '폴더 비밀번호');
		const button = text('button', '잠금 해제');
		button.type = 'submit';
		const status = text('p', notice);
		status.setAttribute('role', 'status');
		form.append(input, button);
		host.append(form, status);
		form.onsubmit = async (event) => {
			event.preventDefault();
			const current = ++generation;
			button.disabled = true;
			let password = input.value;
			input.value = '';
			try {
				const result = await core.unlock(envelope, password);
				password = '';
				if (current !== generation) return;
				show(
					result.payload,
					result.persisted
						? ''
						: '브라우저 저장을 확인하지 못했습니다. 현재 페이지는 열리지만 다음 방문에 비밀번호가 다시 필요할 수 있습니다.'
				);
			} catch {
				if (current === generation) {
					status.textContent = '비밀번호가 다르거나 글을 열 수 없습니다.';
					button.disabled = false;
				}
			} finally {
				password = '';
			}
		};
	};
	const show = (payload, notice = '') => {
		clear();
		const source = payload.source,
			assets = new Map();
		for (const a of Array.isArray(source.attachments) ? source.attachments : []) {
			const bytes = payload.assets[`content/posts/${source.postId}/${a.path}`];
			if (typeof bytes !== 'string') continue;
			const mime = /^image\/(png|jpeg|gif|webp|avif)$/.test(a.mimeType)
				? a.mimeType
				: 'application/octet-stream';
			const url = URL.createObjectURL(
				new Blob([core.decode(bytes, 64 * 1024 * 1024)], { type: mime })
			);
			urls.push(url);
			assets.set(String(a.id), { url, image: mime.startsWith('image/') });
		}
		const relock = text('button', '다시 잠금');
		relock.type = 'button';
		const status = text('p', notice);
		status.setAttribute('role', 'status');
		relock.onclick = async () => {
			clear();
			let failed = false,
				revision;
			try {
				revision = await core.forget(envelope);
			} catch {
				failed = true;
			}
			channel?.postMessage({ scope: name, revision });
			locked(
				failed
					? '저장된 키를 지우지 못했습니다. 브라우저의 사이트 데이터를 삭제하세요.'
					: '잠금 해제 정보를 지웠습니다.'
			);
		};
		const header = document.createElement('header');
		header.className = 'note-protected-header';
		header.append(
			...[
				publicMetadata[0]?.cloneNode(true),
				text('h1', String(source.title || '제목 없는 글')),
				publicMetadata[1]?.cloneNode(true),
			].filter(Boolean)
		);
		host.append(relock, status, header);
		const content = document.createElement('div');
		content.className = 'article-body';
		const rendered = renderMarkdown(source.body, assets);
		content.innerHTML = rendered.html;
		const tocMarkup = noteToc(rendered.headings);
		if (tocMarkup) {
			const template = document.createElement('template');
			template.innerHTML = tocMarkup;
			host.append(template.content);
		}
		host.append(content);
		if (tocMarkup) disposeToc = mountNoteToc(host, platform).dispose;
		for (const [field, label] of [
			['tags', '태그'],
			['summaries', '요약'],
			['tasks', '할 일'],
			['highlights', '강조 표시'],
		]) {
			if (!Array.isArray(source[field]) || !source[field].length) continue;
			host.append(text('h2', label));
			for (const item of source[field]) {
				const row = document.createElement('div');
				row.innerHTML = renderMarkdown(String(item), assets).html;
				host.append(row);
			}
		}
		for (const a of Array.isArray(source.attachments) ? source.attachments : []) {
			const asset = assets.get(String(a.id));
			if (!asset) continue;
			const link = text('a', String(a.path).split('/').pop() || '첨부파일');
			link.href = asset.url;
			link.download = String(a.path).split('/').pop();
			host.append(link, document.createElement('br'));
		}
		const comments = document.querySelector('[data-protected-discussion]');
		window.dispatchEvent?.(new (window.Event || Event)('layall:article-content'));
		if (comments)
			disposeComments = mountProtectedDiscussion(JSON.parse(comments.textContent), host);
	};
	channel &&
		(channel.onmessage = (event) => {
			if (event.data?.scope === name && core.notify(envelope, event.data.revision)) {
				locked('이 폴더를 다시 잠갔습니다.');
			}
		});
	const restore = async () => {
		locked();
		const current = generation;
		try {
			const result = await core.restore(envelope);
			if (current !== generation) return;
			if (result.payload) show(result.payload);
			else if (result.storageFailed)
				locked('브라우저의 잠금 해제 저장소에 접근할 수 없습니다.');
		} catch {
			locked('보호된 글을 열 수 없습니다.');
		}
	};
	window.addEventListener('pagehide', () => {
		core.invalidate(envelope);
		clear();
	});
	window.addEventListener('pageshow', (event) => {
		if (event.persisted) void restore();
	});
	void restore();
}
