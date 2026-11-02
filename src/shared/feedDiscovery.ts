import { xProfile } from './xFeed';

export function normalizeFeedUrl(input: string): string | null {
  const profile = xProfile(input);
  if (profile) return profile.url;
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const hasProtocol = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (!hasProtocol && !/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(value)) return null;
  try {
    const url = new URL(hasProtocol ? value : `https://${value}`);
    return /^https?:$/.test(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function matchesFeedSearch(feed: { title: string; description: string; category: string; tags: string[]; htmlUrl: string; xmlUrl: string }, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [feed.title, feed.description, feed.category, ...feed.tags, feed.htmlUrl, feed.xmlUrl].join(' ').toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}
