import SiteSetting from "../models/SiteSetting.js";
import { archiveCommentText, createArchiveTrace } from "../utils/archiveTrace.js";
import { prepareArchiveComment } from "../utils/archiveCommentStream.js";
import { serializeArchiveCommentPlan } from "../utils/archiveCommentPlan.js";

export async function archiveCommentSnapshot(session) {
  // Legacy EXEs verify the original SHA-256 and must receive the original archive bytes.
  if (session.clientType !== "web") return {};
  const setting = await SiteSetting.findOne({ key: "homepage" }).select("archiveCommentEnabled archiveCommentText").lean();
  if (!setting?.archiveCommentEnabled) return {};
  const token = createArchiveTrace({ userId: session.userId, modelId: session.modelId,
    sessionId: session._id, assetType: session.assetType });
  const comment = archiveCommentText(setting.archiveCommentText ?? "3dipl.org", token);
  const plan = await prepareArchiveComment(session, comment, { signal: AbortSignal.timeout(15000), pinDriveVersion: true });
  return { archiveComment: comment, archiveSourceFingerprint: plan.fingerprint,
    archiveCommentPlan: serializeArchiveCommentPlan(session, comment, plan),
    sourceFileSize: session.fileSize, fileSize: plan.size, sha256: "" };
}
