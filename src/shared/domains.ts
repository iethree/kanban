/** Where the app lives. */
export const ORIGIN = "https://kban.dev";

/** Hosts the app used to live on. They forward everything to ORIGIN, so old links, CLIs and config files keep working. */
export const MOVED_HOSTS = ["kanban.infopanel.org"];

/** `url` on ORIGIN if it points at a host the app moved from; otherwise `url` unchanged. */
export function currentUrl(url: URL): URL {
  if (!MOVED_HOSTS.includes(url.hostname)) return url;
  return new URL(url.pathname + url.search + url.hash, ORIGIN);
}
