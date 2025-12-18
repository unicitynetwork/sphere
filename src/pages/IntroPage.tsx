import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SplashScreen } from '../components/splash/SplashScreen';
import { WelcomeModal } from '../components/splash/WelcomeModal';

const WELCOME_ACCEPTED_KEY = 'sphere_welcome_accepted';

export function IntroPage() {
  const navigate = useNavigate();
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [hasAcceptedWelcome, setHasAcceptedWelcome] = useState<boolean | null>(null);

  useEffect(() => {
    const accepted = localStorage.getItem(WELCOME_ACCEPTED_KEY) === 'true';
    setHasAcceptedWelcome(accepted);
  }, []);

  const handleSplashEnter = () => {
    if (hasAcceptedWelcome) {
      navigate('/home');
    } else {
      setShowWelcomeModal(true);
    }
  };

  const handleWelcomeAccept = () => {
    localStorage.setItem(WELCOME_ACCEPTED_KEY, 'true');
    setShowWelcomeModal(false);
    navigate('/home');
  };

  // Wait for localStorage check before rendering
  if (hasAcceptedWelcome === null) {
    return null;
  }

  return (
    <>
      <SplashScreen onEnter={handleSplashEnter} />
      <WelcomeModal show={showWelcomeModal} onAccept={handleWelcomeAccept} />
    </>
  );
}