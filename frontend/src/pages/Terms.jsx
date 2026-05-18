import React from "react";
import { AlertTriangle, CreditCard, FileText, Scale } from "lucide-react";

const termsSections = [
  {
    title: "1. Phạm vi dịch vụ",
    body: [
      "3DiPL cung cấp dịch vụ trung gian hỗ trợ người dùng tạo link tải model từ 3D66 bằng credit trả trước.",
      "Dịch vụ phụ thuộc vào tình trạng tài khoản nguồn, hệ thống 3D66, cache, kết nối mạng và các giới hạn kỹ thuật tại từng thời điểm."
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
      "3DiPL cố gắng xử lý yêu cầu nhanh và ổn định, nhưng không cam kết mọi link 3D66 đều có thể tải thành công ở mọi thời điểm.",
      "Một số lỗi có thể đến từ nguồn 3D66, file bị gỡ, giới hạn tài khoản, cookie hết hạn, thay đổi phía nhà cung cấp hoặc sự cố mạng."
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
];

export default function Terms() {
  return (
    <div className="legalPage">
      <section className="legalHero">
        <div>
          <span className="eyebrowSignal">terms of service</span>
          <h1>Điều Khoản Sử Dụng</h1>
          <p>
            Các điều khoản dưới đây áp dụng cho việc đăng nhập, nạp credit và sử dụng dịch vụ getlink 3D66 trên 3DiPL.
          </p>
        </div>
        <div className="legalMeta">
          <Scale size={22} />
          <span>Cập nhật: 18/05/2026</span>
        </div>
      </section>

      <section className="legalGrid">
        <aside className="legalAside panel">
          <h2>
            <FileText size={20} />
            Quy định chính
          </h2>
          <ul className="legalList">
            <li>Sử dụng đúng mục đích hợp pháp.</li>
            <li>Credit dùng cho lượt getlink trong hệ thống.</li>
            <li>Không khai thác lỗi hoặc gây quá tải dịch vụ.</li>
          </ul>
          <a className="smallButton" href="/">
            Về trang chủ
          </a>
        </aside>

        <article className="legalArticle panel">
          {termsSections.map((section) => (
            <section className="legalSection" key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}

          <div className="legalCallout warning">
            <AlertTriangle size={18} />
            <p>
              Nếu bạn không đồng ý với điều khoản này, hãy ngừng sử dụng dịch vụ trước khi nạp credit hoặc tạo yêu cầu getlink mới.
            </p>
          </div>

          <div className="legalContact">
            <CreditCard size={18} />
            <span>Các giao dịch nạp tiền được đối soát theo lịch sử thanh toán và log hệ thống.</span>
          </div>
        </article>
      </section>
    </div>
  );
}
