import { describe, expect, it } from 'vitest';
import vectors from './vectors.json';
import { evalVector } from '../src/logic';
describe('golden vectors', () => {
 it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 for (const c of vectors.cases) it(c.name, () => { const [fn, args] = c.args; expect(evalVector(fn as string, args as unknown[])).toEqual(c.expected); });
});

// Only the factory has the source vector. The exported tree uses its local copy.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('../../packages/spec/vectors/pdf-reply-export.json');
it.skipIf(!existsSync(source))('local vectors equal the factory source', () => {
 expect(vectors).toEqual(JSON.parse(readFileSync(source, 'utf8')));
});
