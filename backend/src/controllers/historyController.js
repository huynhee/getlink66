import { buildUserTimeline } from "../utils/timelineService.js";

export async function timelineHistory(req, res, next) {
  try {
    const data = await buildUserTimeline({
      userId: req.user._id,
      type: req.query.type,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

