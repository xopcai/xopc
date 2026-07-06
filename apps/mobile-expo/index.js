const { LogBox } = require('react-native');

LogBox.ignoreLogs([
  'Linking found multiple possible URI schemes in your Expo config.',
]);

require('expo-router/entry');
