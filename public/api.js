export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(data.error || r.statusText);
    e.status = r.status;
    throw e;
  }
  return data;
}

let versionsCache = null;
export async function getVersions() {
  if (!versionsCache) versionsCache = api('/versions').catch(() => { versionsCache = null; return []; });
  return versionsCache;
}
