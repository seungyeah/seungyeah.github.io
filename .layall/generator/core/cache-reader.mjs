import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createCacheReader({ context, generatorSha256 }) {
	// This is a private, transport-verified input, never a second public output tree.
	// Limits affect eligibility only: any failure takes the normal fresh renderer.
	const cacheManifestLimit = 32 * 1024 * 1024;
	const cacheHtmlLimit = 16 * 1024 * 1024;
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
		if (!value) return { status: 'disabled', cache: null };
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
				return { status: 'rejected', cache: null };
			if (!path.isAbsolute(value) || typeof process.getuid !== 'function')
				return { status: 'rejected', cache: null };
			const stat = fs.lstatSync(value);
			if (
				!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				(stat.mode & 0o777) !== 0o700 ||
				stat.uid !== process.getuid()
			)
				return { status: 'rejected', cache: null };
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
				return { status: 'rejected', cache: null };
			const hashes = new Map();
			for (const entry of manifest.files) {
				if (
					!cachePathSafe(entry?.path) ||
					!cacheHashSafe(entry.sha256) ||
					hashes.has(entry.path)
				)
					return { status: 'rejected', cache: null };
				hashes.set(entry.path, entry.sha256);
			}
			const inputs = new Map(Object.entries(manifest.renderInputs.posts));
			if (inputs.size > 50000) return { status: 'rejected', cache: null };
			const claimed = new Set();
			for (const input of inputs.values()) {
				if (!Array.isArray(input?.cacheableOutputs)) continue;
				for (const output of input.cacheableOutputs) {
					if (!cachePathSafe(output?.path) || claimed.has(output.path))
						return { status: 'rejected', cache: null };
					claimed.add(output.path);
				}
			}
			return { status: 'ready', cache: { root, hashes, inputs } };
		} catch {
			return { status: 'rejected', cache: null };
		}
	};
	return {
		loadRenderCache,
		readPost(cache, postId, expected) {
			return verifiedCachedHtml(expected, cache.inputs.get(postId), cache.hashes, (name) =>
				readCacheFile(cache.root, name, cacheHtmlLimit)
			);
		},
	};
}

// Cache bytes are inert data. Callers decide how to read them, then this shared
// predicate verifies the exact current route, complete key and actual digest.
export function verifiedCachedHtml(expected, input, hashes, read) {
	const outputs = input?.cacheableOutputs;
	if (!Array.isArray(outputs) || outputs.length !== 1) return null;
	const output = outputs[0];
	if (output.path !== expected.path || output.key !== expected.key) return null;
	const digest = hashes.get(expected.path);
	if (!digest) return null;
	const bytes = read(expected.path);
	return createHash('sha256').update(bytes).digest('hex') === digest ? bytes : null;
}
