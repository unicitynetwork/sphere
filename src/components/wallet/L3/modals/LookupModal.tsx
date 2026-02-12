import { useState, useCallback, useEffect } from 'react';
import { Key, Search, Loader2, Copy, Check } from 'lucide-react';
import { BaseModal, ModalHeader } from '../../ui';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { useIdentity } from '../../../../sdk';

interface ResolvedInfo {
  nametag?: string;
  transportPubkey?: string;
  chainPubkey?: string;
  l1Address?: string;
  directAddress?: string;
  proxyAddress?: string;
}

interface LookupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function CopyableField({ label, value, prefix, copied, onCopy }: {
  label: string;
  value: string;
  prefix?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const display = prefix ? `${prefix}${value}` : value;
  return (
    <div className="flex items-start gap-2 group">
      <span className="text-xs text-neutral-500 dark:text-neutral-400 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-neutral-900 dark:text-white font-mono break-all flex-1">{display}</span>
      <button
        onClick={onCopy}
        className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-all shrink-0"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function LookupModal({ isOpen, onClose }: LookupModalProps) {
  const { sphere } = useSphereContext();
  const { nametag, directAddress, l1Address } = useIdentity();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ResolvedInfo | null>(null);
  const [myInfo, setMyInfo] = useState<ResolvedInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | false>(false);

  // Auto-resolve own keys when modal opens
  useEffect(() => {
    if (isOpen && sphere && directAddress) {
      sphere.resolve(directAddress).then((info: ResolvedInfo | null) => {
        if (info) setMyInfo(info);
      }).catch(() => { /* ignore */ });
      setQuery('');
      setResult(null);
      setError(null);
    }
  }, [isOpen, sphere, directAddress]);

  const handleLookup = useCallback(async () => {
    const input = query.trim();
    if (!input || !sphere) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const info = await sphere.resolve(input);
      if (!info) {
        setError(`Not found: "${input}"`);
      } else {
        setResult(info as ResolvedInfo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsLoading(false);
    }
  }, [query, sphere]);

  const handleCopy = useCallback(async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLookup();
    }
  };

  const toFields = (info: ResolvedInfo, prefix: string) => [
    { label: 'Nametag', value: info.nametag, key: `${prefix}-nametag`, displayPrefix: '@' },
    { label: 'Direct Address', value: info.directAddress, key: `${prefix}-direct` },
    { label: 'Proxy Address', value: info.proxyAddress, key: `${prefix}-proxy` },
    { label: 'L1 Address', value: info.l1Address, key: `${prefix}-l1` },
    { label: 'Chain Pubkey', value: info.chainPubkey, key: `${prefix}-chain` },
    { label: 'Transport Pubkey', value: info.transportPubkey, key: `${prefix}-transport` },
  ].filter((f): f is { label: string; value: string; key: string; displayPrefix?: string } => !!f.value);

  // Fall back to identity data if resolve didn't return full info
  const myFields = myInfo ? toFields(myInfo, 'my') : [
    nametag && { label: 'Nametag', value: nametag, key: 'my-nametag', displayPrefix: '@' },
    directAddress && { label: 'Direct Address', value: directAddress, key: 'my-direct' },
    l1Address && { label: 'L1 Address', value: l1Address, key: 'my-l1' },
  ].filter((f): f is { label: string; value: string; key: string; displayPrefix?: string } => !!f);

  const lookupFields = result ? toFields(result, 'lookup') : [];

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" showOrbs={false}>
      <ModalHeader title="My Public Keys" icon={Key} iconVariant="neutral" onClose={onClose} />

      <div className="overflow-y-auto flex-1">
        {/* My Keys */}
        {myFields.length > 0 && (
          <div className="p-4 space-y-2">
            <div className="space-y-2 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-700/30">
              {myFields.map(({ label, value, key, displayPrefix }) => (
                <CopyableField
                  key={key}
                  label={label}
                  value={value}
                  prefix={displayPrefix}
                  copied={copied === key}
                  onCopy={() => handleCopy(displayPrefix ? `${displayPrefix}${value}` : value, key)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Lookup */}
        <div className="border-t border-neutral-200 dark:border-neutral-800/50 p-4 space-y-3">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            Lookup
          </p>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="@nametag, DIRECT://..., alpha1..."
                className="w-full pl-8 pr-3 py-2.5 text-sm bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl border border-neutral-200 dark:border-neutral-700/50 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <button
              onClick={handleLookup}
              disabled={!query.trim() || isLoading || !sphere}
              className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium disabled:opacity-50 hover:bg-orange-600 transition-colors flex items-center"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}

          {lookupFields.length > 0 && (
            <div className="space-y-2 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-700/30">
              {lookupFields.map(({ label, value, key, displayPrefix }) => (
                <CopyableField
                  key={key}
                  label={label}
                  value={value}
                  prefix={displayPrefix}
                  copied={copied === key}
                  onCopy={() => handleCopy(displayPrefix ? `${displayPrefix}${value}` : value, key)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
