import { esc } from './text.mjs';

export function noteToc(headings = []) {
	const visibleHeadings = headings?.filter((h) => h.level >= 1 && h.level <= 6) ?? [];
	const firstHeadingLabel = visibleHeadings[0]?.label ?? '목차';
	return visibleHeadings.length
		? `<div class="note-toc-strip" data-note-toc-strip><div class="note-toc-bar"><button type="button" class="note-toc-toggle-bar" data-note-toc-toggle aria-expanded="false" aria-label="목차 열기" aria-controls="note-toc-list"><span class="note-toc-current"><span class="note-toc-active-marker" data-note-toc-marker>§</span><span class="note-toc-active-label" data-note-toc-label>${esc(firstHeadingLabel)}</span></span><span class="note-toc-caret" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></button><nav class="note-toc-dropdown" id="note-toc-list" data-note-toc-dropdown hidden aria-label="글 목차"><ol class="note-toc-list">${visibleHeadings.map((h, i) => `<li class="note-toc-item toc-level-${h.level}" data-toc-target="${esc(h.id)}" data-toc-idx="${i}"><a href="#${esc(h.id)}" class="note-toc-link"><span class="note-toc-item-marker">${h.level <= 2 ? '§' : '•'}</span><span class="note-toc-item-title">${esc(h.label)}</span></a></li>`).join('')}</ol></nav></div></div>`
		: '';
}
