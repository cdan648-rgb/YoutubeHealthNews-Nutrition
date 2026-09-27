import type { SeedArticle } from './types';

/**
 * Seed 2 — the largest content cluster on the channel.
 *
 * Source: Số 118, THIẾU MAGIE CƠ THỂ SỤP ĐỔ NHƯ THẾ NÀO? (An4HFu4EwFQ), the highest
 * view count in the captured sample at 424,298.
 *
 * Micronutrient articles are where the no-dosage rule earns its keep. The obvious thing
 * a reader wants — "how much should I take?" — is exactly what we must not supply, both
 * because it depends on the individual and because the validation gate will refuse any
 * article containing a dosage. So the piece answers a different, more useful question:
 * what magnesium does, why a deficiency is hard to spot, and why a blood test is a poor
 * guide.
 */
export const thieuMagie: SeedArticle = {
  slug: 'thieu-magie-anh-huong-den-co-the-nhu-the-nao',
  title: 'Thiếu magie ảnh hưởng đến cơ thể như thế nào, và vì sao rất khó nhận ra',
  dek: 'Magie tham gia vào hàng trăm phản ứng enzyme, nhưng phần lớn lượng magie trong cơ thể lại không nằm trong máu — điều khiến một xét nghiệm máu bình thường chưa chắc loại trừ được tình trạng thiếu. Tổng hợp từ số 118 của kênh Bác sĩ Trần Văn Phúc Official.',
  categorySlug: 'vi-chat-vitamin',
  isFactCheck: false,
  videoId: 'An4HFu4EwFQ',
  publishedDateHanoi: '2026-09-21',
  seo: {
    metaTitle: 'Thiếu magie: vai trò sinh học và vì sao khó phát hiện',
    metaDescription:
      'Magie tham gia vào phản ứng enzyme, sản xuất năng lượng và ổn định cấu trúc tế bào. Vì sao xét nghiệm máu không phản ánh đầy đủ tình trạng magie? Nguồn: MedlinePlus.',
  },
  references: [
    {
      label: '1',
      title: 'Magnesium in diet',
      publisher: 'MedlinePlus Medical Encyclopedia, Thư viện Y khoa Quốc gia Hoa Kỳ',
      url: 'https://medlineplus.gov/ency/article/002423.htm',
    },
    {
      label: '2',
      title: 'Minerals',
      publisher: 'MedlinePlus, Thư viện Y khoa Quốc gia Hoa Kỳ',
      url: 'https://medlineplus.gov/minerals.html',
    },
  ],
  body: [
    { t: 'source_note' },
    {
      t: 'p',
      text: 'Magie là một trong những khoáng chất có mặt nhiều nhất trong cơ thể, nhưng cũng là một trong những khoáng chất ít được nhắc tới nhất khi người ta nói về dinh dưỡng. Lý do rất đơn giản: nó không gây ra một triệu chứng đặc trưng nào. Không có "bệnh thiếu magie" với hình ảnh dễ nhận biết như thiếu vitamin C gây chảy máu chân răng.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Theo tài liệu của Thư viện Y khoa Quốc gia Hoa Kỳ, magie cần cho hơn 300 phản ứng sinh hoá trong cơ thể, tham gia vào hoạt động của cơ và hệ thần kinh, điều hoà nhịp tim, hỗ trợ hệ miễn dịch và giữ cho xương chắc khoẻ.',
      attribution: 'established',
      ref: 0,
    },
    { t: 'h2', text: 'Vai trò ở cấp độ tế bào: một chiếc chìa khoá dùng chung' },
    {
      t: 'p',
      text: 'Cách dễ hiểu nhất để hình dung magie là coi nó như một chiếc chìa khoá dùng chung cho rất nhiều ổ khoá khác nhau. Nó không trực tiếp làm một việc gì cụ thể, mà là điều kiện để nhiều enzyme khác hoạt động được. Điều này giải thích vì sao khi thiếu magie, biểu hiện lại rải rác trên nhiều hệ cơ quan thay vì tập trung vào một chỗ.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Số 118 tiếp cận vấn đề bằng lăng kính sinh học phân tử, và mô tả tình trạng thiếu magie không giống như một chiếc đèn bị tắt, mà giống như cả một hệ thống "nhà máy" trong tế bào bị đình trệ — từ chuỗi protein gập sai, tới phân tử ATP không thể làm tốt vai trò cung cấp năng lượng, tới sự lỏng lẻo trong cấu trúc di truyền.',
      attribution: 'speaker',
    },
    {
      t: 'figure_svg',
      motif: 'molecule',
      caption:
        'Magie hoạt động như một yếu tố hỗ trợ cho nhiều enzyme khác nhau, nên khi thiếu, ảnh hưởng xuất hiện rải rác ở nhiều hệ cơ quan.',
      alt: 'Hình minh hoạ mạng lưới các nút liên kết với nhau, tượng trưng cho nhiều phản ứng enzyme phụ thuộc vào cùng một yếu tố.',
    },
    { t: 'h2', text: 'Vì sao xét nghiệm máu không phải câu trả lời cuối cùng' },
    {
      t: 'p',
      text: 'Đây là điểm dễ gây nhầm lẫn nhất. Phần lớn magie trong cơ thể không nằm tự do trong huyết tương mà nằm trong xương và bên trong tế bào. Vì vậy nồng độ magie trong máu có thể vẫn trong khoảng tham chiếu bình thường trong khi lượng magie dự trữ đã giảm. Một kết quả "bình thường" trên giấy vì thế không đồng nghĩa với "đủ".',
      attribution: 'general',
    },
    {
      t: 'callout',
      tone: 'info',
      title: 'Kết quả trong khoảng tham chiếu không phải lời khẳng định',
      text: 'Khoảng tham chiếu của một xét nghiệm cho biết giá trị đó phổ biến ở bao nhiêu phần trăm dân số, không cho biết nó tối ưu cho riêng quý vị. Đây là lý do việc đọc kết quả xét nghiệm cần bác sĩ đặt nó cạnh bệnh sử, triệu chứng và các chỉ số khác, thay vì so một con số với hai đầu mút in trên tờ giấy.',
    },
    { t: 'h2', text: 'Nguồn magie trong bữa ăn hằng ngày' },
    {
      t: 'p',
      text: 'Magie có nhiều trong các loại hạt, đậu, ngũ cốc nguyên hạt và rau lá xanh đậm. Điểm đáng chú ý là quá trình chế biến tinh luyện — ví dụ xay bỏ lớp cám của ngũ cốc — làm mất một phần đáng kể lượng magie, nên chế độ ăn dựa nhiều vào thực phẩm tinh chế sẽ nghèo magie hơn so với cùng lượng thực phẩm ở dạng nguyên hạt.',
      attribution: 'established',
      ref: 0,
    },
    {
      t: 'key_facts',
      title: 'Những điểm chính',
      items: [
        'Magie là yếu tố cần thiết cho hơn 300 phản ứng sinh hoá, nên thiếu magie biểu hiện rải rác chứ không đặc trưng.',
        'Phần lớn magie nằm trong xương và trong tế bào, không nằm trong huyết tương.',
        'Nồng độ magie máu trong khoảng tham chiếu chưa loại trừ được tình trạng thiếu dự trữ.',
        'Hạt, đậu, ngũ cốc nguyên hạt và rau lá xanh đậm là nguồn magie tự nhiên trong bữa ăn.',
        'Thực phẩm tinh chế mất một phần magie so với dạng nguyên hạt.',
      ],
    },
    { t: 'h2', text: 'Vì sao bài viết này không đưa ra liều bổ sung' },
    {
      t: 'p',
      text: 'Nhu cầu magie khác nhau theo tuổi, giới, tình trạng mang thai và đặc biệt là theo chức năng thận, vì thận là cơ quan điều hoà việc thải magie. Ở người có bệnh thận, bổ sung magie không kiểm soát có thể gây hại. Ngoài ra magie còn tương tác với một số thuốc. Đó là những lý do vì sao liều lượng là việc của bác sĩ điều trị, dựa trên tình trạng cụ thể của từng người, chứ không phải của một bài viết trên internet.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Tài liệu của MedlinePlus về khoáng chất cũng lưu ý rằng cơ thể chỉ cần một lượng nhỏ các khoáng chất vi lượng, và việc dùng quá nhiều có thể gây hại — nguyên tắc chung áp dụng cho cả nhóm vi chất chứ không riêng magie.',
      attribution: 'established',
      ref: 1,
    },
    {
      t: 'pull_quote',
      text: 'Thiếu magie thường không tạo ra một triệu chứng riêng biệt nào, mà làm nhiều thứ cùng hoạt động kém hơn một chút.',
      kind: 'paraphrase',
    },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ],
};
