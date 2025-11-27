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
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20 p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="bg-linear-to-br from-neutral-900 to-neutral-800 p-8 rounded-2xl shadow-2xl border border-neutral-700 max-w-sm w-full"
      >
        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-white mb-2">Receive ALPHA</h3>
          <p className="text-sm text-neutral-400">
            Scan QR code to receive payment
          </p>
        </div>

        <div className="relative bg-neutral-900 p-8 rounded-2xl shadow-inner mb-6 flex items-center justify-center">
          <div className="absolute top-2 left-2 w-6 h-6 border-t-4 border-l-4 border-orange-500 rounded-tl-lg"></div>
          <div className="absolute top-2 right-2 w-6 h-6 border-t-4 border-r-4 border-orange-500 rounded-tr-lg"></div>
          <div className="absolute bottom-2 left-2 w-6 h-6 border-b-4 border-l-4 border-orange-500 rounded-bl-lg"></div>
          <div className="absolute bottom-2 right-2 w-6 h-6 border-b-4 border-r-4 border-orange-500 rounded-br-lg"></div>

          <div ref={qrCodeRef} className="w-60 h-60"></div>
        </div>

        <div className="bg-neutral-800/50 rounded-xl p-4 mb-6 border border-neutral-700">
          <p className="text-xs text-neutral-400 mb-2 text-center">
            Your Address
          </p>
          <div className="flex items-center gap-2">
            <a
              href={`https://www.unicity.network/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-xs font-mono text-blue-400 hover:text-blue-300 break-all text-center transition-colors"
            >
              {address}
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`p-2 rounded-lg transition-colors ${
                copied
                  ? "bg-green-600 hover:bg-green-500"
                  : "bg-neutral-700 hover:bg-neutral-600"
              } text-white`}
              title={copied ? "Copied!" : "Copy address"}
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={onClose}
          className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-500/20 transition-colors"
        >
          Close
        </motion.button>
      </motion.div>
    </div>
  );
}
