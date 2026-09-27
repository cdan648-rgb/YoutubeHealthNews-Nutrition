-- ============================================================================
-- Phase 1 / 0011 — seed the seven categories
-- ============================================================================
-- Derived from classifying 100 real video titles from the source channel; the
-- approximate share of the archive is noted per row. Idempotent: re-running
-- refreshes the editorial fields but never duplicates a slug and never disturbs a
-- category's id (articles reference it).
--
-- The channel's myth-busting strand is deliberately NOT an eighth category; it is
-- the articles.is_fact_check flag.

insert into public.categories
  (slug, name, description, icon_key, color_token, sort_order, seo_title, seo_description, keywords)
values
  -- ~35 of 100 titles: the largest cluster by far (vitamin B1-B12, D, magnesium,
  -- calcium, iron, zinc, silicon/boron, folic acid, micronutrient testing).
  ('vi-chat-vitamin',
   'Vi chất & Vitamin',
   'Vai trò của vitamin và khoáng chất trong cơ thể: từ nhóm vitamin B, vitamin D đến magie, canxi, sắt, kẽm và các nguyên tố vi lượng ít được biết đến.',
   'molecule', 'accent', 10,
   'Vi chất & Vitamin — kiến thức về vitamin và khoáng chất',
   'Tổng hợp kiến thức về vitamin, khoáng chất và vi chất thiết yếu: vai trò sinh học, dấu hiệu thiếu hụt và cách hiểu đúng các xét nghiệm.',
   array['vitamin','khoáng chất','vi chất','magie','canxi','sắt','kẽm','vitamin d','vitamin b12','folate','micronutrient','deficiency']),

  -- ~25 of 100: food and metabolism (eggs, rice, pork, cooking oils, intermittent
  -- fasting, the four-part weight-loss/Krebs series, macronutrient metabolism).
  ('dinh-duong-chuyen-hoa',
   'Dinh dưỡng & Chuyển hoá',
   'Thức ăn đi về đâu sau khi vào cơ thể: chuyển hoá carbohydrate, chất béo và protein, cùng những câu hỏi thực tế về thực phẩm hằng ngày.',
   'flame', 'accent', 20,
   'Dinh dưỡng & Chuyển hoá — hiểu đúng về thức ăn và cơ thể',
   'Cơ chế chuyển hoá carbohydrate, chất béo, protein và cách đánh giá các lựa chọn thực phẩm quen thuộc dựa trên bằng chứng.',
   array['dinh dưỡng','chuyển hoá','metabolism','nutrition','carbohydrate','chất béo','protein','đường','nhịn ăn gián đoạn','giảm cân','obesity','diet']),

  -- ~8 of 100: HGH, cortisol, estrogen, thyroid, how blood pressure is generated.
  ('noi-tiet-hormone',
   'Nội tiết & Hormone',
   'Hệ thống tín hiệu điều khiển cơ thể: hormone tăng trưởng, cortisol, estrogen, hormone tuyến giáp và cách chúng định hình sức khoẻ.',
   'wave', 'accent', 30,
   'Nội tiết & Hormone — hệ thống điều khiển của cơ thể',
   'Kiến thức về hormone và hệ nội tiết: hormone tăng trưởng, cortisol, estrogen, tuyến giáp và ảnh hưởng đến sức khoẻ toàn thân.',
   array['hormone','nội tiết','endocrine','cortisol','estrogen','tuyến giáp','thyroid','insulin','hgh','huyết áp']),

  -- ~8 of 100: cancer vaccines, adenovirus, influenza, immunity, the 2025 Nobel on
  -- peripheral immune tolerance, chronic inflammation.
  ('mien-dich-nhiem-trung-ung-thu',
   'Miễn dịch, Nhiễm trùng & Ung thư',
   'Cách hệ miễn dịch nhận diện và phản ứng: từ virus và vi khuẩn gây bệnh đến viêm mãn tính và những hướng điều trị ung thư đang được nghiên cứu.',
   'shield', 'accent', 40,
   'Miễn dịch, Nhiễm trùng & Ung thư — cơ chế phòng vệ của cơ thể',
   'Kiến thức về hệ miễn dịch, bệnh nhiễm trùng, viêm mãn tính và các hướng nghiên cứu trong ung thư học, dựa trên nguồn khoa học.',
   array['miễn dịch','immunology','nhiễm trùng','virus','vi khuẩn','ung thư','cancer','vắc xin','vaccine','viêm','inflammation','adenovirus','cúm']),

  -- ~11 of 100: GERD, stomach acid, gut health, gallstones, urinary stones, liver
  -- and cholestasis panels, albumin.
  ('tieu-hoa-gan-than',
   'Tiêu hoá, Gan & Thận',
   'Đường tiêu hoá và các cơ quan thanh lọc: dạ dày, ruột, gan, mật, thận và ý nghĩa thực sự của những xét nghiệm thường gặp.',
   'organ', 'accent', 50,
   'Tiêu hoá, Gan & Thận — hệ tiêu hoá và cơ quan thanh lọc',
   'Kiến thức về dạ dày, đường ruột, gan, túi mật và thận: cơ chế hoạt động, bệnh thường gặp và cách đọc hiểu xét nghiệm.',
   array['tiêu hoá','digestive','gan','liver','thận','kidney','dạ dày','trào ngược','gerd','sỏi mật','sỏi tiết niệu','microbiome','đường ruột']),

  -- ~7 of 100: meniscus, knee effusion, gout, exercise as a double-edged sword.
  ('co-xuong-khop-van-dong',
   'Cơ xương khớp & Vận động',
   'Bộ máy vận động dưới góc nhìn cơ học và sinh học: khớp, sụn, gân, cơ, bệnh gút và cách tập luyện không gây tổn thương.',
   'joint', 'accent', 60,
   'Cơ xương khớp & Vận động — khớp, cơ và tập luyện an toàn',
   'Kiến thức về khớp, sụn, cơ và xương: nguyên nhân đau, ý nghĩa của hình ảnh chẩn đoán và nguyên tắc vận động an toàn.',
   array['khớp','xương','cơ','sụn','sụn chêm','gút','gout','arthritis','tập luyện','exercise','vận động','mri','khớp gối']),

  -- ~12 of 100: 4-7-8 breathing, delta/theta brainwaves, meditation, magnesium and
  -- vitamin D for the brain, the screening-test series, microplastics.
  ('phong-ngua-tam-than',
   'Phòng ngừa & Tâm–Thân',
   'Những can thiệp không cần thuốc: hơi thở, giấc ngủ, thiền định, kiểm tra sức khoẻ định kỳ và mối liên hệ giữa não bộ và cơ thể.',
   'breath', 'accent', 70,
   'Phòng ngừa & Tâm–Thân — hơi thở, giấc ngủ và sức khoẻ não bộ',
   'Kiến thức về phòng ngừa chủ động: kỹ thuật thở, giấc ngủ, thiền định, sóng não, khám sức khoẻ định kỳ và sức khoẻ não bộ.',
   array['phòng ngừa','prevention','hơi thở','breathing','giấc ngủ','sleep','thiền','meditation','sóng não','não bộ','brain','khám sức khoẻ','screening','vi nhựa','microplastics'])
on conflict (slug) do update set
  name            = excluded.name,
  description     = excluded.description,
  icon_key        = excluded.icon_key,
  color_token     = excluded.color_token,
  sort_order      = excluded.sort_order,
  seo_title       = excluded.seo_title,
  seo_description = excluded.seo_description,
  keywords        = excluded.keywords;
