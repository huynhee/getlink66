import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";
import { normalizeMarketplaceTitle } from "../src/utils/marketplaceSort.js";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const batchArgument = process.argv.find((value) => value.startsWith("--batch="));
const batchSize = Math.min(2_000, Math.max(50, Number(batchArgument?.split("=")[1] || 500)));

async function main() {
  await connectDb();
  const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
  let lastId = null;
  let inspected = 0;
  let changed = 0;

  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const rows = await MarketplaceModel.find(query)
      .sort({ _id: 1 })
      .limit(batchSize)
      .select("_id title titleSort")
      .lean();
    if (!rows.length) break;

    const operations = rows.flatMap((row) => {
      const titleSort = normalizeMarketplaceTitle(row.title);
      if (row.titleSort === titleSort) return [];
      return [{
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { titleSort } },
        },
      }];
    });
    inspected += rows.length;
    changed += operations.length;
    if (execute && operations.length) await MarketplaceModel.bulkWrite(operations, { ordered: false });
    lastId = rows.at(-1)._id;
    console.log(`${execute ? "Backfilled" : "Would backfill"} ${changed} of ${inspected} inspected marketplace assets.`);
  }

  console.log(JSON.stringify({ execute, inspected, changed, batchSize }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbConnections().catch(() => {});
  });
