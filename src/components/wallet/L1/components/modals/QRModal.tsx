import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { motion } from "framer-motion";
import QRCodeStyling from "qr-code-styling";
import unicityLogo from "/images/unicity_logo.svg";

interface QRModalProps {
  show: boolean;
  address: string;
  onClose: () => void;
}

export function QRModal({ show, address, onClose }: QRModalProps) {
  const qrCodeRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (show && address && qrCodeRef.current) {
      qrCodeRef.current.innerHTML = "";

      const qrCode = new QRCodeStyling({
        width: 240,
        height: 240,
        data: address,
        margin: 0,
        qrOptions: {
          typeNumber: 0,
          mode: "Byte",
          errorCorrectionLevel: "M",
        },
        imageOptions: {
          hideBackgroundDots: true,
          imageSize: 0.2,
          margin: 3,
        },
        dotsOptions: {
          type: "rounded",
          color: "#ffffff",
        },
        backgroundOptions: {
          color: "#1a1a1a",
        },
        cornersSquareOptions: {
          type: "extra-rounded",
          color: "#ffffff",
        },
        cornersDotOptions: {
          type: "dot",
          color: "#ffffff",
        },
        image: unicityLogo,
      });

      qrCode.append(qrCodeRef.current);
    }
  }, [show, address]);

  if (!show) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 20 }}
        transition={{ type: "spring", duration: 0.5 }}
        className="relative w-full max-w-sm bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl p-8 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-6"
        >
          <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Receive ALPHA</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Scan QR code to receive payment
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, type: "spring" }}
          className="relative bg-neutral-900 p-8 rounded-2xl shadow-inner mb-6 flex items-center justify-center"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="absolute top-2 left-2 w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-lg"
          ></motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="absolute top-2 right-2 w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-lg"
          ></motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="absolute bottom-2 left-2 w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-lg"
          ></motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="absolute bottom-2 right-2 w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-lg"
          ></motion.div>

          <div ref={qrCodeRef} className="w-60 h-60"></div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-neutral-100 dark:bg-neutral-800/50 rounded-xl p-4 mb-6 border border-neutral-200 dark:border-neutral-700/50 backdrop-blur-sm"
        >
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 text-center">
            Your Address
          </p>
          <div className="flex items-center gap-2">
            <a
              href={`https://www.unicity.network/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-xs font-mono text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 break-all text-center transition-colors"
            >
              {address}
            </a>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`p-2 rounded-lg transition-all ${
                copied
                  ? "bg-green-600 hover:bg-green-500 shadow-lg shadow-green-500/20"
                  : "bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600"
              } text-neutral-800 dark:text-white`}
              title={copied ? "Copied!" : "Copy address"}
            >
              <motion.div
                initial={false}
                animate={{ rotate: copied ? [0, -10, 10, 0] : 0 }}
                transition={{ duration: 0.3 }}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-white" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </motion.div>
            </motion.button>
          </div>
        </motion.div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onClose}
          className="w-full px-4 py-3 rounded-xl bg-linear-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-semibold shadow-lg shadow-blue-500/20 transition-all"
        >
          Close
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
