import { describe, expect, test } from "bun:test";
import { currentUrl } from "../src/shared/domains";
import { fromMovedHost, receiveHandover } from "../src/worker/moved";

const OLD = "https://kanban.infopanel.org";
const KEY = "AbCd1234EfGh5678";

describe("currentUrl", () => {
  test("moves old-host URLs and leaves others alone", () => {
    expect(currentUrl(new URL(`${OLD}/p/x/abc?card=1#h`)).href).toBe("https://kban.dev/p/x/abc?card=1#h");
    expect(currentUrl(new URL("http://localhost:8787/p/x")).href).toBe("http://localhost:8787/p/x");
  });
});

describe("fromMovedHost", () => {
  test("ignores the current host", () => {
    expect(fromMovedHost(new Request("https://kban.dev/"))).toBeNull();
  });

  test("redirects API calls and downloads with 308", () => {
    const res = fromMovedHost(new Request(`${OLD}/api/p/abc/ops?x=1`, { method: "POST", body: "{}" }))!;
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://kban.dev/api/p/abc/ops?x=1");
    expect(fromMovedHost(new Request(`${OLD}/install`))!.headers.get("Location")).toBe("https://kban.dev/install");
  });

  test("keeps serving WebSockets", () => {
    expect(fromMovedHost(new Request(`${OLD}/api/p/abc/ws`, { headers: { Upgrade: "websocket" } }))).toBeNull();
  });

  test("browsers get a page that hands keys over in a POST body", async () => {
    const res = fromMovedHost(new Request(`${OLD}/p/x/abc?card=2`, { headers: { "Sec-Fetch-Mode": "navigate" } }))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBe("origin");
    const body = await res.text();
    expect(body).toContain('method="post" action="https://kban.dev/moved"');
    expect(body).toContain('"https://kban.dev/p/x/abc?card=2"');
  });
});

describe("receiveHandover", () => {
  const handover = (fields: Record<string, string>, origin = OLD) =>
    receiveHandover(new Request("https://kban.dev/moved", { method: "POST", headers: { Origin: origin }, body: new URLSearchParams(fields) }));

  test("only accepts keys from the old host", async () => {
    expect((await handover({ keys: "{}", path: "/" }, "https://evil.example")).status).toBe(403);
    expect((await handover({ keys: "{}", path: "/" }, "null")).status).toBe(403);
  });

  test("keeps valid keys and local paths only", async () => {
    const body = await (await handover({ keys: JSON.stringify({ abc: KEY, bad: "nope", "x y": KEY }), path: "//evil.example/" })).text();
    expect(body).toContain(`{"abc":"${KEY}"}`);
    expect(body).not.toContain("nope");
    expect(body).toContain('location.replace("/")');
    const ok = await (await handover({ keys: "{}", path: "/p/x/abc?card=2" })).text();
    expect(ok).toContain('location.replace("/p/x/abc?card=2")');
  });

  test("escapes script content", async () => {
    const body = await (await handover({ keys: "{}", path: "/</script><script>alert(1)" })).text();
    expect(body).not.toContain("</script><script>alert");
  });
});
