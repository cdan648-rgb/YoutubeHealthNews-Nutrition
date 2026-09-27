import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialPage } from '@/components/editorial/EditorialPage';
import { INDEPENDENCE, SITE, SOURCE_CHANNEL, routes } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Về chúng tôi',
  description: `${SITE.name} là một trang tin độc lập, tổng hợp và diễn giải nội dung sức khoẻ công khai kèm nguồn tham khảo từ các tổ chức y tế uy tín.`,
  alternates: { canonical: routes.about() },
};

export default function AboutPage() {
  return (
    <EditorialPage
      kicker="Về chúng tôi"
      title={SITE.name}
      lead="Một trang tin độc lập về sức khoẻ và khoa học, viết bằng tiếng Việt, luôn dẫn nguồn để bạn tự kiểm chứng."
    >
      <h2>Chúng tôi làm gì</h2>
      <p>
        {SITE.name} tổng hợp và diễn giải lại nội dung sức khoẻ từ những tư liệu công khai — chủ yếu
        là phần mô tả các video trên kênh YouTube{' '}
        <a href={SOURCE_CHANNEL.url} target="_blank" rel="noopener noreferrer nofollow">
          {SOURCE_CHANNEL.title}
        </a>{' '}
        — rồi đối chiếu với tài liệu từ các tổ chức y tế uy tín. Mỗi bài viết đều nêu rõ nguồn gốc
        và phân biệt giữa điều video nói với điều đã được y học xác lập.
      </p>

      <h2>Chúng tôi là ai — và không là ai</h2>
      <p>{INDEPENDENCE.long}</p>
      <p>
        Chúng tôi tôn trọng công sức của tác giả kênh nguồn và luôn dẫn liên kết về video gốc để bạn
        có thể xem trực tiếp. Nếu bạn là chủ sở hữu nội dung và có yêu cầu liên quan, vui lòng xem
        trang <Link href={routes.contact()}>Liên hệ</Link>.
      </p>

      <h2>Vì sao nên tin những gì đọc ở đây</h2>
      <ul>
        <li>
          Mỗi con số và mỗi khẳng định y khoa đều được đối chiếu với tư liệu nguồn hoặc nguồn tham
          khảo.
        </li>
        <li>
          Chúng tôi công khai <Link href={routes.methodology()}>quy trình biên tập</Link>, kể cả vai
          trò của công cụ AI.
        </li>
        <li>
          Chúng tôi không đưa lời khuyên điều trị, không nêu liều lượng, không hứa hẹn chữa khỏi.
        </li>
        <li>Những chủ đề nhạy cảm về y tế luôn được người biên tập xem xét trước khi đăng.</li>
      </ul>

      <h2>Đây không phải là tư vấn y tế</h2>
      <p>
        Nội dung tại đây mang tính thông tin và giáo dục, không thay thế cho thăm khám và tư vấn của
        bác sĩ. Xem thêm <Link href={routes.disclaimer()}>Miễn trừ trách nhiệm</Link>.
      </p>
    </EditorialPage>
  );
}
