const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function (config) {
  return withAndroidManifest(config, async (config) => {
    const googleMapsApiKey =
      process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!googleMapsApiKey) {
      console.warn(
        "Google Maps API key not found in env. Set GOOGLE_MAPS_API_KEY (or EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) for build environments."
      );
      return config;
    }

    const manifest = config.modResults;
    const application = manifest.application?.[0];

    if (!application) {
      console.warn("No application element found in AndroidManifest.xml");
      return config;
    }

    // Remove any existing Google Maps API key metadata
    if (!application["meta-data"]) {
      application["meta-data"] = [];
    }

    const existingIndex = application["meta-data"].findIndex(
      (item) =>
        item.$["android:name"] === "com.google.android.geo.API_KEY"
    );

    const apiKeyMetaData = {
      $: {
        "android:name": "com.google.android.geo.API_KEY",
        "android:value": googleMapsApiKey,
      },
    };

    if (existingIndex >= 0) {
      application["meta-data"][existingIndex] = apiKeyMetaData;
    } else {
      application["meta-data"].push(apiKeyMetaData);
    }

    return config;
  });
};
