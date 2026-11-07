// The signed list of downloadable add-ons, published with each GitHub release.
// A hijacked link or mirror cannot add or swap an add-on: the catalog is signed with the release key, and
// each download must match the catalog's SHA-256 and then pass the normal add-on signature check.
const crypto = require('crypto');
const format = require('./addon-format');

const CATALOG_URL = 'https://github.com/m72b/Tool-Hub/releases/latest/download/catalog.json';
const ALLOWED_DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_CATALOG = 2 * 1024 * 1024;
const MAX_ADDON = 512 * 1024 * 1024;
const TIMEOUT_MS = 20000;

function fail(message) { throw new format.AddonError(message); }

function signCatalog(entries, privateKeyPem) {
  const body = JSON.stringify({ format: 1, generatedAt: new Date().toISOString(), addons: entries });
  const signature = crypto.sign(null, Buffer.from(body, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return JSON.stringify({ body, signature });
}

// Only the keys built into the app may sign the catalog; personal keys cannot publish to everyone.
function verifyCatalog(text, builtInKeys) {
  let wrapper;
  try { wrapper = JSON.parse(text); } catch { fail('The add-on list is damaged'); }
  if (typeof wrapper?.body !== 'string' || typeof wrapper?.signature !== 'string') fail('The add-on list is damaged');
  const signature = Buffer.from(wrapper.signature, 'base64');
  const trusted = builtInKeys.some(entry => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(entry.publicKey, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, Buffer.from(wrapper.body, 'utf8'), key, signature);
    } catch { return false; }
  });
  if (!trusted) fail('The add-on list is not signed by the Tool Hub release key');
  const catalog = JSON.parse(wrapper.body);
  if (catalog.format !== 1 || !Array.isArray(catalog.addons)) fail('This add-on list needs a newer Tool Hub');
  return catalog.addons.filter(entry => format.ID_PATTERN.test(entry?.id || '') && typeof entry.url === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256 || ''));
}

async function fetchWithTimeout(fetchImpl, url, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    if (signal?.aborted) throw err;
    fail('Could not reach GitHub. Check your internet connection.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  return null;
}

async function fetchCatalog({ fetchImpl = fetch, url = CATALOG_URL, builtInKeys }) {
  const response = await fetchWithTimeout(fetchImpl, url);
  if (response.status === 404) fail('No add-on list has been published yet.');
  if (!response.ok) fail(`GitHub returned ${response.status} for the add-on list`);
  const text = await response.text();
  if (text.length > MAX_CATALOG) fail('The add-on list is too large');
  return verifyCatalog(text, builtInKeys);
}

function checkDownloadUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { fail('The download link is invalid'); }
  if (parsed.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) fail('The download link is not on GitHub');
}

// Downloads an add-on and returns its bytes once they match the signed catalog entry.
async function downloadAddon({ fetchImpl = fetch, entry, onProgress, signal }) {
  checkDownloadUrl(entry.url);
  const response = await fetchWithTimeout(fetchImpl, entry.url, signal);
  if (!response.ok) fail(`GitHub returned ${response.status} for ${entry.name || entry.id}`);
  if (response.url) checkDownloadUrl(response.url);
  const chunks = [];
  let received = 0;
  const total = Number(entry.size) || Number(response.headers?.get?.('content-length')) || 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > MAX_ADDON) fail('The download is too large');
    chunks.push(Buffer.from(chunk));
    if (onProgress) onProgress({ id: entry.id, received, total });
  }
  const buffer = Buffer.concat(chunks);
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== entry.sha256) fail(`${entry.name || entry.id} did not match the signed add-on list`);
  return buffer;
}

module.exports = { CATALOG_URL, signCatalog, verifyCatalog, fetchCatalog, downloadAddon };
