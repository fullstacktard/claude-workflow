/**
 * useGeeLarkJobs - Tracks and polls active GeeLark account creation jobs.
 *
 * Only polls when there are active (status === "running") jobs.
 * Uses 5-second intervals for active job updates. Provides addJob/removeJob
 * for optimistic UI updates when initiating or clearing jobs.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { GeeLarkJob } from "../types/x-accounts";
import { dashboardFetch } from "../utils/dashboard-fetch";

/** Polling interval for active jobs (5 seconds) */
const JOB_POLL_INTERVAL = 5_000;

interface UseGeeLarkJobsReturn {
  /** Current list of tracked jobs (active + completed/failed) */
  jobs: GeeLarkJob[];
  /** True during an explicit refresh call */
  loading: boolean;
  /** Most recent poll error, null if last poll succeeded */
  error: Error | null;
  /** Optimistically add a job to the list (e.g., after POST /api/geelark/accounts/create) */
  addJob: (job: GeeLarkJob) => void;
  /** Remove a job from the tracked list (e.g., clear completed) */
  removeJob: (jobId: string) => void;
  /** Manually fetch all jobs from the server */
  refresh: () => Promise<void>;
}

export function useGeeLarkJobs(): UseGeeLarkJobsReturn {
  const [jobs, setJobs] = useState<GeeLarkJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const pollActiveJobs = useCallback(async (): Promise<void> => {
    const activeJobs = jobsRef.current.filter((j) => j.status === "running");
    if (activeJobs.length === 0) return;

    try {
      const updates = await Promise.all(
        activeJobs.map(async (job) => {
          const res = await dashboardFetch(`/api/geelark/jobs/${job.id}`, { skipErrorEvents: true });
          if (!res.ok) return job;
          return (await res.json()) as GeeLarkJob;
        })
      );
      if (mountedRef.current) {
        setJobs((prev) => {
          const updated = new Map(updates.map((j) => [j.id, j]));
          return prev.map((j) => updated.get(j.id) ?? j);
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const hasActive = jobs.some((j) => j.status === "running");
    if (!hasActive) return;

    const interval = setInterval(() => {
      pollActiveJobs().catch(console.error);
    }, JOB_POLL_INTERVAL);
    return () => {
      clearInterval(interval);
    };
  }, [pollActiveJobs, jobs]);

  // Cleanup mountedRef on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const addJob = useCallback((job: GeeLarkJob): void => {
    setJobs((prev) => [job, ...prev]);
  }, []);

  const removeJob = useCallback((jobId: string): void => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await dashboardFetch("/api/geelark/jobs", { skipErrorEvents: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GeeLarkJob[];
      if (mountedRef.current) {
        setJobs(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  return { jobs, loading, error, addJob, removeJob, refresh };
}
