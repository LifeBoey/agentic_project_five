/** File name stem for a model's brief. Shared by the UI and scripts/draft-briefs.ts. */
export const briefSlug = (model: string) =>
  model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
