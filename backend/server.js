import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { closeDbConnections, connectDb, databaseHealth } from "./src/config/db.js";
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

requireProductionSecret("JWT_SECRET", process.env.JWT_SECRET);
requireProductionSecret("CSRF_HMAC_SECRET", process.env.CSRF_HMAC_SECRET);
requireProductionSecret("COOKIE_SIGNATURE_SECRET", process.env.COOKIE_SIGNATURE_SECRET);
requireProductionSecret("DOWNLOAD_TOKEN_SECRET", process.env.DOWNLOAD_TOKEN_SECRET);
requireProductionSecret("COOKIE_ENCRYPTION_KEY", process.env.COOKIE_ENCRYPTION_KEY);
requireProductionHttpsUrl("CLIENT_URL", process.env.CLIENT_URL);
requireProductionHttpsUrl("PUBLIC_BASE_URL", process.env.PUBLIC_BASE_URL);
if (process.env.SEPAY_ENABLED !== "false") {
  requireProductionValue("SEPAY_MERCHANT_ID", process.env.SEPAY_MERCHANT_ID);
  requireProductionSecret("SEPAY_SECRET_KEY", process.env.SEPAY_SECRET_KEY);
  requireProductionHttpsUrl("SEPAY_SUCCESS_URL", process.env.SEPAY_SUCCESS_URL);
  requireProductionHttpsUrl("SEPAY_ERROR_URL", process.env.SEPAY_ERROR_URL);
  requireProductionHttpsUrl("SEPAY_CANCEL_URL", process.env.SEPAY_CANCEL_URL);
}

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
const { default: membershipRoutes } = await import("./src/routes/membershipRoutes.js");
const { default: historyRoutes } = await import("./src/routes/historyRoutes.js");
const { initializeSettings } = await import("./src/controllers/settingsController.js");
const { ensureTopupIndexes } = await import("./src/models/Topup.js");
const { ensurePaymentReceiptIndexes } = await import("./src/models/PaymentReceipt.js");
const { ensureNotificationReceiptIndexes } = await import("./src/models/NotificationReceipt.js");
const { awardReferralSignup, ensureReferralCode } = await import("./src/utils/referralService.js");
const { initializeMarketplaceCategories } = await import("./src/utils/marketplaceSeed.js");
const { ensureMarketplaceAssetMigration } = await import("./src/utils/marketplaceMigration.js");
const { seedMarketplaceDemoModels, seedMarketplaceDemoScenes } = await import("./src/utils/marketplaceDemoSeed.js");
const { initializeMembershipPlans } = await import("./src/utils/membershipService.js");
const { startMarketplaceDriveSyncJob, stopMarketplaceDriveSyncJob } = await import("./src/utils/marketplaceDriveSyncJob.js");
const { startMarketplaceDiscoverySyncJob, stopMarketplaceDiscoverySyncJob } = await import("./src/utils/marketplaceDiscoverySyncJob.js");
const { startMarketplaceQuotaGrantJob, stopMarketplaceQuotaGrantJob } = await import("./src/utils/marketplaceQuotaGrantJob.js");
const { startHistoryRetentionJob, stopHistoryRetentionJob } = await import("./src/utils/historyRetentionJob.js");
const { close3D66Browser } = await import("./src/utils/3d66BrowserService.js");
const { close3D66ProxyAgents } = await import("./src/utils/3d66Service.js");

await ensureTopupIndexes();
await ensurePaymentReceiptIndexes();
await ensureNotificationReceiptIndexes();
await ensureMarketplaceAssetMigration();
await initializeSettings();
await initializeMarketplaceCategories();
if (process.env.SEED_MARKETPLACE_DEMO === "true") {
  const demoSeed = await seedMarketplaceDemoModels();
  const sceneDemoSeed = await seedMarketplaceDemoScenes();
  logger.info({ models: demoSeed.created, scenes: sceneDemoSeed.created }, "Marketplace demo assets initialized");
}
await initializeMembershipPlans();
startMarketplaceDriveSyncJob();
startMarketplaceDiscoverySyncJob();
startMarketplaceQuotaGrantJob();
startHistoryRetentionJob();

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://respic.3d66.com", "https://api.vietqr.io", "data:"],
      connectSrc: ["'self'"],
      formAction: ["'self'", "https://pay.sepay.vn", "https://pay-sandbox.sepay.vn"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
      objectSrc: ["'none'"]
    }
  } : false,
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}));
app.use(compression());
app.use((_, res, next) => {
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
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
        callbackURL: "/api/auth/google/callback",
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
  const ready = !shuttingDown && databases.core && databases.marketplace;
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
app.use("/api/admin", adminRoutes);

function publicErrorMessage(message) {
  return String(message || "Internal server error")
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)*3d66\.com/gi, "3D")
    .replace(/3d66/gi, "3D");
}

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) {
    logger.error({ err: error, status }, "Unhandled server error");
    notifyServerError({ error, req: _req, status });
  } else {
    logger.warn({ status, message: error.message }, "Client error");
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
  });
});

const server = app.listen(port, () => {
  logger.info(`Backend listening on http://localhost:${port}`);
});

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMarketplaceDriveSyncJob();
  stopMarketplaceDiscoverySyncJob();
  stopMarketplaceQuotaGrantJob();
  stopHistoryRetentionJob();
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
