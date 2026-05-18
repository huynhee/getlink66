import { createAsyncLimiter } from "./asyncLimiter.js";

const getlinkLimiter = createAsyncLimiter({
  envName: "THREED66_GETLINK_CONCURRENCY",
  fallback: 1,
  maxQueue: Number(process.env.THREED66_GETLINK_QUEUE_MAX || 200),
});

export function queue3D66Getlink(task) {
  return getlinkLimiter.run(task);
}

export function get3D66GetlinkQueueStatus() {
  return getlinkLimiter.stats();
}
