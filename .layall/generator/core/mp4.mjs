/** Bounded ISO-BMFF structural check; never infer MP4/codecs from a name or MIME.
 * Kept in sync with src/lib/media/mp4.ts (the deployed generator is self-contained).
 * This is a container check, not a substitute for the platform's media decoder.
 */
export function inspectMp4(bytes) {
	if (bytes.length < 32 || bytes.length > 20 * 1024 * 1024) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const fourcc = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
	let remaining = 20_000;
	const boxes = (start, end) => {
		const result = [];
		while (start < end) {
			if (--remaining < 0 || start + 8 > end) throw new Error('Invalid MP4 box');
			let size = view.getUint32(start);
			let header = 8;
			if (size === 1) {
				if (start + 16 > end || view.getUint32(start + 8) !== 0)
					throw new Error('Oversized MP4 box');
				size = view.getUint32(start + 12);
				header = 16;
			} else if (size === 0) size = end - start;
			if (size < header || start + size > end) throw new Error('Truncated MP4 box');
			result.push({ type: fourcc(start + 4), start: start + header, end: start + size });
			start += size;
		}
		return result;
	};
	const aac = (start, end) => {
		const descriptor = (at) => {
			const tag = bytes[at++];
			let size = 0,
				count = 0,
				value;
			do {
				if (at >= end || count++ === 4) throw new Error('Invalid descriptor');
				value = bytes[at++];
				size = size * 128 + (value & 127);
			} while (value & 128);
			if (at + size > end) throw new Error('Truncated descriptor');
			return { tag, start: at, end: at + size };
		};
		const es = descriptor(start + 4); // FullBox followed by ES_Descriptor.
		if (es.tag !== 3 || es.start + 3 > es.end) return false;
		const flags = bytes[es.start + 2];
		let at = es.start + 3;
		if (flags & 128) at += 2;
		if (flags & 64) at += 1 + bytes[at];
		if (flags & 32) at += 2;
		const decoder = descriptor(at);
		if (
			decoder.tag !== 4 ||
			decoder.start + 13 > decoder.end ||
			decoder.end > es.end ||
			bytes[decoder.start] !== 64
		)
			return false;
		const config = descriptor(decoder.start + 13);
		return (
			config.tag === 5 &&
			config.end <= decoder.end &&
			config.end - config.start >= 2 &&
			[2, 5, 29].includes(bytes[config.start] >>> 3)
		);
	};
	try {
		const top = boxes(0, bytes.length);
		const ftyp = top[0];
		if (ftyp.type !== 'ftyp' || ftyp.end - ftyp.start < 8) return null;
		const brands = [fourcc(ftyp.start)];
		for (let at = ftyp.start + 8; at + 4 <= ftyp.end; at += 4) brands.push(fourcc(at));
		if (!brands.some((brand) => /^(isom|iso[2-9]|mp4[12]|avc1)$/.test(brand))) return null;
		const moov = top.find((box) => box.type === 'moov');
		if (!moov || !top.some((box) => box.type === 'mdat' && box.end > box.start)) return null;
		let video = 0,
			audio = 0,
			width = 0,
			height = 0;
		let audioCodec = '';
		for (const trak of boxes(moov.start, moov.end).filter((box) => box.type === 'trak')) {
			let parent = trak;
			for (const type of ['mdia', 'minf', 'stbl', 'stsd']) {
				const child = boxes(parent.start, parent.end).find((box) => box.type === type);
				if (!child) return null;
				parent = child;
			}
			if (parent.start + 8 > parent.end) return null;
			const entries = boxes(parent.start + 8, parent.end);
			if (entries.length !== 1 || view.getUint32(parent.start + 4) !== 1) return null;
			const entry = entries[0];
			if (entry.type === 'avc1' || entry.type === 'avc3') {
				if (entry.start + 78 > entry.end) return null;
				const config = boxes(entry.start + 78, entry.end).find(
					(box) => box.type === 'avcC'
				);
				if (!config || config.end - config.start < 7 || bytes[config.start] !== 1)
					return null;
				width = view.getUint16(entry.start + 24);
				height = view.getUint16(entry.start + 26);
				if (!width || !height || Math.max(width, height) > 4096) return null;
				video++;
			} else if (entry.type === 'mp4a' || entry.type === 'Opus') {
				if (entry.start + 28 > entry.end || view.getUint16(entry.start + 8) !== 0)
					return null;
				const config = boxes(entry.start + 28, entry.end).find(
					(box) => box.type === (entry.type === 'mp4a' ? 'esds' : 'dOps')
				);
				if (!config) return null;
				if (
					entry.type === 'mp4a'
						? !aac(config.start, config.end)
						: config.end - config.start < 11 ||
							bytes[config.start] !== 0 ||
							!bytes[config.start + 1]
				)
					return null;
				audioCodec = entry.type === 'mp4a' ? 'aac' : 'opus';
				audio++;
			} else return null;
		}
		return video === 1 && audio <= 1 ? { width, height, audio: audio === 1, audioCodec } : null;
	} catch {
		return null;
	}
}
