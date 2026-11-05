import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'dev.flamedev.chessash', appName: 'ChessAsh', webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#211f1d', allowMixedContent: false },
  plugins: { CapacitorHttp: { enabled: true } }
};
export default config;
