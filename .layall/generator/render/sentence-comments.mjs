import { esc } from './text.mjs';

// Author annotations belong to the post, separately from visitor discussions.
// Render them as inert text, including HTML-looking examples and private links.
export function sentenceComments(comments) {
	const items = (Array.isArray(comments) ? comments : [])
		.filter((comment) => comment && typeof comment === 'object' && !comment.deletedAt)
		.filter((comment) => typeof comment.body === 'string' && comment.body.trim())
		.filter(
			(comment) => typeof comment.selectedText === 'string' && comment.selectedText.trim()
		);
	if (!items.length) return '';
	return `<section class="sentence-comments" aria-label="문장 코멘트"><h2>문장 코멘트</h2><ol>${items.map((comment) => `<li><blockquote>${esc(comment.selectedText)}</blockquote><p>${esc(comment.body)}</p></li>`).join('')}</ol></section>`;
}
