import crypto from "crypto";
import { Product } from "../models/index.js";

const CATEGORY_PREFIXES: Record<string, string> = {
  electronics: "ELEC",
  clothing: "CLTH",
  accessories: "ACCS",
  food: "FOOD",
  drinks: "DRNK",
  health: "HLTH",
  beauty: "BEAU",
  home: "HOME",
  sports: "SPRT",
  books: "BOOK",
  toys: "TOYS",
  automotive: "AUTO",
  garden: "GRDN",
  office: "OFFC",
  pets: "PETS",
};

function getCategoryPrefix(category: string): string {
  const normalized = category.toLowerCase().trim();
  return CATEGORY_PREFIXES[normalized] ?? normalized.slice(0, 4).toUpperCase();
}

function generateRandomSegment(length: number = 6): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .toUpperCase()
    .slice(0, length);
}

export async function generateSku(category: string): Promise<string> {
  const prefix = getCategoryPrefix(category);
  let sku: string;
  let exists = true;

  while (exists) {
    const segment = generateRandomSegment(6);
    sku = `${prefix}-${segment}`;
    exists = !!(await Product.exists({ sku }));
  }

  return sku!;
}

export function parseSku(
  sku: string
): { prefix: string; segment: string } | null {
  const parts = sku.split("-");
  if (parts.length !== 2) return null;

  return {
    prefix: parts[0]!,
    segment: parts[1]!,
  };
}

export { CATEGORY_PREFIXES };
