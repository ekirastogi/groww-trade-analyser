import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { Observable, interval, startWith, switchMap, from, map, catchError, of } from 'rxjs';

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
const WORKER_POLL_MS = 60 * 1000;
const JOB_POLL_MS = 2000;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class WorkerJobService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  /** Polls worker/status instead of a snapshot listener (1 read per interval). */
  watchWorkerOnline(pollMs = WORKER_POLL_MS): Observable<boolean> {
    const ref = doc(this.firestore, 'worker', 'status');
    return interval(pollMs).pipe(
      startWith(0),
      switchMap(() => from(getDoc(ref))),
      map((snap) => {
        const status = snap.data() as WorkerStatus | undefined;
        if (!status?.lastSeen) return false;
        return Date.now() - status.lastSeen < WORKER_ONLINE_MS;
      }),
      catchError(() => of(false))
    );
  }

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
