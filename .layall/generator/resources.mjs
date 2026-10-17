import fs from 'node:fs';
import { readSiteStyles } from './styles/read.mjs';
const read = (name, encoding) => fs.readFileSync(new URL(name, import.meta.url), encoding);
export const resources = {
	styles: readSiteStyles(),
	noScriptStyles: read('styles/no-script.css', 'utf8'),
	font: read('fonts/omyu-pretty.woff2'),
	icon192: read('icons/layall-192.png'),
	icon512: read('icons/layall-512.png'),
	site: read('browser/site.js', 'utf8'),
	protected: read('browser/protected.js', 'utf8'),
	download: read('browser/download.js', 'utf8'),
};
