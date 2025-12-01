import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeftRight,
  X,
  AlertTriangle,
  CheckCircle,
  Info,
  Loader2,
} from "lucide-react";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";

const ec = new elliptic.ec("secp256k1");

const L3_PROXY_URL = "https://alpha-migri.dyndns.org";
const MESSAGE_PREFIX = "Alpha Signed Message:\n";

interface BridgeModalProps {
  show: boolean;
  address: string;
  privateKey: string;
  onClose: () => void;
  onSuccess?: (txId: string, amount: number) => void;
}

interface BalanceInfo {
  success: boolean;
  amount: number;
  amountInSmallUnits: number;
  spent: boolean;
  inSnapshot: boolean;
  unicityId: string | null;
  mintedAt: string | null;
}

type BridgeStatus =
  | "idle"
  | "checking"
  | "available"
  | "not_eligible"
  | "already_minted"
  | "signing"
  | "minting"
  | "success"
  | "error";

function varintBuf(n: number): Uint8Array {
  if (n < 253) return new Uint8Array([n]);
  if (n < 0x10000) {
    const buf = new Uint8Array(3);
    buf[0] = 253;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  throw new Error("Message too long");
}

function createMessageHash(message: string): string {
  const prefixBytes = new TextEncoder().encode(MESSAGE_PREFIX);
  const messageBytes = new TextEncoder().encode(message);

  const prefixLen = varintBuf(prefixBytes.length);
  const messageLen = varintBuf(messageBytes.length);

  // Concatenate: prefixLen + prefix + messageLen + message
  const fullMessage = new Uint8Array(
    prefixLen.length +
      prefixBytes.length +
      messageLen.length +
      messageBytes.length
  );

  let offset = 0;
  fullMessage.set(prefixLen, offset);
  offset += prefixLen.length;
  fullMessage.set(prefixBytes, offset);
  offset += prefixBytes.length;
  fullMessage.set(messageLen, offset);
  offset += messageLen.length;
  fullMessage.set(messageBytes, offset);

  // Convert to hex for CryptoJS
  const fullMessageHex = Array.from(fullMessage)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Double SHA256
  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(fullMessageHex)).toString();
  const hash2 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hash1)).toString();

  return hash2;
}

function signMessage(privateKeyHex: string, message: string): string {
  const keyPair = ec.keyFromPrivate(privateKeyHex, "hex");
  const messageHash = createMessageHash(message);
  const messageHashBytes = Buffer.from(messageHash, "hex");

  // Sign with canonical (low-S) signature
  const signature = keyPair.sign(messageHashBytes, { canonical: true });

  // Find recovery parameter
  const pubKey = keyPair.getPublic();
  let recoveryParam = -1;

  for (let i = 0; i < 4; i++) {
    try {
      const recovered = ec.recoverPubKey(messageHashBytes, signature, i);
      if (recovered.eq(pubKey)) {
        recoveryParam = i;
        break;
      }
    } catch {
      continue;
    }
  }

  if (recoveryParam === -1) {
    throw new Error("Could not find recovery parameter");
  }

  // Format: v (1 byte) + r (32 bytes) + s (32 bytes)
  const v = 31 + recoveryParam; // Compressed key indicator
  const r = signature.r.toString("hex").padStart(64, "0");
  const s = signature.s.toString("hex").padStart(64, "0");

  return v.toString(16).padStart(2, "0") + r + s;
}

export function BridgeModal({
  show,
  address,
  privateKey,
  onClose,
  onSuccess,
}: BridgeModalProps) {
  const [unicityId, setUnicityId] = useState("");
  const [status, setStatus] = useState<BridgeStatus>("idle");
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);

  // Check balance when modal opens
  useEffect(() => {
    if (show && address) {
      checkBalance();
    } else {
      // Reset state when modal closes
      setStatus("idle");
      setBalanceInfo(null);
      setError(null);
      setTxId(null);
      setUnicityId("");
    }
  }, [show, address]);

  const checkBalance = async () => {
    setStatus("checking");
    setError(null);

    try {
      const response = await fetch(
        `${L3_PROXY_URL}/api/v1/faucet/balance/${address}`
      );
      const data = await response.json();

      if (!data.success) {
        setStatus("not_eligible");
        setError(data.error || "Address not found in snapshot");
        return;
      }

      setBalanceInfo(data);

      if (data.spent) {
        setStatus("already_minted");
      } else if (data.inSnapshot && data.amount > 0) {
        setStatus("available");
      } else {
        setStatus("not_eligible");
        setError("Address is not eligible for migration");
      }
    } catch (err) {
      setStatus("error");
      setError(
        "Failed to check balance: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  };

  const handleBridge = async () => {
    if (!unicityId.trim()) {
      setError("Please enter your L3 Unicity ID");
      return;
    }

    if (!balanceInfo) {
      setError("Balance info not available");
      return;
    }

    const cleanUnicityId = unicityId.trim();

    setError(null);
    setStatus("signing");

    try {
      // Create message: l1_address:unicityId:amount
      const amountSatoshis = balanceInfo.amountInSmallUnits;
      const message = `${address}:${cleanUnicityId}:${amountSatoshis}`;

      // Sign the message
      const signature = signMessage(privateKey, message);

      setStatus("minting");

      // Submit mint request
      const response = await fetch(`${L3_PROXY_URL}/api/v1/faucet/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          l1_addr: address,
          unicityId: cleanUnicityId,
          amount: amountSatoshis,
          signature: signature,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setStatus("success");
        setTxId(result.txId);
        if (onSuccess) {
          onSuccess(result.txId, result.amount);
        }
      } else {
        setStatus("error");
        setError(result.error || "Minting failed");
      }
    } catch (err) {
      setStatus("error");
      setError(
        "Bridge failed: " + (err instanceof Error ? err.message : String(err))
      );
    }
  };

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: "spring", duration: 0.4 }}
          className="bg-neutral-900 p-4 sm:p-6 rounded-xl w-full max-w-md border border-purple-900/50 shadow-2xl relative max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white text-xl font-bold flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-linear-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4 text-white" />
              </div>
              Bridge to L3
            </h3>
            <button
              onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Demo Warning */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="text-amber-400 font-medium mb-1">
                  Demo Implementation
                </p>
                <p className="text-amber-300/70">
                  This is an alpha test bridge. Your L1 ALPHA tokens will NOT be
                  burned. You will receive equivalent ALPHT tokens on L3 for
                  testing purposes.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Info Box */}
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-300/70">
                <p>
                  Bridge clones your L1 ALPHA coins to L3 ALPHT tokens on Unicity
                  Network. You need to provide your L3 Unicity ID as the
                  destination.
                </p>
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="mb-4">
            <label className="block text-neutral-400 text-xs mb-1">
              Source L1 Address
            </label>
            <div className="bg-neutral-800/50 p-3 rounded-lg border border-neutral-700/50">
              <span className="text-neutral-200 font-mono text-sm break-all">
                {address}
              </span>
            </div>
          </div>

          {/* Status / Balance */}
          <div className="mb-4">
            <label className="block text-neutral-400 text-xs mb-1">
              Mintable Balance
            </label>
            <div className="bg-neutral-800/50 p-3 rounded-lg border border-neutral-700/50">
              {status === "checking" && (
                <div className="flex items-center gap-2 text-neutral-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking eligibility...</span>
                </div>
              )}

              {status === "available" && balanceInfo && (
                <div className="flex items-center justify-between">
                  <span className="text-green-400 font-bold text-lg">
                    {balanceInfo.amount} ALPHA
                  </span>
                  <span className="text-green-500 text-xs flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Available
                  </span>
                </div>
              )}

              {status === "already_minted" && (
                <div className="flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Already minted to L3</span>
                </div>
              )}

              {status === "not_eligible" && (
                <div className="flex items-center gap-2 text-red-400">
                  <X className="w-4 h-4" />
                  <span>Not eligible for migration</span>
                </div>
              )}

              {status === "error" && (
                <div className="flex items-center gap-2 text-red-400">
                  <X className="w-4 h-4" />
                  <span>Error checking balance</span>
                </div>
              )}

              {(status === "signing" ||
                status === "minting" ||
                status === "success") &&
                balanceInfo && (
                  <span className="text-green-400 font-bold text-lg">
                    {balanceInfo.amount} ALPHA
                  </span>
                )}
            </div>
          </div>

          {/* Unicity ID Input */}
          {status === "available" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4"
            >
              <label className="block text-neutral-400 text-xs mb-1">
                Destination L3 Unicity ID
              </label>
              <input
                type="text"
                placeholder="Enter your Unicity ID"
                value={unicityId}
                onChange={(e) => setUnicityId(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-800/50 rounded-lg text-neutral-200 border border-neutral-700/50 focus:border-purple-500 focus:bg-neutral-800 outline-none transition-all font-mono text-sm"
              />
            </motion.div>
          )}

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg"
            >
              <p className="text-red-400 text-sm">{error}</p>
            </motion.div>
          )}

          {/* Loading State */}
          {(status === "signing" || status === "minting") && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-4 p-6 bg-purple-500/10 border border-purple-500/30 rounded-lg text-center"
            >
              <div className="relative w-16 h-16 mx-auto mb-4">
                <motion.div
                  className="absolute inset-0 border-4 border-purple-500/30 rounded-full"
                />
                <motion.div
                  className="absolute inset-0 border-4 border-transparent border-t-purple-500 rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
              </div>
              <p className="text-purple-400 font-medium mb-1">
                {status === "signing" ? "Signing transaction..." : "Minting tokens..."}
              </p>
              <p className="text-neutral-500 text-sm">
                Please wait, this may take a moment
              </p>
            </motion.div>
          )}

          {/* Success State */}
          {status === "success" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center"
            >
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-green-400 font-bold mb-2">Bridge Successful!</p>
              <p className="text-neutral-400 text-sm">
                {balanceInfo?.amount} ALPHT minted to your L3 address
              </p>
            </motion.div>
          )}

          {/* Action Button */}
          {status !== "signing" && status !== "minting" && (
            <div className="flex gap-3">
              {status === "success" ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onClose}
                  className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-xl text-white font-medium transition-colors"
                >
                  Done
                </motion.button>
              ) : status === "available" ? (
                <>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onClose}
                    className="flex-1 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-xl text-white font-medium transition-colors"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleBridge}
                    className="flex-1 py-3 bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-xl text-white font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    Bridge <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onClose}
                  className="flex-1 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-xl text-white font-medium transition-colors"
                >
                  Close
                </motion.button>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
