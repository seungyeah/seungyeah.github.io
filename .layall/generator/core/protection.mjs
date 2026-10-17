// Shared WebCrypto/IndexedDB protocol. No Node or DOM dependencies.
export function folderCrypto(platform = globalThis) {
	const max = 64 * 1024 * 1024;
	const enc = new TextEncoder();
	const fail = () => {
		throw new Error('Invalid protected post');
	};
	const decode = (s, limit) => {
		if (
			typeof s !== 'string' ||
			s.length > Math.ceil(limit / 3) * 4 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)
		)
			fail();
		const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
		if (b.length > limit) fail();
		return b;
	};
	const parameters = (p) => {
		if (
			!p ||
			Object.keys(p).sort().join(',') !==
				'folderId,iterations,keyVersion,salt,siteId,version' ||
			p.version !== 1 ||
			p.iterations !== 600000 ||
			!/^github:[0-9]+$/.test(p.siteId) ||
			!/^[a-zA-Z0-9_-]{1,128}$/.test(p.folderId) ||
			!/^[a-f0-9]{32}$/.test(p.keyVersion) ||
			decode(p.salt, 16).length !== 16
		)
			fail();
		return p;
	};
	const validate = (e) => {
		const p = e?.protection;
		if (
			!e ||
			Object.keys(e).sort().join(',') !==
				'ciphertext,folderId,format,nonce,permalink,postId,protection,version' ||
			e.format !== 'layall-protected' ||
			e.version !== 1 ||
			typeof e.postId !== 'string' ||
			!/^[a-zA-Z0-9_-]{1,128}$/.test(e.postId) ||
			e.permalink !== e.postId ||
			(e.folderId !== null &&
				(typeof e.folderId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(e.folderId)))
		)
			fail();
		parameters(p);
		if (
			decode(e.nonce, 12).length !== 12 ||
			typeof e.ciphertext !== 'string' ||
			e.ciphertext.length > Math.ceil((max + 16) / 3) * 4 ||
			e.ciphertext.length < 24
		)
			fail();
		return p;
	};
	const namespace = (e) => {
		const p = validate(e);
		return JSON.stringify([
			platform.location?.origin || '',
			p.siteId,
			p.folderId,
			p.keyVersion,
			p.salt,
			p.iterations,
		]);
	};
	const derive = async (e, password) => {
		const p = validate(e);
		if (typeof password !== 'string' || !password) fail();
		const material = await platform.crypto.subtle.importKey(
			'raw',
			enc.encode(password),
			'PBKDF2',
			false,
			['deriveKey']
		);
		return platform.crypto.subtle.deriveKey(
			{ name: 'PBKDF2', salt: decode(p.salt, 16), iterations: p.iterations, hash: 'SHA-256' },
			material,
			{ name: 'AES-GCM', length: 256 },
			false,
			['decrypt']
		);
	};
	const open = async (e, key) => {
		const p = validate(e);
		if (
			!key ||
			key.extractable ||
			key.type !== 'secret' ||
			key.algorithm?.name !== 'AES-GCM' ||
			key.algorithm.length !== 256 ||
			key.usages.length !== 1 ||
			key.usages[0] !== 'decrypt'
		)
			fail();
		const additionalData = enc.encode(
			JSON.stringify([
				'layall-protected',
				1,
				p.siteId,
				p.folderId,
				p.keyVersion,
				p.salt,
				p.iterations,
				e.postId,
				e.folderId,
			])
		);
		const bytes = await platform.crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: decode(e.nonce, 12), additionalData, tagLength: 128 },
			key,
			decode(e.ciphertext, max + 16)
		);
		const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		const s = payload.source;
		if (
			!s ||
			s.format !== 'layall-note' ||
			s.postId !== e.postId ||
			s.folderId !== e.folderId ||
			s.permalink !== e.postId ||
			!payload.assets ||
			typeof payload.assets !== 'object' ||
			Array.isArray(payload.assets)
		)
			fail();
		for (const [path, bytes] of Object.entries(payload.assets)) {
			if (
				!path.startsWith(`content/posts/${e.postId}/assets/`) ||
				path.includes('\\') ||
				path.split('/').some((p) => !p || p === '.' || p === '..')
			)
				fail();
			decode(bytes, max);
		}
		return payload;
	};
	const scope = (name) => {
		try {
			return JSON.stringify(JSON.parse(name).slice(0, 3));
		} catch {
			return null;
		}
	};
	const session = new Map();
	const epochs = new Map();
	const revisions = new Map();
	const revoked = () => Object.assign(new Error('Unlock was revoked'), { revoked: true });
	// Revision read/compare/write shares one IDB transaction with the key write.
	// A relock in another tab therefore wins against a KDF or put already in flight.
	const storage = (op, name, key, expected) =>
		new Promise((resolve, reject) => {
			let db,
				tx,
				settled = false,
				result,
				reason;
			const end = (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (error)
					try {
						tx?.abort();
					} catch {}
				db?.close();
				error ? reject(reason || new Error('Unlock storage unavailable')) : resolve(result);
			};
			const timer = setTimeout(() => {
				reason = new Error('Unlock storage timed out');
				if (tx) {
					try {
						tx.abort(); // wait for abort settlement; close() does not roll back writes
						return;
					} catch {}
				}
				end(true);
			}, 3000);
			try {
				const request = platform.indexedDB.open('layall-folder-keys-v1', 1);
				request.onupgradeneeded = () => request.result.createObjectStore('keys');
				request.onerror = request.onblocked = () => end(true);
				request.onsuccess = () => {
					db = request.result;
					if (settled) {
						db.close();
						return;
					}
					try {
						tx = db.transaction(
							'keys',
							op === 'forget' || op === 'put' ? 'readwrite' : 'readonly'
						);
						const store = tx.objectStore('keys'),
							revName = 'rev:' + scope(name),
							r = store.get(revName);
						r.onsuccess = () => {
							const revision = r.result ?? 0;
							if (
								!Number.isSafeInteger(revision) ||
								revision < 0 ||
								revision >= Number.MAX_SAFE_INTEGER
							) {
								tx.abort();
								return;
							}
							if (op === 'forget') {
								store.put(revision + 1, revName);
								result = revision + 1;
								const all = store.getAllKeys();
								all.onsuccess = () => {
									for (const candidate of all.result)
										if (scope(candidate) === scope(name))
											store.delete(candidate);
								};
							} else if (op === 'put') {
								if (revision !== expected) {
									reason = revoked();
									tx.abort();
									return;
								}
								store.put(key, name);
								result = revision;
							} else if (op === 'revision') result = revision;
							else {
								const k = store.get(name);
								k.onsuccess = () => {
									result = { key: k.result, revision };
								};
							}
						};
						tx.oncomplete = () => end(false);
						tx.onerror = tx.onabort = () => end(true);
					} catch {
						end(true);
					}
				};
			} catch {
				end(true);
			}
		});
	const invalidate = (e) => {
		const name = namespace(e),
			group = scope(name);
		epochs.set(group, (epochs.get(group) || 0) + 1);
		for (const candidate of session.keys())
			if (scope(candidate) === group) session.delete(candidate);
	};
	const observe = (name, revision) => {
		const group = scope(name);
		revisions.set(group, Math.max(revision, revisions.get(group) ?? -1));
	};
	// BroadcastChannel is only a notification. Older events must not revoke a
	// newer explicit unlock, and no event writes/deletes persistent key records.
	const notify = (e, revision) => {
		const name = namespace(e);
		if (
			!Number.isSafeInteger(revision) ||
			revision < 0 ||
			revision <= (revisions.get(scope(name)) ?? -1)
		)
			return false;
		observe(name, revision);
		invalidate(e);
		return true;
	};
	const unlock = async (e, password) => {
		const name = namespace(e),
			epoch = epochs.get(scope(name)) || 0;
		let revision,
			persisted = true;
		try {
			revision = await storage('revision', name);
			observe(name, revision);
		} catch {
			persisted = false;
		}
		const key = await derive(e, password),
			payload = await open(e, key);
		if ((epochs.get(scope(name)) || 0) !== epoch) throw revoked();
		if (persisted)
			try {
				await storage('put', name, key, revision);
				if ((await storage('revision', name)) !== revision) throw revoked();
			} catch (error) {
				if (error.revoked) throw error;
				persisted = false;
			}
		if ((epochs.get(scope(name)) || 0) !== epoch) throw revoked();
		session.set(name, { key, revision, persisted });
		return { payload, persisted };
	};
	const restore = async (e) => {
		const name = namespace(e),
			epoch = epochs.get(scope(name)) || 0;
		let remembered = session.get(name),
			storageFailed = false,
			stored;
		try {
			stored = await storage('get', name);
			observe(name, stored.revision);
		} catch {
			storageFailed = true;
		}
		if (
			stored &&
			remembered &&
			(remembered.revision !== stored.revision || (remembered.persisted && !stored.key))
		) {
			session.delete(name);
			remembered = null;
		}
		// A saved key needs an authoritative revision; only explicit session-only
		// unlocks can keep working while storage is unavailable on this page.
		const key = stored?.key || ((!storageFailed || !remembered?.persisted) && remembered?.key);
		if (!key) return { payload: null, storageFailed };
		try {
			const payload = await open(e, key);
			if ((epochs.get(scope(name)) || 0) !== epoch) return { payload: null, storageFailed };
			if (stored && (await storage('revision', name)) !== stored.revision) {
				session.delete(name);
				return { payload: null, storageFailed };
			}
			session.set(name, {
				key,
				revision: stored?.revision ?? remembered?.revision,
				persisted: !!stored?.key,
			});
			return { payload, storageFailed };
		} catch {
			session.delete(name);
			return { payload: null, storageFailed };
		}
	};
	const forget = async (e) => {
		invalidate(e);
		const name = namespace(e),
			revision = await storage('forget', name);
		observe(name, revision);
		return revision;
	};

	return {
		validate,
		parameters,
		namespace,
		scope,
		derive,
		open,
		unlock,
		restore,
		forget,
		invalidate,
		notify,
		decode,
	};
}
