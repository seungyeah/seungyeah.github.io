// Imported only after the trusted launcher verifies the complete deployed package.
import { generate } from './index.mjs';
import { resources } from './resources.mjs';
export function run({ out, sha, generatorSha256 }) {
	generate({ out, sha, generatorSha256, resources });
}
