// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const localPreviewHost = "id-preview--6ca03c0f-fa5e-4568-a501-36c392f809a8.lovable.app";

// The OAuth broker lives on Lovable's edge. In local dev, resolve it on the server
// and send the browser straight to Google, then back to 127.0.0.1.
function localOAuthBroker(): Plugin {
  return {
    name: "local-oauth-broker",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ?? "";
        if (requestUrl.split("?")[0] !== "/~oauth/initiate") return next();
        try {
          let current = `https://${localPreviewHost}${requestUrl}`;
          for (let hop = 0; hop < 4; hop += 1) {
            const upstream = await fetch(current, { redirect: "manual" });
            const location = upstream.headers.get("location");
            if (!location) break;
            const nextUrl = new URL(location, current);
            if (nextUrl.protocol !== "https:") break;
            current = nextUrl.toString();
            if (nextUrl.hostname === "accounts.google.com") break;
            if (nextUrl.hostname !== "oauth.lovable.app" && !nextUrl.hostname.endsWith(".lovable.app")) break;
          }
          res.statusCode = 302;
          res.setHeader("Location", current);
          res.end();
        } catch (error) {
          server.config.logger.warn(`local oauth broker failed: ${error instanceof Error ? error.message : String(error)}`);
          res.statusCode = 502;
          res.end();
        }
      });
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [localOAuthBroker()],
  },
});
