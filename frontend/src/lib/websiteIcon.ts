export function getWebsiteIconSources(url: string): string[] {
  try {
    const origin = new URL(url).origin;
    return [
      `${origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(origin)}&sz=64`,
    ];
  } catch {
    return [];
  }
}
