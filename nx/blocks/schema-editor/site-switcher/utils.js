const RECENT_SITES_KEY = 'da-sites';
const RECENT_SITES_MAX = 10;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-_.]*$/i;
const AEM_HOST_PATTERN = /^[^.]+--([^.]+)--([^.]+)\.(?:aem|hlx)\.(?:page|live)$/i;
const AVATAR_COLORS = ['blue', 'seafoam', 'orange', 'pink', 'cyan', 'green', 'red', 'yellow'];
const HASH_BASE = 131;
const HASH_MODULUS = 2147483647;
const HASH_SPREAD = 7919;

const isName = (value) => NAME_PATTERN.test(value ?? '');

function fromSegments(segments) {
  const [org, site] = segments.filter(Boolean);
  if (!isName(org) || !isName(site)) return undefined;
  return { org: org.toLowerCase(), site: site.toLowerCase() };
}

function fromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const aemHost = url.hostname.match(AEM_HOST_PATTERN);
  if (aemHost) return fromSegments([aemHost[2], aemHost[1]]);
  return fromSegments(url.hash.replace(/^#/, '').split('/'));
}

/**
 * Parses free-form site input: `org/site`, `/org/site/path`,
 * a DA URL with an `#/org/site` hash, or an AEM `ref--site--org` host.
 */
export function parseSiteInput(value) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return fromUrl(trimmed);
  return fromSegments(trimmed.split('/'));
}

export const toSiteKey = ({ org, site }) => `${org}/${site}`;

export function getRecentSites() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_SITES_KEY)) ?? [];
    return stored.map((key) => parseSiteInput(key)).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveRecentSite({ org, site }) {
  const key = toSiteKey({ org, site });
  const keys = getRecentSites().map(toSiteKey).filter((existing) => existing !== key);
  try {
    const next = [key, ...keys].slice(0, RECENT_SITES_MAX);
    localStorage.setItem(RECENT_SITES_KEY, JSON.stringify(next));
  } catch { /* storage disabled */ }
}

export function filterSites({ sites, query }) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return sites;
  return sites.filter((entry) => toSiteKey(entry).includes(needle));
}

export function getSiteInitials({ site }) {
  const words = site.split(/[-_.]/).filter(Boolean);
  const letters = words.length > 1 ? [words[0][0], words[1][0]] : [site[0], site[1]];
  return letters.filter(Boolean).join('').toUpperCase();
}

export function getSiteColor(entry) {
  const hash = [...toSiteKey(entry)]
    .reduce((acc, char) => (acc * HASH_BASE + char.charCodeAt(0)) % HASH_MODULUS, 0);
  // Dropping low digits avoids the poor spread of `hash % 8` for similar keys.
  return AVATAR_COLORS[Math.floor(hash / HASH_SPREAD) % AVATAR_COLORS.length];
}
