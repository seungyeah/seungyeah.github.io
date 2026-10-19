import { listeners } from './lifecycle.mjs';
export function createHomeWidgets({ mount }) {
	const events = listeners();
	let selectedReaction = '+1',
		selectedYear;
	const bindReactions = () => {
		const section = document.querySelector('[data-reaction-ranking]');
		if (!section) return;
		const select = (key) => {
			selectedReaction = key;
			section
				.querySelectorAll('[data-reaction-kind]')
				.forEach((button) =>
					button.setAttribute('aria-pressed', String(button.dataset.reactionKind === key))
				);
			section
				.querySelectorAll('[data-reaction-panel]')
				.forEach((panel) => (panel.hidden = panel.dataset.reactionPanel !== key));
		};
		section
			.querySelectorAll('[data-reaction-kind]')
			.forEach((button) =>
				events.on(button, 'click', () => select(button.dataset.reactionKind))
			);
		select(selectedReaction);
	};
	const bindHeatmap = () => {
		const section = mount?.querySelector('[data-heatmap]');
		if (!section) return;
		const picker = section.querySelector('[data-heatmap-year-picker]');
		const summary = picker?.querySelector('[data-heatmap-year-label]');
		const total = section.querySelector('[data-heatmap-total]');
		const options = [...section.querySelectorAll('[data-heatmap-year-option]')];
		const panels = [...section.querySelectorAll('[data-heatmap-panel]')];
		if (!picker || !summary || !total || !options.length || !panels.length) return;
		const syncExpanded = () => summary.setAttribute('aria-expanded', String(picker.open));
		const select = (year) => {
			const panel = panels.find((node) => node.dataset.heatmapPanel === year);
			if (!panel) return;
			selectedYear = year;
			summary.textContent = year;
			summary.setAttribute('aria-controls', panel.id);
			total.textContent = panel.dataset.heatmapTotal + '개 글';
			panels.forEach((node) => (node.hidden = node !== panel));
			options.forEach((node) =>
				node.setAttribute('aria-selected', String(node.dataset.heatmapYearOption === year))
			);
			picker.open = false;
			syncExpanded();
		};
		options.forEach((option) =>
			events.on(option, 'click', () => select(option.dataset.heatmapYearOption))
		);
		events.on(picker, 'toggle', syncExpanded);
		const available = options.filter((option) =>
			panels.some((panel) => panel.dataset.heatmapPanel === option.dataset.heatmapYearOption)
		);
		select(
			available.find((option) => option.dataset.heatmapYearOption === selectedYear)?.dataset
				.heatmapYearOption ??
				available.find((option) => option.getAttribute('aria-selected') === 'true')?.dataset
					.heatmapYearOption ??
				available[0]?.dataset.heatmapYearOption
		);
	};
	return {
		bind() {
			events.dispose();
			bindHeatmap();
			bindReactions();
		},
		dispose: () => events.dispose(),
	};
}
