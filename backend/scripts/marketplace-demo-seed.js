import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";

await connectDb();
const { initializeMarketplaceCategories } = await import("../src/utils/marketplaceSeed.js");
const { seedMarketplaceDemoModels, seedMarketplaceDemoScenes } = await import("../src/utils/marketplaceDemoSeed.js");

try {
  await initializeMarketplaceCategories();
  const models = await seedMarketplaceDemoModels();
  const scenes = await seedMarketplaceDemoScenes();
  console.log(`Marketplace demo seed complete: ${models.created} models, ${scenes.created} scenes.`);
} finally {
  await closeDbConnections().catch(() => {});
}
