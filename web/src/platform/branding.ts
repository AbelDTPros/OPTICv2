/** User-facing product name and release label (package/DB ids stay optic-nextgen). */
export const PRODUCT_NAME = 'OPTIC';
export const PRODUCT_VERSION = '2.0';
export const PRODUCT_TITLE = `${PRODUCT_NAME} ${PRODUCT_VERSION}`;

export function documentTitleForView(viewTitle: string): string {
  return `${PRODUCT_TITLE} — ${viewTitle}`;
}
