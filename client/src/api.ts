import type { Model } from './types';

const BASE = '/api';

export async function fetchModels(): Promise<Model[]> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error('Failed to fetch models');
  const data = await res.json();
  return data.models;
}

export async function createModel(m: Partial<Model>): Promise<Model> {
  const res = await fetch(`${BASE}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(m),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to create model'); }
  const data = await res.json();
  return data.model;
}

export async function updateModel(id: string, m: Partial<Model>): Promise<Model> {
  const res = await fetch(`${BASE}/models/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(m),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to update model'); }
  const data = await res.json();
  return data.model;
}

export async function compareModels(ids: string[]): Promise<Model[]> {
  const res = await fetch(`${BASE}/compare?ids=${ids.map(encodeURIComponent).join(',')}`);
  if (!res.ok) throw new Error('Failed to compare models');
  const data = await res.json();
  return data.models;
}

export async function recommendForTask(task: string): Promise<{ models: Model[] }> {
  const res = await fetch(`${BASE}/recommend?task=${encodeURIComponent(task)}`);
  if (!res.ok) throw new Error('Failed to recommend models');
  return res.json();
}

export async function deleteModel(id: string): Promise<void> {
  const res = await fetch(`${BASE}/models/${id}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to delete'); }
}

export interface DiscoveryResult {
  models: (Model & { _source: string; likes?: number; downloads?: number; _alreadyAdded?: boolean })[];
  source: string;
  count: number;
}

export async function discoverModels(source: string = 'all', limit: number = 50): Promise<DiscoveryResult> {
  const res = await fetch(`${BASE}/discover?source=${source}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to discover models');
  return res.json();
}

export async function addModelFromDiscovery(m: Model & { _source?: string }): Promise<void> {
  const { _source, likes, downloads, _alreadyAdded, ...rest } = m as any;
  const res = await fetch(`${BASE}/models`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  if (!res.ok) throw new Error('Failed to add model from discovery');
}

export interface PromptResult {
  results: {
    id: string; name: string; slug?: string; content: string | null;
    finishReason: string | null; latency: number; inTokens: number;
    outTokens: number; cost: number | null; error?: string; _empty?: boolean;
  }[];
  prompt?: string;
}

export async function testPrompt(models: string[], prompt: string, systemPrompt?: string, maxTokens?: number, temperature?: number, webSearch?: boolean): Promise<PromptResult> {
  const res = await fetch(`${BASE}/test-prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models, prompt, systemPrompt, maxTokens, temperature, webSearch }),
  });
  if (!res.ok) throw new Error('Failed to test prompt');
  return res.json();
}

export async function getUsage(): Promise<{ id: number; modelId: string; modelName: string; totalTokens: number; cost: number; latencyMs: number; timestamp: string }[]> {
  const res = await fetch(`${BASE}/usage/history`);
  if (!res.ok) throw new Error('Failed to fetch usage history');
  const data = await res.json();
  return data.usage || [];
}

export async function getSettings(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function setSetting(key: string, value: string): Promise<void> {
  const res = await fetch(`${BASE}/settings/${key}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error('Failed to set setting');
}

export async function exportModels(format: 'json' | 'csv'): Promise<string> {
  const res = await fetch(`${BASE}/models/export?format=${format}`);
  if (!res.ok) throw new Error('Failed to export models');
  return res.text();
}
