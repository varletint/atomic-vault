import { Router } from "express";
import { SeoController } from "../controllers/SeoController.js";

const router = Router();

// Sitemap index + individual sub-sitemaps (mounted at root level)
router.get("/sitemap.xml", SeoController.getSitemapIndex);
router.get("/sitemap-static.xml", SeoController.getStaticSitemap);
router.get("/sitemap-products.xml", SeoController.getProductsSitemap);
router.get("/sitemap-categories.xml", SeoController.getCategoriesSitemap);

// Robots.txt
router.get("/robots.txt", SeoController.getRobotsTxt);

// Meta API (full path defined here since router is mounted at "/")
router.get("/api/seo/meta", SeoController.getPageMeta);

export default router;
