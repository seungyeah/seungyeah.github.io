import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
const compareText = (() => {
	try {
		return new Intl.Collator(site.locale || 'ko-KR').compare;
	} catch {
		return new Intl.Collator('ko-KR').compare;
	}
})();
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
	if (!hostname || hostname === 'localhost' || /\.(?:localhost|local|internal)$/.test(hostname))
		return true;
	const ipv4 = hostname.split('.').map(Number);
	if (
		ipv4.length === 4 &&
		ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
	) {
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
	return byDate || compareText(String(a.title ?? ''), String(b.title ?? ''));
});

// Author order is explicit and stable within books/folders; activity keeps its date order.
const authorPostOrder = new Map(
	(Array.isArray(site.postLayout?.postOrder) ? site.postLayout.postOrder : [])
		.filter((id) => typeof id === 'string')
		.map((id, index) => [id, index])
);
const orderBookPosts = (items) =>
	[...items].sort(
		(a, b) =>
			(authorPostOrder.get(a.postId) ?? Infinity) -
				(authorPostOrder.get(b.postId) ?? Infinity) ||
			String(a.postId).localeCompare(String(b.postId))
	);

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

// Profile images are shared managed outputs, never attributed to a post's deletion ledger.
let profileAsset = null;
if (site.profileImage != null) {
	const id = site.profileImage.assetId;
	if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
		throw new Error('invalid profile asset');
	const directory = '.layall/profile';
	const file = `${directory}/${id}.webp`;
	if (
		fs.lstatSync(directory).isSymbolicLink() ||
		fs.lstatSync(file).isSymbolicLink() ||
		!fs.statSync(file).isFile() ||
		fs.statSync(file).size > 3 * 1024 * 1024
	)
		throw new Error('unsafe profile asset');
	const bytes = fs.readFileSync(file);
	if (
		createHash('sha256').update(bytes).digest('hex') !== id ||
		bytes.subarray(0, 4).toString() !== 'RIFF' ||
		bytes.subarray(8, 12).toString() !== 'WEBP'
	)
		throw new Error('profile asset changed');
	inputHashes.set(file, id);
	profileAsset = `assets/profile/${id}.webp`;
	write(profileAsset, bytes);
}

const assetClaims = [];
const imageByPost = new Map();
const assetsByPost = new Map();
const coverAssetsByPost = new Map();
for (const post of posts) {
	const assets = new Map();
	assetsByPost.set(post.postId, assets);
	const coverAssets = [];
	coverAssetsByPost.set(post.postId, coverAssets);
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
		const bytes = fs.readFileSync(source);
		write(destination, bytes, post.postId);
		// Covers use only copied raster attachments, never SVG, remote URLs or private paths.
		const raster =
			(/\.png$/i.test(relative) &&
				bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
			(/\.jpe?g$/i.test(relative) &&
				bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
			(/\.gif$/i.test(relative) && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) ||
			(/\.webp$/i.test(relative) &&
				bytes.subarray(0, 4).toString() === 'RIFF' &&
				bytes.subarray(8, 12).toString() === 'WEBP') ||
			(/\.avif$/i.test(relative) &&
				bytes.subarray(4, 8).toString() === 'ftyp' &&
				/^avi[fs]$/.test(bytes.subarray(8, 12).toString()));
		if (raster) coverAssets.push({ id: String(asset.id ?? ''), url: href(`/${destination}`) });
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
const generatorSha256 = createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
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

const finiteMapCoordinate = (value) => {
	const text = String(value ?? '').trim();
	if (!text) return null;
	const number = Number(text);
	return Number.isFinite(number) ? number : null;
};
const mapCoordinatePair = (lat, lng) => {
	if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	return { lat, lng };
};
/** Camera `c` is lng,lat,zoom,... Place pages use zoom-only `c=15.00,0,0,0,dh` plus lat/lng. */
const naverCameraPair = (raw) => {
	const parts = String(raw ?? '').split(',');
	if (parts.length < 6) return null;
	return mapCoordinatePair(finiteMapCoordinate(parts[1]), finiteMapCoordinate(parts[0]));
};
/** Same URL shapes as `src/lib/markdown/map-place-card.ts`. */
const parseMapPlaceUrl = (raw) => {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^www\./, '');
	if (host === 'google.com' && url.pathname.startsWith('/maps')) {
		const query = url.searchParams.get('query') || url.searchParams.get('q') || '';
		const [latText, lngText] = query.split(',');
		const pair = mapCoordinatePair(finiteMapCoordinate(latText), finiteMapCoordinate(lngText));
		return pair ? { provider: 'google', ...pair } : null;
	}
	if (host === 'map.naver.com') {
		const fromPoint = mapCoordinatePair(
			finiteMapCoordinate(url.searchParams.get('lat')),
			finiteMapCoordinate(url.searchParams.get('lng'))
		);
		const pair = fromPoint || naverCameraPair(url.searchParams.get('c'));
		return pair ? { provider: 'naver', ...pair } : null;
	}
	return null;
};
const naverPlaceOpenUrl = (raw, label, lat, lng) => {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return raw;
	}
	if (url.hostname.replace(/^www\./, '') !== 'map.naver.com') return raw;
	if (/\/place\/\d+/.test(url.pathname)) return raw;
	const name = String(label ?? '').trim();
	if (!name) return raw;
	return `https://map.naver.com/p/search/${encodeURIComponent(name)}?c=15.00,0,0,0,dh&lat=${Number(lat).toFixed(6)}&lng=${Number(lng).toFixed(6)}`;
};
const mapPlaceFromLine = (line) => {
	const trimmed = String(line ?? '').trim();
	if (!trimmed) return null;
	const pattern = /\[([^\]]*)\]\(([^)\s]+)\)/g;
	const links = [...trimmed.matchAll(pattern)];
	if (!links.length) return null;
	if (trimmed.replace(pattern, '').replace(/[·\s]/g, '').length) return null;
	const places = [];
	for (const match of links) {
		const parsed = parseMapPlaceUrl(match[2]);
		if (!parsed) return null;
		places.push({ label: String(match[1] ?? '').trim(), url: match[2], ...parsed });
	}
	const named = places.find((place) => place.label && place.label !== '네이버 지도') ?? places[0];
	const preferred = places.find((place) => place.provider === 'naver') ?? named;
	const label = named.label || `${preferred.lat.toFixed(6)}, ${preferred.lng.toFixed(6)}`;
	return {
		...preferred,
		label,
		url:
			preferred.provider === 'naver'
				? naverPlaceOpenUrl(preferred.url, label, preferred.lat, preferred.lng)
				: preferred.url,
	};
};
const mapPlaceTile = (lat, lng, zoom = 16) => {
	const clampedLat = Math.min(85, Math.max(-85, lat));
	const n = 2 ** zoom;
	const worldX = ((lng + 180) / 360) * n;
	const latRad = (clampedLat * Math.PI) / 180;
	const worldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
	const tileX = Math.min(n - 1, Math.max(0, Math.floor(worldX)));
	const tileY = Math.min(n - 1, Math.max(0, Math.floor(worldY)));
	return {
		url: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
		left: (worldX - tileX) * 100,
		top: (worldY - tileY) * 100,
	};
};
const mapPlaceCardHtml = (place) => {
	const tile = mapPlaceTile(place.lat, place.lng);
	const caption = place.provider === 'naver' ? '네이버 지도' : 'Google Map';
	const coords = `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
	return `<a class="map-place-card" data-map-place="${place.provider}" href="${esc(place.url)}" target="_blank" rel="noopener noreferrer"><span class="map-place-map" aria-hidden="true"><img src="${esc(tile.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="map-place-pin" style="left:${tile.left.toFixed(2)}%;top:${tile.top.toFixed(2)}%"></span><span class="map-place-credit">© OSM</span></span><span class="map-place-body"><span class="map-place-name">${esc(place.label)}</span><span class="map-place-meta">${esc(caption)}</span><span class="map-place-coords">${esc(coords)}</span></span></a>`;
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
		// Editor Enter keeps each source line as its own sentence unit.
		for (const line of paragraph) html.push(`<p>${inline(line)}</p>`);
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
		html.push(`<blockquote>${quote.map((line) => inline(line)).join('<br />')}</blockquote>`);
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
			html.push('<br>');
			continue;
		}
		const mapPlace = mapPlaceFromLine(line);
		if (mapPlace) {
			flushAll();
			html.push(mapPlaceCardHtml(mapPlace));
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
// Stable storage/layout IDs; only the visitor-facing palette names change.
const palettes = {
	layall: { name: '청록', primary: '#386c78', dark: '#8dd2de' },
	blog: { name: '초록', primary: '#286a47', dark: '#8dcca4' },
	minimal: { name: '차콜', primary: '#20201e', dark: '#d8d8d2' },
	portfolio: { name: '올리브', primary: '#556846', dark: '#b3c69d' },
	docs: { name: '파랑', primary: '#3973a8', dark: '#9ac4e9' },
};
const theme = themeNames.has(site.theme) ? site.theme : 'layall';
const layoutStorageKey = `layall-layout-theme:${publicBase || basePath || '/'}`;
const siteTitle = String(site.title || 'LayAll Blog');
const siteDescription = String(site.description || '');
const pwaScope = href('/');
// PWA assets are unconditional: both new blogs and managed code updates use this generator.
// PNG bytes reuse icons/android/mipmap-xxxhdpi/ic_launcher.png (192) and icons/icon.png (512),
// without introducing a scaffold dependency. Keep these in sync when the app icon changes.
const pwaIcons = [
	{
		size: 192,
		png: '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',
	},
	{
		size: 512,
		png: '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',
	},
];
for (const { size, png } of pwaIcons)
	write(`assets/layall-icon-${size}.png`, Buffer.from(png, 'base64'));
write(
	'manifest.webmanifest',
	JSON.stringify({
		id: pwaScope,
		name: siteTitle,
		short_name: siteTitle,
		description: siteDescription,
		lang: String(site.locale || 'ko-KR'),
		start_url: pwaScope,
		scope: pwaScope,
		display: 'standalone',
		background_color: '#f6f4f0',
		theme_color: '#f6f4f0',
		prefer_related_applications: false,
		icons: pwaIcons.map(({ size }) => ({
			src: href(`/assets/layall-icon-${size}.png`),
			sizes: `${size}x${size}`,
			type: 'image/png',
			purpose: 'any',
		})),
	})
);
// Keep this response independent of public posts and settings. No offline article cache:
// deleting/updating a post must never revive old HTML, indexes, attachments or live markers.
const offlinePage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>인터넷 연결이 필요합니다</title></head><body><main><h1>인터넷 연결이 필요합니다</h1><p>연결을 확인한 뒤 다시 열어 주세요. 최신 글은 온라인에서 확인할 수 있습니다.</p><a href="${esc(pwaScope)}">블로그 홈 다시 열기</a></main></body></html>`;
write(
	'layall-sw.js',
	`'use strict';
const scope = new URL(self.registration.scope);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 const request = event.request;
 const url = new URL(request.url);
 if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
 event.respondWith(fetch(request, { cache: 'no-store' }).catch(error => {
  if (request.mode !== 'navigate') throw error;
  return new Response(${js(offlinePage)}, {
   status: 503,
   headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'"
   }
  });
 }));
});
`
);
const pwaHead = `<link rel="manifest" href="${esc(href('/manifest.webmanifest'))}"><meta name="theme-color" content="#f6f4f0"><link rel="icon" type="image/png" sizes="192x192" href="${esc(href('/assets/layall-icon-192.png'))}"><link rel="apple-touch-icon" href="${esc(href('/assets/layall-icon-192.png'))}">`;
const pwaRegistration = `<script>(()=>{if(!globalThis.isSecureContext||!('serviceWorker' in navigator))return;window.addEventListener('load',()=>{navigator.serviceWorker.register(${js(href('/layall-sw.js'))},{scope:${js(pwaScope)},updateViaCache:'none'}).catch(()=>{})},{once:true})})()</script>`;
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
	entries.sort((a, b) => compareText(String(a.folder.name), String(b.folder.name)));

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
	if (remaining.length) result.push({ label: '분류 없는 글', children: remaining.map(link) });
	return result;
};
const docsTreeEntries = navigationTree();
const docsResourcePath = '__layall-docs-navigation.json';
write(
	docsResourcePath,
	JSON.stringify({
		format: 'layall-docs-navigation',
		version: 1,
		tree: docsTreeEntries,
	})
);

const topLinks = () =>
	`<a href="${href('/')}">Home</a><a href="${href('/#posts')}">Posts</a><a href="${href('/search/')}">Search</a>`;
const profileImageMarkup = () => {
	if (!profileAsset) return '';
	const focus = (value) =>
		typeof value === 'number' && Number.isFinite(value)
			? Math.min(100, Math.max(0, value))
			: 50;
	return `<img class="profile-photo" src="${esc(href('/' + profileAsset))}" alt="${esc(author || siteTitle)}" width="208" height="208" style="object-position:${focus(site.profileImage.focalX)}% ${focus(site.profileImage.focalY)}%">`;
};
const docsNavigation = (activePost) => {
	const folderId = String(activePost?.folderId ?? '');
	const section = folders.has(folderId)
		? `<a href="${href(`/folders/${encodeURIComponent(folderId)}/`)}">${esc(folderName(folderId))}</a>`
		: '';
	return `<nav class="docs-nav" aria-label="문서 목차" data-docs-resource="${esc(href(`/${docsResourcePath}`))}"><div data-docs-fallback><a class="docs-overview" href="${href('/#posts')}">전체 문서</a>${section}</div><div data-docs-tree></div><p data-docs-status role="status"></p></nav>`;
};

const styles = `
.profile-photo{display:block;width:208px;max-width:100%;aspect-ratio:1;height:auto;object-fit:cover;border-radius:12px;margin-bottom:1rem}
[hidden]{display:none!important}
.article-body{min-width:0;overflow-wrap:anywhere}.article-body img{max-width:100%;height:auto}.article-body .article-image{min-width:0;margin:1.25rem 0;padding:.5rem;border:1px solid var(--line);border-radius:12px;background:var(--surface);text-align:center}.article-image img{margin:auto;border-radius:7px}.article-image figcaption{margin-top:.4rem;color:var(--muted);font-size:.85em;overflow-wrap:anywhere}.image-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;margin:1.25rem 0;align-items:start}.article-body .image-gallery .article-image{margin:0}.attachment-missing{color:var(--muted)}.article-table{max-width:100%;overflow-x:auto;margin:1.5rem 0;border:1px solid var(--line);border-radius:12px;overscroll-behavior-x:contain}.article-table:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.article-table table{width:100%;border-collapse:collapse}.article-table th,.article-table td{min-width:8rem;padding:.65rem .8rem;border-right:1px solid var(--line);border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.article-table th{background:var(--surface-2);font-weight:700}.article-table tr>:last-child{border-right:0}.article-table tbody tr:last-child td{border-bottom:0}.article-table .align-left{text-align:left}.article-table .align-center{text-align:center}.article-table .align-right{text-align:right}
:root{--paper:#f7f3ea;--surface:#fffdf8;--surface-2:#eee7da;--ink:#292723;--muted:#716d65;--line:#ded6c7;--accent:#716690;--accent-soft:#e8e1f3;--shadow:0 18px 60px rgba(65,55,43,.09);--radius:22px;--content:1180px;color-scheme:light}
html[data-theme][data-color-mode=dark]{--paper:#1d1c1a;--surface:#272521;--surface-2:#33302a;--ink:#f2eee6;--muted:#bbb3a7;--line:#454139;--accent:#c8b9ec;--accent-soft:#3b344b;--shadow:0 18px 60px rgba(0,0,0,.28);color-scheme:dark}
@media(prefers-color-scheme:dark){html[data-theme][data-color-mode=system]{--paper:#1d1c1a;--surface:#272521;--surface-2:#33302a;--ink:#f2eee6;--muted:#bbb3a7;--line:#454139;--accent:#c8b9ec;--accent-soft:#3b344b;--shadow:0 18px 60px rgba(0,0,0,.28);color-scheme:dark}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration-color:color-mix(in srgb,var(--accent) 52%,transparent);text-underline-offset:.2em}a:hover{color:var(--accent)}img{display:block;max-width:100%}button,input{font:inherit}.skip-link{position:fixed;z-index:100;top:.75rem;left:.75rem;transform:translateY(-180%);padding:.65rem 1rem;border-radius:999px;background:var(--ink);color:var(--paper)}.skip-link:focus{transform:none}.site-header{position:sticky;z-index:30;top:0;border-bottom:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--paper) 88%,transparent);backdrop-filter:blur(18px)}.header-inner{position:relative;width:min(calc(100% - 2rem),var(--content));min-height:68px;margin:auto;display:flex;align-items:center;gap:1rem}.brand{min-width:0;overflow-wrap:anywhere;font-weight:800;letter-spacing:-.03em;text-decoration:none}.nav-toggle,.post-toc-toggle{display:none;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:.42rem .8rem;color:var(--ink);cursor:pointer}.nav-toggle{margin-left:auto}.header-actions{margin-left:auto;display:flex;align-items:center;gap:.45rem}.header-actions .nav-toggle{margin-left:0}.post-toc-toggle{position:relative;display:block;animation:toc-arrive .32s cubic-bezier(.2,.8,.2,1) both}.post-toc-toggle:hover,.post-toc-toggle[aria-expanded=true],.nav-toggle:hover,.nav-toggle[aria-expanded=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.post-toc-panel{position:absolute;z-index:50;top:calc(100% + .65rem);right:4.75rem;width:min(22rem,calc(100vw - 2rem));max-height:min(70vh,34rem);overflow:auto;padding:1rem;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-.55rem) scale(.98);transform-origin:top right;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}.post-toc-panel[data-open=true]{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition-delay:0s}.post-toc-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.55rem}.post-toc-head strong{font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.post-toc-close{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:50%;background:var(--surface-2);color:var(--ink);cursor:pointer}.post-toc-panel ol{list-style:none;margin:0;padding:0}.post-toc-panel a{display:block;padding:.4rem .55rem;border-radius:8px;text-decoration:none;font-size:.88rem;color:var(--muted)}.post-toc-panel a:hover,.post-toc-panel a:focus-visible,.post-toc-panel a[aria-current=location]{background:var(--accent-soft);color:var(--accent)}.post-toc-panel .toc-level-3 a{padding-left:1.25rem}.post-toc-panel .toc-level-4 a{padding-left:2rem}@keyframes toc-arrive{from{opacity:0;transform:translateX(.55rem) scale(.94)}to{opacity:1;transform:none}}body[data-post-page=true] .site-header .nav-toggle{display:block}body[data-post-page=true] .site-nav{position:absolute;top:calc(100% + .65rem);right:0;display:none;width:min(28rem,calc(100vw - 2rem));max-height:calc(100vh - 6rem);overflow:auto;flex-direction:column;align-items:stretch;padding:1rem;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}body[data-post-page=true] .site-nav[data-open=true]{display:flex}.site-nav{margin-left:auto;display:flex;align-items:center;gap:1.1rem}.site-nav a{text-decoration:none;font-size:.9rem;font-weight:650}.color-controls{display:flex;border:1px solid var(--line);border-radius:999px;padding:3px}.color-controls button{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}.color-controls button:hover,.color-controls button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}main{width:min(calc(100% - 2rem),var(--content));margin:auto}.site-footer{width:min(calc(100% - 2rem),var(--content));margin:5rem auto 0;padding:2rem 0 3rem;border-top:1px solid var(--line);display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:.45rem;text-align:center;color:var(--muted);font-size:.9rem}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800;color:var(--accent)}.lead{font-size:clamp(1.05rem,2vw,1.28rem);color:var(--muted)}.muted,.post-meta{color:var(--muted);font-size:.88rem}.tag{display:inline-block;margin:.25rem .25rem 0 0;font-size:.8rem;text-decoration:none;color:var(--muted)}.empty{margin:4rem 0;padding:3rem;border:1px dashed var(--line);border-radius:var(--radius);text-align:center;color:var(--muted)}.post-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:calc(var(--radius) - 5px);background:var(--surface-2)}.page-heading{margin:4.5rem 0 2.5rem}.page-heading h1{margin:.2rem 0;font:700 clamp(2.2rem,6vw,4.8rem)/1.02 ui-serif,Georgia,serif;letter-spacing:-.055em}.page-heading p{max-width:48rem}.post-list{list-style:none;margin:0;padding:0}.post-list li{border-top:1px solid var(--line)}.post-list a{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding:1.2rem 0;text-decoration:none}.post-list strong{font-size:1.08rem}.post-list span{color:var(--muted);font-size:.85rem}.pagination{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:2.5rem 0}.pagination a{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:50%;text-decoration:none}.pagination a[aria-current=page]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.article-shell{max-width:760px;padding-top:4rem}.article{min-width:0}.article-header{margin-bottom:2.5rem}.article-header h1{margin:.4rem 0 1rem;font:700 clamp(2.3rem,6vw,4.8rem)/1.03 ui-serif,Georgia,serif;letter-spacing:-.05em}.article-body{font-size:1.05rem}.article-body p{margin:0 0 .5rem}.article-body h2,.article-body h3,.article-body h4{scroll-margin-top:6rem;margin:2.5rem 0 .75rem;line-height:1.25;letter-spacing:-.025em}.article-body h2{font-size:1.8rem}.article-body h3{font-size:1.35rem}.heading-anchor{margin-left:.45rem;text-decoration:none;opacity:0}.article-body :is(h2,h3,h4):hover .heading-anchor,.heading-anchor:focus{opacity:1}.article-body pre{overflow:auto;margin:1.5rem 0;padding:1.2rem;border:1px solid var(--line);border-radius:15px;background:#171816;color:#f4f1ea;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.article-body code{padding:.13em .36em;border-radius:6px;background:var(--surface-2);font:85% ui-monospace,SFMono-Regular,Menlo,monospace}.article-body pre code{padding:0;background:transparent;font:inherit}.article-body blockquote{margin:1.5rem 0;padding:.2rem 1.25rem;border-left:3px solid var(--accent);color:var(--muted)}.article-body hr{border:0;border-top:1px solid var(--line);margin:2.4rem 0}.article-body a{overflow-wrap:anywhere}
html[data-theme=layall]{--paper:#f6f4f0;--surface:#fffdf8;--surface-2:#e8f7fb;--ink:#354146;--muted:#566b72;--line:#d9e4e2;--accent:#386c78;--accent-soft:#dff2f6;--shadow:0 22px 58px rgba(69,88,93,.13);--radius:20px;--content:1180px;}html[data-theme=layall] body{background:var(--paper)}html[data-theme=layall] .site-header{background:color-mix(in srgb,var(--surface) 86%,transparent)}.theme-article-layall .article{padding:clamp(1.25rem,4vw,3.5rem);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:0 18px 50px rgba(69,88,93,.08)}html[data-theme=layall] .article-table{background:var(--surface)}html[data-theme=layall] .article-table th{background:#eef8f8}html[data-theme=layall][data-color-mode=dark]{--paper:#17262d;--surface:#21343b;--surface-2:#29434c;--ink:#edf6f5;--muted:#aec4c8;--line:#38535c;--accent:#8dd2de;--accent-soft:#294b55;--shadow:0 22px 58px rgba(0,0,0,.28);}html[data-theme=layall][data-color-mode=dark] body{background:var(--paper)}html[data-theme=layall][data-color-mode=dark] .article-table th{background:var(--surface-2)}.theme-article-layall .article-header h1{word-break:keep-all;overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){html[data-theme=layall][data-color-mode=system]{--paper:#17262d;--surface:#21343b;--surface-2:#29434c;--ink:#edf6f5;--muted:#aec4c8;--line:#38535c;--accent:#8dd2de;--accent-soft:#294b55;--shadow:0 22px 58px rgba(0,0,0,.28);}html[data-theme=layall][data-color-mode=system] body{background:var(--paper)}html[data-theme=layall][data-color-mode=system] .article-table th{background:var(--surface-2)}}
html[data-theme=blog]{--paper:#fff;--surface:#fff;--surface-2:#f6f8fa;--ink:#24292f;--muted:#57606a;--line:#d0d7de;--accent:#286a47;--accent-soft:#ddf4e5;--radius:12px}.blog-home{padding-top:3.6rem}.blog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2rem;margin:1.2rem 0 4rem}.blog-card{padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.blog-card h2{font:700 1.65rem/1.15 ui-serif,Georgia,serif}.blog-card a{text-decoration:none}
html[data-theme=minimal]{--paper:#fff;--surface:#fff;--surface-2:#f5f5f3;--ink:#20201e;--muted:#74746e;--line:#e5e5e0;--accent:#20201e;--accent-soft:#efefeb;--content:760px}.minimal-home{padding-top:6rem}.minimal-list{list-style:none;padding:0}.minimal-list li{border-bottom:1px solid var(--line)}.minimal-list a{display:block;padding:1.45rem 0;text-decoration:none}.minimal-list h2{margin:0 0 .35rem;font:600 clamp(1.25rem,3vw,1.65rem)/1.3 ui-serif,Georgia,serif}.minimal-list p{margin:.45rem 0;color:var(--muted)}
html[data-theme=portfolio]{--paper:#f0efe9;--surface:#fbfaf6;--surface-2:#e4e1d8;--ink:#242522;--muted:#6d7068;--line:#d7d4ca;--accent:#556846;--accent-soft:#dce6d3;--radius:32px}.portfolio-home{padding-top:2rem}.showcase{padding:5rem 0}.showcase-header{display:flex;justify-content:space-between;align-items:end;margin-bottom:1.5rem}.showcase-header h2{margin:0;font:700 clamp(2rem,5vw,4rem)/1 ui-serif,Georgia,serif}.showcase-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:1.2rem}.showcase-card{grid-column:span 6;min-height:300px;display:flex;flex-direction:column;padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);text-decoration:none}.showcase-card:nth-child(3n+1){grid-column:span 7}.showcase-card:nth-child(3n+2){grid-column:span 5}.showcase-card .post-cover{aspect-ratio:16/8}.showcase-card-content{margin-top:auto;padding:1.2rem}.showcase-card h3{margin:.3rem 0;font:650 clamp(1.45rem,3vw,2.2rem)/1.12 ui-serif,Georgia,serif}.floating-nav{position:fixed;z-index:25;bottom:1.25rem;left:50%;transform:translateX(-50%);display:flex;gap:.25rem;padding:.4rem;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 90%,transparent);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.floating-nav a{padding:.55rem .95rem;border-radius:999px;text-decoration:none;font-size:.86rem}.floating-nav a:hover{background:var(--accent-soft)}html[data-theme=portfolio] .site-footer{padding-bottom:6rem}
html[data-theme=docs]{--paper:#fbfcfd;--surface:#fff;--surface-2:#f1f4f7;--ink:#1f2933;--muted:#68727e;--line:#e1e7ec;--accent:#3973a8;--accent-soft:#e5f1fb;--content:1380px}.docs-home{padding:2.5rem 0}.docs-layout{width:min(calc(100% - 2rem),var(--content));margin:auto;display:grid;grid-template-columns:240px minmax(0,760px);gap:3rem;align-items:start}.docs-sidebar-wrap{position:sticky;top:92px}.docs-sidebar{max-height:calc(100vh - 110px);overflow:auto;padding:1rem 0}.docs-nav ul{list-style:none;padding:0;margin:.25rem 0 1rem}.docs-nav h3,.docs-nav span{display:block;margin:1.2rem 0 .3rem;font-size:.9rem;font-weight:750;color:var(--muted)}.docs-nav a{display:block;padding:.32rem .6rem;border-radius:7px;text-decoration:none;font-size:.88rem;color:var(--muted)}.docs-nav a:hover,.docs-nav a[aria-current=page]{background:var(--accent-soft);color:var(--accent)}.docs-overview{font-weight:750;color:var(--ink)!important}.docs-content{min-width:0;padding-top:3.7rem}.docs-content .article-header h1{font-family:ui-sans-serif,system-ui,sans-serif;font-size:clamp(2.3rem,5vw,4.2rem)}.docs-index{padding:4rem 0}.docs-index h1{font-size:clamp(2.5rem,6vw,5rem);letter-spacing:-.055em}
.search-shell{padding:4rem 0}.search-shell h1{font:700 clamp(2.5rem,6vw,5rem)/1 ui-serif,Georgia,serif}.search-form{display:flex;gap:.6rem;max-width:700px}.search-form input{min-width:0;flex:1;padding:.8rem 1rem;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink)}.search-form button{border:0;border-radius:999px;padding:.8rem 1.1rem;background:var(--ink);color:var(--paper);cursor:pointer}.search-results{margin-top:2rem}
@media(max-width:900px){.docs-layout{grid-template-columns:1fr}.docs-sidebar-wrap{position:static}.docs-sidebar{max-height:none}.docs-sidebar-wrap{display:none}.showcase-card,.showcase-card:nth-child(n){grid-column:span 12}}
@media(max-width:680px){body{font-size:15px}.header-inner{min-height:60px;gap:.55rem}.nav-toggle{display:block}.site-nav,body[data-post-page=true] .site-nav{position:absolute;top:calc(100% + 1px);left:0;right:0;width:auto;display:none;flex-direction:column;align-items:stretch;padding:1rem;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}.site-nav[data-open=true],body[data-post-page=true] .site-nav[data-open=true]{display:flex}.post-toc-panel{left:0;right:0;width:auto;transform-origin:top center}.color-controls{align-self:flex-start}.blog-home{padding-top:2.2rem}.blog-grid{grid-template-columns:1fr}.article-shell{padding-top:2.5rem}.site-footer{flex-direction:row}.floating-nav{max-width:calc(100% - 1rem);overflow:auto}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.post-toc-toggle{animation:none}.post-toc-panel{transition:none}}
select{font:inherit}.appearance-controls{display:flex;align-items:center;gap:.45rem}.theme-control{display:flex;align-items:center;gap:.35rem;color:var(--muted);font-size:.78rem}.theme-control select{max-width:8.5rem;border:1px solid var(--line);border-radius:999px;padding:.38rem 1.8rem .38rem .7rem;background:var(--surface);color:var(--ink);cursor:pointer}.floating-nav{display:none}html[data-theme=portfolio] .floating-nav{display:flex}.theme-article-blog .article{padding:clamp(1.2rem,4vw,3.5rem);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.theme-article-portfolio{max-width:820px}.theme-article-portfolio .article{padding:clamp(1.2rem,4vw,3rem);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}@media(max-width:680px){.theme-control select{min-height:36px}.color-controls{align-self:auto}}
a.map-place-card,a.map-place-card:hover{color:var(--ink);text-decoration:none}.map-place-card{display:flex;min-height:7.5rem;margin:1.25rem 0;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:none}.map-place-card:hover{border-color:var(--accent);box-shadow:none}.map-place-map{position:relative;width:7.5rem;flex:none;overflow:hidden;background:var(--surface-2)}.map-place-map img{width:100%;height:100%;max-width:none;margin:0;object-fit:cover;border-radius:0}.map-place-pin{position:absolute;width:.9rem;height:.9rem;border:2px solid #fff;border-radius:999px;background:#dc2626;box-shadow:none;transform:translate(-50%,-100%)}.map-place-credit{position:absolute;left:.25rem;bottom:.12rem;color:#fff;font-size:.62rem;line-height:1;text-shadow:0 1px 1px rgba(0,0,0,.75)}.map-place-body{min-width:0;display:flex;flex:1;flex-direction:column;justify-content:center;gap:.12rem;padding:.9rem 1rem}.map-place-name{font-weight:750;letter-spacing:-.02em;line-height:1.35}.map-place-meta{color:var(--muted);font-size:.82rem;font-weight:650}.map-place-coords{color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums}

.home{padding:3rem 0;min-width:0}.home-main,.home section,.home-profile,.profile-copy,.knowledge-layout,.archive-ledger{min-width:0;max-width:100%}.home-profile{overflow-wrap:anywhere}.profile-portrait{min-width:0}.profile-photo{margin:0 auto 1rem}.profile-copy h1{font:650 1.7rem/1.2 ui-serif,Georgia,serif;margin:.3rem 0 .8rem}.profile-bio{white-space:pre-line;color:var(--muted);margin:.5rem 0 1rem}.profile-links{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem;min-width:0;max-width:100%;font-size:.88rem}.profile-links a{min-width:0;max-width:100%;overflow-wrap:anywhere}.blog-tabs{display:flex;gap:.4rem;border-bottom:1px solid var(--line);min-width:0;max-width:100%}.blog-tabs>a{min-width:0;min-height:48px;padding:.6rem 1rem;text-decoration:none;border-bottom:2px solid transparent}.blog-tabs>a[aria-selected=true]{border-bottom-color:var(--accent);font-weight:700}.blog-panel{padding-top:1.75rem;scroll-margin-top:6rem}.blog-panel:focus,.book-contents:focus{outline:none}.books-back{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;min-height:44px;text-align:center;text-decoration:none}.books-back svg{justify-self:center}.books-back span{min-width:0;overflow-wrap:anywhere}.blog-panel h2{font-size:1.1rem;line-height:1.4;margin:0 0 1rem}.home-introduction{margin-bottom:2.5rem;white-space:pre-line;overflow-wrap:anywhere}.home-introduction p{margin:0}.home-stars,.home-heatmap,.home-activity{margin-bottom:2.5rem}.home-stars .blog-grid{margin:0}.blog-card{min-width:0;overflow-wrap:anywhere}.blog-card h2{font:650 1.1rem/1.4 ui-sans-serif,system-ui,sans-serif}.blog-card p{color:var(--muted);font-size:.9rem}.blog-card .post-cover{aspect-ratio:2/1}.heatmap-scroll{min-width:0;max-width:100%;overflow-x:auto;padding:.4rem 0;overscroll-behavior-x:contain}.heatmap-chart{display:grid;grid-template-columns:1.5rem max-content;grid-template-rows:1.2rem auto;column-gap:5px;width:max-content}.heatmap-months{grid-column:2;display:grid;grid-auto-columns:11px;column-gap:3px;font-size:.65rem;line-height:1;white-space:nowrap;color:var(--muted)}.heatmap-weekdays{grid-column:1;grid-row:2;display:grid;grid-template-rows:repeat(7,11px);gap:3px;font-size:.65rem;line-height:11px;color:var(--muted)}.heatmap-grid{grid-column:2;grid-row:2;display:grid;grid-template-rows:repeat(7,11px);grid-auto-columns:11px;grid-auto-flow:column;gap:3px;width:max-content}.heatmap-day{display:inline-block;width:11px;height:11px;border-radius:2px;background:var(--surface-2);border:1px solid var(--line)}.heatmap-day[data-level="1"]{background:color-mix(in srgb,var(--accent) 25%,var(--surface));border-color:var(--accent)}.heatmap-day[data-level="2"]{background:color-mix(in srgb,var(--accent) 50%,var(--surface));border-color:var(--accent)}.heatmap-day[data-level="3"]{background:color-mix(in srgb,var(--accent) 75%,var(--surface));border-color:var(--accent)}.heatmap-day[data-level="4"]{background:var(--accent);border-color:var(--accent)}.heatmap-legend{display:flex;justify-content:flex-end;gap:4px;margin-top:.5rem}.post-activity{list-style:none;margin:1rem 0 1.5rem;padding:0 0 0 1rem}.post-activity li{position:relative;display:grid;grid-template-columns:7rem minmax(0,1fr);align-items:start;gap:.75rem;margin:0;padding:.1rem 0 1.2rem 1.25rem;border:0;border-left:1px solid var(--line)}.post-activity li:last-child{padding-bottom:0}.post-activity li::before{content:"";position:absolute;top:.9rem;left:-4px;width:7px;height:7px;border-radius:50%;background:var(--accent)}.post-activity time{padding:.55rem 0;color:var(--muted);font-size:.8rem}.post-activity a{display:block;min-width:0;min-height:44px;padding:.45rem 0;text-decoration:none;overflow-wrap:anywhere}.post-activity a:hover{text-decoration:underline}.book-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,4rem),1fr));row-gap:1.5rem;min-width:0;max-width:100%;margin:1.5rem 0;position:relative}.book-shelf::after{content:"";position:absolute;left:0;right:0;bottom:0;border-bottom:5px solid var(--line);pointer-events:none}.book-slot{display:flex;align-items:flex-end;justify-content:center;min-width:0;padding:.5rem .25rem;border-bottom:5px solid var(--line)}.book-shelf>.muted{grid-column:1/-1}.book-spine{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:center;flex:0 1 3.5rem;width:3.5rem;max-width:100%;height:15rem;padding:.8rem .6rem;overflow:hidden;border:1px solid var(--line);border-left:3px solid var(--line);border-radius:3px;background:var(--surface-2);text-decoration:none}.book-spine img{position:absolute;inset:0;z-index:-1;width:100%;height:100%;object-fit:cover;opacity:.6}.book-spine>span{writing-mode:vertical-rl;text-orientation:mixed;max-height:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:bold 1rem/1.6 ui-serif,Georgia,serif}.book-spine:hover{border-color:var(--accent)}.book-contents{padding:1rem 0;scroll-margin-top:6rem}.book-heading{display:flex;gap:1.25rem;align-items:center;margin:1.5rem 0}.book-heading>div{min-width:0;overflow-wrap:anywhere}.book-heading p{margin:.3rem 0}.book-jacket{flex:none;width:5rem;aspect-ratio:2/3;object-fit:cover;border:1px solid var(--line);border-left:3px solid var(--line);border-radius:3px}.book-solid{display:block;background:var(--surface-2)}.blog-tags{display:flex;flex-wrap:wrap;gap:.4rem;margin:1rem 0}.blog-tags a{min-width:0;max-width:100%;overflow-wrap:anywhere;padding:.3rem .7rem;border:1px solid var(--line);border-radius:999px;text-decoration:none;margin:0}.blog-tags a[aria-pressed=true]{background:var(--accent-soft);color:var(--ink);border-color:var(--accent)}.tag-filter-controls{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.2rem}.tag-filter-controls label{display:flex;align-items:center;gap:.5rem}.tag-filter-controls input{width:1.1rem;height:1.1rem;accent-color:var(--accent)}.tag-filter-controls button{padding:.35rem .7rem;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer}.tag-filter-controls button:disabled{opacity:.5;cursor:default}.home .post-list strong,.home .post-list span{min-width:0;overflow-wrap:anywhere}.home a:focus-visible,.home button:focus-visible,.home input:focus-visible,.heatmap-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.docs-directory ul ul{margin:.25rem 0 .75rem .5rem;padding-left:.75rem;border-left:1px solid var(--line)}.docs-directory>ul>li{padding:.5rem 0}.docs-directory a{font-size:.95rem;padding:.4rem .6rem}.docs-nav{min-width:0;overflow-wrap:anywhere}.docs-nav ul ul{padding-left:.75rem}.docs-content{width:100%}
.home-blog{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:2.5rem}.home-blog .home-profile{text-align:center}.home-blog .profile-links{justify-content:center}.home-blog .home-introduction{padding:1.2rem;border:1px solid var(--line);border-radius:8px}.home-minimal{padding-top:4rem}.home-minimal .home-profile{max-width:32rem;margin:0 auto 2.5rem;text-align:center}.home-minimal .profile-photo{width:112px;border-radius:50%}.home-minimal .profile-links{justify-content:center}.home-minimal .blog-tabs{justify-content:center}.home-minimal .home-introduction{font:1.2rem/1.8 ui-serif,Georgia,serif;margin:1rem 0 3rem}.home-minimal .home-stars .post-list a{padding:1rem 0}.home-minimal .blog-panel>section{margin-bottom:3rem}.home-minimal .book-spine{background:var(--surface);height:13rem}.home-layall .home-profile{display:grid;grid-template-columns:140px minmax(0,1fr);gap:2rem;align-items:center;margin:0 0 2rem}.home-layall .profile-photo{width:128px;margin-bottom:0}.home-layall .profile-copy h1{font-size:2rem}.home-layall .home-stars{padding:1.5rem;border-radius:12px;background:var(--surface)}.home-layall .archive-ledger{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:2rem}.home-portfolio .home-profile{display:grid;grid-template-columns:minmax(140px,.65fr) minmax(0,1.35fr);gap:2.5rem;align-items:center;padding:1rem 0 3rem}.home-portfolio .profile-copy h1{font:650 clamp(2.4rem,5vw,4rem)/1.1 ui-serif,Georgia,serif}.home-portfolio .profile-photo{border-radius:3px}.home-portfolio .home-introduction{font-size:1.2rem;max-width:46rem}.home-projects{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}.home-projects .showcase-card:nth-child(n){grid-column:auto;min-height:0;border:0;border-radius:4px;padding:0;background:transparent;box-shadow:none}.home-projects .showcase-card-content{padding:1rem 0}.home-projects .post-cover{border-radius:4px;aspect-ratio:3/2}.home-docs{max-width:1180px}.knowledge-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:2.5rem;margin-top:1.5rem}.home-docs .home-profile{text-align:center;padding-top:1rem}.home-docs .profile-photo{width:112px;border-radius:8px}.home-docs .profile-copy h1{font:650 1.2rem/1.4 ui-sans-serif,system-ui,sans-serif}.home-docs .profile-links{justify-content:center}.home-docs .blog-tabs>a{border-radius:0}.home-docs .home-introduction{border-left:2px solid var(--line);padding-left:1rem}.home-docs .home-stars .post-list a{display:block;padding:.7rem 0}.home-docs .home-stars .post-list span{display:block;font-size:.75rem}.home-docs .post-activity li{grid-template-columns:1fr;gap:.1rem}.home-docs .book-spine>span{font-family:ui-sans-serif,system-ui,sans-serif}
.appearance-controls,body[data-post-page=true] .appearance-controls{display:flex;flex-direction:row;flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:.5rem;min-width:0;max-width:100%}.theme-control{min-width:0;flex-wrap:wrap}.theme-control select{min-width:0;max-width:100%}.color-controls{flex:none;align-self:center}.site-nav{min-width:0}.site-nav>a{overflow-wrap:anywhere}.site-footer>span{min-width:0;overflow-wrap:anywhere}
@media(max-width:900px){.home-blog{grid-template-columns:180px minmax(0,1fr);gap:1.5rem}.home-layall .archive-ledger{display:block}.knowledge-layout{grid-template-columns:160px minmax(0,1fr);gap:1.5rem}}
@media(max-width:680px){.home{padding-top:1.5rem}.home-blog,.knowledge-layout{display:block}.home-profile{margin-bottom:1.5rem}.home-layall .home-profile,.home-portfolio .home-profile{display:block;text-align:center;padding:0;margin-bottom:1.5rem}.home-layall .profile-photo{margin-bottom:1rem}.home-layall .profile-links,.home-portfolio .profile-links{justify-content:center}.home-portfolio .profile-photo{width:144px}.home-projects{grid-template-columns:1fr}.blog-tabs>a{padding:.6rem .7rem}.book-shelf{grid-template-columns:repeat(auto-fill,minmax(min(100%,3.5rem),1fr))}.book-spine{flex-basis:3rem;width:3rem;height:13rem}.home .post-list a{grid-template-columns:1fr;gap:.3rem}.post-activity li{grid-template-columns:1fr;gap:.1rem}.home-layall .home-stars{padding:1rem}.appearance-controls{width:100%}.theme-control select{max-width:8rem}}
${themeOrder.map((name) => `[data-palette="${name}"]{--palette-primary:${palettes[name].primary};--palette-dark:${palettes[name].dark}}html[data-theme=${name}][data-color-mode=dark]{--accent:${palettes[name].dark};--accent-soft:color-mix(in srgb,${palettes[name].dark} 16%,var(--surface))}`).join('')}
@media(prefers-color-scheme:dark){${themeOrder.map((name) => `html[data-theme=${name}][data-color-mode=system]{--accent:${palettes[name].dark};--accent-soft:color-mix(in srgb,${palettes[name].dark} 16%,var(--surface))}`).join('')}}
.palette-dot{display:inline-block;flex:none;width:.65rem;height:.65rem;border-radius:50%;background:var(--palette-primary);border:1px solid color-mix(in srgb,var(--ink) 15%,transparent)}
html[data-color-mode=dark] .palette-dot{background:var(--palette-dark)}@media(prefers-color-scheme:dark){html[data-color-mode=system] .palette-dot{background:var(--palette-dark)}}
.palette-picker{position:relative;min-width:0;max-width:100%;flex:0 1 auto}.palette-picker summary{display:flex;align-items:center;gap:.5rem;min-height:36px;min-width:0;padding:.25rem .5rem;cursor:pointer;list-style:none;font-size:.85rem}.palette-picker summary::-webkit-details-marker{display:none}.palette-picker summary::after{content:"⌄";margin-left:.25rem}.palette-options{position:fixed;z-index:60;top:0;left:0;width:10rem;max-width:calc(100vw - 3rem);max-height:calc(100vh - 1rem);overflow:auto;overscroll-behavior:contain;padding:.3rem;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:var(--shadow)}.palette-options button{display:flex;align-items:center;gap:.65rem;min-height:40px;width:100%;min-width:0;border:0;border-radius:4px;padding:.45rem .65rem;background:transparent;color:var(--ink);cursor:pointer;text-align:left}.palette-options button[aria-checked=true]{background:var(--surface-2);font-weight:700}.palette-picker summary:focus-visible,.palette-options button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
html[data-theme=layall] .heatmap-day[data-level="0"]{background:color-mix(in srgb,var(--paper) 72%,var(--surface-2))}
html:not([data-js=true]) .site-nav{display:flex;position:static;flex-wrap:wrap;width:auto;box-shadow:none}html:not([data-js=true]) .header-inner{flex-wrap:wrap}html:not([data-js=true]) :is(.nav-toggle,.post-toc-toggle,.appearance-controls){display:none}
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
const readStored=(key)=>{try{return localStorage.getItem(key)||''}catch{return ''}};
const writeStored=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
const syncColor=()=>document.querySelectorAll('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===root.dataset.colorMode)));
const paletteNames=${js(Object.fromEntries(themeOrder.map((name) => [name, palettes[name].name])))};
const syncLayout=()=>{document.querySelectorAll('[data-layout-theme]').forEach(select=>select.value=root.dataset.theme);document.querySelectorAll('[data-palette-choice]').forEach(button=>{const selected=button.dataset.paletteChoice===root.dataset.theme;button.setAttribute('aria-checked',String(selected));button.setAttribute('tabindex',selected?'0':'-1')});document.querySelectorAll('[data-palette-current]').forEach(node=>{node.textContent=paletteNames[root.dataset.theme];node.parentElement?.setAttribute('data-palette',root.dataset.theme)})};
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
 }catch{docsRequest=null;status.textContent='목록을 불러오지 못했습니다. 전체 문서에서 글을 확인하세요.'}
 finally{tree.removeAttribute('aria-busy');loadingDocs.delete(nav)}
};
const bindDocs=()=>{
 if(root.dataset.theme==='docs')mount?.querySelectorAll('[data-docs-resource]').forEach(loadDocs);
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
const blogState={tab:'overview',book:'',tags:new Set(),enabled:true};
let syncBlogHash=()=>{};
const bindBlog=()=>{
 syncBlogHash=()=>{};
 const home=mount?.querySelector('[data-blog-home]');if(!home)return;
 const tabs=[...home.querySelectorAll('[data-blog-tab]')];
 const panels=[...home.querySelectorAll('[data-blog-panel]')];
 const books=[...home.querySelectorAll('[data-book-panel]')];
 const tagLinks=[...home.querySelectorAll('[data-blog-tag]')];
 const rows=[...home.querySelectorAll('[data-blog-post]')].map(node=>({node,tags:JSON.parse(node.dataset.postTags)}));
 const enabled=home.querySelector('[data-tag-enabled]');
 const clear=home.querySelector('[data-tag-clear]');
 const status=home.querySelector('[data-tag-status]');
 const empty=home.querySelector('[data-tag-empty]');
 home.querySelector('[data-blog-tabs]').setAttribute('role','tablist');
 home.querySelector('[data-blog-controls]').hidden=false;
 const setHash=(value)=>{try{const url=new URL(location.href);url.hash=encodeURIComponent(value);history.replaceState(null,'',url)}catch{}};
 const show=(tab,book='',sync=false)=>{
  if(!tabs.some(node=>node.dataset.blogTab===tab))tab='overview';
  const selectedBook=books.find(node=>node.id===book);if(!selectedBook)book='';
  blogState.tab=tab;blogState.book=book;
  tabs.forEach(node=>{const selected=node.dataset.blogTab===tab;node.setAttribute('role','tab');node.setAttribute('aria-controls',node.dataset.blogTab);node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1});
  panels.forEach(node=>{node.hidden=node.dataset.blogPanel!==tab;node.setAttribute('role','tabpanel');node.setAttribute('aria-labelledby','blog-tab-'+node.dataset.blogPanel);node.tabIndex=0});
  books.forEach(node=>node.hidden=node.id!==book);
  home.querySelector('[data-book-shelf]').hidden=Boolean(book);
  home.querySelector('[data-books-heading]').hidden=!book;
  home.querySelector('[data-books-title]').textContent=selectedBook?.dataset.bookTitle||'';
  home.querySelector('[data-books-back]').setAttribute('aria-label',(selectedBook?selectedBook.dataset.bookTitle+' · ':'')+'Books 목차로 돌아가기');
  home.querySelectorAll('[data-blog-book]').forEach(node=>{if(node.dataset.blogBook===book)node.setAttribute('aria-current','true');else node.removeAttribute('aria-current')});
  if(sync)setHash(book||tab);
 };
 syncBlogHash=()=>{let hash=location.hash.slice(1);try{hash=decodeURIComponent(hash)}catch{};if(books.some(node=>node.id===hash))show('books',hash);else if(tabs.some(node=>node.dataset.blogTab===hash))show(hash);else show(blogState.tab,blogState.book)};
 tabs.forEach((node,index)=>{
  node.addEventListener('click',event=>{event.preventDefault();show(node.dataset.blogTab,'',true)});
  node.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else if(event.key===' '){event.preventDefault();show(node.dataset.blogTab,'',true);return}else return;event.preventDefault();show(tabs[next].dataset.blogTab,'',true);tabs[next].focus()});
 });
 home.querySelectorAll('[data-blog-book]').forEach(node=>node.addEventListener('click',event=>{event.preventDefault();show('books',node.dataset.blogBook,true);books.find(book=>book.id===node.dataset.blogBook)?.focus()}));
 home.querySelectorAll('[data-books-back]').forEach(node=>node.addEventListener('click',event=>{event.preventDefault();const current=blogState.book;show('books','',true);[...home.querySelectorAll('[data-blog-book]')].find(book=>book.dataset.blogBook===current)?.focus()}));
 home.querySelector('[data-blog-open-posts]')?.addEventListener('click',event=>{event.preventDefault();show('posts','',true);tabs.find(node=>node.dataset.blogTab==='posts')?.focus()});
 const filter=()=>{
  enabled.checked=blogState.enabled;clear.disabled=blogState.tags.size===0;
  tagLinks.forEach(node=>{node.setAttribute('role','button');node.setAttribute('aria-pressed',String(blogState.tags.has(node.dataset.blogTag)))});
  let count=0;rows.forEach(({node,tags})=>{node.hidden=blogState.enabled&&blogState.tags.size>0&&!tags.some(tag=>blogState.tags.has(tag));if(!node.hidden)count++});
  home.querySelectorAll('[data-docs-group]').forEach(node=>node.hidden=![...node.querySelectorAll('[data-blog-post]')].some(row=>!row.hidden));
  empty.hidden=count!==0||rows.length===0;
  status.textContent=(blogState.enabled?(blogState.tags.size?'필터 적용':'전체'):'필터 꺼짐 · 전체')+' '+count+'개 글 / '+rows.length+'개';
 };
 tagLinks.forEach(node=>{node.addEventListener('click',event=>{event.preventDefault();const tag=node.dataset.blogTag;blogState.tags.has(tag)?blogState.tags.delete(tag):blogState.tags.add(tag);filter()});node.addEventListener('keydown',event=>{if(event.key===' '){event.preventDefault();node.click()}})});
 enabled.addEventListener('change',()=>{blogState.enabled=enabled.checked;filter()});
 clear.addEventListener('click',()=>{blogState.tags.clear();filter()});
 syncBlogHash();filter();
};
window.addEventListener('hashchange',()=>syncBlogHash());
const bindPage=(query='')=>{bindDocs();bindSearch(query);bindBlog()};
const activate=(next)=>{if(!layoutThemes.has(next)||!mount)return;const template=document.querySelector('template[data-theme-layout="'+next+'"]');if(!template)return;const query=document.querySelector('[data-search-input]')?.value||'';pageGeneration+=1;const fragment=template.content.cloneNode(true);fragment.querySelectorAll('[data-layout-id]').forEach(node=>{node.id=node.dataset.layoutId;node.removeAttribute('data-layout-id')});const retained=new Map([...document.querySelectorAll('[data-theme-piece]')].map(node=>[node.dataset.themePiece,node]));const used=new Set();fragment.querySelectorAll('[data-theme-slot]').forEach(target=>{const piece=retained.get(target.dataset.themeSlot);if(piece){used.add(target.dataset.themeSlot);target.replaceWith(piece)}});if(pool)pool.replaceChildren(...[...retained].filter(([name])=>!used.has(name)).map(([,node])=>node));root.dataset.theme=next;root.dataset.layallTheme=next;mount.replaceChildren(fragment);syncLayout();bindPage(query)};
const savedColor=readStored('layall-color-mode');if(colorModes.has(savedColor))root.dataset.colorMode=savedColor;syncColor();
document.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.color;if(!colorModes.has(mode))return;root.dataset.colorMode=mode;writeStored('layall-color-mode',mode);syncColor()}));
document.querySelectorAll('[data-layout-theme]').forEach(select=>select.addEventListener('change',()=>{const next=select.value;if(!layoutThemes.has(next)){syncLayout();return}activate(next);writeStored(layoutKey,next)}));
const navToggle=document.querySelector('[data-nav-toggle]');const nav=document.querySelector('[data-nav]');
const palettePickers=[];
document.querySelectorAll('[data-palette-picker]').forEach(picker=>{
 const summary=picker.querySelector('summary');const panel=picker.querySelector('[data-palette-options]');const choices=[...panel.querySelectorAll('[data-palette-choice]')];
 // Escape both Menu overflow and the sticky header's backdrop-filter containing block.
 document.body.append(panel);
 const viewport=window.visualViewport;
 let frame=0;let watching=false;
 const contains=target=>picker.contains(target)||panel.contains(target);
 const close=(focus=false)=>{
  picker.open=false;panel.hidden=true;summary.setAttribute('aria-expanded','false');
  window.cancelAnimationFrame(frame);frame=0;
  window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);
  viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);
  observer?.disconnect();watching=false;
  if(focus)summary.focus({preventScroll:true});
 };
 const position=()=>{
  if(!picker.open)return;
  const anchor=summary.getBoundingClientRect();const menu=nav?.getBoundingClientRect();
  const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
  const width=viewport?.width||root.clientWidth,height=viewport?.height||root.clientHeight;
  if(!summary.isConnected||!anchor.width||!anchor.height||anchor.bottom<=Math.max(top,menu?.top??top)||anchor.top>=Math.min(top+height,menu?.bottom??top+height)||anchor.right<=left||anchor.left>=left+width){close();return}
  const edge=8,gap=4;const minX=left+edge,minY=top+edge;
  panel.style.maxWidth=Math.max(0,width-edge*2)+'px';
  panel.style.maxHeight=Math.max(0,height-edge*2)+'px';
  const below=Math.max(0,top+height-edge-anchor.bottom-gap),above=Math.max(0,anchor.top-gap-minY);
  const up=below<panel.scrollHeight+2&&above>below;
  panel.style.maxHeight=Math.max(0,up?above:below)+'px';
  const box=panel.getBoundingClientRect();
  panel.style.left=Math.max(minX,Math.min(anchor.left,left+width-edge-box.width))+'px';
  panel.style.top=Math.max(minY,Math.min(up?anchor.top-gap-box.height:anchor.bottom+gap,top+height-edge-box.height))+'px';
 };
 const schedule=event=>{if(!picker.open||panel.contains(event?.target)||frame)return;frame=window.requestAnimationFrame(()=>{frame=0;position()})};
 const observer=typeof window.ResizeObserver==='function'?new window.ResizeObserver(schedule):null;
 const open=()=>{
  picker.open=true;panel.hidden=false;summary.setAttribute('aria-expanded','true');position();
  if(!picker.open||watching)return;watching=true;
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  observer?.observe(summary);if(nav)observer?.observe(nav);
 };
 const selected=()=>choices.find(button=>button.dataset.paletteChoice===root.dataset.theme)||choices[0];
 const choose=button=>{const next=button.dataset.paletteChoice;if(!layoutThemes.has(next))return;activate(next);writeStored(layoutKey,next);position()};
 choices.forEach(button=>button.addEventListener('click',()=>{choose(button);close(true)}));
 summary.addEventListener('click',event=>{event.preventDefault();picker.open?close():open()});
 summary.addEventListener('keydown',event=>{
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open();if(picker.open)(event.key==='Home'?choices[0]:event.key==='End'?choices.at(-1):selected())?.focus()}
  else if(event.key==='Tab'&&!event.shiftKey&&picker.open){event.preventDefault();selected()?.focus()}
 });
 const keydown=event=>{
  if(event.key==='Escape'&&picker.open){event.preventDefault();event.stopPropagation();close(true);return}
  const index=choices.indexOf(event.target);
  // The portal lives at the end of body; resume Tab order from its header trigger.
  if(event.key==='Tab'&&(index>=0||event.target===panel)){if(event.shiftKey)event.preventDefault();close(true);return}
  if(index<0)return;
  let next=index;
  if(event.key==='ArrowDown'||event.key==='ArrowRight')next=(index+1)%choices.length;
  else if(event.key==='ArrowUp'||event.key==='ArrowLeft')next=(index+choices.length-1)%choices.length;
  else if(event.key==='Home')next=0;else if(event.key==='End')next=choices.length-1;else return;
  event.preventDefault();choose(choices[next]);choices[next].focus();
 };
 const focusout=event=>{if(!contains(event.relatedTarget))close()};
 picker.addEventListener('keydown',keydown);panel.addEventListener('keydown',keydown);
 picker.addEventListener('focusout',focusout);panel.addEventListener('focusout',focusout);
 picker.addEventListener('toggle',()=>picker.open?open():close());
 document.addEventListener('click',event=>{if(!contains(event.target))close()});
 window.addEventListener('pagehide',()=>close());
 palettePickers.push({contains,close});
});
const tocToggle=document.querySelector('[data-post-toc-toggle]');const tocPanel=document.querySelector('[data-post-toc-panel]');const tocClose=document.querySelector('[data-post-toc-close]');
const closeNav=(restore=false)=>{palettePickers.forEach(picker=>picker.close());if(nav?.dataset.open!=='true')return;nav.dataset.open='false';navToggle?.setAttribute('aria-expanded','false');if(restore)navToggle?.focus()};
const closeToc=(restore=false)=>{if(tocPanel?.dataset.open!=='true')return;const hadFocus=tocPanel.contains(document.activeElement);tocPanel.dataset.open='false';tocPanel.setAttribute('aria-hidden','true');tocToggle?.setAttribute('aria-expanded','false');if(restore||hadFocus)tocToggle?.focus({preventScroll:true})};
navToggle?.addEventListener('click',()=>{if(nav?.dataset.open==='true')closeNav();else if(nav){nav.dataset.open='true';navToggle.setAttribute('aria-expanded','true');closeToc()}});
tocToggle?.addEventListener('click',()=>{const open=tocPanel?.dataset.open!=='true';closeNav();if(!tocPanel)return;tocPanel.dataset.open=String(open);tocPanel.setAttribute('aria-hidden',String(!open));tocToggle.setAttribute('aria-expanded',String(open));if(open)(tocPanel.querySelector('a')||tocPanel).focus()});
tocClose?.addEventListener('click',()=>closeToc(true));
tocPanel?.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{tocPanel.querySelectorAll('[aria-current="location"]').forEach(active=>active.removeAttribute('aria-current'));link.setAttribute('aria-current','location');closeToc();const heading=document.getElementById(decodeURIComponent(link.hash.slice(1)));if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true})}}));
document.addEventListener('click',event=>{if(tocPanel?.dataset.open==='true'&&!tocPanel.contains(event.target)&&!tocToggle?.contains(event.target))closeToc();if(nav?.dataset.open==='true'&&!nav.contains(event.target)&&!navToggle?.contains(event.target)&&!palettePickers.some(picker=>picker.contains(event.target)))closeNav()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const tocWasOpen=tocPanel?.dataset.open==='true';const navWasOpen=nav?.dataset.open==='true';closeToc(tocWasOpen);closeNav(!tocWasOpen&&navWasOpen)}if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){const input=document.querySelector('[data-search-input]');if(input){event.preventDefault();input.focus()}}});
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
				`<option value="${name}"${name === theme ? ' selected' : ''}>${palettes[name].name}</option>`
		)
		.join('');
	const palettePicker = `<details class="palette-picker" data-palette-picker><summary aria-label="색상 선택" aria-controls="palette-options" aria-expanded="false" data-palette="${theme}"><span class="palette-dot" aria-hidden="true"></span><span data-palette-current>${palettes[theme].name}</span></summary><div id="palette-options" class="palette-options" data-palette-options hidden tabindex="-1" role="radiogroup" aria-label="색상">${themeOrder.map((name) => `<button type="button" role="radio" aria-checked="${name === theme}" tabindex="${name === theme ? '0' : '-1'}" data-palette-choice="${name}" data-palette="${name}"><span class="palette-dot" aria-hidden="true"></span>${palettes[name].name}</button>`).join('')}</div></details><select data-layout-theme hidden aria-hidden="true" tabindex="-1" aria-label="색상">${layoutOptions}</select>`;
	const footerNames = [
		...new Set([siteTitle, author].map((value) => String(value).trim()).filter(Boolean)),
	];
	const footerIdentity = footerNames
		.map((name) => `<span>${esc(name)}</span>`)
		.join('<span aria-hidden="true">·</span>');
	const postToc = options.postToc
		? `<div class="header-actions"><button class="post-toc-toggle" type="button" data-post-toc-toggle aria-expanded="false" aria-controls="post-table-of-contents">TOC</button><button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button></div><aside class="post-toc-panel" id="post-table-of-contents" data-post-toc-panel data-open="false" aria-hidden="true" tabindex="-1"><div class="post-toc-head"><strong>On this page</strong><button class="post-toc-close" type="button" data-post-toc-close aria-label="목차 닫기">×</button></div><nav aria-label="현재 글 목차">${options.postToc}</nav></aside>`
		: '<button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button>';
	return `<!doctype html><html lang="${esc(site.locale || 'ko-KR')}" data-layall-theme="${esc(theme)}" data-theme="${esc(theme)}" data-author-theme="${esc(theme)}" data-color-mode="${esc(site.colorMode || 'system')}"><head><meta charset="utf-8">${pwaHead}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}">${socialMetadata}<title>${esc(title)}${title === siteTitle ? '' : ` · ${esc(siteTitle)}`}</title><style>${styles}</style></head><body data-page-kind="${esc(options.kind || 'page')}"${options.postToc ? ' data-post-page="true"' : ''}><a class="skip-link" href="#content">본문으로 건너뛰기</a><header class="site-header"><div class="header-inner"><a class="brand" href="${href('/')}">${esc(siteTitle)}</a>${postToc}<nav class="site-nav" id="site-navigation" data-nav>${nav}<div class="appearance-controls">${palettePicker}<span class="color-controls" aria-label="화면 테마"><button type="button" data-color="light" aria-label="라이트 모드">☀</button><button type="button" data-color="dark" aria-label="다크 모드">☾</button><button type="button" data-color="system" aria-label="시스템 모드">◐</button></span></div></nav></div></header><div data-theme-view>${activeBody}</div><noscript><nav class="docs-nav" aria-label="문서 안내"><a href="${href('/#posts')}">전체 문서</a></nav></noscript><div data-theme-pool hidden>${pool}</div><footer class="site-footer">${footerIdentity}</footer><nav class="floating-nav" aria-label="빠른 탐색"><a href="${href('/')}">Home</a><a href="${href('/#posts')}">Post</a><a href="${href('/search/')}">Search</a></nav>${templates}${pwaRegistration}${behavior}</body></html>`;
};

const compactList = (items) => {
	if (!items.length) return '<div class="empty">아직 공개된 글이 없습니다.</div>';
	return `<ul class="post-list">${items.map((post) => `<li><a href="${postUrl(post)}"><strong>${esc(post.title || 'Untitled')}</strong><span>${esc(metadata(post))}</span></a></li>`).join('')}</ul>`;
};
const blogCard = (post) =>
	`<article class="blog-card">${picture(post)}<div class="post-meta">${esc(metadata(post))}</div><h2><a href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a></h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 130))}</p>` : ''}${tagsFor(post)}</article>`;
const portfolioCard = (post) =>
	`<a class="showcase-card" href="${postUrl(post)}">${picture(post)}<div class="showcase-card-content"><span class="post-meta">${esc(metadata(post))}</span><h3>${esc(post.title || 'Untitled')}</h3>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 120))}</p>` : ''}</div></a>`;

// All home themes share published data and interaction state.
const postTags = (post) => [...new Set((Array.isArray(post.tags) ? post.tags : []).map(String))];
const postDay = (post) => {
	const raw = post.sourceUpdatedAt;
	if (raw === undefined || raw === null || raw === '') return null;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	const day = date.toISOString().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};
const folderTrail = (id) => {
	const names = [];
	const seen = new Set();
	while (folders.has(id) && !seen.has(id)) {
		seen.add(id);
		const folder = folders.get(id);
		names.unshift(String(folder.name ?? id));
		id = String(folder.parentFolderId ?? '');
	}
	return names.join(' / ');
};
// Reuse the inline parser's code/link handling without rendering cached articles again.
const bookImageByPost = new Map();
for (const post of posts) {
	const candidates = coverAssetsByPost.get(post.postId);
	if (!candidates.length) continue;
	const eligible = new Map(
		candidates
			.filter((asset) => asset.id)
			.map((asset) => [asset.id, { ...asset, image: true, publicUrl: asset.url }])
	);
	let first = null;
	let fenced = false;
	for (const line of String(post.body ?? '')
		.replace(/\r\n?/g, '\n')
		.split('\n')) {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (!fenced)
			inlineMarkdown(line, eligible, false, (image) => {
				if (!first && candidates.some((asset) => asset.url === image.url))
					first = image.url;
			});
		if (first) break;
	}
	bookImageByPost.set(post.postId, first || candidates[0].url);
}
const blogBooks = () => {
	const books = [...folders].map(([id, folder]) => ({
		id: `book-folder-${id}`,
		name: String(folder.name ?? id),
		trail: folderTrail(id),
		items: postsByFolder.get(id) ?? [],
	}));
	if (unfiledPosts.length)
		books.push({ id: 'book-unfiled', name: '분류 없는 글', trail: '', items: unfiledPosts });
	const cover = (book) =>
		[...book.items]
			.sort(
				(a, b) =>
					(new Date(b.sourceUpdatedAt).getTime() || 0) -
						(new Date(a.sourceUpdatedAt).getTime() || 0) ||
					String(a.postId).localeCompare(String(b.postId))
			)
			.map((post) => bookImageByPost.get(post.postId))
			.find(Boolean);
	const covers = books
		.map((book) => {
			const image = cover(book);
			return `<div class="book-slot"><a class="book-spine" href="#${esc(book.id)}" data-blog-book="${esc(book.id)}" aria-label="${esc(book.trail || book.name)} · ${book.items.length}개 글" title="${esc(book.trail || book.name)}"><span>${esc(book.name)}</span>${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async">` : ''}</a></div>`;
		})
		.join('');
	const contents = books
		.map((book) => {
			const image = cover(book);
			const dates = book.items.map(postDay).filter(Boolean).sort();
			const period = dates.length
				? `${dates[0].replaceAll('-', '.')} - ${dates.at(-1).replaceAll('-', '.')}`
				: '날짜 기록 없음';
			return `<section class="book-contents" id="${esc(book.id)}" data-book-panel data-book-title="${esc(book.name)}" tabindex="-1"><header class="book-heading">${image ? `<img class="book-jacket" src="${esc(image)}" alt="" loading="lazy" decoding="async">` : '<span class="book-jacket book-solid" aria-hidden="true"></span>'}<div><p class="muted">${book.items.length}개 글</p><p class="muted">${period}</p></div></header>${compactList(orderBookPosts(book.items))}</section>`;
		})
		.join('');
	return `<div class="book-shelf" data-book-shelf>${covers || '<p class="muted">아직 공개된 분류가 없습니다.</p>'}</div>${contents}`;
};
const blogHeatmap = (items) => {
	const dates = items.map(postDay).filter(Boolean).sort();
	if (!dates.length) return '<p class="muted">날짜가 있는 공개 글이 아직 없습니다.</p>';
	const year = Number(dates.at(-1).slice(0, 4));
	const counts = new Map();
	for (const day of dates)
		if (Number(day.slice(0, 4)) === year) counts.set(day, (counts.get(day) ?? 0) + 1);
	const first = new Date(`${String(year).padStart(4, '0')}-01-01T00:00:00.000Z`);
	const offset = first.getUTCDay(); // Sunday-first UTC columns, including the partial first week.
	const cells = Array.from({ length: offset }, () => '<span aria-hidden="true"></span>');
	const months = [];
	let index = offset;
	for (
		const date = new Date(first);
		date.getUTCFullYear() === year;
		date.setUTCDate(date.getUTCDate() + 1), index++
	) {
		const day = date.toISOString().slice(0, 10);
		const count = counts.get(day) ?? 0;
		const label = `${day}: ${count}개 글`;
		if (date.getUTCDate() === 1)
			months.push(
				`<span style="grid-column:${Math.floor(index / 7) + 1}" data-month="${date.getUTCMonth() + 1}">${date.getUTCMonth() + 1}월</span>`
			);
		cells.push(
			`<span class="heatmap-day" data-date="${day}" data-level="${Math.min(count, 4)}" title="${label}" role="img" aria-label="${label}"></span>`
		);
	}
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
	return `<p class="muted">${year} · ${total}개 글 · 마지막 수정일 기준 (UTC)</p><div class="heatmap-scroll" tabindex="0" role="region" aria-label="${year}년 포스팅 히트맵, ${counts.size}일에 ${total}개 글"><div class="heatmap-chart"><div class="heatmap-months" aria-hidden="true">${months.join('')}</div><div class="heatmap-weekdays" aria-hidden="true">${['일', '월', '화', '수', '목', '금', '토'].map((day) => `<span>${day}</span>`).join('')}</div><div class="heatmap-grid">${cells.join('')}</div></div></div><div class="heatmap-legend" aria-hidden="true">${[0, 1, 2, 3, 4].map((level) => `<span class="heatmap-day" data-level="${level}"></span>`).join('')}</div>`;
};
const postByUrl = new Map(posts.map((post) => [postUrl(post), post]));
const staticDocsTree = (entries, filterable = false) =>
	`<ul>${entries
		.map((node) => {
			const post = postByUrl.get(node.href);
			return `<li${filterable ? (post ? ` data-blog-post data-post-tags="${esc(JSON.stringify(postTags(post)))}"` : ' data-docs-group') : ''}>${node.href ? `<a href="${esc(node.href)}">${esc(node.label)}</a>` : `<span>${esc(node.label)}</span>${staticDocsTree(node.children, filterable)}`}</li>`;
		})
		.join('')}</ul>`;
const docsHome = () =>
	`<main id="content" class="docs-home"><nav class="docs-nav docs-directory" aria-label="전체 문서">${staticDocsTree(docsTreeEntries)}</nav></main>`;
const homeProfile = () => {
	const links = [
		...(profileUrl ? [{ label: 'contact', url: profileUrl }] : []),
		...externalLinks,
	];
	return `<aside class="home-profile"><div class="profile-portrait">${profileImageMarkup()}</div><div class="profile-copy">${author ? `<h1>${esc(author)}</h1>` : ''}${authorBio ? `<p class="profile-bio">${esc(authorBio)}</p>` : ''}${links.length ? `<nav class="profile-links" aria-label="contact 및 외부 링크">${links.map((link) => `<a href="${esc(link.url)}" rel="me noopener">${esc(link.label)}</a>`).join('')}</nav>` : ''}</div></aside>`;
};
const homeTabs = () =>
	`<nav class="blog-tabs" data-blog-tabs aria-label="블로그 탐색">${[
		['overview', 'Overview'],
		['books', 'Books'],
		['posts', 'Posts'],
	]
		.map(
			([id, label]) =>
				`<a href="#${id}" id="blog-tab-${id}" data-blog-tab="${id}">${label}</a>`
		)
		.join('')}</nav>`;
const homePosts = (selectedTheme) => {
	const tags = [...new Set(posts.flatMap(postTags))].sort(compareText);
	const listing =
		selectedTheme === 'docs'
			? `<nav class="docs-nav docs-directory" aria-label="전체 문서">${staticDocsTree(docsTreeEntries, true)}</nav>`
			: `<ul class="post-list blog-posts">${posts.map((post) => `<li data-blog-post data-post-tags="${esc(JSON.stringify(postTags(post)))}"><a href="${postUrl(post)}"><strong>${esc(post.title || 'Untitled')}</strong><span>${esc(metadata(post))}</span></a></li>`).join('')}</ul>`;
	return `<section id="posts" data-blog-panel="posts" class="blog-panel"><h2>Posts</h2><div class="tag-filter-controls" data-blog-controls hidden><label><input type="checkbox" data-tag-enabled checked> 태그 필터 사용</label><button type="button" data-tag-clear>선택 지우기</button></div><nav class="blog-tags" aria-label="태그 선택">${tags.map((tag) => `<a class="tag" data-blog-tag="${esc(tag)}" href="${href(`/tags/${tagSegment(tag)}/`)}">#${esc(tag)}</a>`).join('')}</nav><p class="muted" data-tag-status role="status">전체 ${posts.length}개 글</p>${listing}<p class="muted" data-tag-empty hidden>선택한 태그에 해당하는 글이 없습니다.</p>${posts.length ? '' : '<p class="muted">아직 공개된 글이 없습니다.</p>'}</section>`;
};
const homeOverview = (selectedTheme) => {
	const starIds = new Set(
		Array.isArray(site.postLayout?.starredPostIds) ? site.postLayout.starredPostIds : []
	);
	const starred = orderBookPosts(posts.filter((post) => starIds.has(post.postId)));
	const dated = posts
		.filter(postDay)
		.sort((a, b) => postDay(b).localeCompare(postDay(a)))
		.slice(0, 12);
	const intro = siteDescription
		? `<div class="home-introduction"><p>${esc(siteDescription)}</p></div>`
		: '';
	const starList =
		selectedTheme === 'portfolio'
			? `<div class="home-projects">${starred.map(portfolioCard).join('')}</div>`
			: selectedTheme === 'blog'
				? `<div class="blog-grid">${starred.map(blogCard).join('')}</div>`
				: compactList(starred);
	const stars = `<section class="home-stars"><h2>Star posts</h2>${starred.length ? starList : '<p class="muted">아직 별표로 선택한 글이 없습니다.</p>'}</section>`;
	const heatmap = `<section class="home-heatmap"><h2>Post activity</h2>${blogHeatmap(posts)}</section>`;
	const activity = `<section class="home-activity"><h2>Timeline</h2>${dated.length ? `<ol class="post-activity">${dated.map((post) => `<li><time datetime="${postDay(post)}">${postDay(post)}</time><a href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a></li>`).join('')}</ol>` : '<p class="muted">표시할 수정 기록이 없습니다.</p>'}<a href="#posts" data-blog-open-posts>모든 글 보기 →</a></section>`;
	const composition =
		selectedTheme === 'layall'
			? `${intro}${stars}<div class="archive-ledger">${heatmap}${activity}</div>`
			: `${intro}${stars}${heatmap}${activity}`;
	return `<section id="overview" data-blog-panel="overview" class="blog-panel">${composition}</section>`;
};
const renderHome = (_items, selectedTheme = theme) => {
	const tabs = homeTabs();
	const panels = `${homeOverview(selectedTheme)}<section id="books" data-blog-panel="books" class="blog-panel"><h2 data-books-heading hidden><a class="books-back" href="#books" data-books-back aria-label="Books 목차로 돌아가기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"></path></svg><span data-books-title></span></a></h2>${blogBooks()}</section>${homePosts(selectedTheme)}`;
	const profile = homeProfile();
	const composition =
		selectedTheme === 'blog'
			? `${profile}<div class="home-main">${tabs}${panels}</div>`
			: selectedTheme === 'docs'
				? `${tabs}<div class="knowledge-layout">${profile}<div class="home-main">${panels}</div></div>`
				: `${profile}${tabs}<div class="home-main">${panels}</div>`;
	return `<main id="content" class="home home-${selectedTheme}" data-blog-home>${composition}</main>`;
};
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
const articleSlot = '<span data-theme-slot="article"></span>';
const docsNavigationSlot = '<span data-theme-slot="docs-navigation"></span>';
const standardArticle = (selectedTheme) =>
	`<main id="content" class="article-shell theme-article-${selectedTheme}">${articleSlot}</main>`;
const docsArticle = () =>
	`<div class="docs-layout">${docsNavigationSlot}<main id="content" class="docs-content">${articleSlot}</main></div>`;

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
		'docs-navigation': `<div class="docs-sidebar-wrap" data-theme-piece="docs-navigation"><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation(post)}</aside></div>`,
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
		return `<div class="docs-layout"><div class="docs-sidebar-wrap"><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="docs-index">${heading}${compactList(items)}${pagination}</main><aside></aside></div>`;
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
				? renderHome(pageItems, name)
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
for (const [id, folder] of folders) {
	collection(
		`folders/${encodeURIComponent(id)}/`,
		folder.name ?? id,
		postsByFolder.get(id) ?? [],
		'folder'
	);
}
// Preserve the legacy unfiled route without colliding with a real folder named home.
if (unfiledPosts.length && !folders.has('home')) {
	collection('folders/home/', '분류 없는 글', unfiledPosts, 'folder');
}
const groupedTags = new Map();
for (const post of posts) {
	for (const rawTag of postTags(post)) {
		const tag = String(rawTag);
		const items = groupedTags.get(tag) ?? [];
		items.push(post);
		groupedTags.set(tag, items);
	}
}
for (const [tag, items] of groupedTags) {
	collection(`tags/${tagSegment(tag)}/`, tag, items, 'tag');
}

const docsIndex = docsHome();
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
		return `<div class="docs-layout"><div class="docs-sidebar-wrap"><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="search-shell">${searchPanel}</main><aside></aside></div>`;
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
write('assets-manifest.json', JSON.stringify({ files: assetClaims, profile: profileAsset }));
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
