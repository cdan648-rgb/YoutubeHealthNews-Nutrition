import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialPage } from '@/components/editorial/EditorialPage';
import { SITE, routes } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật',
  description: `Dữ liệu ${SITE.name} thu thập, vì sao, và quyền của bạn. Chúng tôi thu thập tối thiểu: một địa chỉ email nếu bạn đăng ký bản tin, và không hơn.`,
  alternates: { canonical: routes.privacy() },
};

/**
 * Privacy policy.
 *
 * Written to match what the code actually does, not a generic template: the only personal
 * data stored is a newsletter email (with a consent record whose IP is HMAC'd, never stored
 * in the clear), and there is no third-party analytics or ad tracking. Claiming less or more
 * than the code does would make this page a liability rather than an assurance.
 */
export default function PrivacyPage() {
  return (
    <EditorialPage
      kicker="Quyền riêng tư"
      title="Chính sách bảo mật"
      lead="Chúng tôi thu thập càng ít dữ liệu càng tốt, và nói rõ chúng tôi thu thập những gì."
    >
      <h2>Chúng tôi thu thập gì</h2>
      <ul>
        <li>
          <strong>Địa chỉ email</strong> — chỉ khi bạn chủ động đăng ký bản tin. Chúng tôi dùng nó
          duy nhất để gửi thông báo bài viết mới.
        </li>
        <li>
          <strong>Bằng chứng đồng ý</strong> — khi bạn đăng ký, chúng tôi lưu thời điểm, phiên bản
          nội dung đồng ý, và một mã băm (HMAC) không thể đảo ngược của địa chỉ IP. Chúng tôi{' '}
          <strong>không</strong> lưu địa chỉ IP ở dạng gốc.
        </li>
      </ul>

      <h2>Chúng tôi không làm gì</h2>
      <ul>
        <li>Không bán, cho thuê hay chia sẻ email của bạn với bên thứ ba vì mục đích tiếp thị.</li>
        <li>Không dùng công cụ theo dõi quảng cáo hay hồ sơ hành vi của bên thứ ba.</li>
        <li>Không yêu cầu bạn tạo tài khoản để đọc bài.</li>
      </ul>

      <h2>Bên thứ ba chúng tôi dùng</h2>
      <p>
        Để vận hành, chúng tôi dùng một số dịch vụ hạ tầng: nền tảng lưu trữ web, cơ sở dữ liệu, và
        một dịch vụ gửi email cho bản tin. Các dịch vụ này chỉ nhận dữ liệu cần thiết để thực hiện
        chức năng của chúng (ví dụ: dịch vụ email nhận địa chỉ email của người đăng ký để gửi thư).
        Ảnh đại diện video được nhúng trực tiếp từ YouTube; chúng tôi không sao chép hay lưu trữ
        lại.
      </p>

      <h2>Quyền của bạn</h2>
      <p>
        Bạn có thể huỷ đăng ký bất cứ lúc nào bằng liên kết ở cuối mỗi email — việc này sẽ gỡ địa
        chỉ của bạn khỏi danh sách. Nếu muốn chúng tôi xoá hoàn toàn dữ liệu liên quan tới bạn, hãy{' '}
        <Link href={routes.contact()}>liên hệ</Link>.
      </p>

      <h2>Cookie</h2>
      <p>
        Trang này không dùng cookie theo dõi. Chúng tôi chỉ dùng bộ nhớ cục bộ của trình duyệt cho
        những tiện ích nhỏ trên máy bạn — ví dụ để ghi nhớ rằng bạn đã đóng cửa sổ mời đăng ký bản
        tin — và dữ liệu đó không rời khỏi thiết bị của bạn.
      </p>
    </EditorialPage>
  );
}
