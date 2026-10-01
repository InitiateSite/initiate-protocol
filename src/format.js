const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const fmtUsd = (n) => (Number.isFinite(n) ? usdCompact.format(n) : '—');
export const fmtUsdFull = (n) => (Number.isFinite(n) ? usdFull.format(n) : '—');
export const fmtInt = (n) => (Number.isFinite(n) ? int.format(Math.round(n)) : '—');
export const fmtDay = (unixSeconds) => day.format(new Date(unixSeconds * 1000));

// Gas on this chain is a fraction of a gwei, so the precision follows the size.
export function fmtGwei(gwei) {
  if (!Number.isFinite(gwei)) return '—';
  const digits = gwei < 1 ? 4 : gwei < 100 ? 3 : 2;
  return gwei.toFixed(digits);
}

export function fmtPct(p, digits = 1) {
  if (!Number.isFinite(p)) return '—';
  const s = Math.abs(p).toFixed(digits);
  return `${p < 0 ? '−' : '+'}${s}%`;
}

export function fmtAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return 'moments ago';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export const shortHost = (url) => {
  try { return new URL(url).host; } catch { return ''; }
};
