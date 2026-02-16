import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Sparkles, Receipt, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useIdentity } from '../../../../sdk';
import { FaucetService } from '../../../../services/FaucetService';
import { showToast } from '../../../ui/toast-utils';
import { BaseModal, ModalHeader, Button } from '../../ui';
import { SendPaymentRequestModal } from './SendPaymentRequestModal';

type TopUpTab = 'faucet' | 'request';

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TopUpModal({ isOpen, onClose }: TopUpModalProps) {
  const { nametag } = useIdentity();

  const [activeTab, setActiveTab] = useState<TopUpTab>('faucet');
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [isPaymentRequestOpen, setIsPaymentRequestOpen] = useState(false);

  const handleFaucetRequest = async () => {
    if (!nametag) return;

    setIsFaucetLoading(true);
    setFaucetError(null);
    setFaucetSuccess(false);

    try {
      const results = await FaucetService.requestAllCoins(nametag);
      const failedRequests = results.filter(r => !r.success);

      if (failedRequests.length > 0) {
        const failedCoins = failedRequests.map(r => r.coin).join(', ');
        setFaucetError(`Failed to request: ${failedCoins}`);
      } else {
        setFaucetSuccess(true);
        setTimeout(() => setFaucetSuccess(false), 3000);
      }
    } catch (error) {
      setFaucetError(error instanceof Error ? error.message : 'Failed to request tokens');
    } finally {
      setIsFaucetLoading(false);
    }
  };

  const handleClose = () => {
    setFaucetError(null);
    setFaucetSuccess(false);
    onClose();
  };

  const handlePaymentRequestClose = (result?: { success: boolean; requestId?: string }) => {
    setIsPaymentRequestOpen(false);
    if (result?.success) {
      showToast('Payment request sent!', 'success', 3000);
      handleClose();
    }
  };

  return (
    <>
      <BaseModal isOpen={isOpen} onClose={handleClose} showOrbs={false}>
        <ModalHeader title="Top Up" icon={Plus} onClose={handleClose} />

        {/* Tab Switcher */}
        <div className="px-6 mb-4">
          <div className="flex p-1 bg-neutral-100 dark:bg-neutral-900/50 rounded-xl border border-neutral-200 dark:border-neutral-800">
            <button
              onClick={() => setActiveTab('faucet')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all relative ${activeTab === 'faucet' ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-400'}`}
            >
              {activeTab === 'faucet' && (
                <motion.div
                  layoutId="topUpTab"
                  className="absolute inset-0 bg-white dark:bg-neutral-800 rounded-lg shadow-sm"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Sparkles className="w-3 h-3" /> Faucet
              </span>
            </button>
            <button
              onClick={() => setActiveTab('request')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all relative ${activeTab === 'request' ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-400'}`}
            >
              {activeTab === 'request' && (
                <motion.div
                  layoutId="topUpTab"
                  className="absolute inset-0 bg-white dark:bg-neutral-800 rounded-lg shadow-sm"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Receipt className="w-3 h-3" /> Payment Request
              </span>
            </button>
          </div>
        </div>

        <div className="px-6 py-3 flex-1 flex flex-col">
          <AnimatePresence mode="wait">

            {/* FAUCET TAB */}
            {activeTab === 'faucet' && (
              <motion.div
                key="faucet"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex flex-col items-center text-center py-4"
              >
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
                  Request test tokens from the Unicity faucet
                </p>

                {!nametag ? (
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    Nametag is required to request tokens
                  </p>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      onClick={handleFaucetRequest}
                      disabled={isFaucetLoading}
                      loading={isFaucetLoading}
                      loadingText="Requesting..."
                      fullWidth
                    >
                      {faucetSuccess ? (
                        <span className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" /> Success!
                        </span>
                      ) : (
                        'Request All Coins'
                      )}
                    </Button>

                    <AnimatePresence>
                      {faucetError && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="mt-4 w-full flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl"
                        >
                          <XCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-red-600 dark:text-red-400">{faucetError}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </motion.div>
            )}

            {/* PAYMENT REQUEST TAB */}
            {activeTab === 'request' && (
              <motion.div
                key="request"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex flex-col items-center text-center py-4"
              >
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
                  Send a payment request to someone
                </p>

                <Button
                  variant="primary"
                  onClick={() => setIsPaymentRequestOpen(true)}
                  fullWidth
                >
                  Create Payment Request
                </Button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </BaseModal>

      <SendPaymentRequestModal
        isOpen={isPaymentRequestOpen}
        onClose={handlePaymentRequestClose}
      />
    </>
  );
}
