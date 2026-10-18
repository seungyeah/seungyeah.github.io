// Shared package/runtime contract. Nodes are whole upstream ES modules, never byte shards.
export const graphLimits = {
	file: 2 * 1024 * 1024,
	total: 8 * 1024 * 1024,
	count: 128,
	metadata: 128 * 1024,
};
const exact = (value, keys) =>
	value &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	Object.keys(value).sort().join(',') === keys.sort().join(',');
export function validateDiagramGraph(graph) {
	if (
		!exact(graph, ['format', 'version', 'entry', 'modules']) ||
		graph.format !== 'layall-mermaid-graph' ||
		graph.version !== 1 ||
		!Array.isArray(graph.modules) ||
		!graph.modules.length ||
		graph.modules.length > graphLimits.count ||
		graph.entry !== graph.modules.length - 1
	)
		throw new Error('Invalid diagram graph');
	let total = 0;
	const hashes = new Set(),
		names = new Set();
	for (const [index, node] of graph.modules.entries()) {
		if (
			!exact(node, ['name', 'sha256', 'size', 'imports']) ||
			typeof node.name !== 'string' ||
			!/^(?:mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[A-Za-z0-9_-]+\.mjs)$/.test(
				node.name
			) ||
			names.has(node.name) ||
			!/^[a-f0-9]{64}$/.test(node.sha256) ||
			hashes.has(node.sha256) ||
			!Number.isSafeInteger(node.size) ||
			node.size <= 0 ||
			node.size > graphLimits.file ||
			!Array.isArray(node.imports)
		)
			throw new Error('Invalid diagram module');
		hashes.add(node.sha256);
		names.add(node.name);
		total += node.size;
		let end = 0;
		for (const ref of node.imports) {
			if (
				!Array.isArray(ref) ||
				ref.length !== 3 ||
				!ref.every(Number.isSafeInteger) ||
				ref[0] < end ||
				ref[1] <= ref[0] ||
				ref[1] > node.size ||
				ref[2] < 0 ||
				ref[2] >= index
			)
				throw new Error('Invalid diagram import');
			end = ref[1];
		}
	}
	if (total > graphLimits.total) throw new Error('Diagram graph too large');
	const reached = new Set();
	const visit = (index) => {
		if (reached.has(index)) return;
		reached.add(index);
		graph.modules[index].imports.forEach((ref) => visit(ref[2]));
	};
	visit(graph.entry);
	if (reached.size !== graph.modules.length) throw new Error('Unreachable diagram module');
	return graph;
}
export function linkDiagramModules(graph, sources, { Blob, URL }) {
	validateDiagramGraph(graph);
	if (!Array.isArray(sources) || sources.length !== graph.modules.length)
		throw new Error('Incomplete diagram modules');
	const urls = [];
	const dispose = () => {
		urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
	};
	try {
		for (const [index, node] of graph.modules.entries()) {
			let source = sources[index];
			if (typeof source !== 'string' || new TextEncoder().encode(source).length !== node.size)
				throw new Error('Invalid diagram bytes');
			for (const [start, end, dependency] of [...node.imports].reverse()) {
				// Exact AST string-literal spans from the authenticated descriptor only.
				if (
					!/^(?:"\.{1,2}\/[A-Za-z0-9_./-]+\.mjs"|'\.{1,2}\/[A-Za-z0-9_./-]+\.mjs')$/.test(
						source.slice(start, end)
					)
				)
					throw new Error('Invalid diagram import span');
				source =
					source.slice(0, start) + JSON.stringify(urls[dependency]) + source.slice(end);
			}
			urls.push(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
		}
		return { entry: urls[graph.entry], dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}
