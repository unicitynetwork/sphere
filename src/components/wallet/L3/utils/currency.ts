export const CurrencyUtils = {
    /**
     * Ввод пользователя (строка "1.5") -> BigInt ("1500000000")
     */
    toSmallestUnit: (amount: string, decimals: number): bigint => {
        if (!amount) return 0n;
        try {
            // Разделяем целую и дробную части
            const [integer, fraction = ''] = amount.split('.');
            
            // Паддинг дробной части нулями (1.5 -> 1.500000000)
            const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
            
            // Склеиваем ("1" + "500000000") и переводим в BigInt
            return BigInt(integer + paddedFraction);
        } catch (e) {
            console.error("Invalid amount format", e);
            return 0n;
        }
    },

    /**
     * BigInt -> Строка для отображения ("1.5")
     */
    toHumanReadable: (amount: bigint | string, decimals: number): string => {
        const str = amount.toString().padStart(decimals + 1, '0');
        const integer = str.slice(0, -decimals);
        const fraction = str.slice(-decimals).replace(/0+$/, ''); // Убираем лишние нули
        
        return fraction ? `${integer}.${fraction}` : integer;
    }
};