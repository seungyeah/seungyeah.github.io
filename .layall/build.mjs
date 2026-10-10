import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const generationStarted = performance.now();
const generationCpuStarted = process.cpuUsage();
const out = process.argv[2];
const sha = process.argv[3];
if (!out || !sha) throw new Error('usage: node build.mjs <outputDir> <sourceSha>');
if (fs.existsSync(out)) throw new Error('output must be fresh');
fs.mkdirSync(out, { recursive: true });

const inputHashes = new Map();
const readJson = (file, fallback) => {
	if (!fs.existsSync(file)) return fallback;
	const bytes = fs.readFileSync(file);
	inputHashes.set(file, createHash('sha256').update(bytes).digest('hex'));
	return JSON.parse(bytes.toString('utf8'));
};
if (fs.existsSync('.layall') && fs.lstatSync('.layall').isSymbolicLink())
	throw new Error('unsafe managed source');
if (fs.existsSync('.layall/site.json') && fs.lstatSync('.layall/site.json').isSymbolicLink())
	throw new Error('unsafe managed source');
const site = readJson('.layall/site.json', {});
const [owner = '', repo = ''] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const projectPath =
	repo && repo.toLowerCase() !== `${owner}.github.io`.toLowerCase() ? `/${repo}` : '';
const configuredBase = String(site.baseUrl ?? '').trim();
let basePath = projectPath;
let configuredPublicBase = '';
try {
	if (configuredBase) {
		const configuredUrl = new URL(configuredBase);
		if (configuredUrl.protocol === 'https:' || configuredUrl.protocol === 'http:') {
			basePath = configuredUrl.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
			configuredPublicBase = `${configuredUrl.origin}${basePath}`;
		}
	}
} catch {}
const fallbackBase = owner ? `https://${owner}.github.io${projectPath}` : '';
const publicBase = configuredPublicBase || fallbackBase;
const href = (value) => `${basePath}${value}` || '/';
const absolute = (value) => (publicBase ? `${publicBase}${value}` : href(value));
const esc = (value) =>
	String(value ?? '').replace(
		/[&<>\"]/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[character]
	);
const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const safeExternal = (value) => {
	try {
		const url = new URL(String(value ?? ''));
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
};
const isInternalHostname = (value) => {
	const hostname = String(value ?? '')
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '');
	if (
		!hostname ||
		hostname === 'localhost' ||
		/\.(?:localhost|local|internal)$/.test(hostname)
	)
		return true;
	const ipv4 = hostname.split('.').map(Number);
	if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
		const [first, second] = ipv4;
		return (
			first === 0 ||
			first === 10 ||
			first === 127 ||
			(first === 100 && second >= 64 && second <= 127) ||
			(first === 169 && second === 254) ||
			(first === 172 && second >= 16 && second <= 31) ||
			(first === 192 && second === 168) ||
			first >= 224
		);
	}
	if (hostname.includes(':'))
		return (
			hostname === '::' ||
			hostname === '::1' ||
			/^f[cd]/.test(hostname) ||
			/^fe[89ab]/.test(hostname)
		);
	return !hostname.includes('.');
};
const safeSocialImage = (value) => {
	try {
		const url = new URL(String(value ?? ''));
		return url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			!isInternalHostname(url.hostname)
			? url.href
			: null;
	} catch {
		return null;
	}
};
const safeContentHref = (value) => {
	const raw = String(value ?? '').trim();
	if (!raw || raw.startsWith('//') || raw.includes('\\')) return null;
	if (raw.startsWith('#')) return raw.replace(/[^#a-zA-Z0-9_-]/g, '');
	if (raw.startsWith('/')) return href(raw.replace(/\s/g, '%20'));
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return safeExternal(raw);
	return raw.replace(/\s/g, '%20');
};
const plainText = (value) =>
	String(value ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2')
		.replace(/[#>*_`~-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const excerpt = (value, limit = 180) => {
	const text = plainText(value);
	return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
};
const slugify = (value) => {
	const slug = String(value ?? '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-|-$/g, '');
	return slug || 'section';
};
const tagSegment = (value) => `t-${Buffer.from(String(value), 'utf8').toString('hex')}`;
const formatDate = (value) => {
	if (value === undefined || value === null || value === '') return '';
	const date = new Date(value ?? 0);
	if (Number.isNaN(date.getTime())) return '';
	try {
		return new Intl.DateTimeFormat(site.locale || 'ko-KR', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		}).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
};

const folders = new Map();
const folderRoot = 'content/folders';
if (fs.existsSync('content') && fs.lstatSync('content').isSymbolicLink())
	throw new Error('unsafe managed source');
if (fs.existsSync(folderRoot)) {
	if (fs.lstatSync(folderRoot).isSymbolicLink()) throw new Error('unsafe managed source');
	for (const name of fs.readdirSync(folderRoot).sort()) {
		if (!name.endsWith('.json')) continue;
		const folderPath = path.join(folderRoot, name);
		if (fs.lstatSync(folderPath).isSymbolicLink()) throw new Error('unsafe managed source');
		const folder = readJson(folderPath, {});
		if (folder.format === 'layall-folder' && folder.folderId) {
			const folderId = String(folder.folderId);
			if (!/^[a-zA-Z0-9_-]{1,128}$/.test(folderId)) throw new Error('invalid folder id');
			folders.set(folderId, folder);
		}
	}
}

const posts = [];
const postRoot = 'content/posts';
if (fs.existsSync(postRoot)) {
	if (fs.lstatSync(postRoot).isSymbolicLink()) throw new Error('unsafe managed source');
	const realPostRoot = fs.realpathSync(postRoot);
	for (const id of fs.readdirSync(postRoot).sort()) {
		const sourceDir = path.join(postRoot, id);
		if (fs.lstatSync(sourceDir).isSymbolicLink()) throw new Error('unsafe managed source');
		if (!fs.realpathSync(sourceDir).startsWith(`${realPostRoot}${path.sep}`))
			throw new Error('unsafe managed source');
		const file = path.join(sourceDir, 'post.layallnote');
		if (!fs.existsSync(file)) continue;
		if (fs.lstatSync(file).isSymbolicLink()) throw new Error('unsafe managed source');
		const post = readJson(file, {});
		if (post.format !== 'layall-note' || post.postId !== id)
			throw new Error('invalid managed source');
		if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(post.permalink ?? ''))) {
			throw new Error('invalid permalink');
		}
		Object.defineProperty(post, 'sourceDir', { value: sourceDir });
		posts.push(post);
	}
}
posts.sort((a, b) => {
	const byDate =
		new Date(b.sourceUpdatedAt ?? 0).getTime() - new Date(a.sourceUpdatedAt ?? 0).getTime();
	return (
		byDate || String(a.title ?? '').localeCompare(String(b.title ?? ''), site.locale || 'ko-KR')
	);
});

// Keep the global post order in each bucket; navigation and counts share this index.
const postsByFolder = new Map();
const unfiledPosts = [];
for (const post of posts) {
	const id = String(post.folderId ?? '');
	const items = postsByFolder.get(id) ?? [];
	items.push(post);
	postsByFolder.set(id, items);
	if (!post.folderId || !folders.has(String(post.folderId))) unfiledPosts.push(post);
}

const generated = [];
const generatedSet = new Set();
const outputHashes = new Map();
const outputOwners = new Map();
const referencedPathsByPost = new Map(posts.map((post) => [post.postId, new Set()]));

// A byte trie with failure links finds overlapping raw IDs/routes, including code,
// manual links and binary assets. Non-owned outputs are conservatively shared.
const referenceStates = [{ edges: new Map(), fail: 0, matches: [] }];
for (const post of posts) {
	for (const marker of [post.postId, `posts/${post.permalink}/`]) {
		let state = 0;
		for (const byte of Buffer.from(marker)) {
			if (!referenceStates[state].edges.has(byte)) {
				referenceStates[state].edges.set(byte, referenceStates.length);
				referenceStates.push({ edges: new Map(), fail: 0, matches: [] });
			}
			state = referenceStates[state].edges.get(byte);
		}
		referenceStates[state].matches.push(post.postId);
	}
}
const referenceQueue = [...referenceStates[0].edges.values()];
for (let index = 0; index < referenceQueue.length; index += 1) {
	const state = referenceQueue[index];
	for (const [byte, next] of referenceStates[state].edges) {
		let fail = referenceStates[state].fail;
		while (fail && !referenceStates[fail].edges.has(byte)) fail = referenceStates[fail].fail;
		referenceStates[next].fail = referenceStates[fail].edges.get(byte) ?? 0;
		referenceStates[next].matches.push(...referenceStates[referenceStates[next].fail].matches);
		referenceQueue.push(next);
	}
}
const referenceStarts = new Uint32Array(256);
for (const [byte, state] of referenceStates[0].edges) referenceStarts[byte] = state;
const recordReferences = (name, bytes, ownerId) => {
	let state = 0;
	const matches = new Set();
	for (let index = 0; index < bytes.length; index += 1) {
		const byte = bytes[index];
		if (!state) state = referenceStarts[byte];
		else {
			let next = referenceStates[state].edges.get(byte);
			while (next === undefined && state) {
				state = referenceStates[state].fail;
				next = referenceStates[state].edges.get(byte);
			}
			state = next ?? 0;
		}
		if (state) for (const id of referenceStates[state].matches) matches.add(id);
	}
	for (const id of matches) if (id !== ownerId) referencedPathsByPost.get(id).add(name);
};
const write = (name, data, ownerId = null) => {
	const outputRoot = path.resolve(out);
	const file = path.resolve(outputRoot, name);
	if (!file.startsWith(`${outputRoot}${path.sep}`)) throw new Error('unsafe output path');
	if (generatedSet.has(name)) throw new Error('duplicate output path');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, data);
	generated.push(name);
	generatedSet.add(name);
	const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
	outputHashes.set(name, createHash('sha256').update(bytes).digest('hex'));
	if (ownerId !== null) {
		outputOwners.set(name, ownerId);
		recordReferences(name, bytes, ownerId);
	}
};

const assetClaims = [];
const imageByPost = new Map();
const assetsByPost = new Map();
for (const post of posts) {
	const assets = new Map();
	assetsByPost.set(post.postId, assets);
	for (const asset of Array.isArray(post.attachments) ? post.attachments : []) {
		const relative = String(asset.path ?? '').replace(/\\/g, '/');
		const segments = relative.split('/');
		if (
			!relative ||
			path.isAbsolute(relative) ||
			segments.some((segment) => !segment || segment === '..')
		) {
			throw new Error('unsafe asset');
		}
		const sourceRoot = path.resolve(post.sourceDir);
		const source = path.resolve(sourceRoot, relative);
		if (!source.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('unsafe asset');
		if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
		let component = sourceRoot;
		for (const segment of segments) {
			component = path.join(component, segment);
			if (fs.lstatSync(component).isSymbolicLink()) throw new Error('unsafe asset');
		}
		const realSourceRoot = fs.realpathSync(sourceRoot);
		const realSource = fs.realpathSync(source);
		if (!realSource.startsWith(`${realSourceRoot}${path.sep}`)) throw new Error('unsafe asset');
		const destination = `assets/posts/${post.postId}/${segments.map(encodeURIComponent).join('/')}`;
		write(destination, fs.readFileSync(source), post.postId);
		assetClaims.push({ postId: post.postId, path: destination, sha256: asset.sha256 });
		const looksLikeImage =
			String(asset.mimeType ?? asset.contentType ?? '').startsWith('image/') ||
			/\.(avif|gif|jpe?g|png|webp)$/i.test(relative);
		if (asset.id)
			assets.set(String(asset.id), {
				url: href(`/${destination}`),
				publicUrl: safeSocialImage(absolute(`/${destination}`)),
				image: looksLikeImage,
			});
		if (looksLikeImage && !imageByPost.has(post.postId))
			imageByPost.set(post.postId, href(`/${destination}`));
	}
}

// Current sources alone plan post routes; cached/deleted routes cannot add outputs.
const uniquePathsByPost = new Map(
	posts.map((post) => [post.postId, [`posts/${post.permalink}/index.html`]])
);
for (const asset of assetClaims) uniquePathsByPost.get(asset.postId).push(asset.path);
for (const paths of uniquePathsByPost.values()) paths.sort();
const generatorSha256 = createHash('sha256')
	.update(fs.readFileSync(process.argv[1]))
	.digest('hex');
const hashInput = (value) => createHash('sha256').update(value).digest('hex');
const siteSha256 = inputHashes.get('.layall/site.json') ?? hashInput('{}');
const context = {
	basePath,
	publicBase,
	runtime: {
		node: process.versions.node,
		icu: process.versions.icu ?? null,
		tz: process.versions.tz ?? null,
		timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
	},
};
// Lists/search/feed use source text and attachment metadata, not rendered Markdown.
// Only a post HTML depends on this source, its own folder, site/runtime and assets.
// Ancestor folders/other posts affect the separately regenerated navigation resource.
const postInputs = Object.fromEntries(
	[...posts]
		.sort((left, right) => String(left.postId).localeCompare(String(right.postId)))
		.map((post) => {
			const route = `posts/${post.permalink}/index.html`;
			const sourceSha256 = inputHashes.get(path.join(post.sourceDir, 'post.layallnote'));
			const folderSha256 = hashInput(
				JSON.stringify(folders.get(String(post.folderId ?? '')) ?? null)
			);
			const assets = uniquePathsByPost
				.get(post.postId)
				.filter((name) => name !== route)
				.map((name) => ({ path: name, sha256: outputHashes.get(name) }));
			const key = hashInput(
				JSON.stringify([
					'layall-post-html-v1',
					generatorSha256,
					siteSha256,
					context,
					sourceSha256,
					folderSha256,
					assets,
					route,
				])
			);
			return [
				post.postId,
				{ sourceSha256, folderSha256, assets, cacheableOutputs: [{ path: route, key }] },
			];
		})
);

// This is a private, transport-verified input, never a second public output tree.
// Limits affect eligibility only: any failure takes the normal fresh renderer.
const cacheManifestLimit = 32 * 1024 * 1024;
const cacheHtmlLimit = 16 * 1024 * 1024;
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
const cachePathSafe = (name) =>
	typeof name === 'string' &&
	name.length > 0 &&
	name.length <= 4096 &&
	!/[\\\x00-\x1f\x7f]/.test(name) &&
	!path.posix.isAbsolute(name) &&
	!path.win32.isAbsolute(name) &&
	name.split('/').every((part) => part && part !== '.' && part !== '..');
const cacheHashSafe = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const readCacheFile = (root, name, limit) => {
	if (!cachePathSafe(name)) throw new Error('invalid cache path');
	let file = root;
	const parts = name.split('/');
	for (const [index, part] of parts.entries()) {
		file = path.join(file, part);
		const stat = fs.lstatSync(file);
		if (
			stat.isSymbolicLink() ||
			(index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
		)
			throw new Error('invalid cache component');
	}
	if (!fs.realpathSync(file).startsWith(`${root}${path.sep}`))
		throw new Error('cache outside root');
	// O_NOFOLLOW also rejects replacement of the last component before open.
	const fd = fs.openSync(
		file,
		fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
	);
	try {
		const stat = fs.fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.uid !== process.getuid() ||
			stat.size < 1 ||
			stat.size > limit
		)
			throw new Error('invalid cache file');
		// Bound the read even if a damaged file grows after stat. No cached code runs.
		const bytes = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < bytes.length) {
			const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
			if (!count) throw new Error('truncated cache file');
			offset += count;
		}
		const after = fs.fstatSync(fd);
		if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
			throw new Error('changed cache file');
		return bytes;
	} finally {
		fs.closeSync(fd);
	}
};
const parseCacheManifest = (bytes) => {
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const value = JSON.parse(text);
	// JSON.parse accepts repeated keys. Reject those as well as repeated path rows.
	const containers = [];
	for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g)) {
		const token = match[0];
		if (token === '{' || token === '[') containers.push(token === '{' ? new Set() : null);
		else if (token === '}' || token === ']') containers.pop();
		else {
			let next = match.index + token.length;
			while (/\s/.test(text[next] ?? '') && next < text.length) next += 1;
			if (text[next] !== ':') continue;
			const keys = containers.at(-1);
			const key = JSON.parse(token);
			if (keys.has(key)) throw new Error('duplicate cache manifest key');
			keys.add(key);
		}
	}
	return value;
};
const loadRenderCache = () => {
	const value = process.env.LAYALL_RENDER_CACHE_ROOT;
	if (!value) return null;
	cacheMetrics.status = 'rejected';
	try {
		// Unversioned/external date data is outside the key's supported runtime scope.
		if (
			!context.runtime.icu ||
			!context.runtime.tz ||
			!context.runtime.timeZone ||
			process.env.NODE_ICU_DATA ||
			process.env.ICU_DATA ||
			process.execArgv.some((arg) => arg.startsWith('--icu-data-dir')) ||
			/--icu-data-dir/.test(process.env.NODE_OPTIONS ?? '')
		)
			return null;
		if (!path.isAbsolute(value) || typeof process.getuid !== 'function') return null;
		const stat = fs.lstatSync(value);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(stat.mode & 0o777) !== 0o700 ||
			stat.uid !== process.getuid()
		)
			return null;
		const root = fs.realpathSync(value);
		const manifest = parseCacheManifest(
			readCacheFile(root, '__layall-output-manifest.json', cacheManifestLimit)
		);
		if (
			manifest?.format !== 'layall-output-manifest' ||
			manifest.version !== 2 ||
			manifest.generator?.format !== 'layall-node-static-generator' ||
			manifest.generator.version !== 2 ||
			manifest.generator.sha256 !== generatorSha256 ||
			manifest.renderInputs?.version !== 1 ||
			!Array.isArray(manifest.files) ||
			manifest.files.length > 100000 ||
			!manifest.renderInputs.posts ||
			typeof manifest.renderInputs.posts !== 'object' ||
			Array.isArray(manifest.renderInputs.posts)
		)
			return null;
		const hashes = new Map();
		for (const entry of manifest.files) {
			if (
				!cachePathSafe(entry?.path) ||
				!cacheHashSafe(entry.sha256) ||
				hashes.has(entry.path)
			)
				return null;
			hashes.set(entry.path, entry.sha256);
		}
		const inputs = new Map(Object.entries(manifest.renderInputs.posts));
		if (inputs.size > 50000) return null;
		const claimed = new Set();
		for (const input of inputs.values()) {
			if (!Array.isArray(input?.cacheableOutputs)) continue;
			for (const output of input.cacheableOutputs) {
				if (!cachePathSafe(output?.path) || claimed.has(output.path)) return null;
				claimed.add(output.path);
			}
		}
		cacheMetrics.status = 'ready';
		return { root, hashes, inputs };
	} catch {
		return null;
	}
};
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
		const outputs = renderCache.inputs.get(post.postId)?.cacheableOutputs;
		if (!Array.isArray(outputs) || outputs.length !== 1) return null;
		const output = outputs[0];
		if (output.path !== expected.path || output.key !== expected.key) return null;
		const expectedHash = renderCache.hashes.get(expected.path);
		if (!expectedHash) return null;
		const bytes = readCacheFile(renderCache.root, expected.path, cacheHtmlLimit);
		return hashInput(bytes) === expectedHash ? bytes : null;
	} catch {
		return null;
	} finally {
		cacheMetrics.cacheReadWallMs += performance.now() - started;
		cacheMetrics.cacheReadCpuMs += cpuMs(cpuStarted);
	}
};

const inlineMarkdown = (source, assets = new Map(), figures = false, onImage = null) => {
	const placeholders = [];
	const keep = (html) => {
		const token = `\u0000${placeholders.length}\u0000`;
		placeholders.push(html);
		return token;
	};
	let value = String(source ?? '')
		.replace(/\u0000/g, '')
		.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));
	value = value.replace(
		/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+[\"'][^\"']*[\"'])?\)/g,
		(_, image, label, target) => {
			const attachment = target.startsWith('layall-attachment:');
			const asset = attachment ? assets.get(target.slice('layall-attachment:'.length)) : null;
			const safe = attachment ? asset?.url : safeContentHref(target);
			if (!safe || /[\u0000-\u001f\u007f]/.test(safe)) {
				return keep(
					attachment
						? `<span class="attachment-missing">첨부파일: ${esc(label || 'Attachment')}</span>`
						: esc(label)
				);
			}
			if (image && (!attachment || asset.image)) {
				const publicUrl = attachment ? asset.publicUrl : safeSocialImage(target);
				if (publicUrl) onImage?.({ url: publicUrl, alt: String(label ?? '') });
				const picture = `<img src="${esc(safe)}" alt="${esc(label)}" loading="lazy" decoding="async">`;
				return keep(
					figures
						? `<figure class="article-image">${picture}${label.trim() ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`
						: picture
				);
			}
			return keep(`<a href="${esc(safe)}">${esc(label || 'Attachment')}</a>`);
		}
	);
	value = esc(value)
		.replace(/\\\|/g, '|')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^_]+)__/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
		.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
	// A code span can occur inside a link label. Restore nested, generated tokens too.
	while (/\u0000\d+\u0000/.test(value))
		value = value.replace(
			/\u0000(\d+)\u0000/g,
			(_, index) => placeholders[Number(index)] ?? ''
		);
	return value;
};

// LayAll stores tables as pipe-delimited Markdown and side-by-side images on one line.
const tableCells = (line = '') => {
	let value = line.trim();
	if (!value.includes('|')) return null;
	if (value.startsWith('|')) value = value.slice(1);
	if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
	const cells = [];
	let cell = '';
	for (let index = 0; index < value.length; index += 1) {
		if (value[index] === '\\' && index + 1 < value.length) {
			cell += value[index] + value[++index];
		} else if (value[index] === '|') {
			cells.push(cell.trim());
			cell = '';
		} else cell += value[index];
	}
	cells.push(cell.trim());
	return cells;
};
const imageLine = (line) => {
	const pattern = /!\[[^\]]*\]\([^\s)]+(?:\s+["'][^"']*["'])?\)/g;
	const images = [...line.matchAll(pattern)];
	return images.length && !line.replace(pattern, '').trim() ? images.length : 0;
};

const renderMarkdown = (source, assets) => {
	const lines = String(source ?? '')
		.replace(/\r\n?/g, '\n')
		.split('\n');
	const html = [];
	const headings = [];
	let firstImage = null;
	const usedIds = new Set();
	const rememberImage = (image) => {
		firstImage ??= image;
	};
	const inline = (value) => inlineMarkdown(value, assets, false, rememberImage);
	let paragraph = [];
	let list = null;
	let fence = null;
	let quote = [];
	const flushParagraph = () => {
		if (!paragraph.length) return;
		html.push(`<p>${inline(paragraph.join(' '))}</p>`);
		paragraph = [];
	};
	const flushList = () => {
		if (!list) return;
		html.push(
			`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.type}>`
		);
		list = null;
	};
	const flushQuote = () => {
		if (!quote.length) return;
		html.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
		quote = [];
	};
	const flushAll = () => {
		flushParagraph();
		flushList();
		flushQuote();
	};
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (fence) {
			if (/^\s*```/.test(line)) {
				html.push(
					`<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ''}>${esc(fence.lines.join('\n'))}</code></pre>`
				);
				fence = null;
			} else fence.lines.push(line);
			continue;
		}
		const fenceMatch = line.match(/^\s*```([^\s`]*)/);
		if (fenceMatch) {
			flushAll();
			fence = { language: fenceMatch[1], lines: [] };
			continue;
		}
		const imageCount = imageLine(line);
		if (imageCount) {
			flushAll();
			const images = inlineMarkdown(line, assets, true, rememberImage);
			html.push(
				imageCount > 1
					? `<div class="image-gallery" data-image-gallery="true">${images}</div>`
					: images
			);
			continue;
		}
		const header = tableCells(line);
		const separator = tableCells(lines[index + 1]);
		if (
			header &&
			separator?.length === header.length &&
			separator.every((cell) => /^:?-{3,}:?$/.test(cell))
		) {
			flushAll();
			const alignments = separator.map((cell) =>
				cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left'
			);
			const row = (cells, tag) =>
				`<tr>${header.map((_, column) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} class="align-${alignments[column]}">${inline(cells[column] ?? '').replace(/&lt;br\s*\/?&gt;/gi, '<br>')}</${tag}>`).join('')}</tr>`;
			const rows = [];
			index += 1;
			while (index + 1 < lines.length) {
				const cells = tableCells(lines[index + 1]);
				if (
					!cells ||
					imageLine(lines[index + 1]) ||
					/^(?:#{1,6}\s|\s*```)/.test(lines[index + 1])
				)
					break;
				rows.push(cells);
				index += 1;
			}
			html.push(
				`<div class="article-table" tabindex="0" role="region" aria-label="표"><table><thead>${row(header, 'th')}</thead><tbody>${rows.map((cells) => row(cells, 'td')).join('')}</tbody></table></div>`
			);
			continue;
		}
		const heading = line.match(/^(#{1,6})\s+(.+)$/);
		if (heading) {
			flushAll();
			const level = heading[1].length;
			const label = plainText(heading[2]);
			const base = `heading-${slugify(label)}`;
			let id = base;
			let suffix = 2;
			while (usedIds.has(id)) id = `${base}-${suffix++}`;
			usedIds.add(id);
			headings.push({ level, label, id });
			html.push(
				`<h${level} id="${esc(id)}">${inline(heading[2])}<a class="heading-anchor" href="#${esc(id)}" aria-label="${esc(label)} 바로가기">#</a></h${level}>`
			);
			continue;
		}
		const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
		const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
		if (unordered || ordered) {
			flushParagraph();
			flushQuote();
			const type = ordered ? 'ol' : 'ul';
			if (list?.type !== type) flushList();
			list ??= { type, items: [] };
			list.items.push((ordered || unordered)[1]);
			continue;
		}
		const quoted = line.match(/^>\s?(.*)$/);
		if (quoted) {
			flushParagraph();
			flushList();
			quote.push(quoted[1]);
			continue;
		}
		if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
			flushAll();
			html.push('<hr>');
			continue;
		}
		if (!line.trim()) {
			flushAll();
			continue;
		}
		flushList();
		flushQuote();
		paragraph.push(line.trim());
	}
	if (fence)
		html.push(
			`<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ''}>${esc(fence.lines.join('\n'))}</code></pre>`
		);
	flushAll();
	return { html: html.join('\n'), headings, firstImage };
};

const themeOrder = ['layall', 'blog', 'minimal', 'portfolio', 'docs'];
const themeNames = new Set(themeOrder);
const theme = themeNames.has(site.theme) ? site.theme : 'layall';
const layoutStorageKey = `layall-layout-theme:${publicBase || basePath || '/'}`;
const siteTitle = String(site.title || 'LayAll Blog');
const siteDescription = String(site.description || '');
const author = String(site.profileName || site.authorName || '');
const authorBio = String(site.profileBio || '');
const profileUrl = safeExternal(site.profileUrl);
const externalLinks = (Array.isArray(site.externalLinks) ? site.externalLinks : [])
	.filter((link) => link && typeof link === 'object')
	.map((link) => ({ label: String(link.label ?? '').trim(), url: safeExternal(link.url) }))
	.filter((link) => link.label && link.url);
const postUrl = (post) => href(`/posts/${encodeURIComponent(post.permalink)}/`);
const folderName = (id) => String(folders.get(String(id))?.name ?? id ?? 'Unfiled');
const metadataByPost = new Map();
const metadata = (post) => {
	if (metadataByPost.has(post)) return metadataByPost.get(post);
	const parts = [formatDate(post.sourceUpdatedAt)];
	if (post.folderId) parts.push(folderName(post.folderId));
	const value = parts.filter(Boolean).join(' · ');
	metadataByPost.set(post, value);
	return value;
};
const tagsFor = (post) =>
	(Array.isArray(post.tags) ? post.tags : [])
		.map((rawTag) => {
			const tag = String(rawTag);
			return `<a class="tag" href="${href(`/tags/${tagSegment(tag)}/`)}">#${esc(tag)}</a>`;
		})
		.join(' ');
const picture = (post, className = 'post-cover') => {
	const source = imageByPost.get(post.postId);
	return source ? `<img class="${className}" src="${esc(source)}" alt="" loading="lazy">` : '';
};

const folderChildren = new Map();
for (const [id, folder] of folders) {
	const parent =
		folder.parentFolderId && folders.has(String(folder.parentFolderId))
			? String(folder.parentFolderId)
			: '';
	const entries = folderChildren.get(parent) ?? [];
	entries.push({ id, folder });
	folderChildren.set(parent, entries);
}
for (const entries of folderChildren.values())
	entries.sort((a, b) =>
		String(a.folder.name).localeCompare(String(b.folder.name), site.locale || 'ko-KR')
	);

const navigationTree = () => {
	const rendered = new Set();
	const link = (post) => ({ label: String(post.title || 'Untitled'), href: postUrl(post) });
	const branch = ({ id, folder }) => {
		if (rendered.has(id)) return [];
		rendered.add(id);
		return [
			{
				label: String(folder.name ?? ''),
				children: [
					...(postsByFolder.get(id) ?? []).map(link),
					...(folderChildren.get(id) ?? []).flatMap(branch),
				],
			},
		];
	};
	const result = (folderChildren.get('') ?? []).flatMap(branch);
	for (const [id, folder] of folders) result.push(...branch({ id, folder }));
	const remaining = unfiledPosts.filter((post) => !folders.has(String(post.folderId ?? '')));
	if (remaining.length) result.push({ label: 'Articles', children: remaining.map(link) });
	return result;
};
const docsResourcePath = '__layall-docs-navigation.json';
write(
	docsResourcePath,
	JSON.stringify({
		format: 'layall-docs-navigation',
		version: 1,
		tree: navigationTree(),
	})
);

const topLinks = () => {
	const primary = [
		`<a href="${href('/')}">Home</a>`,
		`<a data-docs-link href="${href('/docs/')}">Docs</a>`,
		`<a href="${href('/search/')}">Search</a>`,
	];
	return [
		...primary,
		...externalLinks.map(
			(link) => `<a href="${esc(link.url)}" rel="me noopener">${esc(link.label)}</a>`
		),
	]
		.filter(Boolean)
		.join('');
};
const profileMarkup = () => {
	if (!author && !authorBio) return '';
	const name = profileUrl
		? `<a href="${esc(profileUrl)}" rel="me noopener">${esc(author)}</a>`
		: esc(author);
	return `<div class="profile"><p class="eyebrow">Author</p><h2>${name}</h2>${authorBio ? `<p>${esc(authorBio)}</p>` : ''}</div>`;
};
const docsNavigation = (activePost) => {
	const folderId = String(activePost?.folderId ?? '');
	const section = folders.has(folderId)
		? `<a href="${href(`/folders/${encodeURIComponent(folderId)}/`)}">${esc(folderName(folderId))}</a>`
		: '';
	return `<nav class="docs-nav" aria-label="문서 목차" data-docs-resource="${esc(href(`/${docsResourcePath}`))}"><div data-docs-fallback><a class="docs-overview" href="${href('/docs/')}">전체 가이드</a>${section}</div><div data-docs-tree></div><p data-docs-status role="status"></p></nav>`;
};

const styles = `
html:not([data-js=true]) [data-docs-toggle]{display:none}
.article-body{min-width:0;overflow-wrap:anywhere}.article-body img{max-width:100%;height:auto}.article-body .article-image{min-width:0;margin:1.25rem 0;padding:.5rem;border:1px solid var(--line);border-radius:12px;background:var(--surface);text-align:center}.article-image img{margin:auto;border-radius:7px}.article-image figcaption{margin-top:.4rem;color:var(--muted);font-size:.85em;overflow-wrap:anywhere}.image-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;margin:1.25rem 0;align-items:start}.article-body .image-gallery .article-image{margin:0}.attachment-missing{color:var(--muted)}.article-table{max-width:100%;overflow-x:auto;margin:1.5rem 0;border:1px solid var(--line);border-radius:12px;overscroll-behavior-x:contain}.article-table:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.article-table table{width:100%;border-collapse:collapse}.article-table th,.article-table td{min-width:8rem;padding:.65rem .8rem;border-right:1px solid var(--line);border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.article-table th{background:var(--surface-2);font-weight:700}.article-table tr>:last-child{border-right:0}.article-table tbody tr:last-child td{border-bottom:0}.article-table .align-left{text-align:left}.article-table .align-center{text-align:center}.article-table .align-right{text-align:right}
:root{--paper:#f7f3ea;--surface:#fffdf8;--surface-2:#eee7da;--ink:#292723;--muted:#716d65;--line:#ded6c7;--accent:#716690;--accent-soft:#e8e1f3;--shadow:0 18px 60px rgba(65,55,43,.09);--radius:22px;--content:1180px;color-scheme:light}
html[data-theme][data-color-mode=dark]{--paper:#1d1c1a;--surface:#272521;--surface-2:#33302a;--ink:#f2eee6;--muted:#bbb3a7;--line:#454139;--accent:#c8b9ec;--accent-soft:#3b344b;--shadow:0 18px 60px rgba(0,0,0,.28);color-scheme:dark}
@media(prefers-color-scheme:dark){html[data-theme][data-color-mode=system]{--paper:#1d1c1a;--surface:#272521;--surface-2:#33302a;--ink:#f2eee6;--muted:#bbb3a7;--line:#454139;--accent:#c8b9ec;--accent-soft:#3b344b;--shadow:0 18px 60px rgba(0,0,0,.28);color-scheme:dark}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration-color:color-mix(in srgb,var(--accent) 52%,transparent);text-underline-offset:.2em}a:hover{color:var(--accent)}img{display:block;max-width:100%}button,input{font:inherit}.skip-link{position:fixed;z-index:100;top:.75rem;left:.75rem;transform:translateY(-180%);padding:.65rem 1rem;border-radius:999px;background:var(--ink);color:var(--paper)}.skip-link:focus{transform:none}.site-header{position:sticky;z-index:30;top:0;border-bottom:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--paper) 88%,transparent);backdrop-filter:blur(18px)}.header-inner{position:relative;width:min(calc(100% - 2rem),var(--content));min-height:68px;margin:auto;display:flex;align-items:center;gap:1rem}.brand{min-width:0;overflow-wrap:anywhere;font-weight:800;letter-spacing:-.03em;text-decoration:none}.nav-toggle,.post-toc-toggle{display:none;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:.42rem .8rem;color:var(--ink);cursor:pointer}.nav-toggle{margin-left:auto}.header-actions{margin-left:auto;display:flex;align-items:center;gap:.45rem}.header-actions .nav-toggle{margin-left:0}.post-toc-toggle{position:relative;display:block;animation:toc-arrive .32s cubic-bezier(.2,.8,.2,1) both}.post-toc-toggle:hover,.post-toc-toggle[aria-expanded=true],.nav-toggle:hover,.nav-toggle[aria-expanded=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.post-toc-panel{position:absolute;z-index:50;top:calc(100% + .65rem);right:4.75rem;width:min(22rem,calc(100vw - 2rem));max-height:min(70vh,34rem);overflow:auto;padding:1rem;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-.55rem) scale(.98);transform-origin:top right;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}.post-toc-panel[data-open=true]{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition-delay:0s}.post-toc-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.55rem}.post-toc-head strong{font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.post-toc-close{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:50%;background:var(--surface-2);color:var(--ink);cursor:pointer}.post-toc-panel ol{list-style:none;margin:0;padding:0}.post-toc-panel a{display:block;padding:.4rem .55rem;border-radius:8px;text-decoration:none;font-size:.88rem;color:var(--muted)}.post-toc-panel a:hover,.post-toc-panel a:focus-visible,.post-toc-panel a[aria-current=location]{background:var(--accent-soft);color:var(--accent)}.post-toc-panel .toc-level-3 a{padding-left:1.25rem}.post-toc-panel .toc-level-4 a{padding-left:2rem}@keyframes toc-arrive{from{opacity:0;transform:translateX(.55rem) scale(.94)}to{opacity:1;transform:none}}body[data-post-page=true] .site-header .nav-toggle{display:block}body[data-post-page=true] .site-nav{position:absolute;top:calc(100% + .65rem);right:0;display:none;width:min(28rem,calc(100vw - 2rem));max-height:calc(100vh - 6rem);overflow:auto;flex-direction:column;align-items:stretch;padding:1rem;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}body[data-post-page=true] .site-nav[data-open=true]{display:flex}body[data-post-page=true] .appearance-controls{flex-wrap:wrap}.site-nav{margin-left:auto;display:flex;align-items:center;gap:1.1rem}.site-nav a{text-decoration:none;font-size:.9rem;font-weight:650}.color-controls{display:flex;border:1px solid var(--line);border-radius:999px;padding:3px}.color-controls button{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}.color-controls button:hover,.color-controls button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}main{width:min(calc(100% - 2rem),var(--content));margin:auto}.site-footer{width:min(calc(100% - 2rem),var(--content));margin:5rem auto 0;padding:2rem 0 3rem;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem;color:var(--muted);font-size:.9rem}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800;color:var(--accent)}.lead{font-size:clamp(1.05rem,2vw,1.28rem);color:var(--muted)}.muted,.post-meta{color:var(--muted);font-size:.88rem}.tag{display:inline-block;margin:.25rem .25rem 0 0;font-size:.8rem;text-decoration:none;color:var(--muted)}.empty{margin:4rem 0;padding:3rem;border:1px dashed var(--line);border-radius:var(--radius);text-align:center;color:var(--muted)}.post-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:calc(var(--radius) - 5px);background:var(--surface-2)}.page-heading{margin:4.5rem 0 2.5rem}.page-heading h1{margin:.2rem 0;font:700 clamp(2.2rem,6vw,4.8rem)/1.02 ui-serif,Georgia,serif;letter-spacing:-.055em}.page-heading p{max-width:48rem}.post-list{list-style:none;margin:0;padding:0}.post-list li{border-top:1px solid var(--line)}.post-list a{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding:1.2rem 0;text-decoration:none}.post-list strong{font-size:1.08rem}.post-list span{color:var(--muted);font-size:.85rem}.pagination{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:2.5rem 0}.pagination a{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:50%;text-decoration:none}.pagination a[aria-current=page]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.article-shell{display:grid;grid-template-columns:minmax(0,760px) minmax(180px,1fr);gap:4rem;align-items:start;padding-top:4rem}.article{min-width:0}.article-header{margin-bottom:2.5rem}.article-header h1{margin:.4rem 0 1rem;font:700 clamp(2.3rem,6vw,4.8rem)/1.03 ui-serif,Georgia,serif;letter-spacing:-.05em}.article-body{font-size:1.05rem}.article-body p{margin:1.25rem 0}.article-body h2,.article-body h3,.article-body h4{scroll-margin-top:6rem;margin:2.5rem 0 .75rem;line-height:1.25;letter-spacing:-.025em}.article-body h2{font-size:1.8rem}.article-body h3{font-size:1.35rem}.heading-anchor{margin-left:.45rem;text-decoration:none;opacity:0}.article-body :is(h2,h3,h4):hover .heading-anchor,.heading-anchor:focus{opacity:1}.article-body pre{overflow:auto;margin:1.5rem 0;padding:1.2rem;border:1px solid var(--line);border-radius:15px;background:#171816;color:#f4f1ea;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.article-body code{padding:.13em .36em;border-radius:6px;background:var(--surface-2);font:85% ui-monospace,SFMono-Regular,Menlo,monospace}.article-body pre code{padding:0;background:transparent;font:inherit}.article-body blockquote{margin:1.5rem 0;padding:.2rem 1.25rem;border-left:3px solid var(--accent);color:var(--muted)}.article-body hr{border:0;border-top:1px solid var(--line);margin:2.4rem 0}.article-body a{overflow-wrap:anywhere}.article-aside{position:sticky;top:100px}.article-aside h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.article-aside ol{padding-left:1.1rem}.article-aside a{display:block;padding:.25rem 0;font-size:.86rem;text-decoration:none;color:var(--muted)}
html[data-theme=layall]{--paper:#f6f4f0;--surface:#fffdf8;--surface-2:#e8f7fb;--ink:#354146;--muted:#566b72;--line:#d9e4e2;--accent:#386c78;--accent-soft:#dff2f6;--shadow:0 22px 58px rgba(69,88,93,.13);--radius:20px;--content:1180px;--layall-layer:linear-gradient(145deg,rgba(115,183,200,.26),rgba(255,248,206,.45))}html[data-theme=layall] body{background:radial-gradient(circle at 12% 2%,rgba(115,183,200,.24),transparent 30rem),radial-gradient(circle at 88% 18%,rgba(244,237,255,.72),transparent 25rem),var(--paper)}html[data-theme=layall] .site-header{background:color-mix(in srgb,var(--surface) 86%,transparent)}.layall-home{padding:clamp(1.5rem,5vw,4rem) 0 4rem}.layall-intro{position:relative;isolation:isolate;min-height:28rem;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(230px,.65fr);align-items:end;gap:clamp(2rem,5vw,5rem);overflow:hidden;padding:clamp(2rem,7vw,5.5rem);border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line));border-radius:calc(var(--radius) + 10px);background:linear-gradient(135deg,#e8f7fb 0%,#f5fcfc 48%,#f4edff 100%);box-shadow:var(--shadow)}.layall-intro::before,.layall-intro::after{content:"";position:absolute;z-index:-1;border-radius:38% 62% 58% 42%;background:var(--layall-layer)}.layall-intro::before{width:18rem;height:20rem;top:-8rem;right:10%}.layall-intro::after{width:14rem;height:16rem;bottom:-7rem;left:8%}.layall-intro-copy{min-width:0}.layall-intro h1{max-width:800px;margin:.35rem 0 1rem;font:730 clamp(2.1rem,5vw,4.8rem)/1.04 ui-serif,Georgia,serif;letter-spacing:-.055em;text-wrap:balance;overflow-wrap:anywhere}.layall-intro .lead{max-width:42rem;margin:0}.layall-author{align-self:end;padding:1.35rem;border:1px solid rgba(79,111,118,.14);border-radius:var(--radius);background:rgba(255,253,248,.72);backdrop-filter:blur(12px)}.layall-author:empty{display:none}.layall-author .profile h2{margin:.25rem 0;font:680 1.4rem/1.2 ui-serif,Georgia,serif}.layall-author .profile p:last-child{margin-bottom:0;color:var(--muted)}.layall-archive{position:relative;margin-top:1.25rem;padding:clamp(1.5rem,4vw,3.2rem);border:1px solid var(--line);border-radius:calc(var(--radius) + 4px);background:var(--surface);box-shadow:0 16px 42px rgba(69,88,93,.08)}.layall-archive-head{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin-bottom:1rem}.layall-archive-head h2{margin:.15rem 0;font:680 clamp(1.8rem,4vw,3rem)/1 ui-serif,Georgia,serif;letter-spacing:-.04em}.layall-archive .post-list li{border-color:var(--line)}.layall-archive .post-list a{border-radius:12px;padding:1.3rem .6rem}.layall-archive .post-list a:hover{background:linear-gradient(90deg,var(--accent-soft),transparent)}.theme-article-layall .article{padding:clamp(1.25rem,4vw,3.5rem);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:0 18px 50px rgba(69,88,93,.08)}html[data-theme=layall] .article-table{background:var(--surface)}html[data-theme=layall] .article-table th{background:#eef8f8}html[data-theme=layall][data-color-mode=dark]{--paper:#17262d;--surface:#21343b;--surface-2:#29434c;--ink:#edf6f5;--muted:#aec4c8;--line:#38535c;--accent:#8dd2de;--accent-soft:#294b55;--shadow:0 22px 58px rgba(0,0,0,.28);--layall-layer:linear-gradient(145deg,rgba(115,183,200,.16),rgba(76,99,104,.12))}html[data-theme=layall][data-color-mode=dark] body{background:radial-gradient(circle at 12% 2%,rgba(115,183,200,.16),transparent 30rem),radial-gradient(circle at 88% 18%,rgba(97,76,122,.16),transparent 25rem),var(--paper)}html[data-theme=layall][data-color-mode=dark] .layall-intro{background:linear-gradient(135deg,#223c45,#1b3038 55%,#292d42)}html[data-theme=layall][data-color-mode=dark] .layall-author{background:rgba(33,52,59,.78)}html[data-theme=layall][data-color-mode=dark] .article-table th{background:var(--surface-2)}.theme-article-layall .article-header h1{word-break:keep-all;overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){html[data-theme=layall][data-color-mode=system]{--paper:#17262d;--surface:#21343b;--surface-2:#29434c;--ink:#edf6f5;--muted:#aec4c8;--line:#38535c;--accent:#8dd2de;--accent-soft:#294b55;--shadow:0 22px 58px rgba(0,0,0,.28);--layall-layer:linear-gradient(145deg,rgba(115,183,200,.16),rgba(76,99,104,.12))}html[data-theme=layall][data-color-mode=system] body{background:radial-gradient(circle at 12% 2%,rgba(115,183,200,.16),transparent 30rem),radial-gradient(circle at 88% 18%,rgba(97,76,122,.16),transparent 25rem),var(--paper)}html[data-theme=layall][data-color-mode=system] .layall-intro{background:linear-gradient(135deg,#223c45,#1b3038 55%,#292d42)}html[data-theme=layall][data-color-mode=system] .layall-author{background:rgba(33,52,59,.78)}html[data-theme=layall][data-color-mode=system] .article-table th{background:var(--surface-2)}}
html[data-theme=blog]{--paper:#fffaf2;--surface:#fff;--surface-2:#f5e9db;--ink:#342923;--muted:#7b6b61;--line:#eadbcb;--accent:#a24f37;--accent-soft:#f4dfd4}.blog-home{padding-top:3.6rem}.blog-title{display:grid;grid-template-columns:1fr minmax(240px,.55fr);gap:2rem;align-items:end;margin-bottom:2rem}.blog-title h1{max-width:800px;margin:0;font:750 clamp(3rem,8vw,7.4rem)/.88 ui-serif,Georgia,serif;letter-spacing:-.07em}.blog-lead{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.8fr);gap:1.8rem;padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.blog-lead-content{display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(1rem,3vw,2.2rem)}.blog-lead h2{margin:.4rem 0;font:700 clamp(2rem,4vw,3.7rem)/1.04 ui-serif,Georgia,serif;letter-spacing:-.045em}.blog-lead a{text-decoration:none}.blog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2rem;margin:1.2rem 0 4rem}.blog-card{padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.blog-card h2{font:700 1.65rem/1.15 ui-serif,Georgia,serif}.blog-card a{text-decoration:none}.blog-archive{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:4rem}.blog-sidebar{position:sticky;top:100px}.blog-sidebar ul{list-style:none;padding:0}.blog-sidebar li{border-top:1px solid var(--line)}.blog-sidebar a{display:flex;justify-content:space-between;padding:.65rem 0;text-decoration:none}
html[data-theme=minimal]{--paper:#fff;--surface:#fff;--surface-2:#f5f5f3;--ink:#20201e;--muted:#74746e;--line:#e5e5e0;--accent:#20201e;--accent-soft:#efefeb;--content:760px}.minimal-home{padding-top:6rem}.minimal-masthead{padding-bottom:3.5rem;border-bottom:1px solid var(--line)}.minimal-masthead h1{margin:.3rem 0;font:650 clamp(2.5rem,8vw,5.6rem)/1 ui-serif,Georgia,serif;letter-spacing:-.055em}.minimal-profile{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:2rem}.minimal-list{list-style:none;padding:0}.minimal-list li{border-bottom:1px solid var(--line)}.minimal-list a{display:block;padding:1.45rem 0;text-decoration:none}.minimal-list h2{margin:0 0 .35rem;font:600 clamp(1.25rem,3vw,1.65rem)/1.3 ui-serif,Georgia,serif}.minimal-list p{margin:.45rem 0;color:var(--muted)}
html[data-theme=portfolio]{--paper:#f0efe9;--surface:#fbfaf6;--surface-2:#e4e1d8;--ink:#242522;--muted:#6d7068;--line:#d7d4ca;--accent:#556846;--accent-soft:#dce6d3;--radius:32px}.portfolio-home{padding-top:2rem}.portfolio-hero{min-height:62vh;display:grid;align-content:center;grid-template-columns:1.2fr .8fr;gap:3rem;padding:clamp(2rem,6vw,5rem);border-radius:42px;background:var(--surface);box-shadow:var(--shadow)}.portfolio-hero h1{margin:.2rem 0;font:750 clamp(3.2rem,9vw,8rem)/.86 ui-serif,Georgia,serif;letter-spacing:-.075em}.portfolio-hero .profile{align-self:end;padding:1.4rem;border-radius:25px;background:var(--accent-soft)}.showcase{padding:5rem 0}.showcase-header{display:flex;justify-content:space-between;align-items:end;margin-bottom:1.5rem}.showcase-header h2{margin:0;font:700 clamp(2rem,5vw,4rem)/1 ui-serif,Georgia,serif}.showcase-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:1.2rem}.showcase-card{grid-column:span 6;min-height:300px;display:flex;flex-direction:column;padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);text-decoration:none}.showcase-card:nth-child(3n+1){grid-column:span 7}.showcase-card:nth-child(3n+2){grid-column:span 5}.showcase-card .post-cover{aspect-ratio:16/8}.showcase-card-content{margin-top:auto;padding:1.2rem}.showcase-card h3{margin:.3rem 0;font:650 clamp(1.45rem,3vw,2.2rem)/1.12 ui-serif,Georgia,serif}.floating-nav{position:fixed;z-index:25;bottom:1.25rem;left:50%;transform:translateX(-50%);display:flex;gap:.25rem;padding:.4rem;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 90%,transparent);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.floating-nav a{padding:.55rem .95rem;border-radius:999px;text-decoration:none;font-size:.86rem}.floating-nav a:hover{background:var(--accent-soft)}html[data-theme=portfolio] .site-footer{padding-bottom:6rem}
html[data-theme=docs]{--paper:#fbfcfd;--surface:#fff;--surface-2:#f1f4f7;--ink:#1f2933;--muted:#68727e;--line:#e1e7ec;--accent:#3973a8;--accent-soft:#e5f1fb;--content:1380px}.docs-home{padding:2.5rem 0}.docs-intro{min-height:56vh;display:grid;align-content:center;justify-items:center;text-align:center;padding:5rem 1rem}.docs-intro h1{max-width:950px;margin:.35rem 0;font:750 clamp(3rem,8vw,7rem)/.92 ui-serif,Georgia,serif;letter-spacing:-.065em}.docs-intro p{max-width:680px}.primary-link{display:inline-flex;margin-top:1.3rem;padding:.75rem 1.1rem;border-radius:12px;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:750}.guide-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.guide-card{display:block;min-height:180px;padding:1.5rem;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-decoration:none}.guide-card h2{margin:.2rem 0 .7rem}.docs-layout{width:min(calc(100% - 2rem),var(--content));margin:auto;display:grid;grid-template-columns:240px minmax(0,760px) minmax(180px,1fr);gap:3rem;align-items:start}.docs-sidebar-wrap{position:sticky;top:92px}.docs-sidebar{max-height:calc(100vh - 110px);overflow:auto;padding:1rem 0}.docs-nav ul{list-style:none;padding:0;margin:.25rem 0 1rem}.docs-nav h3,.docs-nav span{display:block;margin:1.2rem 0 .3rem;font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.docs-nav a{display:block;padding:.32rem .6rem;border-radius:7px;text-decoration:none;font-size:.88rem;color:var(--muted)}.docs-nav a:hover,.docs-nav a[aria-current=page]{background:var(--accent-soft);color:var(--accent)}.docs-overview{font-weight:750;color:var(--ink)!important}.docs-content{min-width:0;padding-top:3.7rem}.docs-content .article-header h1{font-family:ui-sans-serif,system-ui,sans-serif;font-size:clamp(2.3rem,5vw,4.2rem)}.docs-toc{position:sticky;top:100px;padding-top:3.7rem}.docs-toc h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.docs-toc ol{list-style:none;padding:0}.docs-toc a{display:block;padding:.3rem 0;text-decoration:none;font-size:.82rem;color:var(--muted)}.docs-index{padding:4rem 0}.docs-index h1{font-size:clamp(2.5rem,6vw,5rem);letter-spacing:-.055em}.docs-section{margin:3rem 0}.docs-section-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.docs-section-list a{padding:1rem;border:1px solid var(--line);border-radius:12px;background:var(--surface);text-decoration:none}
.search-shell{padding:4rem 0}.search-shell h1{font:700 clamp(2.5rem,6vw,5rem)/1 ui-serif,Georgia,serif}.search-form{display:flex;gap:.6rem;max-width:700px}.search-form input{min-width:0;flex:1;padding:.8rem 1rem;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink)}.search-form button{border:0;border-radius:999px;padding:.8rem 1.1rem;background:var(--ink);color:var(--paper);cursor:pointer}.search-results{margin-top:2rem}
@media(max-width:900px){.article-shell,.blog-archive,.docs-layout{grid-template-columns:1fr}.article-aside,.blog-sidebar,.docs-toc,.docs-sidebar-wrap{position:static}.docs-sidebar{max-height:none}html[data-js=true] .docs-sidebar:not([data-open=true]){display:none}.docs-sidebar-wrap>.nav-toggle{display:block}.docs-sidebar[data-open=true]{display:block}.layall-intro,.blog-title,.blog-lead,.portfolio-hero{grid-template-columns:1fr}.layall-intro{min-height:auto}.guide-grid{grid-template-columns:1fr 1fr}.showcase-card,.showcase-card:nth-child(n){grid-column:span 12}.portfolio-hero{min-height:auto;margin-top:1rem}.blog-lead .post-cover{order:-1}}
@media(max-width:680px){body{font-size:15px}.header-inner{min-height:60px;gap:.55rem}.nav-toggle{display:block}.site-nav,body[data-post-page=true] .site-nav{position:absolute;top:calc(100% + 1px);left:0;right:0;width:auto;display:none;flex-direction:column;align-items:stretch;padding:1rem;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}.site-nav[data-open=true],body[data-post-page=true] .site-nav[data-open=true]{display:flex}.post-toc-panel{left:0;right:0;width:auto;transform-origin:top center}.color-controls{align-self:flex-start}.blog-home{padding-top:2.2rem}.blog-title{display:block}.blog-grid,.guide-grid,.minimal-profile{grid-template-columns:1fr}.article-shell{padding-top:2.5rem}.site-footer{flex-direction:column}.portfolio-hero{padding:2rem 1.4rem;border-radius:28px}.floating-nav{max-width:calc(100% - 1rem);overflow:auto}.docs-intro{min-height:auto;padding:5rem .5rem}.docs-section-list{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.post-toc-toggle{animation:none}.post-toc-panel{transition:none}}
select{font:inherit}[data-docs-link]{display:none}html[data-theme=docs] [data-docs-link]{display:inline}.appearance-controls{display:flex;align-items:center;gap:.45rem}.theme-control{display:flex;align-items:center;gap:.35rem;color:var(--muted);font-size:.78rem}.theme-control select{max-width:8.5rem;border:1px solid var(--line);border-radius:999px;padding:.38rem 1.8rem .38rem .7rem;background:var(--surface);color:var(--ink);cursor:pointer}.floating-nav{display:none}html[data-theme=portfolio] .floating-nav{display:flex}.theme-article-minimal{display:block;max-width:760px}.theme-article-blog .article{padding:clamp(1.2rem,4vw,3.5rem);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.theme-article-portfolio{grid-template-columns:220px minmax(0,820px)}.theme-article-portfolio .article{order:2;padding:clamp(1.2rem,4vw,3rem);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.theme-article-portfolio .article-aside{order:1}@media(max-width:900px){.appearance-controls{flex-wrap:wrap}.theme-article-portfolio{grid-template-columns:1fr}.theme-article-portfolio .article,.theme-article-portfolio .article-aside{order:initial}}@media(max-width:680px){.appearance-controls{align-items:flex-start;flex-direction:column}.theme-control select{min-height:36px}.color-controls{align-self:auto}}
`;

const behavior = `<script>(()=>{
const root=document.documentElement;
root.dataset.js='true';
const colorModes=new Set(['light','dark','system']);
const layoutThemes=new Set(${js(themeOrder)});
const authorTheme=${js(theme)};
const layoutKey=${js(layoutStorageKey)};
const mount=document.querySelector('[data-theme-view]');
const pool=document.querySelector('[data-theme-pool]');
let pageGeneration=0;
const boundDocsToggles=new WeakSet();
const readStored=(key)=>{try{return localStorage.getItem(key)||''}catch{return ''}};
const writeStored=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
const syncColor=()=>document.querySelectorAll('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===root.dataset.colorMode)));
const syncLayout=()=>document.querySelectorAll('[data-layout-theme]').forEach(select=>select.value=root.dataset.theme);
let docsRequest;
const loadingDocs=new WeakSet();
const loadedDocs=new WeakSet();
const docsResource=${js(href(`/${docsResourcePath}`))};
const postPrefix=${js(`${basePath}/posts/`)};
const requestDocs=(descriptor)=>{
 const url=new URL(descriptor,location.href);
 if(url.origin!==location.origin||url.pathname!==docsResource||url.search||url.hash||url.username||url.password)throw new Error('Invalid navigation resource');
 if(!docsRequest){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  docsRequest=fetch(url.href,{mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-cache',signal:controller.signal})
   .then(async response=>{if(!response.ok||response.url!==url.href)throw new Error('Navigation unavailable');const text=await response.text();if(text.length>8*1024*1024)throw new Error('Navigation too large');const data=JSON.parse(text);if(data.format!=='layall-docs-navigation'||data.version!==1||!Array.isArray(data.tree))throw new Error('Invalid navigation');return data.tree})
   .catch(error=>{docsRequest=null;throw error}).finally(()=>clearTimeout(timeout));
 }
 return docsRequest;
};
const docsTree=(entries)=>{
 let count=0;
 const paths=new Set();
 const current=location.pathname.endsWith('/index.html')?location.pathname.slice(0,-10):location.pathname;
 const branch=(nodes,depth=0)=>{
  if(!Array.isArray(nodes)||depth>128)throw new Error('Invalid navigation');
  const list=document.createElement('ul');
  for(const node of nodes){
   if(!node||typeof node.label!=='string'||++count>50000)throw new Error('Invalid navigation');
   const li=document.createElement('li');
   if(typeof node.href==='string'){
    const url=new URL(node.href,location.href);
    const segment=url.pathname.slice(postPrefix.length);
    if(url.origin!==location.origin||!url.pathname.startsWith(postPrefix)||!segment.endsWith('/')||!/^[a-z0-9][a-z0-9-]{0,127}$/.test(segment.slice(0,-1))||url.search||url.hash||url.username||url.password||paths.has(url.pathname)||node.children!==undefined)throw new Error('Invalid navigation link');
    paths.add(url.pathname);
    const link=document.createElement('a');link.href=url.pathname;link.textContent=node.label;
    if(url.pathname===current)link.setAttribute('aria-current','page');
    li.append(link);
   }else{
    const label=document.createElement('span');label.textContent=node.label;li.append(label,branch(node.children,depth+1));
   }
   list.append(li);
  }
  return list;
 };
 return branch(entries);
};
const loadDocs=async(nav)=>{
 if(!nav||loadingDocs.has(nav)||loadedDocs.has(nav))return;
 const tree=nav.querySelector('[data-docs-tree]');const status=nav.querySelector('[data-docs-status]');
 if(!tree||!status)return;
 loadingDocs.add(nav);tree.setAttribute('aria-busy','true');
 try{
  const entries=await requestDocs(nav.dataset.docsResource);
  if(!nav.isConnected||!mount.contains(nav))return;
  tree.replaceChildren(docsTree(entries));loadedDocs.add(nav);status.textContent='';
 }catch{docsRequest=null;status.textContent='문서 메뉴를 불러오지 못했습니다. 전체 가이드에서 글을 확인하세요.'}
 finally{tree.removeAttribute('aria-busy');loadingDocs.delete(nav)}
};
const closeDocs=()=>{const docs=mount?.querySelector('[data-docs-sidebar]');const toggle=mount?.querySelector('[data-docs-toggle]');if(!docs||!toggle)return;const restore=docs.dataset.open==='true'&&docs.contains(document.activeElement);docs.dataset.open='false';toggle.setAttribute('aria-expanded','false');if(restore&&toggle.getClientRects().length)toggle.focus()};
const bindDocs=()=>{
 const toggle=mount?.querySelector('[data-docs-toggle]');const docs=mount?.querySelector('[data-docs-sidebar]');
 if(!toggle||!docs)return;
 docs.id='docs-sidebar';toggle.setAttribute('aria-controls',docs.id);
 if(!boundDocsToggles.has(toggle)){
  boundDocsToggles.add(toggle);
  toggle.addEventListener('click',()=>{const open=docs.dataset.open!=='true';docs.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open));if(open)loadDocs(docs.querySelector('[data-docs-resource]'))});
 }
 if(root.dataset.theme==='docs')loadDocs(docs.querySelector('[data-docs-resource]'));
};
const bindSearch=(preservedQuery='')=>{
 const generation=++pageGeneration;
 const form=document.querySelector('[data-search-form]');const input=document.querySelector('[data-search-input]');const results=document.querySelector('[data-search-results]');const status=document.querySelector('[data-search-status]');
 if(!form||!input||!results||!status)return;
 const run=async(syncUrl=false)=>{const query=input.value.trim().toLocaleLowerCase();const entries=await fetch(${js(href('/search.json'))}).then(response=>response.json());if(generation!==pageGeneration||input.isConnected===false)return;const found=query?entries.filter(entry=>[entry.title,entry.body,entry.folder,...entry.tags].join(' ').toLocaleLowerCase().includes(query)):entries;results.replaceChildren(...found.map(entry=>{const li=document.createElement('li');const a=document.createElement('a');const strong=document.createElement('strong');const span=document.createElement('span');const target=${js(`${basePath}/posts/`)}+encodeURIComponent(entry.permalink)+'/';a.href=target;a.setAttribute('href',target);strong.textContent=entry.title;span.textContent=[entry.folder,...entry.tags.map(tag=>'#'+tag)].filter(Boolean).join(' · ');a.append(strong,span);li.append(a);return li}));status.textContent=found.length+'개 결과';if(syncUrl){const url=new URL(location.href);query?url.searchParams.set('q',input.value.trim()):url.searchParams.delete('q');history.replaceState(null,'',url)}};
 form.addEventListener('submit',event=>{event.preventDefault();run(true).catch(()=>status.textContent='검색 색인을 불러오지 못했습니다.')});
 input.value=preservedQuery||new URL(location.href).searchParams.get('q')||'';
 run().catch(()=>status.textContent='검색 색인을 불러오지 못했습니다.');
};
const bindPage=(query='')=>{bindDocs();bindSearch(query)};
const activate=(next)=>{if(!layoutThemes.has(next)||!mount)return;const template=document.querySelector('template[data-theme-layout="'+next+'"]');if(!template)return;const query=document.querySelector('[data-search-input]')?.value||'';pageGeneration+=1;const fragment=template.content.cloneNode(true);fragment.querySelectorAll('[data-layout-id]').forEach(node=>{node.id=node.dataset.layoutId;node.removeAttribute('data-layout-id')});const retained=new Map([...document.querySelectorAll('[data-theme-piece]')].map(node=>[node.dataset.themePiece,node]));const used=new Set();fragment.querySelectorAll('[data-theme-slot]').forEach(target=>{const piece=retained.get(target.dataset.themeSlot);if(piece){used.add(target.dataset.themeSlot);target.replaceWith(piece)}});if(pool)pool.replaceChildren(...[...retained].filter(([name])=>!used.has(name)).map(([,node])=>node));root.dataset.theme=next;root.dataset.layallTheme=next;mount.replaceChildren(fragment);syncLayout();bindPage(query)};
const savedColor=readStored('layall-color-mode');if(colorModes.has(savedColor))root.dataset.colorMode=savedColor;syncColor();
document.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.color;if(!colorModes.has(mode))return;root.dataset.colorMode=mode;writeStored('layall-color-mode',mode);syncColor()}));
document.querySelectorAll('[data-layout-theme]').forEach(select=>select.addEventListener('change',()=>{const next=select.value;if(!layoutThemes.has(next)){syncLayout();return}activate(next);writeStored(layoutKey,next)}));
const navToggle=document.querySelector('[data-nav-toggle]');const nav=document.querySelector('[data-nav]');navToggle?.addEventListener('click',()=>{const open=nav.dataset.open!=='true';nav.dataset.open=String(open);navToggle.setAttribute('aria-expanded',String(open))});
const tocToggle=document.querySelector('[data-post-toc-toggle]');const tocPanel=document.querySelector('[data-post-toc-panel]');const tocClose=document.querySelector('[data-post-toc-close]');
const closeNav=(restore=false)=>{if(nav?.dataset.open!=='true')return;nav.dataset.open='false';navToggle?.setAttribute('aria-expanded','false');if(restore)navToggle?.focus()};
const closeToc=(restore=false)=>{if(tocPanel?.dataset.open!=='true')return;const hadFocus=tocPanel.contains(document.activeElement);tocPanel.dataset.open='false';tocPanel.setAttribute('aria-hidden','true');tocToggle?.setAttribute('aria-expanded','false');if(restore||hadFocus)tocToggle?.focus({preventScroll:true})};
navToggle?.addEventListener('click',()=>{if(nav?.dataset.open==='true')closeToc()});
tocToggle?.addEventListener('click',()=>{const open=tocPanel?.dataset.open!=='true';closeNav();if(!tocPanel)return;tocPanel.dataset.open=String(open);tocPanel.setAttribute('aria-hidden',String(!open));tocToggle.setAttribute('aria-expanded',String(open));if(open)(tocPanel.querySelector('a')||tocPanel).focus()});
tocClose?.addEventListener('click',()=>closeToc(true));
tocPanel?.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{tocPanel.querySelectorAll('[aria-current="location"]').forEach(active=>active.removeAttribute('aria-current'));link.setAttribute('aria-current','location');closeToc();const heading=document.getElementById(decodeURIComponent(link.hash.slice(1)));if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true})}}));
document.addEventListener('click',event=>{if(tocPanel?.dataset.open==='true'&&!tocPanel.contains(event.target)&&!tocToggle?.contains(event.target))closeToc();if(nav?.dataset.open==='true'&&!nav.contains(event.target)&&!navToggle?.contains(event.target))closeNav()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const tocWasOpen=tocPanel?.dataset.open==='true';const navWasOpen=nav?.dataset.open==='true';closeToc(tocWasOpen);closeNav(!tocWasOpen&&navWasOpen);closeDocs()}if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){const input=document.querySelector('[data-search-input]');if(input){event.preventDefault();input.focus()}}});
const remembered=readStored(layoutKey);if(layoutThemes.has(remembered)&&remembered!==authorTheme)activate(remembered);else{root.dataset.theme=authorTheme;root.dataset.layallTheme=authorTheme;syncLayout();bindPage()}
})()</script>`;

const shell = (title, body, options = {}) => {
	const description = options.description ?? siteDescription;
	const socialImage = safeSocialImage(options.image);
	const socialImageAlt =
		socialImage && String(options.imageAlt ?? '').trim() ? String(options.imageAlt) : '';
	const socialMetadata = options.article
		? `<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(options.url)}">${socialImage ? `<meta property="og:image" content="${esc(socialImage)}">${socialImageAlt ? `<meta property="og:image:alt" content="${esc(socialImageAlt)}">` : ''}` : ''}<meta name="twitter:card" content="${socialImage ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">${socialImage ? `<meta name="twitter:image" content="${esc(socialImage)}">${socialImageAlt ? `<meta name="twitter:image:alt" content="${esc(socialImageAlt)}">` : ''}` : ''}`
		: '';
	const nav = topLinks();
	const variants = options.variants ?? Object.fromEntries(themeOrder.map((name) => [name, body]));
	const pieces = Object.entries(options.pieces ?? {});
	const slot = (name) => `<span data-theme-slot="${name}"></span>`;
	const assemble = (markup) =>
		pieces.reduce((result, [name, piece]) => result.replace(slot(name), piece), markup);
	const activeVariant = variants[theme] ?? body;
	const activeBody = assemble(activeVariant);
	const pool = pieces
		.filter(([name]) => !activeVariant.includes(slot(name)))
		.map(([, piece]) => piece)
		.join('');
	const templates = themeOrder
		.map((name) => {
			const inertBody = (variants[name] ?? body).replace(
				/ id="([^"]+)"/g,
				' data-layout-id="$1"'
			);
			return `<template data-theme-layout="${name}">${inertBody}</template>`;
		})
		.join('');
	const layoutOptions = themeOrder
		.map(
			(name) =>
				`<option value="${name}"${name === theme ? ' selected' : ''}>${name === 'layall' ? 'LayAll' : name[0].toUpperCase() + name.slice(1)}</option>`
		)
		.join('');
	const postToc = options.postToc
		? `<div class="header-actions"><button class="post-toc-toggle" type="button" data-post-toc-toggle aria-expanded="false" aria-controls="post-table-of-contents">TOC</button><button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button></div><aside class="post-toc-panel" id="post-table-of-contents" data-post-toc-panel data-open="false" aria-hidden="true" tabindex="-1"><div class="post-toc-head"><strong>On this page</strong><button class="post-toc-close" type="button" data-post-toc-close aria-label="목차 닫기">×</button></div><nav aria-label="현재 글 목차">${options.postToc}</nav></aside>`
		: '<button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button>';
	return `<!doctype html><html lang="${esc(site.locale || 'ko-KR')}" data-layall-theme="${esc(theme)}" data-theme="${esc(theme)}" data-author-theme="${esc(theme)}" data-color-mode="${esc(site.colorMode || 'system')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}">${socialMetadata}<title>${esc(title)}${title === siteTitle ? '' : ` · ${esc(siteTitle)}`}</title><style>${styles}</style></head><body data-page-kind="${esc(options.kind || 'page')}"${options.postToc ? ' data-post-page="true"' : ''}><a class="skip-link" href="#content">본문으로 건너뛰기</a><header class="site-header"><div class="header-inner"><a class="brand" href="${href('/')}">${esc(siteTitle)}</a>${postToc}<nav class="site-nav" id="site-navigation" data-nav>${nav}<span class="appearance-controls"><label class="theme-control">Layout<select data-layout-theme aria-label="Layout theme">${layoutOptions}</select></label><span class="color-controls" aria-label="화면 테마"><button type="button" data-color="light" aria-label="라이트 모드">☀</button><button type="button" data-color="dark" aria-label="다크 모드">☾</button><button type="button" data-color="system" aria-label="시스템 모드">◐</button></span></span></nav></div></header><div data-theme-view>${activeBody}</div><noscript><nav class="docs-nav" aria-label="문서 안내"><a href="${href('/docs/')}">전체 가이드</a></nav></noscript><div data-theme-pool hidden>${pool}</div><footer class="site-footer"><span>${esc(siteTitle)}</span><span>${esc(site.authorName || author)}</span></footer><nav class="floating-nav" aria-label="빠른 탐색"><a href="${href('/')}">Home</a><a href="${href('/#work')}">Writing</a><a href="${href('/search/')}">Search</a></nav>${templates}${behavior}</body></html>`;
};

const compactList = (items) => {
	if (!items.length) return '<div class="empty">아직 공개된 글이 없습니다.</div>';
	return `<ul class="post-list">${items.map((post) => `<li><a href="${postUrl(post)}"><strong>${esc(post.title || 'Untitled')}</strong><span>${esc(metadata(post))}</span></a></li>`).join('')}</ul>`;
};
const blogCard = (post) =>
	`<article class="blog-card">${picture(post)}<div class="post-meta">${esc(metadata(post))}</div><h2><a href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a></h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 130))}</p>` : ''}${tagsFor(post)}</article>`;
const portfolioCard = (post) =>
	`<a class="showcase-card" href="${postUrl(post)}">${picture(post)}<div class="showcase-card-content"><span class="post-meta">${esc(metadata(post))}</span><h3>${esc(post.title || 'Untitled')}</h3>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 120))}</p>` : ''}</div></a>`;

const layallHome = (items) =>
	`<main id="content" class="layall-home"><section class="layall-intro"><div class="layall-intro-copy"><p class="eyebrow">LayAll archive</p><h1>${esc(siteTitle).replace(/\./g, '.<wbr>')}</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}</div>${author || authorBio ? `<div class="layall-author">${profileMarkup()}</div>` : ''}</section><section class="layall-archive" aria-labelledby="layall-archive-title"><header class="layall-archive-head"><div><p class="eyebrow">Published records</p><h2 id="layall-archive-title">기록 모음</h2></div>${items.length ? `<span class="muted">${items.length}개의 글</span>` : ''}</header>${compactList(items)}</section></main>`;
const blogHome = (items) => {
	const [lead, ...rest] = items;
	const categories = [...folders.entries()]
		.map(
			([id, folder]) =>
				`<li><a href="${href(`/folders/${encodeURIComponent(id)}/`)}"><span>${esc(folder.name)}</span><span>${postsByFolder.get(id)?.length ?? 0}</span></a></li>`
		)
		.join('');
	return `<main id="content" class="blog-home"><section class="blog-title"><h1>${esc(siteTitle)}</h1><div>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}${profileMarkup()}</div></section>${lead ? `<article class="blog-lead">${picture(lead)}<div class="blog-lead-content"><span class="post-meta">${esc(metadata(lead))}</span><h2><a href="${postUrl(lead)}">${esc(lead.title || 'Untitled')}</a></h2>${excerpt(lead.body) ? `<p>${esc(excerpt(lead.body, 220))}</p>` : ''}${tagsFor(lead)}</div></article>` : '<div class="empty">아직 공개된 글이 없습니다.</div>'}<section class="blog-grid">${rest.slice(0, 4).map(blogCard).join('')}</section><section class="blog-archive"><div><p class="eyebrow">Archive</p><h2>All stories</h2>${compactList(rest.slice(4))}</div>${categories ? `<aside class="blog-sidebar"><p class="eyebrow">Categories</p><ul>${categories}</ul></aside>` : ''}</section></main>`;
};
const minimalHome = (items) =>
	`<main id="content" class="minimal-home"><section class="minimal-masthead"><p class="eyebrow">Notes & essays</p><h1>${esc(siteTitle)}</h1><div class="minimal-profile">${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : '<span></span>'}${profileMarkup()}</div></section><ul class="minimal-list">${items.map((post) => `<li><a href="${postUrl(post)}"><span class="post-meta">${esc(metadata(post))}</span><h2>${esc(post.title || 'Untitled')}</h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 150))}</p>` : ''}</a></li>`).join('')}</ul>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}</main>`;
const portfolioHome = (items) => {
	const groups = new Map();
	for (const post of items) {
		const id = String(post.folderId ?? 'home');
		const group = groups.get(id) ?? [];
		group.push(post);
		groups.set(id, group);
	}
	const sections = [...groups.entries()]
		.map(
			([id, group], index) =>
				`<section class="showcase"${index === 0 ? ' id="work"' : ''}><div class="showcase-header"><div><p class="eyebrow">${id === 'home' ? 'Archive' : 'Collection'}</p><h2>${esc(id === 'home' ? siteTitle : folderName(id))}</h2></div><span class="muted">${group.length} article${group.length === 1 ? '' : 's'}</span></div><div class="showcase-grid">${group.map(portfolioCard).join('')}</div></section>`
		)
		.join('');
	return `<main id="content" class="portfolio-home"><section class="portfolio-hero"><div><p class="eyebrow">Selected writing</p><h1>${esc(author || siteTitle)}</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}</div>${profileMarkup()}</section>${sections || '<section class="showcase" id="work"><div class="empty">아직 공개된 글이 없습니다.</div></section>'}</main>`;
};
const docsHome = (items) => {
	const first = items[0];
	const cards = [...folders.entries()]
		.map(([id, folder]) => {
			const firstInFolder = items.find((post) => String(post.folderId ?? '') === id);
			return `<a class="guide-card" href="${firstInFolder ? postUrl(firstInFolder) : href(`/folders/${encodeURIComponent(id)}/`)}"><p class="eyebrow">Guide</p><h2>${esc(folder.name)}</h2><p>${firstInFolder ? esc(excerpt(firstInFolder.body, 110)) : '이 섹션의 문서를 살펴보세요.'}</p></a>`;
		})
		.join('');
	return `<main id="content" class="docs-home"><section class="docs-intro"><p class="eyebrow">Documentation</p><h1>${esc(siteTitle)}</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}<a class="primary-link" href="${first ? postUrl(first) : href('/docs/')}">${first ? 'Start reading' : 'View guides'}</a></section><section><div class="showcase-header"><div><p class="eyebrow">Learn</p><h2>Guides</h2></div><a href="${href('/docs/')}">전체 문서 보기 →</a></div><div class="guide-grid">${
		cards ||
		items
			.slice(0, 6)
			.map(
				(post) =>
					`<a class="guide-card" href="${postUrl(post)}"><p class="eyebrow">Article</p><h2>${esc(post.title || 'Untitled')}</h2><p>${esc(excerpt(post.body, 110))}</p></a>`
			)
			.join('')
	}</div>${items.length ? '' : '<div class="empty">아직 공개된 문서가 없습니다.</div>'}</section></main>`;
};
const renderHome = (items, selectedTheme = theme) =>
	({
		layall: layallHome,
		blog: blogHome,
		minimal: minimalHome,
		portfolio: portfolioHome,
		docs: docsHome,
	})[selectedTheme](items);
const variantsOf = (renderer) =>
	Object.fromEntries(themeOrder.map((name) => [name, renderer(name)]));

const toc = (headings) => {
	const visible = headings.filter((heading) => heading.level >= 2 && heading.level <= 4);
	return visible.length
		? `<ol>${visible.map((heading) => `<li class="toc-level-${heading.level}"><a href="#${esc(heading.id)}">${esc(heading.label)}</a></li>`).join('')}</ol>`
		: '<p class="muted">이 문서에는 세부 목차가 없습니다.</p>';
};
const articleContent = (post, rendered) =>
	`<article class="article" data-theme-piece="article" data-post-id="${esc(post.postId)}"><header class="article-header"><p class="post-meta">${esc(metadata(post))}</p><h1>${esc(post.title || 'Untitled')}</h1>${tagsFor(post)}</header><div class="article-body">${rendered.html}</div>${site.giscusEnabled ? '<section data-giscus-enabled="true" aria-label="Comments"></section>' : ''}</article>`;
const articleToc = (rendered) =>
	`<aside class="article-aside" data-theme-piece="toc" aria-label="글 목차"><h2>On this page</h2>${toc(rendered.headings)}</aside>`;
const articleSlot = '<span data-theme-slot="article"></span>';
const tocSlot = '<span data-theme-slot="toc"></span>';
const docsNavigationSlot = '<span data-theme-slot="docs-navigation"></span>';
const standardArticle = (selectedTheme) => {
	if (selectedTheme === 'minimal')
		return `<main id="content" class="article-shell theme-article-minimal">${articleSlot}${tocSlot}</main>`;
	if (selectedTheme === 'portfolio')
		return `<main id="content" class="article-shell theme-article-portfolio">${tocSlot}${articleSlot}</main>`;
	return `<main id="content" class="article-shell theme-article-${selectedTheme}">${articleSlot}${tocSlot}</main>`;
};
const docsArticle = () =>
	`<div class="docs-layout">${docsNavigationSlot}<main id="content" class="docs-content">${articleSlot}</main><div class="docs-toc">${tocSlot}</div></div>`;

for (const post of posts) {
	const route = postInputs[post.postId].cacheableOutputs[0].path;
	const cached = cachedPostHtml(post);
	if (cached) {
		cacheMetrics.hits += 1;
		write(route, cached, post.postId);
		continue;
	}
	cacheMetrics.misses += 1;
	const renderStarted = performance.now();
	const renderCpuStarted = process.cpuUsage();
	const rendered = renderMarkdown(post.body, assetsByPost.get(post.postId));
	const variants = variantsOf((name) =>
		name === 'docs' ? docsArticle() : standardArticle(name)
	);
	const pieces = {
		article: articleContent(post, rendered),
		toc: articleToc(rendered),
		'docs-navigation': `<div class="docs-sidebar-wrap" data-theme-piece="docs-navigation"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation(post)}</aside></div>`,
	};
	const html = shell(post.title || 'Untitled', variants[theme], {
		kind: theme === 'docs' ? 'docs-article' : 'article',
		article: true,
		description: excerpt(post.body, 160),
		url: absolute(`/posts/${encodeURIComponent(post.permalink)}/`),
		image: rendered.firstImage?.url,
		imageAlt: rendered.firstImage?.alt,
		variants,
		pieces,
		postToc: toc(rendered.headings),
	});
	cacheMetrics.renderWallMs += performance.now() - renderStarted;
	cacheMetrics.renderCpuMs += cpuMs(renderCpuStarted);
	write(route, html, post.postId);
}

const PAGE_SIZE = 10;
const paginationFor = (prefix, index, pages) => {
	if (pages <= 1) return '';
	const url = (page) => href(`/${prefix}${page ? `page/${page + 1}/` : ''}`);
	const visible = [...new Set([0, pages - 1, index - 1, index, index + 1])]
		.filter((page) => page >= 0 && page < pages)
		.sort((a, b) => a - b);
	const links = visible
		.map(
			(page, position) =>
				`${position && page > visible[position - 1] + 1 ? '<span aria-hidden="true">…</span>' : ''}<a${page === index ? ' aria-current="page"' : ''} aria-label="${page + 1} 페이지" href="${url(page)}">${page + 1}</a>`
		)
		.join('');
	return `<nav class="pagination" aria-label="페이지">${index ? `<a rel="prev" aria-label="이전 페이지" href="${url(index - 1)}">←</a>` : ''}${links}${index + 1 < pages ? `<a rel="next" aria-label="다음 페이지" href="${url(index + 1)}">→</a>` : ''}</nav>`;
};
const collectionBody = (selectedTheme, title, items, pagination, kind) => {
	const heading = `<header class="page-heading"><p class="eyebrow">${esc(kind)}</p><h1>${esc(title)}</h1></header>`;
	if (selectedTheme === 'blog')
		return `<main id="content" class="blog-home">${heading}<section class="blog-grid">${items.map(blogCard).join('')}</section>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</main>`;
	if (selectedTheme === 'minimal')
		return `<main id="content" class="minimal-home">${heading}<ul class="minimal-list">${items.map((post) => `<li><a href="${postUrl(post)}"><span class="post-meta">${esc(metadata(post))}</span><h2>${esc(post.title || 'Untitled')}</h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 150))}</p>` : ''}</a></li>`).join('')}</ul>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</main>`;
	if (selectedTheme === 'portfolio')
		return `<main id="content" class="portfolio-home"><section class="showcase" id="work">${heading}<div class="showcase-grid">${items.map(portfolioCard).join('')}</div>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</section></main>`;
	if (selectedTheme === 'docs')
		return `<div class="docs-layout"><div class="docs-sidebar-wrap"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="docs-index">${heading}${compactList(items)}${pagination}</main><aside></aside></div>`;
	return `<main id="content">${heading}${compactList(items)}${pagination}</main>`;
};
const collection = (prefix, title, items, kind = 'collection') => {
	const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
	for (let index = 0; index < pages; index += 1) {
		const file = index === 0 ? `${prefix}index.html` : `${prefix}page/${index + 1}/index.html`;
		const pagination = paginationFor(prefix, index, pages);
		const pageItems = items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
		const variants = variantsOf((name) =>
			prefix === '' && index === 0
				? renderHome(pageItems, name).replace(/<\/main>$/, `${pagination}</main>`)
				: collectionBody(name, title, pageItems, pagination, kind)
		);
		write(
			file,
			shell(title, variants[theme], {
				kind: prefix === '' ? 'home' : kind,
				variants,
			})
		);
	}
};

collection('', siteTitle, posts);
const groupedFolders = new Map();
for (const post of posts) {
	const id = String(post.folderId ?? 'home');
	const items = groupedFolders.get(id) ?? [];
	items.push(post);
	groupedFolders.set(id, items);
}
for (const [id, folder] of folders) {
	collection(
		`folders/${encodeURIComponent(id)}/`,
		folder.name ?? id,
		groupedFolders.get(id) ?? [],
		'folder'
	);
}
if (groupedFolders.has('home')) {
	collection('folders/home/', 'Unfiled', groupedFolders.get('home'), 'folder');
}
const groupedTags = new Map();
for (const post of posts) {
	for (const rawTag of Array.isArray(post.tags) ? post.tags : []) {
		const tag = String(rawTag);
		const items = groupedTags.get(tag) ?? [];
		items.push(post);
		groupedTags.set(tag, items);
	}
}
for (const [tag, items] of groupedTags) {
	collection(`tags/${tagSegment(tag)}/`, tag, items, 'tag');
}

const docsSections =
	[...folders.entries()]
		.map(([id, folder]) => {
			const items = postsByFolder.get(id) ?? [];
			if (!items.length) return '';
			return `<section class="docs-section"><p class="eyebrow">Section</p><h2>${esc(folder.name)}</h2><div class="docs-section-list">${items.map((post) => `<a href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a>`).join('')}</div></section>`;
		})
		.join('') +
	(unfiledPosts.length
		? `<section class="docs-section"><p class="eyebrow">Articles</p><h2>분류 없는 글</h2>${compactList(unfiledPosts)}</section>`
		: '');
const docsIndex = `<div class="docs-layout"><div class="docs-sidebar-wrap"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="docs-index"><p class="eyebrow">Documentation</p><h1>전체 가이드</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}${docsSections || compactList(posts)}</main><aside></aside></div>`;
const docsIndexVariants = variantsOf((name) =>
	name === 'docs' ? docsIndex : collectionBody(name, 'Docs', posts, '', 'documentation')
);
write(
	'docs/index.html',
	shell('Docs', docsIndexVariants[theme], {
		kind: 'docs-index',
		variants: docsIndexVariants,
	})
);

const search = posts.map((post) => ({
	postId: post.postId,
	title: String(post.title || 'Untitled'),
	permalink: post.permalink,
	body: plainText(post.body),
	tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
	folder: post.folderId ? folderName(post.folderId) : '',
}));
write('search.json', JSON.stringify(search));
const searchPanel = `<p class="eyebrow">Archive search</p><h1>Search</h1><form class="search-form" data-search-form role="search"><label class="skip-link" for="search-query">검색어</label><input id="search-query" data-search-input type="search" autocomplete="off" placeholder="제목, 내용, 태그 검색"><button type="submit">검색</button></form><p class="muted" data-search-status aria-live="polite"></p><ul class="post-list search-results" data-search-results></ul>`;
const searchVariants = variantsOf((name) => {
	if (name === 'docs')
		return `<div class="docs-layout"><div class="docs-sidebar-wrap"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="search-shell">${searchPanel}</main><aside></aside></div>`;
	if (name === 'portfolio')
		return `<main id="content" class="search-shell portfolio-home"><section class="showcase" id="work">${searchPanel}</section></main>`;
	return `<main id="content" class="search-shell theme-search-${name}">${searchPanel}</main>`;
});
write(
	'search/index.html',
	shell('Search', searchVariants[theme], { kind: 'search', variants: searchVariants })
);

if (site.feedEnabled !== false) {
	const feedUpdated =
		posts
			.map((post) => new Date(post.sourceUpdatedAt ?? '').getTime())
			.filter(Number.isFinite)
			.sort((a, b) => b - a)[0] ?? 0;
	const feedUpdatedIso = new Date(feedUpdated).toISOString();
	const rssItems = posts
		.map(
			(post) =>
				`<item><title>${esc(post.title || 'Untitled')}</title><link>${esc(absolute(`/posts/${post.permalink}/`))}</link><guid>${esc(absolute(`/posts/${post.permalink}/`))}</guid><description>${esc(excerpt(post.body, 240))}</description></item>`
		)
		.join('');
	const atomItems = posts
		.map((post) => {
			const postUpdated = new Date(post.sourceUpdatedAt ?? '').getTime();
			const updated = new Date(Number.isFinite(postUpdated) ? postUpdated : 0).toISOString();
			const url = absolute(`/posts/${post.permalink}/`);
			return `<entry><title>${esc(post.title || 'Untitled')}</title><id>${esc(url)}</id><updated>${updated}</updated><link rel="alternate" href="${esc(url)}"/><summary>${esc(excerpt(post.body, 240))}</summary></entry>`;
		})
		.join('');
	write(
		'feed.xml',
		`<rss version="2.0"><channel><title>${esc(siteTitle)}</title><link>${esc(absolute('/'))}</link><description>${esc(siteDescription || siteTitle)}</description>${rssItems}</channel></rss>`
	);
	write(
		'atom.xml',
		`<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(siteTitle)}</title><id>${esc(absolute('/'))}</id><updated>${feedUpdatedIso}</updated><author><name>${esc(author || siteTitle)}</name></author><link rel="alternate" href="${esc(absolute('/'))}"/>${atomItems}</feed>`
	);
}
const sitemapPages = [
	'/',
	'/search/',
	'/docs/',
	...posts.map((post) => `/posts/${post.permalink}/`),
];
write(
	'sitemap.xml',
	`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapPages.map((url) => `<url><loc>${esc(absolute(url))}</loc></url>`).join('')}</urlset>`
);
const notFoundVariants = variantsOf(
	(name) =>
		`<main id="content" class="theme-not-found-${name}"><section class="page-heading"><p class="eyebrow">Error 404</p><h1>페이지를 찾을 수 없습니다.</h1><p><a href="${href('/')}">홈으로 돌아가기</a></p></section></main>`
);
write(
	'404.html',
	shell('Not found', notFoundVariants[theme], {
		kind: 'not-found',
		variants: notFoundVariants,
	})
);
write('assets-manifest.json', JSON.stringify({ files: assetClaims }));
write('__layall-deploy.json', JSON.stringify({ format: 'layall-deploy', sourceSha: sha }));
write(
	'generated-files.json',
	JSON.stringify({
		files: [...generated, 'generated-files.json', '__layall-output-manifest.json'].sort(),
	})
);

// Owned outputs have direct claims plus exact raw-byte reverse references. Every
// other output belongs to a conservative shared group (including the nav resource).
// A deletion proof MUST also inspect new/changed files and removed old paths: the
// new snapshot cannot index references to an ID that is no longer a source post.
const outputPaths = [...outputHashes.keys()].sort();
const allPostsShared = outputPaths.filter((name) => !outputOwners.has(name));
const postClaims = Object.fromEntries(
	[...posts]
		.sort((left, right) => String(left.postId).localeCompare(String(right.postId)))
		.map((post) => [
			post.postId,
			{
				uniquePaths: uniquePathsByPost.get(post.postId).sort(),
				referencedPaths: [...referencedPathsByPost.get(post.postId)].sort(),
				sharedGroups: ['allPosts'],
			},
		])
);
write(
	'__layall-output-manifest.json',
	JSON.stringify({
		format: 'layall-output-manifest',
		version: 2,
		sourceSha: sha,
		generator: {
			format: 'layall-node-static-generator',
			version: 2,
			sha256: generatorSha256,
		},
		coverage: {
			allOutputFilesHashed: true,
			manifestSelfExcluded: true,
			postClaimsComplete: true,
			sharedClaimsConservative: true,
			rendererReverseDependenciesComplete: true,
			rawByteReferencesComplete: true,
		},
		deletionProof: {
			version: 1,
			referenceMatch: 'utf8-substring-post-id-or-route-v1',
			requiresOldAndNewManifests: true,
			requiresChangedAndRemovedPaths: true,
		},
		files: outputPaths.map((name) => ({ path: name, sha256: outputHashes.get(name) })),
		claimGroups: { allPosts: allPostsShared },
		postClaims,
		renderInputs: { version: 1, siteSha256, context, posts: postInputs },
	})
);
// Stderr telemetry is private build evidence; it never changes public output bytes.
process.stderr.write(
	`LAYALL_RENDER_CACHE_METRICS=${JSON.stringify({
		...cacheMetrics,
		generationWallMs: performance.now() - generationStarted,
		generationCpuMs: cpuMs(generationCpuStarted),
	})}\n`
);
