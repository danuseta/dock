export function getWebsiteIconSources(url: string): string[] {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    return [
      `${origin}/apple-touch-icon.png`,
      `${origin}/favicon.svg`,
      `${origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(origin)}&sz=128`,
    ];
  } catch {
    return [];
  }
}
