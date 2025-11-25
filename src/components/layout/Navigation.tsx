import { NavLink } from 'react-router-dom';
import { MessageSquare, Sparkles } from 'lucide-react';

export function Navigation() {
  const baseClass = "px-6 py-3 rounded-xl flex items-center gap-3 transition-all border border-transparent";
  const activeClass = "bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20";
  const inactiveClass = "bg-neutral-800/50 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300 border-neutral-800";

  return (
    <div className="mb-8 flex gap-4">
      <NavLink 
        to="/home" 
        className={({ isActive }) => `${baseClass} ${isActive ? activeClass : inactiveClass}`}
      >
        <MessageSquare className="w-5 h-5" />
        <span>Main Dashboard</span>
      </NavLink>
      
      <NavLink 
        to="/ai" 
        className={({ isActive }) => `${baseClass} ${isActive ? activeClass : inactiveClass}`}
      >
        <Sparkles className="w-5 h-5" />
        <span>AI Assistant</span>
      </NavLink>
    </div>
  );
}