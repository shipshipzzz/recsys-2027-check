/** Shared identity contract. Existing card IDs and storage keys never change. */
export const KINDS = Object.freeze(['rec', 'soe', 'div']);
export const LEGACY_KINDS = Object.freeze(['rec', 'soe']);
export const CARD_ID = /^(rec|soe|div)-[a-f0-9]{20}$/;
export const PAGE_FILES = Object.freeze({ rec: 'index.html', soe: 'soe.html', div: 'div.html' });
export const THEME_KEYS = Object.freeze({
  rec: 'recsys-theme',
  soe: 'soe-personal-theme',
  div: 'div-personal-theme',
});
export const SOURCE_PREFIXES = Object.freeze({ rec: 'R', soe: 'S', div: null });
export const HISTORY_SOURCES = Object.freeze({ rec: 'H01', soe: 'H02', div: null });
export const STATIC_CATALOG_ASSETS = Object.freeze({
  soe: ['soe', 'soe-screening', 'soe-locations', 'soe-directory', 'soe-opportunities'],
  div: ['div', 'div-screening'],
});
