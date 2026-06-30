// ─────────────────────────────────────────────────────────────────────────────
//  Supplier-name canonicalization utilities
//
//  Supplier ↔ product association historically relied on exact, case- and
//  whitespace-sensitive string equality of the free-text `proveedor` field.
//  That made matching fragile: "Beauty System", "beauty system " and
//  "BEAUTY  SYSTEM" were treated as three different suppliers, so product
//  lists silently went missing on supplier pages.
//
//  These helpers give the WHOLE app one canonical way to clean and compare
//  supplier names. Use `supplierKey()` (or `productSupplierKey()`) anywhere two
//  supplier names are compared or grouped, and `resolveSupplierName()` /
//  `cleanSupplierName()` for storage and display.
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback name used when a product has no supplier. */
export const DEFAULT_SUPPLIER_NAME = 'General';

/**
 * Clean a supplier name for STORAGE / DISPLAY.
 *  - replaces zero-width / BOM / non-breaking-space characters with a space
 *  - collapses internal runs of whitespace to a single space
 *  - trims the ends
 * Casing and accents are preserved so the original label still reads naturally.
 */
export function cleanSupplierName(name?: string | null): string {
  return (name ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ') // zero-width + BOM + nbsp
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical MATCHING key for a supplier name.
 *
 * Two names that refer to the same supplier always produce the same key,
 * regardless of case, surrounding / duplicated whitespace, accents or hidden
 * characters. This is the single source of truth for supplier comparisons.
 */
export function supplierKey(name?: string | null): string {
  return cleanSupplierName(name)
    .normalize('NFKD') // separate base letters from their accent marks
    .replace(/[\u0300-\u036f]/g, '') // strip the accent marks
    .toLowerCase();
}

/**
 * Resolve a product's effective supplier name for DISPLAY, applying the default
 * ("General") when the value is empty after cleaning.
 */
export function resolveSupplierName(name?: string | null): string {
  return cleanSupplierName(name) || DEFAULT_SUPPLIER_NAME;
}

/**
 * Matching key for a PRODUCT's supplier, honouring the default fallback so that
 * products with no supplier consistently group under "General".
 */
export function productSupplierKey(name?: string | null): string {
  return supplierKey(resolveSupplierName(name));
}
