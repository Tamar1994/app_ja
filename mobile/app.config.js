const { expo: appJson } = require('./app.json');

module.exports = {
  ...appJson,
  android: {
    ...appJson.android,
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
  },
  // Removido ./app.plugin.js — chave agora injetada via android.config.googleMaps (nativo Expo)
  plugins: appJson.plugins.filter((p) => p !== './app.plugin.js'),
};
