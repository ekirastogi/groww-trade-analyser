import { Injectable } from '@angular/core';

export interface HotIngestResponse {
  status: string;
  symbolsIngested: number;
}

export interface WorkerHealth {
  status: string;
  firebaseEnabled?: boolean;
  ingestInterval?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:8080';

@Injectable({ providedIn: 'root' })
export class BackendWorkerService {
  private baseUrl = DEFAULT_BASE_URL;

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    const trimmed = url.trim().replace(/\/$/, '');
    this.baseUrl = trimmed || DEFAULT_BASE_URL;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kairo-backend-url', this.baseUrl);
    }
  }

  loadSavedBaseUrl(): void {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem('kairo-backend-url');
    if (saved) this.baseUrl = saved;
  }

  async checkHealth(): Promise<WorkerHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      if (!res.ok) return null;
      return (await res.json()) as WorkerHealth;
    } catch {
      return null;
    }
  }

  async triggerHotIngest(): Promise<HotIngestResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/ingest/hot`, { method: 'POST' });
      if (!res.ok) return null;
      return (await res.json()) as HotIngestResponse;
    } catch {
      return null;
    }
  }
}
