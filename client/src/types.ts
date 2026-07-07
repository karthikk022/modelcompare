export interface Model {
  id: string;
  name: string;
  provider: string;
  family: string;
  logo: string;
  color: string;
  releaseDate: string;
  description: string;
  contextWindow: number | null;
  outputLimit: number | null;
  architecture: string;
  parameters: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
  speed: number | null;
  arenaElo: number | null;
  benchmarks: Record<string, number>;
  scores: Record<string, number>;
  features: string[];
  bestFor: string[];
  strengths: string;
  weaknesses: string;
  tags: string[];
  pipeline: string;
  openRouterSlug: string;
}
