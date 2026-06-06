import React, { useEffect, useMemo, useState } from "react";
import { Check, Coins, Copy, Gift, Link2, Share2, UserPlus, Users } from "lucide-react";
import { api } from "../api.js";

export default function Invite({ language = "vi" }) {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isVi = language === "vi";

  useEffect(() => {
    let cancelled = false;

    Promise.all([api("/api/referral/me"), api("/api/referral/history")])
      .then(([referral, referralHistory]) => {
        if (cancelled) return;
        setSummary(referral);
        setHistory(referralHistory.history || []);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const earnedCredit = useMemo(
    () =>
      (summary?.invitedUsers || []).reduce(
        (total, item) => total + Number(item.rewardCredit || 0),
        0,
      ),
    [summary],
  );

  async function copyReferralUrl() {
    if (!summary?.referralUrl) return;
    try {
      await navigator.clipboard.writeText(summary.referralUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        isVi
          ? "Không thể copy link. Hãy chọn link và copy thủ công."
          : "Cannot copy the link. Select it and copy manually.",
      );
    }
  }

  async function shareReferralUrl() {
    if (!summary?.referralUrl) return;
    if (!navigator.share) {
      await copyReferralUrl();
      return;
    }

    try {
      await navigator.share({
        title: "3DiPL",
        text: isVi
          ? "Đăng ký 3DiPL bằng link giới thiệu của tôi."
          : "Sign up for 3DiPL with my referral link.",
        url: summary.referralUrl,
      });
    } catch {
      // Closing the native share dialog is not an error.
    }
  }

  if (loading) {
    return <main className="center">{isVi ? "Đang tải..." : "Loading..."}</main>;
  }

  if (error) {
    return (
      <section className="panel emptyState">
        <h2>{isVi ? "Không tải được thông tin giới thiệu" : "Cannot load referral information"}</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!summary?.enabled) {
    return (
      <section className="panel emptyState">
        <Gift size={32} />
        <h2>{isVi ? "Chương trình mời bạn đang tạm tắt" : "Referral program is currently disabled"}</h2>
        <p>
          {isVi
            ? "Theo dõi thông báo để biết khi chương trình được mở lại."
            : "Watch notifications for the next referral campaign."}
        </p>
      </section>
    );
  }

  const rewardText =
    summary.mode === "referrer_only"
      ? isVi
        ? `Mỗi người đăng ký thành công giúp bạn nhận ${summary.rewardCredit} credit.`
        : `Each successful signup gives you ${summary.rewardCredit} credit.`
      : isVi
        ? `Mỗi lượt đăng ký thành công: cả hai nhận ${summary.rewardCredit} credit.`
        : `Each successful signup gives both users ${summary.rewardCredit} credit.`;

  return (
    <div className="stack invitePage">
      <section className="panel inviteHero inviteTerminalPanel">
        <div className="inviteHeroCopy">
          <span className="inviteSectionTag">
            [ {isVi ? "Chương trình giới thiệu" : "Referral program"} ]
          </span>
          <h1>
            <span>{isVi ? "Mời bạn" : "Invite"}</span>
            <strong>{isVi ? "Nhận credit" : "Earn credit"}</strong>
          </h1>
          <p>{rewardText}</p>
          <div className="inviteTerminalStatus">
            <span>$</span> referral --status <strong>active</strong><i>_</i>
          </div>
        </div>
        <div className="inviteStats">
          <div>
            <Users size={18} />
            <span>{isVi ? "Đã mời" : "Invited"}</span>
            <strong>{summary.invitedCount || 0}</strong>
          </div>
          <div>
            <Gift size={18} />
            <span>{isVi ? "Đã nhận" : "Earned"}</span>
            <strong>{earnedCredit} credit</strong>
          </div>
          <div>
            <Coins size={18} />
            <span>{isVi ? "Thưởng mỗi lượt" : "Reward per invite"}</span>
            <strong>{summary.rewardCredit} credit</strong>
          </div>
        </div>
      </section>

      <section className="panel has-window-controls inviteLinkPanel inviteTerminalPanel">
        <div className="invitePanelHeader">
          <div className="inviteWindowDots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>[ {isVi ? "Link giới thiệu" : "Referral link"} ]</span>
          <code>{summary.referralCode}</code>
        </div>
        <div className="inviteLinkBody">
          <div className="inviteLinkIntro">
            <div>
              <span>{isVi ? "Mã giới thiệu của bạn" : "Your referral code"}</span>
              <strong>{summary.referralCode}</strong>
            </div>
            <Link2 size={22} />
          </div>
          <div className="inviteLinkRow">
            <input value={summary.referralUrl || ""} readOnly aria-label={isVi ? "Link giới thiệu" : "Referral link"} />
            <button className="smallButton" type="button" onClick={copyReferralUrl}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? (isVi ? "Đã copy" : "Copied") : "Copy"}
            </button>
            <button className="smallButton inviteShareButton" type="button" onClick={shareReferralUrl}>
              <Share2 size={15} />
              {isVi ? "Chia sẻ" : "Share"}
            </button>
          </div>
          <p className="inviteLinkHint">
            <span>&gt;</span>{" "}
            {isVi
              ? "Gửi link này cho bạn bè. Credit được cộng tự động khi đăng ký thành công."
              : "Send this link to friends. Credit is added automatically after successful signup."}
          </p>
        </div>
      </section>

      <section className="panel inviteHistoryPanel inviteTerminalPanel">
        <div className="inviteHistoryHeader">
          <div>
            <span className="inviteSectionTag">[ {isVi ? "Nhật ký" : "Activity log"} ]</span>
            <h2>
              <UserPlus size={19} />
              {isVi ? "Lịch sử thưởng" : "Reward history"}
            </h2>
          </div>
          <span>{String(history.length).padStart(2, "0")}</span>
        </div>
        <div className="table inviteHistoryTable">
          {history.map((item) => (
            <div className="tableRow" key={item._id}>
              <div className="inviteHistoryUser">
                <strong>{item.otherUser?.name || (isVi ? "Người dùng 3DiPL" : "3DiPL user")}</strong>
                <span>{item.otherUser?.email || item.referralCode}</span>
              </div>
              <span>
                {item.role === "referrer"
                  ? isVi
                    ? "Bạn đã mời"
                    : "Invited by you"
                  : isVi
                    ? "Đã mời bạn"
                    : "Invited you"}
              </span>
              <strong>+{item.credit} credit</strong>
              <time>{new Date(item.createdAt).toLocaleString(isVi ? "vi-VN" : "en-US")}</time>
            </div>
          ))}
          {!history.length && (
            <p className="muted inviteHistoryEmpty">
              {isVi
                ? "Chưa có lượt giới thiệu thành công."
                : "No successful referrals yet."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
