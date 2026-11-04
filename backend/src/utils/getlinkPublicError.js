const technicalMessage = /captcha|browser|chromium|playwright|cookie|proxy|fingerprint|profile|administrator verification|signed (?:model |download )?link|clean link|rewritten|footprint|acw_sc|aliyun|PHPSESSID|(?:login|access|refresh)[_-]?token|3d66|THREED66|\bsof\b|\bst=2\b|trình duyệt|quản trị|xác minh|thuật toán|lịch sử truy cập|bộ sưu tập/i;

const messages = {
  GETLINK_UNAVAILABLE: [
    "Tạm thời chưa thể xử lý model này. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.",
    "This model is temporarily unavailable. Please try again later or contact support.",
  ],
  GETLINK_INVALID_INPUT: [
    "Link model không hợp lệ. Vui lòng kiểm tra và gửi lại link đầy đủ.",
    "Invalid model link. Please check and submit the full link again.",
  ],
  GETLINK_FORMAT_UNAVAILABLE: [
    "Định dạng đã chọn không còn khả dụng. Vui lòng kiểm tra lại thông tin model.",
    "The selected format is no longer available. Please check the model again.",
  ],
  GETLINK_MODEL_UNAVAILABLE: [
    "Model này không còn khả dụng. Vui lòng chọn model khác.",
    "This model is no longer available. Please choose another model.",
  ],
};

export function getlinkErrorLanguage(req) {
  return /^vi(?:[-,;]|$)/i.test(String(req?.get?.("accept-language") || req?.headers?.["accept-language"] || "")) ? "vi" : "en";
}

export function publicGetlinkError(error = {}, language = "en") {
  const code = String(error.code || "");
  const message = String(error.message || "");
  const status = Number(error.status || 500);
  let publicCode = Object.hasOwn(messages, code) ? code : "";
  if (code === "THREED66_FORMAT_UNAVAILABLE") publicCode = "GETLINK_FORMAT_UNAVAILABLE";
  else if (code === "THREED66_HYBRID_INPUT_INVALID") publicCode = "GETLINK_INVALID_INPUT";
  else if (code === "THREED66_MODEL_REMOVED") publicCode = "GETLINK_MODEL_UNAVAILABLE";
  else if (!publicCode && (status >= 500 || /^THREED66_|^PLAYWRIGHT_/i.test(code) || technicalMessage.test(message))) {
    publicCode = "GETLINK_UNAVAILABLE";
  }
  if (!publicCode) return null;
  return { message: messages[publicCode][language === "vi" ? 0 : 1], code: publicCode };
}

export function publicGetlinkJobError(error, req) {
  if (!error?.message) return null;
  return {
    message: String(error.message).slice(0, 300),
    code: String(error.code || "").slice(0, 80),
    ...publicGetlinkError(error, getlinkErrorLanguage(req)),
    status: Number(error.status || 500),
    retryable: error.retryable === true,
  };
}
