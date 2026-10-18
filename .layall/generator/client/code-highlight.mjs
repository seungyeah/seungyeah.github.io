// Build-time browser dependency; only the site IIFE executes this module in deployment.
import hljs from 'highlight.js/lib/common';

// Same explicit/untagged Mermaid detection as NotePage's read-only preview.
const diagramStart =
	/^(?:flowchart\b|graph\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|quadrantChart\b|xychart(?:-beta)?\b|sankey-beta\b|gitGraph\b|C4[A-Za-z]*\b|requirementDiagram\b|packet-beta\b|architecture-beta\b|kanban\b|block-beta\b)/i;
export function codeKind(source, language = '') {
	const name = language.trim().toLowerCase().split(/\s+/)[0];
	const first =
		source
			.split('\n')
			.find((line) => line.trim() && !line.trim().startsWith('%%'))
			?.trim() || '';
	if (name === 'mermaid' || (!name && diagramStart.test(first)))
		return { language: 'mermaid', diagram: true };
	return { language: name, diagram: false };
}
export function highlightCode(source, language) {
	if (!language || source.length > 200000 || !hljs.getLanguage(language)) return null;
	try {
		return hljs.highlight(source, { language, ignoreIllegals: true }).value;
	} catch {
		return null; // Unsupported/oversized code remains literal, never language-guessed.
	}
}
