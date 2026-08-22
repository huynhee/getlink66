import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: DownloadSession } = await import("../src/models/DownloadSession.js");
const { default: ModelDownload } = await import("../src/models/ModelDownload.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: CreditLedgerEntry } = await import("../src/models/CreditLedgerEntry.js");
const { invalidateMarketplacePricingCache } = await import("../src/utils/marketplacePricingService.js");
const {
  createMarketplaceDownloadSession,
  finalizeMarketplaceDownloadBilling,
  getMarketplaceDownloadOptions,
} = await import("../src/utils/marketplaceDownloadService.js");

let sequence = 0;

function requestFor(user, paymentMethod = "credit") {
  sequence += 1;
  return {
    user,
    body: {
      paymentMethod,
      clientRequestId: `credit-test-${sequence}`,
    },
    ip: "127.0.0.88",
    get(name) {
      return String(name).toLowerCase() === "user-agent" ? "credit-download-test" : "";
    },
  };
}

async function setPrices(modelPrice = 5, scenePrice = 25) {
  await SiteSetting.findOneAndUpdate(
    { key: "homepage" },
    { $set: { key: "homepage", marketplaceModelCreditPrice: modelPrice, marketplaceSceneCreditPrice: scenePrice } },
    { upsert: true, new: true },
  );
  invalidateMarketplacePricingCache();
}

async function createAsset(assetType, accessType = "member") {
  sequence += 1;
  return MarketplaceModel.create({
    assetType,
    title: `${assetType} Credit ${sequence}`,
    slug: `${assetType}-credit-${sequence}`,
    accessType,
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    storageProvider: "google_drive",
    driveFileId: `credit-drive-${sequence}`,
    source: { provider: "google_drive", assetId: `credit-asset-${sequence}` },
  });
}

test("Credit billing starts only when the downloadable file is issued", async () => {
  await setPrices();
  const user = await User.create({ email: `credit-late-${sequence}@example.test`, name: "Credit late", credit: 30 });
  const model = await createAsset("model");
  const created = await createMarketplaceDownloadSession({
    req: requestFor(user),
    modelId: model._id,
    expectedAssetType: "model",
  });

  assert.equal(created.paymentMethod, "credit");
  assert.equal(created.creditCost, 5);
  assert.equal((await User.findById(user._id)).credit, 30);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: user._id }), 0);
  assert.equal(await DailyDownloadQuota.countDocuments({ userId: user._id }), 0);

  const billed = await finalizeMarketplaceDownloadBilling(created.session);
  const download = await ModelDownload.findOne({ sessionId: created.session._id });
  assert.equal(billed.billingStatus, "charged");
  assert.equal(billed.creditCost, 5);
  assert.equal((await User.findById(user._id)).credit, 25);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: user._id }), 1);
  assert.equal(download.billingStatus, "charged");
  assert.equal(download.creditCost, 5);
});

test("a paid entitlement reuses Model and Scene downloads for 24 hours", async () => {
  await setPrices();
  const user = await User.create({ email: `credit-reuse-${sequence}@example.test`, name: "Credit reuse", credit: 40 });
  const scene = await createAsset("scene");

  const first = await createMarketplaceDownloadSession({
    req: requestFor(user),
    modelId: scene._id,
    expectedAssetType: "scene",
  });
  const firstBilled = await finalizeMarketplaceDownloadBilling(first.session);
  assert.equal(firstBilled.creditCost, 25);
  assert.equal((await User.findById(user._id)).credit, 15);

  const options = await getMarketplaceDownloadOptions({
    req: requestFor(await User.findById(user._id)),
    modelId: scene._id,
    expectedAssetType: "scene",
  });
  assert.equal(options.defaultMethod, "credit");
  assert.equal(options.options.find((item) => item.method === "credit").cost, 0);

  const retry = await createMarketplaceDownloadSession({
    req: requestFor(await User.findById(user._id)),
    modelId: scene._id,
    expectedAssetType: "scene",
  });
  const retriedBilling = await finalizeMarketplaceDownloadBilling(retry.session);
  assert.equal(retriedBilling.billingStatus, "reused");
  assert.equal(retriedBilling.creditCost, 0);
  assert.equal((await User.findById(user._id)).credit, 15);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: user._id }), 1);
});

test("concurrent Credit sessions debit the account only once", async () => {
  await setPrices();
  const user = await User.create({ email: `credit-concurrent-${sequence}@example.test`, name: "Credit concurrent", credit: 20 });
  const model = await createAsset("model");
  const [first, second] = await Promise.all([
    createMarketplaceDownloadSession({ req: requestFor(user), modelId: model._id }),
    createMarketplaceDownloadSession({ req: requestFor(user), modelId: model._id }),
  ]);
  const [firstBilling, secondBilling] = await Promise.all([
    finalizeMarketplaceDownloadBilling(first.session),
    finalizeMarketplaceDownloadBilling(second.session),
  ]);

  assert.deepEqual(
    [firstBilling.billingStatus, secondBilling.billingStatus].sort(),
    ["charged", "reused"],
  );
  assert.equal((await User.findById(user._id)).credit, 15);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: user._id }), 1);
});

test("insufficient Credit creates no session, ledger, or quota charge", async () => {
  await setPrices();
  const user = await User.create({ email: `credit-low-${sequence}@example.test`, name: "Credit low", credit: 4 });
  const model = await createAsset("model");

  await assert.rejects(
    createMarketplaceDownloadSession({ req: requestFor(user), modelId: model._id }),
    (error) => error?.status === 402
      && error?.code === "INSUFFICIENT_CREDIT"
      && error?.details?.required === 5,
  );
  assert.equal(await DownloadSession.countDocuments({ userId: user._id }), 0);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: user._id }), 0);
  assert.equal(await DailyDownloadQuota.countDocuments({ userId: user._id }), 0);
});

test("a Credit session keeps its quoted price when admin changes pricing", async () => {
  await setPrices(7, 25);
  const user = await User.create({ email: `credit-quote-${sequence}@example.test`, name: "Credit quote", credit: 20 });
  const model = await createAsset("model");
  const created = await createMarketplaceDownloadSession({
    req: requestFor(user),
    modelId: model._id,
  });
  await setPrices(9, 25);

  const billed = await finalizeMarketplaceDownloadBilling(created.session);
  assert.equal(billed.creditCost, 7);
  assert.equal((await User.findById(user._id)).credit, 13);
});

test("a retry repairs the VPS download log after Atlas already charged Credit", async () => {
  await setPrices();
  const user = await User.create({ email: `credit-repair-${sequence}@example.test`, name: "Credit repair", credit: 20 });
  const model = await createAsset("model");
  const created = await createMarketplaceDownloadSession({
    req: requestFor(user),
    modelId: model._id,
  });
  const billed = await finalizeMarketplaceDownloadBilling(created.session);
  assert.equal(billed.billingStatus, "charged");

  await ModelDownload.findOneAndUpdate(
    { sessionId: created.session._id },
    {
      $set: {
        billingStatus: "pending",
        creditCost: 5,
        creditTransactionId: "",
        creditEntitlementUntil: null,
      },
    },
  );

  const retried = await finalizeMarketplaceDownloadBilling(billed);
  const repairedDownload = await ModelDownload.findOne({ sessionId: created.session._id });
  assert.equal(retried.billingStatus, "charged");
  assert.equal(repairedDownload.billingStatus, "charged");
  assert.equal(repairedDownload.creditCost, 5);
  assert.equal((await User.findById(user._id)).credit, 15);
  assert.equal(await CreditLedgerEntry.countDocuments({ userId: user._id }), 1);
});
