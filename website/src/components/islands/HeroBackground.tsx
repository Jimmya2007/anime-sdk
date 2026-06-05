import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import CodeEditorScene from './CodeEditorScene';
import ProviderDashboardScene from './ProviderDashboardScene';
import TerminalScene from './TerminalScene';

const SCENES = [CodeEditorScene, ProviderDashboardScene, TerminalScene];
const SCENE_PANS = [
  'heroBgPanXY 32s ease-in-out infinite',
  'heroBgPanX 28s ease-in-out infinite',
  'heroBgPanY 36s ease-in-out infinite',
];
const SCENE_DURATION = 7500;
const FADE_MS = 700;

export default function HeroBackground() {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(true);
  const [rotation, setRotation] = useState(-5);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const intervalId = setInterval(() => {
      setVisible(false);
      timeoutId = setTimeout(() => {
        setActive((a) => {
          const next = (a + 1) % SCENES.length;
          setRotation((r) => (next === 2 ? 0 : r === -5 ? 5 : -5));
          return next;
        });
        setVisible(true);
      }, FADE_MS);
    }, SCENE_DURATION);
    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, []);

  const Scene = SCENES[active];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          perspective: '900px',
          perspectiveOrigin: '50% 45%',
        }}
      >
        <motion.div
          style={{
            position: 'absolute',
            top: '6%',
            left: '9%',
            width: '82%',
            transformStyle: 'preserve-3d',
          }}
          animate={{ rotateY: rotation }}
          transition={{ duration: SCENE_DURATION / 1000, ease: 'linear' }}
        >
          <div style={{ transform: 'rotateX(42deg)', transformOrigin: '50% 0%' }}>
            <motion.div
              key={active}
              initial={{ opacity: 0 }}
              style={{ animation: SCENE_PANS[active] }}
              animate={{ opacity: visible ? 1 : 0 }}
              transition={{ duration: FADE_MS / 1000, ease: 'easeInOut' }}
            >
              <Scene />
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
