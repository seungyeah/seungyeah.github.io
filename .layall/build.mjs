// Release launcher template. Only Node builtins execute before verifier pin checks.
// tools/bundle.mjs replaces the single verifier SHA with this release's actual bytes.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
for (const directory of [root, path.join(root, 'generator')]) {
	const stat = fs.lstatSync(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink())
		throw new Error('invalid generator package directory');
}
const verifier = path.join(root, 'generator/package.mjs');
const fd = fs.openSync(
	verifier,
	fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
);
let bytes;
try {
	const stat = fs.fstatSync(fd);
	if (!stat.isFile() || stat.size < 1 || stat.size > 128 * 1024)
		throw new Error('invalid package verifier');
	bytes = Buffer.alloc(stat.size);
	let offset = 0;
	while (offset < bytes.length) {
		const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
		if (!count) throw new Error('truncated package verifier');
		offset += count;
	}
} finally {
	fs.closeSync(fd);
}
if (createHash('sha256').update(bytes).digest('hex') !== '6848bc06bbe579eb95fb079112cade871144bce5b9a44d80ccc5243fc255170e')
	throw new Error('generator verifier pin mismatch');
const { verifyPackage } = await import(pathToFileURL(verifier));
const identity = verifyPackage(root);
const [, , out, sha] = process.argv;
if (!out || !sha) throw new Error('usage: node .layall/build.mjs <outputDir> <sourceSha>');
const { run } = await import('./generator/runtime.mjs');
run({ out, sha, generatorSha256: identity.sha256 });
