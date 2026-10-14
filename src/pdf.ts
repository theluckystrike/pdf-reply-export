import { loadPdfJs, type TFile, type Vault } from 'obsidian';
import { parseAnnotations, type ReviewComment } from './logic';

// These interfaces contain only the public PDF.js methods used here.
export interface PdfDocument {
	numPages: number;
	getPage(page: number): Promise<{ getAnnotations(options: { intent: string }): Promise<unknown[]> }>;
}
export interface PdfLibrary {
	getDocument(options: { data: Uint8Array; isEvalSupported: boolean; useWorkerFetch: boolean }): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
}
export async function readComments(vault: Pick<Vault, 'readBinary'>, file: TFile, loader: () => Promise<unknown> = loadPdfJs, signal?: AbortSignal): Promise<ReviewComment[]> {
	const checkCancelled = () => { if (signal?.aborted) throw new Error('PDF read cancelled.'); };
	checkCancelled();
	const bytes = new Uint8Array(await vault.readBinary(file));
	checkCancelled();
	const pdfjs = await loader() as PdfLibrary;
	checkCancelled();
	const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false });
	let destruction: Promise<void> | null = null;
	const destroy = () => destruction ??= task.destroy();
	const abort = () => { void destroy().catch(() => undefined); };
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	try {
		const doc = await task.promise;
		const comments: ReviewComment[] = [];
		for (let page = 1; page <= doc.numPages; page++) {
			checkCancelled();
			const proxy = await doc.getPage(page);
			for (const comment of parseAnnotations(await proxy.getAnnotations({ intent: 'any' }), page)) comments.push(comment);
		}
		return comments;
	} finally {
		signal?.removeEventListener('abort', abort);
		await destroy();
	}
}
