import { createHash } from 'node:crypto';
import { giscusCss } from './giscus.mjs';
import { esc, js } from './text.mjs';
import { themeOrder } from './theme-data.mjs';

export function createDiscussions({
	site,
	owner,
	repo,
	publicBase,
	posts,
	absolute,
	write,
	tmoneyFontPath,
	linkedPostTitle,
}) {
	const discussionsEnabled = site.githubDiscussionsEnabled === true;
	const reactions = [
		['+1', '👍', 'Thumbs Up'],
		['-1', '👎', 'Thumbs Down'],
		['laugh', '😄', 'Laugh'],
		['hooray', '🎉', 'Hooray'],
		['confused', '😕', 'Confused'],
		['heart', '❤️', 'Heart'],
		['rocket', '🚀', 'Rocket'],
		['eyes', '👀', 'Eyes'],
	];
	const nodeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_=-]{1,200}$/.test(value);
	const discussionSetup = (() => {
		if (!discussionsEnabled) return null;
		const setup = site.githubDiscussionConfig;
		let base;
		try {
			base = new URL(publicBase);
		} catch {
			return null;
		}
		if (
			base.protocol !== 'https:' ||
			base.username ||
			base.password ||
			!/^[a-zA-Z0-9-]+$/.test(owner) ||
			!/^[a-zA-Z0-9_.-]+$/.test(repo) ||
			setup?.repository?.toLowerCase() !== `${owner}/${repo}`.toLowerCase() ||
			!nodeId(setup.repositoryId) ||
			!nodeId(setup.categoryId) ||
			typeof setup.categoryName !== 'string' ||
			!setup.categoryName.trim()
		)
			return null;
		return {
			repo: `${owner}/${repo}`,
			repoId: setup.repositoryId,
			category: setup.categoryName,
			categoryId: setup.categoryId,
		};
	})();
	const discussionFor = (id) => {
		const entry = site.githubDiscussionMap?.[id];
		return discussionSetup &&
			Number.isSafeInteger(entry?.number) &&
			entry.number > 0 &&
			entry.number <= 2147483647 &&
			nodeId(entry.nodeId) &&
			nodeId(entry.authorId)
			? entry
			: null;
	};

	const giscusThemeUrls = {};
	const protectedGiscusThemeUrls = {};
	if (discussionSetup)
		for (const name of themeOrder) {
			giscusThemeUrls[name] = {};
			protectedGiscusThemeUrls[name] = {};
			for (const mode of ['light', 'dark']) {
				const css = giscusCss(name, mode, { absolute, tmoneyFontPath });
				const digest = createHash('sha256').update(css).digest('hex').slice(0, 16);
				const file = `assets/giscus/${name}-${mode}-${digest}.css`;
				write(file, css);
				giscusThemeUrls[name][mode] = absolute(`/${file}`);
				if (posts.some((post) => post.protectedEnvelope)) {
					// Upstream Giscus.tsx: h4.gsc-comments-count inside .gsc-left-header.
					// A separate accessible description accompanies the iframe below.
					const protectedCss =
						css +
						'\n.gsc-left-header{align-items:baseline;flex-wrap:wrap}.gsc-comments-count::after{content:"댓글은 암호화되지 않습니다.";display:block;margin-top:.35rem;color:var(--color-fg-muted);font-size:calc(.875rem * var(--layall-type-scale));font-weight:400;line-height:1.5;white-space:normal}';
					const protectedDigest = createHash('sha256')
						.update(protectedCss)
						.digest('hex')
						.slice(0, 16);
					const protectedFile = `assets/giscus/${name}-${mode}-protected-${protectedDigest}.css`;
					write(protectedFile, protectedCss);
					protectedGiscusThemeUrls[name][mode] = absolute(`/${protectedFile}`);
				}
			}
		}
	const protectedDiscussionConfig = (post) => {
		const mapping = discussionFor(post.postId);
		return mapping
			? {
					...discussionSetup,
					number: mapping.number,
					url: absolute(`/posts/${encodeURIComponent(post.postId)}/`),
					themes: protectedGiscusThemeUrls,
					lang: String(site.locale || 'ko').startsWith('ko') ? 'ko' : 'en',
				}
			: null;
	};
	const discussionBehavior = (options) => {
		if (!options.article || !discussionFor(options.discussionPostId)) return '';
		const post = posts.find((post) => post.postId === options.discussionPostId);
		const config = {
			...discussionSetup,
			post: {
				id: post.postId,
				title: String(post.title || 'Untitled'),
				...discussionFor(post.postId),
			},
			themes: giscusThemeUrls,
			lang: String(site.locale || 'ko').startsWith('ko') ? 'ko' : 'en',
		};
		return `<script type="application/json" data-discussion-config>${js(config)}</script>`;
	};
	const discussionSection = (post) =>
		!discussionsEnabled
			? ''
			: `<section class="discussion-thread" data-post-discussion="${esc(post.postId)}" aria-label="댓글과 반응">${discussionFor(post.postId) ? '<p class="muted" data-discussion-status role="status">댓글·반응 불러오는 중…</p><button type="button" data-discussion-retry hidden>다시 시도</button><div class="giscus" id="comments"></div><noscript><p class="muted">댓글과 반응을 보려면 JavaScript를 켜 주세요.</p></noscript>' : '<p class="muted" role="status">댓글 연결이 준비되지 않았습니다. 블로그 소유자가 댓글 설정을 저장한 뒤 게시해 주세요.</p>'}</section>`;

	const snapshotCounts = (post) => {
		const mapping = discussionFor(post.postId);
		const snapshot = site.githubReactionSnapshot?.posts?.[post.postId];
		if (
			!mapping ||
			snapshot?.discussionId !== mapping.nodeId ||
			!reactions.every(
				([key]) => Number.isSafeInteger(snapshot.counts?.[key]) && snapshot.counts[key] >= 0
			)
		)
			return null;
		return snapshot.counts;
	};
	const verifiedUnmapped = (post) => {
		const snapshot = site.githubReactionSnapshot?.posts?.[post.postId];
		return Boolean(
			post.protectedEnvelope &&
			discussionSetup &&
			!Object.hasOwn(site.githubDiscussionMap ?? {}, post.postId) &&
			snapshot?.status === 'unmapped' &&
			Object.keys(snapshot).length === 1
		);
	};
	const reactionOverview = () => {
		if (!discussionsEnabled) return '';
		const capturedAt = site.githubReactionSnapshot?.capturedAt;
		const complete =
			Number.isSafeInteger(capturedAt) &&
			capturedAt > 0 &&
			Number.isFinite(new Date(capturedAt).getTime()) &&
			posts.every((post) => snapshotCounts(post) || verifiedUnmapped(post));
		if (!complete)
			return '<section class="home-reaction"><h2>Reaction</h2><p class="muted" role="status">반응 집계가 준비되지 않았습니다. 블로그를 업데이트해 주세요.</p></section>';
		const controls = reactions
			.map(([key, emoji, label], index) => {
				const total = posts.reduce(
					(sum, post) => sum + (snapshotCounts(post)?.[key] ?? 0),
					0
				);
				return `<button type="button" data-reaction-kind="${key}" aria-pressed="${index === 0}" aria-label="${label} 순위 · ${total}개 반응"><span class="reaction-emoji" aria-hidden="true">${emoji}</span><span class="reaction-total" aria-hidden="true">${total}</span></button>`;
			})
			.join('');
		const panels = reactions
			.map(([key, , label], index) => {
				const ranked = posts
					.flatMap((post) => {
						const counts = snapshotCounts(post);
						return counts ? [{ post, count: counts[key] }] : [];
					})
					.filter((entry) => entry.count > 0)
					.sort(
						(a, b) =>
							b.count - a.count ||
							(a.post.postId < b.post.postId
								? -1
								: a.post.postId > b.post.postId
									? 1
									: 0)
					)
					.slice(0, 5);
				const list = ranked.length
					? `<ol class="reaction-ranking">${ranked.map(({ post, count }) => `<li><span class="linked-post-title">${linkedPostTitle(post)}</span><span class="reaction-ranking-count" aria-label="${label} ${count}">${count}</span></li>`).join('')}</ol>`
					: `<p class="reaction-empty muted">아직 ${esc(label)} 반응이 없습니다.</p>`;
				return `<div data-reaction-panel="${key}" aria-label="${label} Top 5"${index ? ' hidden' : ''}><h3 class="reaction-panel-label">${esc(label)} Top 5</h3>${list}</div>`;
			})
			.join('');
		return `<section class="home-reaction" data-reaction-ranking><h2>Reaction</h2><div class="reaction-layout"><div class="reaction-selector" role="group" aria-label="반응별 순위">${controls}</div><div class="reaction-results">${panels}</div></div></section>`;
	};
	return {
		discussionsEnabled,
		discussionBehavior,
		discussionSection,
		protectedDiscussionConfig,
		reactionOverview,
	};
}
