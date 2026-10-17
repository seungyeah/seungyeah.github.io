export function registerWorker(config) {
	if (!globalThis.isSecureContext || !('serviceWorker' in navigator)) return;
	window.addEventListener(
		'load',
		() => {
			navigator.serviceWorker
				.register(config.workerUrl, { scope: config.scope, updateViaCache: 'none' })
				.catch(() => {});
		},
		{ once: true }
	);
}
