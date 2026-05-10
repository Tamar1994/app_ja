const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function (config) {
  return withAndroidManifest(config, async (config) => {
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
        "android:value": "AIzaSyBCu-yQ9NW-Ednfv0iMW82nSpN7OuaOj28",
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
