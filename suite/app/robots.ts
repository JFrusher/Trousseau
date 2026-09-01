import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

/**
 * A guest link in a search index is the one genuinely damaging leak available
 * here, so `/seat` is refused twice: the page sets `robots: noindex` itself,
 * and it is disallowed here as well. The fragment that decrypts it would never
 * reach a crawler, but the token and the names it resolves to would.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/seat/", "/api/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
