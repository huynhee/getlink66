import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { connectDb } from "./src/config/db.js";
import { isMemoryDb } from "./src/config/memoryStore.js";
import { csrfProtection } from "./src/middleware/csrf.js";
import { requestGuard } from "./src/middleware/requestGuard.js";
import { jwtAuth } from "./src/middleware/jwtAuth.js";
import logger from "./src/utils/logger.js";
import { notifyServerError } from "./src/utils/telegramNotifier.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
const allowedOrigins = new Set([
  clientUrl,
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

await connectDb();

function requireProductionSecret(name, value) {
  if (process.env.NODE_ENV !== "production") return;
  if (!value || value === "dev-secret" || value === "change-me" || value.length < 32) {
    throw new Error(`${name} must be configured with at least 32 characters in production.`);
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

requireProductionSecret("SESSION_SECRET", process.env.SESSION_SECRET);
requireProductionSecret("COOKIE_ENCRYPTION_KEY or SESSION_SECRET", process.env.COOKIE_ENCRYPTION_KEY || process.env.SESSION_SECRET);

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
const { ensureTopupIndexes } = await import("./src/models/Topup.js");

await ensureTopupIndexes();

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
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  } : false,
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}));
app.use((_, res, next) => {
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "100kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true
  })
);

app.use(cookieParser(process.env.SESSION_SECRET || "dev-secret"));

// Passport without session
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/api/auth/google/callback"
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("Google account has no email"));
          const normalizedEmail = email.toLowerCase();
          const role = adminEmails().has(normalizedEmail) ? "admin" : "user";

          const user = await User.findOneAndUpdate(
            { email: normalizedEmail },
            {
              $setOnInsert: { credit: 0 },
              $set: {
                role,
                name: profile.displayName,
                avatar: profile.photos?.[0]?.value || ""
              }
            },
            { upsert: true, new: true }
          );

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

app.get("/health", (_req, res) => res.json({ ok: true }));
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
app.use("/api/admin", adminRoutes);

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
      : error.message || "Internal server error"
  });
});

app.listen(port, () => {
  logger.info(`Backend listening on http://localhost:${port}`);
});
