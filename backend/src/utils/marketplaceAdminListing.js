export const ADMIN_ASSET_INDEX = "admin_asset_created_page";
export const ADMIN_ASSET_INDEX_KEY = { assetType: 1, createdAt: -1, _id: -1 };
const PAGE_SIZE = 20;
const QUERY_TIMEOUT_MS = 10_000;

export function adminListingError(error) {
  if ([50, 262].includes(error?.code) || error?.name === "MongoNetworkTimeoutError") {
    return Object.assign(new Error("The catalog query timed out. Please narrow the search and try again."), {
      status: 504, code: "ADMIN_MARKETPLACE_QUERY_TIMEOUT", cause: error,
    });
  }
  if (error?.code === 2 && /hint/i.test(error.message) && /index/i.test(error.message)) {
    return Object.assign(new Error("The admin catalog index must be installed before listing assets."), {
      status: 503, code: "ADMIN_MARKETPLACE_INDEX_REQUIRED", cause: error,
    });
  }
  return error;
}

export async function listAdminAssets(Model, query, requestedPage, { memory = false, signal } = {}) {
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE)) : 1;
  signal?.throwIfAborted();
  const start = Date.now();
  const options = () => ({
    hint: ADMIN_ASSET_INDEX,
    maxTimeMS: Math.max(1, QUERY_TIMEOUT_MS - (Date.now() - start)),
    signal,
    comment: "admin-marketplace-list",
  });
  const rows = (selectedPage) => [
    { $skip: (selectedPage - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },
    { $project: { "source.raw": 0 } },
  ];
  let total;
  let models;
  if (memory) {
    total = await Model.countDocuments(query);
  } else {
    // One indexed pass supplies both the exact count and page, without the public multikey planner.
    const [result] = await Model.aggregate([
      { $match: query },
      { $sort: { createdAt: -1, _id: -1 } },
      { $facet: { total: [{ $count: "value" }], models: rows(page) } },
    ]).option(options());
    total = result?.total?.[0]?.value || 0;
    models = result?.models || [];
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  if (memory) {
    models = await Model.find(query).sort({ createdAt: -1, _id: -1 })
      .skip((safePage - 1) * PAGE_SIZE).limit(PAGE_SIZE).select("-source.raw").lean();
  } else if (safePage !== page && total) {
    models = await Model.aggregate([
      { $match: query }, { $sort: { createdAt: -1, _id: -1 } }, ...rows(safePage),
    ]).option(options());
  }
  signal?.throwIfAborted();
  return { models, pagination: { page: safePage, pageSize: PAGE_SIZE, total, totalPages } };
}
