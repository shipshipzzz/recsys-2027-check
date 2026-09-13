/** Read a complete, ordered result set; never silently accept a server row cap. */
export async function readPages(
  requestPage,
  { pageSize = 500, maxRows = 10000, keyOf = (row) => row.id } = {},
) {
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1000 ||
    !Number.isInteger(maxRows) ||
    maxRows < pageSize
  )
    throw new Error('Invalid pagination bounds');
  const rows = [],
    seen = new Set();
  let total;
  for (;;) {
    const { data, error, count } = await requestPage(rows.length, pageSize);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('云端分页响应无效');
    if (count !== null && count !== undefined) {
      if (
        !Number.isInteger(count) ||
        count < 0 ||
        count > maxRows ||
        (total !== undefined && total !== count)
      )
        throw new Error('云端数据在读取期间发生变化或超出安全上限，请重试');
      total = count;
    }
    for (const row of data) {
      const key = keyOf(row);
      if (key === null || key === undefined || seen.has(key))
        throw new Error('云端分页包含重复或无效标识');
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > maxRows || (total !== undefined && rows.length > total))
      throw new Error('云端数据数量不一致');
    if (total !== undefined && rows.length === total) return rows;
    if (!data.length) {
      if (total !== undefined) throw new Error('云端数据读取不完整');
      return rows;
    }
    if (total === undefined && data.length < pageSize) return rows;
    if (rows.length >= maxRows) throw new Error('云端数据超出安全上限');
  }
}
