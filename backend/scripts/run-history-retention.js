import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";

await connectDb();
try {
  const { runHistoryRetentionCycle } = await import("../src/utils/historyRetentionService.js");
  const result = await runHistoryRetentionCycle({
    batchSize: Number(process.env.HISTORY_RETENTION_BATCH_SIZE || 500),
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} finally {
  await closeDbConnections();
}
