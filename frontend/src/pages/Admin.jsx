import React, { useEffect, useState } from "react";
import { BarChart3, Check, Cookie, CreditCard, FileText, Gift, GripVertical, KeyRound, Loader2, Package, Pencil, Plus, RotateCcw, Save, ShieldAlert, Users, X } from "lucide-react";
import AdminArticles from "../components/AdminArticles.jsx";
import { api } from "../api.js";
import { translations } from "../i18n.js";

const emptyPackage = {
  name: "",
  price: "",
  credit: "",
  salePercent: "",
  badge: "",
  features: "5 lượt tải model\nLưu lịch sử tải\nHỗ trợ cơ bản"
};

const emptyVoucher = {
  code: "",
  description: "",
  creditBonus: "",
  discountPercent: "",
  usageLimit: "",
  expireAt: ""
};

function discountedPrice(pkg) {
  return Math.round(Number(pkg.price || 0) * (100 - Number(pkg.salePercent || 0)) / 100);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

export default function Admin({ user, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [activeSection, setActiveSection] = useState("overview");
  const [revenuePeriod, setRevenuePeriod] = useState("day");
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [articles, setArticles] = useState([]);
  const [pendingTopups, setPendingTopups] = useState([]);
  const [cookieRecords, setCookieRecords] = useState([]);
  const [cookie, setCookie] = useState("");
  const [message, setMessage] = useState("");
  const [topupMsg, setTopupMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [packageForm, setPackageForm] = useState(emptyPackage);
  const [voucherForm, setVoucherForm] = useState(emptyVoucher);
  const [voucherMsg, setVoucherMsg] = useState("");
  const [editUser, setEditUser] = useState(null);
  const [editCredit, setEditCredit] = useState("");
  const [editingPackageId, setEditingPackageId] = useState("");
  const [dragPackageId, setDragPackageId] = useState("");
  const [twoFactorQr, setTwoFactorQr] = useState("");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [twoFactorMsg, setTwoFactorMsg] = useState("");

  async function loadData() {
    const [oRes, uRes, pRes, tRes, vRes, cRes, aRes] = await Promise.all([
      api(`/api/admin/overview?period=${revenuePeriod}`),
      api("/api/admin/users"),
      api("/api/admin/topup-packages"),
      api("/api/admin/topups/pending"),
      api("/api/admin/vouchers"),
      api("/api/admin/cookies"),
      api("/api/admin/articles")
    ]);
    setOverview(oRes.overview || null);
    setUsers(uRes.users || []);
    setPackages(pRes.packages || []);
    setPendingTopups(tRes.topups || []);
    setVouchers(vRes.vouchers || []);
    setCookieRecords(cRes.cookies || []);
    setArticles(aRes.articles || []);
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

  async function createVoucher(event) {
    event.preventDefault();
    try {
      await api("/api/admin/voucher", {
        method: "POST",
        body: JSON.stringify({
          ...voucherForm,
          creditBonus: Number(voucherForm.creditBonus || 0),
          discountPercent: Number(voucherForm.discountPercent || 0),
          usageLimit: Number(voucherForm.usageLimit),
          expireAt: new Date(voucherForm.expireAt).toISOString()
        })
      });
      setVoucherForm(emptyVoucher);
      setVoucherMsg("Voucher đã tạo thành công.");
      await loadData();
    } catch (err) {
      setVoucherMsg(err.message);
    }
  }

  async function deleteVoucher(id) {
    await api(`/api/admin/vouchers/${id}`, { method: "DELETE" });
    await loadData();
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
      setMessage("Cookie 3D66 đã được lưu.");
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
      setMessage(`Cookie 3D66 hợp lệ.${details}`);
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
      setMessage(`Cookie 3D66 hợp lệ.${details}`);
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
    setMessage("Đã xóa cookie 3D66.");
    await loadData();
  }

  async function approveTopup(id) {
    try {
      setTopupMsg("");
      const data = await api(`/api/admin/topups/${id}/approve`, { method: "POST" });
      setPendingTopups((items) => items.filter((item) => item._id !== id));
      if (data.user?._id) {
        setUsers((items) => items.map((user) => (user._id === data.user._id ? data.user : user)));
      }
      setTopupMsg(`Đã duyệt +${data.topup?.credit || 0} credit cho ${data.user?.email || "user"}.`);
      await loadData();
    } catch (err) {
      setTopupMsg(err.message);
    }
  }

  async function rejectTopup(id) {
    try {
      setTopupMsg("");
      await api(`/api/admin/topups/${id}/reject`, { method: "POST" });
      setPendingTopups((items) => items.filter((item) => item._id !== id));
      setTopupMsg("Đã hủy giao dịch nạp.");
      await loadData();
    } catch (err) {
      setTopupMsg(err.message);
    }
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
      setTwoFactorMsg("✅ Bật 2FA thành công! Vui lòng tải lại trang.");
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
    day: "14 ngày gần nhất",
    month: "12 tháng gần nhất",
    year: "5 năm gần nhất"
  };
  const sections = [
    { key: "overview", label: t.adminOverview, icon: BarChart3 },
    { key: "packages", label: t.adminPackages, icon: Package, count: packages.length },
    { key: "vouchers", label: t.adminVouchers, icon: Gift, count: vouchers.length },
    { key: "articles", label: t.adminArticles || "Bài viết", icon: FileText, count: articles.length },
    { key: "topups", label: t.adminVietqr, icon: CreditCard, count: pendingTopups.length },
    { key: "cookie", label: t.adminCookie, icon: Cookie },
    { key: "users", label: t.adminUsers, icon: Users, count: users.length },
    { key: "security", label: "Bảo mật", icon: ShieldAlert }
  ];

  return (
    <div className="stack">
      <section className="panel">
        <h2>Quản trị hệ thống</h2>
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
          <h2><BarChart3 size={20} /> Tổng quan web</h2>
          <div className="overviewGrid">
            <div className="overviewCard">
              <span>Người dùng</span>
              <strong>{overview?.totalUsers || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>Credit đang có</span>
              <strong>{overview?.totalCredit || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>Doanh thu đã duyệt</span>
              <strong>{formatMoney(overview?.revenue)}</strong>
            </div>
            <div className="overviewCard">
              <span>VietQR chờ duyệt</span>
              <strong>{overview?.pendingTopups || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>Tiền đang chờ</span>
              <strong>{formatMoney(overview?.pendingAmount)}</strong>
            </div>
            <div className="overviewCard">
              <span>Lượt getlink</span>
              <strong>{overview?.totalGetlinks || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>Model đã cache</span>
              <strong>{overview?.cachedProducts || 0}</strong>
            </div>
            <div className="overviewCard">
              <span>Gói/Voucher active</span>
              <strong>{overview?.activePackages || 0}/{overview?.activeVouchers || 0}</strong>
            </div>
          </div>
          <div className="revenueChartPanel">
            <div className="chartHeader">
              <div>
                <h3>Biểu đồ doanh thu</h3>
                <p>{chartLabels[revenuePeriod]}, tính theo giao dịch đã duyệt.</p>
              </div>
              <div className="chartControls">
                {[
                  ["day", "Ngày"],
                  ["month", "Tháng"],
                  ["year", "Năm"]
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
            <div className={`revenueChart ${revenuePeriod}`} aria-label="Biểu đồ doanh thu">
              {revenueChart.map((item) => {
                const height = Math.max(6, Math.round((Number(item.revenue || 0) / maxRevenue) * 100));
                return (
                  <div className="chartBarItem" key={item.date}>
                    <div className="chartBarTrack" title={`${item.label}: ${formatMoney(item.revenue)} (${item.count} giao dịch)`}>
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
          <h2><Package size={20} /> Quản lý gói nạp</h2>
          <form onSubmit={savePackage} style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div className="inputRow">
              <select
                value={editingPackageId}
                onChange={(event) => {
                  const selected = packages.find((item) => item._id === event.target.value);
                  fillPackageForm(selected);
                }}
              >
                <option value="">Tạo gói mới</option>
                {packages.map((pkg) => (
                  <option key={pkg._id} value={pkg._id}>{pkg.name || "Gói credit"}</option>
                ))}
              </select>
              {editingPackageId && (
                <button type="button" className="smallButton" onClick={() => fillPackageForm(null)}>
                  <RotateCcw size={14} /> Hủy sửa
                </button>
              )}
            </div>
            <div className="inputRow">
              <input value={packageForm.name} onChange={(e) => setPackageForm({ ...packageForm, name: e.target.value })} placeholder="Tên gói, ví dụ: GÓI STARTER" />
              <input type="number" value={packageForm.price} onChange={(e) => setPackageForm({ ...packageForm, price: e.target.value })} placeholder="Giá" />
              <input type="number" value={packageForm.credit} onChange={(e) => setPackageForm({ ...packageForm, credit: e.target.value })} placeholder="Credit" />
            </div>
            <div className="inputRow">
              <input type="number" value={packageForm.salePercent} onChange={(e) => setPackageForm({ ...packageForm, salePercent: e.target.value })} placeholder="Sale %, ví dụ 20" />
              <input value={packageForm.badge} onChange={(e) => setPackageForm({ ...packageForm, badge: e.target.value })} placeholder="Nhãn: SALE, POPULAR..." />
            </div>
            <textarea
              value={packageForm.features}
              onChange={(e) => setPackageForm({ ...packageForm, features: e.target.value })}
              rows={4}
              style={{ height: "auto", minHeight: 110 }}
              placeholder="Mỗi dòng là một quyền lợi của gói"
            />
            <button className="smallButton" disabled={!packageForm.name || !packageForm.price || !packageForm.credit} style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}>
              {editingPackageId ? <Save size={16} /> : <Plus size={16} />}
              {editingPackageId ? "Lưu chỉnh sửa" : "Thêm gói"}
            </button>
          </form>

          <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
            Kéo thả gói để đổi thứ tự hiển thị ngoài trang nạp.
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
                  <span title="Kéo để sắp xếp">
                    <GripVertical size={16} />
                  </span>
                  <button type="button" onClick={() => fillPackageForm(pkg)} title="Sửa gói">
                    <Pencil size={15} />
                  </button>
                  <button type="button" onClick={() => deletePackage(pkg._id)} title="Xóa gói" style={{ color: "var(--error)" }}>
                    <X size={16} />
                  </button>
                </div>
                <button onClick={() => deletePackage(pkg._id)} title="Xóa gói" style={{ position: "absolute", top: 8, right: 8, color: "var(--error)" }}>
                  <X size={16} />
                </button>
                {pkg.badge && <span className="badge success" style={{ alignSelf: "start" }}>{pkg.badge}</span>}
                <h3 style={{ marginTop: 8 }}>{pkg.name || "GÓI CREDIT"}</h3>
                <div className="priceBlock compact" style={{ alignItems: "flex-start" }}>
                  {Number(pkg.salePercent || 0) > 0 && (
                    <div className="priceOriginal">
                      {Number(pkg.price).toLocaleString("vi-VN")}<span>đ</span>
                    </div>
                  )}
                  <strong>{Number(discountedPrice(pkg)).toLocaleString("vi-VN")}đ</strong>
                </div>
                {Number(pkg.salePercent || 0) > 0 && (
                  <span className="saleOnly" data-sale={pkg.salePercent}>
                    Sale {pkg.salePercent}% từ {Number(pkg.price).toLocaleString("vi-VN")}đ
                  </span>
                )}
                <span>{pkg.credit} CREDIT</span>
                <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                  {((pkg.features && pkg.features.length > 0)
                    ? pkg.features
                    : [`${pkg.credit} lượt tải model`, "Lưu lịch sử tải", "Hỗ trợ cơ bản"]
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
        <AdminArticles articles={articles} onChanged={loadData} />
      )}

      {activeSection === "vouchers" && (
        <section className="panel">
          <h2><Gift size={20} /> Quản lý voucher</h2>
          <form onSubmit={createVoucher} style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div className="inputRow">
              <input value={voucherForm.code} onChange={(e) => setVoucherForm({ ...voucherForm, code: e.target.value.toUpperCase() })} placeholder="Mã voucher" />
              <input value={voucherForm.description} onChange={(e) => setVoucherForm({ ...voucherForm, description: e.target.value })} placeholder="Mô tả" />
            </div>
            <div className="inputRow">
              <input type="number" value={voucherForm.discountPercent} onChange={(e) => setVoucherForm({ ...voucherForm, discountPercent: e.target.value })} placeholder="Giảm giá %, ví dụ 20" />
              <input type="number" value={voucherForm.creditBonus} onChange={(e) => setVoucherForm({ ...voucherForm, creditBonus: e.target.value })} placeholder="Hoặc thêm credit" />
              <input type="number" value={voucherForm.usageLimit} onChange={(e) => setVoucherForm({ ...voucherForm, usageLimit: e.target.value })} placeholder="Lượt dùng" />
              <input type="datetime-local" value={voucherForm.expireAt} onChange={(e) => setVoucherForm({ ...voucherForm, expireAt: e.target.value })} />
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
              <Gift size={16} /> Tạo voucher
            </button>
          </form>
          {voucherMsg && <p className={voucherMsg.includes("thành công") ? "success" : "error"}>{voucherMsg}</p>}

          <div className="table">
            {vouchers.map((voucher) => (
              <div className="tableRow" key={voucher._id}>
                <strong>{voucher.code}</strong>
                <span>{voucher.description || "Không có mô tả"}</span>
                <span>
                  {voucher.discountPercent > 0 ? `Giảm ${voucher.discountPercent}%` : `+${voucher.creditBonus} credit`}
                </span>
                <span>{voucher.usedCount}/{voucher.usageLimit} lượt</span>
                <time>{new Date(voucher.expireAt).toLocaleString("vi-VN")}</time>
                <button className="smallButton" onClick={() => deleteVoucher(voucher._id)} style={{ color: "var(--error)" }}>
                  <X size={14} /> Xóa
                </button>
              </div>
            ))}
            {!vouchers.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>Chưa có voucher.</p>}
          </div>
        </section>
      )}

      {activeSection === "topups" && (
        <section className="panel" style={{ borderColor: pendingTopups.length > 0 ? "rgba(251, 191, 36, 0.4)" : undefined }}>
          <h2><CreditCard size={20} /> Duyệt nạp VietQR thủ công ({pendingTopups.length})</h2>
          {topupMsg && <p className={topupMsg.startsWith("Đã") ? "success" : "error"}>{topupMsg}</p>}
          <div className="table">
            {pendingTopups.map((topup) => (
              <div className="tableRow" key={topup._id}>
                <span>{topup.userId?.email}</span>
                <span>{topup.packageId?.name || "Gói credit"}</span>
                <strong>{topup.credit} credit</strong>
                <span>{topup.amount.toLocaleString("vi-VN")}đ</span>
                <code>{topup.paymentCode || topup.type}</code>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="smallButton" onClick={() => approveTopup(topup._id)}>
                    <Check size={14} /> Duyệt
                  </button>
                  <button className="smallButton" onClick={() => rejectTopup(topup._id)} style={{ color: "var(--error)" }}>
                    <X size={14} /> Hủy
                  </button>
                </div>
              </div>
            ))}
            {!pendingTopups.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>Không có yêu cầu nạp VietQR cần xử lý thủ công.</p>}
          </div>
        </section>
      )}

      {activeSection === "cookie" && (
        <section className="panel">
          <h2><Cookie size={20} /> Cookie 3D66</h2>
          <form className="inputRow" onSubmit={saveCookie} style={{ marginTop: 14 }}>
            <input value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder="Dán cookie 3D66 VIP vào đây..." />
            <button disabled={!cookie || loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
              Lưu
            </button>
            <button type="button" className="smallButton" onClick={test3D66Cookie} disabled={loading}>
              <Check size={14} />
              Kiểm tra
            </button>
          </form>
          {message && <p className="success">{message}</p>}
          <div className="table" style={{ marginTop: 16 }}>
            {cookieRecords.map((item, index) => (
              <div className="tableRow" key={item._id}>
                <span>{item.status === "cooldown" ? "Tạm nghỉ" : index === 0 ? "Ưu tiên" : "Dự phòng"}</span>
                <code>{item.preview || "cookie"}</code>
                <span>{item.keyCount || 0} keys</span>
                <span className={item.hasRequiredKeys ? "success" : "error"}>
                  {item.hasRequiredKeys ? "Đủ key" : `Thiếu: ${(item.missingKeys || []).join(", ")}`}
                </span>
                <span className={item.status === "cooldown" ? "error" : item.status === "warning" ? "muted" : "success"}>
                  {item.status || "active"} · lỗi {item.failureCount || 0} · dùng {item.useCount || 0}
                </span>
                <span>
                  {item.lastTestAt
                    ? `${item.lastTestOk ? "OK" : "Lỗi"} - ${new Date(item.lastTestAt).toLocaleString("vi-VN")}`
                    : "Chưa test"}
                </span>
                {item.cooldownUntil && (
                  <span className="muted">
                    nghỉ tới {new Date(item.cooldownUntil).toLocaleString("vi-VN")}
                  </span>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="smallButton" onClick={() => testSaved3D66Cookie(item._id)} disabled={loading}>
                    <Check size={14} /> Test
                  </button>
                  <button type="button" className="smallButton" onClick={() => delete3D66Cookie(item._id)} style={{ color: "var(--error)" }}>
                    <X size={14} /> Xóa
                  </button>
                </div>
              </div>
            ))}
            {!cookieRecords.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                Chưa lưu cookie 3D66 nào.
              </p>
            )}
          </div>
        </section>
      )}

      {activeSection === "users" && (
        <section className="panel">
          <h2><Users size={20} /> Quản lý người dùng</h2>
          <div className="table">
            {users.map((user) => (
              <div className="tableRow" key={user._id}>
                <span>{user.email}</span>
                {editUser === user._id ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="number" value={editCredit} onChange={(e) => setEditCredit(e.target.value)} style={{ minHeight: 34, width: 90, padding: "0 8px" }} />
                    <button className="smallButton" onClick={() => saveUserCredit(user._id)}>Lưu</button>
                    <button className="smallButton" onClick={() => setEditUser(null)}>Hủy</button>
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
              </div>
            ))}
            {!users.length && <p className="muted" style={{ textAlign: "center", padding: 24 }}>Chưa có người dùng.</p>}
          </div>
        </section>
      )}

      {activeSection === "security" && (
        <section className="panel">
          <h2><ShieldAlert size={20} /> Cài đặt bảo mật (2FA)</h2>
          
          {user?.isTwoFactorEnabled ? (
            <div className="emptyState" style={{ marginTop: 20 }}>
              <div className="badge success" style={{ marginBottom: 16 }}>Đã kích hoạt 2FA</div>
              <p>Tài khoản của bạn đã được bảo vệ bằng mã xác thực 2 lớp (Google Authenticator).</p>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <p className="muted" style={{ marginBottom: 20 }}>
                Kích hoạt Xác minh 2 Bước để bảo vệ tài khoản quản trị. Khi đăng nhập, bạn sẽ cần nhập mã gồm 6 chữ số từ ứng dụng trên điện thoại.
              </p>

              {!twoFactorQr ? (
                <button onClick={handleGenerate2FA} disabled={loading}>
                  {loading ? <Loader2 className="spin" size={16} /> : <ShieldAlert size={16} />} Bắt đầu thiết lập 2FA
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 400 }}>
                  <div style={{ background: "#fff", padding: 16, borderRadius: 8, alignSelf: "flex-start" }}>
                    <img src={twoFactorQr} alt="QR Code" style={{ width: 200, height: 200, display: "block" }} />
                  </div>
                  <div className="muted">
                    <p>1. Mở ứng dụng Google Authenticator hoặc Authy.</p>
                    <p>2. Quét mã QR bên trên, hoặc nhập tay mã bảo mật: <code>{twoFactorSecret}</code></p>
                    <p>3. Nhập mã 6 chữ số xuất hiện trên ứng dụng vào ô dưới đây để hoàn tất.</p>
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
                      Xác nhận bật
                    </button>
                  </form>
                </div>
              )}
              {twoFactorMsg && <p className={twoFactorMsg.includes("thành công") ? "success" : "error"} style={{ marginTop: 16 }}>{twoFactorMsg}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
