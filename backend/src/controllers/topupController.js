import Topup from "../models/Topup.js";
import TopupPackage from "../models/TopupPackage.js";
import { addCredit } from "../utils/creditService.js";
import { createPaymentCode } from "../utils/vietqr.js";
import { assertSepayConfigured, createSepayCheckout } from "../utils/sepay.js";
import {
  assertVoucherTarget,
  assertVoucherUserLimit,
  findCheckoutVoucher,
} from "../utils/voucherCheckoutService.js";
import {
  finiteNumber,
  isSafeId,
  isVoucherCode,
  normalizeVoucherCode,
  rejectUnknownKeys,
} from "../utils/validators.js";
import { expirePendingSepayTopups } from "../utils/topupExpiryService.js";

const MIN_TOPUP_AMOUNT = Number(process.env.MIN_TOPUP_AMOUNT || 1000);
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{16,128}$/;

const DEFAULT_TOPUP_PACKAGE_REVISION = 2;

export const DEFAULT_TOPUP_PACKAGES = [
  {
    code: "EXPERIENCE",
    defaultRevision: DEFAULT_TOPUP_PACKAGE_REVISION,
    name: "GÓI TRẢI NGHIỆM",
    price: 10000,
    credit: 28,
    salePercent: 0,
    salePrice: 0,
    maxTopupsPerUser: 1,
    badge: "TEST",
    features: ["1 lượt tải model", "Lưu lịch sử tải", "Hỗ trợ cơ bản"],
    isActive: true,
    sortOrder: 10,
  },
  {
    code: "STARTER",
    defaultRevision: DEFAULT_TOPUP_PACKAGE_REVISION,
    name: "GÓI STARTER",
    price: 65000,
    credit: 140,
    salePercent: 0,
    salePrice: 0,
    maxTopupsPerUser: 0,
    badge: "",
    features: ["5 lượt tải model", "13K/1 lượt tải", "Lưu lịch sử tải"],
    isActive: true,
    sortOrder: 20,
  },
  {
    code: "BASIC",
    defaultRevision: DEFAULT_TOPUP_PACKAGE_REVISION,
    name: "GÓI BASIC",
    price: 130000,
    credit: 280,
    salePercent: 7,
    salePrice: 120000,
    maxTopupsPerUser: 0,
    badge: "SALE",
    features: ["10 lượt tải model", "12K/1 lượt tải", "Lưu lịch sử tải"],
    isActive: true,
    sortOrder: 30,
  },
  {
    code: "PRO_CREDIT",
    defaultRevision: DEFAULT_TOPUP_PACKAGE_REVISION,
    name: "GÓI PRO",
    price: 260000,
    credit: 560,
    salePercent: 15,
    salePrice: 220000,
    maxTopupsPerUser: 0,
    badge: "POPULAR",
    features: ["20 lượt tải model", "11K/1 lượt tải", "Lưu lịch sử tải"],
    isActive: true,
    sortOrder: 40,
  },
  {
    code: "TEAM",
    defaultRevision: DEFAULT_TOPUP_PACKAGE_REVISION,
    name: "GÓI TEAM",
    price: 650000,
    credit: 1400,
    salePercent: 23,
    salePrice: 500000,
    maxTopupsPerUser: 0,
    badge: "BEST VALUE",
    features: ["50 lượt tải model", "10K/1 lượt tải", "Lưu lịch sử tải"],
    isActive: true,
    sortOrder: 50,
  },
];

function sortPackages(packages = []) {
  return [...packages].sort((a, b) => {
    const aOrder = Number.isFinite(Number(a.sortOrder))
      ? Number(a.sortOrder)
      : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(Number(b.sortOrder))
      ? Number(b.sortOrder)
      : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return Number(a.price || 0) - Number(b.price || 0);
  });
}

function packageCredit(pack) {
  return Number(pack.credit || 0);
}

function packagePayAmount(pack) {
  const salePrice = Number(pack.salePrice || 0);
  if (Number.isFinite(salePrice) && salePrice > 0) {
    return Math.round(salePrice);
  }
  return Math.round(
    (Number(pack.price || 0) * (100 - Number(pack.salePercent || 0))) / 100,
  );
}

function isSameIdempotentTopupRequest(topup, pack, voucherCode = "") {
  return (
    String(topup?.packageId?._id || topup?.packageId || "") ===
      String(pack?._id || "") &&
    String(topup?.voucherCode || "") === String(voucherCode || "")
  );
}

async function userActivePackageTopupCount(userId, packageId) {
  return Topup.countDocuments({
    userId,
    packageId,
    status: { $in: ["pending", "approved"] },
  });
}

async function ensurePackageTopupLimit(pack, userId) {
  const limit = Number(pack?.maxTopupsPerUser || 0);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const used = await userActivePackageTopupCount(userId, pack._id);
  if (used >= limit) {
    const error = new Error(`Tài khoản đã đạt giới hạn nạp gói này (${limit} lần).`);
    error.status = 409;
    throw error;
  }
}

function defaultPackageKey(name = "") {
  const normalized = String(name).toUpperCase();
  if (normalized.includes("TRẢI NGHIỆM") || normalized.includes("TRAI NGHIEM")) {
    return "EXPERIENCE";
  }
  const key = ["STARTER", "BASIC", "PRO", "TEAM"].find((item) =>
    normalized.includes(item),
  );
  return key === "PRO" ? "PRO_CREDIT" : key;
}

async function syncDefaultTopupPackages(packages) {
  if (process.env.TOPUP_PACKAGE_CATALOG_MIGRATION_ENABLED === "false") return packages;

  const defaultsByKey = new Map(
    DEFAULT_TOPUP_PACKAGES.map((pack) => [pack.code, pack]),
  );
  const updates = [];
  const seenKeys = new Set();

  const migratePackage = (pack, key) => {
    const defaultPack = defaultsByKey.get(key);
    if (!defaultPack || seenKeys.has(key)) return;
    seenKeys.add(key);

    const current = pack.toObject ? pack.toObject() : pack;
    if (Number(current.defaultRevision || 0) < DEFAULT_TOPUP_PACKAGE_REVISION) {
      updates.push(
        TopupPackage.findByIdAndUpdate(pack._id, defaultPack, { new: true }),
      );
    }
  };

  for (const pack of packages) {
    const code = String(pack.code || "").toUpperCase();
    if (code) migratePackage(pack, code);
  }

  for (const pack of packages) {
    if (pack.code) continue;
    migratePackage(pack, defaultPackageKey(pack.name));
  }

  for (const [key, defaultPack] of defaultsByKey) {
    if (!seenKeys.has(key)) {
      updates.push(TopupPackage.findOneAndUpdate(
        { code: key },
        { $setOnInsert: defaultPack },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ));
    }
  }

  if (!updates.length) return packages;
  await Promise.all(updates);
  return TopupPackage.find();
}

export function getCredit(req, res) {
  res.json({ credit: req.user.credit });
}

export async function getPackages(_req, res, next) {
  try {
    let packages = await TopupPackage.find();
    await syncDefaultTopupPackages(packages);
    packages = sortPackages(await TopupPackage.find({ isActive: true }).lean());
    res.json({ packages });
  } catch (error) {
    next(error);
  }
}

export async function createTopup(req, res, next) {
  try {
    await expirePendingSepayTopups({ userId: req.user._id });

    const unknownKey = rejectUnknownKeys(req.body, [
      "packageId",
      "price",
      "voucherCode",
      "type",
    ]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid topup request" });
    }

    const packageId = String(req.body.packageId || "").trim();
    const idempotencyKey = String(req.get("idempotency-key") || "").trim();
    const price = finiteNumber(req.body.price);
    const normalizedVoucherCode = normalizeVoucherCode(req.body.voucherCode);
    if (packageId && !isSafeId(packageId)) {
      return res.status(400).json({ message: "Invalid topup package" });
    }
    if (!packageId && (price === null || price <= 0)) {
      return res.status(400).json({ message: "Invalid topup package" });
    }
    if (normalizedVoucherCode && !isVoucherCode(normalizedVoucherCode)) {
      return res.status(400).json({ message: "Invalid voucher code" });
    }
    if (idempotencyKey && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return res.status(400).json({ message: "Invalid idempotency key" });
    }

    const type = "sepay";
    const pack = packageId
      ? await TopupPackage.findById(packageId)
      : await TopupPackage.findOne({ price, isActive: true });

    if (!pack || pack.isActive === false) {
      return res.status(400).json({ message: "Invalid topup package" });
    }

    if (idempotencyKey) {
      const existingTopup = await Topup.findOne({
        userId: req.user._id,
        idempotencyKey,
      });
      if (existingTopup) {
        if (!isSameIdempotentTopupRequest(existingTopup, pack, normalizedVoucherCode)) {
          return res.status(409).json({
            message: "Idempotency key was already used for another topup request",
          });
        }
        const payment = existingTopup.status === "approved"
          ? null
          : createSepayCheckout({ topup: existingTopup, user: req.user, pack });
        return res.json({
          topup: existingTopup,
          payment,
          credit: req.user.credit,
          status: existingTopup.status,
          idempotentReplay: true,
        });
      }
    }
    await ensurePackageTopupLimit(pack, req.user._id);

    const isAuto = type === "auto" || type === "fake";
    const isSepay = type === "sepay";
    const status = isAuto ? "approved" : "pending";
    if (isSepay) assertSepayConfigured();
    const originalAmount = packagePayAmount(pack);
    let discountAmount = 0;
    let voucherCreditBonus = 0;
    let voucher = null;
    if (normalizedVoucherCode) {
      voucher = await findCheckoutVoucher(normalizedVoucherCode);
      assertVoucherTarget(voucher, { target: "topup", packageId: pack._id });
      await assertVoucherUserLimit(voucher, req.user._id);
      discountAmount = Math.min(
        originalAmount,
        Math.round(
          (originalAmount * Number(voucher.discountPercent || 0)) / 100,
        ),
      );
      voucherCreditBonus = Number(voucher.creditBonus || 0);
    }

    const amount = Math.max(0, originalAmount - discountAmount);
    if (amount < MIN_TOPUP_AMOUNT) {
      return res
        .status(400)
        .json({ message: "Topup amount is too low after discount" });
    }

    const credit = packageCredit(pack) + voucherCreditBonus;
    const baseTopupPayload = {
      userId: req.user._id,
      packageId: pack._id,
      originalAmount,
      discountAmount,
      voucherCode: voucher?.code,
      voucherDiscountPercent: voucher?.discountPercent || 0,
      voucherCreditBonus,
      amount,
      credit,
      type,
      status,
      gatewayProvider: isSepay ? "sepay" : undefined,
      expiresAt: isSepay ? new Date(Date.now() + 30 * 60 * 1000) : undefined,
      idempotencyKey: idempotencyKey || undefined,
    };

    // Retry tao Topup neu paymentCode collision (CSPRNG da rat hiem nhung partial unique
    // index van co the throw E11000 khi 2 request gan nhu cung luc tao trung code).
    let topup;
    let idempotentReplay = false;
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      const paymentCode = isSepay ? createPaymentCode() : undefined;
      try {
        topup = await Topup.create({ ...baseTopupPayload, paymentCode });
        break;
      } catch (error) {
        if (error?.code === 11000) {
          if (
            idempotencyKey &&
            (error.keyPattern?.idempotencyKey ||
              error.message?.includes("unique_user_topup_idempotency"))
          ) {
            topup = await Topup.findOne({
              userId: req.user._id,
              idempotencyKey,
            });
            if (topup) {
              if (!isSameIdempotentTopupRequest(topup, pack, normalizedVoucherCode)) {
                return res.status(409).json({
                  message: "Idempotency key was already used for another topup request",
                });
              }
              idempotentReplay = true;
              break;
            }
          }
          // Duplicate key: paymentCode collision.
          if (
            error.keyPattern?.paymentCode ||
            error.message?.includes("unique_pending_paymentCode")
          ) {
            if (attempt >= 3) {
              return res.status(503).json({
                message:
                  "Khong tao duoc ma thanh toan duy nhat. Vui long thu lai sau vai giay.",
              });
            }
            continue; // retry voi paymentCode moi
          }
        }
        throw error;
      }
    }

    let userCredit = req.user.credit;
    if (isAuto) {
      const user = await addCredit(req.user._id, credit);
      userCredit = user.credit;
    }

    let payment = null;
    if (isSepay && topup.status !== "approved") {
      payment = createSepayCheckout({ topup, user: req.user, pack });
      topup = await Topup.findByIdAndUpdate(
        topup._id,
        { checkoutUrl: payment.checkoutUrl, gatewayProvider: "sepay" },
        { new: true },
      );
    }

    res.json({
      topup,
      payment,
      credit: userCredit,
      status: topup.status || status,
      idempotentReplay,
    });
  } catch (error) {
    next(error);
  }
}

export async function topupHistory(req, res, next) {
  try {
    await expirePendingSepayTopups({ userId: req.user._id });

    const history = await Topup.find({ userId: req.user._id })
      .populate("packageId", "name")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({
      history,
      userCredit: Number(req.user.credit || 0),
    });
  } catch (error) {
    next(error);
  }
}

export async function topupStatus(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid topup id" });
    }

    await expirePendingSepayTopups({
      _id: req.params.id,
      userId: req.user._id,
    });

    const topup = await Topup.findOne({
      _id: req.params.id,
      userId: req.user._id,
    })
      .select("status credit amount paymentCode paidAt canceledAt rejectionReason createdAt updatedAt")
      .lean();

    if (!topup) {
      return res.status(404).json({ message: "Topup not found" });
    }

    res.json({
      topup,
      status: topup.status,
      credit: topup.credit,
      userCredit: req.user.credit,
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelTopup(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid topup id" });
    }

    const unknownKey = rejectUnknownKeys(req.body, ["reason"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid cancel request" });
    }

    const reason = String(req.body.reason || "user_cancel");
    if (!["user_cancel", "gateway_error"].includes(reason)) {
      return res.status(400).json({ message: "Invalid cancel reason" });
    }

    const canceledAt = new Date();
    let topup = await Topup.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        gatewayProvider: "sepay",
        status: "pending",
      },
      {
        $set: {
          status: "rejected",
          canceledAt,
          rejectionReason: reason,
        },
      },
      { new: true },
    );

    if (!topup) {
      topup = await Topup.findOne({
        _id: req.params.id,
        userId: req.user._id,
      });
    }

    if (!topup) {
      return res.status(404).json({ message: "Topup not found" });
    }

    res.json({
      topup,
      status: topup.status,
      userCredit: req.user.credit,
      message:
        topup.status === "approved"
          ? "Giao dịch đã được xác nhận thanh toán."
          : "Đã hủy đơn thanh toán SePay.",
    });
  } catch (error) {
    next(error);
  }
}
