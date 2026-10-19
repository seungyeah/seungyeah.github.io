import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const packageFormat = 'layall-generator-package';
export const manifestPath = 'generator/package-manifest.json';
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileLimit = (name) =>
	name === 'generator/fonts/omyu-pretty.woff2' ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
export function packageIdentity(entries) {
	return digest(
		packageFormat +
			'-v1\n' +
			entries.map(({ path, size, sha256 }) => `${path}\0${size}\0${sha256}\n`).join('')
	);
}
export function packageManifest(files) {
	const entries = [...files]
		.filter(([name]) => name !== manifestPath)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes) }));
	return { format: packageFormat, version: 1, sha256: packageIdentity(entries), entries };
}
export function validateManifest(value) {
	const exact = (object, keys) =>
		object &&
		typeof object === 'object' &&
		!Array.isArray(object) &&
		Object.keys(object).sort().join(',') === keys.sort().join(',');
	if (
		!exact(value, ['format', 'version', 'sha256', 'entries']) ||
		value.format !== packageFormat ||
		value.version !== 1 ||
		!Array.isArray(value.entries) ||
		value.entries.length < 2 ||
		value.entries.length > 256
	)
		throw new Error('invalid generator package manifest');
	let previous = '',
		total = 0;
	for (const entry of value.entries) {
		if (
			!exact(entry, ['path', 'size', 'sha256']) ||
			typeof entry.path !== 'string' ||
			!/^(?:build\.mjs|generator\/[a-z0-9][a-z0-9/-]*\.(?:mjs|js|json|css|woff2|png))$/.test(
				entry.path
			) ||
			entry.path.includes('//') ||
			entry.path === manifestPath ||
			entry.path <= previous ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			entry.size > fileLimit(entry.path) ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw new Error('invalid generator package entry');
		previous = entry.path;
		total += entry.size;
	}
	if (
		total > 16 * 1024 * 1024 ||
		!value.entries.some((entry) => entry.path === 'build.mjs') ||
		value.sha256 !== packageIdentity(value.entries)
	)
		throw new Error('invalid generator package identity');
	return value;
}

// Admission of the COMPLETE in-memory candidate, before any generated replacement.
export function validatePackageCandidate(files) {
	const raw = files.get(manifestPath);
	if (!Buffer.isBuffer(raw) || raw.length > 128 * 1024)
		throw new Error('invalid package manifest size');
	const value = validateManifest(JSON.parse(raw));
	if (!raw.equals(Buffer.from(JSON.stringify(value, null, 2) + '\n')))
		throw new Error('noncanonical package manifest');
	if (files.size !== value.entries.length + 1)
		throw new Error('package candidate inventory mismatch');
	for (const entry of value.entries) {
		const bytes = files.get(entry.path);
		if (
			!Buffer.isBuffer(bytes) ||
			bytes.length !== entry.size ||
			digest(bytes) !== entry.sha256
		)
			throw new Error('package candidate bytes mismatch');
	}
	return value;
}

// Every component is checked before opening. Files are bounded, regular and not
// links. The package namespace is closed: undeclared files never become imports.
export function readPackageFile(root, name, limit = fileLimit(name)) {
	root = path.resolve(root);
	let current = root;
	if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink())
		throw new Error('invalid package root');
	const parts = name.split('/');
	for (const part of parts.slice(0, -1)) {
		current = path.join(current, part);
		const stat = fs.lstatSync(current);
		if (!stat.isDirectory() || stat.isSymbolicLink())
			throw new Error('invalid package directory');
	}
	current = path.join(current, parts.at(-1));
	const before = fs.lstatSync(current);
	if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > limit)
		throw new Error('invalid package file');
	const fd = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		const opened = fs.fstatSync(fd);
		if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
			throw new Error('package changed while opening');
		const bytes = Buffer.alloc(opened.size);
		let offset = 0;
		while (offset < bytes.length) {
			const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
			if (!count) throw new Error('truncated package file');
			offset += count;
		}
		const after = fs.fstatSync(fd);
		if (
			after.size !== opened.size ||
			after.mtimeMs !== opened.mtimeMs ||
			after.ctimeMs !== opened.ctimeMs
		)
			throw new Error('package changed while reading');
		return bytes;
	} finally {
		fs.closeSync(fd);
	}
}
export function verifyPackage(root) {
	root = path.resolve(root);
	const raw = readPackageFile(root, manifestPath, 128 * 1024);
	const value = validateManifest(JSON.parse(raw));
	// Canonical representation also rejects duplicate JSON keys and hidden fields.
	if (!raw.equals(Buffer.from(JSON.stringify(value, null, 2) + '\n')))
		throw new Error('noncanonical package manifest');
	const expected = new Set([...value.entries.map((entry) => entry.path), manifestPath]);
	const walk = (directory) => {
		for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
			const name = directory + '/' + item.name;
			if (item.isSymbolicLink()) throw new Error('package symlink');
			if (item.isDirectory()) walk(name);
			else if (!item.isFile() || !expected.has(name))
				throw new Error('undeclared package input');
		}
	};
	walk('generator');
	for (const entry of value.entries) {
		const bytes = readPackageFile(root, entry.path);
		if (bytes.length !== entry.size || digest(bytes) !== entry.sha256)
			throw new Error('generator package input mismatch');
	}
	return value;
}
