import { buildStorageHealthSnapshot } from "../utils/storageHealthService.js";

export async function adminStorageHealth(_req, res, next) {
  try {
    const storage = await buildStorageHealthSnapshot({ verifyDrive: true });
    return res.json({ storage });
  } catch (error) {
    return next(error);
  }
}
