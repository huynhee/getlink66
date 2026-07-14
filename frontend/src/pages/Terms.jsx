import React from "react";
import { AlertTriangle, CreditCard, FileText, Scale } from "lucide-react";
import { text } from "../i18n.js";

const termsContent = {
  vi: {
    eyebrow: "terms of service",
    title: "Điều Khoản Sử Dụng",
    intro: "Các điều khoản dưới đây áp dụng cho việc đăng nhập, nạp credit và sử dụng dịch vụ getlink 3D trên 3DiPL.",
    updated: "Cập nhật: 18/05/2026",
    asideTitle: "Quy định chính",
    home: "Về trang chủ",
    bullets: [
      "Sử dụng đúng mục đích hợp pháp.",
      "Credit dùng cho lượt getlink trong hệ thống.",
      "Không khai thác lỗi hoặc gây quá tải dịch vụ."
    ],
    warning: "Nếu bạn không đồng ý với điều khoản này, hãy ngừng sử dụng dịch vụ trước khi nạp credit hoặc tạo yêu cầu getlink mới.",
    contact: "Các giao dịch nạp tiền được đối soát theo lịch sử thanh toán và log hệ thống.",
    sections: [
      {
        title: "1. Phạm vi dịch vụ",
        body: [
          "3DiPL cung cấp dịch vụ trung gian hỗ trợ người dùng tạo link tải model 3D bằng credit trả trước.",
          "Dịch vụ phụ thuộc vào tình trạng tài khoản nguồn, hệ thống 3D, cache, kết nối mạng và các giới hạn kỹ thuật tại từng thời điểm."
        ]
      },
      {
        title: "2. Tài khoản người dùng",
        body: [
          "Người dùng đăng nhập bằng Google và chịu trách nhiệm bảo vệ tài khoản của mình.",
          "Bạn không được sử dụng tài khoản để tấn công hệ thống, gian lận thanh toán, khai thác lỗi, spam request hoặc gây ảnh hưởng đến người dùng khác."
        ]
      },
      {
        title: "3. Quy định sử dụng",
        body: [
          "Bạn chỉ được dùng dịch vụ cho các mục đích hợp pháp và tự chịu trách nhiệm với nội dung, bản quyền hoặc quyền sử dụng của model được tải.",
          "Không được tự động hóa truy vấn quy mô lớn, chia sẻ quyền truy cập, bán lại dịch vụ trái phép, vượt giới hạn bảo mật hoặc cố tình làm gián đoạn hệ thống."
        ]
      },
      {
        title: "4. Credit, nạp tiền và hoàn tiền",
        body: [
          "Credit được dùng để thanh toán lượt getlink trong hệ thống. Giá gói, tỷ lệ quy đổi và chương trình khuyến mại có thể thay đổi tùy thời điểm.",
          "Giao dịch chuyển khoản sai nội dung, sai số tiền hoặc thiếu mã đối soát có thể cần kiểm tra thủ công và xử lý chậm hơn.",
          "Credit đã dùng cho lượt getlink thành công thường không hoàn lại, trừ trường hợp lỗi hệ thống được quản trị viên xác nhận hoặc theo yêu cầu pháp luật."
        ]
      },
      {
        title: "5. Link tải và tính khả dụng",
        body: [
          "3DiPL cố gắng xử lý yêu cầu nhanh và ổn định, nhưng không cam kết mọi link 3D đều có thể tải thành công ở mọi thời điểm.",
          "Một số lỗi có thể đến từ nguồn 3D, file bị gỡ, giới hạn tài khoản, cookie hết hạn, thay đổi phía nhà cung cấp hoặc sự cố mạng."
        ]
      },
      {
        title: "6. Giới hạn trách nhiệm",
        body: [
          "Dịch vụ được cung cấp theo hiện trạng. 3DiPL không chịu trách nhiệm cho thiệt hại gián tiếp, mất dữ liệu, mất lợi nhuận hoặc tranh chấp bản quyền phát sinh từ việc sử dụng model tải về.",
          "Trong phạm vi pháp luật cho phép, trách nhiệm tối đa của 3DiPL được giới hạn ở giá trị credit người dùng đã thanh toán và chưa sử dụng trong hệ thống."
        ]
      },
      {
        title: "7. Tạm dừng hoặc chấm dứt dịch vụ",
        body: [
          "3DiPL có quyền tạm khóa tài khoản, hủy giao dịch hoặc từ chối phục vụ nếu phát hiện lạm dụng, gian lận, vi phạm điều khoản hoặc gây rủi ro cho hệ thống.",
          "Điều khoản có thể được cập nhật khi dịch vụ thay đổi. Việc tiếp tục sử dụng website sau khi điều khoản mới được đăng đồng nghĩa với việc bạn chấp nhận phiên bản cập nhật."
        ]
      }
    ]
  },
  en: {
    eyebrow: "terms of service",
    title: "Terms of Service",
    intro: "These terms apply to signing in, topping up credit, and using the 3D getlink service on 3DiPL.",
    updated: "Updated: 05/18/2026",
    asideTitle: "Key rules",
    home: "Back to home",
    bullets: [
      "Use the service only for lawful purposes.",
      "Credit is used for getlink requests in the system.",
      "Do not exploit bugs or overload the service."
    ],
    warning: "If you do not agree with these terms, stop using the service before topping up credit or creating a new getlink request.",
    contact: "Top-up transactions are reconciled using payment history and system logs.",
    sections: [
      {
        title: "1. Service scope",
        body: [
          "3DiPL provides an intermediary service that helps users create download links for 3D models using prepaid credit.",
          "The service depends on source account status, the 3D system, cache, network connectivity, and technical limits at each point in time."
        ]
      },
      {
        title: "2. User accounts",
        body: [
          "Users sign in with Google and are responsible for protecting their own accounts.",
          "You must not use your account to attack the system, commit payment fraud, exploit bugs, spam requests, or affect other users."
        ]
      },
      {
        title: "3. Acceptable use",
        body: [
          "You may use the service only for lawful purposes and are responsible for the content, copyright, or usage rights of downloaded models.",
          "You may not automate large-scale requests, share access, resell the service without permission, bypass security limits, or intentionally disrupt the system."
        ]
      },
      {
        title: "4. Credit, top-ups, and refunds",
        body: [
          "Credit is used to pay for getlink requests in the system. Package prices, conversion rates, and promotions may change over time.",
          "Transfers with incorrect content, incorrect amount, or missing reconciliation code may require manual review and may be processed more slowly.",
          "Credit used for successful getlink requests is generally non-refundable, except when a system error is confirmed by an administrator or required by law."
        ]
      },
      {
        title: "5. Download links and availability",
        body: [
          "3DiPL tries to process requests quickly and reliably, but does not guarantee that every 3D link can be downloaded successfully at all times.",
          "Some errors may come from the 3D source, removed files, account limits, expired cookies, provider-side changes, or network incidents."
        ]
      },
      {
        title: "6. Limitation of liability",
        body: [
          "The service is provided as is. 3DiPL is not responsible for indirect damages, data loss, lost profit, or copyright disputes arising from downloaded models.",
          "To the extent permitted by law, 3DiPL's maximum liability is limited to the value of credit the user has paid for and not yet used in the system."
        ]
      },
      {
        title: "7. Suspension or termination",
        body: [
          "3DiPL may suspend accounts, cancel transactions, or refuse service if abuse, fraud, term violations, or system risk is detected.",
          "These terms may be updated when the service changes. Continued use of the website after new terms are posted means you accept the updated version."
        ]
      }
    ]
  }
};

export default function Terms({ language = "vi" }) {
  const content = termsContent[language] || termsContent.vi;

  return (
    <div className="legalPage">
      <section className="legalHero">
        <div>
          <span className="eyebrowSignal">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.intro}</p>
        </div>
        <div className="legalMeta">
          <Scale size={22} />
          <span>{content.updated}</span>
        </div>
      </section>

      <section className="legalGrid">
        <aside className="legalAside panel">
          <h2>
            <FileText size={20} />
            {content.asideTitle}
          </h2>
          <ul className="legalList">
            {content.bullets.map((item) => <li key={item}>{item}</li>)}
          </ul>
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

          <div className="legalCallout warning">
            <AlertTriangle size={18} />
            <p>{content.warning}</p>
          </div>

          <div className="legalContact">
            <CreditCard size={18} />
            <span>{content.contact}</span>
          </div>
        </article>
      </section>
    </div>
  );
}
