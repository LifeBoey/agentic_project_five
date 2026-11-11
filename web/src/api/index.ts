import { createApi } from './client';

// Same origin in production (the Risk API serves this page). In dev, vite proxies /api to it.
export const api = createApi(import.meta.env.VITE_API_URL ?? '');
export { ApiError } from './client';
export * from './types';
