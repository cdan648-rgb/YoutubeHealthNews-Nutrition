/**
 * Publication identity and the independence disclosure.
 *
 * The disclosure text is a constant used by the header, the footer, every article
 * page and the About page, so the claim is made identically everywhere and cannot
 * drift. That matters more than usual here: the source channel's own video
 * descriptions state that its YouTube channel is the only official one, so any
 * ambiguity on our side would actively contradict the creator.
 *
 * `author` for structured data is always the publication, never the doctor.
 */

export const SITE = {
  name: 'Sức Khoẻ Giải Mã',
  shortName: 'SKGM',
  tagline: 'Bản tin độc lập về sức khoẻ và khoa học',
  description:
    'Bản tin độc lập tổng hợp và diễn giải nội dung công khai từ kênh YouTube Bác sĩ Trần Văn Phúc Official, kèm nguồn tham khảo từ các tổ chức y tế uy tín.',
  locale: 'vi-VN',
  /** Single source for canonical URLs. Overridden per environment. */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
} as const;

/** The source channel. Referenced, credited, never impersonated. */
export const SOURCE_CHANNEL = {
  title: 'Bác sĩ Trần Văn Phúc Official',
  handle: '@BacsiTranVanPhucOfficial',
  channelId: 'UC79E6KatRfXbmdWVWGncsew',
  url: 'https://www.youtube.com/@BacsiTranVanPhucOfficial',
  /** The creator's own website, linked from About so readers can go to the source. */
  officialSite: 'https://bacsytranvanphuc.com/',
} as const;

/**
 * The independence disclosure. Short form sits in the header strip; long form on
 * every article and the About page.
 */
export const INDEPENDENCE = {
  short: 'Trang tin độc lập — không liên kết với kênh nguồn',
  long: `${SITE.name} là một trang tin độc lập. Chúng tôi không thuộc, không liên kết, không được tài trợ và không được bảo trợ bởi Bác sĩ Trần Văn Phúc hoặc kênh YouTube ${SOURCE_CHANNEL.title}. Mọi nội dung tại đây do ban biên tập của chúng tôi tổng hợp từ thông tin công khai và chịu trách nhiệm hoàn toàn.`,
} as const;

/** Shown on every article. Health information is not personalised medical advice. */
export const MEDICAL_DISCLAIMER = {
  title: 'Thông tin mang tính giáo dục',
  body: 'Nội dung này nhằm mục đích thông tin và giáo dục, không thay thế cho việc thăm khám, chẩn đoán hoặc điều trị y tế. Với bất kỳ vấn đề sức khoẻ nào, quý vị hãy đến cơ sở y tế để được bác sĩ có chuyên môn tư vấn trực tiếp. Không tự ý dùng thuốc hoặc thực phẩm bổ sung dựa trên thông tin trên internet.',
} as const;

/** Route builders. Keeping them here stops a URL shape being retyped by hand. */
export const routes = {
  home: () => '/',
  latest: () => '/tin-moi-nhat',
  category: (slug: string) => `/chuyen-muc/${slug}`,
  article: (slug: string) => `/bai-viet/${slug}`,
  research: () => '/nghien-cuu',
  researchArticle: (slug: string) => `/nghien-cuu/${slug}`,
  factChecks: () => '/kiem-chung',
  about: () => '/ve-chung-toi',
  methodology: () => '/nguon-va-phuong-phap',
  disclaimer: () => '/mien-tru-trach-nhiem',
  privacy: () => '/chinh-sach-bao-mat',
  contact: () => '/lien-he',
  newsletter: () => '/newsletter',
  unsubscribe: () => '/huy-dang-ky',
  rss: () => '/rss.xml',
} as const;

/** Absolute URL for canonicals, Open Graph and feeds. */
export function absoluteUrl(path: string): string {
  return `${SITE.url}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * An article's canonical path.
 *
 * Research pieces live only under /nghien-cuu so a single article can never be
 * reachable at two URLs — duplicate content that would otherwise need a canonical tag
 * to paper over.
 */
export function articlePath(article: {
  slug: string;
  articleType: 'youtube' | 'research';
}): string {
  return article.articleType === 'research'
    ? routes.researchArticle(article.slug)
    : routes.article(article.slug);
}

/**
 * Footer links.
 *
 * Only routes that actually exist are listed. The editorial pages (About, Sources &
 * Methodology, disclaimer, privacy, contact) are built in the editorial-trust phase and
 * are added here in the same change, so the footer never advertises a 404.
 */
export const FOOTER_LINKS = [{ href: routes.rss(), label: 'RSS' }] as const;
