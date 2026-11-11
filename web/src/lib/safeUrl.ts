/** Source URLs come from research output, so only http(s) links are ever made clickable. */
export const isSafeUrl = (u: string): boolean => /^https?:\/\//i.test(u);
