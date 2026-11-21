/**
 * Word-level diff (LCS) for side-by-side display.
 * Returns { before: [{ text, removed }], after: [{ text, added }] } where text includes trailing spaces.
 */
export function wordDiff(a = '', b = '') {
  const x = a.split(/(\s+)/).filter(Boolean);
  const y = b.split(/(\s+)/).filter(Boolean);
  const n = x.length;
  const m = y.length;
  // LCS table (resume texts are short; O(n·m) is fine).
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const before = [];
  const after = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      before.push({ text: x[i] });
      after.push({ text: y[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      before.push({ text: x[i], removed: !/^\s+$/.test(x[i]) });
      i += 1;
    } else {
      after.push({ text: y[j], added: !/^\s+$/.test(y[j]) });
      j += 1;
    }
  }
  while (i < n) before.push({ text: x[i], removed: !/^\s+$/.test(x[i++]) });
  while (j < m) after.push({ text: y[j], added: !/^\s+$/.test(y[j++]) });
  return { before, after };
}
