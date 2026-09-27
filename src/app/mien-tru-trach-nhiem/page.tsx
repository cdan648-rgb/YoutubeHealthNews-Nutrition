import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialPage } from '@/components/editorial/EditorialPage';
import { MEDICAL_DISCLAIMER, SITE, routes } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Miễn trừ trách nhiệm',
  description:
    'Nội dung trên trang mang tính thông tin và giáo dục, không thay thế cho tư vấn, chẩn đoán hoặc điều trị y tế của bác sĩ.',
  alternates: { canonical: routes.disclaimer() },
};

export default function DisclaimerPage() {
  return (
    <EditorialPage
      kicker="Lưu ý quan trọng"
      title="Miễn trừ trách nhiệm"
      lead={MEDICAL_DISCLAIMER.body}
    >
      <h2>Không phải tư vấn y tế</h2>
      <p>
        {SITE.name} cung cấp thông tin sức khoẻ tổng quát nhằm mục đích giáo dục. Nội dung không
        nhằm thay thế cho việc thăm khám, chẩn đoán hoặc điều trị của nhân viên y tế có chuyên môn.
        Với bất kỳ câu hỏi nào về tình trạng sức khoẻ, hãy hỏi bác sĩ của bạn.
      </p>

      <h2>Không tự ý dùng thuốc hay thực phẩm bổ sung</h2>
      <p>
        Đừng bắt đầu, ngừng hoặc thay đổi bất kỳ thuốc hay thực phẩm bổ sung nào chỉ dựa trên thông
        tin đọc được trên internet, kể cả trên trang này. Chúng tôi cố ý không nêu liều lượng cụ
        thể.
      </p>

      <h2>Trường hợp khẩn cấp</h2>
      <p>
        Nếu bạn cho rằng mình đang gặp tình huống y tế khẩn cấp, hãy gọi cấp cứu hoặc đến cơ sở y tế
        gần nhất ngay lập tức. Đừng chờ đợi vì thông tin trên trang này.
      </p>

      <h2>Về nguồn và độ chính xác</h2>
      <p>
        Chúng tôi cố gắng dẫn nguồn uy tín và kiểm chứng con số (xem{' '}
        <Link href={routes.methodology()}>Nguồn và phương pháp</Link>), nhưng khoa học luôn thay đổi
        và không nội dung nào là hoàn hảo. Nếu bạn thấy một điểm chưa chính xác, xin{' '}
        <Link href={routes.contact()}>liên hệ với chúng tôi</Link>.
      </p>
    </EditorialPage>
  );
}
