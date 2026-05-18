import React from "react";
import { Database, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

const privacySections = [
  {
    title: "1. Thông tin chúng tôi thu thập",
    body: [
      "Khi bạn đăng nhập và sử dụng 3DiPL, hệ thống có thể lưu thông tin tài khoản Google như email, tên hiển thị và ảnh đại diện để xác thực người dùng.",
      "Hệ thống cũng lưu số dư credit, lịch sử nạp tiền, lịch sử getlink, trạng thái đơn nạp và các log kỹ thuật cần thiết để vận hành dịch vụ."
    ]
  },
  {
    title: "2. Mục đích sử dụng dữ liệu",
    body: [
      "Dữ liệu được dùng để đăng nhập, cộng/trừ credit, tạo link tải, xử lý thanh toán, chống gian lận, hỗ trợ người dùng và gửi thông báo vận hành khi cần.",
      "Các thông tin kỹ thuật như IP, thời điểm truy cập và lỗi hệ thống giúp chúng tôi bảo vệ tài khoản, phát hiện lạm dụng và cải thiện độ ổn định của dịch vụ."
    ]
  },
  {
    title: "3. Thanh toán và webhook",
    body: [
      "Khi bạn nạp credit, hệ thống có thể xử lý nội dung chuyển khoản, mã giao dịch, số tiền, trạng thái thanh toán và dữ liệu callback từ nhà cung cấp thanh toán.",
      "Thông tin này chỉ dùng để đối soát giao dịch, tự động cộng credit hoặc hỗ trợ kiểm tra thủ công nếu thanh toán chưa được xác nhận."
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
];

export default function Privacy() {
  return (
    <div className="legalPage">
      <section className="legalHero">
        <div>
          <span className="eyebrowSignal">privacy policy</span>
          <h1>Chính Sách Bảo Mật</h1>
          <p>
            Trang này mô tả cách 3DiPL thu thập, sử dụng, bảo vệ và lưu trữ dữ liệu khi bạn đăng nhập,
            nạp credit hoặc sử dụng dịch vụ getlink 3D66.
          </p>
        </div>
        <div className="legalMeta">
          <ShieldCheck size={22} />
          <span>Cập nhật: 18/05/2026</span>
        </div>
      </section>

      <section className="legalGrid">
        <aside className="legalAside panel">
          <h2>
            <LockKeyhole size={20} />
            Bảo vệ dữ liệu
          </h2>
          <p>
            Chỉ thu thập dữ liệu cần thiết cho đăng nhập, thanh toán, tải file và hỗ trợ vận hành.
          </p>
          <a className="smallButton" href="/">
            Về trang chủ
          </a>
        </aside>

        <article className="legalArticle panel">
          {privacySections.map((section) => (
            <section className="legalSection" key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}

          <div className="legalCallout">
            <Database size={18} />
            <p>
              Nếu cần hỗ trợ về dữ liệu cá nhân hoặc giao dịch, hãy liên hệ quản trị viên qua kênh hỗ trợ chính thức của 3DiPL.
            </p>
          </div>

          <div className="legalContact">
            <Mail size={18} />
            <span>Email hỗ trợ sẽ được công bố trong phần liên hệ của website.</span>
          </div>
        </article>
      </section>
    </div>
  );
}
