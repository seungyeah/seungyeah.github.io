import { inspectMp4 } from '../core/mp4.mjs';
import { listeners } from './lifecycle.mjs';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ENVELOPE = Math.ceil(MAX_BYTES / 3) * 4 + 16_384;

// Envelopes remain inert JSON on the origin that stores folder keys. Even direct
// navigation to an upload cannot run its bytes as HTML/SVG. Only validated MP4
// gets a video/mp4 Blob URL, and it is never assigned to an iframe or navigation.
export async function readVideoEnvelope(path, signal, platform = globalThis) {
	const url = new platform.URL(path, platform.location.href);
	if (
		url.origin !== platform.location.origin ||
		url.search ||
		url.hash ||
		url.username ||
		url.password ||
		!/^\/(?:[a-zA-Z0-9._~-]+\/)*assets\/posts\/[a-zA-Z0-9_-]+\/downloads\/[a-f0-9]{64}\.layall-download\.json$/.test(
			url.pathname
		) ||
		url.pathname.split('/').some((part) => part === '.' || part === '..')
	)
		throw new Error('Invalid video URL');
	const response = await platform.fetch(url.href, {
		signal,
		credentials: 'omit',
		redirect: 'error',
	});
	if (
		!response.ok ||
		!response.body ||
		Number(response.headers.get('content-length')) > MAX_ENVELOPE
	)
		throw new Error('Video unavailable');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let total = 0,
		text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > MAX_ENVELOPE) throw new Error('Video too large');
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const envelope = JSON.parse(text);
	if (
		envelope.format !== 'layall-download' ||
		envelope.version !== 1 ||
		envelope.mimeType !== 'video/mp4' ||
		typeof envelope.data !== 'string' ||
		envelope.data.length > Math.ceil(MAX_BYTES / 3) * 4 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data)
	)
		throw new Error('Invalid video envelope');
	const binary = platform.atob(envelope.data);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	if (!inspectMp4(bytes)) throw new Error('Invalid MP4');
	return new platform.Blob([bytes], { type: 'video/mp4' });
}

export function mountPublicVideos(root, platform = globalThis) {
	const events = listeners();
	const active = new Map();
	let disposed = false,
		suspended = false,
		generation = 0;
	const clear = () => {
		generation++;
		for (const [video, entry] of active) {
			entry.abort.abort();
			clearTimeout(entry.timer);
			video.onerror = null;
			video.pause();
			video.removeAttribute('src');
			video.load();
			if (entry.url) platform.URL.revokeObjectURL(entry.url);
		}
		active.clear();
	};
	const refresh = () => {
		clear();
		if (disposed || suspended || !root) return;
		const current = generation;
		// Serial loading bounds temporary base64/decoder memory across a gallery.
		void (async () => {
			for (const video of root.querySelectorAll('video[data-layall-video-envelope]')) {
				if (disposed || suspended || current !== generation) return;
				const entry = { abort: new AbortController(), url: null, timer: null };
				active.set(video, entry);
				entry.timer = setTimeout(() => entry.abort.abort(), 30_000);
				const status = video.parentElement?.querySelector('[data-video-status]');
				if (status) status.textContent = '동영상 불러오는 중…';
				try {
					const blob = await readVideoEnvelope(
						video.dataset.layallVideoEnvelope,
						entry.abort.signal,
						platform
					);
					if (current !== generation || disposed) return;
					if (entry.abort.signal.aborted) throw new Error('Video timeout');
					entry.url = platform.URL.createObjectURL(blob);
					video.muted = true;
					video.onerror = () => {
						if (status)
							status.textContent = '이 브라우저에서 동영상을 재생할 수 없습니다.';
					};
					video.src = entry.url;
					if (status) status.textContent = '';
					void video.play()?.catch(() => {}); // Controls remain available after autoplay denial.
				} catch {
					if (current === generation && !disposed && status)
						status.textContent =
							'동영상을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
				} finally {
					clearTimeout(entry.timer);
				}
			}
		})();
	};
	events.on(platform.window, 'pagehide', () => {
		suspended = true;
		clear();
	});
	events.on(platform.window, 'pageshow', (event) => {
		if (event.persisted) {
			suspended = false;
			refresh();
		}
	});
	events.on(platform.window, 'layall:article-content', refresh);
	refresh();
	return {
		clear,
		refresh,
		dispose() {
			disposed = true;
			events.dispose();
			clear();
		},
	};
}
