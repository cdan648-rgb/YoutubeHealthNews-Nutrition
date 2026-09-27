import type { SeedArticle } from './types';

/**
 * Seed 3 — the fact-check format.
 *
 * Source: Số 127, "khi sản phẩm giải độc, thải độc chỉ là chiêu trò thương mại"
 * (cI74O0zS5QI).
 *
 * This is the seed that launches `is_fact_check`, and it is the clearest demonstration
 * of the attribution rule: the video's position on detox products is a position, stated
 * as such, while the claim that the liver and kidneys already perform this work
 * continuously is sourced. NCCIH — part of the NIH — has a dedicated page on detoxes and
 * cleanses, which makes this topic unusually well served by an authoritative citation.
 */
export const giaiDocThaiDoc: SeedArticle = {
  slug: 'san-pham-giai-doc-thai-doc-co-thuc-su-can-thiet',
  title: 'Sản phẩm “giải độc, thải độc”: cơ thể có cần chúng không?',
  dek: 'Gan và thận đã làm công việc thanh lọc liên tục, không nghỉ. Vậy các liệu trình “detox” bán trên thị trường đang bổ sung thêm điều gì? Bài kiểm chứng dựa trên số 127 của kênh Bác sĩ Trần Văn Phúc Official và tài liệu của Viện Y tế Quốc gia Hoa Kỳ.',
  categorySlug: 'dinh-duong-chuyen-hoa',
  isFactCheck: true,
  videoId: 'cI74O0zS5QI',
  publishedDateHanoi: '2026-09-22',
  seo: {
    metaTitle: 'Kiểm chứng: sản phẩm “giải độc, thải độc” có cần thiết không?',
    metaDescription:
      'Gan và thận vốn đã đảm nhiệm việc thanh lọc cơ thể. Bài kiểm chứng về các liệu trình detox, dựa trên số 127 của kênh Bác sĩ Trần Văn Phúc Official và tài liệu NCCIH (NIH).',
  },
  references: [
    {
      label: '1',
      title: 'Detoxes and Cleanses: What You Need To Know',
      publisher:
        'Trung tâm Quốc gia về Sức khoẻ Bổ sung và Tích hợp (NCCIH), Viện Y tế Quốc gia Hoa Kỳ',
      url: 'https://www.nccih.nih.gov/health/detoxes-and-cleanses-what-you-need-to-know',
    },
    {
      label: '2',
      title: 'Dietary Supplements',
      publisher: 'MedlinePlus, Thư viện Y khoa Quốc gia Hoa Kỳ',
      url: 'https://medlineplus.gov/dietarysupplements.html',
    },
  ],
  body: [
    { t: 'source_note' },
    {
      t: 'p',
      text: 'Từ "thải độc" xuất hiện khắp nơi: trà thải độc, nước ép thải độc, liệu trình thải độc gan, miếng dán thải độc bàn chân. Điểm chung của chúng là một giả định chưa bao giờ được nói rõ — rằng cơ thể đang tích tụ những "chất độc" nào đó và không tự xử lý được, nên cần một sản phẩm can thiệp từ bên ngoài.',
      attribution: 'general',
    },
    {
      t: 'callout',
      tone: 'myth',
      title: 'Điều được quảng cáo so với điều đã được kiểm chứng',
      text: 'Theo Trung tâm Quốc gia về Sức khoẻ Bổ sung và Tích hợp (NCCIH) thuộc Viện Y tế Quốc gia Hoa Kỳ, các liệu trình "detox" và "cleanse" không có bằng chứng thuyết phục cho thấy chúng loại bỏ độc tố khỏi cơ thể hay mang lại lợi ích sức khoẻ bền vững, và một số liệu trình còn có thể gây hại.',
    },
    { t: 'h2', text: 'Cơ thể vốn đã có hệ thống thanh lọc, hoạt động liên tục' },
    {
      t: 'p',
      text: 'Gan chuyển hoá các chất lạ thành dạng dễ tan trong nước hơn để có thể đào thải. Thận lọc máu và đưa chất thải ra theo nước tiểu. Phổi thải khí carbonic. Ruột đào thải phần không hấp thu được. Hệ thống này không cần được "kích hoạt" bằng một sản phẩm nào cả — nó vận hành liên tục suốt đời, kể cả trong lúc chúng ta ngủ.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Số 127 gọi đây là một "nhà máy sinh học" hoạt động không ngừng nghỉ, và đặt câu hỏi vì sao chúng ta thường đi tìm phép màu thanh lọc ở bên ngoài trong khi bỏ qua hệ thống đã có sẵn bên trong cơ thể.',
      attribution: 'speaker',
    },
    {
      t: 'figure_svg',
      motif: 'organ',
      caption:
        'Gan, thận, phổi và ruột tạo thành một hệ thống chuyển hoá và đào thải hoạt động liên tục, không cần can thiệp từ sản phẩm bên ngoài.',
      alt: 'Hình minh hoạ hệ thống ống phân nhánh, tượng trưng cho các đường chuyển hoá và đào thải của cơ thể.',
    },
    { t: 'h2', text: 'Vấn đề của khái niệm “độc tố” trong quảng cáo' },
    {
      t: 'p',
      text: 'Một điểm đáng chú ý: các sản phẩm thải độc hầu như không bao giờ nêu tên chất độc cụ thể mà chúng loại bỏ. Trong y học, ngộ độc là một chẩn đoán cụ thể — ngộ độc chì, ngộ độc thuỷ ngân, ngộ độc paracetamol — mỗi loại có cách xác định và cách điều trị riêng, và đều cần can thiệp y tế thực sự, không phải một loại trà.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Khi "độc tố" không được định danh, cũng không có cách nào kiểm tra xem sản phẩm có thực sự loại bỏ được nó hay không. Một tuyên bố không thể kiểm chứng thì cũng không thể bị chứng minh là sai — và đó chính là điều khiến nó bán được, chứ không phải điều khiến nó đúng.',
      attribution: 'general',
    },
    {
      t: 'key_facts',
      title: 'Những điểm chính',
      items: [
        'Gan, thận, phổi và ruột đã đảm nhiệm việc chuyển hoá và đào thải liên tục, không cần được "kích hoạt".',
        'NCCIH kết luận rằng các liệu trình detox không có bằng chứng thuyết phục về việc loại bỏ độc tố, và một số có thể gây hại.',
        'Quảng cáo thải độc thường không nêu tên chất độc cụ thể, nên tuyên bố không thể kiểm chứng được.',
        'Ngộ độc thật là một chẩn đoán y khoa cụ thể và cần điều trị y tế, không phải thực phẩm bổ sung.',
        'Thực phẩm bổ sung không được kiểm soát chặt như thuốc, nên thành phần thực tế có thể khác nhãn.',
      ],
    },
    { t: 'h2', text: 'Rủi ro thường bị bỏ qua' },
    {
      t: 'p',
      text: 'Tài liệu của MedlinePlus lưu ý rằng thực phẩm bổ sung không được quản lý chặt chẽ như thuốc, có thể tương tác với thuốc đang dùng, và không phải cứ "tự nhiên" là an toàn. Với một liệu trình thải độc kéo dài ngày, nguy cơ thực tế thường đến từ việc ăn uống quá hạn chế, mất nước và điện giải, hoặc bỏ qua một bệnh lý thật đang cần được chẩn đoán.',
      attribution: 'established',
      ref: 1,
    },
    {
      t: 'p',
      text: 'NCCIH cũng nêu rõ rằng một số sản phẩm và liệu trình thải độc từng bị phát hiện chứa thành phần không được công bố trên nhãn, hoặc đưa ra tuyên bố sai lệch về hiệu quả.',
      attribution: 'established',
      ref: 0,
    },
    { t: 'h2', text: 'Điều thực sự giúp gan và thận' },
    {
      t: 'p',
      text: 'Những việc có bằng chứng rõ ràng lại không hấp dẫn về mặt thương mại, vì không ai bán được chúng: hạn chế rượu, không tự ý dùng thuốc quá liều — đặc biệt là paracetamol, uống đủ nước, kiểm soát cân nặng và đường huyết, tiêm phòng viêm gan B, và đi khám khi có dấu hiệu bất thường. Đây là cách bảo vệ gan thận không cần đến bất kỳ liệu trình nào.',
      attribution: 'general',
    },
    {
      t: 'pull_quote',
      text: 'Khi một sản phẩm không nói rõ nó loại bỏ chất gì, thì cũng không có cách nào kiểm tra xem nó có làm được điều đó hay không.',
      kind: 'paraphrase',
    },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ],
};
