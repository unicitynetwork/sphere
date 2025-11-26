/**
 * Обертка для использования wallet-restore.ts в index.html
 *
 * Этот файл экспортирует упрощенную версию restoreWallet для использования в HTML.
 * Вставьте этот код в ваш index.html или подключите как модуль.
 */

import { restoreWallet } from './wallet-restore.js';

/**
 * Глобальная функция для HTML версии кошелька
 * Использует существующие глобальные переменные и функции из index.html
 */
window.restoreWalletModular = async function() {
    const file = restoreFileInput.files[0];

    if (!file) {
        restoreStatus.className = 'info-box error';
        restoreStatus.textContent = 'Please select a wallet backup file.';
        restoreStatus.style.display = 'block';
        return;
    }

    // Подготовка опций из глобальных переменных
    const options = {
        file: file,
        password: restorePasswordInput.value,
        wallet: wallet,
        currentUtxos: currentUtxos,
        currentTransactions: currentTransactions,
        currentTransactionPage: currentTransactionPage,
        currentUtxoPage: currentUtxoPage,
        offlineUtxoData: offlineUtxoData,
        lazyScanInterval: lazyScanInterval,
        lastScannedWalletData: lastScannedWalletData,
        scannedWallets: scannedWallets,
        electrumConnected: electrumConnected,
        isInitialLoad: isInitialLoad
    };

    // UI элементы
    const uiElements = {
        restoreStatus: document.getElementById('restoreStatus'),
        restorePasswordInput: document.getElementById('restorePasswordInput'),
        walletBalance: document.getElementById('walletBalance'),
        walletUnconfirmed: document.getElementById('walletUnconfirmed'),
        passwordStrength: document.getElementById('passwordStrength')
    };

    // Колбэки на существующие функции
    const callbacks = {
        restoreFromWalletDat: restoreFromWalletDat,
        generateNewAddress: generateNewAddress,
        addAddressToUI: addAddressToUI,
        saveWalletData: saveWalletData,
        closeRestoreModal: closeRestoreModal,
        showInAppNotification: showInAppNotification,
        refreshBalance: refreshBalance,
        updateTransactionHistory: updateTransactionHistory,
        updateButtonStates: updateButtonStates,
        hexToWIF: hexToWIF,
        createBech32: createBech32,
        hexToBytes: hexToBytes
    };

    // Вызов модульной функции
    const result = await restoreWallet(options, uiElements, callbacks);

    // Обновление глобальных переменных
    if (result.success) {
        wallet = result.wallet;
        window.walletGlobal = wallet;

        // Обновляем состояние из options (они могли измениться)
        currentUtxos = options.currentUtxos;
        currentTransactions = options.currentTransactions;
        currentTransactionPage = options.currentTransactionPage;
        currentUtxoPage = options.currentUtxoPage;
        offlineUtxoData = options.offlineUtxoData;
        lazyScanInterval = options.lazyScanInterval;
        lastScannedWalletData = options.lastScannedWalletData;
        scannedWallets = options.scannedWallets;
        isInitialLoad = options.isInitialLoad;
    }

    return result;
};

// Также можно заменить старую функцию напрямую:
// window.restoreWallet = window.restoreWalletModular;
