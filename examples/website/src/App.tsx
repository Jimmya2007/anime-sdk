import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Search from './pages/Search';
import Episodes from './pages/Episodes';
import Stream from './pages/Stream';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Search />} />
        <Route path="/episodes" element={<Episodes />} />
        <Route path="/stream" element={<Stream />} />
      </Route>
    </Routes>
  );
}
