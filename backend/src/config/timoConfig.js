const value = (env, name) => String(env[name] || "").trim();

export function timoConfiguration(env = process.env) {
  return {
    enabled: value(env, "TIMO_ENABLED") === "true",
    workerEnabled: value(env, "TIMO_MAIL_WORKER_ENABLED") === "true",
    bankId: "970454",
    accountNo: value(env, "TIMO_ACCOUNT_NO"),
    accountName: value(env, "TIMO_ACCOUNT_NAME"),
    mailbox: value(env, "TIMO_GMAIL_ADDRESS").toLowerCase(),
    clientId: value(env, "TIMO_GMAIL_CLIENT_ID"),
    clientSecret: value(env, "TIMO_GMAIL_CLIENT_SECRET"),
    refreshToken: value(env, "TIMO_GMAIL_REFRESH_TOKEN"),
    startAt: value(env, "TIMO_MAIL_START_AT"),
    sender: "support@timo.vn",
    signingDomain: "timo.vn",
  };
}

export function timoConfigurationIssues(env = process.env, { force = false } = {}) {
  const config = timoConfiguration(env);
  const provider = value(env, "VND_PAYMENT_PROVIDER") || "sepay";
  const errors = [];
  if (!["sepay", "timo"].includes(provider)) errors.push("VND_PAYMENT_PROVIDER must be sepay or timo");
  if (!force && !config.enabled && !config.workerEnabled && provider !== "timo") return errors;
  if (provider === "timo" && !config.enabled) errors.push("TIMO_ENABLED must be true when VND_PAYMENT_PROVIDER=timo");
  if (config.enabled && !config.workerEnabled) errors.push("TIMO_MAIL_WORKER_ENABLED must be true before accepting Timo payments");
  if (!/^\d{8,20}$/.test(config.accountNo)) errors.push("TIMO_ACCOUNT_NO must contain the Timo receiving account number");
  if (!config.accountName || /[\r\n]/.test(config.accountName)) errors.push("TIMO_ACCOUNT_NAME is required");
  if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(config.mailbox)) errors.push("TIMO_GMAIL_ADDRESS must be the Gmail receiving original Timo notifications");
  for (const [name, field] of [["TIMO_GMAIL_CLIENT_ID", "clientId"], ["TIMO_GMAIL_CLIENT_SECRET", "clientSecret"], ["TIMO_GMAIL_REFRESH_TOKEN", "refreshToken"]]) {
    if (!config[field]) errors.push(`${name} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(config.startAt) || !Number.isFinite(Date.parse(config.startAt))) errors.push("TIMO_MAIL_START_AT must be an ISO timestamp for the payment cutover");
  else if (config.enabled && Date.parse(config.startAt) > Date.now() + 60_000) errors.push("TIMO_MAIL_START_AT cannot be in the future while accepting payments");
  return errors;
}

export function assertTimoConfigured({ newCheckout = false } = {}) {
  const issues = timoConfigurationIssues(process.env, { force: true });
  const config = timoConfiguration();
  if (issues.length || (newCheckout && !config.enabled)) {
    throw Object.assign(new Error("Timo payment configuration is incomplete or disabled"), { status: 503, code: "TIMO_NOT_CONFIGURED" });
  }
  return config;
}

export function vndPaymentAvailability() {
  const provider = String(process.env.VND_PAYMENT_PROVIDER || "sepay");
  return { provider, enabled: provider === "timo" ? timoConfiguration().enabled && !timoConfigurationIssues().length : process.env.SEPAY_ENABLED !== "false" };
}
