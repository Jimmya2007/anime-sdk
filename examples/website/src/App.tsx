import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Search from './pages/Search';
import Episodes from './pages/Episodes';
import Stream from './pages/Stream';

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Search />} />
          <Route path="/episodes" element={<Episodes />} />
          <Route path="/stream" element={<Stream />} />
        </Route>
      </Routes>
    </>
  );
}
