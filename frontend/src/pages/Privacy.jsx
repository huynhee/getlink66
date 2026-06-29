import React from "react";
import { Database, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { text } from "../i18n.js";

const privacyContent = {
  vi: {
    eyebrow: "privacy policy",
    title: "Chính Sách Bảo Mật",
    intro: "Trang này mô tả cách 3DiPL thu thập, sử dụng, bảo vệ và lưu trữ dữ liệu khi bạn đăng nhập, nạp coin hoặc sử dụng dịch vụ getlink 3D66.",
    updated: "Cập nhật: 18/05/2026",
    asideTitle: "Bảo vệ dữ liệu",
    asideBody: "Chỉ thu thập dữ liệu cần thiết cho đăng nhập, thanh toán, tải file và hỗ trợ vận hành.",
    home: "Về trang chủ",
    callout: "Nếu cần hỗ trợ về dữ liệu cá nhân hoặc giao dịch, hãy liên hệ quản trị viên qua kênh hỗ trợ chính thức của 3DiPL.",
    contact: "Email hỗ trợ sẽ được công bố trong phần liên hệ của website.",
    sections: [
      {
        title: "1. Thông tin chúng tôi thu thập",
        body: [
          "Khi bạn đăng nhập và sử dụng 3DiPL, hệ thống có thể lưu thông tin tài khoản Google như email, tên hiển thị và ảnh đại diện để xác thực người dùng.",
          "Hệ thống cũng lưu số dư coin, lịch sử nạp tiền, lịch sử getlink, trạng thái đơn nạp và các log kỹ thuật cần thiết để vận hành dịch vụ."
        ]
      },
      {
        title: "2. Mục đích sử dụng dữ liệu",
        body: [
          "Dữ liệu được dùng để đăng nhập, cộng/trừ coin, tạo link tải, xử lý thanh toán, chống gian lận, hỗ trợ người dùng và gửi thông báo vận hành khi cần.",
          "Các thông tin kỹ thuật như IP, thời điểm truy cập và lỗi hệ thống giúp chúng tôi bảo vệ tài khoản, phát hiện lạm dụng và cải thiện độ ổn định của dịch vụ."
        ]
      },
      {
        title: "3. Thanh toán và webhook",
        body: [
          "Khi bạn nạp coin, hệ thống có thể xử lý nội dung chuyển khoản, mã giao dịch, số tiền, trạng thái thanh toán và dữ liệu callback từ nhà cung cấp thanh toán.",
          "Thông tin này chỉ dùng để đối soát giao dịch, tự động cộng coin hoặc hỗ trợ kiểm tra thủ công nếu thanh toán chưa được xác nhận."
        ]
      },
      {
        title: "4. Chia sẻ dữ liệu",
        body: [
          "3DiPL không bán dữ liệu cá nhân của người dùng.",
          "Một số dữ liệu có thể được xử lý qua các dịch vụ cần thiết như Google OAuth, hạ tầng lưu trữ, cơ sở dữ liệu, nhà cung cấp thanh toán, Telegram thông báo vận hành hoặc dịch vụ nguồn 3D66 để hoàn tất yêu cầu tải."
        ]
      },
      {
        title: "5. Bảo mật",
        body: [
          "Chúng tôi áp dụng các biện pháp hợp lý như xác thực đăng nhập, phân quyền quản trị, biến môi trường cho khóa bí mật, mã hóa dữ liệu nhạy cảm khi cấu hình và giới hạn log chứa thông tin quan trọng.",
          "Không hệ thống trực tuyến nào an toàn tuyệt đối. Người dùng cần giữ an toàn tài khoản Google và không chia sẻ quyền truy cập cho người khác."
        ]
      },
      {
        title: "6. Lưu trữ và xóa dữ liệu",
        body: [
          "Dữ liệu tài khoản và giao dịch được lưu trong thời gian cần thiết để cung cấp dịch vụ, đối soát thanh toán, xử lý khiếu nại và tuân thủ yêu cầu pháp lý nếu có.",
          "Bạn có thể liên hệ quản trị viên để yêu cầu kiểm tra, xuất hoặc xóa dữ liệu cá nhân trong phạm vi hệ thống có thể xử lý."
        ]
      },
      {
        title: "7. Cập nhật chính sách",
        body: [
          "Chính sách này có thể được cập nhật khi dịch vụ thay đổi tính năng, hạ tầng hoặc yêu cầu vận hành. Phiên bản mới sẽ có hiệu lực khi được đăng trên website."
        ]
      }
    ]
  },
  en: {
    eyebrow: "privacy policy",
    title: "Privacy Policy",
    intro: "This page explains how 3DiPL collects, uses, protects, and stores data when you sign in, top up coins, or use the 3D66 getlink service.",
    updated: "Updated: 05/18/2026",
    asideTitle: "Data protection",
    asideBody: "We only collect data needed for sign-in, payment, file downloads, and service operations.",
    home: "Back to home",
    callout: "If you need help with personal data or transactions, contact the administrator through the official 3DiPL support channel.",
    contact: "Support email will be published in the website contact section.",
    sections: [
      {
        title: "1. Information we collect",
        body: [
          "When you sign in and use 3DiPL, the system may store Google account information such as email, display name, and avatar for user authentication.",
          "The system also stores coin balance, top-up history, getlink history, top-up order status, and technical logs required to operate the service."
        ]
      },
      {
        title: "2. How we use data",
        body: [
          "Data is used for sign-in, coin balance updates, download link generation, payment processing, fraud prevention, user support, and operational notifications when needed.",
          "Technical information such as IP address, access time, and system errors helps us protect accounts, detect abuse, and improve service stability."
        ]
      },
      {
        title: "3. Payments and webhooks",
        body: [
          "When you top up coins, the system may process transfer content, transaction code, amount, payment status, and callback data from payment providers.",
          "This information is used only for transaction reconciliation, automatic coin updates, or manual support when a payment has not been confirmed."
        ]
      },
      {
        title: "4. Data sharing",
        body: [
          "3DiPL does not sell users' personal data.",
          "Some data may be processed through necessary services such as Google OAuth, hosting infrastructure, databases, payment providers, Telegram operational alerts, or the upstream 3D66 service to complete download requests."
        ]
      },
      {
        title: "5. Security",
        body: [
          "We apply reasonable measures such as sign-in authentication, admin access control, environment variables for secrets, encryption for sensitive configured data, and limits on logs that contain important information.",
          "No online system is completely secure. Users should protect their Google accounts and should not share access with others."
        ]
      },
      {
        title: "6. Data retention and deletion",
        body: [
          "Account and transaction data is retained as needed to provide the service, reconcile payments, handle disputes, and comply with legal requirements if applicable.",
          "You may contact the administrator to request review, export, or deletion of personal data within the scope the system can process."
        ]
      },
      {
        title: "7. Policy updates",
        body: [
          "This policy may be updated when service features, infrastructure, or operational requirements change. The new version takes effect when posted on the website."
        ]
      }
    ]
  }
};

export default function Privacy({ language = "vi" }) {
  const content = privacyContent[language] || privacyContent.vi;

  return (
    <div className="legalPage">
      <section className="legalHero">
        <div>
          <span className="eyebrowSignal">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.intro}</p>
        </div>
        <div className="legalMeta">
          <ShieldCheck size={22} />
          <span>{content.updated}</span>
        </div>
      </section>

      <section className="legalGrid">
        <aside className="legalAside panel">
          <h2>
            <LockKeyhole size={20} />
            {content.asideTitle}
          </h2>
          <p>{content.asideBody}</p>
          <a className="smallButton" href="/">
            {text(language, "Về trang chủ", "Back to home")}
          </a>
        </aside>

        <article className="legalArticle panel">
          {content.sections.map((section) => (
            <section className="legalSection" key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}

          <div className="legalCallout">
            <Database size={18} />
            <p>{content.callout}</p>
          </div>

          <div className="legalContact">
            <Mail size={18} />
            <span>{content.contact}</span>
          </div>
        </article>
      </section>
    </div>
  );
}
