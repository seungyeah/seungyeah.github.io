import { createCacheReader } from './cache-reader.mjs';

export function createRenderCache({ posts, plan, generatorSha256 }) {
	const { context, postInputs } = plan;

	const cacheMetrics = {
		format: 'layall-render-cache',
		version: 1,
		status: 'disabled',
		posts: posts.length,
		hits: 0,
		misses: 0,
		cacheReadWallMs: 0,
		cacheReadCpuMs: 0,
		renderWallMs: 0,
		renderCpuMs: 0,
	};
	const cpuMs = (started) => {
		const used = process.cpuUsage(started);
		return (used.user + used.system) / 1000;
	};
	const { loadRenderCache, readPost } = createCacheReader({
		context,
		generatorSha256,
	});
	const cacheStarted = performance.now();
	const cacheCpuStarted = process.cpuUsage();
	const { cache: renderCache, status } = loadRenderCache();
	cacheMetrics.status = status;
	cacheMetrics.cacheReadWallMs += performance.now() - cacheStarted;
	cacheMetrics.cacheReadCpuMs += cpuMs(cacheCpuStarted);
	const cachedPostHtml = (post) => {
		if (!renderCache) return null;
		const started = performance.now();
		const cpuStarted = process.cpuUsage();
		try {
			const expected = postInputs[post.postId].cacheableOutputs[0];
			return readPost(renderCache, post.postId, expected);
		} catch {
			return null;
		} finally {
			cacheMetrics.cacheReadWallMs += performance.now() - started;
			cacheMetrics.cacheReadCpuMs += cpuMs(cpuStarted);
		}
	};

	return {
		cacheMetrics,
		renderPost(post, render) {
			// Cache admission, protected exclusion and accounting have one owner.
			const cached = post.protectedEnvelope ? null : cachedPostHtml(post);
			if (cached) {
				cacheMetrics.hits++;
				return cached;
			}
			cacheMetrics.misses++;
			const started = performance.now(),
				cpuStarted = process.cpuUsage();
			try {
				return render();
			} finally {
				cacheMetrics.renderWallMs += performance.now() - started;
				cacheMetrics.renderCpuMs += cpuMs(cpuStarted);
			}
		},
	};
}
