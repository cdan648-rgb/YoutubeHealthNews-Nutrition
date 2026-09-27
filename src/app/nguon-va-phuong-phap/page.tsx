import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialPage } from '@/components/editorial/EditorialPage';
import { SITE, SOURCE_CHANNEL, routes } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Nguồn và phương pháp',
  description: `Cách ${SITE.name} chọn chủ đề, soạn bài, kiểm chứng con số và dẫn nguồn — bao gồm cả vai trò của công cụ AI và các giới hạn chúng tôi tự đặt ra.`,
  alternates: { canonical: routes.methodology() },
};

/**
 * The methodology page.
 *
 * This is the page that makes the site defensible rather than just another scaled-content
 * feed: it states plainly how articles are made, including the role of AI and the limits we
 * impose, so a reader can judge the process, not just the output. It describes the real
 * pipeline (extract, verify, draft, validate) without overclaiming.
 */
export default function MethodologyPage() {
  return (
    <EditorialPage
      kicker="Minh bạch"
      title="Nguồn và phương pháp"
      lead="Chúng tôi tin rằng một trang tin sức khoẻ phải nói rõ nó làm việc thế nào. Đây là toàn bộ quy trình của chúng tôi."
    >
      <h2>Tư liệu gốc</h2>
      <p>
        Phần lớn bài viết bắt đầu từ phần mô tả công khai của một video trên kênh{' '}
        <a href={SOURCE_CHANNEL.url} target="_blank" rel="noopener noreferrer nofollow">
          {SOURCE_CHANNEL.title}
        </a>
        . Chúng tôi <strong>không</strong> có bản ghi lời nói (transcript) của video, nên chúng tôi
        không bao giờ trích dẫn nguyên văn lời người nói — mọi nội dung đều được diễn giải lại. Khi
        kênh không có video mới trong nhiều ngày, chúng tôi chuyển sang viết về một công trình
        nghiên cứu đã công bố (xem mục <Link href={routes.research()}>Nghiên cứu</Link>).
      </p>

      <h2>Các bước soạn một bài viết</h2>
      <ul>
        <li>
          <strong>Phân tích:</strong> liệt kê các luận điểm trong tư liệu và phân loại từng luận
          điểm là điều video nói, kiến thức y khoa đã xác lập, hay điều không kiểm chứng được.
        </li>
        <li>
          <strong>Đối chiếu nguồn:</strong> với mỗi luận điểm cần dẫn nguồn, chúng tôi chỉ dùng các
          tên miền uy tín đã được duyệt (WHO, NIH, CDC, MedlinePlus, Cochrane, Europe PMC…). Đường
          dẫn nào không truy cập được sẽ bị loại bỏ.
        </li>
        <li>
          <strong>Soạn bài:</strong> bài viết được viết theo cấu trúc có kiểm soát, phân biệt rõ
          điều "theo video" với điều "đã được xác lập" kèm nguồn.
        </li>
        <li>
          <strong>Kiểm định:</strong> một bộ quy tắc tự động kiểm tra bài trước khi đăng.
        </li>
      </ul>

      <h2>Vai trò của công cụ AI</h2>
      <p>
        Chúng tôi dùng mô hình ngôn ngữ để hỗ trợ soạn thảo bản nháp từ tư liệu nguồn. Điều đó{' '}
        <strong>không</strong> có nghĩa là nội dung được đăng mà không qua kiểm soát. Mọi bản nháp
        phải vượt qua một bộ kiểm định xác định (không dùng AI để tự chấm điểm chính mình), gồm các
        quy tắc bắt buộc như:
      </p>
      <ul>
        <li>
          mọi con số phải xuất hiện trong tư liệu nguồn hoặc trong một nguồn tham khảo đã kiểm
          chứng;
        </li>
        <li>không có trích dẫn nguyên văn gán cho người nói trong video;</li>
        <li>
          không có liều lượng thuốc, không có lời khuyên dùng thuốc, không có tuyên bố "chữa khỏi";
        </li>
        <li>mọi nguồn tham khảo phải thuộc tên miền được duyệt và phải truy cập được;</li>
        <li>không sao chép quá một số từ liên tiếp từ tư liệu gốc.</li>
      </ul>
      <p>
        Nếu một bản nháp không vượt qua các quy tắc này, nó <strong>không được đăng tự động</strong>
        ; bỏ qua việc đăng luôn tốt hơn là đăng thông tin y tế sai.
      </p>

      <h2>Những chủ đề luôn cần người xem xét</h2>
      <p>
        Một số chủ đề không bao giờ được đăng tự động dù bài viết có "sạch" đến đâu: liều dùng, dùng
        thuốc cho trẻ em, thai kỳ, lựa chọn phác đồ điều trị ung thư, tương tác thuốc, tranh cãi về
        an toàn vắc xin, và mọi tuyên bố chữa khỏi. Những bài như vậy được chuyển cho người biên
        tập.
      </p>

      <h2>Giới hạn chúng tôi thừa nhận</h2>
      <ul>
        <li>Độ sâu của bài bị giới hạn bởi phần mô tả video, vì transcript không có sẵn.</li>
        <li>
          Một bài về nghiên cứu chỉ tường thuật một công trình đơn lẻ, không phải kết luận cuối cùng
          của y học.
        </li>
        <li>
          Chúng tôi có thể sai. Nếu bạn phát hiện lỗi, xin hãy{' '}
          <Link href={routes.contact()}>báo cho chúng tôi</Link>.
        </li>
      </ul>
    </EditorialPage>
  );
}
