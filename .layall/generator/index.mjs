import { emitAttachments } from './core/assets.mjs';
import { createRenderCache } from './core/cache.mjs';
import { createOutput } from './core/output.mjs';
import { readSources } from './core/sources.mjs';
import { emitStaticAssets } from './core/static-assets.mjs';
import { emitFeeds } from './render/feeds.mjs';
import { createMarkdown } from './render/markdown.mjs';
import { createPages } from './render/pages.mjs';
import { emitPwa } from './render/pwa.mjs';
import { emitPages } from './render/routes.mjs';
import { esc, js } from './render/text.mjs';

// Importing development modules performs no IO. Only this explicit entry point
// creates a fresh output tree. resources are read from the verified package by runtime.mjs.
export function generate({ out, sha, generatorSha256, resources }) {
	if (!out || !sha || !/^[a-f0-9]{64}$/.test(generatorSha256 ?? ''))
		throw new Error('output, source SHA and generator identity required');
	const generationStarted = performance.now();
	const generationCpuStarted = process.cpuUsage();
	const sources = readSources();
	const output = createOutput(out, sources.posts);
	const { write } = output;
	const assets = emitAttachments({ ...sources, write });
	const staticAssets = emitStaticAssets({ resources, write, href: sources.href });
	emitPwa({ ...sources, write, staticAssets });
	const pages = createPages({ sources, assets, staticAssets, write });
	const cache = createRenderCache({
		...sources,
		...assets,
		...output,
		generatorSha256,
		runtimeAssets: staticAssets,
	});
	const { renderMarkdown } = createMarkdown(sources);
	emitPages({ sources, assets, pages, cache, renderMarkdown, write });
	emitFeeds({ ...sources, ...pages, write });
	write(
		'download.html',
		`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>첨부파일 다운로드</title><p id="status">첨부파일을 준비합니다.</p><script type="application/json" data-download-config>${js({ basePath: sources.basePath })}</script><script defer src="${esc(sources.href('/' + staticAssets.download))}"></script></html>`
	);
	output.finish({ ...cache, ...assets, sha, generatorSha256 });
	process.stderr.write(
		`LAYALL_RENDER_CACHE_METRICS=${JSON.stringify({
			...cache.cacheMetrics,
			generationWallMs: performance.now() - generationStarted,
			generationCpuMs: cache.cpuMs(generationCpuStarted),
		})}\n`
	);
}
