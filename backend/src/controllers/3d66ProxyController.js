import {
  get3D66ProxyConfiguration,
  get3D66WarpHealth,
} from "../utils/3d66ProxyPolicy.js";

async function proxyStatus({ force = false } = {}) {
  const config = get3D66ProxyConfiguration();
  const health = config.mode === "warp"
    ? await get3D66WarpHealth({ force })
    : null;
  return { config, health };
}

export async function get3D66WarpStatus(_req, res, next) {
  try {
    res.json({ proxy: await proxyStatus() });
  } catch (error) {
    next(error);
  }
}

export async function test3D66Warp(_req, res, next) {
  try {
    res.json({ proxy: await proxyStatus({ force: true }) });
  } catch (error) {
    next(error);
  }
}
