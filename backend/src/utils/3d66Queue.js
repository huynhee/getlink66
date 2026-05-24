import { createAsyncLimiter } from "./asyncLimiter.js";

const getlinkLimiter = createAsyncLimiter({
  envName: "THREED66_GETLINK_CONCURRENCY",
  fallback: 1,
  maxQueue: Number(process.env.THREED66_GETLINK_QUEUE_MAX || 200),
});

const previewLimiter = createAsyncLimiter({
  envName: "THREED66_PREVIEW_CONCURRENCY",
  fallback: 1,
  maxQueue: Number(process.env.THREED66_PREVIEW_QUEUE_MAX || 200),
});

const refreshLimiter = createAsyncLimiter({
  envName: "THREED66_REFRESH_CONCURRENCY",
  fallback: 1,
  maxQueue: Number(process.env.THREED66_REFRESH_QUEUE_MAX || 200),
});

export function queue3D66Getlink(task) {
  return getlinkLimiter.run(task);
}

export function queue3D66Preview(task) {
  return previewLimiter.run(task);
}

export function queue3D66Refresh(task) {
  return refreshLimiter.run(task);
}

export function get3D66GetlinkQueueStatus() {
  return {
    getlink: getlinkLimiter.stats(),
    preview: previewLimiter.stats(),
    refresh: refreshLimiter.stats(),
  };
}
