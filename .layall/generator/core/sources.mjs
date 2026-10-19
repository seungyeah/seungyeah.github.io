import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { folderCrypto } from './protection.mjs';
import { createUrls } from './urls.mjs';

export function readSources() {
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
	// Upload dates come from owner-verified publication history, never note edits.
	const postDatesPath = '.layall/post-dates.json';
	if (fs.existsSync(postDatesPath) && fs.lstatSync(postDatesPath).isSymbolicLink())
		throw new Error('unsafe managed source');
	const postDates = readJson(postDatesPath, null);
	const validPublicationTime = (value) =>
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
		Number.isFinite(Date.parse(value)) &&
		new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
	if (postDates !== null) {
		if (
			!postDates ||
			Object.keys(postDates).sort().join(',') !== 'format,posts,version' ||
			postDates.format !== 'layall-post-dates' ||
			postDates.version !== 1 ||
			!postDates.posts ||
			typeof postDates.posts !== 'object' ||
			Array.isArray(postDates.posts)
		)
			throw new Error('invalid publication dates');
		for (const [id, entry] of Object.entries(postDates.posts)) {
			if (
				!/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
				!entry ||
				Object.keys(entry).sort().join(',') !== 'publishedAt,sourceSha256,updatedAt' ||
				typeof entry.sourceSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
				!validPublicationTime(entry.publishedAt) ||
				!validPublicationTime(entry.updatedAt) ||
				Date.parse(entry.updatedAt) < Date.parse(entry.publishedAt)
			)
				throw new Error('invalid publication dates');
		}
	}
	const compareText = (() => {
		try {
			return new Intl.Collator(site.locale || 'ko-KR').compare;
		} catch {
			return new Intl.Collator('ko-KR').compare;
		}
	})();
	const urls = createUrls(site);
	let dateFormatter;
	try {
		dateFormatter = new Intl.DateTimeFormat(site.locale || 'ko-KR', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC',
		});
	} catch {
		/* Invalid author locale preserves the ISO fallback. */
	}
	const formatDate = (value) => {
		if (value === undefined || value === null || value === '') return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return dateFormatter ? dateFormatter.format(date) : date.toISOString().slice(0, 10);
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
			if (
				folder.format !== 'layall-folder' ||
				(folder.version !== undefined && folder.version !== 1) ||
				typeof folder.folderId !== 'string' ||
				!/^[a-zA-Z0-9_-]{1,128}$/.test(folder.folderId) ||
				name !== `${folder.folderId}.json` ||
				(folder.parentFolderId != null &&
					(typeof folder.parentFolderId !== 'string' ||
						!/^[a-zA-Z0-9_-]{1,128}$/.test(folder.parentFolderId)))
			)
				throw new Error('invalid folder metadata');
			folders.set(folder.folderId, folder);
		}
	}

	const effectiveProtection = (folderId) => {
		const seen = new Set();
		let selected = null;
		if (folderId != null && typeof folderId !== 'string')
			throw new Error('invalid folder identity');
		while (folderId) {
			if (seen.has(folderId) || !folders.has(folderId)) {
				if (selected) throw new Error('invalid protected ancestry');
				return null;
			}
			seen.add(folderId);
			const f = folders.get(folderId);
			if (f.protection != null) {
				if (f.protection.folderId !== folderId) throw new Error('invalid protection owner');
				selected ??= f.protection;
			}
			if (f.parentFolderId != null && typeof f.parentFolderId !== 'string')
				throw new Error('invalid folder ancestry');
			folderId = f.parentFolderId;
		}
		return selected;
	};
	for (const id of folders.keys()) effectiveProtection(id);
	const protectedCore = folderCrypto();
	for (const folder of folders.values())
		if (folder.protection != null) protectedCore.parameters(folder.protection);
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
			let post = readJson(file, {});
			const protection = effectiveProtection(post.folderId);
			if (post.format === 'layall-protected') {
				protectedCore.validate(post);
				if (
					!protection ||
					['version', 'siteId', 'folderId', 'keyVersion', 'salt', 'iterations'].some(
						(k) => protection[k] !== post.protection[k]
					)
				)
					throw new Error('protection mismatch');
				const envelope = post;
				post = {
					format: 'layall-note',
					postId: envelope.postId,
					permalink: envelope.postId,
					folderId: envelope.folderId,
					title: '보호된 글',
					body: '',
					tags: [],
					attachments: [],
				};
				Object.defineProperty(post, 'protectedEnvelope', { value: envelope });
				// No old asset/temp/update file can accompany a protected current source.
				if (fs.readdirSync(sourceDir).some((name) => name !== 'post.layallnote'))
					throw new Error('unexpected protected source file');
			} else if (protection) throw new Error('plaintext post in protected folder');
			if (post.format !== 'layall-note' || post.postId !== id)
				throw new Error('invalid managed source');
			if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(post.permalink ?? ''))) {
				throw new Error('invalid permalink');
			}
			const publicationDates = postDates?.posts?.[post.postId];
			if (!publicationDates || publicationDates.sourceSha256 !== inputHashes.get(file))
				throw new Error('publication dates missing or stale; refresh publication metadata');
			Object.defineProperty(post, 'publicationDates', { value: publicationDates ?? null });
			Object.defineProperty(post, 'sourceDir', { value: sourceDir });
			posts.push(post);
		}
	}
	posts.sort((a, b) => {
		const byDate =
			Date.parse(b.publicationDates?.publishedAt ?? 0) -
			Date.parse(a.publicationDates?.publishedAt ?? 0);
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

	return {
		site,
		inputHashes,
		folders,
		posts,
		postsByFolder,
		unfiledPosts,
		orderBookPosts,
		compareText,
		formatDate,
		...urls,
	};
}
