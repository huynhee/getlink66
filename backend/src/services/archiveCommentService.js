import SiteSetting from "../models/SiteSetting.js";
import { archiveCommentText, createArchiveTrace } from "../utils/archiveTrace.js";
import { prepareArchiveComment } from "../utils/archiveCommentStream.js";
import { serializeArchiveCommentPlan } from "../utils/archiveCommentPlan.js";
import { createArchiveExtraFiles } from "../utils/archiveExtraFiles.js";

export async function archiveCommentSnapshot(session) {
  // Legacy EXEs verify the original SHA-256 and must receive the original archive bytes.
  if (session.clientType !== "web") return {};
  const setting = await SiteSetting.findOne({ key: "homepage" })
    .select("archiveCommentEnabled archiveCommentText archiveTextFileEnabled archiveTextFileName archiveTextFileText").lean();
  if (!setting?.archiveCommentEnabled) return {};
  const token = createArchiveTrace({ userId: session.userId, modelId: session.modelId,
    sessionId: session._id, assetType: session.assetType });
  const comment = archiveCommentText(setting.archiveCommentText ?? "3dipl.org", token);
  const archiveExtraFiles = createArchiveExtraFiles(setting, token);
  const source = { ...session, archiveExtraFiles };
  const plan = await prepareArchiveComment(source, comment, { signal: AbortSignal.timeout(15000), pinDriveVersion: true });
  return { archiveComment: comment, archiveExtraFiles, archiveSourceFingerprint: plan.fingerprint,
    archiveCommentPlan: serializeArchiveCommentPlan(source, comment, plan),
    sourceFileSize: session.fileSize, fileSize: plan.size, sha256: "" };
}
