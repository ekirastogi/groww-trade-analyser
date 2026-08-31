import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';

export type WorkerJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type WorkerJobType = 'hot_ingest' | 'symbol_ingest' | 'seed_universe';

export interface WorkerJob {
  id: string;
  type: WorkerJobType;
  status: WorkerJobStatus;
  requestedBy: string;
  requestedAt: number;
  symbol?: string;
  startedAt?: number;
  completedAt?: number;
  symbolsIngested?: number;
  error?: string;
}

export interface WorkerStatus {
  status: string;
  lastSeen: number;
  service?: string;
}

const WORKER_ONLINE_MS = 10 * 60 * 1000;
const LISTEN_WINDOW_MS = 15 * 60 * 1000;
const JOB_POLL_MS = 2000;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

export interface WorkerListenState {
  active: boolean;
  until: number;
  requestedBy?: string;
  updatedAt?: number;
}

@Injectable({ providedIn: 'root' })
export class WorkerJobService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  /** One-shot check — no continuous polling. */
  async getWorkerOnline(): Promise<boolean> {
    try {
      const ref = doc(this.firestore, 'worker', 'status');
      const snap = await getDoc(ref);
      const status = snap.data() as WorkerStatus | undefined;
      if (!status?.lastSeen) return false;
      return Date.now() - status.lastSeen < WORKER_ONLINE_MS;
    } catch {
      return false;
    }
  }

  /** Opens a short listen window so the local worker polls Firestore on demand. */
  async requestListenWindow(durationMs = LISTEN_WINDOW_MS): Promise<void> {
    await this.auth.whenReady();
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to connect the worker');

    const now = Date.now();
    await setDoc(doc(this.firestore, 'worker', 'listen'), {
      active: true,
      until: now + durationMs,
      requestedBy: uid,
      updatedAt: now,
    });
  }

  async getListenState(): Promise<WorkerListenState | null> {
    try {
      const snap = await getDoc(doc(this.firestore, 'worker', 'listen'));
      if (!snap.exists()) return null;
      return snap.data() as WorkerListenState;
    } catch {
      return null;
    }
  }

  isListenActive(state: WorkerListenState | null | undefined): boolean {
    return !!state?.active && (state.until ?? 0) > Date.now();
  }

  async requestHotIngest(): Promise<string> {
    return this.requestJob('hot_ingest');
  }

  async requestSymbolIngest(symbol: string): Promise<string> {
    const sym = symbol.trim().toUpperCase();
    if (!sym) throw new Error('Symbol is required');
    return this.requestJob('symbol_ingest', sym);
  }

  async requestSeedUniverse(): Promise<string> {
    return this.requestJob('seed_universe');
  }

  private async requestJob(type: WorkerJobType, symbol?: string): Promise<string> {
    await this.auth.whenReady();
    const uid = this.auth.uid;
    if (!uid) throw new Error('Sign in to request market data ingest');

    await this.requestListenWindow();

    const jobId = crypto.randomUUID();
    const job: Omit<WorkerJob, 'id'> = {
      type,
      status: 'pending',
      requestedBy: uid,
      requestedAt: Date.now(),
      ...(symbol ? { symbol } : {}),
    };
    await setDoc(doc(this.firestore, 'workerJobs', jobId), job);
    return jobId;
  }

  async waitForJob(jobId: string, timeoutMs = JOB_TIMEOUT_MS): Promise<WorkerJob> {
    const ref = doc(this.firestore, 'workerJobs', jobId);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        throw new Error('Worker job not found');
      }
      const job = { id: snap.id, ...snap.data() } as WorkerJob;
      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }
      await new Promise((r) => setTimeout(r, JOB_POLL_MS));
    }
    throw new Error('Timed out waiting for worker to finish ingest');
  }
}
