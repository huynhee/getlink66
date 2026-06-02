import Topup from "../models/Topup.js";

export async function expirePendingSepayTopups(query = {}) {
  const expiredTopups = await Topup.find({
    ...query,
    status: "pending",
    gatewayProvider: "sepay",
    expiresAt: { $lt: new Date() },
  })
    .select("_id")
    .lean();

  if (!expiredTopups.length) return 0;

  const canceledAt = new Date();
  const results = await Promise.all(
    expiredTopups.map((topup) =>
      Topup.findOneAndUpdate(
        { _id: topup._id, status: "pending" },
        {
          $set: {
            status: "rejected",
            canceledAt,
            rejectionReason: "expired",
          },
        },
        { new: true },
      ),
    ),
  );

  return results.filter(Boolean).length;
}
