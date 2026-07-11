export type Platform = 'Adobe Stock' | 'Shutterstock' | 'Freepik' | 'Getty Images' | 'Draft';
export type AssetType = 'Photo' | 'Vector' | 'Illustration' | 'Video';
export type AiProvider = 'Gemini' | 'Groq';

export interface ApiKeyEntry {
  id: string;
  label: string;
  key: string;
  provider: AiProvider;
}

export interface GenerationSettings {
  platform: Platform;
  titleLength: string;
  keywordCount: number;
  prefix: string;
  suffix: string;
  negativeKeywords: string;
  apiKeys: ApiKeyEntry[];
  activeKeyId: string | null;
}

export interface ImageMetadata {
  id: string;
  file?: File;
  fileName?: string;
  userId?: string;
  preview: string;
  type: AssetType;
  title: string;
  description: string;
  keywords: string[];
  status: 'idle' | 'processing' | 'completed' | 'error';
  error?: string;
  createdAt?: any;
}

export interface ApiResponse {
  title: string;
  description: string;
  keywords: string[];
}
