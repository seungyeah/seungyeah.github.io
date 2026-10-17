export function listeners() {
	const cleanup = [];
	return {
		on(target, type, handler, options) {
			if (!target) return;
			target.addEventListener(type, handler, options);
			cleanup.push(() => target.removeEventListener(type, handler, options));
		},
		dispose() {
			cleanup.splice(0).forEach((remove) => remove());
		},
	};
}
