import { planRenderInputs } from './cache-identity.mjs';
import { createCacheReader } from './cache-reader.mjs';

export function createRenderCache({
	posts,
	folders,
	inputHashes,
	assetClaims,
	outputHashes,
	basePath,
	publicBase,
	owner = '',
	repo = '',
	generatorSha256,
	runtimeAssets = {},
}) {
	const { uniquePathsByPost, siteSha256, context, postInputs } = planRenderInputs({
		posts,
		folders,
		inputHashes,
		assetClaims,
		outputHashes,
		basePath,
		publicBase,
		owner,
		repo,
		generatorSha256,
		runtimeAssets,
	});

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
		cacheMetrics,
	});
	const cacheStarted = performance.now();
	const cacheCpuStarted = process.cpuUsage();
	const renderCache = loadRenderCache();
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
		cachedPostHtml,
		cacheMetrics,
		cpuMs,
		postInputs,
		siteSha256,
		context,
		uniquePathsByPost,
	};
}
