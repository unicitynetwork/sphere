import { RegistryService } from "../services/RegistryService";

export const CurrencyUtils = {
    toSmallestUnit: (amount: string, decimals: number): bigint => {
        if (!amount) return 0n;
        try {
            const [integer, fraction = ''] = amount.split('.');
            
            const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
            
            return BigInt(integer + paddedFraction);
        } catch (e) {
            console.error("Invalid amount format", e);
            return 0n;
        }
    },

    toHumanReadable: (amount: bigint | string, decimals: number): string => {
        const str = amount.toString().padStart(decimals + 1, '0');
        const integer = str.slice(0, -decimals);
        const fraction = str.slice(-decimals).replace(/0+$/, '');
        
        return fraction ? `${integer}.${fraction}` : integer;
    }
};

export const AmountFormatUtils = {
    formatDisplayAmount: (amount?: string, coinId?: string): string => {
      try {
        if(amount === undefined || coinId === undefined) return "";
        const amountFloat = parseFloat(amount);
    
        const registryService = RegistryService.getInstance();
        const def = registryService.getCoinDefinition(coinId);
    
        const decimals = def?.decimals ?? 6;
        const divisor = Math.pow(10, decimals);
    
        const val = amountFloat / divisor;
    
        return new Intl.NumberFormat('en-US', {
          maximumFractionDigits: 6
        }).format(val);
      } catch (error) { 
        console.warn("Error formatting amount", error);
        return amount ? amount : ""; 
      }
    }
}