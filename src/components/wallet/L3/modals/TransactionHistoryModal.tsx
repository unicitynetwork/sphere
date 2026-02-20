import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownLeft, Loader2, Clock, ChevronDown, Copy, Check } from 'lucide-react';
import { useTransactionHistory } from '../../../../sdk';
import { TokenRegistry } from '@unicitylabs/sphere-sdk';
import { useMemo, useState, useCallback } from 'react';
import { BaseModal, ModalHeader, EmptyState } from '../../ui';

const registry = TokenRegistry.getInstance();

interface TransactionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Copy text to clipboard, return true on success */
function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Ignore
    }
  }, []);

  return { copiedKey, copy };
}

/** Truncate middle of string: "DIRECT://abc...xyz" */
function truncateMiddle(str: string, startLen = 14, endLen = 6): string {
  if (str.length <= startLen + endLen + 3) return str;
  return `${str.slice(0, startLen)}...${str.slice(-endLen)}`;
}

/** Single detail row with copy button */
function DetailRow({ label, value, copyKey, copiedKey, onCopy }: {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[11px] text-neutral-700 dark:text-neutral-300 font-mono truncate">
          {truncateMiddle(value)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(value, copyKey); }}
          className="shrink-0 p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
          title="Copy"
        >
          {copiedKey === copyKey
            ? <Check className="w-3 h-3 text-emerald-500" />
            : <Copy className="w-3 h-3 text-neutral-400" />
          }
        </button>
      </div>
    </div>
  );
}

export function TransactionHistoryModal({ isOpen, onClose }: TransactionHistoryModalProps) {
  const { history, isLoading } = useTransactionHistory();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copiedKey, copy } = useCopyToClipboard();

  const formattedHistory = useMemo(() => {
    return history.map(entry => {
      const def = registry.getDefinition(entry.coinId);
      const decimals = def?.decimals || 0;

      // Convert amount from smallest unit to human readable
      const amountBigInt = BigInt(entry.amount);
      const divisor = BigInt(10 ** decimals);
      const integerPart = amountBigInt / divisor;
      const fractionalPart = amountBigInt % divisor;

      // Format the fractional part with leading zeros
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      const formattedAmount = decimals > 0
        ? `${integerPart}.${fractionalStr}`.replace(/\.?0+$/, '')
        : integerPart.toString();

      return {
        ...entry,
        formattedAmount,
        iconUrl: def ? registry.getIconUrl(entry.coinId) : null,
        date: new Date(entry.timestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        time: new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    });
  }, [history]);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose}>
      <ModalHeader title="Transaction History" icon={Clock} onClose={onClose} />

      {/* Content - Scrollable */}
      <div className="relative flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 z-10 min-h-0 bg-transparent">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={ArrowUpRight}
            title="No Transactions"
            description="Your transaction history will appear here"
          />
        ) : (
          <div className="space-y-2">
            {formattedHistory.map((entry, index) => {
              const isExpanded = expandedId === entry.id;
              const peerLabel = entry.type === 'RECEIVED'
                ? (entry.senderNametag ? `@${entry.senderNametag}` : entry.senderAddress ? truncateMiddle(entry.senderAddress) : entry.senderPubkey ? `${entry.senderPubkey.slice(0, 4)}...${entry.senderPubkey.slice(-4)}` : null)
                : (entry.recipientNametag ? `@${entry.recipientNametag}` : entry.recipientAddress ? truncateMiddle(entry.recipientAddress) : null);

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  onClick={() => toggleExpand(entry.id)}
                >
                  {/* Main row */}
                  <div className="flex items-center gap-3 p-4">
                    {/* Icon with badge */}
                    <div className="relative shrink-0">
                      {entry.iconUrl ? (
                        <img src={entry.iconUrl} className="w-10 h-10 rounded-full" alt="" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
                          <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                            {entry.symbol.slice(0, 2)}
                          </span>
                        </div>
                      )}
                      <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-neutral-50 dark:border-neutral-800 ${
                        entry.type === 'RECEIVED'
                          ? 'bg-emerald-500'
                          : 'bg-orange-500'
                      }`}>
                        {entry.type === 'RECEIVED' ? (
                          <ArrowDownLeft className="w-3 h-3 text-white" />
                        ) : (
                          <ArrowUpRight className="w-3 h-3 text-white" />
                        )}
                      </div>
                    </div>

                    {/* Title & Subtitle */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-neutral-900 dark:text-white">
                        {entry.type === 'RECEIVED' ? 'Received' : 'Sent'}
                        {peerLabel && (
                          <span className="text-neutral-500 dark:text-neutral-400 font-normal ml-1">
                            {entry.type === 'RECEIVED' ? 'from' : 'to'} {peerLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-400/70 dark:text-neutral-500/60">
                        {entry.date} • {entry.time}
                      </div>
                      {entry.memo && (
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 italic truncate mt-0.5">
                          &ldquo;{entry.memo}&rdquo;
                        </div>
                      )}
                    </div>

                    {/* Amount + chevron */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className={`text-sm font-semibold ${
                        entry.type === 'RECEIVED'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-neutral-900 dark:text-white'
                      }`}>
                        {entry.type === 'RECEIVED' ? '+' : '-'}{entry.formattedAmount} {entry.symbol}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {/* Expandable detail panel */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-3 pt-0 border-t border-neutral-200/50 dark:border-neutral-700/30">
                          <div className="pt-2 space-y-0.5">
                            {/* Peer info */}
                            {entry.type === 'RECEIVED' && (
                              <>
                                {entry.senderNametag && (
                                  <DetailRow label="Sender" value={`@${entry.senderNametag}`} copyKey={`${entry.id}-nametag`} copiedKey={copiedKey} onCopy={copy} />
                                )}
                                {entry.senderAddress && (
                                  <DetailRow label="L3 Address" value={entry.senderAddress} copyKey={`${entry.id}-addr`} copiedKey={copiedKey} onCopy={copy} />
                                )}
                                {entry.senderPubkey && (
                                  <DetailRow label="Pubkey" value={entry.senderPubkey} copyKey={`${entry.id}-pubkey`} copiedKey={copiedKey} onCopy={copy} />
                                )}
                              </>
                            )}
                            {entry.type === 'SENT' && (
                              <>
                                {entry.recipientNametag && (
                                  <DetailRow label="Recipient" value={`@${entry.recipientNametag}`} copyKey={`${entry.id}-nametag`} copiedKey={copiedKey} onCopy={copy} />
                                )}
                                {entry.recipientAddress && (
                                  <DetailRow label="L3 Address" value={entry.recipientAddress} copyKey={`${entry.id}-addr`} copiedKey={copiedKey} onCopy={copy} />
                                )}
                                {entry.recipientPubkey && (
                                  <DetailRow label="Pubkey" value={entry.recipientPubkey} copyKey={`${entry.id}-pubkey`} copiedKey={copiedKey} onCopy={copy} />
                                )}
                              </>
                            )}

                            {/* Memo */}
                            {entry.memo && (
                              <div className="py-1">
                                <span className="text-[11px] text-neutral-500 dark:text-neutral-400">Memo</span>
                                <div className="text-[11px] text-neutral-700 dark:text-neutral-300 italic mt-0.5">
                                  &ldquo;{entry.memo}&rdquo;
                                </div>
                              </div>
                            )}

                            {/* Common fields */}
                            {entry.tokenId && (
                              <DetailRow label="Token ID" value={entry.tokenId} copyKey={`${entry.id}-tokenid`} copiedKey={copiedKey} onCopy={copy} />
                            )}
                            {entry.transferId && (
                              <DetailRow label="Transfer ID" value={entry.transferId} copyKey={`${entry.id}-txid`} copiedKey={copiedKey} onCopy={copy} />
                            )}
                            <div className="flex items-center justify-between py-1">
                              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">Amount (raw)</span>
                              <span className="text-[11px] text-neutral-700 dark:text-neutral-300 font-mono">{entry.amount}</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
