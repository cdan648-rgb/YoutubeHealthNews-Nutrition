import type { SeedArticle } from './types';

/**
 * Seed 1 — the lead story.
 *
 * Source: Số 132, "Vắc xin ung thư" viết lại tương lai ung thư học (lBKtncuS0yY).
 *
 * The hardest part of this topic is restraint. Cancer immunotherapy invites
 * breakthrough language, and the source description itself uses some, so the article
 * separates three things carefully: what the mechanism is (sourced), what the video
 * frames as a shift in thinking (attributed to the speaker), and what has and has not
 * been established in practice (sourced, with the limits stated plainly).
 *
 * The topic borders on "cancer treatment choice", which the restricted-topic list blocks
 * for automated generation. That is exactly right — and it is also why this one is
 * hand-written: it explains an area of research without ever touching what any
 * individual patient should do.
 */
export const vacXinUngThu: SeedArticle = {
  slug: 'vac-xin-ung-thu-huan-luyen-he-mien-dich-nhan-dien-khoi-u',
  title: 'Vắc xin ung thư: hướng đi huấn luyện hệ miễn dịch thay vì áp đảo khối u',
  dek: 'Từ virus giải u đến vắc xin cá thể hoá và công nghệ mRNA, ngành ung thư học đang thử một cách tiếp cận khác: dạy hệ miễn dịch của chính người bệnh nhận ra tế bào ung thư. Đây là nội dung số 132 của kênh Bác sĩ Trần Văn Phúc Official, và đây là những gì đã được kiểm chứng.',
  categorySlug: 'mien-dich-nhiem-trung-ung-thu',
  isFactCheck: false,
  videoId: 'lBKtncuS0yY',
  publishedDateHanoi: '2026-09-20',
  seo: {
    metaTitle: 'Vắc xin ung thư và miễn dịch trị liệu: hiểu đúng hướng nghiên cứu',
    metaDescription:
      'Vắc xin ung thư, virus giải u và công nghệ mRNA hoạt động theo nguyên lý nào? Bài tổng hợp từ số 132 kênh Bác sĩ Trần Văn Phúc Official, kèm nguồn từ WHO và MedlinePlus.',
  },
  references: [
    {
      label: '1',
      title: 'Cancer Immunotherapy',
      publisher: 'MedlinePlus, Thư viện Y khoa Quốc gia Hoa Kỳ',
      url: 'https://medlineplus.gov/cancerimmunotherapy.html',
    },
    {
      label: '2',
      title: 'Cancer — Fact sheet',
      publisher: 'Tổ chức Y tế Thế giới (WHO)',
      url: 'https://www.who.int/news-room/fact-sheets/detail/cancer',
    },
  ],
  body: [
    { t: 'source_note' },
    {
      t: 'p',
      text: 'Trong nhiều thập kỷ, cách tiếp cận chủ đạo với ung thư là dùng ngoại lực: phẫu thuật cắt bỏ, tia xạ phá huỷ, hoá chất tiêu diệt tế bào đang phân chia nhanh. Những phương pháp này đã và đang cứu sống rất nhiều người. Nhưng song song với chúng, một hướng khác đã âm thầm phát triển và đến nay trở thành một nhánh riêng của y học: thay vì tấn công khối u từ bên ngoài, người ta tìm cách huấn luyện hệ miễn dịch của chính bệnh nhân làm việc đó.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Nhóm phương pháp này được gọi chung là miễn dịch trị liệu. Theo tài liệu của Thư viện Y khoa Quốc gia Hoa Kỳ, miễn dịch trị liệu là các liệu pháp giúp hệ miễn dịch nhận diện và tấn công tế bào ung thư, và hiện đã có nhiều loại được sử dụng trong điều trị thực tế với các cơ chế khác nhau.',
      attribution: 'established',
      ref: 0,
    },
    { t: 'h2', text: 'Vấn đề cốt lõi: vì sao hệ miễn dịch lại bỏ qua khối u' },
    {
      t: 'p',
      text: 'Hệ miễn dịch rất giỏi phát hiện những gì "không phải mình" — vi khuẩn, virus, tế bào lạ. Khó khăn với ung thư nằm ở chỗ tế bào ung thư vốn xuất phát từ chính cơ thể. Chúng mang phần lớn đặc điểm của tế bào bình thường, nên hệ miễn dịch không có lý do rõ ràng để coi chúng là kẻ địch. Thêm vào đó, khối u còn tạo ra một môi trường xung quanh có khả năng ức chế hoạt động của tế bào miễn dịch tiến đến gần.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Số 132 của kênh mô tả đây là một sự chuyển dịch trong tư duy điều trị: thay vì dùng ngoại lực áp đảo, y học đang từng bước huấn luyện hệ miễn dịch của chính người bệnh để nhận diện và kiểm soát khối u.',
      attribution: 'speaker',
    },
    {
      t: 'figure_svg',
      motif: 'shield',
      caption:
        'Nguyên lý chung của miễn dịch trị liệu: tăng khả năng nhận diện của hệ miễn dịch thay vì trực tiếp phá huỷ khối u từ bên ngoài.',
      alt: 'Hình minh hoạ các lớp phòng vệ lồng nhau, tượng trưng cho hệ miễn dịch nhiều tầng.',
    },
    { t: 'h2', text: 'Virus giải u: một ý tưởng cũ hơn nhiều người nghĩ' },
    {
      t: 'p',
      text: 'Ý tưởng dùng virus để tấn công khối u không phải là phát minh của thập kỷ này. Số 132 điểm lại chặng đường khoảng 70 năm thăng trầm của hướng nghiên cứu virus giải u — những "cỗ máy sống" được thiết kế để nhân lên trong tế bào ung thư và phá huỷ chúng, đồng thời làm lộ ra các dấu hiệu giúp hệ miễn dịch nhận diện khối u.',
      attribution: 'speaker',
    },
    {
      t: 'p',
      text: 'Lịch sử dài đó cũng là một lời nhắc quan trọng: một hướng nghiên cứu có thể đúng về nguyên lý nhưng cần rất nhiều năm để trở thành phương pháp điều trị dùng được, vì phải giải quyết hàng loạt vấn đề về an toàn, liều lượng, cách đưa thuốc tới đúng chỗ và khả năng lặp lại kết quả trên nhiều bệnh nhân khác nhau.',
      attribution: 'general',
    },
    { t: 'h2', text: 'Vắc xin ung thư cá thể hoá và công nghệ mRNA' },
    {
      t: 'p',
      text: 'Khác với vắc xin phòng bệnh truyền nhiễm — tiêm cho người chưa bệnh để phòng ngừa — vắc xin ung thư trong hướng nghiên cứu này thường mang tính điều trị: được tạo ra cho người đã có khối u, dựa trên những đặc điểm phân tử riêng của chính khối u đó. Đây là lý do chúng được gọi là "cá thể hoá".',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Số 132 nhấn mạnh vai trò của công nghệ mRNA và các thuật toán trí tuệ nhân tạo trong việc chọn ra những đặc điểm phân tử nào của khối u là đích ngắm đáng giá, cùng với các thử nghiệm lâm sàng đang được tiến hành để kiểm tra hướng đi này.',
      attribution: 'speaker',
    },
    {
      t: 'key_facts',
      title: 'Bốn điểm cần nhớ',
      items: [
        'Miễn dịch trị liệu là một nhóm phương pháp, không phải một loại thuốc duy nhất, và các cơ chế rất khác nhau.',
        'Vắc xin ung thư trong hướng nghiên cứu này mang tính điều trị cho người đã có bệnh, không phải vắc xin phòng ngừa cho người khoẻ mạnh.',
        '"Cá thể hoá" nghĩa là chế phẩm được tạo dựa trên đặc điểm phân tử của chính khối u ở người bệnh đó.',
        'Nhiều hướng trong lĩnh vực này vẫn đang ở giai đoạn thử nghiệm, chưa phải phương pháp điều trị thường quy cho mọi loại ung thư.',
      ],
    },
    { t: 'h2', text: 'Điều bài viết này không thể trả lời' },
    {
      t: 'callout',
      tone: 'caution',
      title: 'Không có phương pháp nào phù hợp cho mọi người bệnh',
      text: 'Ung thư không phải một bệnh duy nhất mà là hàng trăm bệnh khác nhau. Việc một hướng nghiên cứu cho kết quả tốt trên một loại ung thư cụ thể, ở một nhóm bệnh nhân cụ thể, không có nghĩa nó phù hợp với người khác. Quyết định điều trị luôn phải do bác sĩ chuyên khoa ung thư đưa ra sau khi đánh giá đầy đủ từng trường hợp.',
    },
    {
      t: 'p',
      text: 'Theo WHO, ung thư là một trong những nguyên nhân gây tử vong hàng đầu trên toàn cầu, và phần lớn ca bệnh có thể được điều trị hiệu quả hơn khi được phát hiện sớm. Vì vậy, dù các hướng nghiên cứu mới đáng được theo dõi, những việc đã chứng minh giá trị rõ ràng — tầm soát đúng lịch, đến khám khi có dấu hiệu bất thường, tuân thủ phác đồ đã được chỉ định — vẫn quan trọng hơn bất cứ tin tức nào về công nghệ mới.',
      attribution: 'established',
      ref: 1,
    },
    {
      t: 'pull_quote',
      text: 'Một hướng nghiên cứu đầy hứa hẹn và một phương pháp điều trị đã được kiểm chứng là hai điều rất khác nhau.',
      kind: 'paraphrase',
    },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ],
};
