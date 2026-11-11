// Common codes for the cut-off picker. The API accepts any ISO code, and the picker also lists
// every country found in the current model's chains.
export const COUNTRIES: Record<string, string> = {
  CN: 'China',
  US: 'United States',
  KR: 'South Korea',
  JP: 'Japan',
  TW: 'Taiwan',
  DE: 'Germany',
};

export const countryName = (code: string): string => COUNTRIES[code.toUpperCase()] ?? code;

/** "battery cells" -> "Battery cells". Component names arrive lowercase from the data. */
export const label = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
