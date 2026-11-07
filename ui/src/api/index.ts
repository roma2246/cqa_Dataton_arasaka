// Выбор адаптера: VITE_API_MODE=mock — демо-бэкенд в браузере, иначе настоящий API.
import { httpApi } from './http';
import { mockApi } from './mock';
import type { CqaApi } from './types';

export const API_MODE: 'mock' | 'http' = import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'http';
export const api: CqaApi = API_MODE === 'mock' ? mockApi : httpApi;
export * from './types';
