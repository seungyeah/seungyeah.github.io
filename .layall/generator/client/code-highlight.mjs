// All common grammars/aliases are retained in the separate on-demand ESM asset.
import hljs from 'highlight.js/lib/common';

export function highlightCode(source, language) {
	if (!language || source.length > 200000 || !hljs.getLanguage(language)) return null;
	try {
		return hljs.highlight(source, { language, ignoreIllegals: true }).value;
	} catch {
		return null; // Unsupported/oversized code remains literal, never language-guessed.
	}
}
