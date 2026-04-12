import { type Request, type Response, type NextFunction } from "express";
import { Product } from "../models/Product.js";

const BOT_AGENTS = [
  "whatsapp",
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "linkedinbot",
  "pinterest",
  "slackbot",
  "telegrambot",
  "googlebot",
  "bingbot",
  "applebot",
  "discordbot",
];

const SITE_NAME = "Atomic Order";

function isBot(userAgent: string): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_AGENTS.some((bot) => ua.includes(bot));
}

interface PageMeta {
  title: string;
  description: string;
  url: string;
  image: string;
  type: string;
}

function generateHTML(meta: PageMeta): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta.title}</title>
  <meta name="description" content="${meta.description}">

  <!-- Open Graph -->
  <meta property="og:type" content="${meta.type}">
  <meta property="og:url" content="${meta.url}">
  <meta property="og:title" content="${meta.title}">
  <meta property="og:description" content="${meta.description}">
  <meta property="og:image" content="${meta.image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="${SITE_NAME}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${meta.title}">
  <meta name="twitter:description" content="${meta.description}">
  <meta name="twitter:image" content="${meta.image}">
</head>
<body>
  <h1>${meta.title}</h1>
  <p>${meta.description}</p>
</body>
</html>`;
}

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/": {
    title: `${SITE_NAME} - Seamless Order Management`,
    description:
      "Discover and order quality products on Atomic Order. Your premier platform for seamless purchasing, secure checkout, and reliable delivery tracking.",
  },
  "/login": {
    title: `Login | ${SITE_NAME}`,
    description:
      "Sign in to your Atomic Order account to manage your orders, track deliveries, and access your personalized dashboard. Secure login with full account protection.",
  },
  "/register": {
    title: `Create Account | ${SITE_NAME}`,
    description:
      "Join Atomic Order today. Create your free account to start shopping, track orders, and enjoy a seamless purchasing experience with secure transactions.",
  },
  "/products": {
    title: `Products | ${SITE_NAME}`,
    description:
      "Browse our curated catalog of quality products on Atomic Order. Find the best deals across multiple categories with fast checkout and reliable delivery.",
  },
  "/forgot-password": {
    title: `Reset Password | ${SITE_NAME}`,
    description:
      "Forgot your password? Reset it securely in a few simple steps. We will send you a verification code to help you regain access to your Atomic Order account.",
  },
};

async function getProductMeta(
  slug: string,
  siteUrl: string,
  defaultImage: string
): Promise<PageMeta | null> {
  try {
    const product = await Product.findOne({ slug, isActive: true });
    if (!product) return null;

    const description = product.description
      ? product.description.substring(0, 200)
      : `Buy ${product.name} on ${SITE_NAME}. Quality products with secure checkout and reliable delivery.`;

    const primaryImage =
      product.images.find((img) => img.isPrimary) ?? product.images[0];
    const image = primaryImage?.url || defaultImage;

    return {
      title: `${product.name} | ${SITE_NAME}`,
      description,
      image,
      type: "product",
      url: `${siteUrl}/products/${product.slug}`,
    };
  } catch {
    return null;
  }
}

export function ogBotMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userAgent = req.headers["user-agent"] || "";

  if (!isBot(userAgent)) {
    return next();
  }

  const siteUrl = process.env.SITE_URL || "http://localhost:5173";
  const defaultImage = `${siteUrl}/og-default.png`;
  const pathname = req.path;

  (async () => {
    let meta: PageMeta | null = null;

    const productMatch = pathname.match(/^\/products\/([a-zA-Z0-9_-]+)$/);
    if (productMatch) {
      meta = await getProductMeta(productMatch[1], siteUrl, defaultImage);
    }

    if (!meta) {
      const pageMeta = PAGE_META[pathname] || PAGE_META["/"];
      meta = {
        title: pageMeta.title,
        description: pageMeta.description,
        url: `${siteUrl}${pathname}`,
        image: defaultImage,
        type: "website",
      };
    }

    const html = generateHTML(meta);

    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=3600")
      .send(html);
  })().catch(next);
}
