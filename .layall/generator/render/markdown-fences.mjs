// Shared with cover discovery: the published Markdown dialect, not CommonMark guesses.
export function openFence(line) {
	const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,}|'{3,})[ \t]*([^\s`~']*)/);
	return match ? { marker: match[1][0], length: match[1].length, language: match[2] } : null;
}

export function closesFence(line, fence) {
	return new RegExp(`^[ \t]{0,3}${fence.marker}{${fence.length},}[ \t]*$`).test(line);
}
