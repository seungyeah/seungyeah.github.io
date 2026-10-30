import { inspectMp4 } from '../core/mp4.mjs';
import { folderCrypto } from '../core/protection.mjs';
import { noteToc } from '../render/note-toc.mjs';
import { mountProtectedDiscussion } from './discussions.mjs';
import { listeners } from './lifecycle.mjs';
import { mountNoteToc } from './note-navigation.mjs';

export function mountProtected(
	envelope,
	renderMarkdown,
	{ platform = globalThis, core = folderCrypto(platform) } = {}
) {
	const { document, window, URL, Blob, BroadcastChannel } = platform;
	const host = document.querySelector('[data-protected-post]');
	if (!host) return { dispose() {} };
	const publicMetadata = ['.article-meta', '.article-date'].map((selector) =>
		host.querySelector(selector)?.cloneNode(true)
	);
	const urls = [];
	const events = listeners();
	let disposed = false,
		suspended = false,
		pendingLocks = 0;
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
		for (const video of host.querySelectorAll?.('video') ?? []) {
			video.onerror = null;
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
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
		if (disposed || suspended) return;
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
			if (disposed || suspended) return;
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
		if (disposed || suspended) return;
		clear();
		const source = payload.source,
			assets = new Map();
		for (const a of Array.isArray(source.attachments) ? source.attachments : []) {
			const bytes = payload.assets[`content/posts/${source.postId}/${a.path}`];
			if (typeof bytes !== 'string') continue;
			const decoded = core.decode(bytes, 64 * 1024 * 1024);
			const video = a.mimeType === 'video/mp4' && Boolean(inspectMp4(decoded));
			const mime = video
				? 'video/mp4'
				: /^image\/(png|jpeg|gif|webp|avif)$/.test(a.mimeType)
					? a.mimeType
					: 'application/octet-stream';
			const url = URL.createObjectURL(new Blob([decoded], { type: mime }));
			urls.push(url);
			assets.set(String(a.id), {
				url,
				image: mime.startsWith('image/'),
				videoUrl: video ? url : null,
				posterId: a.posterId,
				posterFor: a.posterFor,
				mimeType: a.mimeType,
			});
		}
		for (const [id, asset] of assets) {
			const poster = assets.get(asset.posterId);
			if (asset.videoUrl && poster?.image && poster.posterFor === id)
				asset.posterUrl = poster.url;
		}
		const relock = text('button', '다시 잠금');
		relock.type = 'button';
		const status = text('p', notice);
		status.setAttribute('role', 'status');
		relock.onclick = async () => {
			if (disposed || suspended) return;
			clear();
			const current = generation;
			pendingLocks++;
			let failed = false,
				revision;
			try {
				revision = await core.forget(envelope);
			} catch {
				failed = true;
			}
			try {
				channel?.postMessage({ scope: name, revision });
			} finally {
				pendingLocks--;
				if (disposed && !pendingLocks) channel?.close();
			}
			if (current !== generation) return;
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
		for (const video of content.querySelectorAll?.('video') ?? []) {
			video.muted = true;
			video.onerror = () => {
				const status = video.parentElement?.querySelector('[data-video-status]');
				if (status) status.textContent = '이 브라우저에서 동영상을 재생할 수 없습니다.';
			};
		}
		disposeToc = mountNoteToc(host, platform).dispose;
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
			if (
				!disposed &&
				event.data?.scope === name &&
				core.notify(envelope, event.data.revision)
			) {
				locked('이 폴더를 다시 잠갔습니다.');
			}
		});
	const restore = async () => {
		if (disposed) return;
		suspended = false;
		locked();
		const current = generation;
		try {
			const result = await core.restore(envelope);
			if (current !== generation) return;
			if (result.payload) show(result.payload);
			else if (result.storageFailed)
				locked('브라우저의 잠금 해제 저장소에 접근할 수 없습니다.');
		} catch {
			if (current === generation) locked('보호된 글을 열 수 없습니다.');
		}
	};
	const controller = {
		dispose() {
			if (disposed) return;
			disposed = true;
			events.dispose();
			if (channel) channel.onmessage = null;
			// A user-started relock must still notify other tabs after its durable
			// revision commits. Defer only channel.close until that operation settles.
			if (!pendingLocks) channel?.close();
			core.invalidate(envelope);
			clear();
		},
	};
	events.on(window, 'pagehide', (event) => {
		if (event?.persisted === false) {
			controller.dispose();
			return;
		}
		suspended = true;
		core.invalidate(envelope);
		clear();
	});
	events.on(window, 'pageshow', (event) => {
		if (event.persisted) void restore();
	});
	void restore();
	return controller;
}
