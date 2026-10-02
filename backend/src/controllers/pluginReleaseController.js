import { pluginReleaseService } from "../services/pluginReleaseService.js";

function action(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };
}

export const listPluginReleases = action(async (_req, res) => res.json(await pluginReleaseService.list()));
export const getPluginRelease = action(async (req, res) => res.json({ release: await pluginReleaseService.get(req.params.id) }));
export const createPluginRelease = action(async (req, res) => res.status(201).json({ release: await pluginReleaseService.create(req.body?.manifest, req.body?.files, req.user._id) }));
export const getPluginReleaseUpload = action(async (req, res) => res.json(await pluginReleaseService.uploadStatus(req.params.id, req.params.name)));
export const uploadPluginReleaseChunk = action(async (req, res) => res.json(await pluginReleaseService.chunk(req.params.id, req.params.name, Number(req.params.index), req.body)));
export const verifyPluginRelease = action(async (req, res) => res.json({ release: await pluginReleaseService.verify(req.params.id) }));
export const publishPluginRelease = action(async (req, res) => res.json(await pluginReleaseService.publish(req.params.id, req.body?.expectedRevision)));
export const withdrawPluginRelease = action(async (req, res) => res.json(await pluginReleaseService.withdraw(req.params.id, req.body?.expectedRevision)));
export const deletePluginRelease = action(async (req, res) => { await pluginReleaseService.remove(req.params.id); res.json({ deleted: true }); });
export const publicPluginDownloads = action(async (_req, res) => { res.setHeader("cache-control", "no-cache"); res.json(await pluginReleaseService.downloads()); });
export const publicPluginReleaseFile = action(async (req, res) => {
  const result = await pluginReleaseService.publicFile(req.params.channel, req.params.version, req.params.name);
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  res.setHeader("content-disposition", `attachment; filename="${result.file.name}"`);
  res.setHeader("content-type", "application/octet-stream");
  res.setHeader("x-content-type-options", "nosniff");
  res.sendFile(result.path);
});
