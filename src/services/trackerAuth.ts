import * as SecureStore from 'expo-secure-store';

const KEYS = {
  anilistClientId: 'vellichor_anilist_client_id',
  anilistToken: 'vellichor_anilist_token',
  malClientId: 'vellichor_mal_client_id',
  malToken: 'vellichor_mal_token',
  malRefreshToken: 'vellichor_mal_refresh_token',
} as const;

export const trackerAuthStore = {
  async getClientId(provider: 'anilist' | 'mal'): Promise<string> {
    const val = await SecureStore.getItemAsync(
      provider === 'anilist' ? KEYS.anilistClientId : KEYS.malClientId
    );
    return val ?? '';
  },

  async setClientId(provider: 'anilist' | 'mal', clientId: string): Promise<void> {
    const key = provider === 'anilist' ? KEYS.anilistClientId : KEYS.malClientId;
    if (!clientId.trim()) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, clientId.trim());
    }
  },

  async getToken(provider: 'anilist' | 'mal'): Promise<string | null> {
    return SecureStore.getItemAsync(provider === 'anilist' ? KEYS.anilistToken : KEYS.malToken);
  },

  async setToken(provider: 'anilist' | 'mal', token: string | null): Promise<void> {
    const key = provider === 'anilist' ? KEYS.anilistToken : KEYS.malToken;
    if (!token) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, token);
    }
  },

  async getMalRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS.malRefreshToken);
  },

  async setMalRefreshToken(token: string | null): Promise<void> {
    if (!token) {
      await SecureStore.deleteItemAsync(KEYS.malRefreshToken);
    } else {
      await SecureStore.setItemAsync(KEYS.malRefreshToken, token);
    }
  },
};
