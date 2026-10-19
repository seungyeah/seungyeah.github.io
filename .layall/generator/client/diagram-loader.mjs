import { graphLimits, validateDiagramGraph } from './diagram-graph.mjs';

export function diagramURLs(config, origin) {
	const local = (value, pattern) => {
		if (typeof value !== 'string') throw new Error('Missing diagram URL');
		const url = new URL(value, origin);
		if (
			url.origin !== origin ||
			!/^https?:$/.test(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!pattern.test(url.pathname)
		)
			throw new Error('Invalid diagram URL');
		return url;
	};
	const script = local(config?.script, /\/assets\/static\/diagram-[a-f0-9]{64}\.js$/);
	const graph = local(config?.graph, /\/assets\/static\/mermaid-[a-f0-9]{64}\/graph\.json$/);
	if (
		script.pathname.slice(0, script.pathname.lastIndexOf('/')) !==
		graph.pathname.split('/').slice(0, -2).join('/')
	)
		throw new Error('Diagram asset root mismatch');
	return { script: script.href, graph: graph.href };
}
const hex = (bytes) =>
	[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function readDiagramAsset(url, limit, hash, { window }, signal) {
	const response = await window.fetch(url, {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer',
		signal,
	});
	if (
		!response.ok ||
		response.url !== url ||
		Number(response.headers.get('content-length')) > limit ||
		!response.body
	)
		throw new Error('Diagram asset unavailable');
	const reader = response.body.getReader(),
		chunks = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit || signal.aborted) throw new Error('Diagram asset limit');
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel();
		throw error;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	if (signal.aborted || hex(await window.crypto.subtle.digest('SHA-256', bytes)) !== hash)
		throw new Error('Diagram asset integrity');
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
// Cache only public library bytes. No article text, theme, token or decrypted data.
export function createDiagramLoader(config, platform) {
	let pending, controller, cached;
	const cancel = () => {
		controller?.abort();
		controller = null;
		pending = null;
	};
	return {
		cancel,
		dispose() {
			cancel();
			cached = null;
		},
		load() {
			if (cached) return Promise.resolve(cached);
			if (pending) return pending;
			const urls = diagramURLs(config, platform.window.location.origin);
			const current = new platform.window.AbortController();
			controller = current;
			const promise = (async () => {
				const graphHash = urls.graph.match(/mermaid-([a-f0-9]{64})\//)[1];
				const raw = await readDiagramAsset(
					urls.graph,
					graphLimits.metadata,
					graphHash,
					platform,
					current.signal
				);
				const graph = validateDiagramGraph(JSON.parse(raw));
				const sources = new Array(graph.modules.length);
				let next = 0;
				await Promise.all(
					Array.from({ length: Math.min(6, sources.length) }, async () => {
						while (next < sources.length) {
							const index = next++,
								node = graph.modules[index];
							const url = new URL(node.sha256 + '.mjs', urls.graph).href;
							sources[index] = await readDiagramAsset(
								url,
								node.size,
								node.sha256,
								platform,
								current.signal
							);
						}
					})
				);
				if (current.signal.aborted) throw new Error('Diagram load cancelled');
				cached = { graph, sources };
				return cached;
			})()
				.catch((error) => {
					current.abort();
					throw error;
				})
				.finally(() => {
					if (controller === current) {
						pending = null;
						controller = null;
					}
				});
			pending = promise;
			return promise;
		},
	};
}
