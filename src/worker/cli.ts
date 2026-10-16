/** Serving the kanban CLI: the script itself and a one-line installer. */

/** The bundled CLI from static assets, with this deployment's origin as its default server. */
export async function serveCli(assets: Fetcher, origin: string): Promise<Response> {
  const res = await assets.fetch(new Request(new URL("/kanban.js", origin)));
  // A missing asset falls back to the SPA's index.html; never serve that as the script.
  if (!res.ok || res.headers.get("Content-Type")?.includes("text/html")) {
    return new Response("// The kanban CLI isn't available on this deployment.\n", { status: 503 });
  }
  const script = (await res.text()).replaceAll("__KANBAN_ORIGIN__", origin);
  return new Response(script, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

/** `curl -fsSL <origin>/install | sh` installs the CLI to ~/.local/bin (or $KANBAN_INSTALL_DIR). */
export function installScript(origin: string): Response {
  const script = `#!/bin/sh
# Installs the kanban CLI from ${origin}
# Usage: curl -fsSL ${origin}/install | sh
set -eu

DIR="\${KANBAN_INSTALL_DIR:-$HOME/.local/bin}"

if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  RUNTIME=node
elif command -v bun >/dev/null 2>&1; then
  RUNTIME=bun
else
  echo "kanban: needs Node.js 18+ or Bun. Install one of them and re-run this script." >&2
  exit 1
fi

mkdir -p "$DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL "${origin}/kanban.js" -o "$WORK/download"
if [ "$(head -c 2 "$WORK/download")" != "#!" ]; then
  echo "kanban: the download from ${origin}/kanban.js doesn't look like the CLI. Try again in a minute." >&2
  exit 1
fi
# Point the shebang at whichever runtime is available, and check it runs before replacing anything.
{ echo "#!/usr/bin/env $RUNTIME"; tail -n +2 "$WORK/download"; } > "$WORK/kanban"
chmod +x "$WORK/kanban"
if ! VERSION="$("$WORK/kanban" --version)"; then
  echo "kanban: the downloaded CLI failed to run with $RUNTIME." >&2
  exit 1
fi
mv "$WORK/kanban" "$DIR/kanban"

echo "Installed $VERSION to $DIR/kanban"
case ":$PATH:" in
  *":$DIR:"*) ;;
  *) echo "Add it to your PATH:  export PATH=\\"$DIR:\\$PATH\\"" ;;
esac
echo "Next: kanban init <project-url>   (or: kanban new \\"Project title\\")"
`;
  return new Response(script, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8" } });
}
