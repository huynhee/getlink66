import Cookie from "../models/Cookie.js";
import { getUsable3D66Cookies } from "../utils/3d66CookiePool.js";

const PUBLIC_OFFLINE_MESSAGE = "Hệ thống tải 3D66 đang lỗi, vui lòng thử lại sau.";
const PUBLIC_ONLINE_MESSAGE = "Hệ thống tải 3D66 đang hoạt động.";

function cookieKeys(value = "") {
  return new Set(
    String(value)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        return separatorIndex > -1 ? part.slice(0, separatorIndex).trim() : "";
      })
      .filter(Boolean)
  );
}

export async function get3D66Status(_req, res, next) {
  try {
    const requiredKeys = ["PHPSESSID", "login_token", "login_sign"];
    const usableCookies = await getUsable3D66Cookies();
    const cookie = usableCookies[0] || await Cookie.findOne().sort({ updatedAt: -1 });

    if (!cookie?.value) {
      return res.json({
        status: "offline",
        online: false,
        message: PUBLIC_OFFLINE_MESSAGE
      });
    }

    if (!usableCookies.length) {
      return res.json({
        status: "offline",
        online: false,
        message: PUBLIC_OFFLINE_MESSAGE
      });
    }

    const keys = cookieKeys(cookie.value);
    const missingKeys = requiredKeys.filter((key) => !keys.has(key));
    if (missingKeys.length > 0) {
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
