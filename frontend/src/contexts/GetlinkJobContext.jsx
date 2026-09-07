import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

const GetlinkJobContext = createContext(null);
const ACTIVE_STATUSES = new Set(["queued", "processing", "awaiting_format"]);

export function GetlinkJobProvider({ children }) {
  const [userId, setUserId] = useState("");
  const [currentPage, setCurrentPage] = useState("");
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const identityRef = useRef("");
  const versionRef = useRef(0);
  const pendingRefreshRef = useRef(null);
  const pendingActionRef = useRef(false);
  const hasActiveJob = ACTIVE_STATUSES.has(job?.status);

  useEffect(() => () => {
    versionRef.current += 1;
    pendingRefreshRef.current?.controller.abort();
    pendingRefreshRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!userId || identityRef.current !== userId || pendingActionRef.current) return null;
    if (pendingRefreshRef.current) return null;
    const version = versionRef.current;
    const controller = new AbortController();
    const request = api("/api/getlink/jobs/latest", { signal: controller.signal });
    pendingRefreshRef.current = { promise: request, controller };
    try {
      const data = await request;
      if (version !== versionRef.current) return null;
      setJob(data.job || null);
      setError("");
      return data.job || null;
    } catch (refreshError) {
      if (version !== versionRef.current || controller.signal.aborted) return null;
      setError(refreshError.message || "Cannot load the getlink job.");
      return null;
    } finally {
      if (pendingRefreshRef.current?.promise === request) pendingRefreshRef.current = null;
    }
  }, [userId]);

  useEffect(() => {
    setLoading(Boolean(userId));
    let active = true;
    refresh().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const delay = hasActiveJob && currentPage === "getlink" ? 2_000 : 10_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, delay);
    return () => window.clearInterval(timer);
  }, [currentPage, hasActiveJob, refresh, userId]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  const runAction = useCallback(async (path, options = {}) => {
    const identity = identityRef.current;
    const version = ++versionRef.current;
    pendingRefreshRef.current?.controller.abort();
    pendingRefreshRef.current = null;
    pendingActionRef.current = true;
    setActionLoading(true);
    setError("");
    try {
      const data = await api(path, options);
      if (version !== versionRef.current || identity !== identityRef.current) {
        throw new DOMException("Account or job changed", "AbortError");
      }
      setJob(data.job || null);
      return data.job || null;
    } catch (actionError) {
      if (version !== versionRef.current || identity !== identityRef.current) {
        throw new DOMException("Account or job changed", "AbortError");
      }
      if (actionError.data?.job) setJob(actionError.data.job);
      setError(actionError.message || "Getlink job action failed.");
      throw actionError;
    } finally {
      if (version === versionRef.current) {
        pendingActionRef.current = false;
        setActionLoading(false);
      }
    }
  }, []);

  const createJob = useCallback(async (payload) => {
    try {
      return await runAction("/api/getlink/jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (createError) {
      if (createError.code === "GETLINK_JOB_ACTIVE" && createError.data?.job) {
        setError("");
        return createError.data.job;
      }
      throw createError;
    }
  }, [runAction]);

  const chooseFormat = useCallback((jobId, formatKey) => runAction(`/api/getlink/jobs/${jobId}/format`, {
    method: "POST",
    body: JSON.stringify({ formatKey }),
  }), [runAction]);

  const retryJob = useCallback((jobId) => runAction(`/api/getlink/jobs/${jobId}/retry`, {
    method: "POST",
    body: JSON.stringify({}),
  }), [runAction]);

  const cancelJob = useCallback((jobId) => runAction(`/api/getlink/jobs/${jobId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  }), [runAction]);

  const acknowledgeJob = useCallback(async (jobId) => {
    const acknowledged = await runAction(`/api/getlink/jobs/${jobId}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (acknowledged?.id === jobId) setJob(null);
    return acknowledged;
  }, [runAction]);

  const setIdentity = useCallback((nextUserId) => {
    const next = String(nextUserId || "");
    if (next === identityRef.current) return;
    identityRef.current = next;
    versionRef.current += 1;
    pendingRefreshRef.current?.controller.abort();
    pendingRefreshRef.current = null;
    pendingActionRef.current = false;
    setJob(null);
    setError("");
    setActionLoading(false);
    setUserId(next);
  }, []);

  const setRoute = useCallback((nextPage) => {
    setCurrentPage(String(nextPage || ""));
  }, []);

  const value = useMemo(() => ({
    job,
    loading,
    actionLoading,
    error,
    isActive: Boolean(job && ACTIVE_STATUSES.has(job.status)),
    setIdentity,
    setRoute,
    refresh,
    createJob,
    chooseFormat,
    retryJob,
    cancelJob,
    acknowledgeJob,
  }), [acknowledgeJob, actionLoading, cancelJob, chooseFormat, createJob, error, job, loading, refresh, retryJob, setIdentity, setRoute]);

  return <GetlinkJobContext.Provider value={value}>{children}</GetlinkJobContext.Provider>;
}

export function useGetlinkJob() {
  const context = useContext(GetlinkJobContext);
  if (!context) throw new Error("useGetlinkJob must be used inside GetlinkJobProvider.");
  return context;
}
