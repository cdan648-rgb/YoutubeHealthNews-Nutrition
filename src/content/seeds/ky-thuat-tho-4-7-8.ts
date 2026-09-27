import type { SeedArticle } from './types';

/**
 * Seed 5 — deliberately the hardest.
 *
 * Source: Số 121, "Kỹ thuật thở 4 - 7 - 8 Sóng não Delta và Thiền định" (hkP4Heyobuc).
 *
 * This video was chosen as a seed precisely because its description makes strong,
 * specific, unverifiable claims — a cleansing system "15 times stronger than normal", a
 * body "immune to illness", a lifespan that "defies time". An article that simply
 * summarised the description would repeat all three as fact.
 *
 * So this piece does the thing the whole validation gate exists to enforce: it explains
 * the technique (which is harmless and genuinely calming), reports the strong claims as
 * the video's claims, and states plainly which ones it could not substantiate. If an
 * automated article on this video ever reads differently from this one, the gate has
 * failed.
 */
export const kyThuatTho478: SeedArticle = {
  slug: 'ky-thuat-tho-4-7-8-nhung-gi-da-va-chua-duoc-chung-minh',
  title: 'Kỹ thuật thở 4-7-8: những gì đã và chưa được chứng minh',
  dek: 'Thở chậm và kéo dài nhịp thở ra là một cách thư giãn đơn giản, không tốn kém và an toàn với hầu hết mọi người. Nhưng một số tuyên bố đi kèm kỹ thuật này vượt xa bằng chứng hiện có. Bài phân tích dựa trên số 121 của kênh Bác sĩ Trần Văn Phúc Official.',
  categorySlug: 'phong-ngua-tam-than',
  isFactCheck: true,
  videoId: 'hkP4Heyobuc',
  publishedDateHanoi: '2026-09-24',
  seo: {
    metaTitle: 'Kỹ thuật thở 4-7-8: bằng chứng tới đâu?',
    metaDescription:
      'Thở 4-7-8 là gì, cơ chế thư giãn nào đã được ghi nhận, và những tuyên bố nào chưa có bằng chứng? Nguồn: NCCIH (Viện Y tế Quốc gia Hoa Kỳ) và số 121 kênh Bác sĩ Trần Văn Phúc Official.',
  },
  references: [
    {
      label: '1',
      title: 'Relaxation Techniques: What You Need To Know',
      publisher:
        'Trung tâm Quốc gia về Sức khoẻ Bổ sung và Tích hợp (NCCIH), Viện Y tế Quốc gia Hoa Kỳ',
      url: 'https://www.nccih.nih.gov/health/relaxation-techniques-what-you-need-to-know',
    },
    {
      label: '2',
      title: 'Meditation and Mindfulness: What You Need To Know',
      publisher:
        'Trung tâm Quốc gia về Sức khoẻ Bổ sung và Tích hợp (NCCIH), Viện Y tế Quốc gia Hoa Kỳ',
      url: 'https://www.nccih.nih.gov/health/meditation-and-mindfulness-what-you-need-to-know',
    },
  ],
  body: [
    { t: 'source_note' },
    {
      t: 'p',
      text: 'Kỹ thuật thở 4-7-8 rất dễ mô tả: hít vào bằng mũi trong khoảng 4 nhịp đếm, giữ hơi khoảng 7 nhịp, rồi thở ra bằng miệng chậm rãi trong khoảng 8 nhịp. Không cần dụng cụ, không tốn tiền, có thể làm ở bất cứ đâu. Chính sự đơn giản đó khiến nó được chia sẻ rộng rãi — và cũng khiến nó thường được gắn thêm những tuyên bố lớn hơn nhiều so với bằng chứng hiện có.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Bài viết này tách rõ hai phần: phần đã được các tổ chức y tế ghi nhận, và phần vẫn là giả thuyết hoặc chưa kiểm chứng được. Cách tách này không nhằm phủ nhận kỹ thuật, mà để quý vị biết mình đang dựa vào điều gì.',
      attribution: 'general',
    },
    { t: 'h2', text: 'Phần đã được ghi nhận: nhịp thở chậm và phản ứng thư giãn' },
    {
      t: 'p',
      text: 'Theo Trung tâm Quốc gia về Sức khoẻ Bổ sung và Tích hợp thuộc Viện Y tế Quốc gia Hoa Kỳ, các kỹ thuật thư giãn — trong đó có thở sâu, thở có kiểm soát — là những phương pháp được sử dụng để làm giảm căng thẳng, và nhìn chung được xem là an toàn với người khoẻ mạnh.',
      attribution: 'established',
      ref: 0,
    },
    {
      t: 'p',
      text: 'Cơ chế dễ hiểu nhất nằm ở tỷ lệ giữa hít vào và thở ra. Khi thở ra dài hơn hít vào, hoạt động của nhánh thần kinh phó giao cảm — nhánh liên quan tới trạng thái nghỉ — được ưu thế hơn. Điều này thường đi kèm cảm giác dịu lại, và là điểm chung của nhiều kỹ thuật thở khác nhau, không riêng gì nhịp 4-7-8. Con số cụ thể ít quan trọng hơn nguyên tắc thở ra chậm và dài.',
      attribution: 'general',
    },
    {
      t: 'figure_svg',
      motif: 'breath',
      caption:
        'Điểm chung của các kỹ thuật thở thư giãn: nhịp thở ra dài hơn nhịp hít vào, thực hiện chậm và đều.',
      alt: 'Hình minh hoạ các vòng tròn đồng tâm mở rộng dần, tượng trưng cho nhịp thở chậm và đều.',
    },
    { t: 'h2', text: 'Phần chưa được chứng minh: những con số và lời hứa lớn' },
    {
      t: 'p',
      text: 'Phần mô tả của số 121 nêu rằng kỹ thuật này kích hoạt hệ thống tự làm sạch của cơ thể mạnh hơn bình thường gấp 15 lần, rằng người thực hành có thể chủ động bước vào trạng thái sóng Delta ngay khi đang thức, và liên hệ điều đó với một cơ thể miễn nhiễm với bệnh tật cùng tuổi thọ rất dài.',
      attribution: 'speaker',
    },
    {
      t: 'callout',
      tone: 'caution',
      title: 'Ba tuyên bố chúng tôi không tìm được bằng chứng xác nhận',
      text: 'Thứ nhất, con số "gấp 15 lần" là một khẳng định định lượng rất cụ thể; chúng tôi không tìm được tài liệu từ tổ chức y tế uy tín nào xác nhận rằng một kỹ thuật thở làm tăng hoạt động thanh thải của hệ thần kinh trung ương theo đúng tỷ lệ này. Thứ hai, việc chủ động tạo ra sóng Delta khi đang thức là một tuyên bố về điện sinh lý não cần được đo lường mới kết luận được. Thứ ba, không có phương pháp nào — kể cả thở, thiền hay tập luyện — khiến cơ thể miễn nhiễm với bệnh tật. Chúng tôi nêu rõ những điểm này thay vì lược bỏ, để quý vị biết ranh giới giữa nội dung của video và bằng chứng hiện có.',
    },
    {
      t: 'p',
      text: 'Đây không phải lời buộc tội. Một kỹ thuật có thể vừa hữu ích vừa được quảng bá bằng những lời quá mức, và cả hai điều đó có thể cùng đúng. Nhưng một bài viết về sức khoẻ có nghĩa vụ phân biệt chúng.',
      attribution: 'general',
    },
    { t: 'h2', text: 'Thiền và chánh niệm: bằng chứng ở mức nào' },
    {
      t: 'p',
      text: 'Về các phương pháp thiền và chánh niệm, NCCIH cho biết đã có nghiên cứu cho thấy chúng có thể giúp ích với căng thẳng, lo âu, đau và một số vấn đề khác, nhưng phần lớn nghiên cứu còn có hạn chế về phương pháp, và các phương pháp này không nên được dùng để thay thế điều trị y khoa thông thường.',
      attribution: 'established',
      ref: 1,
    },
    {
      t: 'key_facts',
      title: 'Những điểm chính',
      items: [
        'Thở 4-7-8: hít vào 4 nhịp, giữ 7 nhịp, thở ra chậm 8 nhịp — không cần dụng cụ, không tốn phí.',
        'Nguyên tắc thực sự có giá trị là thở ra dài hơn hít vào, không phải bộ ba con số cụ thể.',
        'Các kỹ thuật thư giãn được NCCIH xem là nhìn chung an toàn với người khoẻ mạnh.',
        'Tuyên bố "tăng gấp 15 lần" và "miễn nhiễm với bệnh tật" không có bằng chứng xác nhận.',
        'Thiền và chánh niệm có bằng chứng ở mức hạn chế, và không thay thế điều trị y khoa.',
        'Người có bệnh hô hấp, tim mạch, đang mang thai hoặc từng ngất khi nín thở nên hỏi bác sĩ trước khi tập nín thở kéo dài.',
      ],
    },
    { t: 'h2', text: 'Ai nên cẩn thận' },
    {
      t: 'p',
      text: 'Thành phần cần lưu ý nhất của kỹ thuật này là đoạn nín thở. Với phần lớn người khoẻ mạnh, giữ hơi vài giây là vô hại. Nhưng người có bệnh phổi hoặc tim mạch, người đang mang thai, người hay choáng váng hoặc từng ngất khi nín thở, và người có cơn hoảng loạn liên quan tới cảm giác thiếu không khí nên trao đổi với bác sĩ trước. Nếu trong lúc tập thấy choáng, tê bì quanh miệng hoặc tim đập nhanh bất thường, hãy dừng lại và thở bình thường.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Một điểm cuối: kỹ thuật thở là biện pháp hỗ trợ. Nếu quý vị mất ngủ kéo dài, lo âu ảnh hưởng tới sinh hoạt, hoặc khó thở, đó là những vấn đề cần được khám và tìm nguyên nhân, không phải những vấn đề để tự xử lý bằng một bài tập thở.',
      attribution: 'general',
    },
    {
      t: 'pull_quote',
      text: 'Một kỹ thuật có thể vừa thực sự hữu ích, vừa được quảng bá bằng những lời vượt quá bằng chứng.',
      kind: 'paraphrase',
    },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ],
};
