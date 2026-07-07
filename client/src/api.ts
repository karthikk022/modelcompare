import type { Model } from './types';

const BASE = '/api';

export async function fetchModels(): Promise<Model[]> {
  const res = await fetch(`${BASE}/models`);
  const data = await res.json();
  return data.models;
}

export async function fetchModel(id: string): Promise<Model> {
  const res = await fetch(`${BASE}/models/${id}`);
  const data = await res.json();
  return data.model;
}

export async function compareModels(ids: string[]): Promise<Model[]> {
  const res = await fetch(`${BASE}/compare?ids=${ids.join(',')}`);
  const data = await res.json();
  return data.models;
}

export async function recommendForTask(task: string): Promise<Model[]> {
  const res = await fetch(`${BASE}/recommend?task=${encodeURIComponent(task)}`);
  const data = await res.json();
  return data.models;
}

export async function deleteModel(id: string): Promise<void> {
  await fetch(`${BASE}/models/${id}`, { method: 'DELETE' });
}
