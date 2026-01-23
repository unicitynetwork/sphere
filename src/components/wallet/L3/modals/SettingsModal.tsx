import { Settings, Layers, Download, LogOut } from 'lucide-react';
import { BaseModal, ModalHeader, MenuButton } from '../../ui';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenL1Wallet: () => void;
  onBackupWallet: () => void;
  onLogout: () => void;
  l1Balance?: string;
}

export function SettingsModal({
  isOpen,
  onClose,
  onOpenL1Wallet,
  onBackupWallet,
  onLogout,
  l1Balance,
}: SettingsModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" showOrbs={false}>
      <ModalHeader title="Settings" icon={Settings} iconVariant="neutral" onClose={onClose} />

      {/* Menu Items */}
      <div className="p-4 space-y-2">
        <MenuButton
          icon={Layers}
          color="blue"
          label="L1 Wallet"
          subtitle={l1Balance ? `${l1Balance} ALPHA` : undefined}
          onClick={() => {
            onClose();
            onOpenL1Wallet();
          }}
        />

        <MenuButton
          icon={Download}
          color="green"
          label="Backup Wallet"
          showChevron={false}
          onClick={() => {
            onClose();
            onBackupWallet();
          }}
        />

        <MenuButton
          icon={LogOut}
          color="red"
          label="Logout"
          danger
          onClick={() => {
            onClose();
            onLogout();
          }}
        />
      </div>
    </BaseModal>
  );
}
