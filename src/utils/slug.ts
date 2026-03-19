export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateUniqueSlug(
  baseSlug: string,
  existingSlugs: string[],
): string {
  let slug = baseSlug;
  let counter = 1;

  while (existingSlugs.includes(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

export function slugify(
  text: string,
  options?: { maxLength?: number; suffix?: string },
): string {
  const { maxLength = 100, suffix } = options || {};

  let slug = generateSlug(text);

  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength).replace(/-+$/, "");
  }

  if (suffix) {
    const suffixSlug = generateSlug(suffix);
    const maxBaseLength = maxLength - suffixSlug.length - 1;
    if (slug.length > maxBaseLength) {
      slug = slug.substring(0, maxBaseLength).replace(/-+$/, "");
    }
    slug = `${slug}-${suffixSlug}`;
  }

  return slug;
}
