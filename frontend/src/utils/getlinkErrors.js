const messages = {
  GETLINK_UNAVAILABLE: {
    en: "This model is temporarily unavailable. Please try again later or contact support.",
    vi: "Tạm thời chưa thể xử lý model này. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.",
  },
  GETLINK_FORMAT_UNAVAILABLE: {
    en: "The selected format is no longer available. Please check the model again.",
    vi: "Định dạng đã chọn không còn khả dụng. Vui lòng kiểm tra lại thông tin model.",
  },
  GETLINK_INVALID_INPUT: {
    en: "Invalid model link. Please check and submit the full link again.",
    vi: "Link model không hợp lệ. Vui lòng kiểm tra và gửi lại link đầy đủ.",
  },
  GETLINK_MODEL_UNAVAILABLE: {
    en: "This model is no longer available. Please choose another model.",
    vi: "Model này không còn khả dụng. Vui lòng chọn model khác.",
  },
};

const technicalDetails = /THREED66_|\b(?:captcha|recaptcha|hcaptcha|cookies?|playwright|puppeteer|browser|chromium|chrome|profiles?|admin(?:istrator)?|footprint|collection|hybrid|resolver|proxy|upstream|cdp|PHPSESSID|login_sign|fingerprint|acw_sc|aliyun|sof)\b|st\s*(?:=|%3d)\s*2|user[_ -]?data[_ -]?dir|launchPersistentContext|rewritten|signed (?:model |download )?link|clean link|(?:login|access|refresh)[_ -]?token|trình duyệt|hồ sơ|quản trị|xác minh|thuật toán|lịch sử truy cập|bộ sưu tập|(?:tài khoản|đăng nhập)\s*3d66|3d66\s*account/i;

export function isPublicGetlinkPath(path = "") {
  const value = String(path);
  if (/^\/api\/getlink\/inspect(?:[?#]|$)/.test(value)) return false;
  return /^\/api\/(?:plugin\/)?getlink(?:[/?#]|$)/.test(value);
}

export function getlinkLanguage() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("language") === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
}

export function publicGetlinkError(error, language = getlinkLanguage()) {
  const code = String(error?.code || "");
  const message = typeof error === "string" ? error : String(error?.message || "");
  let publicCode = code.toUpperCase();
  if (publicCode.endsWith("_INPUT_INVALID")) publicCode = "GETLINK_INVALID_INPUT";
  if (publicCode === "THREED66_FORMAT_UNAVAILABLE") publicCode = "GETLINK_FORMAT_UNAVAILABLE";
  if (publicCode === "THREED66_MODEL_REMOVED") publicCode = "GETLINK_MODEL_UNAVAILABLE";
  const details = `${code} ${message}`;
  if (!Object.hasOwn(messages, publicCode) && (publicCode.startsWith("THREED66_")
    || technicalDetails.test(details) || technicalDetails.test(details.replaceAll("_", " ")))) {
    publicCode = "GETLINK_UNAVAILABLE";
  }
  if (!message && !Object.hasOwn(messages, publicCode)) publicCode = "GETLINK_UNAVAILABLE";
  return Object.hasOwn(messages, publicCode)
    ? { code: publicCode, message: messages[publicCode][language === "en" ? "en" : "vi"] }
    : { code, message };
}

export function publicGetlinkJobData(data, language = getlinkLanguage()) {
  if (!data?.job?.error) return data;
  return { ...data, job: { ...data.job, error: {
    ...(typeof data.job.error === "object" ? data.job.error : {}),
    ...publicGetlinkError(data.job.error, language),
  } } };
}
