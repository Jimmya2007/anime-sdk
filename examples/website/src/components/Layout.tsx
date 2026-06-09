import { Fragment } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';

interface Crumb {
  label: string;
  href?: string;
}

function buildCrumbs(pathname: string, sp: URLSearchParams): Crumb[] {
  const provider = sp.get('provider');
  const title = sp.get('title');
  const ep = sp.get('ep');
  const type = sp.get('type');

  const crumbs: Crumb[] = [{ label: 'ANI-SDK', href: `/` }];

  if (provider) {
    const providerHref = `/?provider=${provider}`;
    crumbs.push(pathname === '/' ? { label: provider } : { label: provider, href: providerHref });
  }

  if (title) {
    const mid = sp.get('mid');
    const episodesHref = mid
      ? `/episodes?provider=${provider}&mid=${encodeURIComponent(mid)}&title=${encodeURIComponent(title)}${type ? `&type=${type}` : ''}`
      : undefined;
    crumbs.push(pathname === '/episodes' ? { label: title } : { label: title, href: episodesHref });
  }

  if (ep) crumbs.push({ label: ep });

  return crumbs;
}

export default function Layout() {
  const loc = useLocation();
  const [sp] = useSearchParams();
  const crumbs = buildCrumbs(loc.pathname, sp);

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-mono text-sm text-[#d0d0d0]">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-3 border-b border-[#1e1e1e] px-4 py-3">
          <img src="/ani-sdk.svg" width="16" height="16" alt="ani-sdk logo" />
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
        </header>
        <Outlet />
      </div>
    </div>
  );
}
