export interface ReviewComment {
	id: string;
	parent: string;
	author: string;
	date: string;
	text: string;
	page: number;
}
export interface ReviewRow extends ReviewComment {
	depth: number;
	group: 'Comments' | 'Missing parents' | 'Cycles';
}
export interface Filters { author: string; from: string; to: string }
export const EMPTY_FILTERS: Filters = { author: '', from: '', to: '' };
function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	const str = record(value).str;
	return typeof str === 'string' ? str.trim() : '';
}
/** PDF dates use a local offset. Output uses UTC. Invalid dates stay unknown. */
export function savedDate(value: unknown): string {
	if (typeof value !== 'string' || !value) return '';
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		const local = value.slice(0, 19).split(/[-T:]/).map(Number);
		const [year, month, day, hour, minute, second] = local as [number, number, number, number, number, number];
		const check = new Date(Date.UTC(year, month - 1, day));
		if (year < 100 || month < 1 || month > 12 || day < 1 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return '';
		const d = new Date(value);
		return Number.isFinite(d.getTime()) ? d.toISOString() : '';
	}
	const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Z+-])(?:(\d{2})'?(\d{2})'?)?)?$/.exec(value);
	if (!m) return '';
	const y = Number(m[1]), month = Number(m[2] ?? 1), day = Number(m[3] ?? 1);
	const h = Number(m[4] ?? 0), min = Number(m[5] ?? 0), sec = Number(m[6] ?? 0);
	const oh = Number(m[8] ?? 0), om = Number(m[9] ?? 0);
	if (y < 100 || month < 1 || month > 12 || day < 1 || h > 23 || min > 59 || sec > 59 || oh > 23 || om > 59) return '';
	const d = new Date(Date.UTC(y, month - 1, day, h, min, sec));
	if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
	const offset = (oh * 60 + om) * 60000 * (m[7] === '-' ? -1 : 1);
	return new Date(d.getTime() - offset).toISOString();
}
export function parseAnnotations(values: unknown[], page: number): ReviewComment[] {
	const result: ReviewComment[] = [];
	const types = new Set(['Text', 'FreeText', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Redact']);
	for (const [i, value] of values.entries()) {
		const a = record(value);
		if (!types.has(text(a.subtype)) || a.replyType === 'Group') continue;
		const contents = text(a.contentsObj) || text(a.contents);
		const parent = text(a.inReplyTo);
		// Empty markup can still be the parent of a reply.
		result.push({ id: text(a.id) || `page-${page}-record-${i}`, parent, author: text(a.titleObj) || text(a.title) || 'Unknown author', date: savedDate(a.modificationDate) || savedDate(a.creationDate), text: contents, page });
	}
	return result;
}
export function filterComments(comments: ReviewComment[], filters: Filters, pro: boolean): ReviewComment[] {
	if (!pro) return comments;
	return comments.filter((c) => {
		const day = c.date.slice(0, 10);
		return (!filters.author.trim() || c.author === filters.author.trim()) && (!day || ((!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)));
	});
}
/** Iterative traversal keeps deep or cyclic reply chains off the call stack. */
export function groupComments(comments: ReviewComment[]): ReviewRow[] {
	const ids = new Map<string, ReviewComment>();
	for (const c of comments) if (!ids.has(c.id)) ids.set(c.id, c);
	const children = new Map<string, ReviewComment[]>();
	const compare = (a: ReviewComment, b: ReviewComment) => Number(!a.date) - Number(!b.date) || a.date.localeCompare(b.date) || a.page - b.page || a.id.localeCompare(b.id);
	for (const c of ids.values()) {
		const list = children.get(c.parent) ?? [];
		list.push(c);
		children.set(c.parent, list);
	}
	for (const list of children.values()) list.sort(compare);
	const result: ReviewRow[] = [], seen = new Set<string>();
	const visit = (root: ReviewComment, group: ReviewRow['group']) => {
		const stack = [{ c: root, depth: 0 }];
		while (stack.length) {
			const item = stack.pop()!;
			if (seen.has(item.c.id)) continue;
			seen.add(item.c.id);
			result.push({ ...item.c, depth: item.depth, group });
			const replies = children.get(item.c.id) ?? [];
			for (let i = replies.length - 1; i >= 0; i--) stack.push({ c: replies[i]!, depth: item.depth + 1 });
		}
	};
	const sorted = [...ids.values()].sort(compare);
	for (const c of sorted) if (!c.parent) visit(c, 'Comments');
	for (const c of sorted) if (c.parent && !ids.has(c.parent)) visit(c, 'Missing parents');
	for (const c of sorted) if (!seen.has(c.id)) {
		// Find the cycle before traversal so an early-dated child stays under its parent.
		const chain: ReviewComment[] = [], positions = new Map<string, number>();
		let current = c;
		while (!positions.has(current.id)) {
			positions.set(current.id, chain.length);
			chain.push(current);
			current = ids.get(current.parent)!;
		}
		const cycle = chain.slice(positions.get(current.id));
		visit(cycle.sort(compare)[0]!, 'Cycles');
	}
	// Remove blank, unrelated markup; retain blank ancestors needed for a discussion.
	const needed = new Set<string>();
	for (const c of ids.values()) if (c.text) {
		let current: ReviewComment | undefined = c;
		const chain = new Set<string>();
		while (current && !chain.has(current.id) && !needed.has(current.id)) { chain.add(current.id); needed.add(current.id); current = ids.get(current.parent); }
	}
	return result.filter((c) => needed.has(c.id));
}
export function escapeMarkdown(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&');
}
export function sourceLink(path: string, page: number): string {
	return `[Page ${page}](<${path.split('/').map(encodeURIComponent).join('/')}#page=${page}>)`;
}
export function renderReview(path: string, rows: ReviewRow[]): string {
	const lines = ['# PDF review', '', `Source: ${sourceLink(path, 1)}`, ''];
	let group = '';
	for (const row of rows) {
		if (row.group !== group) {
			group = row.group;
			lines.push(`## ${group}`, '');
			if (group === 'Cycles') lines.push('A parent cycle was found. These records appear once.', '');
		}
		const indent = '  '.repeat(Math.min(row.depth, 20));
		lines.push(`${indent}- **${escapeMarkdown(row.author)}** · ${row.date || 'Unknown date'} · ${sourceLink(path, row.page)}`);
		for (const line of (row.text || '(No comment text)').split(/\r?\n/)) lines.push(`${indent}  ${escapeMarkdown(line)}`);
		if (row.depth > 20) lines.push(`${indent}  Reply depth: ${row.depth}`);
		lines.push('');
	}
	return lines.join('\n');
}
export function safeName(value: string): string {
	return Array.from(value).filter((c) => c.charCodeAt(0) > 31).join('').replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim().replace(/\.+$/g, '').trim() || 'Review';
}
export function newPath(folder: string, name: string, exists: (path: string) => boolean): string {
	const base = `${folder && folder !== '/' ? folder + '/' : ''}${safeName(name)}`;
	let path = `${base}.md`, n = 2;
	while (exists(path)) path = `${base} (${n++}).md`;
	return path;
}
export function exportDecision(cancelled: boolean, count: number): string {
	return cancelled ? 'Cancelled' : count === 0 ? 'No comments' : 'Write new note';
}
export function evalVector(fn: string, args: unknown[]): unknown {
	switch (fn) {
		case 'date': return savedDate(args[0]);
		case 'parse': return parseAnnotations(args[0] as unknown[], args[1] as number);
		case 'groups': return groupComments(args[0] as ReviewComment[]).map((c) => [c.id, c.depth, c.group]);
		case 'filter': return filterComments(args[0] as ReviewComment[], args[1] as Filters, args[2] as boolean).map((c) => c.id);
		case 'escape': return escapeMarkdown(args[0] as string);
		case 'link': return sourceLink(args[0] as string, args[1] as number);
		case 'path': return newPath(args[0] as string, args[1] as string, (p) => (args[2] as string[]).includes(p));
		case 'decision': return exportDecision(args[0] as boolean, args[1] as number);
		default: throw new Error('Unknown vector');
	}
}
