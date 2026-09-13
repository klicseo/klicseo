import { expect, it, vi } from 'vitest';
import { readAllRows } from '../db-pagination';

it('reads beyond the API row cap without skipping or repeating records', async () => {
  const rows = Array.from({ length: 1251 }, (_, id) => ({ id }));
  const range = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
  expect(await readAllRows({ range })).toEqual(rows);
  expect(range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});

it('propagates page failures instead of returning an incomplete successful result', async () => {
  const range = vi.fn(async () => ({ data: null, error: new Error('Database unavailable') }));
  await expect(readAllRows({ range })).rejects.toThrow('Database unavailable');
});
