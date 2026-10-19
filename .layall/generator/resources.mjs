import fs from 'node:fs';
import { validateDiagramGraph } from './client/diagram-graph.mjs';
import { readSiteStyles } from './styles/index.mjs';
const read = (name, encoding) => fs.readFileSync(new URL(name, import.meta.url), encoding);
const diagramGraph = read('browser/renderer/graph.json');
const diagramModules = validateDiagramGraph(JSON.parse(diagramGraph)).modules.map((node) => [
	node.sha256 + '.mjs',
	read('browser/renderer/' + node.sha256 + '.mjs'),
]);
export const resources = {
	diagram: read('browser/diagram.js', 'utf8'),
	diagramGraph,
	diagramModules,
	diagramLicense: read('browser/renderer/license.json'),
	styles: readSiteStyles(),
	noScriptStyles: read('styles/no-script.css', 'utf8'),
	tmoneyFont: read('fonts/omyu-pretty.woff2'),
	icon192: read('icons/layall-192.png'),
	icon512: read('icons/layall-512.png'),
	site: read('browser/site.js', 'utf8'),
	highlight: read('browser/highlight.mjs', 'utf8'),
	protected: read('browser/protected.js', 'utf8'),
	download: read('browser/download.js', 'utf8'),
};
