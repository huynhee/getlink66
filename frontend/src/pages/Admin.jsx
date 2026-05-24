import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, Ban, BarChart3, Check, Cookie, FileText, Gift, GripVertical, KeyRound, Loader2, Megaphone, Package, Pencil, Plus, RotateCcw, Save, ShieldAlert, UserPlus, Users, X } from "lucide-react";
import AdminArticles from "../components/AdminArticles.jsx";
import { api } from "../api.js";
import { text, translations } from "../i18n.js";

const emptyPackage = {
  name: "",
  price: "",
  credit: "",
  salePercent: "",
  salePrice: "",
  maxTopupsPerUser: "",
  badge: "",
  features: "5 lượt tải model\nLưu lịch sử tải\nHỗ trợ cơ bản"
};

const emptyVoucher = {
  code: "",
  description: "",
  creditBonus: "",
  discountPercent: "",
  usageLimit: "",
  perUserLimit: "",
  applicablePackageIds: [],
  expireAt: ""
};

const emptyNotification = {
  title: "",
  body: "",
  displayType: "dropdown",
  imageUrl: "",
  actionLabel: "",
  actionUrl: "",
  targetType: "all",
  emails: "",
  startsAt: "",
  expiresAt: ""
};

const referralModeOptions = [
  {
    value: "both",
    vi: "Cả hai cùng nhận credit",
    en: "Both users receive credit",
  },
  {
    value: "referrer_only",
    vi: "Chỉ người giới thiệu nhận",
    en: "Only referrer receives credit",
  },
  {
    value: "off",
    vi: "Tắt giới thiệu",
    en: "Disable referral",
  },
];

const defaultSiteSettings = {
  referralMode: "both",
  threed66GetlinkConcurrency: 1,
  threed66PreviewConcurrency: 1,
  threed66RefreshConcurrency: 1,
  threed66PaytypeValue: "4",
  threed66RequestIntervalMs: 2500,
  threed66BrowserConcurrency: 1,
  threed66TimeoutMs: 30000,
  threed66CookieMaxFailures: 2,
  threed66CookieCooldownMinutes: 30,
};

function discountedPrice(pkg) {
  if (Number(pkg.salePrice || 0) > 0) return Number(pkg.salePrice || 0);
  return Math.round(Number(pkg.price || 0) * (100 - Number(pkg.salePercent || 0)) / 100);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function Admin({ user, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const l = (vi, en) => text(language, vi, en);
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [activeSection, setActiveSection] = useState("overview");
  const [revenuePeriod, setRevenuePeriod] = useState("day");
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [articles, setArticles] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [siteSettings, setSiteSettings] = useState(defaultSiteSettings);
  const [referralMsg, setReferralMsg] = useState("");
  const [runtimeSettingsMsg, setRuntimeSettingsMsg] = useState("");
  const [cookieRecords, setCookieRecords] = useState([]);
  const [cookiePool, setCookiePool] = useState(null);
  const [systemLogs, setSystemLogs] = useState([]);
  const [cookie, setCookie] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [packageForm, setPackageForm] = useState(emptyPackage);
  const [voucherForm, setVoucherForm] = useState(emptyVoucher);
  const [voucherMsg, setVoucherMsg] = useState("");
  const [notificationForm, setNotificationForm] = useState(emptyNotification);
  const [notificationMsg, setNotificationMsg] = useState("");
  const [editUser, setEditUser] = useState(null);
  const [editCredit, setEditCredit] = useState("");
  const [banReasonByUser, setBanReasonByUser] = useState({});
  const [editingPackageId, setEditingPackageId] = useState("");
  const [editingVoucherId, setEditingVoucherId] = useState("");
  const [dragPackageId, setDragPackageId] = useState("");
  const [twoFactorQr, setTwoFactorQr] = useState("");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [twoFactorMsg, setTwoFactorMsg] = useState("");

  async function loadData() {
    const [oRes, uRes, pRes, vRes, cRes, sRes, lRes, aRes, nRes, rRes, settingRes] = await Promise.all([
      api(`/api/admin/overview?period=${revenuePeriod}`),
      api("/api/admin/users"),
      api("/api/admin/topup-packages"),
      api("/api/admin/vouchers"),
      api("/api/admin/cookies"),
      api("/api/admin/cookies/status"),
      api("/api/admin/system-logs"),
      api("/api/admin/articles"),
      api("/api/admin/notifications"),
      api("/api/admin/referrals"),
      api("/api/settings")
    ]);
    setOverview(oRes.overview || null);
    setUsers(uRes.users || []);
    setPackages(pRes.packages || []);
    setVouchers(vRes.vouchers || []);
    setCookieRecords(cRes.cookies || []);
    setCookiePool(sRes.pool || null);
    setSystemLogs(lRes.logs || []);
    setArticles(aRes.articles || []);
    setNotifications(nRes.notifications || []);
    setReferrals(rRes.referrals || []);
    setSiteSettings({ ...defaultSiteSettings, ...(settingRes.settings || {}) });
  }

  useEffect(() => {
    loadData().catch(console.error);
  }, [revenuePeriod]);

  function fillPackageForm(pack) {
    setEditingPackageId(pack?._id || "");
    if (!pack) {
      setPackageForm(emptyPackage);
      return;
    }

    setPackageForm({
      name: pack.name || "",
      price: pack.price || "",
      credit: pack.credit || "",
      salePercent: pack.salePercent || "",
      salePrice: Number(pack.salePrice || 0) > 0 ? pack.salePrice : "",
      maxTopupsPerUser: Number(pack.maxTopupsPerUser || 0) > 0 ? pack.maxTopupsPerUser : "",
      badge: pack.badge || "",
      features: Array.isArray(pack.features) ? pack.features.join("\n") : ""
    });
  }

  async function savePackage(event) {
    event.preventDefault();
    await api(editingPackageId ? `/api/admin/topup-packages/${editingPackageId}` : "/api/admin/topup-packages", {
      method: editingPackageId ? "PUT" : "POST",
      body: JSON.stringify(packageForm)
    });
    setPackageForm(emptyPackage);
    setEditingPackageId("");
    await loadData();
  }

  async function deletePackage(id) {
    await api(`/api/admin/topup-packages/${id}`, { method: "DELETE" });
    if (editingPackageId === id) {
      setEditingPackageId("");
      setPackageForm(emptyPackage);
    }
    await loadData();
  }

  async function movePackage(dragId, targetId) {
    if (!dragId || dragId === targetId) return;
    const fromIndex = packages.findIndex((item) => item._id === dragId);
    const toIndex = packages.findIndex((item) => item._id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextPackages = [...packages];
    const [dragged] = nextPackages.splice(fromIndex, 1);
    nextPackages.splice(toIndex, 0, dragged);
    setPackages(nextPackages);
    setDragPackageId("");

    const data = await api("/api/admin/topup-packages/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds: nextPackages.map((item) => item._id) })
    });
    setPackages(data.packages || nextPackages);
    await loadData();
  }

  function fillVoucherForm(voucher) {
    setEditingVoucherId(voucher?._id || "");
    if (!voucher) {
      setVoucherForm(emptyVoucher);
      setVoucherMsg("");
      return;
    }

    setVoucherForm({
      code: voucher.code || "",
      description: voucher.description || "",
      creditBonus: voucher.creditBonus || "",
      discountPercent: voucher.discountPercent || "",
      usageLimit: voucher.usageLimit || "",
      perUserLimit: Number(voucher.perUserLimit ?? 1) === Number(voucher.usageLimit || 0)
        ? ""
        : voucher.perUserLimit ?? "",
      applicablePackageIds: Array.isArray(voucher.applicablePackageIds)
        ? voucher.applicablePackageIds.map((pkg) => String(pkg?._id || pkg)).filter(Boolean)
        : [],
      expireAt: toDatetimeLocal(voucher.expireAt)
    });
    setVoucherMsg("");
  }

  async function saveVoucher(event) {
    event.preventDefault();
    try {
      const payload = {
        ...voucherForm,
        creditBonus: Number(voucherForm.creditBonus || 0),
        discountPercent: Number(voucherForm.discountPercent || 0),
        usageLimit: Number(voucherForm.usageLimit),
        perUserLimit:
          voucherForm.perUserLimit === "" ? undefined : Number(voucherForm.perUserLimit),
        applicablePackageIds: voucherForm.applicablePackageIds,
        expireAt: new Date(voucherForm.expireAt).toISOString()
      };
      await api(editingVoucherId ? `/api/admin/vouchers/${editingVoucherId}` : "/api/admin/voucher", {
        method: editingVoucherId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setVoucherForm(emptyVoucher);
      setEditingVoucherId("");
      setVoucherMsg(editingVoucherId
        ? l("Voucher đã cập nhật thành công.", "Voucher updated successfully.")
        : l("Voucher đã tạo thành công.", "Voucher created successfully."));
      await loadData();
    } catch (err) {
      setVoucherMsg(err.message);
    }
  }

  async function deleteVoucher(id) {
    await api(`/api/admin/vouchers/${id}`, { method: "DELETE" });
    if (editingVoucherId === id) {
      setEditingVoucherId("");
      setVoucherForm(emptyVoucher);
    }
    await loadData();
  }

  async function createNotification(event) {
    event.preventDefault();
    try {
      setNotificationMsg("");
      await api("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          ...notificationForm,
          startsAt: notificationForm.startsAt
            ? new Date(notificationForm.startsAt).toISOString()
            : undefined,
          expiresAt: notificationForm.expiresAt
            ? new Date(notificationForm.expiresAt).toISOString()
            : undefined
        })
      });
      setNotificationForm(emptyNotification);
      setNotificationMsg(l("Thông báo đã được gửi.", "Notification sent."));
      await loadData();
    } catch (err) {
      setNotificationMsg(err.message);
    }
  }

  async function deleteNotification(id) {
    await api(`/api/admin/notifications/${id}`, { method: "DELETE" });
    await loadData();
  }

  async function saveReferralMode(mode) {
    try {
      setReferralMsg("");
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ referralMode: mode })
      });
      setSiteSettings({ ...defaultSiteSettings, ...(data.settings || { ...siteSettings, referralMode: mode }) });
      setReferralMsg(l("Đã cập nhật chế độ giới thiệu.", "Referral mode updated."));
    } catch (err) {
      setReferralMsg(err.message);
    }
  }

  function updateRuntimeSetting(field, value) {
    setSiteSettings((settings) => ({ ...settings, [field]: value }));
  }

  async function saveRuntimeSettings(event) {
    event.preventDefault();
    try {
      setRuntimeSettingsMsg("");
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          threed66GetlinkConcurrency: Number(siteSettings.threed66GetlinkConcurrency || 1),
          threed66PreviewConcurrency: Number(siteSettings.threed66PreviewConcurrency || 1),
          threed66RefreshConcurrency: Number(siteSettings.threed66RefreshConcurrency || 1),
          threed66PaytypeValue: String(siteSettings.threed66PaytypeValue || "4").trim(),
          threed66RequestIntervalMs: Number(siteSettings.threed66RequestIntervalMs || 2500),
          threed66BrowserConcurrency: Number(siteSettings.threed66BrowserConcurrency || 1),
          threed66TimeoutMs: Number(siteSettings.threed66TimeoutMs || 30000),
          threed66CookieMaxFailures: Number(siteSettings.threed66CookieMaxFailures || 2),
          threed66CookieCooldownMinutes: Number(siteSettings.threed66CookieCooldownMinutes || 30),
        })
      });
      setSiteSettings({ ...defaultSiteSettings, ...(data.settings || {}) });
      setRuntimeSettingsMsg(l("Đã cập nhật thông số 3D66.", "3D66 runtime settings updated."));
      await loadData();
    } catch (err) {
      setRuntimeSettingsMsg(err.message);
    }
  }

  async function saveCookie(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await api("/api/admin/cookie", {
        method: "POST",
        body: JSON.stringify({ value: cookie })
      });
      setCookie("");
      await loadData();
      setMessage(l("Cookie 3D66 đã được lưu.", "3D66 cookie saved."));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function test3D66Cookie() {
    setLoading(true);
    try {
      const data = await api("/api/admin/cookie/test", {
        method: "POST",
        body: JSON.stringify({ value: cookie || undefined })
      });
      const details = data.mode === "model-page"
        ? ` ll_id:${data.hasLlId ? "ok" : "missing"} token:${data.hasToken ? "ok" : "missing"} up_time:${data.hasUpTime ? "ok" : "missing"}`
        : "";
      setMessage(l(`Cookie 3D66 hợp lệ.${details}`, `3D66 cookie is valid.${details}`));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function testSaved3D66Cookie(id) {
    setLoading(true);
    try {
      const data = await api(`/api/admin/cookies/${id}/test`, { method: "POST" });
      const details = data.mode === "model-page"
        ? ` ll_id:${data.hasLlId ? "ok" : "missing"} token:${data.hasToken ? "ok" : "missing"} up_time:${data.hasUpTime ? "ok" : "missing"}`
        : "";
      setMessage(l(`Cookie 3D66 hợp lệ.${details}`, `3D66 cookie is valid.${details}`));
      await loadData();
    } catch (err) {
      setMessage(err.message);
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  async function delete3D66Cookie(id) {
    await api(`/api/admin/cookies/${id}`, { method: "DELETE" });
    setMessage(l("Đã xóa cookie 3D66.", "3D66 cookie deleted."));
    await loadData();
  }

  async function addCredit(userId) {
    await api("/api/admin/add-credit", {
      method: "POST",
      body: JSON.stringify({ userId, credit: 1 })
    });
    await loadData();
  }

  async function saveUserCredit(userId) {
    await api("/api/admin/set-credit", {
      method: "POST",
      body: JSON.stringify({ userId, credit: Number(editCredit) })
    });
    setEditUser(null);
    await loadData();
  }

  async function toggleBanUser(targetUser) {
    const isBanned = Boolean(targetUser.isBanned);
    const endpoint = isBanned
      ? `/api/admin/users/${targetUser._id}/unban`
      : `/api/admin/users/${targetUser._id}/ban`;
    const options = isBanned
      ? { method: "POST" }
      : {
          method: "POST",
          body: JSON.stringify({
            reason:
              banReasonByUser[targetUser._id] ||
              "Tài khoản của bạn đã bị khóa quyền getlink.",
          }),
        };
    await api(endpoint, options);
    setBanReasonByUser((items) => ({ ...items, [targetUser._id]: "" }));
    await loadData();
  }

  async function handleGenerate2FA() {
    try {
      setLoading(true);
      setTwoFactorMsg("");
      const res = await api("/api/auth/2fa/generate", { method: "POST" });
      setTwoFactorQr(res.qrCode);
      setTwoFactorSecret(res.secret);
    } catch (err) {
      setTwoFactorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable2FA(e) {
    e.preventDefault();
    try {
      setLoading(true);
      setTwoFactorMsg("");
      await api("/api/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ token: twoFactorToken })
      });
      setTwoFactorMsg(l("Bật 2FA thành công! Vui lòng tải lại trang.", "2FA enabled successfully. Please reload the page."));
      setTwoFactorQr("");
      setTwoFactorToken("");
    } catch (err) {
      setTwoFactorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  const revenueChart = overview?.revenueChart || [];
  const chartRevenue = revenueChart.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const maxRevenue = Math.max(...revenueChart.map((item) => Number(item.revenue || 0)), 1);
  const chartLabels = {
    day: l("14 ngày gần nhất", "Last 14 days"),
    month: l("12 tháng gần nhất", "Last 12 months"),
    year: l("5 năm gần nhất", "Last 5 years")
  };
  const sections = [
    { key: "overview", label: t.adminOverview, icon: BarChart3 },
    { key: "packages", label: t.adminPackages, icon: Package, count: packages.length },
    { key: "vouchers", label: t.adminVouchers, icon: Gift, count: vouchers.length },
    { key: "notifications", label: t.notifications, icon: Megaphone, count: notifications.length },
    { key: "referrals", label: l("Giới thiệu", "Referrals"), icon: UserPlus, count: referrals.length },
    { key: "articles", label: t.adminArticles || l("Bài viết", "Articles"), icon: FileText, count: articles.length },
    { key: "threed66", label: l("Cài đặt 3D66", "3D66 settings"), icon: Activity },
    { key: "cookie", label: t.adminCookie, icon: Cookie },
    { key: "logs", label: l("Log lỗi", "Error logs"), icon: AlertTriangle, count: systemLogs.length },
    { key: "users", label: t.adminUsers, icon: Users, count: users.length },
    { key: "security", label: l("Bảo mật", "Security"), icon: ShieldAlert }
  ];

  return (
    <div className="stack">
      <section className="panel">
        <h2>{l("Quản trị hệ thống", "System administration")}</h2>
        <nav className="adminSectionNav" aria-label="Admin sections">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.key}
                type="button"
                className={activeSection === section.key ? "active" : ""}
                onClick={() => setActiveSection(section.key)}
              >
                <Icon size={16} />
                {section.label}
                {typeof section.count === "number" && <span>{section.count}</span>}
              </button>
            );
          })}
        </nav>
      </section>

      {activeSection === "overview" && (
        <section className="panel">
          <h2><BarChart3 size={20} /> {l("Tổng quan web", "Website overview")}</h2>
          <div className="overviewGrid">
            <div className="overviewCard">
              <span>{l("Người dùng", "Users")}</span>
              <strong>{overview?.totalUsers || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Credit đang có", "Current credit")}</span>
              <strong>{overview?.totalCredit || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Doanh thu đã thanh toán", "Paid revenue")}</span>
              <strong>{formatMoney(overview?.revenue)}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Số giao dịch thành công", "Successful top-up transactions")}</span>
              <strong>{overview?.approvedTopups || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Tiền chờ thanh toán", "Awaiting payment amount")}</span>
              <strong>{formatMoney(overview?.pendingAmount)}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Lượt getlink", "Getlink requests")}</span>
              <strong>{overview?.totalGetlinks || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Model đã cache", "Cached models")}</span>
              <strong>{overview?.cachedProducts || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>{l("Gói/Voucher active", "Active packages/vouchers")}</span>
              <strong>{overview?.activePackages || 0}/{overview?.activeVouchers || 0}</strong>
            </div>
          </div>
          <div className="revenueChartPanel">
            <div className="chartHeader">
              <div>
                <h3>{l("Biểu đồ doanh thu", "Revenue chart")}</h3>
                <p>{chartLabels[revenuePeriod]}, {l("tính theo giao dịch đã thanh toán.", "based on paid transactions.")}</p>
              </div>
              <div className="chartControls">
                {[
                  ["day", l("Ngày", "Day")],
                  ["month", l("Tháng", "Month")],
                  ["year", l("Năm", "Year")]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={revenuePeriod === value ? "active" : ""}
                    onClick={() => setRevenuePeriod(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <strong>{formatMoney(chartRevenue)}</strong>
            </div>
            <div className={`revenueChart ${revenuePeriod}`} aria-label={l("Biểu đồ doanh thu", "Revenue chart")}>
              {revenueChart.map((item) => {
                const height = Math.max(6, Math.round((Number(item.revenue || 0) / maxRevenue) * 100));
                return (
                  <div className="chartBarItem" key={item.date}>
                    <div className="chartBarTrack" title={`${item.label}: ${formatMoney(item.revenue)} (${item.count} ${l("giao dịch", "transactions")})`}>
                      <div className="chartBarFill" style={{ height: `${height}%` }} />
                    </div>
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {activeSection === "packages" && (
        <section className="panel">
          <h2><Package size={20} /> {l("Quản lý gói nạp", "Manage top-up packages")}</h2>
          <form onSubmit={savePackage} style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div className="inputRow">
              <select
                value={editingPackageId}
                onChange={(event) => {
                  const selected = packages.find((item) => item._id === event.target.value);
                  fillPackageForm(selected);
                }}
              >
                <option value="">{l("Tạo gói mới", "Create new package")}</option>
                {packages.map((pkg) => (
                  <option key={pkg._id} value={pkg._id}>{pkg.name || t.defaultPackageName}</option>
                ))}
              </select>
              {editingPackageId && (
                <button type="button" className="smallButton" onClick={() => fillPackageForm(null)}>
                  <RotateCcw size={14} /> {l("Hủy sửa", "Cancel edit")}
                </button>
              )}
            </div>
            <div className="inputRow">
              <input value={packageForm.name} onChange={(e) => setPackageForm({ ...packageForm, name: e.target.value })} placeholder={l("Tên gói, ví dụ: GÓI STARTER", "Package name, e.g. STARTER PACKAGE")} />
              <input type="number" value={packageForm.price} onChange={(e) => setPackageForm({ ...packageForm, price: e.target.value })} placeholder={t.price} />
              <input type="number" value={packageForm.credit} onChange={(e) => setPackageForm({ ...packageForm, credit: e.target.value })} placeholder="Credit" />
            </div>
            <div className="inputRow">
              <input type="number" value={packageForm.salePercent} onChange={(e) => setPackageForm({ ...packageForm, salePercent: e.target.value })} placeholder={l("Sale %, ví dụ 20", "Sale %, e.g. 20")} />
              <input
                type="number"
                min="0"
                value={packageForm.salePrice}
                onChange={(e) => setPackageForm({ ...packageForm, salePrice: e.target.value })}
                placeholder={l("Giá thực sau sale, bỏ trống = tự tính", "Final price after sale, blank = auto")}
              />
              <input
                type="number"
                min="0"
                value={packageForm.maxTopupsPerUser}
                onChange={(e) => setPackageForm({ ...packageForm, maxTopupsPerUser: e.target.value })}
                placeholder={l("Giới hạn mỗi tài khoản, bỏ trống = không giới hạn", "Per-account limit, blank = unlimited")}
              />
            </div>
            <div className="inputRow">
              <input value={packageForm.badge} onChange={(e) => setPackageForm({ ...packageForm, badge: e.target.value })} placeholder={l("Nhãn: SALE, POPULAR...", "Badge: SALE, POPULAR...")} />
            </div>
            <textarea
              value={packageForm.features}
              onChange={(e) => setPackageForm({ ...packageForm, features: e.target.value })}
              rows={4}
              style={{ height: "auto", minHeight: 110 }}
              placeholder={l("Mỗi dòng là một quyền lợi của gói", "Each line is one package benefit")}
            />
            <button className="smallButton" disabled={!packageForm.name || !packageForm.price || !packageForm.credit} style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}>
              {editingPackageId ? <Save size={16} /> : <Plus size={16} />}
              {editingPackageId ? l("Lưu chỉnh sửa", "Save changes") : l("Thêm gói", "Add package")}
            </button>
          </form>

          <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
            {l("Kéo thả gói để đổi thứ tự hiển thị ngoài trang nạp.", "Drag packages to change their order on the top-up page.")}
          </p>
          <div className="packageGrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {packages.map((pkg) => (
              <div
                className={`package draggablePackage ${dragPackageId === pkg._id ? "dragging" : ""}`}
                key={pkg._id}
                draggable
                onDragStart={() => setDragPackageId(pkg._id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => movePackage(dragPackageId, pkg._id)}
                onDragEnd={() => setDragPackageId("")}
                style={{ alignItems: "stretch", padding: 16, position: "relative", textAlign: "left" }}
              >
                <div className="packageActions">
                  <span title={l("Kéo để sắp xếp", "Drag to sort")}>
                    <GripVertical size={16} />
                  </span>
                  <button type="button" onClick={() => fillPackageForm(pkg)} title={l("Sửa gói", "Edit package")}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" onClick={() => deletePackage(pkg._id)} title={l("Xóa gói", "Delete package")} style={{ color: "var(--error)" }}>
                    <X size={16} />
                  </button>
                </div>
                <button onClick={() => deletePackage(pkg._id)} title={l("Xóa gói", "Delete package")} style={{ position: "absolute", top: 8, right: 8, color: "var(--error)" }}>
                  <X size={16} />
                </button>
                {pkg.badge && <span className="badge success" style={{ alignSelf: "start" }}>{pkg.badge}</span>}
                <h3 style={{ marginTop: 8 }}>{pkg.name || t.defaultPackageName}</h3>
                <div className="priceBlock compact" style={{ alignItems: "flex-start" }}>
                  {(Number(pkg.salePercent || 0) > 0 || (Number(pkg.salePrice || 0) > 0 && Number(pkg.salePrice || 0) < Number(pkg.price || 0))) && (
                    <div className="priceOriginal">
                      {Number(pkg.price).toLocaleString(locale)}<span>đ</span>
                    </div>
                  )}
                  <strong>{Number(discountedPrice(pkg)).toLocaleString(locale)}đ</strong>
                </div>
                {(Number(pkg.salePercent || 0) > 0 || (Number(pkg.salePrice || 0) > 0 && Number(pkg.salePrice || 0) < Number(pkg.price || 0))) && (
                  <span className="saleOnly" data-sale={pkg.salePercent}>
                    {Number(pkg.salePercent || 0) > 0
                      ? (language === "vi"
                        ? `Sale ${pkg.salePercent}% từ ${Number(pkg.price).toLocaleString(locale)}đ`
                        : `Sale ${pkg.salePercent}% from ${Number(pkg.price).toLocaleString(locale)}đ`)
                      : (language === "vi"
                        ? `Giá sale từ ${Number(pkg.price).toLocaleString(locale)}đ`
                        : `Sale price from ${Number(pkg.price).toLocaleString(locale)}đ`)}
                  </span>
                )}
                {Number(pkg.salePrice || 0) > 0 && (
                  <span className="muted">
                    {l("Giá nhập tay sau sale", "Manual final sale price")}: {Number(pkg.salePrice).toLocaleString(locale)}đ
                  </span>
                )}
                <span>{pkg.credit} CREDIT</span>
                <span className="muted">
                  {Number(pkg.maxTopupsPerUser || 0) > 0
                    ? l(`Giới hạn ${pkg.maxTopupsPerUser} lần/tài khoản`, `Limit ${pkg.maxTopupsPerUser} times/account`)
                    : l("Không giới hạn số lần nạp/tài khoản", "Unlimited per account")}
                </span>
                <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                  {((pkg.features && pkg.features.length > 0)
                    ? pkg.features
                    : t.defaultPackageFeatures
                  ).map((feature, index) => (
                    <li key={index}>{feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeSection === "articles" && (
        <AdminArticles articles={articles} onChanged={loadData} language={language} />
      )}

      {activeSection === "vouchers" && (
        <section className="panel">
          <h2><Gift size={20} /> {l("Quản lý voucher", "Manage vouchers")}</h2>
          <form onSubmit={saveVoucher} style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div className="inputRow">
              <select
                value={editingVoucherId}
                onChange={(event) => {
                  const selected = vouchers.find((item) => item._id === event.target.value);
                  fillVoucherForm(selected);
                }}
              >
                <option value="">{l("Tạo voucher mới", "Create new voucher")}</option>
                {vouchers.map((voucher) => (
                  <option key={voucher._id} value={voucher._id}>{voucher.code}</option>
                ))}
              </select>
              {editingVoucherId && (
                <button type="button" className="smallButton" onClick={() => fillVoucherForm(null)}>
                  <RotateCcw size={14} /> {l("Hủy sửa", "Cancel edit")}
                </button>
              )}
            </div>
            <div className="inputRow">
              <input value={voucherForm.code} onChange={(e) => setVoucherForm({ ...voucherForm, code: e.target.value.toUpperCase() })} placeholder={l("Mã voucher", "Voucher code")} />
              <input value={voucherForm.description} onChange={(e) => setVoucherForm({ ...voucherForm, description: e.target.value })} placeholder={l("Mô tả", "Description")} />
            </div>
            <div className="inputRow">
              <input type="number" value={voucherForm.discountPercent} onChange={(e) => setVoucherForm({ ...voucherForm, discountPercent: e.target.value })} placeholder={l("Giảm giá %", "Discount %")} />
              <input type="number" value={voucherForm.creditBonus} onChange={(e) => setVoucherForm({ ...voucherForm, creditBonus: e.target.value })} placeholder={l("Thêm credit", "Bonus credit")} />
              <input type="number" value={voucherForm.usageLimit} onChange={(e) => setVoucherForm({ ...voucherForm, usageLimit: e.target.value })} placeholder={l("Tổng lượt dùng", "Total uses")} />
              <input type="number" min="0" value={voucherForm.perUserLimit} onChange={(e) => setVoucherForm({ ...voucherForm, perUserLimit: e.target.value })} placeholder={l("Lượt / tài khoản", "Uses / account")} />
              <input type="datetime-local" value={voucherForm.expireAt} onChange={(e) => setVoucherForm({ ...voucherForm, expireAt: e.target.value })} />
            </div>
            <div className="voucherPackagePicker">
              <div>
                <strong>{l("Áp dụng cho gói", "Apply to packages")}</strong>
                <span>{l("Bỏ trống là áp dụng cho tất cả gói nạp.", "Leave empty to apply to all top-up packages.")}</span>
              </div>
              <div>
                {packages.map((pkg) => {
                  const checked = voucherForm.applicablePackageIds.includes(pkg._id);
                  return (
                    <label key={pkg._id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextIds = event.target.checked
                            ? [...voucherForm.applicablePackageIds, pkg._id]
                            : voucherForm.applicablePackageIds.filter((id) => id !== pkg._id);
                          setVoucherForm({ ...voucherForm, applicablePackageIds: nextIds });
                        }}
                      />
                      <span>{pkg.name || t.defaultPackageName}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <button
              className="smallButton"
              disabled={
                !voucherForm.code ||
                !voucherForm.usageLimit ||
                !voucherForm.expireAt ||
                (!voucherForm.discountPercent && !voucherForm.creditBonus)
              }
              style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}
            >
              {editingVoucherId ? <Save size={16} /> : <Gift size={16} />}
              {editingVoucherId ? l("Lưu chỉnh sửa", "Save changes") : l("Tạo voucher", "Create voucher")}
            </button>
          </form>
          {voucherMsg && <p className={voucherMsg.includes("thành công") || voucherMsg.includes("successfully") ? "success" : "error"}>{voucherMsg}</p>}

          <div className="voucherList">
            {vouchers.map((voucher) => (
              <div className="voucherCard" key={voucher._id}>
                <div className="voucherCardHeader">
                  <div>
                    <strong>{voucher.code}</strong>
                    <p>{voucher.description || t.noDescription}</p>
                  </div>
                  <span className={new Date(voucher.expireAt) > new Date() ? "badge success" : "badge error"}>
                    {new Date(voucher.expireAt) > new Date() ? "Active" : "Expired"}
                  </span>
                </div>
                <div className="voucherValue">
                  {voucher.discountPercent > 0 ? (
                    <>
                      <span>{t.discount}</span>
                      <strong>{voucher.discountPercent}%</strong>
                    </>
                  ) : (
                    <>
                      <span>{t.creditBonus}</span>
                      <strong>+{voucher.creditBonus}</strong>
                    </>
                  )}
                </div>
                <div className="voucherMetaGrid">
                  <div>
                    <span>{t.used}</span>
                    <strong>{voucher.usedCount}/{voucher.usageLimit}</strong>
                  </div>
                  <div>
                    <span>{t.perAccount}</span>
                    <strong>{Number(voucher.perUserLimit ?? 1) === 0 ? t.unlimited : `${voucher.perUserLimit || 1} ${l("lượt", "uses")}`}</strong>
                  </div>
                  <div>
                    <span>{t.expires}</span>
                    <strong>{new Date(voucher.expireAt).toLocaleDateString(locale)}</strong>
                  </div>
                </div>
                <div className="voucherApplies">
                  <span>{t.appliesTo}</span>
                  <strong>
                    {Array.isArray(voucher.applicablePackageIds) && voucher.applicablePackageIds.length > 0
                      ? voucher.applicablePackageIds.map((pkg) => pkg?.name || t.defaultPackageName).join(", ")
                      : t.allTopupPackages}
                  </strong>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="smallButton" type="button" onClick={() => fillVoucherForm(voucher)}>
                    <Pencil size={14} /> {l("Sửa voucher", "Edit voucher")}
                  </button>
                  <button className="smallButton voucherDeleteButton" type="button" onClick={() => deleteVoucher(voucher._id)}>
                    <X size={14} /> {l("Xóa voucher", "Delete voucher")}
                  </button>
                </div>
              </div>
            ))}
            {!vouchers.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{l("Chưa có voucher.", "No vouchers yet.")}</p>}
          </div>
        </section>
      )}

      {activeSection === "notifications" && (
        <section className="panel">
          <h2><Megaphone size={20} /> {l("Gửi thông báo", "Send notification")}</h2>
          <form className="notificationEditor" onSubmit={createNotification} style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <textarea
              className="notificationTitleInput"
              value={notificationForm.title}
              onChange={(e) => setNotificationForm({ ...notificationForm, title: e.target.value })}
              rows={2}
              placeholder={l("Tiêu đề thông báo", "Notification title")}
            />
            <div className="inputRow">
              <select
                value={notificationForm.targetType}
                onChange={(e) => setNotificationForm({ ...notificationForm, targetType: e.target.value })}
              >
                <option value="all">{l("Tất cả người dùng", "All users")}</option>
                <option value="users">{l("Theo email cụ thể", "Specific emails")}</option>
              </select>
              <select
                value={notificationForm.displayType}
                onChange={(e) => setNotificationForm({ ...notificationForm, displayType: e.target.value })}
              >
                <option value="dropdown">{l("Thông báo chuông", "Bell notification")}</option>
                <option value="fullscreen">{l("Popup phủ toàn màn hình", "Fullscreen popup")}</option>
              </select>
            </div>
            <div className="inputRow">
              <input
                type="datetime-local"
                value={notificationForm.startsAt}
                onChange={(e) => setNotificationForm({ ...notificationForm, startsAt: e.target.value })}
                title={l("Thời gian bắt đầu, có thể bỏ trống", "Start time, optional")}
              />
              <input
                type="datetime-local"
                value={notificationForm.expiresAt}
                onChange={(e) => setNotificationForm({ ...notificationForm, expiresAt: e.target.value })}
                title={l("Thời gian hết hạn, có thể bỏ trống", "Expiration time, optional")}
              />
            </div>
            {notificationForm.displayType === "fullscreen" && (
              <>
                <input
                  value={notificationForm.imageUrl}
                  onChange={(e) => setNotificationForm({ ...notificationForm, imageUrl: e.target.value })}
                  placeholder={l("URL ảnh khuyến mại / banner", "Promotion/banner image URL")}
                />
                <div className="inputRow">
                  <input
                    value={notificationForm.actionLabel}
                    onChange={(e) => setNotificationForm({ ...notificationForm, actionLabel: e.target.value })}
                    placeholder={l("Chữ nút, ví dụ: Nạp ngay", "Button text, e.g. Top up now")}
                  />
                  <input
                    value={notificationForm.actionUrl}
                    onChange={(e) => setNotificationForm({ ...notificationForm, actionUrl: e.target.value })}
                    placeholder={l("Link nút, ví dụ: /topup", "Button link, e.g. /topup")}
                  />
                </div>
              </>
            )}
            {notificationForm.targetType === "users" && (
              <textarea
                value={notificationForm.emails}
                onChange={(e) => setNotificationForm({ ...notificationForm, emails: e.target.value })}
                rows={3}
                style={{ height: "auto", minHeight: 88 }}
                placeholder={l("Nhập email người nhận, mỗi dòng hoặc cách nhau bằng dấu phẩy", "Enter recipient emails, one per line or separated by commas")}
              />
            )}
            <textarea
              value={notificationForm.body}
              onChange={(e) => setNotificationForm({ ...notificationForm, body: e.target.value })}
              rows={5}
              style={{ height: "auto", minHeight: 130 }}
              placeholder={l("Nội dung thông báo...", "Notification content...")}
            />
            <button
              className="smallButton"
              disabled={!notificationForm.title || !notificationForm.body}
              style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}
            >
              <Megaphone size={16} /> {l("Gửi thông báo", "Send notification")}
            </button>
          </form>
          {notificationMsg && <p className={notificationMsg.includes("được gửi") || notificationMsg.includes("sent") ? "success" : "error"}>{notificationMsg}</p>}
          <div className="table">
            {notifications.map((item) => (
              <div className="tableRow" key={item._id}>
                <strong>{item.title}</strong>
                <span>
                  {item.displayType === "fullscreen" ? "Popup" : l("Chuông", "Bell")} - {item.targetType === "users"
                    ? `${item.userIds?.length || 0} ${l("người nhận", "recipients")}`
                    : l("Tất cả người dùng", "All users")}
                </span>
                <span>{item.body}</span>
                <time>{new Date(item.createdAt).toLocaleString("vi-VN")}</time>
                <button className="smallButton" onClick={() => deleteNotification(item._id)} style={{ color: "var(--error)" }}>
                  <X size={14} /> {l("Xóa", "Delete")}
                </button>
              </div>
            ))}
            {!notifications.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{t.noNotifications}</p>}
          </div>
        </section>
      )}

      {activeSection === "referrals" && (
        <section className="panel">
          <h2><UserPlus size={20} /> {l("Ai đã mời ai", "Who invited whom")}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {l("Danh sách người dùng đăng ký qua link giới thiệu và credit đã thưởng cho hai bên.", "Users who signed up through referral links and the credit rewarded to both sides.")}
          </p>
          <div className="segmentedControl" style={{ marginTop: 16 }}>
            {referralModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={siteSettings.referralMode === option.value ? "active" : ""}
                onClick={() => saveReferralMode(option.value)}
              >
                {l(option.vi, option.en)}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            {siteSettings.referralMode === "both"
              ? l("Người mời và người được mời đều nhận credit.", "Both referrer and invited user receive credit.")
              : siteSettings.referralMode === "referrer_only"
                ? l("Chỉ người giới thiệu nhận credit; trang chủ đổi nội dung lời mời.", "Only the referrer receives credit; homepage invite text changes.")
                : l("Ẩn thanh giới thiệu trên trang chủ và không thưởng referral mới.", "Referral invite is hidden and new referral rewards are disabled.")}
          </p>
          {referralMsg && (
            <p className={referralMsg.includes("cập nhật") || referralMsg.includes("updated") ? "success" : "error"}>
              {referralMsg}
            </p>
          )}
          <div className="table referralTable" style={{ marginTop: 16 }}>
            {referrals.map((item) => (
              <div className="tableRow" key={item._id}>
                <div>
                  <span className="muted">{l("Người mời", "Referrer")}</span>
                  <strong>{item.referrerId?.email || item.referrerId?.name || "unknown"}</strong>
                </div>
                <div>
                  <span className="muted">{l("Người được mời", "Invited user")}</span>
                  <strong>{item.referredUserId?.email || item.referredUserId?.name || "unknown"}</strong>
                </div>
                <code>{item.referralCode}</code>
                <span>
                  +{item.referrerRewardCredit ?? item.rewardCredit ?? 28}
                  {Number(item.referredRewardCredit ?? item.rewardCredit ?? 28) > 0
                    ? ` / +${item.referredRewardCredit ?? item.rewardCredit ?? 28}`
                    : " / +0"} credit
                </span>
                <time>{new Date(item.rewardedAt || item.createdAt).toLocaleString(locale)}</time>
              </div>
            ))}
            {!referrals.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Chưa có lượt giới thiệu nào.", "No referrals yet.")}
              </p>
            )}
          </div>
        </section>
      )}

      {activeSection === "threed66" && (
        <section className="panel">
          <h2><Activity size={20} /> {l("Cài đặt vận hành 3D66", "3D66 runtime settings")}</h2>
          <form className="stack" onSubmit={saveRuntimeSettings} style={{ marginTop: 14 }}>
            <div className="formGrid">
              <label>
                {l("Getlink chạy cùng lúc", "Concurrent getlink tasks")}
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={siteSettings.threed66GetlinkConcurrency ?? 1}
                  onChange={(event) => updateRuntimeSetting("threed66GetlinkConcurrency", event.target.value)}
                />
              </label>
              <label>
                {l("Preview chạy cùng lúc", "Concurrent preview tasks")}
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={siteSettings.threed66PreviewConcurrency ?? 1}
                  onChange={(event) => updateRuntimeSetting("threed66PreviewConcurrency", event.target.value)}
                />
              </label>
              <label>
                {l("Refresh chạy cùng lúc", "Concurrent refresh tasks")}
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={siteSettings.threed66RefreshConcurrency ?? 1}
                  onChange={(event) => updateRuntimeSetting("threed66RefreshConcurrency", event.target.value)}
                />
              </label>
              <label>
                {l("Paytype value 3D66", "3D66 paytype value")}
                <input
                  value={siteSettings.threed66PaytypeValue ?? "4"}
                  onChange={(event) => updateRuntimeSetting("threed66PaytypeValue", event.target.value)}
                  placeholder='4'
                />
              </label>
              <label>
                {l("Khoảng nghỉ request (ms)", "Request interval (ms)")}
                <input
                  type="number"
                  min="0"
                  max="60000"
                  value={siteSettings.threed66RequestIntervalMs ?? 2500}
                  onChange={(event) => updateRuntimeSetting("threed66RequestIntervalMs", event.target.value)}
                />
              </label>
              <label>
                {l("Browser chạy cùng lúc", "Concurrent browser tasks")}
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={siteSettings.threed66BrowserConcurrency ?? 1}
                  onChange={(event) => updateRuntimeSetting("threed66BrowserConcurrency", event.target.value)}
                />
              </label>
              <label>
                {l("Timeout 3D66 (ms)", "3D66 timeout (ms)")}
                <input
                  type="number"
                  min="5000"
                  max="120000"
                  value={siteSettings.threed66TimeoutMs ?? 30000}
                  onChange={(event) => updateRuntimeSetting("threed66TimeoutMs", event.target.value)}
                />
              </label>
              <label>
                {l("Lỗi cookie trước khi nghỉ", "Cookie failures before cooldown")}
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={siteSettings.threed66CookieMaxFailures ?? 2}
                  onChange={(event) => updateRuntimeSetting("threed66CookieMaxFailures", event.target.value)}
                />
              </label>
              <label>
                {l("Thời gian nghỉ cookie (phút)", "Cookie cooldown (minutes)")}
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={siteSettings.threed66CookieCooldownMinutes ?? 30}
                  onChange={(event) => updateRuntimeSetting("threed66CookieCooldownMinutes", event.target.value)}
                />
              </label>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {l(
                "Các giá trị này áp dụng ngay sau khi lưu. Paytype value dùng để chọn ví thanh toán 3D66, ví dụ value=\"4\" là 赠点. Tăng concurrency quá cao có thể làm cookie bị chặn hoặc VPS quá tải.",
                "These values apply immediately after saving. Paytype value selects the 3D66 payment wallet, for example value=\"4\" is 赠点. Raising concurrency too high can trigger cookie blocks or overload the VPS."
              )}
            </p>
            {runtimeSettingsMsg && (
              <p className={runtimeSettingsMsg.includes("cập nhật") || runtimeSettingsMsg.includes("updated") ? "success" : "error"}>
                {runtimeSettingsMsg}
              </p>
            )}
            <button className="smallButton" type="submit" style={{ alignSelf: "flex-start" }}>
              <Save size={14} /> {l("Lưu thông số 3D66", "Save 3D66 settings")}
            </button>
          </form>
          {cookiePool && (
            <div className="cookiePoolGrid">
              <div className="cookiePoolCard">
                <span>Queue getlink</span>
                <strong>{cookiePool.queue?.getlink?.active || 0}/{cookiePool.queue?.getlink?.queued || 0}</strong>
                <small>{l("đang chạy / đang chờ", "running / queued")}</small>
              </div>
              <div className="cookiePoolCard">
                <span>Queue preview</span>
                <strong>{cookiePool.queue?.preview?.active || 0}/{cookiePool.queue?.preview?.queued || 0}</strong>
                <small>{l("đang chạy / đang chờ", "running / queued")}</small>
              </div>
              <div className="cookiePoolCard">
                <span>Queue refresh</span>
                <strong>{cookiePool.queue?.refresh?.active || 0}/{cookiePool.queue?.refresh?.queued || 0}</strong>
                <small>{l("đang chạy / đang chờ", "running / queued")}</small>
              </div>
            </div>
          )}
        </section>
      )}

      {activeSection === "cookie" && (
        <section className="panel">
          <h2><Cookie size={20} /> Cookie 3D66</h2>
          <form className="inputRow" onSubmit={saveCookie} style={{ marginTop: 14 }}>
            <input value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder={l("Dán cookie 3D66 VIP vào đây...", "Paste 3D66 VIP cookie here...")} />
            <button disabled={!cookie || loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
              {l("Lưu", "Save")}
            </button>
            <button type="button" className="smallButton" onClick={test3D66Cookie} disabled={loading}>
              <Check size={14} />
              {l("Kiểm tra", "Check")}
            </button>
          </form>
          {message && <p className="success">{message}</p>}
          {cookiePool && (
            <div className="cookiePoolGrid">
              <div className="cookiePoolCard">
                <span>Active</span>
                <strong>{cookiePool.stats?.active || 0}</strong>
              </div>
              <div className="cookiePoolCard warning">
                <span>Warning</span>
                <strong>{cookiePool.stats?.warning || 0}</strong>
              </div>
              <div className="cookiePoolCard error">
                <span>{l("Cooldown / lỗi", "Cooldown / errors")}</span>
                <strong>{(cookiePool.stats?.cooldown || 0) + (cookiePool.stats?.invalid || 0)}</strong>
              </div>
            </div>
          )}
          <div className="table" style={{ marginTop: 16 }}>
            {cookieRecords.map((item, index) => (
              <div className="tableRow" key={item._id}>
                <span>{item.status === "cooldown" ? l("Tạm nghỉ", "Cooldown") : index === 0 ? l("Ưu tiên", "Primary") : l("Dự phòng", "Backup")}</span>
                <code>{item.preview || "cookie"}</code>
                <span>{item.keyCount || 0} keys</span>
                <span className={item.hasRequiredKeys ? "success" : "error"}>
                  {item.hasRequiredKeys ? l("Đủ key", "Keys OK") : `${l("Thiếu", "Missing")}: ${(item.missingKeys || []).join(", ")}`}
                </span>
                <span className={item.status === "cooldown" ? "error" : item.status === "warning" ? "muted" : "success"}>
                  {item.status || "active"} · {l("lỗi", "errors")} {item.failureCount || 0} · {l("dùng", "uses")} {item.useCount || 0}
                </span>
                <span>
                  {item.lastTestAt
                    ? `${item.lastTestOk ? "OK" : l("Lỗi", "Error")} - ${new Date(item.lastTestAt).toLocaleString(locale)}`
                    : l("Chưa test", "Not tested")}
                </span>
                {item.cooldownUntil && (
                  <span className="muted">
                    {l("nghỉ tới", "cooldown until")} {new Date(item.cooldownUntil).toLocaleString(locale)}
                  </span>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="smallButton" onClick={() => testSaved3D66Cookie(item._id)} disabled={loading}>
                    <Check size={14} /> Test
                  </button>
                  <button type="button" className="smallButton" onClick={() => delete3D66Cookie(item._id)} style={{ color: "var(--error)" }}>
                    <X size={14} /> {l("Xóa", "Delete")}
                  </button>
                </div>
              </div>
            ))}
            {!cookieRecords.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Chưa lưu cookie 3D66 nào.", "No 3D66 cookies saved yet.")}
              </p>
            )}
          </div>
        </section>
      )}

      {activeSection === "logs" && (
        <section className="panel">
          <h2><AlertTriangle size={20} /> {l("Log lỗi getlink / tải file", "Getlink / download error logs")}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {l("Hiển thị 100 lỗi mới nhất để kiểm tra cookie, queue, tải file và request getlink.", "Shows the latest 100 errors for checking cookies, queue, downloads, and getlink requests.")}
          </p>
          <div className="table logTable" style={{ marginTop: 16 }}>
            {systemLogs.map((item) => (
              <div className="tableRow" key={item._id}>
                <span className={`badge ${item.level === "error" ? "error" : item.level === "warn" ? "pending" : "success"}`}>
                  {item.type}
                </span>
                <strong>{item.message}</strong>
                <span>{item.productId || item.historyId || "system"}</span>
                <span>{item.status ? `HTTP ${item.status}` : item.level}</span>
                <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
              </div>
            ))}
            {!systemLogs.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Chưa có log lỗi.", "No error logs yet.")}
              </p>
            )}
          </div>
        </section>
      )}

      {activeSection === "users" && (
        <section className="panel">
          <h2><Users size={20} /> {l("Quản lý người dùng", "Manage users")}</h2>
          <div className="table">
            {users.map((user) => (
              <div className="tableRow" key={user._id}>
                <div>
                  <span>{user.email}</span>
                  {user.isBanned && (
                    <p className="error" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      {l("Đang bị ban", "Banned")}: {user.banReason || l("Không có lý do", "No reason")}
                    </p>
                  )}
                </div>
                {editUser === user._id ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="number" value={editCredit} onChange={(e) => setEditCredit(e.target.value)} style={{ minHeight: 34, width: 90, padding: "0 8px" }} />
                    <button className="smallButton" onClick={() => saveUserCredit(user._id)}>{l("Lưu", "Save")}</button>
                    <button className="smallButton" onClick={() => setEditUser(null)}>{l("Hủy", "Cancel")}</button>
                  </div>
                ) : (
                  <>
                    <strong onClick={() => { setEditUser(user._id); setEditCredit(user.credit); }} style={{ cursor: "pointer" }}>
                      {user.credit} credit
                    </strong>
                    <button className="smallButton" onClick={() => addCredit(user._id)}>
                      <Plus size={14} /> +1 credit
                    </button>
                  </>
                )}
                {user.role !== "admin" && (
                  <div className="banUserControls">
                    {!user.isBanned && (
                      <input
                        value={banReasonByUser[user._id] || ""}
                        onChange={(event) =>
                          setBanReasonByUser({
                            ...banReasonByUser,
                            [user._id]: event.target.value,
                          })
                        }
                        placeholder={l("Lý do ban", "Ban reason")}
                      />
                    )}
                    <button
                      type="button"
                      className={`smallButton ${user.isBanned ? "" : "dangerButton"}`}
                      onClick={() => toggleBanUser(user)}
                    >
                      {user.isBanned ? <Check size={14} /> : <Ban size={14} />}
                      {user.isBanned ? l("Gỡ ban", "Unban") : l("Ban getlink", "Ban getlink")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!users.length && <p className="muted" style={{ textAlign: "center", padding: 24 }}>{l("Chưa có người dùng.", "No users yet.")}</p>}
          </div>
        </section>
      )}

      {activeSection === "security" && (
        <section className="panel">
          <h2><ShieldAlert size={20} /> {l("Cài đặt bảo mật (2FA)", "Security settings (2FA)")}</h2>

          {user?.isTwoFactorEnabled ? (
            <div className="emptyState" style={{ marginTop: 20 }}>
              <div className="badge success" style={{ marginBottom: 16 }}>{l("Đã kích hoạt 2FA", "2FA enabled")}</div>
              <p>{l("Tài khoản của bạn đã được bảo vệ bằng mã xác thực 2 lớp (Google Authenticator).", "Your account is protected with two-factor authentication (Google Authenticator).")}</p>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <p className="muted" style={{ marginBottom: 20 }}>
                {l("Kích hoạt Xác minh 2 Bước để bảo vệ tài khoản quản trị. Khi đăng nhập, bạn sẽ cần nhập mã gồm 6 chữ số từ ứng dụng trên điện thoại.", "Enable two-step verification to protect the admin account. When signing in, you will need to enter a 6-digit code from the phone app.")}
              </p>

              {!twoFactorQr ? (
                <button onClick={handleGenerate2FA} disabled={loading}>
                  {loading ? <Loader2 className="spin" size={16} /> : <ShieldAlert size={16} />} {l("Bắt đầu thiết lập 2FA", "Start 2FA setup")}
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 400 }}>
                  <div style={{ background: "#fff", padding: 16, borderRadius: 8, alignSelf: "flex-start" }}>
                    <img src={twoFactorQr} alt="QR Code" style={{ width: 200, height: 200, display: "block" }} />
                  </div>
                  <div className="muted">
                    <p>{l("1. Mở ứng dụng Google Authenticator hoặc Authy.", "1. Open Google Authenticator or Authy.")}</p>
                    <p>{l("2. Quét mã QR bên trên, hoặc nhập tay mã bảo mật:", "2. Scan the QR code above, or manually enter the secret:")} <code>{twoFactorSecret}</code></p>
                    <p>{l("3. Nhập mã 6 chữ số xuất hiện trên ứng dụng vào ô dưới đây để hoàn tất.", "3. Enter the 6-digit code shown in the app below to finish.")}</p>
                  </div>
                  <form onSubmit={handleEnable2FA} style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="123456"
                      maxLength={6}
                      value={twoFactorToken}
                      onChange={(e) => setTwoFactorToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      style={{ fontSize: 18, letterSpacing: 4, width: 150, textAlign: "center" }}
                    />
                    <button disabled={loading || twoFactorToken.length < 6}>
                      {l("Xác nhận bật", "Confirm enable")}
                    </button>
                  </form>
                </div>
              )}
              {twoFactorMsg && <p className={twoFactorMsg.includes("thành công") || twoFactorMsg.includes("successfully") ? "success" : "error"} style={{ marginTop: 16 }}>{twoFactorMsg}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
