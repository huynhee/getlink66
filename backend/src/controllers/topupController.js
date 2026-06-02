import Topup from "../models/Topup.js";
import TopupPackage from "../models/TopupPackage.js";
import Voucher from "../models/Voucher.js";
import { addCredit } from "../utils/creditService.js";
import { createPaymentCode } from "../utils/vietqr.js";
import { assertSepayConfigured, createSepayCheckout } from "../utils/sepay.js";
import {
  finiteNumber,
  isSafeId,
  isVoucherCode,
  normalizeVoucherCode,
  rejectUnknownKeys,
} from "../utils/validators.js";
import { voucherUnavailableMessage } from "../utils/voucherStatus.js";

const MIN_TOPUP_AMOUNT = Number(process.env.MIN_TOPUP_AMOUNT || 1000);

const DEFAULT_TOPUP_PACKAGES = [
  {
    name: "GÓI STARTER",
    price: 50000,
    credit: 140,
    salePercent: 0,
    badge: "",
    features: ["5 lượt tải model", "Lưu lịch sử tải", "Hỗ trợ cơ bản"],
    isActive: true,
    sortOrder: 10,
  },
  {
    name: "GÓI BASIC",
    price: 100000,
    credit: 280,
    salePercent: 5,
    badge: "SALE",
    features: ["10 lượt tải model", "Giá tốt hơn gói nhỏ", "Lưu lịch sử tải"],
    isActive: true,
    sortOrder: 20,
  },
  {
    name: "GÓI PRO",
    price: 200000,
    credit: 560,
    salePercent: 10,
    badge: "POPULAR",
    features: ["20 lượt tải model", "Ưu tiên cache model", "Hỗ trợ ưu tiên"],
    isActive: true,
    sortOrder: 30,
  },
  {
    name: "GÓI TEAM",
    price: 500000,
    credit: 1400,
    salePercent: 15,
    badge: "BEST VALUE",
    features: ["50 lượt tải model", "Tối ưu cho team thiết kế", "Hỗ trợ nhanh"],
    isActive: true,
    sortOrder: 40,
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

async function userApprovedPackageCount(userId, packageId) {
  return Topup.countDocuments({
    userId,
    packageId,
    status: "approved",
  });
}

async function ensurePackageTopupLimit(pack, userId) {
  const limit = Number(pack?.maxTopupsPerUser || 0);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const used = await userApprovedPackageCount(userId, pack._id);
  if (used >= limit) {
    const error = new Error(
      `Ban da dat gioi han nap goi nay (${limit} lan).`,
    );
    error.status = 409;
    throw error;
  }
}

function defaultPackageKey(name = "") {
  const normalized = String(name).toUpperCase();
  return ["STARTER", "BASIC", "PRO", "TEAM"].find((key) =>
    normalized.includes(key),
  );
}

async function syncDefaultTopupPackages(packages) {
  if (process.env.SYNC_DEFAULT_TOPUP_PACKAGES === "false") return packages;

  const defaultsByKey = new Map(
    DEFAULT_TOPUP_PACKAGES.map((pack) => [defaultPackageKey(pack.name), pack]),
  );
  const updates = [];

  for (const pack of packages) {
    const key = defaultPackageKey(pack.name);
    const defaultPack = defaultsByKey.get(key);
    if (!defaultPack) continue;

    const current = pack.toObject ? pack.toObject() : pack;
    const shouldUpdate =
      current.name !== defaultPack.name ||
      Number(current.price || 0) !== defaultPack.price ||
      Number(current.credit || 0) !== defaultPack.credit ||
      Number(current.salePercent || 0) !== defaultPack.salePercent ||
      String(current.badge || "") !== defaultPack.badge ||
      JSON.stringify(current.features || []) !==
        JSON.stringify(defaultPack.features);

    if (shouldUpdate) {
      updates.push(
        TopupPackage.findByIdAndUpdate(pack._id, defaultPack, { new: true }),
      );
    }
  }

  if (!updates.length) return packages;
  await Promise.all(updates);
  return TopupPackage.find({ isActive: true });
}

export function getCredit(req, res) {
  res.json({ credit: req.user.credit });
}

export async function getPackages(_req, res, next) {
  try {
    let packages = await TopupPackage.find({ isActive: true });
    if (packages.length === 0) {
      if (TopupPackage.insertMany) {
        await TopupPackage.insertMany(DEFAULT_TOPUP_PACKAGES);
      } else {
        await Promise.all(
          DEFAULT_TOPUP_PACKAGES.map((pack) => TopupPackage.create(pack)),
        );
      }
    } else {
      await syncDefaultTopupPackages(packages);
    }
    packages = sortPackages(await TopupPackage.find({ isActive: true }).lean());
    res.json({ packages });
  } catch (error) {
    next(error);
  }
}

export async function createTopup(req, res, next) {
  try {
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

    const type = "sepay";
    const pack = packageId
      ? await TopupPackage.findById(packageId)
      : await TopupPackage.findOne({ price, isActive: true });

    if (!pack || pack.isActive === false) {
      return res.status(400).json({ message: "Invalid topup package" });
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
      voucher = await Voucher.findOne({ code: normalizedVoucherCode });
      const unavailableMessage = voucherUnavailableMessage(voucher);
      if (unavailableMessage) {
        return res.status(400).json({
          message: unavailableMessage,
        });
      }
      const applicablePackageIds = Array.isArray(voucher.applicablePackageIds)
        ? voucher.applicablePackageIds.map((id) => String(id?._id || id))
        : [];
      if (
        applicablePackageIds.length > 0 &&
        !applicablePackageIds.includes(String(pack._id))
      ) {
        return res.status(400).json({
          message: "Voucher không áp dụng cho gói nạp này.",
        });
      }
      const perUserLimit = Number(voucher.perUserLimit ?? 1);
      if (perUserLimit > 0) {
        const userVoucherUsed = await Topup.countDocuments({
          userId: req.user._id,
          voucherCode: normalizedVoucherCode,
          status: "approved",
        });
        if (userVoucherUsed >= perUserLimit) {
          return res.status(400).json({
            message: "Bạn đã đạt giới hạn sử dụng voucher này.",
          });
        }
      }
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
    };

    // Retry tao Topup neu paymentCode collision (CSPRNG da rat hiem nhung partial unique
    // index van co the throw E11000 khi 2 request gan nhu cung luc tao trung code).
    let topup;
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      const paymentCode = isSepay ? createPaymentCode() : undefined;
      try {
        topup = await Topup.create({ ...baseTopupPayload, paymentCode });
        break;
      } catch (error) {
        if (error?.code === 11000) {
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
    if (isSepay && status === "pending") {
      payment = createSepayCheckout({ topup, user: req.user, pack });
      topup = await Topup.findByIdAndUpdate(
        topup._id,
        { checkoutUrl: payment.checkoutUrl, gatewayProvider: "sepay" },
        { new: true },
      );
    }

    res.json({ topup, payment, credit: userCredit, status });
  } catch (error) {
    next(error);
  }
}

export async function topupHistory(req, res, next) {
  try {
    const history = await Topup.find({ userId: req.user._id })
      .populate("packageId", "name")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ history });
  } catch (error) {
    next(error);
  }
}

export async function topupStatus(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid topup id" });
    }

    const topup = await Topup.findOne({
      _id: req.params.id,
      userId: req.user._id,
    })
      .select("status credit amount paymentCode paidAt createdAt updatedAt")
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
