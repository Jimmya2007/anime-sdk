import { Fragment } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

const LANGS = ['sub', 'dub', 'raw'] as const;

interface Crumb {
  label: string;
  href?: string;
}

function buildCrumbs(pathname: string, sp: URLSearchParams): Crumb[] {
  const provider = sp.get('provider');
  const title = sp.get('title');
  const ep = sp.get('ep');
  const lang = sp.get('lang') ?? 'sub';

  const crumbs: Crumb[] = [{ label: 'ANI-SDK', href: `/?lang=${lang}` }];

  if (provider) {
    const providerHref = `/?provider=${provider}&lang=${lang}`;
    crumbs.push(pathname === '/' ? { label: provider } : { label: provider, href: providerHref });
  }

  if (title) {
    const mid = sp.get('mid');
    const episodesHref = mid
      ? `/episodes?provider=${provider}&mid=${encodeURIComponent(mid)}&title=${encodeURIComponent(title)}&lang=${lang}`
      : undefined;
    crumbs.push(pathname === '/episodes' ? { label: title } : { label: title, href: episodesHref });
  }

  if (ep) crumbs.push({ label: ep });

  return crumbs;
}

export default function Layout() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const crumbs = buildCrumbs(loc.pathname, sp);
  const lang = sp.get('lang') ?? 'sub';

  function setLang(l: string) {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('lang', l);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-mono text-sm text-[#d0d0d0]">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between border-b border-[#1e1e1e] px-4 py-3">
          <div className="flex items-center gap-0">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="mx-2 text-[#2a2a2a] select-none">/</span>}
                {c.href ? (
                  <Link
                    to={c.href}
                    className="text-xs tracking-widest text-[#555] transition-colors hover:text-[#999]"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-xs tracking-widest text-[#ccc]">{c.label}</span>
                )}
              </Fragment>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            {LANGS.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`border px-2 py-0.5 text-xs tracking-widest transition-colors ${
                  lang === l
                    ? 'border-[#555] bg-[#111] text-white'
                    : 'border-transparent text-[#444] hover:text-[#888]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
