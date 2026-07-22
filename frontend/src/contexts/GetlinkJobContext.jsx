import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  const refresh = useCallback(async () => {
    if (!userId) {
      setJob(null);
      setError("");
      return null;
    }
    try {
      const data = await api("/api/getlink/jobs/latest");
      setJob(data.job || null);
      setError("");
      return data.job || null;
    } catch (refreshError) {
      setError(refreshError.message || "Cannot load the getlink job.");
      return null;
    }
  }, [userId]);

  useEffect(() => {
    setLoading(Boolean(userId));
    refresh().finally(() => setLoading(false));
  }, [refresh, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const delay = currentPage === "getlink" ? 2_000 : 10_000;
    const timer = window.setInterval(refresh, delay);
    return () => window.clearInterval(timer);
  }, [currentPage, refresh, userId]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  const runAction = useCallback(async (path, options = {}) => {
    setActionLoading(true);
    setError("");
    try {
      const data = await api(path, options);
      setJob(data.job || null);
      return data.job || null;
    } catch (actionError) {
      if (actionError.data?.job) setJob(actionError.data.job);
      setError(actionError.message || "Getlink job action failed.");
      throw actionError;
    } finally {
      setActionLoading(false);
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
    setUserId(String(nextUserId || ""));
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
