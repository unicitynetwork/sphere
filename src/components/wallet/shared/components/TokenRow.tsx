import { motion } from 'framer-motion';
import { Token } from '../../L3/data/model';
import { Box, Copy, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

interface TokenRowProps {
  token: Token;
  delay: number;
}

export function TokenRow({ token, delay }: TokenRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(token.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: delay }}
      className="p-3 rounded-xl bg-neutral-800/30 border border-white/5 hover:border-white/10 transition-all group"
    >
      <div className="flex items-center justify-between">

        {/* Left: Icon & Info */}
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-lg  flex items-center justify-center overflow-hidden">
            {token.iconUrl ? (
              <img src={token.iconUrl} alt={token.symbol} className="w-full h-full object-cover" />
            ) : (
              <Box className="w-5 h-5 text-neutral-500" />
            )}
          </div>

          <div>
            <div className="text-white font-medium text-sm">
              {token.symbol}
            </div>
            <div
              className="flex items-center gap-1 text-[10px] text-neutral-500 font-mono cursor-pointer hover:text-orange-400 transition-colors"
              onClick={handleCopyId}
            >
              <span>ID: {token.id.slice(0, 8)}...</span>
              {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
            </div>
          </div>
        </div>

        {/* Right: UTXO Badge */}
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-neutral-700/50 text-neutral-400 border border-neutral-700">
            Token
          </span>
          <span className="text-[10px] text-neutral-600">
            {new Date(token.timestamp).toLocaleDateString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}