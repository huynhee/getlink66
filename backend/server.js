import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import passport from "passport";
import crypto from "node:crypto";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { closeDbConnections, connectDb, databaseHealth } from "./src/config/db.js";
import { buildHelmetOptions, validatedJsonBodyLimit } from "./src/config/httpSecurity.js";
import { assertProductionReadiness } from "./src/config/productionReadiness.js";
import { cookieSignatureSecret } from "./src/config/secrets.js";
import { isMemoryDb } from "./src/config/memoryStore.js";
import { csrfProtection } from "./src/middleware/csrf.js";
import { requestGuard } from "./src/middleware/requestGuard.js";
import logger from "./src/utils/logger.js";
import { notifyServerError } from "./src/utils/telegramNotifier.js";

const app = express();
const port = process.env.PORT || 5000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
let shuttingDown = false;

function googleCallbackUrl() {
  const configured = String(process.env.GOOGLE_CALLBACK_URL || "").trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    return `${String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "")}/api/auth/google/callback`;
  }
  return `http://localhost:${port}/api/auth/google/callback`;
}

function configuredOrigins() {
  const origins = new Set([
    clientUrl,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .forEach((origin) => origins.add(origin));

  for (const origin of Array.from(origins)) {
    try {
      const url = new URL(origin);
      if (url.hostname.startsWith("www.")) {
        url.hostname = url.hostname.slice(4);
        origins.add(url.toString().replace(/\/$/, ""));
      } else if (!url.hostname.startsWith("www.")) {
        url.hostname = `www.${url.hostname}`;
        origins.add(url.toString().replace(/\/$/, ""));
      }
    } catch {
      // Invalid origins are ignored here and rejected by CORS at request time.
    }
  }

  return origins;
}

const allowedOrigins = configuredOrigins();

function requireProductionSecret(name, value) {
  if (process.env.NODE_ENV !== "production") return;
  const text = String(value || "");
  if (!text || text === "dev-secret" || text.includes("change-me") || text.length < 32) {
    throw new Error(`${name} must be configured with at least 32 characters in production.`);
  }
}

function requireProductionValue(name, value) {
  if (process.env.NODE_ENV !== "production") return;
  if (!String(value || "").trim()) {
    throw new Error(`${name} must be configured in production.`);
  }
}

function requireProductionHttpsUrl(name, value) {
  if (process.env.NODE_ENV !== "production") return;
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${name} must be configured in production.`);
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL in production.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }
}

function adminEmails() {
  return new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function pluginApiEnabled(_req, res, next) {
  if (process.env.PLUGIN_API_ENABLED === "true") return next();
  return res.status(503).json({
    message: "Plugin API is not enabled",
    code: "PLUGIN_API_DISABLED",
  });
}

requireProductionSecret("JWT_SECRET", process.env.JWT_SECRET);
if (process.env.PLUGIN_API_ENABLED === "true") {
  requireProductionSecret("PLUGIN_JWT_SECRET", process.env.PLUGIN_JWT_SECRET);
}
requireProductionSecret("CSRF_HMAC_SECRET", process.env.CSRF_HMAC_SECRET);
requireProductionSecret("COOKIE_SIGNATURE_SECRET", process.env.COOKIE_SIGNATURE_SECRET);
requireProductionSecret("DOWNLOAD_TOKEN_SECRET", process.env.DOWNLOAD_TOKEN_SECRET);
requireProductionSecret("COOKIE_ENCRYPTION_KEY", process.env.COOKIE_ENCRYPTION_KEY);
requireProductionHttpsUrl("CLIENT_URL", process.env.CLIENT_URL);
requireProductionHttpsUrl("PUBLIC_BASE_URL", process.env.PUBLIC_BASE_URL);
if (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET) {
  requireProductionValue("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
  requireProductionSecret("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
  requireProductionHttpsUrl("GOOGLE_CALLBACK_URL", process.env.GOOGLE_CALLBACK_URL);
}
if (process.env.SEPAY_ENABLED !== "false") {
  requireProductionValue("SEPAY_MERCHANT_ID", process.env.SEPAY_MERCHANT_ID);
  requireProductionSecret("SEPAY_SECRET_KEY", process.env.SEPAY_SECRET_KEY);
  requireProductionHttpsUrl("SEPAY_SUCCESS_URL", process.env.SEPAY_SUCCESS_URL);
  requireProductionHttpsUrl("SEPAY_ERROR_URL", process.env.SEPAY_ERROR_URL);
  requireProductionHttpsUrl("SEPAY_CANCEL_URL", process.env.SEPAY_CANCEL_URL);
}
assertProductionReadiness();

await connectDb();

const { jwtAuth } = await import("./src/middleware/jwtAuth.js");
const { default: User } = await import("./src/models/User.js");
const { currentUser } = await import("./src/controllers/authController.js");
const { default: authRoutes } = await import("./src/routes/authRoutes.js");
const { default: topupRoutes } = await import("./src/routes/topupRoutes.js");
const { default: voucherRoutes } = await import("./src/routes/voucherRoutes.js");
const { default: getlinkRoutes } = await import("./src/routes/getlinkRoutes.js");
const { default: paymentRoutes } = await import("./src/routes/paymentRoutes.js");
const { default: adminRoutes } = await import("./src/routes/adminRoutes.js");
const { default: settingsRoutes } = await import("./src/routes/settingsRoutes.js");
const { default: systemRoutes } = await import("./src/routes/systemRoutes.js");
const { default: guideRoutes } = await import("./src/routes/guideRoutes.js");
const { default: notificationRoutes } = await import("./src/routes/notificationRoutes.js");
const { default: referralRoutes } = await import("./src/routes/referralRoutes.js");
const { default: marketplaceRoutes } = await import("./src/routes/marketplaceRoutes.js");
const { default: pluginRoutes } = await import("./src/routes/pluginRoutes.js");
const { default: pluginActivationRoutes } = await import("./src/routes/pluginActivationRoutes.js");
const { default: membershipRoutes } = await import("./src/routes/membershipRoutes.js");
const { default: historyRoutes } = await import("./src/routes/historyRoutes.js");
const { initializeSettings } = await import("./src/controllers/settingsController.js");
const { ensureTopupIndexes } = await import("./src/models/Topup.js");
const { ensurePaymentReceiptIndexes } = await import("./src/models/PaymentReceipt.js");
const { ensureNotificationReceiptIndexes } = await import("./src/models/NotificationReceipt.js");
const { ensureMarketplaceReportIndexes } = await import("./src/models/MarketplaceReport.js");
const { ensureBackupRunIndexes } = await import("./src/models/BackupRun.js");
const { awardReferralSignup, ensureReferralCode } = await import("./src/utils/referralService.js");
const { initializeMarketplaceCategories } = await import("./src/utils/marketplaceSeed.js");
const { ensureMarketplaceAssetMigration } = await import("./src/utils/marketplaceMigration.js");
const { initializeMembershipPlans } = await import("./src/utils/membershipService.js");
const { startMarketplaceDriveSyncJob, stopMarketplaceDriveSyncJob } = await import("./src/utils/marketplaceDriveSyncJob.js");
const { startMarketplaceDriveReconcileJob, stopMarketplaceDriveReconcileJob } = await import("./src/utils/marketplaceDriveReconcileJob.js");
const { startMarketplaceDiscoverySyncJob, stopMarketplaceDiscoverySyncJob } = await import("./src/utils/marketplaceDiscoverySyncJob.js");
const { startMarketplaceSearchIndexJob, stopMarketplaceSearchIndexJob } = await import("./src/utils/marketplaceSearchIndexJob.js");
const { startMarketplaceRecommendationJob, stopMarketplaceRecommendationJob } = await import("./src/utils/marketplaceRecommendationV3.js");
const { startMarketplacePopularityJob, stopMarketplacePopularityJob } = await import("./src/utils/marketplacePopularityJob.js");
const { startMarketplaceQuotaGrantJob, stopMarketplaceQuotaGrantJob } = await import("./src/utils/marketplaceQuotaGrantJob.js");
const { startMarketplaceDeletionJob, stopMarketplaceDeletionJob } = await import("./src/utils/marketplaceDeletionJob.js");
const { startMarketplaceCoverCacheJob, stopMarketplaceCoverCacheJob } = await import("./src/utils/marketplaceCoverCacheJob.js");
const { marketplaceCoverCacheConfig } = await import("./src/utils/marketplaceCoverCache.js");
const { startHistoryRetentionJob, stopHistoryRetentionJob } = await import("./src/utils/historyRetentionJob.js");
const { startStorageHealthJob, stopStorageHealthJob } = await import("./src/utils/storageHealthJob.js");
const { startGetlinkJobWorker, stopGetlinkJobWorker } = await import("./src/utils/getlinkJobService.js");
const { close3D66Browser } = await import("./src/utils/3d66BrowserService.js");
const { close3D66ProxyAgents } = await import("./src/utils/3d66Service.js");

await ensureTopupIndexes();
await ensurePaymentReceiptIndexes();
await ensureNotificationReceiptIndexes();
await ensureMarketplaceReportIndexes();
await ensureBackupRunIndexes();
if (
  process.env.NODE_ENV !== "production"
  || process.env.MARKETPLACE_STARTUP_MIGRATIONS_ENABLED === "true"
) {
  await ensureMarketplaceAssetMigration();
} else {
  logger.info(
    "Marketplace startup migrations are disabled; run the reviewed migration command before deploy",
  );
}
await initializeSettings();
await initializeMarketplaceCategories();
await initializeMembershipPlans();
startMarketplaceDriveSyncJob();
startMarketplaceDriveReconcileJob();
startMarketplaceDiscoverySyncJob();
startMarketplaceSearchIndexJob();
startMarketplaceRecommendationJob();
startMarketplacePopularityJob();
startMarketplaceQuotaGrantJob();
startMarketplaceDeletionJob();
startMarketplaceCoverCacheJob();
startHistoryRetentionJob();
startStorageHealthJob();
startGetlinkJobWorker();

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.use(helmet(buildHelmetOptions()));
app.use(compression());
app.use((_, res, next) => {
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use((req, res, next) => {
  const supplied = String(req.get("x-correlation-id") || "").trim();
  const correlationId = /^[A-Za-z0-9._:-]{8,96}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  next();
});

const coverCacheConfig = marketplaceCoverCacheConfig();
if (coverCacheConfig.enabled) {
  app.use(
    coverCacheConfig.publicBaseUrl,
    express.static(coverCacheConfig.root, {
      dotfiles: "deny",
      fallthrough: true,
      immutable: true,
      maxAge: "1y",
      setHeaders(res) {
        res.setHeader("cache-control", "public, max-age=31536000, immutable");
        res.setHeader("cross-origin-resource-policy", "cross-origin");
        res.setHeader("x-content-type-options", "nosniff");
      },
    }),
  );
}

app.use(express.json({ limit: validatedJsonBodyLimit() }));
app.use(
  cors({
    maxAge: 86400,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      const error = new Error(`Origin ${origin} is not allowed by CORS`);
      error.status = 403;
      error.code = "CORS_ORIGIN_DENIED";
      return callback(error);
    },
    credentials: true
  })
);

app.use(cookieParser(cookieSignatureSecret()));

// Passport without session
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: googleCallbackUrl(),
        passReqToCallback: true
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("Google account has no email"));
          const normalizedEmail = email.toLowerCase();
          const role = adminEmails().has(normalizedEmail) ? "admin" : "user";

          let isNewUser = false;
          let user = await User.findOne({ email: normalizedEmail });
          if (!user) {
            isNewUser = true;
            user = await User.create({
              email: normalizedEmail,
              role,
              name: profile.displayName,
              avatar: profile.photos?.[0]?.value || "",
              credit: 0
            });
          } else {
            user = await User.findByIdAndUpdate(
              user._id,
              {
                $set: {
                  role,
                  name: profile.displayName,
                  avatar: profile.photos?.[0]?.value || ""
                }
              },
              { new: true }
            );
          }

          await ensureReferralCode(user);
          if (isNewUser) {
            await awardReferralSignup(user, req.cookies?.oauthReferralCode);
            user = await User.findById(user._id);
          }

          done(null, user);
        } catch (error) {
          done(error);
        }
      }
    )
  );
}

app.use(passport.initialize());
app.use(jwtAuth);
app.use(requestGuard);
app.use("/api/plugin", pluginApiEnabled, (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info({
      type: "PLUGIN_API",
      event: "plugin.request",
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?._id ? String(req.user._id) : undefined,
      sessionId: req.pluginSession?._id ? String(req.pluginSession._id) : undefined,
    }, "Plugin API request");
  });
  next();
}, pluginRoutes);
app.use(csrfProtection);

app.get("/health", (_req, res) => {
  const databases = isMemoryDb()
    ? { core: true, marketplace: true, marketplaceUsesCore: true, memory: true }
    : databaseHealth();
  res.json({ ok: databases.core && databases.marketplace, databases });
});
app.get("/ready", (_req, res) => {
  const databases = isMemoryDb()
    ? { core: true, marketplace: true, marketplaceUsesCore: true, memory: true }
    : databaseHealth();
  const splitReady = databases.memory
    || String(process.env.MARKETPLACE_DB_TARGET || "").toLowerCase() !== "vps"
    || databases.marketplaceDistinct;
  const ready = !shuttingDown && databases.core && databases.marketplace && splitReady;
  return res.status(ready ? 200 : 503).json({ ready, databases });
});
app.get("/api/user", currentUser);
app.use("/api/auth", authRoutes);
app.use("/api", topupRoutes);
app.use("/api", voucherRoutes);
app.use("/api", getlinkRoutes);
app.use("/api", settingsRoutes);
app.use("/api", paymentRoutes);
app.use("/api", systemRoutes);
app.use("/api", guideRoutes);
app.use("/api", notificationRoutes);
app.use("/api", referralRoutes);
app.use("/api", marketplaceRoutes);
app.use("/api", membershipRoutes);
app.use("/api", historyRoutes);
app.use("/api/plugin-activation", pluginApiEnabled, pluginActivationRoutes);
app.use("/api/admin", adminRoutes);

function publicErrorMessage(message) {
  return String(message || "Internal server error")
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)*3d66\.com/gi, "3D")
    .replace(/3d66/gi, "3D");
}

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status === 429 && String(_req.originalUrl || "").startsWith("/api/plugin/")) {
    const explicitSeconds = Number(error.publicDetails?.retryAfter || 0);
    const resetAt = error.publicDetails?.resetAt
      ? new Date(error.publicDetails.resetAt).getTime()
      : 0;
    const resetSeconds = resetAt > Date.now()
      ? Math.ceil((resetAt - Date.now()) / 1000)
      : 0;
    res.setHeader("retry-after", String(Math.max(1, explicitSeconds, resetSeconds)));
  }
  if (status >= 500) {
    logger.error({ err: error, status, correlationId: _req.correlationId }, "Unhandled server error");
    notifyServerError({ error, req: _req, status });
  } else {
    logger.warn({
      type: String(_req.originalUrl || "").startsWith("/api/plugin/") ? "PLUGIN_API" : "HTTP",
      event: error.code || "client.error",
      status,
      correlationId: _req.correlationId,
      message: error.message,
    }, "Client error");
  }
  const isProduction = process.env.NODE_ENV === "production";
  res.status(status).json({
    message: status >= 500 && isProduction
      ? "Internal server error"
      : publicErrorMessage(error.message),
    ...(typeof error.code === "string" && error.code ? { code: error.code } : {}),
    ...(status < 500 && error.publicDetails && typeof error.publicDetails === "object"
      ? { details: error.publicDetails }
      : {}),
    correlationId: _req.correlationId,
  });
});

const server = app.listen(port, () => {
  logger.info(`Backend listening on http://localhost:${port}`);
});

if (
  process.env.NODE_ENV !== "production"
  && process.env.QA_DIAGNOSTICS_ENABLED === "true"
  && typeof process.send === "function"
) {
  process.on("message", (message) => {
    if (message?.type !== "qa:memory") return;
    if (message.collectGarbage === true) global.gc?.();
    process.send({
      type: "qa:memory",
      requestId: message.requestId,
      memory: process.memoryUsage(),
    });
  });
}

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMarketplaceDriveSyncJob();
  stopMarketplaceDriveReconcileJob();
  stopMarketplaceDiscoverySyncJob();
  stopMarketplaceSearchIndexJob();
  stopMarketplaceRecommendationJob();
  stopMarketplacePopularityJob();
  stopMarketplaceQuotaGrantJob();
  stopMarketplaceDeletionJob();
  stopMarketplaceCoverCacheJob();
  stopHistoryRetentionJob();
  stopStorageHealthJob();
  const getlinkWorkerStop = stopGetlinkJobWorker({ timeoutMs: 25_000 });
  logger.info({ signal }, "Graceful shutdown started");

  const forceTimer = setTimeout(() => {
    logger.error({ signal }, "Graceful shutdown timed out");
    server.closeAllConnections?.();
    process.exit(1);
  }, 30_000);
  forceTimer.unref();

  let closeError = null;
  await new Promise((resolve) => {
    server.close((error) => {
      closeError = error || null;
      resolve();
    });
  });

  const getlinkWorkerDrained = await getlinkWorkerStop;
  if (!getlinkWorkerDrained) {
    logger.warn({ signal }, "Getlink worker did not drain before database shutdown");
  }

  await Promise.allSettled([
    close3D66Browser(),
    close3D66ProxyAgents(),
    closeDbConnections(),
  ]);
  clearTimeout(forceTimer);

  if (closeError) {
    logger.error({ err: closeError }, "HTTP server shutdown failed");
    process.exit(1);
  }
  logger.info({ signal }, "Graceful shutdown completed");
  process.exit(0);
}

process.once("SIGINT", () => {
  gracefulShutdown("SIGINT").catch((error) => {
    logger.error({ err: error }, "Graceful shutdown failed");
    process.exit(1);
  });
});
process.once("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch((error) => {
    logger.error({ err: error }, "Graceful shutdown failed");
    process.exit(1);
  });
});
