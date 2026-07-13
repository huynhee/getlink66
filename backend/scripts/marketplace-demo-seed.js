import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";

await connectDb();
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { seedMarketplaceDemoModels } = await import("../src/utils/marketplaceDemoSeed.js");

try {
  await initializeMarketplaceCategories();
  const result = await seedMarketplaceDemoModels();
  console.log(`Marketplace demo seed complete: ${result.created} models.`);
} finally {
  await mongoose.disconnect().catch(() => {});
}
