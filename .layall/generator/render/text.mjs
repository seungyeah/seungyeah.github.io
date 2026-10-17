const esc = (value) =>
	String(value ?? '').replace(
		/[&<>\"]/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[character]
	);
const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const safeExternal = (value) => {
	try {
		const url = new URL(String(value ?? ''));
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
};
const isInternalHostname = (value) => {
	const hostname = String(value ?? '')
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '');
	if (!hostname || hostname === 'localhost' || /\.(?:localhost|local|internal)$/.test(hostname))
		return true;
	const ipv4 = hostname.split('.').map(Number);
	if (
		ipv4.length === 4 &&
		ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
	) {
		const [first, second] = ipv4;
		return (
			first === 0 ||
			first === 10 ||
			first === 127 ||
			(first === 100 && second >= 64 && second <= 127) ||
			(first === 169 && second === 254) ||
			(first === 172 && second >= 16 && second <= 31) ||
			(first === 192 && second === 168) ||
			first >= 224
		);
	}
	if (hostname.includes(':'))
		return (
			hostname === '::' ||
			hostname === '::1' ||
			/^f[cd]/.test(hostname) ||
			/^fe[89ab]/.test(hostname)
		);
	return !hostname.includes('.');
};
const safeSocialImage = (value) => {
	try {
		const url = new URL(String(value ?? ''));
		return url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			!isInternalHostname(url.hostname)
			? url.href
			: null;
	} catch {
		return null;
	}
};
const plainText = (value) =>
	String(value ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2')
		.replace(/[#>*_`~-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const excerpt = (value, limit = 180) => {
	const text = plainText(value);
	return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
};
const slugify = (value) => {
	const slug = String(value ?? '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-|-$/g, '');
	return slug || 'section';
};
const tagSegment = (value) => `t-${Buffer.from(String(value), 'utf8').toString('hex')}`;

export {
	esc,
	excerpt,
	isInternalHostname,
	js,
	plainText,
	safeExternal,
	safeSocialImage,
	slugify,
	tagSegment,
};
