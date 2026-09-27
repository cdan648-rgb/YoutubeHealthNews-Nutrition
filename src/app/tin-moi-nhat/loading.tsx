/**
 * Loading skeleton for the paginated Latest News route.
 *
 * Mirrors the real layout's proportions so the page does not jump when content arrives —
 * the skeleton is a CLS tool, not just a spinner.
 *
 * Scoped to THIS route rather than the app root, and that placement is load-bearing. A
 * `loading.tsx` at the root wraps every page in a Suspense boundary, so the HTTP status
 * is committed before the page body resolves — which means a page that calls
 * `notFound()` streams the 404 markup with a **200** status. Crawlers would then treat
 * every non-existent article URL as a valid page. This route is dynamic and cannot 404,
 * so a boundary here is safe; the article and category routes deliberately have none.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-8 sm:px-6 sm:py-10" aria-busy="true">
      <span className="sr-only">Đang tải nội dung…</span>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:gap-8">
        <div className="bg-rule/50 aspect-video rounded-lg" />
        <div className="flex flex-col justify-center gap-3">
          <div className="bg-rule/50 h-3 w-24 rounded" />
          <div className="bg-rule/50 h-8 w-full rounded" />
          <div className="bg-rule/50 h-8 w-4/5 rounded" />
          <div className="bg-rule/50 h-4 w-full rounded" />
        </div>
      </div>
      <div className="mt-12 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index}>
            <div className="bg-rule/50 aspect-video rounded-lg" />
            <div className="bg-rule/50 mt-3 h-3 w-20 rounded" />
            <div className="bg-rule/50 mt-2 h-5 w-full rounded" />
            <div className="bg-rule/50 mt-2 h-4 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
