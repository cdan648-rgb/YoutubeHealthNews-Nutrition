import type { SeedArticle } from './types';

/**
 * Seed 4 — the clinically delicate one.
 *
 * Source: Số 126, "Sự thật về tổn thương sụn chêm khớp gối: đừng vội mổ khi chưa biết
 * những điều này!" (nfNvuW2lQkI).
 *
 * The source description carries an explicit four-point outline, which is why this video
 * was chosen: it is the best test of turning a structured description into structured
 * headings. It is also the sharpest test of the no-treatment-advice rule, because the
 * video's own framing ("đừng vội mổ") is advice. The article reports that framing as the
 * speaker's position and puts the decision back where it belongs, rather than repeating
 * it as a recommendation in our own voice.
 */
export const tonThuongSunChem: SeedArticle = {
  slug: 'ton-thuong-sun-chem-khop-goi-hieu-dung-truoc-khi-quyet-dinh',
  title: 'Tổn thương sụn chêm khớp gối: hiểu đúng tấm phim MRI trước khi quyết định',
  dek: 'Dòng chữ “rách sụn chêm” trên phim MRI khiến nhiều người nghĩ ngay tới phẫu thuật. Nhưng hình ảnh và triệu chứng không phải lúc nào cũng đi cùng nhau. Tổng hợp từ số 126 của kênh Bác sĩ Trần Văn Phúc Official.',
  categorySlug: 'co-xuong-khop-van-dong',
  isFactCheck: false,
  videoId: 'nfNvuW2lQkI',
  publishedDateHanoi: '2026-09-23',
  seo: {
    metaTitle: 'Rách sụn chêm trên MRI: vì sao hình ảnh không tự quyết định điều trị',
    metaDescription:
      'Sụn chêm là gì, vì sao dễ tổn thương, phân biệt hao mòn với rách, và vì sao kết quả MRI cần được đọc cùng triệu chứng. Nguồn: MedlinePlus và số 126 kênh Bác sĩ Trần Văn Phúc Official.',
  },
  references: [
    {
      label: '1',
      title: 'Knee Injuries and Disorders',
      publisher: 'MedlinePlus, Thư viện Y khoa Quốc gia Hoa Kỳ',
      url: 'https://medlineplus.gov/kneeinjuriesanddisorders.html',
    },
    {
      label: '2',
      title: 'Sports Injuries',
      publisher: 'MedlinePlus, Thư viện Y khoa Quốc gia Hoa Kỳ',
      url: 'https://medlineplus.gov/sportsinjuries.html',
    },
  ],
  body: [
    { t: 'source_note' },
    {
      t: 'p',
      text: 'Rất nhiều người lần đầu nghe tới sụn chêm là khi đọc kết quả chụp MRI khớp gối. Dòng chữ "rách sụn chêm" trên tờ kết quả thường tạo ra phản ứng tức thì: vậy là phải mổ. Nhưng mối quan hệ giữa một hình ảnh trên phim và một quyết định điều trị phức tạp hơn thế, và hiểu được chỗ phức tạp đó giúp người bệnh đặt câu hỏi đúng với bác sĩ của mình.',
      attribution: 'general',
    },
    { t: 'h2', text: 'Sụn chêm là gì và vì sao nó quan trọng' },
    {
      t: 'p',
      text: 'Trong khớp gối có hai miếng sụn hình bán nguyệt nằm giữa xương đùi và xương chày, gọi là sụn chêm. Chúng làm ba việc cùng lúc: phân bố lực nén lên diện rộng thay vì dồn vào một điểm, tăng độ ổn định của khớp, và giúp bôi trơn bề mặt khớp. Nói cách khác, sụn chêm biến một khớp bản lề chịu tải kém thành một khớp chịu được trọng lượng cơ thể trong hàng chục năm.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Số 126 gọi sụn chêm là một chi tiết nhỏ bé nhưng gánh vác sứ mệnh phi thường, và phân tích nó dưới cả góc nhìn cấu tạo sinh học lẫn góc nhìn vật lý về cách lực tác động lên khớp gối.',
      attribution: 'speaker',
    },
    {
      t: 'figure_svg',
      motif: 'joint',
      caption:
        'Sụn chêm nằm giữa hai đầu xương, phân bố lực nén trên diện rộng thay vì dồn vào một điểm tiếp xúc.',
      alt: 'Hình minh hoạ hai cung tròn đối diện nhau với khoảng đệm ở giữa, tượng trưng cho cấu trúc khớp.',
    },
    { t: 'h2', text: 'Phân biệt hao mòn theo tuổi và rách do chấn thương' },
    {
      t: 'p',
      text: 'Đây là điểm mấu chốt thường bị bỏ qua. Sụn chêm thay đổi theo tuổi giống như mọi tổ chức khác trong cơ thể: bề mặt mòn dần, cấu trúc bên trong kém đàn hồi hơn. Những thay đổi này rất phổ biến ở người trung niên và cao tuổi, và trên phim MRI chúng có thể được mô tả bằng những từ nghe rất đáng lo.',
      attribution: 'general',
    },
    {
      t: 'p',
      text: 'Khác với đó là rách cấp tính do một chấn thương xác định — thường là động tác xoay người khi bàn chân đang tì xuống đất, hoặc khi gập gối sâu rồi đứng lên đột ngột. Trường hợp này thường có mốc thời gian rõ ràng: trước tai nạn khớp gối bình thường, sau tai nạn thì không.',
      attribution: 'general',
    },
    {
      t: 'callout',
      tone: 'info',
      title: 'Vì sao hình ảnh và triệu chứng không luôn đi cùng nhau',
      text: 'Một tổn thương nhìn thấy trên phim có thể hoàn toàn không gây triệu chứng, và ngược lại một khớp gối đau nhiều có thể chỉ có thay đổi nhẹ trên hình ảnh. Đó là lý do bác sĩ cần thăm khám trực tiếp: hỏi bệnh sử, kiểm tra tầm vận động, làm các nghiệm pháp lâm sàng, rồi mới đặt phim MRI vào bức tranh đó.',
    },
    { t: 'h2', text: 'Khả năng tự lành phụ thuộc vào vị trí' },
    {
      t: 'p',
      text: 'Sụn chêm không được cấp máu đồng đều. Phần ngoại vi, gần bao khớp, có mạch máu nuôi; phần trung tâm thì gần như không. Vì quá trình lành thương cần máu mang tới tế bào và dưỡng chất, một tổn thương ở vùng ngoại vi có tiềm năng tự lành hoặc khâu phục hồi được, trong khi tổn thương ở vùng trung tâm thì khó hơn nhiều. Bản đồ mạch máu này là một trong những yếu tố bác sĩ cân nhắc khi bàn về hướng xử lý.',
      attribution: 'general',
    },
    {
      t: 'key_facts',
      title: 'Những điểm chính',
      items: [
        'Sụn chêm phân bố lực nén, tăng ổn định khớp và giúp bôi trơn bề mặt khớp gối.',
        'Thay đổi do hao mòn theo tuổi rất phổ biến và khác với rách cấp tính do chấn thương.',
        'Một tổn thương thấy trên MRI có thể không gây triệu chứng, và ngược lại.',
        'Khả năng lành phụ thuộc vị trí tổn thương, vì sụn chêm không được cấp máu đồng đều.',
        'Quyết định điều trị dựa trên thăm khám trực tiếp, không chỉ dựa trên tờ kết quả hình ảnh.',
      ],
    },
    { t: 'h2', text: 'Những dấu hiệu cần được khám sớm' },
    {
      t: 'p',
      text: 'Theo tài liệu của MedlinePlus về chấn thương và bệnh lý khớp gối, cần được đánh giá y tế khi khớp gối sưng nhiều, đau dữ dội, không thể chịu được trọng lượng cơ thể, khớp bị kẹt không thể gập hoặc duỗi hết, hoặc có cảm giác khớp mất vững khi đi lại.',
      attribution: 'established',
      ref: 0,
    },
    {
      t: 'p',
      text: 'Tài liệu về chấn thương thể thao cũng nhấn mạnh vai trò của việc khởi động trước khi vận động và tăng cường độ tập luyện một cách từ từ, thay vì tăng đột ngột — nguyên tắc dự phòng áp dụng cho khớp gối nói chung.',
      attribution: 'established',
      ref: 1,
    },
    { t: 'h2', text: 'Ai quyết định, và dựa trên điều gì' },
    {
      t: 'p',
      text: 'Số 126 nêu quan điểm rằng nên điều trị cho con người bệnh nhân chứ đừng điều trị cho một tấm phim, và đặt câu hỏi khi nào thực sự cần phẫu thuật. Đây là quan điểm được trình bày trong video.',
      attribution: 'speaker',
    },
    {
      t: 'callout',
      tone: 'caution',
      title: 'Bài viết này không thay thế ý kiến của bác sĩ điều trị',
      text: 'Mục đích của bài là giúp quý vị hiểu các yếu tố đang được cân nhắc, để có thể trao đổi kỹ hơn với bác sĩ — chứ không phải để tự kết luận có nên mổ hay không. Quyết định đó phụ thuộc vào tuổi, mức vận động, vị trí và kiểu tổn thương, các bệnh kèm theo và cả mục tiêu của chính người bệnh. Không ai có thể đưa ra quyết định đó mà không thăm khám trực tiếp.',
    },
    {
      t: 'pull_quote',
      text: 'Tấm phim MRI là một dữ kiện trong chẩn đoán, không phải bản án và cũng không phải chỉ định điều trị.',
      kind: 'paraphrase',
    },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ],
};
