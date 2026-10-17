export function readConfig(selector) {
	const node = document.querySelector(selector);
	return node ? JSON.parse(node.textContent) : null;
}
