// one collator for all name sorting; localeCompare per comparison is surprisingly expensive
export const collator = new Intl.Collator();
