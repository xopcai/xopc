module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must be last — required by react-native-reanimated / drawer animations
    plugins: ['react-native-reanimated/plugin'],
  };
};
