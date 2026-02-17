import { useNavigate } from 'react-router-dom';
import { SplashScreen } from '../components/splash/SplashScreen';

export function IntroPage() {
  const navigate = useNavigate();

  return <SplashScreen onEnter={() => navigate('/home')} />;
}
