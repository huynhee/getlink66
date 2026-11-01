import { getUsable3D66Cookies } from "../utils/3d66CookiePool.js";

const PUBLIC_OFFLINE_MESSAGE = "Hệ thống tải 3D đang lỗi, vui lòng thử lại sau.";
const PUBLIC_ONLINE_MESSAGE = "Hệ thống tải 3D đang hoạt động.";

export async function get3D66Status(_req, res, next) {
  try {
    const usableCookies = await getUsable3D66Cookies();
    const cookie = usableCookies[0];

    if (!cookie?.value) {
      return res.json({
        status: "offline",
        online: false,
        message: PUBLIC_OFFLINE_MESSAGE
      });
    }

    if (cookie.lastTestOk === false) {
      return res.json({
        status: "offline",
        online: false,
        message: PUBLIC_OFFLINE_MESSAGE
      });
    }

    return res.json({
      status: "online",
      online: true,
      message: PUBLIC_ONLINE_MESSAGE
    });
  } catch (error) {
    next(error);
  }
}
