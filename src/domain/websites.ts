import { WEBSITE_TITLE_LIMIT, WEBSITE_URL_LIMIT } from './types';

export type WebsiteFields = {
  url: string;
  title: string;
};

export type WebsiteEntryResult =
  | { ok: true; url: string; title: string }
  | { ok: false; message: string };

const RASTER_PATH = /\.(png|jpe?g|webp|gif|avif)$/i;

export function websiteEditsAllowed(readOnly: boolean): boolean {
  return !readOnly;
}

export function websiteFromExplicit(urlRaw: string, titleRaw: string): WebsiteEntryResult {
  const title = cleanTitle(titleRaw);
  if (title === null) {
    return { ok: false, message: titleRaw.trim().length > WEBSITE_TITLE_LIMIT ? 'That title is too long.' : 'That title cannot be used.' };
  }
  const url = canonicalWebsiteUrl(urlRaw, 'explicit');
  if (!url) return { ok: false, message: urlProblem(urlRaw) };
  return { ok: true, url, title: title || websiteHostname(url) };
}

export function websiteFromStandalone(value: string): WebsiteFields | null {
  const url = canonicalWebsiteUrl(value, 'absolute');
  if (!url || isRasterWebsiteUrl(url)) return null;
  return { url, title: websiteHostname(url) };
}

export function classifyLinkDrop(input: {
  uriList: string | null;
  plain: string | null;
  html: string | null;
}): WebsiteFields | null {
  const listed = uriListEntries(input.uriList);
  if (listed === 'many') return null;
  if (typeof listed === 'string') {
    const url = canonicalWebsiteUrl(listed, 'absolute');
    if (!url) return null;
    return { url, title: dropTitle(input.plain, input.html, url) };
  }
  const plain = input.plain?.trim() ?? '';
  if (!plain || /[\r\n]/.test(plain)) return null;
  const url = canonicalWebsiteUrl(plain, 'absolute');
  if (!url) return null;
  return { url, title: websiteHostname(url) };
}

export function standaloneHtmlBookmark(html: string): WebsiteFields | null {
  const trimmed = html.trim();
  const match = /^<a\b([^>]*)>([\s\S]*?)<\/a>$/i.exec(trimmed);
  if (!match) return null;
  const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(match[1] ?? '');
  const href = decodeEntities(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '').trim();
  const url = canonicalWebsiteUrl(href, 'absolute');
  if (!url || isRasterWebsiteUrl(url)) return null;
  const text = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const title = text && text !== url ? cleanTitle(text) : '';
  if (text && title === null) return null;
  return { url, title: title || websiteHostname(url) };
}

export function websiteHostname(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./i, '');
  const visible = host || parsed.host;
  return visible.length > WEBSITE_TITLE_LIMIT ? visible.slice(0, WEBSITE_TITLE_LIMIT) : visible;
}

export function isRasterWebsiteUrl(url: string): boolean {
  try {
    return RASTER_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function canonicalWebsiteUrl(value: string, mode: 'explicit' | 'absolute'): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > WEBSITE_URL_LIMIT || hasControl(trimmed) || /\s/.test(trimmed)) return null;
  if (trimmed.startsWith('//')) return null;
  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (mode !== 'explicit' || !bareHost(trimmed)) return null;
    candidate = `https://${trimmed}`;
  }
  if (candidate.length > WEBSITE_URL_LIMIT) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  if (url.href.length > WEBSITE_URL_LIMIT) return null;
  return url.href;
}

function urlProblem(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a website URL.';
  if (trimmed.length > WEBSITE_URL_LIMIT) return 'That address is too long.';
  if (hasControl(trimmed)) return 'That address cannot be used.';
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    if (url.username || url.password) return 'That address cannot include a username or password.';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Enter an http or https address.';
  } catch {
    return 'That address is not valid.';
  }
  return 'That address is not valid.';
}

function dropTitle(plain: string | null, html: string | null, url: string): string {
  const bookmark = html ? standaloneHtmlBookmark(html) : null;
  if (bookmark && bookmark.url === url && bookmark.title !== websiteHostname(url)) return bookmark.title;
  const text = plain?.trim() ?? '';
  if (!text || text === url || /[\r\n]/.test(text) || /^[a-z][a-z0-9+.-]*:/i.test(text)) return websiteHostname(url);
  return cleanTitle(text) || websiteHostname(url);
}

function uriListEntries(value: string | null): 'none' | 'many' | string {
  if (!value || !value.trim()) return 'none';
  const entries = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (entries.length === 0) return 'none';
  if (entries.length > 1) return 'many';
  return entries[0] ?? 'none';
}

function bareHost(value: string): boolean {
  const slash = value.search(/[/?#]/);
  const authority = slash === -1 ? value : value.slice(0, slash);
  const host = authority.replace(/:\d{1,5}$/, '');
  if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return false;
  if (host.toLowerCase() === 'localhost') return true;
  if (!host.includes('.')) return false;
  return /^[a-z0-9.-]+$/i.test(host);
}

function cleanTitle(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > WEBSITE_TITLE_LIMIT || hasControl(trimmed)) return null;
  return trimmed;
}

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
