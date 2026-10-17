import { readConfig } from './config.mjs';
import { mountDiscussion } from './discussions.mjs';
import { registerWorker } from './pwa.mjs';
import { mountSite } from './site.mjs';
const config = readConfig('[data-site-config]');
if (config) {
	mountSite(config);
	registerWorker(config.pwa);
	const discussion = readConfig('[data-discussion-config]');
	if (discussion) mountDiscussion(discussion);
}
