/**
 * Type declarations for @unicitylabs/sphere-sdk/impl/browser
 *
 * The SDK's tsup config has dts: false for the browser entry point,
 * so no .d.ts files are emitted. This module declaration provides
 * the types needed by our adapter layer.
 *
 * TODO: Remove once sphere-sdk enables dts for impl/browser.
 */
declare module '@unicitylabs/sphere-sdk/impl/browser' {
  import type {
    NetworkType,
    StorageProvider,
    TransportProvider,
    OracleProvider,
    TokenStorageProvider,
    TxfStorageDataBase,
    PriceProvider,
  } from '@unicitylabs/sphere-sdk';

  export interface BrowserProvidersConfig {
    network?: NetworkType;
    storage?: Record<string, unknown>;
    transport?: Record<string, unknown>;
    oracle?: Record<string, unknown>;
    l1?: Record<string, unknown>;
    tokenSync?: Record<string, unknown>;
    price?: Record<string, unknown>;
    groupChat?: Record<string, unknown> | boolean;
  }

  export interface BrowserProviders {
    storage: StorageProvider;
    transport: TransportProvider;
    oracle: OracleProvider;
    tokenStorage: TokenStorageProvider<TxfStorageDataBase>;
    l1?: Record<string, unknown>;
    price?: PriceProvider;
    tokenSyncConfig?: Record<string, unknown>;
  }

  export function createBrowserProviders(
    config?: BrowserProvidersConfig,
  ): BrowserProviders;
}
