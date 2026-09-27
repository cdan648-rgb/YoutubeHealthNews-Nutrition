import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialPage } from '@/components/editorial/EditorialPage';
import { SITE, SOURCE_CHANNEL, routes } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Liên hệ',
  description: `Cách liên hệ với ${SITE.name}: góp ý, báo lỗi nội dung, hoặc yêu cầu liên quan tới bản quyền.`,
  alternates: { canonical: routes.contact() },
};

export default function ContactPage() {
  const email = SITE.contactEmail;
  return (
    <EditorialPage
      kicker="Liên hệ"
      title="Liên hệ với chúng tôi"
      lead="Chúng tôi hoan nghênh góp ý, đính chính và mọi câu hỏi về nội dung."
    >
      <h2>Góp ý và đính chính</h2>
      <p>
        Nếu bạn thấy một con số, một khẳng định hay một nguồn dẫn chưa chính xác, xin cho chúng tôi
        biết — chúng tôi xem việc sửa lỗi là một phần của quy trình biên tập (xem{' '}
        <Link href={routes.methodology()}>Nguồn và phương pháp</Link>).
      </p>

      {email === '' ? (
        <p>
          Kênh liên hệ qua email đang được thiết lập. Trong thời gian này, bạn có thể theo dõi và
          phản hồi trực tiếp trên video gốc tại kênh{' '}
          <a href={SOURCE_CHANNEL.url} target="_blank" rel="noopener noreferrer nofollow">
            {SOURCE_CHANNEL.title}
          </a>
          .
        </p>
      ) : (
        <p>
          Gửi email cho chúng tôi tại{' '}
          <a href={`mailto:${email}`} className="font-medium">
            {email}
          </a>
          . Chúng tôi cố gắng phản hồi trong vài ngày làm việc.
        </p>
      )}

      <h2>Về bản quyền nội dung nguồn</h2>
      <p>
        {SITE.name} là trang tin độc lập, không liên kết với kênh nguồn. Chúng tôi diễn giải lại tư
        liệu công khai và luôn dẫn liên kết về video gốc. Nếu bạn là chủ sở hữu nội dung và có yêu
        cầu, hãy liên hệ và nêu rõ nội dung liên quan để chúng tôi xử lý kịp thời.
      </p>
    </EditorialPage>
  );
}
