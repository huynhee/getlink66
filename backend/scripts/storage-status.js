import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";

await connectDb();
try {
  const { buildStorageHealthSnapshot } = await import("../src/utils/storageHealthService.js");
  const snapshot = await buildStorageHealthSnapshot({ verifyDrive: true });
  console.log(JSON.stringify(snapshot, null, 2));
  if (!snapshot.ok) process.exitCode = 2;
} finally {
  await closeDbConnections();
}
