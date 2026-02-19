const FAUCET_API_URL = 'https://faucet.unicity.network/api/v1/faucet/request';

export interface FaucetRequest {
  unicityId: string;
  coin: string;
  amount: number;
}

export interface FaucetResponse {
  success: boolean;
  message?: string;
  coin: string;
  amount: number;
}

export class FaucetService {
  static async requestTokens(unicityId: string, coin: string, amount: number): Promise<FaucetResponse> {
    if (import.meta.env.DEV) console.log(`🌊 Requesting ${amount} ${coin} for @${unicityId}...`);

    try {
      const requestBody = {
        unicityId,
        coin,
        amount,
      };

      if (import.meta.env.DEV) console.log(`📤 Sending request:`, requestBody);

      const response = await fetch(FAUCET_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (import.meta.env.DEV) console.log(`📥 Response status for ${coin}:`, response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed response for ${coin}:`, errorText);
        throw new Error(`Failed to request ${coin}: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      if (import.meta.env.DEV) console.log(`✅ Success for ${coin}:`, data);

      return {
        success: true,
        coin,
        amount,
        ...data,
      };
    } catch (error) {
      console.error(`❌ Faucet request failed for ${coin}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        coin,
        amount,
      };
    }
  }

  static async requestAllCoins(unicityId: string): Promise<FaucetResponse[]> {
    const requests = [
      { coin: 'unicity', amount: 100 },
      { coin: 'bitcoin', amount: 1 },
      { coin: 'solana', amount: 1000 },
      { coin: 'ethereum', amount: 42 },
      { coin: 'tether', amount: 1000 },
      { coin: 'usd-coin', amount: 1000 },
      { coin: 'unicity-usd', amount: 1000 },
    ];

    if (import.meta.env.DEV) console.log(`🚀 Starting parallel faucet requests for @${unicityId}...`);

    // Request all coins in parallel for better performance
    const results = await Promise.all(
      requests.map(({ coin, amount }) => this.requestTokens(unicityId, coin, amount))
    );

    if (import.meta.env.DEV) console.log(`📊 Faucet results:`, results);
    const successful = results.filter(r => r.success).length;
    if (import.meta.env.DEV) console.log(`✅ ${successful}/${results.length} requests successful`);

    window.dispatchEvent(new Event("wallet-updated"));
    return results;
  }
}
