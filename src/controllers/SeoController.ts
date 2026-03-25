import { type Request, type Response, type NextFunction } from "express";
import { Product } from "../models/Product.js";

// In-memory sitemap cache (10-minute TTL)
const sitemapCache = new Map<string, { xml: string; generatedAt: number }>();
const SITEMAP_TTL_MS = 10 * 60 * 1000;

function getCachedSitemap(key: string): string | null {
  const cached = sitemapCache.get(key);
  if (cached && Date.now() - cached.generatedAt < SITEMAP_TTL_MS) {
    return cached.xml;
  }
  return null;
}

function setCachedSitemap(key: string, xml: string) {
  sitemapCache.set(key, { xml, generatedAt: Date.now() });
}

export class SeoController {
  /**
   * Sitemap index — references individual sub-sitemaps.
   * Google recommends splitting sitemaps when URLs exceed 50K.
   */
  public static async getSitemapIndex(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const siteUrl = process.env.SITE_URL || "http://localhost:5173";
      const apiBase = process.env.API_BASE_URL || "http://localhost:3000";

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap>
        <loc>${apiBase}/sitemap-static.xml</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
    </sitemap>
    <sitemap>
        <loc>${apiBase}/sitemap-products.xml</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
    </sitemap>
    <sitemap>
        <loc>${apiBase}/sitemap-categories.xml</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
    </sitemap>
</sitemapindex>`;

      res.set("Content-Type", "application/xml");
      res.send(xml);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Static pages sitemap — indexable, public-facing routes.
   */
  public static async getStaticSitemap(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const cached = getCachedSitemap("static");
      if (cached) {
        res.set("Content-Type", "application/xml");
        return res.send(cached);
      }

      const siteUrl = process.env.SITE_URL || "http://localhost:5173";

      const staticRoutes = [
        { path: "", changefreq: "daily", priority: "1.0" },
        { path: "/products", changefreq: "daily", priority: "0.9" },
        { path: "/login", changefreq: "monthly", priority: "0.3" },
        { path: "/register", changefreq: "monthly", priority: "0.3" },
      ];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

      for (const route of staticRoutes) {
        xml += `
  <url>
    <loc>${siteUrl}${route.path}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`;
      }

      xml += `\n</urlset>`;

      setCachedSitemap("static", xml);
      res.set("Content-Type", "application/xml");
      res.send(xml);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Products sitemap — all active products with slugs.
   */
  public static async getProductsSitemap(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const cached = getCachedSitemap("products");
      if (cached) {
        res.set("Content-Type", "application/xml");
        return res.send(cached);
      }

      const siteUrl = process.env.SITE_URL || "http://localhost:5173";

      const products = await Product.find({ isActive: true })
        .select("slug updatedAt")
        .lean();

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

      for (const product of products) {
        if (product.slug) {
          xml += `
  <url>
    <loc>${siteUrl}/products/${product.slug}</loc>
    <lastmod>${
      new Date(product.updatedAt).toISOString().split("T")[0]
    }</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
        }
      }

      xml += `\n</urlset>`;

      setCachedSitemap("products", xml);
      res.set("Content-Type", "application/xml");
      res.send(xml);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Categories sitemap — derived from product categories via aggregation.
   */
  public static async getCategoriesSitemap(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const cached = getCachedSitemap("categories");
      if (cached) {
        res.set("Content-Type", "application/xml");
        return res.send(cached);
      }

      const siteUrl = process.env.SITE_URL || "http://localhost:5173";

      const categories = await Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$category" } },
      ]);

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

      for (const cat of categories) {
        const slug = cat._id
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        xml += `
  <url>
    <loc>${siteUrl}/products?category=${slug}</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`;
      }

      xml += `\n</urlset>`;

      setCachedSitemap("categories", xml);
      res.set("Content-Type", "application/xml");
      res.send(xml);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Dynamic robots.txt.
   */
  public static getRobotsTxt(req: Request, res: Response, next: NextFunction) {
    try {
      const apiBase = process.env.API_BASE_URL || "http://localhost:3000";

      const robotsTxt = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${apiBase}/sitemap.xml
`;

      res.type("text/plain");
      res.send(robotsTxt);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Returns SEO metadata for specific routes.
   * Handles both static routes and dynamic product pages.
   */
  public static async getPageMeta(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const path = req.query.path as string;

      if (!path) {
        return res
          .status(400)
          .json({ error: "Path query parameter is required" });
      }

      // Default meta
      const defaultMeta = {
        title: "Atomic Order",
        description: "Seamless order management platform.",
      };

      // Handle product pages: /products/some-slug
      if (path.startsWith("/products/") && path.length > 10) {
        const slug = path.replace("/products/", "");
        const product = await Product.findOne({ slug, isActive: true });

        if (product) {
          return res.json({
            title: `${product.name} | Atomic Order`,
            description: product.description.substring(0, 160),
          });
        }
      }

      // Static routes metadata
      const routeMeta: Record<string, { title: string; description: string }> =
        {
          "/": {
            title: "Home | Atomic Order",
            description:
              "Welcome to Atomic Order, the best place for your purchases.",
          },
          "/products": {
            title: "Products | Atomic Order",
            description: "Browse our catalog of awesome products.",
          },
          "/login": {
            title: "Login | Atomic Order",
            description: "Log in to your Atomic Order account.",
          },
          "/register": {
            title: "Register | Atomic Order",
            description: "Create your Atomic Order account.",
          },
          "/cart": {
            title: "Shopping Cart | Atomic Order",
            description: "View the items in your cart.",
          },
        };

      const meta = routeMeta[path] || defaultMeta;
      res.json(meta);
    } catch (error) {
      next(error);
    }
  }
}
